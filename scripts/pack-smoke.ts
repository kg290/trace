import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { adversarialApp } from '../tests/fixtures.js';

const started = performance.now(), source = process.cwd(), root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'trace-packed-'));
const npm = process.env.npm_execpath; assert(npm, 'Run through npm run pack:smoke.');
const installation = path.join(root, 'installation'), project = path.join(root, 'project'), store = path.join(root, 'incidents');
async function command(args: string[], expectedCode = 0) {
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: source, env: process.env, windowsHide: true, shell: false });
    let stdout = '', stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, expectedCode, result.stderr + result.stdout); return result.stdout;
}
await command([npm, 'run', 'build']);
// Reuse the cache npm ci filled (npm's own, unless npm_config_cache overrides it); packuments still revalidate online.
const cache = path.resolve(process.env.npm_config_cache || (await command([npm, 'config', 'get', 'cache'])).trim());
const packed = JSON.parse(await command([npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', root]))[0];
const tarball = path.join(root, packed.filename);
await command([npm, 'install', '--prefix', installation, tarball, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache]);
const packageRoot = path.join(installation, 'node_modules/trace-local-experiment'), cli = path.join(packageRoot, 'dist/cli.js');
await fs.cp('examples/number-kit', project, { recursive: true });
const common = ['--project', project, '--store', store];
await command([cli, '--version']); await fs.stat(path.join(packageRoot, 'install.mjs'));
const skill = (await command([cli, 'install-skill', ...common])).trim();
assert.match(await fs.readFile(path.join(skill, 'SKILL.md'), 'utf8'), /no arguments required/);
const claudeSkill = (await command([cli, 'install-skill', ...common, '--agent', 'claude'])).trim();
assert((await fs.readFile(path.join(skill, 'runtime.json'), 'utf8')).includes('browserPath'));
const app = await adversarialApp();
try {
  const flow = path.join(root, 'flow.json'); await fs.writeFile(flow, JSON.stringify({ schema: 1, testData: true, expected: 'Search keeps the entered term and submits exactly once.', actions: [
    { event: 'one', action: 'fill', locator: { by: 'label', value: 'Search' }, value: 'example' },
    { event: 'two', action: 'press', locator: { by: 'label', value: 'Search' }, value: 'Enter' }
  ] }));
  const capture = JSON.parse(await command([cli, 'run', ...common, '--url', app.origin, '--file', flow, '--share-with-current-agent', '--allow-local-side-effects']));
  assert.equal(capture.status, 'complete within supported scope'); assert.equal(capture.images.length, 3);
  assert.match(await command([cli, 'incident', capture.id, ...common]), /Approved images/);
  const oracle = path.join(root, 'oracle.json'); await fs.writeFile(oracle, JSON.stringify({ schema: 1, origin: app.origin, prerequisites: 'Owned local fixture; synthetic inputs.', checks: [
    { kind: 'value', phase: 'after actions', locator: { by: 'label', value: 'Search' }, equals: 'example' },
    { kind: 'text', phase: 'after actions', locator: { by: 'id', value: 'status' }, equals: 'Submitted' }
  ] }));
  const sha = (await command([cli, 'oracle', capture.id, ...common, '--file', oracle])).trim();
  const verified = JSON.parse(await command([cli, 'verify', capture.id, ...common, '--url', app.origin, '--oracle-sha', sha, '--allow-local-side-effects'], 2));
  // No failing baseline exists for this healthy fixture, so a pass is not a verified fix.
  assert.equal(verified.status, 'could not reproduce');
  const planFile = path.join(root, 'plan.json'); await fs.writeFile(planFile, JSON.stringify({ schema: 1, scope: 'Packed public library adapter', effects: 'read-only', checks: [
    { id: 'sum', title: 'Sum zero and negative inputs', expected: '-3', basis: { kind: 'documentation', file: 'README.md', text: '`total(values)` returns the numeric sum, including zero and negative numbers.' }, kind: 'node-library', entry: 'index.mjs', exported: 'total', args: [[0, -5, 2]], equals: -3 }
  ] }));
  const plan = JSON.parse(await command([cli, 'plan', ...common, '--file', planFile]));
  const checked = JSON.parse(await command([cli, 'check', plan.id, ...common, '--plan-sha', plan.digest, '--allow-local-execution'])); assert.equal(checked.results[0].status, 'passed');
  await command([cli, 'revoke', capture.id, ...common]); await command([cli, 'incident', capture.id, ...common], 1);
  await command([cli, 'delete', capture.id, ...common]); await assert.rejects(fs.stat(path.join(store, capture.id)));
  await command([cli, 'uninstall-skill', ...common]); await assert.rejects(fs.stat(skill));
  await command([cli, 'uninstall-skill', ...common, '--agent', 'claude']); await assert.rejects(fs.stat(claudeSkill));
  await command([npm, 'uninstall', '--prefix', installation, 'trace-local-experiment', '--ignore-scripts', '--no-audit', '--cache', cache]);
  await assert.rejects(fs.stat(cli)); assert.match(await fs.readFile(path.join(project, 'README.md'), 'utf8'), /Number Kit/);
  const report = { at: new Date().toISOString(), status: 'passed', elapsedMs: performance.now() - started, tarball, packageBytes: packed.size, unpackedBytes: packed.unpackedSize, packageFiles: packed.entryCount, checks: ['clean runtime-only install, cache first', 'Codex and Claude skill/runtime paths', 'packed screenshot/action capture', 'approved incident', 'frozen behavior verification', 'packed library probe', 'revocation/deletion', 'both skill removals and package uninstall preserve project files'], limits: ['Windows and pinned Chromium only.', 'Host invocation is qualified separately.', 'Package is local and private; no registry publication.'] };
  await fs.mkdir('.test-output/evidence', { recursive: true });
  await fs.writeFile('.test-output/evidence/pack-smoke.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { await app.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 5 }); }
