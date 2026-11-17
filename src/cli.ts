#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { Store, boundedRead, noLinks } from './store.js';
import { freezeOracle, verify } from './verify.js';
import { installSkill, uninstallSkill } from '../install.mjs';
import { VERSION } from './types.js';
import { automatic, discover } from './automatic.js';
import { freezeCheckPlan, executeChecks } from './checks.js';

const help = `TRACE ${VERSION} — local experiment; provisional name
  Primary entry: bare @trace in Codex or /trace in Claude Code. No arguments required.
  Internal skill tools:
  trace-local discover --project .
  trace-local inspect --project . [--url <local-app>] --share-with-current-agent
  trace-local run --project . --url <local-app> --file <flow.json> --share-with-current-agent --allow-local-side-effects
  trace-local plan --project . --file <checks.json>
  trace-local check <id> --project . --plan-sha <sha> [--allow-local-execution] [--allow-local-side-effects]
  trace-local incident <id>
  trace-local evidence <id> --after 0 --limit 25 [--kind response]
  trace-local oracle <id> --file oracle.json
  trace-local verify <id> --project . --url <original-origin> --oracle-sha <sha> --allow-local-side-effects
  trace-local revoke <id> | delete <id>
  trace-local export <id> --out <new-directory>
  trace-local install-skill --project . [--agent codex|claude] [--auto-check] | uninstall-skill --project . [--agent codex|claude]
All commands accept --store <outside-project-directory> (or TRACE_HOME).
No agent messages, model calls, telemetry or automatic uploads. Verification may change local app data.
`;
try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    url: { type: 'string' }, project: { type: 'string' }, store: { type: 'string' }, agent: { type: 'string' }, after: { type: 'string' }, limit: { type: 'string' }, kind: { type: 'string' }, file: { type: 'string' }, out: { type: 'string' }, inputs: { type: 'string' }, 'oracle-sha': { type: 'string' }, 'plan-sha': { type: 'string' }, 'allow-local-execution': { type: 'boolean' }, 'allow-local-side-effects': { type: 'boolean' }, 'share-with-current-agent': { type: 'boolean' }, 'auto-check': { type: 'boolean' }, help: { type: 'boolean' }, version: { type: 'boolean' }
  } });
  const [command, id] = positionals;
  // Keep this default in sync with the standalone skills/trace/criteria.mjs.
  const root = values.store || process.env.TRACE_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'trace-local', 'incidents');
  const store = new Store(root);
  const project = path.resolve(values.project || '.');
  if (values.version) console.log(VERSION);
  else if (!command || values.help) console.log(help);
  else switch (command) {
    case 'plan': if (!values.file) throw new Error('--file is required.'); console.log(JSON.stringify(await freezeCheckPlan(store, project, JSON.parse(await boundedRead(path.resolve(values.file), 30000))))); break;
    case 'check': {
      if (!values['plan-sha']) throw new Error('--plan-sha is required.');
      const result = await executeChecks(store, id, { project, planSha: values['plan-sha'], allowLocalExecution: !!values['allow-local-execution'], allowLocalSideEffects: !!values['allow-local-side-effects'] }); console.log(JSON.stringify(result, null, 2)); if (result.results.some(r => !['passed', 'verified fix'].includes(r.status))) process.exitCode = 2; break;
    }
    case 'discover': console.log(JSON.stringify(await discover(project, values.url), null, 2)); break;
    case 'inspect': case 'run': {
      if (command === 'run' && !values.file) throw new Error('A bounded action flow --file is required.');
      const result = await automatic({ project, url: values.url, store, flow: command === 'run' ? JSON.parse(await boundedRead(path.resolve(values.file!), 30000)) : undefined, shareWithCurrentAgent: !!values['share-with-current-agent'], allowLocalSideEffects: !!values['allow-local-side-effects'] });
      console.log(JSON.stringify(result, null, 2)); break;
    }
    case 'incident': {
      const incident = await store.read(id); console.log(incident.brief);
      if (incident.manifest.attachments.length) console.log('Approved images (open with your image-viewing tool):\n' + incident.manifest.attachments.map(name => path.join(store.dir(id), 'approved', name)).join('\n'));
      break;
    }
    case 'evidence': {
      const after = Number(values.after || 0), limit = Number(values.limit || 25);
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('Use a nonnegative sequence and limit 1–50.');
      const incident = await store.read(id), candidates = incident.events.filter(e => e.seq > after && (!values.kind || e.kind === values.kind));
      const events = candidates.slice(0, limit); console.log(JSON.stringify({ events, nextAfter: events.at(-1)?.seq ?? after, more: candidates.length > events.length })); break;
    }
    case 'oracle': if (!values.file) throw new Error('--file is required.'); console.log(await freezeOracle(store, id, JSON.parse(await boundedRead(path.resolve(values.file), 30000)))); break;
    case 'verify': {
      if (!values.url || !values['oracle-sha']) throw new Error('--url and --oracle-sha are required.');
      const inputs = values.inputs ? JSON.parse(await boundedRead(path.resolve(values.inputs), 16000)) : undefined;
      const result = await verify(store, id, { project, url: values.url, oracleSha: values['oracle-sha'], allowLocalSideEffects: !!values['allow-local-side-effects'], inputs });
      console.log(JSON.stringify(result, null, 2)); if (result.status !== 'verified within stated checks') process.exitCode = 2; break;
    }
    case 'revoke': await store.revoke(id); console.log('Approval revoked. Already sent copies cannot be retracted.'); break;
    case 'delete': await store.remove(id); console.log('Incident deleted. Disk snapshots/backups and already sent copies are unaffected.'); break;
    case 'export': {
      if (!values.out) throw new Error('--out must name a new directory you chose.');
      await store.read(id); const destination = path.resolve(values.out); await noLinks(destination);
      await fs.mkdir(destination); await fs.cp(path.join(store.dir(id), 'approved'), destination, { recursive: true, errorOnExist: true, force: false }); console.log(`Approved copy exported to ${destination}`); break;
    }
    case 'install-skill': case 'uninstall-skill': {
      const host = values.agent || 'codex'; if (host !== 'codex' && host !== 'claude') throw new Error('Use --agent codex or --agent claude.');
      console.log(command === 'install-skill' ? await installSkill(project, host, { autoCheck: !!values['auto-check'] }) : await uninstallSkill(project, host)); break;
    }
    default: throw new Error(`Unknown command.\n${help}`);
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'TRACE operation failed.'); process.exitCode = 1; }
