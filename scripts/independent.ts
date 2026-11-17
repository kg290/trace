import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { profileApp } from '../examples/profile/server.js';

const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'trace-independent-'));
const app = await profileApp({ data: path.join(root, 'profile.json'), variant: 'working' });
try {
  const cli = path.join(path.dirname(createRequire(import.meta.url).resolve('@playwright/test/package.json')), 'cli.js');
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'test'], { env: { ...process.env, PROFILE_URL: app.origin }, windowsHide: true });
    let output = ''; child.stdout.on('data', data => { output += data; process.stdout.write(data); }); child.stderr.on('data', data => { output += data; process.stderr.write(data); });
    child.on('error', reject); child.on('close', code => resolve({ code, output }));
  });
  await fs.mkdir('.test-output/evidence', { recursive: true });
  await fs.writeFile('.test-output/evidence/independent.json', JSON.stringify({ ...result, at: new Date().toISOString(), fixture: 'Working profile app; test imports only Playwright, no TRACE modules.' }, null, 2) + '\n');
  assert.equal(result.code, 0);
} finally { await app.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
