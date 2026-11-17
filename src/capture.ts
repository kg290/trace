import { chromium, type Browser, type BrowserContext, type Page, type Request } from 'playwright';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { promises as fs } from 'node:fs';
import { observe } from './observer.js';
import { localUrl, redact, safeUrl, sanitize } from './privacy.js';
import { hash, Store } from './store.js';
import { makeBrief } from './packet.js';
import { restrictBrowser } from './browser-scope.js';
import { DEFAULT_LIMITS, SCHEMA, VERSION, type EvidenceEvent, type Incident, type Limits, type Recipe, type Settings, type State } from './types.js';

/** Masked PNG of the page, or the reason no safe image could be taken. */
export async function maskedScreenshot(page: Page, values: boolean): Promise<Buffer | string> {
  if (await page.locator('iframe,canvas,video').count()) return 'Frames/canvas/video prevent reliable masking.';
  const masks = values ? '[type=password],[type=email],[type=hidden],[autocomplete]:not([autocomplete=off]):not([autocomplete=on]),[contenteditable],[data-private],[data-trace-private],input:is([name*=pass i],[name*=token i],[name*=secret i],[name*=auth i],[name*=key i],[name*=session i],[name*=csrf i],[name*=card i],[name*=cvv i],[id*=pass i],[id*=token i],[id*=secret i],[id*=auth i],[id*=key i],[id*=session i],[id*=csrf i],[id*=card i],[id*=cvv i])' : 'input,textarea,select,[contenteditable],[data-private],[data-trace-private]';
  // Hide glyph overhang as well as masking boxes; screenshot-only styles preserve layout.
  const bytes = await page.screenshot({ type: 'png', mask: [page.locator(masks)], style: `:is(${masks}), :is(${masks}) * { visibility: hidden !important; }`, timeout: 1500 });
  return bytes.length > 1_000_000 ? 'Image exceeded 1 MB.' : bytes;
}

