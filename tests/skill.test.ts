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
  assert.equal(installed.hooks.UserPromptSubmit[0].hooks[0].command, installed.hooks.Stop[1].hooks[0].command);
  assert.match(installed.hooks.Stop[1].hooks[0].command, /skills\/trace\/auto-check\.mjs/);
  assert.equal(JSON.parse(await fs.readFile(path.join(project, '.claude/skills/trace/runtime.json'), 'utf8')).store, undefined);
  await uninstallSkill(project, 'claude');
  assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, 'utf8')), { model: 'kept', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo user' }] }] } });
});

test('auto-check hook asks once per changed task and stays quiet otherwise', async t => {
  const project = await tempRoot(t, 'auto-hook'), run = promisify(execFile);
  await run('git', ['init', '-q'], { cwd: project }); await fs.writeFile(path.join(project, 'app.js'), 'one');
  const hook = async (event: object) => {
    const child = execFile(process.execPath, [path.resolve('skills/trace/auto-check.mjs')], { cwd: project, env: { ...process.env, TRACE_HOME: path.join(await tempRoot(t, 'hook-store'), 'incidents') } });
    let out = ''; child.stdout!.on('data', d => { out += d; }); child.stdin!.end(JSON.stringify({ cwd: project, ...event }));
    await new Promise(resolve => child.on('close', resolve)); return out.trim();
  };
  const context = JSON.parse(await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'private user words' })).hookSpecificOutput;
  assert.equal(context.hookEventName, 'UserPromptSubmit');
  assert.match(context.additionalContext, /before the first edit/);
  assert(!context.additionalContext.includes('private user words'));
  assert.equal(await hook({}), '', 'first stop only records the starting state');
  await fs.writeFile(path.join(project, 'app.js'), 'two');
  assert.match(await hook({}), /"decision":"block".*trace skill/);
  await fs.writeFile(path.join(project, 'app.js'), 'three (fix made during the TRACE check)');
  assert.equal(await hook({ stop_hook_active: true }), '', 'never asks twice in a row');
  assert.equal(await hook({}), '', 'no change since the last stop');
  const many = path.join(project, 'generated'); await fs.mkdir(many);
  await Promise.all(Array.from({ length: 5001 }, (_, i) => fs.writeFile(path.join(many, `f${i}.txt`), '')));
  assert.match(await hook({}), /"decision":"block"/, 'a change too large to diff still triggers the check');
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

test('a task keeps one original criterion across concurrent freezes, weaker retries and tampering', async t => {
  const root = await tempRoot(t, 'criteria'), project = path.join(root, 'project'), store = path.join(root, 'store');
  await fs.mkdir(project);
  const skill = await installSkill(project);
  await promisify(execFile)('git', ['init', '-q'], { cwd: project });
  const sub = path.join(project, 'sub'); await fs.mkdir(sub);
  const row = { quote: 'survives reload', expected: 'Reload shows Mira', check: 'Save Mira, then reload and read the name' };
  const run = (args: string[], input?: unknown, cwd = project) => {
    const child = promisify(execFile)(process.execPath, [path.join(skill, 'criteria.mjs'), ...args], {
      cwd, env: { ...process.env, TRACE_HOME: store }
    });
    child.child.stdin!.end(input === undefined ? '' : JSON.stringify(input));
    return child;
  };
  const hook = promisify(execFile)(process.execPath, [path.join(skill, 'auto-check.mjs')], {
    cwd: sub, env: { ...process.env, TRACE_HOME: store }
  });
  hook.child.stdin!.end(JSON.stringify({ cwd: sub, hook_event_name: 'UserPromptSubmit', session_id: 'test-session' }));
  const context = JSON.parse((await hook).stdout).hookSpecificOutput.additionalContext;
  const id = /task ID ([a-f0-9-]{36})/.exec(context)![1];
  await assert.rejects(run(['freeze', 'be35d9aa-b173-4bef-af92-67d65b1ba256'], [row]), /Unissued task ID/);
  await fs.writeFile(path.join(project, 'change.txt'), 'edited after issuance');
  const attempts = await Promise.allSettled([run(['freeze', id], [row]), run(['freeze', id], [row])]);
  const saved = attempts.filter(result => result.status === 'fulfilled');
  assert.equal(saved.length, 1);
  const digest = saved[0].value.stdout.trim();
  await assert.rejects(run(['freeze', id], [{ ...row, expected: 'Toast says Saved' }]), /already frozen/);
  const read = async () => JSON.parse((await run(['read', id, digest], undefined, sub)).stdout);
  const receipt = await read();
  assert.deepEqual(receipt.criteria, [row]);
  assert.match(receipt.timing, /changed between/);
  assert.equal(receipt.issuance.source, 'prompt hook');
  const second = (await run(['begin'])).stdout.trim();
  const later = (await run(['freeze', second, row.quote, 'Weaker', row.check])).stdout.trim();
  const current = JSON.parse((await run(['read', second, later])).stdout);
  assert.match(current.warning, /Manual/);
  assert.match(current.timing, /No observed Git change/);
  assert(current.git.changedFiles > 0, 'pre-existing changes are distinguished from later edits');
  assert.equal(current.related[0].digest, digest);
  assert.equal((await read()).related[0].digest, later);
  const [directory] = await fs.readdir(path.join(store, 'criteria'));
  const file = path.join(store, 'criteria', directory, id + '.json');
  await fs.unlink(file);
  await assert.rejects(run(['freeze', id], [row]), /already frozen/);
  assert.deepEqual((await read()).criteria, [row]);
  await fs.writeFile(file, 'tampered');
  await assert.rejects(run(['read', id, digest]), /original digest/);
});

