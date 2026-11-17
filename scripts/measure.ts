import { performance } from 'node:perf_hooks';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { Capture } from '../dist/capture.js';
import { Store, json } from '../dist/store.js';
import { adversarialApp } from '../tests/fixtures.js';

const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'trace-measure-')), app = await adversarialApp();
const samples: any[] = [];
try {
  for (let repeat = 0; repeat < 5; repeat++) for (const mode of ['off', 'events', 'events-and-images']) {
    const begin = performance.now();
    const capture = mode === 'off' ? undefined : new Capture({ project: process.cwd(), url: app.origin, store: new Store(path.join(root, 'incidents')), settings: { values: true, messages: true, screenshots: mode === 'events-and-images' }, headless: true, limits: { screenshots: 6 } });
    const browser = capture ? (await capture.start()).browser! : await chromium.launch();
    const page = capture?.page || await browser.newPage(); if (!capture) await page.goto(app.origin);
    const setupMs = performance.now() - begin;
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const before = await cdp.send('Performance.getMetrics'); const cpu = process.cpuUsage(), actionStart = performance.now();
    for (let i = 0; i < 5; i++) { await page.getByLabel('Ordinary input').fill(`sample ${i}`); await page.getByLabel('Choice').selectOption(i % 2 ? 'A' : 'B'); await page.getByLabel('Enabled').setChecked(i % 2 === 0); if (mode === 'events-and-images') await capture!.mark(true); }
    const actionMs = performance.now() - actionStart, used = process.cpuUsage(cpu), after = await cdp.send('Performance.getMetrics');
    const metric = (list: typeof after.metrics, name: string) => list.find(m => m.name === name)?.value || 0;
    const incident = await capture?.stop();
    samples.push({ repeat, mode, setupMs, actionMs, nodeCpuMs: (used.user + used.system) / 1000, rendererTaskMs: (metric(after.metrics, 'TaskDuration') - metric(before.metrics, 'TaskDuration')) * 1000, rendererJsHeapBytes: metric(after.metrics, 'JSHeapUsedSize'), nodeRssBytes: process.memoryUsage().rss, events: incident?.events.length || 0, eventBytes: incident?.manifest.counts.bytes || 0, imageBytes: capture ? [...capture.images.values()].reduce((n, image) => n + image.length, 0) : 0 });
    await browser.close();
  }
  const summary = Object.fromEntries(['off', 'events', 'events-and-images'].map(mode => { const values = samples.filter(s => s.mode === mode).map(s => s.actionMs).sort((a, b) => a - b); return [mode, { medianActionMs: values[2], minActionMs: values[0], maxActionMs: values[4] }]; }));
  const report = { date: '2026-11-17', environment: { node: process.version, platform: process.platform, playwright: '1.65.1' }, method: 'Five sequential repeats per mode; 15 ordinary DOM actions per sample. Image mode deliberately captures five screenshots. Setup is separate; no model calls. This measures synthetic capture overhead, not debugging productivity.', samples, summary, modelUsage: 'unknown for the development conversation; no additional model benchmark launched', billing: 'unknown', limitations: ['Renderer TaskDuration is not whole-browser CPU.', 'JS heap and Node RSS are not total browser memory.', 'Fixed mode order, small owned fixture, one machine; no universal savings conclusion.'] };
  await fs.mkdir('.test-output/evidence', { recursive: true });
  await fs.writeFile('.test-output/evidence/overhead.json', json(report)); console.log(json(summary));
} finally { await app.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
