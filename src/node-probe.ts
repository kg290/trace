import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { sanitize } from './privacy.js';

const [entry, exported, args, expectation, output] = process.argv.slice(2);
const expected: { equals?: unknown; throws?: string } = JSON.parse(expectation);
const write = (value: unknown) => fs.writeFile(output, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
let fn: (...args: unknown[]) => unknown;
try {
  const module = await import(pathToFileURL(entry).href);
  fn = module[exported] ?? module.default?.[exported];
  if (typeof fn !== 'function') throw new Error('The selected public export is not a function.');
} catch (error) {
  await write({ ok: false, error: sanitize(error instanceof Error ? error.message : 'Library invocation failed') });
  process.exit(1);
}
try {
  const value = await fn(...JSON.parse(args));
  const result = JSON.stringify({ ok: true, matches: !('throws' in expected) && isDeepStrictEqual(value, expected.equals), value: sanitize(value) });
  if (Buffer.byteLength(result) > 16000) throw new Error('Library result exceeds the bounded JSON interface.');
  await fs.writeFile(output, result, { flag: 'wx', mode: 0o600 });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // An expected error is the contract here, not a failure of the probe.
  if ('throws' in expected) await write({ ok: true, matches: message === expected.throws, threw: sanitize(message) });
  else { await write({ ok: false, error: sanitize(message) }); process.exitCode = 1; }
}
