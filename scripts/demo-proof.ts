import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { automatic } from '../dist/automatic.js';
import { Store, json } from '../dist/store.js';
import { freezeOracle, verify } from '../dist/verify.js';
import { profileApp } from '../examples/profile/server.js';
import type { Flow } from '../src/automatic.js';
import type { Oracle } from '../src/types.js';

const phase = process.argv[2] || 'capture';
const output = path.resolve(process.env.TRACE_PROOF_OUTPUT || '.test-output/reproduction'); await fs.mkdir(output, { recursive: true });
const stateFile = path.join(output, 'demo-context.json');
const root = process.env.TRACE_PROOF_STORE ? path.resolve(process.env.TRACE_PROOF_STORE) : path.resolve('../.trace-reproduction'); await fs.mkdir(root, { recursive: true });
const store = new Store(path.join(root, 'incidents'));
const project = path.resolve('examples/profile');
const data = path.join(root, 'profile.json');
const known = phase === 'after' ? JSON.parse(await fs.readFile(stateFile, 'utf8')) : undefined;
if (!known) await fs.writeFile(data, json({ displayName: 'Alex Rivera' }));
const app = await profileApp({ data, port: known?.port, variant: phase === 'capture' ? 'broken' : 'working' });
try {
  if (phase === 'capture') {
    const inspected = await automatic({ project, url: app.origin, store, shareWithCurrentAgent: true });
    assert(inspected.controls?.some(c => c.label === 'Display name'));
    const field = { by: 'label' as const, value: 'Display name' };
    const flow: Flow = { schema: 1, expected: 'Saving Mira Chen must persist after reload; invalid and unauthorized updates must remain rejected.', testData: true, actions: [
      { event: 'step-1', action: 'fill', locator: field, value: 'Mira Chen' },
      { event: 'step-2', action: 'click', locator: { by: 'role', role: 'button', value: 'Save profile' }, awaitResponse: { method: 'PATCH', url: app.origin + '/api/profile' }, waitFor: field },
      { event: 'step-3', action: 'reload', waitFor: field }
    ] };
    await fs.writeFile(path.join(output, 'profile-flow.json'), json(flow));
    const captured = await automatic({ project, url: app.origin, store, flow, shareWithCurrentAgent: true, allowLocalSideEffects: true });
    assert(captured.id); assert.equal(captured.status, 'complete within supported scope');
    const oracle: Oracle = { schema: 1, origin: app.origin, prerequisites: 'Owned local Node profile service, synthetic Alex Rivera seed; no upstream services. A fresh page establishes the demo session.', checks: [
      { kind: 'value', phase: 'after actions', locator: field, equals: 'Mira Chen' },
      { kind: 'value', phase: 'after reload', locator: field, equals: 'Mira Chen' },
      { kind: 'http', method: 'PATCH', path: '/api/profile', body: { displayName: '' }, status: 422, authentication: 'session' },
      { kind: 'http', method: 'PATCH', path: '/api/profile', body: { displayName: 'Unauthorized edit' }, status: 403, authentication: 'none' }
    ] };
    const sha = await freezeOracle(store, captured.id, oracle);
    const result = await verify(store, captured.id, { project, url: app.origin, oracleSha: sha, allowLocalSideEffects: true });
    assert.equal(result.status, 'reproduced');
    assert(result.checks.filter(c => c.kind === 'http').every(c => c.passed));
    const context = { id: captured.id, inspection: inspected.id, sha, port: Number(new URL(app.origin).port), store: store.root, project, data, before: result };
    await fs.writeFile(stateFile, json(context));
    await fs.writeFile(path.join(output, 'before.json'), json(result));
    await fs.writeFile(path.join(output, 'profile-oracle.json'), json(oracle));
    const exported = path.join(output, 'seeded-incident'); await fs.mkdir(exported);
    await fs.cp(path.join(store.dir(captured.id), 'approved'), exported, { recursive: true });
    console.log(json({ id: captured.id, sha, images: captured.images, status: result.status, checks: result.checks, store: store.root }));
  } else if (phase === 'after') {
    const result = await verify(store, known.id, { project, url: app.origin, oracleSha: known.sha, allowLocalSideEffects: true });
    assert.equal(result.status, 'verified within stated checks');
    assert.equal(JSON.parse(await fs.readFile(data, 'utf8')).displayName, 'Mira Chen');
    const flow = JSON.parse(await fs.readFile(path.join(output, 'profile-flow.json'), 'utf8'));
    const after = await automatic({ project, url: app.origin, store, flow, shareWithCurrentAgent: true, allowLocalSideEffects: true });
    if ('images' in after && after.images?.length) await fs.copyFile(after.images.at(-1)!, path.join(output, 'verified-after.png'));
    await fs.writeFile(path.join(output, 'after.json'), json({ ...result, images: 'images' in after ? after.images : [] }));
    console.log(json(result));
  } else throw new Error('Use capture or after.');
} finally { await app.close(); }
