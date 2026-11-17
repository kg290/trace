#!/usr/bin/env node
// Stop hook for Claude Code and Codex: from the TRACE plugin (hooks/hooks.json) or `install.mjs --agent claude --auto-check`.
// At the end of a task that changed the project, it asks the agent for one TRACE check of that change.
// It never asks twice in a row and stays silent when nothing changed.
// Off switches: plugin setting auto_check=false, TRACE_AUTO_CHECK=0, or {"autoCheck": false} in the project's .trace.json.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let event = {};
try { event = JSON.parse(input || '{}'); } catch {}
const project = path.resolve(event.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const off = value => /^(0|false|off|no)$/i.test(String(value ?? '').trim());
if (off(process.env.TRACE_AUTO_CHECK) || off(process.env.CLAUDE_PLUGIN_OPTION_AUTO_CHECK)) process.exit(0);
const settings = await fs.readFile(path.join(project, '.trace.json'), 'utf8').then(JSON.parse).catch(() => ({}));
if (settings?.autoCheck === false) process.exit(0);
const git = args => execFileSync('git', args, { cwd: project, encoding: 'utf8', maxBuffer: 64_000_000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
let state;
// shortcut: git projects only; without git there is no cheap, reliable "this task changed something" signal.
try {
  const hash = createHash('sha256').update(git(['diff']) + '\0' + git(['diff', '--cached']));
  // Untracked files have no diff; their size and modification time show edits.
  for (const name of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).slice(0, 5000)) {
    const stat = await fs.stat(path.join(project, name)).catch(() => null);
    hash.update(`\0${name}:${stat?.size}:${stat?.mtimeMs}`);
  }
  state = hash.digest('hex');
} catch { process.exit(0); }
const marker = path.join(os.tmpdir(), 'trace-auto-check', createHash('sha256').update(project).digest('hex') + '.txt');
const previous = await fs.readFile(marker, 'utf8').catch(() => null);
await fs.mkdir(path.dirname(marker), { recursive: true });
await fs.writeFile(marker, state);
// First run only records the starting state. stop_hook_active means this stop follows our own request.
if (previous === null || previous === state || event.stop_hook_active) process.exit(0);
console.log(JSON.stringify({
  decision: 'block',
  reason: 'TRACE auto-check (task boundary): the project changed during this task. If that was a code change, use the trace skill now to check only the change just completed, then give its compact report. If it was not a code change, say so in one line and stop.'
}));
