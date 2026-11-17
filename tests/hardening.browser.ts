import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { Capture } from '../dist/capture.js';
import { Store } from '../dist/store.js';
import { automatic } from '../dist/automatic.js';
import { freezeOracle, verify } from '../dist/verify.js';
import { adversarialApp, tempRoot } from './fixtures.js';

test('automatic browser scope blocks a second owned origin before its endpoint executes', async t => {
  const root = await tempRoot(t, 'egress'), app = await adversarialApp(), outside = await adversarialApp();
  const capture = new Capture({ project: process.cwd(), url: app.origin, store: new Store(path.join(root, 'incidents')), settings: { values: false, messages: false, screenshots: false }, restrictToOrigin: true, headless: true });
  try {
    await capture.start(); const count = outside.seen.length;
    await capture.page!.evaluate(async url => { await fetch(url, { method: 'POST' }).catch(() => {}); }, outside.origin + '/status/200');
    assert.equal(outside.seen.length, count); const incident = await capture.stop();
    assert.equal(incident.manifest.completeness, 'incomplete'); assert(incident.manifest.omissions.some(s => s.includes('Outside-origin')));
  } finally { await capture.browser?.close(); await app.close(); await outside.close(); }
});

test('a failing flow step is named with its reason, and layout measurements are returned', async t => {
  const root = await tempRoot(t, 'flow-failure'), app = await adversarialApp();
  try {
    const result: any = await automatic({ project: process.cwd(), url: app.origin, store: new Store(path.join(root, 'incidents')), shareWithCurrentAgent: true, allowLocalSideEffects: true, flow: { schema: 1, expected: 'Search, then save.', testData: true, actions: [
      { event: 'one', action: 'fill', locator: { by: 'label', value: 'Search' }, value: 'example' },
      { event: 'two', action: 'click', locator: { by: 'role', role: 'button', value: 'Missing button' } }
    ] } });
    assert.equal(result.status, 'incomplete');
    const note = result.omissions.find((s: string) => s.startsWith('Step 2 (click'));
    assert(note, JSON.stringify(result.omissions)); assert(!/\x1b|\[3\dm/.test(note));
    assert.equal(result.layout.initial.viewport.width, 1000); assert.equal(result.layout.initial.horizontalOverflow, false);
    assert(result.controls.some((c: any) => c.label === 'Search' && c.box.width > 0));
    assert.equal(result.layout.final, undefined);
  } finally { await app.close(); }
});

test('network statuses, redirects, transport failure, cancellation and in-flight requests remain distinct; secrets stay out', async t => {
  const root = await tempRoot(t, 'network'), app = await adversarialApp();
  const store = new Store(path.join(root, 'incidents'));
  const capture = new Capture({ project: process.cwd(), url: app.origin, store, settings: { values: false, messages: false, screenshots: false }, headless: true });
  try {
    await capture.start(); const page = capture.page!;
    await page.getByLabel('Ordinary input').fill('ordinary-secret-value'); await page.getByLabel('Password', { exact: true }).fill('password-secret-value');
    await page.getByLabel('Choice').selectOption('B'); await page.getByLabel('Enabled').check();
    await page.getByRole('button', { name: 'Run network cases' }).click(); await expect(page.getByRole('status')).toHaveText('Network complete');
    await expect.poll(() => capture.events.filter(e => e.kind === 'transport-failure').length).toBeGreaterThanOrEqual(2);
    const start = Date.now(), incident = await capture.stop(); assert(Date.now() - start < 4000);
    for (const code of [422, 403, 500, 302, 200]) assert(incident.events.some(e => e.kind === 'response' && e.data.status === code));
    assert(incident.events.some(e => e.kind === 'transport-failure' && e.data.cancelled));
    assert(incident.events.some(e => e.kind === 'transport-failure' && !e.data.cancelled));
    assert(incident.events.some(e => e.kind === 'unfinished-request'));
    assert(incident.events.some(e => e.kind === 'request' && e.data.redirectedFrom));
    assert(app.seen.some(r => r.body.includes('body-secret-value')), 'Instrumentation did not alter the real body');
    const serialized = JSON.stringify(incident);
    for (const secret of ['ordinary-secret-value', 'password-secret-value', 'header-secret-value', 'body-secret-value', 'response-secret-value', 'url-secret-value', 'large-body-secret', 'hidden-secret-value']) assert(!serialized.includes(secret), secret);
    assert.equal(incident.recipe.status, 'unavailable');
  } finally { await capture.browser?.close(); await app.close(); }
});
test('runtime observation leaves errors/rejections/getters alone; screenshots mask private regions', async t => {
  const root = await tempRoot(t, 'runtime'), app = await adversarialApp();
  const store = new Store(path.join(root, 'incidents'));
  const capture = new Capture({ project: process.cwd(), url: app.origin, store, settings: { values: true, messages: true, screenshots: true }, headless: true });
  try {
    await capture.start(); const page = capture.page!; let errors = 0; page.on('pageerror', () => errors++);
    await page.getByRole('button', { name: 'Run runtime cases' }).click(); await expect.poll(() => errors).toBe(2);
    assert.equal(await page.evaluate(() => (window as any).getterCount), 0);
    await capture.mark(true); await page.locator('#private').evaluate(e => { e.textContent = 'another-private-value'; }); await capture.mark(true);
    // Only the private element's area (plus a margin) must be identical; Linux font antialiasing elsewhere may differ by a pixel.
    const box = (await page.locator('#private').boundingBox())!;
    const different = await page.evaluate(async ([a, b, box]) => {
      const arrays = [];
      for (const data of [a, b] as string[]) { const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob()); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); arrays.push(context.getImageData(0, 0, bitmap.width, bitmap.height).data); }
      const { x: bx, y: by, width, height } = box as { x: number; y: number; width: number; height: number }, margin = 4;
      const differences = []; for (let i = 0; i < arrays[0].length; i++) {
        const x = Math.floor(i / 4) % 1000, y = Math.floor(i / 4000);
        if (x >= bx - margin && x <= bx + width + margin && y >= by - margin && y <= by + height + margin && arrays[0][i] !== arrays[1][i] && differences.length < 20) differences.push({ x, y, a: arrays[0][i], b: arrays[1][i] });
      }
      return differences;
    }, [capture.images.get('image-1.png')!.toString('base64'), capture.images.get('image-2.png')!.toString('base64'), box] as const);
    assert.deepEqual(different, [], 'Private pixels should be masked consistently');
    await page.getByRole('button', { name: 'Unsupported controls' }).click(); await expect(page.locator('iframe')).toHaveCount(1);
    await capture.mark(true);
    const incident = await capture.stop();
    assert.equal(incident.events.filter(e => e.kind === 'runtime-error').length, 2);
    assert(incident.events.some(e => e.kind === 'console' && e.data.message === 'Repeated error' && e.data.count === 2));
    assert(incident.events.some(e => e.kind === 'unsupported'));
    assert(incident.events.some(e => e.kind === 'image-omitted'));
    for (const secret of ['log-secret-value', 'getter-secret-value', 'private-visible-value', 'another-private-value', 'outside-frame-secret']) assert(!JSON.stringify(incident).includes(secret), secret);
    await store.approve(capture.id, false);
    const approved = await store.read(capture.id); assert.equal(approved.manifest.attachments.length, 0);
    await fs.appendFile(path.join(store.dir(capture.id), 'approved', 'events.jsonl'), '{}\n');
    await assert.rejects(store.read(capture.id), /integrity/);
    await store.revoke(capture.id); await assert.rejects(store.read(capture.id), /revoked/);
  } finally { await capture.browser?.close(); await app.close(); }
});
test('limits, simulated disk failure/retry and browser loss are honest', async t => {
  const root = await tempRoot(t, 'lifecycle'), app = await adversarialApp();
  const store = new Store(path.join(root, 'incidents'));
  try {
    const capture = new Capture({ project: process.cwd(), url: app.origin, store, settings: { values: true, messages: true, screenshots: false }, headless: true });
    await capture.start(); await capture.page!.getByLabel('Ordinary input').fill('Retained after retry'); await capture.mark();
    const save = store.save.bind(store); store.save = async () => { throw new Error('simulated ENOSPC'); };
    await assert.rejects(capture.stop(), /could not be saved/); assert.equal(capture.state, 'incomplete'); assert.equal(capture.saved, false);
    store.save = save; const incident = await capture.stop(); assert.equal(incident.manifest.completeness, 'complete within supported scope');
    assert(incident.events.some(e => e.kind === 'observation' && e.data.controls.some((c: any) => c.value === 'Retained after retry')));
    const limited = new Capture({ project: process.cwd(), url: app.origin, store, settings: { values: false, messages: false, screenshots: false }, limits: { events: 2 }, headless: true });
    await limited.start(); const capped = await limited.stop(); assert.equal(capped.manifest.completeness, 'incomplete'); assert(capped.manifest.counts.dropped > 0);
    const lost = new Capture({ project: process.cwd(), url: app.origin, store, settings: { values: false, messages: false, screenshots: false }, headless: true });
    await lost.start(); await lost.browser!.close(); await expect.poll(() => lost.saved).toBe(true); assert.equal(lost.incident!.manifest.completeness, 'incomplete');
  } finally { await app.close(); }
});
test('frozen-oracle changes and missing authorization cannot launch verification', async t => {
  const root = await tempRoot(t, 'oracle'), app = await adversarialApp();
  const store = new Store(path.join(root, 'incidents'));
  try {
    const run: any = await automatic({ project: process.cwd(), url: app.origin, store, shareWithCurrentAgent: true, allowLocalSideEffects: true, flow: { schema: 1, expected: 'The input keeps its value.', testData: true, actions: [{ event: 'one', action: 'fill', locator: { by: 'label', value: 'Ordinary input' }, value: 'example' }] } });
    const sha = await freezeOracle(store, run.id, { schema: 1, origin: app.origin, prerequisites: 'Owned fixture.', checks: [{ kind: 'value', phase: 'after actions', locator: { by: 'label', value: 'Ordinary input' }, equals: 'example' }] });
    const base = { project: process.cwd(), url: app.origin, oracleSha: sha, allowLocalSideEffects: true };
    await assert.rejects(verify(store, run.id, { ...base, allowLocalSideEffects: false }), /separate/);
    await assert.rejects(verify(store, run.id, { ...base, oracleSha: 'changed' }), /changed/);
    await assert.rejects(verify(store, run.id, { ...base, url: 'http://127.0.0.1:1' }), /does not match/);
  } finally { await app.close(); }
});
