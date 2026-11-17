import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { Capture } from './capture.js';
import { boundedRead, Store } from './store.js';
import { localUrl, redact } from './privacy.js';
import { runActions, validateRecipe } from './verify.js';
import type { Action, Settings } from './types.js';

export interface Flow { schema: 1; expected: string; actions: Action[]; testData: boolean }
export async function discover(project: string, explicitUrl?: string) {
  const root = await fs.realpath(project);
  const packageFile = await boundedRead(path.join(root, 'package.json'), 100000).catch(() => '{}');
  const pkg = JSON.parse(packageFile);
  const commands = Object.entries(pkg.scripts || {}).filter(([name]) => ['dev', 'start', 'serve'].includes(name)).map(([name, command]) => ({ script: name, command: String(command).slice(0, 500) }));
  if (explicitUrl) return { project: root, url: localUrl(explicitUrl).href, source: 'explicit current-task URL', commands };
  const config = JSON.parse(await boundedRead(path.join(root, '.trace.json'), 4000).catch(() => '{}'));
  if (typeof config.url === 'string') return { project: root, url: localUrl(config.url).href, source: 'project .trace.json', commands };
  const index = await boundedRead(path.join(root, 'index.html'), 100000).catch(() => '');
  const title = index.match(/<title>([^<]{1,120})<\/title>/i)?.[1];
  const source = index.match(/<script[^>]+src=["']([^"']+)["']/i)?.[1];
  const vite = !!pkg.dependencies?.vite || !!pkg.devDependencies?.vite || commands.some(c => /\bvite\b/.test(c.command));
  const port = commands.map(c => c.command.match(/--port(?:=|\s+)(\d{2,5})/)?.[1]).find(Boolean) || (vite ? '5173' : undefined);
  if (port && title && source && source.startsWith('/')) {
    const origin = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(origin, { redirect: 'error', signal: AbortSignal.timeout(1500) });
      const chunks: Buffer[] = []; let length = 0;
      if (response.body) for await (const chunk of response.body) { length += chunk.length; if (length > 100000) { chunks.length = 0; break; } chunks.push(Buffer.from(chunk)); }
      const body = Buffer.concat(chunks).toString('utf8');
      if (response.ok && body.includes(`<title>${title}</title>`) && body.includes(source)) return { project: root, url: origin + '/', source: 'single project-derived Vite port; entry title and module path matched', commands };
    } catch {}
  }
  return { project: root, url: null, source: 'No unambiguous running app found. Use the current project dev-server URL; do not scan unrelated processes or ports.', commands };
}
/** Visible controls plus layout measurements: element boxes, controls cut off at the viewport edge, horizontal page overflow. */
export async function controlSnapshot(page: Page) {
  const snapshot = await page.evaluate(() => {
    const privateElement = (e: Element) => !!e.closest('[data-private],[data-trace-private]') || /hidden|password|secret|token|auth|session|csrf|api.?key|credit|card|cvv|email/i.test(`${e.getAttribute('type')} ${e.getAttribute('name')} ${e.id} ${e.getAttribute('autocomplete')}`);
    const viewport = { width: innerWidth, height: innerHeight };
    const controls = Array.from(document.querySelectorAll('input,button,textarea,select,a,[role=button]')).filter(e => e.getBoundingClientRect().width > 0 && !privateElement(e)).slice(0, 50).map(e => {
      const r = e.getBoundingClientRect();
      return { tag: e.tagName.toLowerCase(), label: e.getAttribute('aria-label') || (e as HTMLInputElement).labels?.[0]?.textContent?.trim() || (['BUTTON', 'A'].includes(e.tagName) ? e.textContent?.trim() : ''), id: e.id || undefined, testId: e.getAttribute('data-testid') || undefined, type: e.getAttribute('type') || undefined, box: { x: Math.round(r.x), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) }, clipped: r.left < -1 || r.right > innerWidth + 1 };
    });
    return { controls, layout: { viewport, scrollWidth: document.documentElement.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1, note: 'Measurements only; an intentional layout is not a defect.' } };
  });
  const controls = snapshot.controls.map(c => Object.fromEntries(Object.entries(c).map(([key, value]) => [key, typeof value === 'string' ? redact(value, 160) : value])));
  return { controls, layout: { ...snapshot.layout, clipped: controls.filter(c => c.clipped).map(c => c.label || c.id || c.tag) } };
}
export async function automatic(options: { project: string; url?: string; store: Store; flow?: Flow; shareWithCurrentAgent: boolean; allowLocalSideEffects?: boolean; headless?: boolean }) {
  if (!options.shareWithCurrentAgent) throw new Error('Automatic capture requires explicit skill-invocation scope: --share-with-current-agent.');
  const found = await discover(options.project, options.url);
  if (!found.url) return { status: 'app unavailable', ...found };
  const flow = options.flow;
  if (flow) {
    if (flow.schema !== 1 || typeof flow.expected !== 'string' || !flow.expected.trim() || flow.expected.length > 500) throw new Error('Flow requires explicit intended behavior.');
    if (!options.allowLocalSideEffects) throw new Error('Automatic actions need --allow-local-side-effects for this owned local app.');
    validateRecipe({ schema: 1, status: 'ready', actions: flow.actions, reasons: [] }, localUrl(found.url).origin);
  }
  const settings: Settings = { values: flow?.testData === true, messages: true, screenshots: true };
  const capture = new Capture({ url: found.url, project: found.project, store: options.store, settings, headless: options.headless ?? true, restrictToOrigin: true, limits: { screenshots: 6 } });
  if (flow) {
    // The flow is the reproduction. Values that are not declared test data become runtime inputs for verify.
    const actions = flow.actions.map((a, i) => !flow.testData && a.action === 'fill' ? { ...a, value: undefined, parameter: `input-${i + 1}` } : a);
    capture.recipe = { schema: 1, status: actions.some(a => a.parameter) ? 'needs inputs/authentication' : 'ready', actions, reasons: [] };
  }
  let initial: Awaited<ReturnType<typeof controlSnapshot>> | undefined, final: typeof initial, step = 0;
  try {
    await capture.start();
    capture.page!.setDefaultTimeout(5000);
    await capture.page!.waitForLoadState('load', { timeout: 5000 });
    initial = await controlSnapshot(capture.page!);
    await capture.mark(true, 'Automatic initial view');
    for (const action of flow?.actions || []) {
      step++;
      capture.add('action', { step, action: action.action, locator: action.locator, ...(flow!.testData && action.value !== undefined ? { value: action.value } : {}) });
      await runActions(capture.page!, [action]);
      await capture.mark(true, `Automatic view after step ${step} (${action.action})`);
    }
    if (flow) final = await controlSnapshot(capture.page!);
  } catch (error) {
    const where = step ? `Step ${step} (${flow!.actions[step - 1].action} ${JSON.stringify(flow!.actions[step - 1].locator ?? '')})` : 'Initial inspection';
    capture.omissions.add(`${where} failed: ${redact(error instanceof Error ? error.message : 'unknown error', 300)} No successful reproduction inferred.`);
  }
  const incident = await capture.stop(flow?.expected || 'Inspection only: no behavior oracle supplied.');
  // Explicit skill invocation authorizes this bounded app evidence for the current agent.
  await options.store.approve(incident.manifest.id, true, 'explicit skill invocation for current agent');
  return { status: incident.manifest.completeness, omissions: incident.manifest.omissions, discovery: found, id: incident.manifest.id, store: options.store.root, controls: initial?.controls ?? [], layout: { initial: initial?.layout, final: final?.layout }, images: incident.manifest.attachments.map(name => path.join(options.store.dir(incident.manifest.id), 'approved', name)), brief: (await options.store.read(incident.manifest.id)).brief };
}
