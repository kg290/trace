import { test } from 'node:test';
import { tempRoot } from './fixtures.js';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { discover } from '../dist/automatic.js';

test('project discovery accepts its matching app and refuses unrelated or oversized pages', async t => {
  const project = await tempRoot(t, 'discovery');
  const html = '<title>Owned application</title><script src="/main.ts"></script>'; let body = html;
  const server = createServer((_req, res) => res.end(body)); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  try {
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ scripts: { dev: `vite --port ${port}` } })); await fs.writeFile(path.join(project, 'index.html'), html);
    assert.equal((await discover(project)).url, `http://127.0.0.1:${port}/`);
    body = '<title>Some other project</title>'; assert.equal((await discover(project)).url, null);
    body = html + 'x'.repeat(110000); assert.equal((await discover(project)).url, null);
    await fs.writeFile(path.join(project, '.trace.json'), JSON.stringify({ url: 'https://example.invalid' })); await assert.rejects(discover(project), /loopback/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
