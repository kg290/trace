import { chromium, request, type Page, type Locator } from 'playwright';
import { expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomic, boundedRead, hash, json, noLinks, priorRuns, Store } from './store.js';
import { localUrl, redact, safeUrl } from './privacy.js';
import { restrictBrowser } from './browser-scope.js';
import { maskedScreenshot } from './capture.js';
import type { Action, LocatorSpec, Oracle, Recipe } from './types.js';

export function validateLocator(spec: any): asserts spec is LocatorSpec {
  if (!spec || !['label', 'role', 'testId', 'id'].includes(spec.by) || typeof spec.value !== 'string' || !spec.value || spec.value.length > 160 || spec.by === 'role' && !['button', 'link', 'checkbox', 'radio', 'tab', 'textbox', 'status', 'alert'].includes(spec.role)) throw new Error('Unsupported locator.');
}
export function locator(page: Page, spec: LocatorSpec): Locator {
  validateLocator(spec);
  if (spec.by === 'label') return page.getByLabel(spec.value, { exact: true });
  if (spec.by === 'role') return page.getByRole(spec.role as 'button', { name: spec.value, exact: true });
  if (spec.by === 'testId') return page.getByTestId(spec.value);
  return page.locator(`[id=${JSON.stringify(spec.value)}]`);
}
export function validateOracle(value: any): asserts value is Oracle {
  if (!value || value.schema !== 1 || typeof value.origin !== 'string' || localUrl(value.origin).origin !== value.origin || typeof value.prerequisites !== 'string' || !value.prerequisites.trim() || value.prerequisites.length > 1000 || !Array.isArray(value.checks) || !value.checks.length || value.checks.length > 20) throw new Error('Oracle needs an exact local origin, prerequisites, and 1–20 explicit checks.');
  for (const check of value.checks) {
    if (['value', 'text'].includes(check.kind)) {
      validateLocator(check.locator);
      if (!['after actions', 'after reload'].includes(check.phase) || typeof check.equals !== 'string' || check.equals.length > 1000) throw new Error('Invalid behavioral assertion.');
    } else if (check.kind === 'http') {
      if (!['GET', 'POST', 'PATCH', 'PUT'].includes(check.method) || typeof check.path !== 'string' || !/^\/[A-Za-z0-9/_-]{0,120}$/.test(check.path) || !Number.isInteger(check.status) || check.status < 200 || check.status > 599 || !['session', 'none'].includes(check.authentication) || JSON.stringify(check.body || {}).length > 4000) throw new Error('HTTP check is outside the bounded local scope.');
    } else throw new Error('Unknown oracle check.');
  }
  if (!value.checks.some((c: any) => c.kind === 'value' || c.kind === 'text')) throw new Error('Include a visible behavior assertion, not just HTTP status checks.');
}
export function validateRecipe(recipe: Recipe, origin: string) {
  if (!recipe || recipe.schema !== 1 || !['ready', 'needs inputs/authentication'].includes(recipe.status) || !Array.isArray(recipe.actions) || recipe.actions.length < 1 || recipe.actions.length > 100 || recipe.reasons.length) throw new Error('Recipe is incomplete or unsupported; manual verification required.');
  for (const action of recipe.actions) {
    if (!['click', 'fill', 'check', 'select', 'press', 'reload'].includes(action.action)) throw new Error('Unsupported replay action.');
    if (action.action !== 'reload') validateLocator(action.locator);
    if (action.waitFor) validateLocator(action.waitFor);
    if (action.awaitResponse && (localUrl(action.awaitResponse.url).origin !== origin || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(action.awaitResponse.method))) throw new Error('Response wait is outside the selected origin.');
    if (action.action === 'press' && !['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(String(action.value))) throw new Error('Unsupported key.');
  }
}
export async function freezeOracle(store: Store, id: string, oracle: Oracle) {
  validateOracle(oracle);
  const incident = await store.read(id);
  if (oracle.origin !== incident.manifest.origin) throw new Error('Oracle origin does not match the recording.');
  validateRecipe(incident.recipe, oracle.origin);
  const frozen = { oracle, recipeHash: hash(json(incident.recipe)), projectIdentity: incident.manifest.projectIdentity };
  const digest = hash(json(frozen));
  const directory = path.join(store.dir(id), 'verification'); await noLinks(directory); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'oracle.json'), json({ ...frozen, digest }), { flag: 'wx', mode: 0o600 });
  return digest;
}
export async function runActions(page: Page, actions: Action[], inputs: Record<string, string> = {}) {
  for (const action of actions) {
    if (action.action === 'reload') { await page.reload({ waitUntil: 'domcontentloaded' }); if (action.waitFor) await expect(locator(page, action.waitFor)).toBeEnabled(); continue; }
    const target = locator(page, action.locator!); await expect(target).toHaveCount(1);
    const value = action.parameter ? inputs[action.parameter] : action.value;
    if (action.parameter && value === undefined) throw new Error('A redacted runtime input is missing.');
    const response = action.awaitResponse ? page.waitForResponse(r => r.url() === action.awaitResponse!.url && r.request().method() === action.awaitResponse!.method, { timeout: 5000 }) : undefined;
    const perform = async () => {
      switch (action.action) {
        case 'click': await target.click(); break;
        case 'fill': if (typeof value !== 'string') throw new Error('Text input required.'); await target.fill(value); break;
        case 'check': if (typeof value !== 'boolean') throw new Error('Boolean input required.'); await target.setChecked(value); break;
        case 'select': if (typeof value !== 'string' && !Array.isArray(value)) throw new Error('Selection required.'); await target.selectOption(value as string | string[]); break;
        case 'press': await target.press(String(value)); break;
      }
    };
    await Promise.all([perform(), response]);
    if (action.waitFor) await expect(locator(page, action.waitFor)).toBeEnabled();
  }
}
export async function verify(store: Store, id: string, options: { project: string; url: string; oracleSha: string; allowLocalSideEffects: boolean; inputs?: Record<string, string>; headless?: boolean }) {
  const incident = await store.read(id);
  if (!options.allowLocalSideEffects) throw new Error('Replay needs separate --allow-local-side-effects authorization for an owned local fixture.');
  const origin = localUrl(options.url).origin;
  if (origin !== incident.manifest.origin || hash(await fs.realpath(options.project)) !== incident.manifest.projectIdentity) throw new Error('Target origin or project does not match the capture.');
  const directory = path.join(store.dir(id), 'verification');
  const frozen = JSON.parse(await boundedRead(path.join(directory, 'oracle.json'), 40000));
  const { digest, ...sealed } = frozen;
  if (!options.oracleSha || digest !== options.oracleSha || hash(json(sealed)) !== digest || frozen.recipeHash !== hash(json(incident.recipe)) || frozen.projectIdentity !== incident.manifest.projectIdentity) throw new Error('Frozen oracle or recipe changed. No verification accepted.');
  validateOracle(frozen.oracle); validateRecipe(incident.recipe, origin);
  for (const action of incident.recipe.actions) if (action.parameter && options.inputs?.[action.parameter] === undefined) throw new Error('Runtime inputs or authentication are missing.');
  if (frozen.oracle.origin !== origin || incident.manifest.startUrl.includes('[')) throw new Error('Replay URL needs manual review.');
  const checks: Oracle['checks'] = frozen.oracle.checks;
  const result = { schema: 1, id: randomUUID(), incident: id, at: new Date().toISOString(), oracleSha: digest, origin, projectIdentity: incident.manifest.projectIdentity, mode: 'real local services; no response mocks', status: 'blocked', actions: 'not run', blockedRequests: [] as string[], checks: [] as Array<{ index: number; kind: string; passed: boolean; observed?: string }>, screenshot: undefined as string | undefined, baseline: undefined as undefined | { at: string; status: string }, history: {} as Record<string, number>, limits: ['Fresh context; service workers blocked and cache disabled by request routing.', 'Browser external HTTP and WebSocket access blocked. Server-side egress is not sandboxed; use an owned fixture.', 'Authentication state and databases are not restored from the recording.'] };
  const actions = [...incident.recipe.actions];
  // A trailing reload duplicates the 'after reload' phase and would hide the state right after the actions.
  if (checks.some(c => c.kind !== 'http' && c.phase === 'after reload')) while (actions.at(-1)?.action === 'reload') actions.pop();
  // Visible checks first; HTTP checks may write data, so they run last and cannot disturb the visible results.
  const rank = (c: Oracle['checks'][number]) => c.kind === 'http' ? 2 : c.phase === 'after reload' ? 1 : 0;
  const ordered = checks.map((check, index) => ({ check, index })).sort((a, b) => rank(a.check) - rank(b.check));
  let browser, page: Page | undefined, external = false, passed = false;
  try {
    browser = await chromium.launch({ headless: options.headless ?? true });
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await restrictBrowser(context, origin, url => { external = true; if (result.blockedRequests.length < 10) result.blockedRequests.push(safeUrl(url)); });
    page = await context.newPage(); page.setDefaultTimeout(5000);
    await page.goto(incident.manifest.startUrl, { waitUntil: 'domcontentloaded' });
    await runActions(page, actions, options.inputs);
    result.actions = 'completed';
    let reloaded = false;
    for (const { check, index } of ordered) {
      const row: (typeof result.checks)[number] = { index, kind: check.kind, passed: false };
      try {
        if (check.kind === 'http') {
          const client = check.authentication === 'none' ? await request.newContext() : context.request;
          try { const response = await client.fetch(origin + check.path, { method: check.method, data: check.body, headers: { Origin: origin }, maxRedirects: 0, timeout: 5000 }); row.passed = response.status() === check.status; if (!row.passed) row.observed = `HTTP ${response.status()}`; } finally { if (client !== context.request) await client.dispose(); }
        } else {
          if (check.phase === 'after reload' && !reloaded) { await page.reload({ waitUntil: 'domcontentloaded' }); reloaded = true; }
          const target = locator(page, check.locator); await expect(target).toHaveCount(1);
          if (check.kind === 'value') await expect(target).toHaveValue(check.equals, { timeout: 3000 }); else await expect(target).toHaveText(check.equals, { timeout: 3000 });
          row.passed = true;
        }
      } catch (error) { row.observed = redact(error instanceof Error ? error.message : 'Check failed.', 400); }
      result.checks.push(row);
    }
    passed = result.checks.every(c => c.passed);
    // Blocked outside requests only make the run unverifiable when something actually failed.
    result.status = passed ? 'passed' : external ? 'blocked' : 'failed';
    if (external) result.limits.push('Outside-origin requests were blocked; behavior that depends on them is unverified.');
  } catch (error) { result.status = 'blocked'; result.actions = `failed or unavailable; no steps silently skipped: ${redact(error instanceof Error ? error.message : 'unknown error', 300)}`; }
  try {
    const shot = page && !page.isClosed() ? await maskedScreenshot(page, incident.manifest.settings.values) : 'No page available.';
    if (typeof shot === 'string') result.limits.push(`No final screenshot: ${shot}`);
    else { result.screenshot = path.join(directory, `${result.id}.png`); await atomic(result.screenshot, shot); }
  } catch { result.limits.push('No final screenshot: capture failed.'); }
  finally { await browser?.close(); }
  // Only a failing baseline lets a later pass count as a verified fix.
  const prior = await priorRuns(directory), first = prior[0];
  if (result.status !== 'blocked') {
    result.status = !first ? (passed ? 'could not reproduce' : 'reproduced')
      : first.status === 'reproduced' ? (passed ? 'verified within stated checks' : 'still failing')
      : passed ? 'could not reproduce' : 'regression';
  }
  result.baseline = first ? { at: first.at, status: first.status } : undefined;
  result.history = { priorRuns: prior.length, sinceBaselineMs: first ? Date.parse(result.at) - Date.parse(first.at) : 0 };
  await noLinks(directory); await atomic(path.join(directory, `${result.id}.json`), json(result));
  return result;
}