test('prompt hook prunes issued IDs older than 30 days that were never frozen, and keeps frozen ones', async t => {
  const project = await tempRoot(t, 'prune'), store = path.join(await tempRoot(t, 'prune-store'), 'incidents');
  await promisify(execFile)('git', ['init', '-q'], { cwd: project });
  const prompt = async () => {
    const child = promisify(execFile)(process.execPath, [path.resolve('skills/trace/auto-check.mjs')], { cwd: project, env: { ...process.env, TRACE_HOME: store } });
    child.child.stdin!.end(JSON.stringify({ cwd: project, hook_event_name: 'UserPromptSubmit' }));
    await child;
  };
  await prompt();
  const dir = path.join(store, 'criteria', (await fs.readdir(path.join(store, 'criteria')))[0]);
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  for (const name of ['stale.issued', 'kept.issued', 'kept.seal']) { await fs.writeFile(path.join(dir, name), '{}'); await fs.utimes(path.join(dir, name), old, old); }
  await prompt();
  const names = await fs.readdir(dir);
  assert(!names.includes('stale.issued')); assert(names.includes('kept.issued')); assert(names.includes('kept.seal'));
  assert.equal(names.filter(n => n.endsWith('.issued')).length, 3, 'two fresh issued IDs plus the frozen one');
});

test('prompt hook prunes stale unfrozen task IDs and keeps frozen ones', async t => {
  const project = await tempRoot(t, 'prune'), store = path.join(await tempRoot(t, 'prune-store'), 'incidents');
  await promisify(execFile)('git', ['init', '-q'], { cwd: project });
  const prompt = async () => {
    const child = promisify(execFile)(process.execPath, [path.resolve('skills/trace/auto-check.mjs')], { cwd: project, env: { ...process.env, TRACE_HOME: store } });
    child.child.stdin!.end(JSON.stringify({ cwd: project, hook_event_name: 'UserPromptSubmit' }));
    await child;
  };
  await prompt();
  const [directory] = await fs.readdir(path.join(store, 'criteria')), dir = path.join(store, 'criteria', directory);
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  for (const name of ['stale.issued', 'frozen.issued', 'frozen.seal']) { await fs.writeFile(path.join(dir, name), '{}'); await fs.utimes(path.join(dir, name), old, old); }
  await prompt();
  const left = await fs.readdir(dir);
  assert(!left.includes('stale.issued'), 'stale unfrozen ID removed');
  assert(left.includes('frozen.issued') && left.includes('frozen.seal'), 'frozen task kept');
  assert.equal(left.filter(name => name.endsWith('.issued')).length, 3, 'two fresh IDs plus the frozen one remain');
});
