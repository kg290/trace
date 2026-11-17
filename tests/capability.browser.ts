import { test } from 'node:test';
import { tempRoot } from './fixtures.js';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { automatic } from '../dist/automatic.js';
import type { Flow } from '../src/automatic.js';
import { Store } from '../dist/store.js';
import { freezeOracle, verify } from '../dist/verify.js';
import { profileApp } from '../examples/profile/server.js';
import type { Oracle } from '../src/types.js';

const field = { by: 'label' as const, value: 'Display name' };
const flow: Flow = { schema: 1, expected: 'Saving Mira Chen must persist after reload.', testData: true, actions: [
  { event: 'fill', action: 'fill', locator: field, value: 'Mira Chen' },
  { event: 'save', action: 'click', locator: { by: 'role', role: 'button', value: 'Save profile' }, waitFor: field },
  { event: 'reload', action: 'reload', waitFor: field }
] };
const oracle = (origin: string): Oracle => ({ schema: 1, origin, prerequisites: 'Owned local profile service with synthetic data.', checks: [
  { kind: 'value', phase: 'after actions', locator: field, equals: 'Mira Chen' },
  { kind: 'value', phase: 'after reload', locator: field, equals: 'Mira Chen' },
  { kind: 'http', method: 'PATCH', path: '/api/profile', body: { displayName: '' }, status: 422, authentication: 'session' },
  { kind: 'http', method: 'PATCH', path: '/api/profile', body: { displayName: 'Unauthorized edit' }, status: 403, authentication: 'none' }
] });

test('capability: the flow reproduces a false "Saved", verify proves the fix, and a never-failing baseline is not a fix', async t => {
  const root = await tempRoot(t, 'capability'), data = path.join(root, 'profile.json'), project = path.resolve('examples/profile');
  const store = new Store(path.join(root, 'incidents'));
  let app = await profileApp({ data, variant: 'broken' });
  const port = Number(new URL(app.origin).port);
  try {
    const run: any = await automatic({ project, url: app.origin, store, flow, shareWithCurrentAgent: true, allowLocalSideEffects: true });
    assert.equal(run.status, 'complete within supported scope', JSON.stringify(run.omissions));
    assert.equal(run.images.length, 4);
    const incident = await store.read(run.id);
    assert(incident.events.some(e => e.kind === 'response' && e.data.status === 422));
    assert(incident.events.some(e => e.kind === 'visible-message' && e.data.messages.includes('Saved')));
    assert(incident.events.some(e => e.kind === 'observation' && e.data.controls.some((c: any) => c.value === 'Alex Rivera')));
    assert.equal(incident.events.filter(e => e.kind === 'action').length, 3);
    assert.deepEqual(incident.recipe.actions, flow.actions, 'the flow itself is the reproduction, including waitFor');
    assert.match(incident.brief, /422/);

    const sha = await freezeOracle(store, run.id, oracle(app.origin));
    const options = { project, url: app.origin, oracleSha: sha, allowLocalSideEffects: true };
    const before = await verify(store, run.id, options);
    assert.equal(before.status, 'reproduced');
    assert.deepEqual(before.checks.map(c => c.kind), ['value', 'value', 'http', 'http'], 'HTTP writes run after visible checks');
    assert.equal(before.checks[0].passed, true, 'right after saving, the field still shows the new name');
    assert.equal(before.checks[1].passed, false); assert.match(before.checks[1].observed!, /Alex Rivera/);
    await fs.stat(before.screenshot!);

    await app.close(); app = await profileApp({ data, port, variant: 'working' });
    const after = await verify(store, run.id, options);
    assert.equal(after.status, 'verified within stated checks', JSON.stringify(after.checks));
    assert.equal(after.baseline?.status, 'reproduced'); assert.equal(after.history.priorRuns, 1);

    const healthy: any = await automatic({ project, url: app.origin, store, flow, shareWithCurrentAgent: true, allowLocalSideEffects: true });
    const healthySha = await freezeOracle(store, healthy.id, oracle(app.origin));
    assert.equal((await verify(store, healthy.id, { ...options, oracleSha: healthySha })).status, 'could not reproduce');
  } finally { await app.close(); }
});
