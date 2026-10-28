// Stored inspection facts per resource, plus the profile built from them for this device.
// Facts ship bundled for every seed (data/seed-facts.json, produced by scripts/seed-audit.mjs) so a
// fresh install is useful offline; "Atualizar dados" re-inspects a resource live.
import fs from 'node:fs';
import path from 'node:path';
import { CORE_ROOT } from './paths.mjs';
import { now, getPref } from './db.mjs';
import { profile } from './profile.mjs';
import { inspectGithub, inspectWeb } from './inspect.mjs';

export function getFacts(db, id) {
  const r = db.prepare('SELECT data FROM resource_facts WHERE resource_id=?').get(id);
  return r ? JSON.parse(r.data) : null;
}
export function setFacts(db, id, data, source = 'live') {
  db.prepare(`INSERT INTO resource_facts(resource_id,data,source,inspected_at) VALUES (?,?,?,?)
    ON CONFLICT(resource_id) DO UPDATE SET data=excluded.data, source=excluded.source, inspected_at=excluded.inspected_at`).run(id, JSON.stringify(data), source, data.inspected_at || now());
}

let bundled = null;
export function bundledFacts() {
  if (!bundled) { try { bundled = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'data', 'seed-facts.json'), 'utf8')); } catch { bundled = { facts: {} }; } }
  return bundled;
}
// Fills in facts for resources that have none (never overwrites a newer live inspection).
export function seedFacts(db) {
  const b = bundledFacts();
  const ins = db.prepare('INSERT OR IGNORE INTO resource_facts(resource_id,data,source,inspected_at) VALUES (?,?,?,?)');
  let n = 0;
  for (const [id, f] of Object.entries(b.facts)) {
    if (f.error || !db.prepare('SELECT 1 FROM resources WHERE id=?').get(id)) continue;
    n += ins.run(id, JSON.stringify(f), 'bundled', f.inspected_at || b.generated_at).changes;
  }
  return n;
}

export async function inspectResource(db, id) {
  const r = db.prepare('SELECT id, canonical_url, gh_full_name FROM resources WHERE id=?').get(id);
  if (!r) throw new Error('Unknown resource.');
  const f = r.gh_full_name ? await inspectGithub(db, r.gh_full_name) : await inspectWeb(r.canonical_url);
  setFacts(db, id, f, 'live');
  return f;
}

// What this device offers (package managers + runtimes), from the last system scan.
export function deviceContext(db) {
  const s = getPref(db, 'last_system_scan', null);
  const runtimes = {};
  for (const [k, v] of Object.entries(s?.runtimes || {})) if (v) runtimes[k === 'python3' ? 'python' : k] = true;
  for (const b of Object.keys(s?.binaries || {})) runtimes[b] = true;
  if (s?.agents?.some(a => a.id === 'claude-code' && a.present)) runtimes.claude = true;
  return { managers: s?.managers || {}, runtimes };
}

export function profileFor(db, id, ctx = deviceContext(db)) {
  const r = db.prepare('SELECT * FROM resources WHERE id=?').get(id);
  if (!r) return null;
  const mine = (getPref(db, 'user_marks', {}))[id] || {};
  return profile(r, getFacts(db, id), { ...ctx, user: mine });
}
