import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const sha = value => createHash('sha256').update(value).digest('hex');
const limit = 16384;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const git = (cwd, args) => execFileSync('git', ['--no-optional-locks', ...args], {
  cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true
});
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

export async function projectRoot(cwd) {
  let root = cwd;
  try { root = git(cwd, ['rev-parse', '--show-toplevel']).trimEnd(); } catch {}
  return fs.realpath(root);
}

/** Git snapshot of the working tree, or null only when this is not a usable git repository. */
export async function gitState(project) {
  let status, head = null;
  try {
    status = git(project, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all']);
    try { head = git(project, ['rev-parse', '--verify', 'HEAD']).trim(); } catch (e) {
      if (!git(project, ['symbolic-ref', '-q', 'HEAD']).trim()) throw e;
    }
  } catch { return null; }
  const files = status.split('\0').filter(Boolean);
  const fingerprint = createHash('sha256').update(status);
  let partial = false;
  // A huge change must still be noticed: on overflow keep the status-only fingerprint instead of going silent.
  try {
    if (files.length > 5000) throw new Error('too many changed files');
    const diff = ['diff', '--no-ext-diff', '--no-textconv', '--binary'];
    fingerprint.update(git(project, diff)).update('\0').update(git(project, [...diff, '--cached']));
    for (const entry of files) {
      if (!entry.startsWith('?? ')) continue;
      const stat = await fs.lstat(path.join(project, entry.slice(3))).catch(() => null);
      fingerprint.update(`\0${stat?.size}:${stat?.mtimeMs}`);
    }
  } catch { partial = true; }
  return { head, changedFiles: files.length, fingerprint: fingerprint.digest('hex'), ...(partial ? { partial: true } : {}) };
}

async function directory(project) {
  // Keep this standalone skill default in sync with src/cli.ts.
  const root = process.env.TRACE_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'trace-local', 'incidents');
  const dir = path.resolve(root, 'criteria', sha(project));
  const relative = path.relative(project, dir);
  if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
    throw new Error('Keep criteria outside the project.');
  for (let p = dir; ; p = path.dirname(p)) {
    const stat = await fs.lstat(p).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (stat?.isSymbolicLink()) throw new Error('Linked criteria directory refused.');
    if (path.dirname(p) === p) break;
  }
  return dir;
}

async function readBytes(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size > limit * 4) throw new Error('Invalid criteria record.');
  return fs.readFile(file);
}

async function publish(file, bytes) {
  const temp = path.join(path.dirname(file), randomUUID() + '.tmp');
  await fs.writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
  try { await fs.link(temp, file); } finally { await fs.unlink(temp); }
}

export async function issue(project, source, session) {
  const dir = await directory(project), id = randomUUID();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const record = { source, session: session ? sha(session) : null, issuedAt: new Date().toISOString(), git: await gitState(project) };
  await publish(path.join(dir, id + '.issued'), JSON.stringify(record));
  await prune(dir);
  return id;
}

/** Deletes issued IDs that were never frozen and are older than 30 days; frozen tasks are kept. */
async function prune(dir) {
  const names = new Set(await fs.readdir(dir));
  for (const name of names) {
    if (!name.endsWith('.issued') || names.has(name.slice(0, -7) + '.seal')) continue;
    const stat = await fs.lstat(path.join(dir, name)).catch(() => null);
    if (stat?.isFile() && Date.now() - stat.mtimeMs > STALE_MS) await fs.rm(path.join(dir, name), { force: true });
  }
}