const bounded = async <T>(promise: Promise<T>, timeout: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out')), timeout); })]); }
  finally { clearTimeout(timer!); }
};
export interface CaptureOptions { url: string; project: string; store: Store; settings: Settings; limits?: Partial<Limits>; headless?: boolean; restrictToOrigin?: boolean }
export class Capture {
  readonly id = randomUUID();
  state: State = 'idle';
  browser?: Browser; context?: BrowserContext; page?: Page; incident?: Incident;
  recipe: Recipe = { schema: 1, status: 'unavailable', actions: [], reasons: ['Inspection only; no flow was run.'] };
  events: EvidenceEvent[] = []; images = new Map<string, Buffer>(); omissions = new Set<string>();
  bytes = 0; dropped = 0; observerMs = 0; saved = false;
  started = ''; stopped = ''; startedMono = 0; cpu = process.cpuUsage();
  readonly origin: string; readonly limits: Limits;
  readonly bridge = '__trace_' + randomUUID().replaceAll('-', '');
  readonly control = '__traceControl_' + randomUUID().replaceAll('-', '');
  private sequence = 0; private timer?: ReturnType<typeof setTimeout>;
  private inflight = new Map<Request, { id: string; start: number }>();
  private documentSeq = new Map<string, number>();
  private documentEnds = new Set<string>();
  private repeats = new Map<string, EvidenceEvent>();
  private stopPromise?: Promise<Incident>;
  constructor(readonly options: CaptureOptions) {
    this.origin = localUrl(options.url).origin;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const [key, value] of Object.entries(this.limits)) if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key as keyof Limits] * 10) throw new Error('Invalid resource limit.');
  }
  get active() { return this.state === 'recording' || this.state === 'finalizing'; }
  add(kind: string, data: Record<string, unknown>, meta: Partial<EvidenceEvent> = {}) {
    if (!this.active) return;
    const sanitized = sanitize(data);
    const size = Buffer.byteLength(JSON.stringify(sanitized)) + 200;
    if (this.events.length >= this.limits.events || this.bytes + size > this.limits.bytes) { this.dropped++; this.omissions.add('Resource limit reached; events were dropped.'); return; }
    const event: EvidenceEvent = { id: `e${++this.sequence}`, seq: this.sequence, session: this.id, at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - this.startedMono), kind, data: sanitized, ...meta };
    this.events.push(event); this.bytes += size;
    return event;
  }
  private own(request: Request) {
    try { return request.frame() === this.page?.mainFrame() && new URL(request.url()).origin === this.origin; } catch { return false; }
  }
  async start() {
    if (this.state !== 'idle') throw new Error('This recording has already started.');
    await this.options.store.init(this.options.project);
    this.started = new Date().toISOString(); this.startedMono = performance.now(); this.cpu = process.cpuUsage();
    await this.options.store.pending(this.id);
    this.state = 'recording';
    try {
      this.browser = await chromium.launch({ headless: this.options.headless ?? false, args: ['--window-position=540,0', '--window-size=1000,900'] });
      this.context = await this.browser.newContext({ viewport: { width: 1000, height: 760 }, acceptDownloads: false, serviceWorkers: this.options.restrictToOrigin ? 'block' : 'allow' });
      if (this.options.restrictToOrigin) await restrictBrowser(this.context, this.origin, () => { this.omissions.add('Outside-origin browser request blocked; dependent behavior remains unverified.'); });
      this.page = await this.context.newPage();
      const page = this.page;
      const cdp = await this.context.newCDPSession(page);
      const mainFrameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
      const contexts = new Set<number>();
      cdp.on('Runtime.executionContextCreated', ({ context }) => { if (context.origin === this.origin && context.auxData?.isDefault && context.auxData?.frameId === mainFrameId) contexts.add(context.id); });
      cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
      cdp.on('Runtime.executionContextsCleared', () => contexts.clear());
      cdp.on('Runtime.bindingCalled', ({ name, executionContextId, payload: serialized }) => {
        if (!this.active || name !== this.bridge || !contexts.has(executionContextId)) return;
        if (serialized.length > 12000) { this.omissions.add('Oversized page evidence rejected.'); return; }
        let payload: any; try { payload = JSON.parse(serialized); } catch { this.omissions.add('Malformed page evidence rejected.'); return; }
        if (!payload || typeof payload !== 'object' || JSON.stringify(payload).length > 12000 || !/^[a-f0-9-]{36}$/.test(payload.document) || !Number.isSafeInteger(payload.browserSeq) || typeof payload.kind !== 'string' || !['observation', 'document', 'document-end', 'checkpoint', 'visible-message'].includes(payload.kind)) { this.omissions.add('Invalid or oversized page evidence rejected.'); return; }
        if (!this.documentSeq.has(payload.document) && this.documentSeq.size >= this.limits.events) { this.omissions.add('Document limit reached.'); return; }
        const previous = this.documentSeq.get(payload.document) || 0;
        if (payload.browserSeq !== previous + 1) this.omissions.add('Missing, duplicate or out-of-order document events.');
        if (payload.browserSeq <= previous) return;
        this.documentSeq.set(payload.document, payload.browserSeq);
        if (payload.kind === 'document-end') this.documentEnds.add(payload.document);
        if (payload.data?.dropped > 0) this.omissions.add('Browser observer dropped events.');
        this.observerMs = Math.max(this.observerMs, Number(payload.observerMs) || 0);
        const data = payload.kind === 'document' ? { ...payload.data, url: safeUrl(page.url()) } : payload.data;
        this.add(payload.kind, data, { document: payload.document, browserSeq: payload.browserSeq, browserMs: payload.browserMs });
      });
      await cdp.send('Runtime.enable');
      await cdp.send('Runtime.addBinding', { name: this.bridge });
      cdp.on('Network.requestWillBeSent', event => {
        if (!this.active || event.frameId !== mainFrameId || new URL(event.request.url).origin !== this.origin) return;
        const frames = event.initiator.stack?.callFrames.slice(0, 5).filter(frame => frame.url.startsWith(this.origin + '/')) || [];
        if (!frames.length) return;
        const generated = frames.map(frame => ({ url: safeUrl(frame.url), line: frame.lineNumber + 1, column: frame.columnNumber + 1 }));
        this.add('request-initiator', { url: safeUrl(event.request.url), method: event.request.method, protocolRequest: event.requestId, locations: generated, note: 'Browser-reported initiator; not a root-cause diagnosis. URL/method association with Playwright events, not shared request identity.' });
      });
      await cdp.send('Network.enable');
      await page.addInitScript(observe, { bridge: this.bridge, control: this.control, origin: this.origin, ...this.options.settings });
      page.on('request', request => {
        if (!this.active || !this.own(request)) return;
        if (this.inflight.size >= this.limits.events) { this.omissions.add('In-flight request limit reached.'); return; }
        const redirected = request.redirectedFrom();
        const entry = { id: `r${this.events.length + 1}`, start: performance.now() };
        this.inflight.set(request, entry);
        this.add('request', { request: entry.id, method: request.method(), url: safeUrl(request.url()), type: request.resourceType(), redirectedFrom: redirected ? this.inflight.get(redirected)?.id || 'previous request' : undefined });
      });
      page.on('response', response => {
        const request = response.request(), entry = this.inflight.get(request);
        if (!this.active || !entry) return;
        this.add('response', { request: entry.id, method: request.method(), url: safeUrl(response.url()), status: response.status(), httpError: response.status() >= 400, responseMs: Math.round(performance.now() - entry.start), serviceWorker: response.fromServiceWorker() });
      });
      page.on('requestfinished', request => {
        const entry = this.inflight.get(request); if (!entry) return;
        this.add('request-end', { request: entry.id, totalMs: Math.round(performance.now() - entry.start) }); this.inflight.delete(request);
      });
      page.on('requestfailed', request => {
        const entry = this.inflight.get(request); if (!entry) return;
        this.add('transport-failure', { request: entry.id, url: safeUrl(request.url()), failure: redact(request.failure()?.errorText || 'Unknown failure'), cancelled: /ABORTED/.test(request.failure()?.errorText || '') }); this.inflight.delete(request);
      });
      cdp.on('Runtime.consoleAPICalled', message => {
        if (!this.active || !contexts.has(message.executionContextId) || !['warning', 'error'].includes(message.type)) return;
        const frame = message.stackTrace?.callFrames[0];
        const text = message.args.map(arg => ['string', 'number', 'boolean'].includes(arg.type) ? String(arg.value) : '[object omitted]').join(' ');
        const data = { level: message.type, message: this.options.settings.messages ? redact(text) : '[message text omitted]', location: { url: safeUrl(frame?.url || ''), line: (frame?.lineNumber ?? 0) + 1, column: (frame?.columnNumber ?? 0) + 1 }, count: 1, lastElapsedMs: Math.round(performance.now() - this.startedMono) };
        const key = JSON.stringify({ ...data, lastElapsedMs: 0 });
        const previous = this.repeats.get(key);
        if (previous) { previous.data.count++; previous.data.lastElapsedMs = data.lastElapsedMs; }
        else { const event = this.add('console', data); if (event) this.repeats.set(key, event); }
      });
      cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: detail }) => {
        if (!this.active || !contexts.has(detail.executionContextId || -1)) return;
        this.add('runtime-error', { type: detail.text.includes('promise') ? 'unhandled rejection' : 'uncaught exception', message: this.options.settings.messages ? redact(detail.exception?.description || detail.text, 1800) : '[message text omitted]', location: { url: safeUrl(detail.url || ''), line: detail.lineNumber + 1, column: detail.columnNumber + 1 } });
      });
      page.on('framenavigated', frame => { if (!this.active) return; if (frame === page.mainFrame() && new URL(frame.url()).origin !== this.origin) this.omissions.add('Selected tab left the approved origin; outside-origin evidence omitted.'); });
      page.on('frameattached', () => { this.add('unsupported', { reason: 'Subframes are outside supported interaction capture.' }); });
      page.on('websocket', () => { this.add('limitation', { reason: 'WebSocket frames are not captured.' }); });
      page.on('dialog', dialog => { this.add('unsupported', { reason: `Browser ${dialog.type()} dialog needs manual handling.` }); });
      page.on('crash', () => { this.omissions.add('Application tab crashed.'); void this.stop().catch(() => {}); });
      page.on('close', () => { if (this.state === 'recording') { this.omissions.add('Application tab closed before Stop.'); void this.stop().catch(() => {}); } });
      this.context.on('page', other => { if (other !== page) this.add('unsupported', { reason: 'A new tab opened; only the originally selected tab is recorded.' }); });
      this.context.on('serviceworker', () => this.add('limitation', { reason: 'Service-worker-owned requests may be unavailable.' }));
      this.browser.on('disconnected', () => { if (this.state === 'recording') { this.omissions.add('Browser connection lost.'); void this.stop().catch(() => {}); } });
      this.timer = setTimeout(() => { this.omissions.add('Recording duration limit reached.'); void this.stop().catch(() => {}); }, this.limits.durationMs);
      await page.goto(this.options.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      return this;
    } catch (error) { this.omissions.add('Browser launch or initial navigation failed.'); await this.stop().catch(() => {}); throw error; }
  }
  private async signal(command: string) {
    if (!this.page || this.page.isClosed() || new URL(this.page.url()).origin !== this.origin) throw new Error('Selected document unavailable.');
    return bounded(this.page.evaluate(({ control, command }) => { const fn = (window as any)[control]; if (!fn) throw new Error('Observer missing'); return fn(command); }, { control: this.control, command }), 1500);
  }
  async mark(screenshot = false, label = 'Scenario checkpoint') {
    if (this.state !== 'recording') throw new Error('Mark requires an active recording.');
    await this.signal('snapshot'); this.add('marker', { label });
    if (!screenshot) return;
    if (!this.options.settings.screenshots) throw new Error('Screenshots were not enabled for this recording.');
    if (this.images.size >= this.limits.screenshots) { this.omissions.add('Screenshot limit reached.'); return; }
    const bytes = await maskedScreenshot(this.page!, this.options.settings.values);
    if (typeof bytes === 'string') { this.add('image-omitted', { reason: bytes }); return; }
    const name = `image-${this.images.size + 1}.png`; this.images.set(name, bytes); this.add('image', { artifact: name, label, warning: 'Known sensitive regions masked; other visible personal data may remain.' });
  }
  async stop(expected = ''): Promise<Incident> {
    if (this.stopPromise) return this.stopPromise;
    if (this.saved) return this.incident!;
    this.stopPromise = this.finalize(expected);
    try { return await this.stopPromise; } finally { this.stopPromise = undefined; }
  }
  private async finalize(expected: string): Promise<Incident> {
    clearTimeout(this.timer); this.state = 'finalizing';
    if (!this.incident) {
      try { await this.signal('stop'); } catch { this.omissions.add('Final document flush unavailable or timed out.'); }
      for (const { id } of this.inflight.values()) this.add('unfinished-request', { request: id, reason: 'Still in flight at Stop; no outcome inferred.' });
      this.stopped = new Date().toISOString();
      const documents = [...this.documentSeq.keys()];
      for (const doc of documents.slice(0, -1)) if (!this.documentEnds.has(doc)) this.omissions.add('A prior document did not acknowledge its final events.');
      const cpu = process.cpuUsage(this.cpu);
      const manifest = {
        schema: SCHEMA, tool: 'TRACE local experiment', version: VERSION, id: this.id, origin: this.origin, startUrl: safeUrl(this.options.url), project: await fs.realpath(this.options.project), projectIdentity: hash(await fs.realpath(this.options.project)),
        startedAt: this.started, stoppedAt: this.stopped, durationMs: Math.round(performance.now() - this.startedMono), settings: this.options.settings, limits: this.limits,
        completeness: this.omissions.size ? 'incomplete' as const : 'complete within supported scope' as const, omissions: [...this.omissions], expected: redact(expected, 500),
        environment: { node: process.version, platform: process.platform, browser: `Chromium ${this.browser?.version() || 'unavailable'}`, transport: 'separate Playwright context; no original profile', clocks: 'elapsedMs is Node receipt time; browserMs is per-document performance time, not synchronized' },
        counts: { events: this.events.length, bytes: Buffer.byteLength(this.events.map(e => JSON.stringify(e)).join('\n') + '\n'), dropped: this.dropped },
        measurements: { cpuMs: (cpu.user + cpu.system) / 1000, nodeRssBytes: process.memoryUsage().rss, observerMs: this.observerMs },
        serverEvidence: 'not captured by helper; use authorized host tools when needed', attachments: [...this.images.keys()]
      };
      this.incident = { manifest, events: this.events, recipe: this.recipe, brief: makeBrief({ manifest, events: this.events, recipe: this.recipe }) };
    }
    await this.browser?.close().catch(() => {});
    try { await this.options.store.save(this.incident, this.images); this.saved = true; }
    catch { this.state = 'incomplete'; throw new Error('Incident could not be saved. Free space/check the store and retry Stop; evidence is still in memory.'); }
    this.state = this.incident.manifest.completeness === 'incomplete' ? 'incomplete' : 'complete';
    return this.incident;
  }
}
