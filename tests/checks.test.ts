import { test } from 'node:test';
import { tempRoot } from './fixtures.js';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { freezeCheckPlan, executeChecks } from '../dist/checks.js';
import { Store, json } from '../dist/store.js';
import type { CheckPlan } from '../src/checks.js';

test('split UTF-8 chunks retain exact CLI and HTTP contract values', async t => {
  const root = await tempRoot(t, 'utf8'), project = path.join(root, 'project'); await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'cli.mjs'), "const bytes = Buffer.from('🐛\\n'); process.stdout.write(bytes.subarray(0, 1)); setTimeout(() => process.stdout.write(bytes.subarray(1)), 20);");
  const server = createServer((_req, res) => { const bytes = Buffer.from(JSON.stringify({ value: '🐛' })); res.setHeader('Content-Type', 'application/json'); res.write(bytes.subarray(0, 11)); setTimeout(() => res.end(bytes.subarray(11)), 20); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, store = new Store(path.join(root, 'evidence'));
  const basis = { kind: 'requirement' as const, text: 'Preserve the complete Unicode result.' };
  try {
    const frozen = await freezeCheckPlan(store, project, { schema: 1, scope: 'Chunk boundaries', effects: 'read-only', checks: [
      { id: 'cli', kind: 'node-cli', title: 'Read split CLI output', expected: 'One bug emoji and a newline.', basis, entry: 'cli.mjs', args: [], exitCode: 0, stdout: '🐛\n' },
      { id: 'http', kind: 'http', title: 'Read split JSON response', expected: 'The complete bug emoji.', basis, url: origin, method: 'GET', status: 200, jsonEquals: { value: '🐛' } }
    ] });
    const result = await executeChecks(store, frozen.id, { project, planSha: frozen.digest, allowLocalExecution: true, allowLocalSideEffects: false });
    assert(result.results.every(r => r.status === 'passed'));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('bounded library evidence cannot weaken the comparison of a long result', async t => {
  const root = await tempRoot(t, 'probe'), project = path.join(root, 'project'); await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'index.mjs'), "export function value() { return 'x'.repeat(1400); }");
  const store = new Store(path.join(root, 'evidence'));
  const frozen = await freezeCheckPlan(store, project, { schema: 1, scope: 'Full result equality', effects: 'read-only', checks: [{ id: 'exact', title: 'Return exactly the expected string', expected: 'Exactly 1000 x characters.', basis: { kind: 'requirement', text: 'The entire result must match, not its truncated evidence.' }, kind: 'node-library', entry: 'index.mjs', exported: 'value', args: [], equals: 'x'.repeat(1000) }] });
  const result = await executeChecks(store, frozen.id, { project, planSha: frozen.digest, allowLocalExecution: true, allowLocalSideEffects: false });
  assert.equal(result.results[0].status, 'confirmed defect'); assert.equal(result.results[0].observed.matches, false);
});

test('Node CLI/library adapters preserve failing criteria and detect fixes, errors and unsupported integrations', async t => {
  const root = await tempRoot(t, 'checks'), project = path.join(root, 'project');
  await fs.cp('examples/number-kit', project, { recursive: true });
  const good = await fs.readFile(path.join(project, 'index.mjs'), 'utf8');
  await fs.writeFile(path.join(project, 'index.mjs'), good.replace('sum + value', 'sum + value + 1'));
  const store = new Store(path.join(root, 'evidence'));
  const basis = { kind: 'documentation' as const, file: 'README.md', text: '`total(values)` returns the numeric sum, including zero and negative numbers.' };
  const plan: CheckPlan = { schema: 1, scope: 'Number Kit public library and CLI contracts', effects: 'read-only', checks: [
    { id: 'cli-sum', kind: 'node-cli', title: 'Add two CLI arguments', expected: 'Print 5 and exit 0.', basis, entry: 'cli.mjs', args: ['2', '3'], exitCode: 0, stdout: '5\n' },
    { id: 'library-zero', kind: 'node-library', title: 'Include zero and a negative number', expected: 'Sum is -3.', basis, entry: 'index.mjs', exported: 'total', args: [[0, -5, 2]], equals: -3 },
    { id: 'cli-invalid', kind: 'node-cli', title: 'Reject a nonnumeric argument', expected: 'Exit 2 and no stdout.', basis: { kind: 'documentation', file: 'README.md', text: 'Invalid numeric arguments print `Use finite numbers.` to stderr and exit 2.' }, entry: 'cli.mjs', args: ['bad'], exitCode: 2, stdout: '' },
    { id: 'library-invalid', kind: 'node-library', title: 'Reject a nonnumeric value', expected: 'Throws "Use finite numbers."', basis: { kind: 'requirement', text: 'Invalid input is rejected with a clear error.' }, entry: 'index.mjs', exported: 'total', args: [['x']], throws: 'Use finite numbers.' },
    { id: 'native', kind: 'desktop', title: 'Native window inspection', expected: 'Native integration available.', basis: { kind: 'requirement', text: 'Test the support boundary.' }, integration: 'unconfigured' },
    { id: 'ambiguous', kind: 'node-library', title: 'Unspecified rounding', expected: 'Round to an integer.', basis: { kind: 'inferred', text: 'No documented rounding contract exists.' }, entry: 'index.mjs', exported: 'total', args: [[0.5]], equals: 1 }
  ] };
  const frozen = await freezeCheckPlan(store, project, plan);
  const options = { project, planSha: frozen.digest, allowLocalExecution: true, allowLocalSideEffects: false };
  const before = await executeChecks(store, frozen.id, options);
  assert.deepEqual(before.results.map(r => r.status), ['confirmed defect', 'confirmed defect', 'passed', 'passed', 'unsupported', 'needs review']);
  assert.equal(before.role, 'baseline');
  await fs.writeFile(path.join(project, 'index.mjs'), good);
  const after = await executeChecks(store, frozen.id, options);
  assert.deepEqual(after.results.map(r => r.status), ['verified fix', 'verified fix', 'passed', 'passed', 'unsupported', 'needs review']);
  assert.equal(after.role, 'repeat'); assert.equal(after.history.priorRuns, 1); assert.equal(after.results[0].baseline, 'confirmed defect');
  assert.equal(after.planSha, before.planSha);
  await fs.writeFile(path.join(project, 'index.mjs'), good.replace('Use finite numbers.', 'Bad input.'));
  assert.equal((await executeChecks(store, frozen.id, options)).results[3].status, 'regression');
  await assert.rejects(executeChecks(store, frozen.id, { ...options, planSha: 'weakened' }), /changed/);
  await assert.rejects(executeChecks(store, frozen.id, { ...options, allowLocalExecution: false }), /allow-local-execution/);
  const file = path.join(store.dir(frozen.id), 'check-plan.json'); const modified = JSON.parse(await fs.readFile(file, 'utf8')); modified.plan.checks[0].stdout = 'anything'; await fs.writeFile(file, json(modified));
  await assert.rejects(executeChecks(store, frozen.id, options), /changed/);
  await fs.mkdir('.test-output/evidence', { recursive: true }); await fs.writeFile('.test-output/evidence/nonvisual-results.json', json({ before, after, note: 'Deterministic adapter qualification; source correction performed by the test. Not a productivity comparison.' }));
});
test('CLI generated files must be regenerated with the exact content; a stale file cannot pass', async t => {
  const root = await tempRoot(t, 'files'), project = path.join(root, 'project'); await fs.mkdir(project);
  const cli = (content: string) => fs.writeFile(path.join(project, 'report.mjs'), content);
  await cli("import { writeFileSync } from 'node:fs'; writeFileSync('out/report.txt', 'total=3\\n');");
  await fs.mkdir(path.join(project, 'out'));
  const store = new Store(path.join(root, 'evidence'));
  const frozen = await freezeCheckPlan(store, project, { schema: 1, scope: 'Report generation', effects: 'local-test-data', checks: [
    { id: 'report', kind: 'node-cli', title: 'Write the report file', expected: 'out/report.txt contains total=5.', basis: { kind: 'requirement', text: 'The report states the total.' }, entry: 'report.mjs', args: [], exitCode: 0, stdout: '', files: { 'out/report.txt': 'total=5\n' } }
  ] });
  const options = { project, planSha: frozen.digest, allowLocalExecution: true, allowLocalSideEffects: true };
  await assert.rejects(executeChecks(store, frozen.id, { ...options, allowLocalSideEffects: false }), /test-data/);
  const before = await executeChecks(store, frozen.id, options);
  assert.equal(before.results[0].status, 'confirmed defect'); assert.equal(before.results[0].observed.files['out/report.txt'].content, 'total=3\n');
  await fs.writeFile(path.join(project, 'out/report.txt'), 'total=5\n'); await cli('');
  const stale = await executeChecks(store, frozen.id, options);
  assert.equal(stale.results[0].status, 'still failing'); assert.equal(stale.results[0].observed.files['out/report.txt'].regenerated, false);
  await cli("import { writeFileSync } from 'node:fs'; writeFileSync('out/report.txt', 'total=5\\n');");
  assert.equal((await executeChecks(store, frozen.id, options)).results[0].status, 'verified fix');
  await assert.rejects(freezeCheckPlan(store, project, { schema: 1, scope: 'Escape', effects: 'local-test-data', checks: [
    { id: 'escape', kind: 'node-cli', title: 'Outside file', expected: 'Refused.', basis: { kind: 'requirement', text: 'Stay in the project.' }, entry: 'report.mjs', args: [], exitCode: 0, stdout: '', files: { '../outside.txt': 'x' } }
  ] }), /escapes/);
});
test('HTTP adapter treats expected error responses correctly and verifies actual state transitions', async t => {
  const root = await tempRoot(t, 'http'); let value = 0;
  const server = createServer((req, res) => { if (req.url === '/reject') { res.writeHead(422).end(JSON.stringify({ error: 'Invalid input' })); return; } if (req.method === 'POST') value++; res.end(JSON.stringify({ value })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, store = new Store(path.join(root, 'evidence'));
  const basis = { kind: 'requirement' as const, text: 'An increment changes the stored value once; rejection returns 422.' };
  const plan: CheckPlan = { schema: 1, scope: 'Owned API state and error contract', effects: 'local-test-data', checks: [
    { id: 'increment', kind: 'http', title: 'Increment once', expected: 'New value is 1.', basis, url: origin + '/', method: 'POST', status: 200, jsonEquals: { value: 1 } },
    { id: 'persisted', kind: 'http', title: 'Read the new state', expected: 'Value remains 1.', basis, url: origin + '/', method: 'GET', status: 200, jsonEquals: { value: 1 } },
    { id: 'rejection', kind: 'http', title: 'Reject invalid input', expected: '422 is expected here.', basis, url: origin + '/reject', method: 'GET', status: 422, jsonEquals: { error: 'Invalid input' } }
  ] };
  try { const frozen = await freezeCheckPlan(store, process.cwd(), plan); await assert.rejects(executeChecks(store, frozen.id, { project: process.cwd(), planSha: frozen.digest, allowLocalExecution: false, allowLocalSideEffects: false }), /effects/); const result = await executeChecks(store, frozen.id, { project: process.cwd(), planSha: frozen.digest, allowLocalExecution: false, allowLocalSideEffects: true }); assert(result.results.every(r => r.status === 'passed')); await fs.mkdir('.test-output/evidence', { recursive: true }); await fs.writeFile('.test-output/evidence/http-results.json', json(result)); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
