import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = process.cwd(), documents = [];
async function collect(name) {
  if (name.replaceAll('\\', '/').startsWith('docs/evidence')) return;
  const stat = await fs.lstat(name);
  if (stat.isDirectory()) for (const entry of await fs.readdir(name)) await collect(path.join(name, entry));
  else if (stat.isFile() && name.endsWith('.md')) documents.push(name);
}
for (const name of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md', 'docs', 'skills', 'examples', '.github']) await collect(name);
let links = 0;
for (const name of documents) {
  const text = await fs.readFile(name, 'utf8');
  assert(!/(?:\b[A-Za-z]:[\\/]|file:\/\/|\/Users\/)/i.test(text), `Private machine path in ${name}`);
  assert.equal((text.match(/^```/gm) || []).length % 2, 0, `Unclosed code fence in ${name}`);
  const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  for (const match of prose.matchAll(/!?\[([^\]]*)\]\(([^)\n]+)\)/g)) {
    const href = match[2].split('#')[0];
    if (!href || /^(https?:|mailto:)/i.test(href)) continue;
    const target = path.resolve(path.dirname(name), decodeURIComponent(href));
    assert(target.startsWith(root + path.sep), `Link escapes repository: ${name} -> ${href}`);
    assert((await fs.stat(target)).isFile(), `Missing document/asset: ${name} -> ${href}`); links++;
  }
}
for (const name of ['profile-initial', 'profile-false-saved', 'profile-lost', 'profile-verified']) {
  const bytes = await fs.readFile(`docs/assets/${name}.png`);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(bytes.readUInt32BE(16), 1377); assert.equal(bytes.readUInt32BE(20), 915);
}
const report = JSON.parse(await fs.readFile('docs/native-validation.json', 'utf8'));
assert.equal(report.before.criteriaSha, report.after.criteriaSha);
assert.equal(createHash('sha256').update(await fs.readFile('docs/native-criteria.json')).digest('hex'), report.before.criteriaSha);
assert(report.before.checks.some(check => !check.passed)); assert(report.after.checks.every(check => check.passed));
console.log(`${documents.length} Markdown documents, ${links} local links, four original PNGs, and unchanged native criteria checked.`);