async function main() {
  const [mode, id, digest] = process.argv.slice(2);
  const project = await projectRoot('.');
  if (mode === 'begin') { console.log(await issue(project, 'manual')); return; }
  if (!['freeze', 'read'].includes(mode) || !uuid.test(id ?? ''))
    throw new Error('Use begin, freeze <issued-task-id> or read <task-id> <original-sha256>.');
  const dir = await directory(project), file = path.join(dir, id + '.json');
  const issuance = await readBytes(path.join(dir, id + '.issued')).then(JSON.parse).catch(e => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  if (mode === 'read') {
    const bytes = await readBytes(file).catch(async error => {
      if (error.code !== 'ENOENT' || !issuance) throw error;
      // Recover the original bytes if publication stopped after sealing, or the display copy was deleted.
      const original = JSON.parse(await readBytes(path.join(dir, id + '.seal'))).original;
      if (typeof original !== 'string') throw new Error('Original receipt missing.');
      return Buffer.from(original);
    });
    if (sha(bytes) !== digest) throw new Error('Frozen criteria differ from the original digest.');
    const receipt = JSON.parse(bytes);
    if (!issuance) {
      if (receipt.frozenAt) throw new Error('Missing issuance record.');
      console.log(JSON.stringify({ ...receipt, timing: 'Legacy receipt; issuance and freeze timing unverified.' }));
      return;
    }
    const related = [];
    let matched = false;
    for await (const entry of await fs.opendir(dir)) {
      if (!entry.name.endsWith('.seal')) continue;
      const seal = JSON.parse(await readBytes(path.join(dir, entry.name)));
      if (entry.name === id + '.seal') matched = seal.digest === digest;
      else if (!issuance.session || seal.frozenAt >= issuance.issuedAt || seal.session === issuance.session)
        related.push({ task: entry.name.slice(0, -5), digest: seal.digest, frozenAt: seal.frozenAt });
    }
    if (!matched) throw new Error('Original freeze record missing or digest changed.');
    console.log(JSON.stringify({ ...receipt, warning: issuance.source === 'manual' ? 'Manual receipt; prompt-time issuance unverified.' : undefined, related: related.sort((a,b) => a.frozenAt.localeCompare(b.frozenAt)) }));
    return;
  }
  if (!issuance) throw new Error('Unissued task ID. Use the original hook ID or begin a manual task.');
  const fields = process.argv.slice(4);
  let rows;
  if (fields.length) {
    if (fields.length % 3 || fields.length > 18) throw new Error('Supply quote, expected and check for each criterion.');
    rows = [];
    for (let i = 0; i < fields.length; i += 3) {
      rows.push({ quote: fields[i], expected: fields[i + 1], check: fields[i + 2] });
    }
    if (Buffer.byteLength(JSON.stringify(rows)) > limit) throw new Error('Criteria exceed 16 KiB.');
  } else {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > limit) throw new Error('Criteria exceed 16 KiB.');
      chunks.push(chunk);
    }
    rows = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 6 || rows.some(row =>
    !row || Object.keys(row).length !== 3 || ['quote', 'expected', 'check'].some(key =>
      typeof row[key] !== 'string' || !row[key].trim())))
    throw new Error('Supply 1–6 criteria with quote, expected and check strings.');
  const git = await gitState(project), frozenAt = new Date().toISOString();
  const timing = !issuance.git || !git ? 'Git timing unavailable' :
    (git.head === issuance.git.head && git.fingerprint === issuance.git.fingerprint ? 'No observed Git change since issuance' : 'Git changed between issuance and freeze') +
    (git.partial || issuance.git.partial ? ' (large change: compared by git status only, so repeat edits to an already-changed file are not seen)' : '');
  const bytes = JSON.stringify({ task: id, issuance, frozenAt, git, timing, criteria: rows }) + '\n';
  const fingerprint = sha(bytes);
  await publish(path.join(dir, id + '.seal'), JSON.stringify({ frozenAt, session: issuance.session, digest: fingerprint, original: bytes }));
  await publish(file, bytes);
  console.log(fingerprint);
}

export function diagnostic(error) {
  if (error.code === 'EEXIST') return 'Criteria for this task are already frozen. Use read with the original digest.';
  if (error.code === 'ENOENT') return 'Criteria record missing. Check the project, store and original task ID.';
  if (error.code) return 'Criteria store unavailable (' + error.code + ').';
  return error instanceof SyntaxError ? 'Invalid criteria JSON.' : error.message;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { console.error(diagnostic(error)); process.exitCode = 1; });
