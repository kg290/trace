import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, safeUrl, sanitize, localUrl } from '../dist/privacy.js';
import { Store } from '../dist/store.js';
import { validateOracle, validateRecipe } from '../dist/verify.js';

test('privacy: URL credentials, known secrets, circular values and getters stay bounded', () => {
  let invoked = 0; const circular: any = { token: 'never-store-me' }; circular.self = circular; Object.defineProperty(circular, 'danger', { enumerable: true, get() { invoked++; return 'secret'; } });
  const sanitized = JSON.stringify(sanitize(circular));
  assert.equal(invoked, 0); assert(!sanitized.includes('never-store-me')); assert(sanitized.length < 2000);
  assert.equal(safeUrl('http://user:pass@localhost:5173/profile?token=SECRET#SECRET'), 'http://localhost:5173/profile?[query omitted]#[fragment omitted]');
  for (const value of ['Bearer abc123', 'ghp_abcdefghijklmnop', 'password=hunter2', 'alice@example.com', '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----']) assert(!redact(value).includes(value));
  assert.throws(() => localUrl('https://example.com'), /loopback/); assert.throws(() => localUrl('http://localhost.evil.test'), /loopback/);
});
test('oracle and action validators reject absent assertions and executable/unscoped steps', () => {
  assert.throws(() => validateOracle({ schema: 1, origin: 'http://localhost:5173', prerequisites: 'seed', checks: [] }));
  assert.throws(() => validateOracle({ schema: 1, origin: 'http://localhost:5173', prerequisites: 'seed', checks: [{ kind: 'http', method: 'GET', path: '/', authentication: 'none', status: 200 }] }));
  assert.throws(() => validateRecipe({ schema: 1, status: 'ready', reasons: [], actions: [{ event: '1', action: 'evaluate', value: 'process.exit()' }] } as any, 'http://localhost:5173'));
  const store = new Store('.'); assert.throws(() => store.dir('../private'));
});
