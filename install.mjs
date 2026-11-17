#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.dirname(fileURLToPath(import.meta.url));
const files = ['SKILL.md', 'auto-check.mjs', 'agents/openai.yaml', 'references/checks.md', 'references/helper.md', 'references/native-tools.md', 'assets/icon-small.png', 'assets/icon-large.png'];
const HOOK = 'node "$CLAUDE_PROJECT_DIR/.claude/skills/trace/auto-check.mjs"';
const digest = value => createHash('sha256').update(value).digest('hex');
async function noLinks(target) {
  for (let current = path.resolve(target); ; current = path.dirname(current)) {
    const stat = await fs.lstat(current).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (stat?.isSymbolicLink()) throw new Error('Symlink installation paths are not accepted.');
    if (path.dirname(current) === current) break;
  }
}
function hostFolder(host) {
  if (!['codex', 'claude'].includes(host)) throw new Error('Choose codex or claude.');
  return host === 'codex' ? '.agents' : '.claude';
}
/** Adds or removes only TRACE's Claude Code Stop hook in the project's settings; other settings stay untouched. */
async function setAutoCheck(projectRoot, enable) {
  const file = path.join(projectRoot, '.claude', 'settings.json'); await noLinks(file);
  const text = await fs.readFile(file, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (text === null && !enable) return;
  let settings;
  try { settings = text === null ? {} : JSON.parse(text); } catch { throw new Error(`${file} is not plain JSON; add the Stop hook by hand: ${HOOK}`); }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || settings.hooks !== undefined && (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) || settings.hooks?.Stop !== undefined && !Array.isArray(settings.hooks.Stop)) throw new Error(`Unexpected shape in ${file}; refusing to change it.`);
  const stop = (settings.hooks?.Stop || []).filter(group => !group?.hooks?.some?.(hook => hook?.command === HOOK));
  if (!enable && stop.length === (settings.hooks?.Stop || []).length) return;
  if (enable) stop.push({ hooks: [{ type: 'command', command: HOOK }] });
  const hooks = { ...settings.hooks, Stop: stop };
  if (!stop.length) delete hooks.Stop;
  if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(settings, null, 2) + '\n');
}
export async function installSkill(project, host = 'codex', { autoCheck = false } = {}) {
  if (autoCheck && host !== 'claude') throw new Error('Automatic task-boundary checks are only supported for Claude Code (--agent claude).');
  await noLinks(project);
  const projectRoot = await fs.realpath(project);
  const destination = path.join(projectRoot, hostFolder(host), 'skills', 'trace');
  await noLinks(destination);
  if (await fs.lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; })) throw new Error('TRACE already exists. Uninstall the unchanged owned skill before upgrading.');
  const content = new Map();
  for (const name of files) content.set(name, await fs.readFile(path.join(root, 'skills', 'trace', name)));
  let cli = null;
  try { createRequire(import.meta.url).resolve('playwright'); await fs.access(path.join(root, 'dist', 'cli.js')); cli = path.join(root, 'dist', 'cli.js'); } catch {}
  content.set('runtime.json', JSON.stringify({ cli, browserPath: process.env.PLAYWRIGHT_BROWSERS_PATH || null }, null, 2) + '\n');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const staging = path.join(path.dirname(destination), `trace-install-${randomUUID()}`);
  await fs.mkdir(staging);
  try {
    const owned = {};
    for (const [name, bytes] of content) {
      const target = path.join(staging, name); await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes, { flag: 'wx' }); owned[name] = digest(bytes);
    }
    await fs.writeFile(path.join(staging, 'trace-owned.json'), JSON.stringify(owned, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(staging, destination);
  } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
  if (autoCheck) await setAutoCheck(projectRoot, true);
  return destination;
}
export async function uninstallSkill(project, host = 'codex') {
  await noLinks(project);
  const projectRoot = await fs.realpath(project);
  const destination = path.join(projectRoot, hostFolder(host), 'skills', 'trace'); await noLinks(destination);
  // Remove the hook first, so a refused file removal never leaves a hook pointing at a missing script.
  if (host === 'claude') await setAutoCheck(projectRoot, false);
  const marker = path.join(destination, 'trace-owned.json');
  if ((await fs.stat(marker)).size > 5000) throw new Error('Invalid ownership record.');
  const owned = JSON.parse(await fs.readFile(marker, 'utf8'));
  if (!owned || Array.isArray(owned) || typeof owned !== 'object') throw new Error('Invalid ownership record.');
  const names = Object.keys(owned);
  if (!names.includes('SKILL.md') || names.some(name => ![...files, 'runtime.json'].includes(name))) throw new Error('Unknown owned files; refusing removal.');
  const listed = await fs.readdir(destination, { recursive: true, withFileTypes: true });
  for (const entry of listed) {
    const name = path.relative(destination, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/');
    if (entry.isSymbolicLink() || entry.isDirectory() && !['agents', 'references', 'assets'].includes(name) || entry.isFile() && ![...names, 'trace-owned.json'].includes(name)) throw new Error('Skill has user files or paths; refusing removal.');
  }
  for (const name of names) {
    const target = path.join(destination, name);
    if ((await fs.stat(target)).size > 20000 || digest(await fs.readFile(target)) !== owned[name]) throw new Error('Skill has user changes; refusing removal.');
  }
  for (const name of [...names, 'trace-owned.json']) await fs.unlink(path.join(destination, name));
  for (const name of ['agents', 'references', 'assets']) await fs.rmdir(path.join(destination, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await fs.rmdir(destination); return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { project: { type: 'string', default: '.' }, agent: { type: 'string', default: 'both' }, uninstall: { type: 'boolean' }, 'auto-check': { type: 'boolean' }, help: { type: 'boolean' } } });
    if (values.help) console.log('node install.mjs --project <project> [--agent codex|claude|both] [--auto-check] [--uninstall]\nInstalls the skill only. No npm install, browser download, model calls, or global settings.\n--auto-check (Claude Code only) adds a project Stop hook that asks for one TRACE check when a task changed code.');
    else {
      const hosts = values.agent === 'both' ? ['codex', 'claude'] : [values.agent];
      for (const host of hosts) console.log(values.uninstall ? await uninstallSkill(values.project, host) : await installSkill(values.project, host, { autoCheck: !!values['auto-check'] && host === 'claude' }));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
