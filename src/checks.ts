import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomic, boundedRead, hash, inside, json, noLinks, priorRuns, Store } from './store.js';
import { localUrl, redact, sanitize, SECRET_KEY } from './privacy.js';

type Basis = { kind: 'requirement' | 'documentation' | 'inferred'; text: string; file?: string };
type Common = { id: string; title: string; expected: string; basis: Basis };
type Check = Common & (
  { kind: 'http'; url: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH'; body?: unknown; status: number; jsonEquals?: unknown } |
  { kind: 'node-cli'; entry: string; args: string[]; exitCode: number; stdout: string; files?: Record<string, string> } |
  { kind: 'node-library'; entry: string; exported: string; args: unknown[]; equals?: unknown; throws?: string } |
  { kind: 'desktop'; integration: string } | { kind: 'mobile'; integration: string }
);
export interface CheckPlan { schema: 1; scope: string; effects: 'read-only' | 'local-test-data'; checks: Check[] }
const MAX_OUTPUT = 16000;
async function projectPath(project: string, relative: string) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('Use a project-relative source path.');
  const file = path.resolve(project, relative); await noLinks(file);
  if (!inside(project, file)) throw new Error('Check path escapes the project.');
  return file;
}
async function projectFile(project: string, relative: string) {
  const file = await projectPath(project, relative); await boundedRead(file, 1_000_000); return file;
}
function rejectSecrets(value: unknown, depth = 0) {
  if (depth > 8) throw new Error('Check plan is too deeply nested.');
  if (typeof value === 'string' && redact(value, 16000) !== value) throw new Error('Do not put credentials or private data in check plans. Use synthetic inputs.');
  if (Array.isArray(value)) { for (const child of value) rejectSecrets(child, depth + 1); }
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (SECRET_KEY.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Sensitive or unsafe check-plan field.'); rejectSecrets(child, depth + 1); }
}
async function validatePlan(project: string, plan: CheckPlan) {
  if (plan.schema !== 1 || typeof plan.scope !== 'string' || !plan.scope || plan.scope.length > 500 || !['read-only', 'local-test-data'].includes(plan.effects) || !Array.isArray(plan.checks) || !plan.checks.length || plan.checks.length > 8 || JSON.stringify(plan).length > 30000) throw new Error('Use a bounded plan with scope, effects and 1–8 checks.');
  const ids = new Set<string>();
  for (const check of plan.checks) {
    if (!check || typeof check.id !== 'string' || !/^[a-z0-9-]{1,50}$/.test(check.id) || ids.has(check.id) || typeof check.title !== 'string' || typeof check.expected !== 'string' || !check.expected.trim() || !check.basis || !['requirement', 'documentation', 'inferred'].includes(check.basis.kind) || !check.basis.text?.trim()) throw new Error('Each check needs a unique ID, expected behavior and identifiable basis.');
    ids.add(check.id);
    if (check.basis.kind === 'documentation' && !check.basis.file) throw new Error('Documentation expectations require their source file.');
    if (check.basis.file) { const file = await projectFile(project, check.basis.file); const text = await boundedRead(file, 1_000_000); if (!text.includes(check.basis.text)) throw new Error('The stated contract was not found in its source.'); }
    if (check.kind === 'http') {
      check.url = localUrl(check.url).href;
      if (!['GET', 'POST', 'PUT', 'PATCH'].includes(check.method) || !Number.isInteger(check.status) || check.status < 200 || check.status > 599 || (check.method !== 'GET' && plan.effects !== 'local-test-data')) throw new Error('HTTP operation needs a valid status and explicit local test-data scope.');
    } else if (check.kind === 'node-cli' || check.kind === 'node-library') {
      const file = await projectFile(project, check.entry); if (!/\.[cm]?js$/.test(file)) throw new Error('The first Node integration supports .js, .mjs and .cjs entry points.');
      if (!Array.isArray(check.args) || check.args.length > 20) throw new Error('Use at most 20 arguments.');
      if (check.kind === 'node-cli' && (!Number.isInteger(check.exitCode) || typeof check.stdout !== 'string' || check.args.some(a => typeof a !== 'string'))) throw new Error('CLI checks require exact output and exit-code assertions.');
      if (check.kind === 'node-cli' && check.files !== undefined) {
        if (!check.files || typeof check.files !== 'object' || Array.isArray(check.files) || !Object.keys(check.files).length || Object.keys(check.files).length > 10 || Object.values(check.files).some(v => typeof v !== 'string')) throw new Error('Generated-file checks map 1–10 project-relative paths to exact expected content.');
        if (plan.effects !== 'local-test-data') throw new Error('A CLI that generates files needs explicit local test-data scope.');
        for (const name of Object.keys(check.files)) await projectPath(project, name);
      }
      if (check.kind === 'node-library' && (typeof check.exported !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(check.exported) || Object.hasOwn(check, 'equals') === (typeof check.throws === 'string'))) throw new Error('Library checks require a named public function and exactly one of `equals` or `throws`.');
    } else if (!['desktop', 'mobile'].includes(check.kind)) throw new Error('Unsupported check integration.');
  }
  rejectSecrets(plan);
}
/** mtime (or null when absent) of each expected generated file, so stale files cannot pass. */
async function fileTimes(project: string, files: Record<string, string> = {}) {
  const times: Record<string, number | null> = {};
  for (const name of Object.keys(files)) times[name] = await fs.stat(await projectPath(project, name)).then(s => s.mtimeMs, () => null);
  return times;
}
async function nodeProcess(project: string, args: string[]) {
  return new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string; incomplete: boolean }>((resolve, reject) => {
    const env: Record<string, string> = {};
    for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name]!;
    const child = spawn(process.execPath, args, { cwd: project, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [], stderr: Buffer[] = []; let bytes = 0, incomplete = false;
    const take = (chunk: Buffer, stream: 'stdout' | 'stderr') => { bytes += chunk.length; if (bytes > MAX_OUTPUT) { incomplete = true; child.kill(); return; } (stream === 'stdout' ? stdout : stderr).push(chunk); };
    child.stdout.on('data', chunk => take(chunk, 'stdout')); child.stderr.on('data', chunk => take(chunk, 'stderr'));
    const timer = setTimeout(() => { incomplete = true; child.kill(); }, 10000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), incomplete }); });
  });
}
export async function freezeCheckPlan(store: Store, project: string, plan: CheckPlan) {
  const root = await fs.realpath(project); await store.init(root);
  await validatePlan(root, plan); const id = randomUUID();
  const frozen = { schema: 1, id, projectIdentity: hash(root), plan };
  const digest = hash(json(frozen));
  const directory = store.dir(id); await fs.mkdir(directory);
  await atomic(path.join(directory, 'check-plan.json'), json({ ...frozen, digest }));
  return { id, digest };
}
export async function executeChecks(store: Store, id: string, options: { project: string; planSha: string; allowLocalExecution: boolean; allowLocalSideEffects: boolean }) {
  const project = await fs.realpath(options.project), directory = store.dir(id);
  const frozen = JSON.parse(await boundedRead(path.join(directory, 'check-plan.json'), 40000));
  const { digest, ...sealed } = frozen;
  if (digest !== options.planSha || hash(json(sealed)) !== digest || hash(project) !== frozen.projectIdentity) throw new Error('Frozen checks or project changed.');
  const plan: CheckPlan = frozen.plan; await validatePlan(project, plan);
  if (plan.effects === 'local-test-data' && !options.allowLocalSideEffects) throw new Error('These checks require separately authorized local test-data effects.');
  if (plan.checks.some(c => c.kind.startsWith('node-')) && !options.allowLocalExecution) throw new Error('Node checks require --allow-local-execution for trusted project code.');
  const prior = await priorRuns(directory), baseline = prior[0];
  const run = { id: randomUUID(), at: new Date().toISOString(), planId: id, planSha: digest, projectIdentity: hash(project), scope: plan.scope, role: baseline ? 'repeat' : 'baseline', history: { priorRuns: prior.length, sinceBaselineMs: baseline ? Date.now() - Date.parse(baseline.at) : 0 }, results: [] as any[], limits: ['Only the listed scenarios are covered.', 'Node checks execute trusted project code in a child process, not an OS sandbox; network and descendants are not contained.', 'Only selected HTTP outcomes and bounded sanitized process output are retained.'] };
  for (const check of plan.checks) {
    const row: any = { id: check.id, what: check.title, expected: check.expected, basis: check.basis, status: 'blocked', observed: {}, reproduce: check.kind === 'http' ? { method: check.method, url: check.url, body: check.body } : check.kind.startsWith('node-') ? { entry: (check as any).entry, args: (check as any).args } : { integration: (check as any).integration } };
    try {
      if (check.basis.kind === 'inferred') { row.status = 'needs review'; row.observed = { reason: 'Expected behavior is ambiguous; no defect inferred.' }; }
      else if (check.kind === 'desktop' || check.kind === 'mobile') { row.status = 'unsupported'; row.observed = { reason: 'No native desktop/mobile integration has been qualified in this release.' }; }
      else if (check.kind === 'http') {
        const response = await fetch(check.url, { method: check.method, headers: check.body === undefined ? {} : { 'Content-Type': 'application/json' }, body: check.body === undefined ? undefined : JSON.stringify(check.body), redirect: 'manual', signal: AbortSignal.timeout(5000) });
        const chunks: Buffer[] = []; let total = 0, oversized = false;
        if (response.body) for await (const bytes of response.body) { total += bytes.length; if (total > MAX_OUTPUT) { oversized = true; break; } chunks.push(Buffer.from(bytes)); }
        const body = Buffer.concat(chunks).toString('utf8');
        let parsed: unknown; try { parsed = JSON.parse(body); } catch {}
        row.observed = { status: response.status, ...(Object.hasOwn(check, 'jsonEquals') ? { json: sanitize(parsed) } : {}), bytes: total };
        row.status = oversized ? 'incomplete' : response.status === check.status && (!Object.hasOwn(check, 'jsonEquals') || isDeepStrictEqual(parsed, check.jsonEquals)) ? 'passed' : 'confirmed defect';
      } else {
        const entry = await projectFile(project, check.entry); row.source = { file: check.entry, hash: hash(await boundedRead(entry, 1_000_000)), relation: 'executed entry point; not an inferred root cause' };
        if (check.kind === 'node-cli') {
          const before = await fileTimes(project, check.files);
          const result = await nodeProcess(project, [entry, ...check.args]); row.observed = { exitCode: result.code, signal: result.signal, stdout: redact(result.stdout, MAX_OUTPUT), stderr: redact(result.stderr, MAX_OUTPUT) };
          let filesMatch = true;
          if (check.files) {
            const after = await fileTimes(project, check.files); row.observed.files = {};
            for (const [name, expected] of Object.entries(check.files)) {
              const regenerated = after[name] !== null && after[name] !== before[name];
              const content = regenerated ? await boundedRead(await projectPath(project, name), MAX_OUTPUT).catch(() => null) : null;
              row.observed.files[name] = { exists: after[name] !== null, regenerated, matches: content === expected, content: content === null ? null : redact(content, 2000) };
              filesMatch &&= content === expected;
            }
          }
          row.status = result.incomplete ? 'incomplete' : result.code === check.exitCode && result.stdout === check.stdout && filesMatch ? 'passed' : 'confirmed defect';
        } else {
          const output = path.join(directory, `probe-${randomUUID()}.json`);
          try {
            const expected = typeof check.throws === 'string' ? { throws: check.throws } : { equals: check.equals };
            const result = await nodeProcess(project, [fileURLToPath(new URL('./node-probe.js', import.meta.url)), entry, check.exported, JSON.stringify(check.args), JSON.stringify(expected), output]);
            if (result.incomplete) { row.status = 'incomplete'; row.observed = { reason: 'Timed out after 10 seconds or exceeded the output limit; no result inferred.' }; }
            else {
              const value = JSON.parse(await boundedRead(output, MAX_OUTPUT)); row.observed = sanitize(value);
              row.status = result.code === 0 && value.ok && value.matches === true ? 'passed' : 'confirmed defect';
            }
          } finally { await fs.rm(output, { force: true }); }
        }
      }
    } catch (error) { row.status = 'blocked'; row.observed = { reason: redact(error instanceof Error ? error.message : 'Check unavailable', 300) }; }
    // Compare with the baseline run of the same frozen plan: only a failing baseline makes a pass a verified fix.
    const first = baseline?.results.find((r: any) => r.id === check.id)?.status;
    row.baseline = first ?? null;
    if (first === 'confirmed defect' && row.status === 'passed') row.status = 'verified fix';
    else if (first === 'confirmed defect' && row.status === 'confirmed defect') row.status = 'still failing';
    else if (first === 'passed' && row.status === 'confirmed defect') row.status = 'regression';
    row.evidence = `${run.id}.json#${check.id}`; run.results.push(row);
  }
  await atomic(path.join(directory, `${run.id}.json`), json(run));
  return run;
}
