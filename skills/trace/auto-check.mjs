#!/usr/bin/env node
// Stop hook for Claude Code and Codex: from the TRACE plugin (hooks/hooks.json) or `install.mjs --agent claude --auto-check`.
// At the end of a task that changed the project, it asks the agent for one TRACE check of that change.
// It never asks twice in a row and stays silent when nothing changed.
// Off switches: plugin setting auto_check=false, TRACE_AUTO_CHECK=0, or {"autoCheck": false} in the project's .trace.json.
import { fileURLToPath } from 'node:url';
import { issue, diagnostic, gitState, projectRoot } from './criteria.mjs';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let event = {};
try { event = JSON.parse(input || '{}'); } catch {}
const project = await projectRoot(event.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const off = value => /^(0|false|off|no)$/i.test(String(value ?? '').trim());
if (off(process.env.TRACE_AUTO_CHECK) || off(process.env.CLAUDE_PLUGIN_OPTION_AUTO_CHECK)) process.exit(0);
const settings = await fs.readFile(path.join(project, '.trace.json'), 'utf8').then(JSON.parse).catch(() => ({}));
if (settings?.autoCheck === false) process.exit(0);
if (event.hook_event_name === 'UserPromptSubmit') {
  let id;
  try { id = await issue(project, 'prompt hook', event.session_id); }
  catch (error) { console.error(diagnostic(error)); process.exit(1); }
  console.log(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: `For an implementation or fix request, use TRACE's Before coding workflow now. Freeze the acceptance criteria under task ID ${id} before the first edit. Use one direct command: node "${fileURLToPath(new URL('./criteria.mjs', import.meta.url))}" freeze ${id} "user quote" "expected outcome" "concrete check" (repeat triples as needed). Use safe literal arguments. Wait for its SHA-256 before any project edit. If it fails, resolve the error or report the blocker before editing. After testing, invoke the same tool with read, the original ID and digest, and report against every returned row. For other requests continue normally.`
  } }));
  process.exit(0);
}
const snapshot = await gitState(project);
if (!snapshot) process.exit(0);
const state = JSON.stringify(snapshot);
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
