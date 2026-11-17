import { createServer as httpServer } from 'node:http';
import { createServer as viteServer } from 'vite';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function profileApp(options: { port?: number; data: string; variant?: 'broken' | 'working' }) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const variant = options.variant || 'working';
  const session = randomUUID();
  await fs.mkdir(path.dirname(options.data), { recursive: true });
  try { await fs.writeFile(options.data, JSON.stringify({ displayName: 'Alex Rivera' }), { flag: 'wx' }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  let vite: Awaited<ReturnType<typeof viteServer>>;
  let origin = '';
  const server = httpServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
      if (req.url === '/' && req.method === 'GET') res.setHeader('Set-Cookie', `demo_session=${session}; HttpOnly; SameSite=Strict; Path=/`);
      if (!req.url?.startsWith('/api/')) { vite.middlewares(req, res); return; }
      const respond = (status: number, value: unknown) => { const bytes = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes), 'X-Request-Id': randomUUID(), 'Cache-Control': 'no-store' }).end(bytes); };
      if (!req.headers.cookie?.split('; ').includes(`demo_session=${session}`)) { respond(403, { error: 'Sign in before updating your profile.' }); return; }
      if (req.url !== '/api/profile') { respond(404, { error: 'Not found.' }); return; }
      if (req.method === 'GET') { respond(200, JSON.parse(await fs.readFile(options.data, 'utf8'))); return; }
      if (req.method !== 'PATCH' || req.headers.origin !== origin) { respond(403, { error: 'Request is not authorized.' }); return; }
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) { respond(413, { error: 'Request too large.' }); return; } }
      let data: any; try { data = JSON.parse(body); } catch { respond(400, { error: 'Use JSON.' }); return; }
      if (!data || Object.keys(data).some(k => k !== 'displayName') || typeof data.displayName !== 'string' || data.displayName.trim().length < 2 || data.displayName.length > 50) { respond(422, { error: 'Enter a display name between 2 and 50 characters.' }); return; }
      const profile = { displayName: data.displayName.trim() };
      await fs.writeFile(options.data + '.tmp', JSON.stringify(profile)); await fs.rename(options.data + '.tmp', options.data);
      respond(200, profile);
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  vite = await viteServer({ configFile: false, root, server: { middlewareMode: true, hmr: false, ws: { server, clientPort: Number(new URL(origin).port) } }, resolve: { alias: { '@save': path.join(root, variant === 'working' ? 'save.ts' : `save-${variant}.ts`) } }, appType: 'spa' });
  return { origin, close: async () => { await vite.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const variant = process.argv.includes('--broken') ? 'broken' : 'working';
  const app = await profileApp({ port: Number(process.env.PORT || 5173), data: process.env.TRACE_DEMO_DATA || path.resolve('../.trace-demo/profile.json'), variant });
  console.log(`Seeded ${variant} profile demonstration: ${app.origin}`);
  process.once('SIGINT', () => void app.close()); process.once('SIGTERM', () => void app.close());
}
