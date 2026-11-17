import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Incident, Manifest } from './types.js';
import { makeBrief } from './packet.js';

export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
export async function noLinks(file: string): Promise<void> {
  let current = path.resolve(file);
  while (true) {
    const stat = await fs.lstat(current).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; return null; });
    if (stat?.isSymbolicLink()) throw new Error('Symlink paths are not accepted.');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
export async function boundedRead(file: string, limit = 3_000_000): Promise<string> {
  await noLinks(file);
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > limit) throw new Error('File is missing, not regular, or exceeds its size limit.');
  return fs.readFile(file, 'utf8');
}
export async function atomic(file: string, data: string | Buffer): Promise<void> {
  await noLinks(file);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, file);
  } catch (error) { await fs.rm(temp, { force: true }); throw error; }
}
/** Earlier non-blocked results of the same frozen criteria, oldest first. The first one is the baseline. */
export async function priorRuns(directory: string) {
  const runs = [];
  for (const file of (await fs.readdir(directory)).filter(f => /^[0-9a-f-]{36}\.json$/.test(f)).slice(0, 500)) {
    const run = JSON.parse(await boundedRead(path.join(directory, file), 200000));
    if (run.status !== 'blocked') runs.push(run);
  }
  return runs.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
export class Store {
  constructor(readonly root: string) { this.root = path.resolve(root); }
  async init(project?: string) {
    await noLinks(this.root);
    if (project && inside(await fs.realpath(project), this.root)) throw new Error('Store incidents outside the project. Choose --store or TRACE_HOME.');
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
  }
  dir(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid incident ID.');
    return path.join(this.root, id);
  }
  async pending(id: string) { await atomic(path.join(this.root, `pending-${id}.json`), json({ id, state: 'incomplete if process exits before finalization', started: new Date().toISOString() })); }
  async clearPending(id: string) { this.dir(id); await fs.rm(path.join(this.root, `pending-${id}.json`), { force: true }); }
  async save(incident: Incident, images: Map<string, Buffer>) {
    const destination = this.dir(incident.manifest.id);
    await noLinks(destination);
    if (await fs.stat(destination).catch(() => null)) throw new Error('Finalized captures are immutable.');
    const temp = path.join(this.root, `pending-dir-${randomUUID()}`);
    await fs.mkdir(temp, { mode: 0o700 });
    try {
      const files = new Map<string, string | Buffer>([
        ['manifest.json', json(incident.manifest)], ['events.jsonl', incident.events.map(e => JSON.stringify(e)).join('\n') + '\n'],
        ['reproduction.json', json(incident.recipe)], ['brief.md', incident.brief]
      ]);
      for (const [name, bytes] of images) {
        if (!/^image-\d+\.png$/.test(name)) throw new Error('Invalid attachment name.');
        files.set(name, bytes);
      }
      const hashes: Record<string, string> = {};
      for (const [name, data] of files) { hashes[name] = hash(data); await atomic(path.join(temp, name), data); }
      await atomic(path.join(temp, 'integrity.json'), json(hashes));
      await fs.rename(temp, destination);
      await this.clearPending(incident.manifest.id);
    } catch (error) { await fs.rm(temp, { force: true, recursive: true }); throw error; }
  }
  async integrity(directory: string) {
    await noLinks(directory);
    const index = JSON.parse(await boundedRead(path.join(directory, 'integrity.json'), 12000));
    if (!index || typeof index !== 'object' || Object.keys(index).length > 34) throw new Error('Invalid integrity index.');
    for (const required of ['manifest.json', 'events.jsonl', 'reproduction.json', 'brief.md']) if (!index[required]) throw new Error('Incomplete integrity index.');
    for (const [name, digest] of Object.entries(index)) {
      if (!/^(manifest\.json|events\.jsonl|reproduction\.json|brief\.md|image-\d+\.png)$/.test(name)) throw new Error('Unsafe incident file.');
      const file = path.join(directory, name); await noLinks(file);
      const stat = await fs.stat(file); if (stat.size > 3_000_000) throw new Error('Oversized incident file.');
      if (hash(await fs.readFile(file)) !== digest) throw new Error('Incident integrity check failed.');
    }
    return hash(json(index));
  }
  async read(id: string, audience: 'review' | 'agent' = 'agent'): Promise<Incident> {
    const original = this.dir(id); let directory = original;
    if (audience === 'agent') {
      const approval = JSON.parse(await boundedRead(path.join(original, 'approval.json'), 2000).catch(() => { throw new Error('Incident is not approved for this agent.'); }));
      if (approval.state !== 'approved') throw new Error('Incident approval was revoked.');
      directory = path.join(original, 'approved');
      if (await this.integrity(directory) !== approval.digest) throw new Error('Approved export changed.');
    } else await this.integrity(directory);
    const manifest: Manifest = JSON.parse(await boundedRead(path.join(directory, 'manifest.json'), 50000));
    if (manifest.schema !== 1 || manifest.id !== id) throw new Error('Unsupported or mismatched incident schema.');
    if (!Array.isArray(manifest.attachments) || manifest.attachments.length > 30 || manifest.attachments.some(name => !/^image-\d+\.png$/.test(name))) throw new Error('Unsafe attachment reference.');
    const lines = (await boundedRead(path.join(directory, 'events.jsonl'))).trim();
    const events = lines ? lines.split('\n').map(s => JSON.parse(s)) : [];
    let last = 0; const ids = new Set();
    for (const e of events) {
      if (!Number.isSafeInteger(e.seq) || e.seq <= last || typeof e.id !== 'string' || ids.has(e.id) || e.session !== id || !e.data || typeof e.data !== 'object') throw new Error('Malformed, duplicate or out-of-order incident event.');
      last = e.seq; ids.add(e.id);
    }
    return { manifest, events, recipe: JSON.parse(await boundedRead(path.join(directory, 'reproduction.json'), 100000)), brief: await boundedRead(path.join(directory, 'brief.md'), 20000) };
  }
  async approve(id: string, images: boolean, authorization = 'explicit disclosure review') {
    const incident = await this.read(id, 'review');
    const originalDir = this.dir(id);
    const directory = path.join(originalDir, 'approved');
    if (await fs.stat(directory).catch(() => null)) throw new Error('Revoke the existing export before changing approval.');
    incident.manifest = { ...incident.manifest, project: '[local project path omitted]', attachments: images ? incident.manifest.attachments : [] };
    incident.brief = makeBrief(incident);
    const exportStore = new Store(path.join(originalDir, 'export-staging'));
    await exportStore.init();
    const attachments = new Map<string, Buffer>();
    for (const name of incident.manifest.attachments) attachments.set(name, await fs.readFile(path.join(originalDir, name)));
    await exportStore.save(incident, attachments);
    await fs.rename(exportStore.dir(id), directory);
    await fs.rmdir(exportStore.root);
    const digest = await this.integrity(directory);
    await atomic(path.join(originalDir, 'approval.json'), json({ state: 'approved', digest, approvedAt: new Date().toISOString(), images, authorization }));
    return incident;
  }
  async revoke(id: string) {
    const directory = this.dir(id); await noLinks(directory);
    await atomic(path.join(directory, 'approval.json'), json({ state: 'revoked', at: new Date().toISOString() }));
    const approved = path.join(directory, 'approved'); await noLinks(approved);
    await fs.rm(approved, { recursive: true, force: true });
  }
  async remove(id: string) {
    const directory = this.dir(id); await noLinks(directory);
    await fs.rm(directory, { recursive: true, force: true }); await this.clearPending(id);
  }
}
