import { test } from 'node:test';
import { tempRoot } from './fixtures.js';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { installSkill, uninstallSkill } from '../install.mjs';

test('standalone installer supplies both host skills without npm dependencies or a built helper', async t => {
  const root = await tempRoot(t, 'native-install'), source = path.join(root, 'source'), project = path.join(root, 'project');
  await fs.mkdir(source); await fs.mkdir(project); await fs.copyFile('install.mjs', path.join(source, 'install.mjs')); await fs.cp('skills', path.join(source, 'skills'), { recursive: true });
  await fs.writeFile(path.join(project, 'README.md'), 'User project: preserve this.');
  const installer = path.join(source, 'install.mjs');
  await promisify(execFile)(process.execPath, [installer, '--project', project], { windowsHide: true });
  for (const folder of ['.agents', '.claude']) {
    const skill = path.join(project, folder, 'skills/trace');
    assert.match(await fs.readFile(path.join(skill, 'SKILL.md'), 'utf8'), /name: trace/);
    assert.equal(JSON.parse(await fs.readFile(path.join(skill, 'runtime.json'), 'utf8')).cli, null);
    for (const file of ['references/native-tools.md', 'references/helper.md', 'references/checks.md']) await fs.stat(path.join(skill, file));
  }
  await assert.rejects(fs.stat(path.join(source, 'node_modules')));
  await promisify(execFile)(process.execPath, [installer, '--project', project, '--uninstall'], { windowsHide: true });
  assert.equal(await fs.readFile(path.join(project, 'README.md'), 'utf8'), 'User project: preserve this.');
  for (const folder of ['.agents', '.claude']) await assert.rejects(fs.stat(path.join(project, folder, 'skills/trace')));
});

test('installation preserves existing skills and removal refuses user edits and extra files', async t => {
  const root = await tempRoot(t, 'skill'); const installed = await installSkill(root);
  await assert.rejects(installSkill(root), /already exists/);
  const original = await fs.readFile(path.join(installed, 'SKILL.md'));
  await fs.appendFile(path.join(installed, 'SKILL.md'), '\nUser addition\n'); await assert.rejects(uninstallSkill(root), /user changes/);
  await fs.writeFile(path.join(installed, 'SKILL.md'), original);
  await fs.writeFile(path.join(installed, 'user-notes.txt'), 'keep'); await assert.rejects(uninstallSkill(root), /user files/);
  assert.equal(await fs.readFile(path.join(installed, 'user-notes.txt'), 'utf8'), 'keep');
  await assert.rejects(installSkill(root, '../outside' as any), /Choose/);
});

test('installation rejects a linked project root before writing through it', async t => {
  const root = await tempRoot(t, 'skill-link');
  const project = path.join(root, 'project'), link = path.join(root, 'linked-project');
  await fs.mkdir(project); await fs.symlink(project, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(installSkill(link), /Symlink/);
  await assert.rejects(uninstallSkill(link), /Symlink/);
  await assert.rejects(fs.stat(path.join(project, '.agents')));
});

test('opt-in auto-check adds only its own Claude Code Stop hook, keeps user settings, and is removed on uninstall', async t => {
  const project = await tempRoot(t, 'auto-install'), settingsFile = path.join(project, '.claude', 'settings.json');
  await fs.mkdir(path.dirname(settingsFile)); await fs.writeFile(settingsFile, JSON.stringify({ model: 'kept', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo user' }] }] } }));
  await assert.rejects(installSkill(project, 'codex', { autoCheck: true }), /Claude Code/);
  await installSkill(project, 'claude', { autoCheck: true });
  const installed = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
  assert.equal(installed.model, 'kept'); assert.equal(installed.hooks.Stop.length, 2);
  assert.match(installed.hooks.Stop[1].hooks[0].command, /skills\/trace\/auto-check\.mjs/);
  assert.equal(JSON.parse(await fs.readFile(path.join(project, '.claude/skills/trace/runtime.json'), 'utf8')).store, undefined);
  await uninstallSkill(project, 'claude');
  assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, 'utf8')), { model: 'kept', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo user' }] }] } });
});

test('auto-check hook asks once per changed task and stays quiet otherwise', async t => {
  const project = await tempRoot(t, 'auto-hook'), run = promisify(execFile);
  await run('git', ['init', '-q'], { cwd: project }); await fs.writeFile(path.join(project, 'app.js'), 'one');
  const hook = async (event: object) => {
    const child = execFile(process.execPath, [path.resolve('skills/trace/auto-check.mjs')], { cwd: project });
    let out = ''; child.stdout!.on('data', d => { out += d; }); child.stdin!.end(JSON.stringify({ cwd: project, ...event }));
    await new Promise(resolve => child.on('close', resolve)); return out.trim();
  };
  assert.equal(await hook({}), '', 'first stop only records the starting state');
  await fs.writeFile(path.join(project, 'app.js'), 'two');
  assert.match(await hook({}), /"decision":"block".*trace skill/);
  await fs.writeFile(path.join(project, 'app.js'), 'three (fix made during the TRACE check)');
  assert.equal(await hook({ stop_hook_active: true }), '', 'never asks twice in a row');
  assert.equal(await hook({}), '', 'no change since the last stop');
  await fs.writeFile(path.join(project, '.trace.json'), JSON.stringify({ autoCheck: false })); await fs.writeFile(path.join(project, 'app.js'), 'four');
  assert.equal(await hook({}), '', 'project opt-out');
});

test('Claude Code and Codex plugin manifests agree, point at real files, and share one hook', async () => {
  const read = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
  const pkg = await read('package.json'), claude = await read('.claude-plugin/plugin.json'), codex = await read('.codex-plugin/plugin.json');
  const claudeMarket = await read('.claude-plugin/marketplace.json'), codexMarket = await read('.agents/plugins/marketplace.json');
  for (const manifest of [claude, codex]) { assert.equal(manifest.name, 'trace'); assert.equal(manifest.version, pkg.version); }
  assert.equal(claudeMarket.plugins[0].name, 'trace'); assert.equal(claudeMarket.plugins[0].source, './');
  assert.equal(codexMarket.plugins[0].name, 'trace'); assert.deepEqual(codexMarket.plugins[0].source, { source: 'local', path: './' });
  for (const file of [codex.skills + 'trace/SKILL.md', codex.hooks, codex.interface.composerIcon, codex.interface.logo, claude.icon]) await fs.stat(file);
  assert(codex.interface.defaultPrompt.length <= 3 && codex.interface.defaultPrompt.every((p: string) => p.length <= 512));
  const hooks = await read('hooks/hooks.json');
  assert.match(hooks.hooks.Stop[0].hooks[0].command, /CLAUDE_PLUGIN_ROOT.*'skills', 'trace', 'auto-check\.mjs'/);
  for (const entry of ['.claude-plugin', '.codex-plugin', 'hooks', 'assets', 'skills']) assert(pkg.files.includes(entry), entry);
});
