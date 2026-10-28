// Inspects every seed in core/data/seeds and writes core/data/seed-facts.json.
// Runs against a scratch CURI_HOME so the user's registry is untouched; the GitHub token (if any)
// comes from the Keychain like any other CURI request. Usage: node core/scripts/seed-audit.mjs [--only id,id]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.CURI_HOME) process.env.CURI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'curi-audit-'));
const { openDb } = await import('../src/db.mjs');
const { importSeeds } = await import('../src/registry.mjs');
const { inspectGithub, inspectWeb } = await import('../src/inspect.mjs');
const { CORE_ROOT } = await import('../src/paths.mjs');

const db = openDb();
importSeeds(db, undefined, { actor: 'audit' });
const only = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',')) : null;
const rows = db.prepare('SELECT id, name, canonical_url, gh_full_name FROM resources ORDER BY id').all().filter(r => !only || only.has(r.id));
const out = path.join(CORE_ROOT, 'data', 'seed-facts.json');
const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { facts: {} };
const facts = only ? prev.facts : {};
let i = 0, failed = 0;
const queue = [...rows];
async function worker() {
  for (let r = queue.shift(); r; r = queue.shift()) {
    const n = ++i;
    try {
      facts[r.id] = r.gh_full_name ? await inspectGithub(db, r.gh_full_name) : await inspectWeb(r.canonical_url);
      const f = facts[r.id];
      console.log(`[${n}/${rows.length}] ${r.id} ${f.reachable === false ? 'UNREACHABLE' : 'ok'}${f.skills ? ` skills=${f.skills.length}` : ''}${f.packages ? ` pkgs=${Object.keys(f.packages).join('+')}` : ''}`);
    } catch (e) {
      failed++;
      facts[r.id] = { error: e.message, inspected_at: new Date().toISOString() };
      console.log(`[${n}/${rows.length}] ${r.id} ERROR ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), count: Object.keys(facts).length, failed, facts }, null, 1));
console.log(`wrote ${out} (${Object.keys(facts).length} resources, ${failed} errors)`);
db.close();
