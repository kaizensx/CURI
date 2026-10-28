// Discovery candidates are inspected the same way catalogue resources are, so Discover only offers what
// the app can actually install or connect here, and installs it in one step.
import { now, tx } from './db.mjs';
import { inspectGithub } from './inspect.mjs';
import { profile } from './profile.mjs';
import { deviceContext, setFacts } from './facts.mjs';
import { promoteCandidate } from './discover.mjs';

export function installSummary(fullName, facts, ctx) {
  const r = { id: `gh:${fullName}`, name: fullName.split('/')[1], type: 'Tool', gh_full_name: fullName, canonical_url: `https://github.com/${fullName}` };
  const p = profile(r, facts, ctx);
  const opts = p.options.filter(o => !o.shared && o.supported_here && o.method !== 'download');
  return { installable: opts.length > 0, ready: opts.some(o => o.ready), kind: p.kind, kind_label: p.kind_label, how: p.agent_use, options: opts.slice(0, 4).map(o => ({ label: o.label, method: o.method, ready: o.ready, missing: o.missing })) };
}

export function candidateInstall(db, fullName) {
  const r = db.prepare('SELECT install FROM candidate_facts WHERE full_name=?').get(fullName.toLowerCase());
  return r ? JSON.parse(r.install) : null;
}

// Inspect the most promising uninspected candidates (bounded per run to respect GitHub limits).
export async function inspectCandidates(db, { limit = 15, onStage = () => {}, cancelled = () => false } = {}) {
  const { agentRelevance } = await import('./relevance.mjs');
  const rows = db.prepare(`SELECT DISTINCT c.full_name, c.description, c.topics, c.stars, c.gh_created_at, c.gh_pushed_at, c.license FROM scan_candidates c
    LEFT JOIN candidate_facts f ON f.full_name = c.full_name WHERE f.full_name IS NULL AND c.in_registry = 0 AND c.decision IN ('candidate','filtered')`).all()
    .map(c => ({ ...c, rel: agentRelevance({ name: c.full_name.split('/')[1], description: c.description, topics: JSON.parse(c.topics || '[]'), stars: c.stars, created_at: c.gh_created_at, pushed_at: c.gh_pushed_at, license: c.license }) }))
    .filter(c => !c.rel.noise).sort((a, b) => b.rel.score - a.rel.score).slice(0, limit);
  const ctx = deviceContext(db);
  let installable = 0;
  for (const [i, c] of rows.entries()) {
    if (cancelled()) break;
    onStage(`Inspecting ${c.full_name} (${i + 1}/${rows.length})`, (i + 1) / (rows.length + 1));
    let facts;
    try { facts = await inspectGithub(db, c.full_name); } catch (e) { facts = { error: e.message }; }
    const sum = facts.reachable ? installSummary(c.full_name, facts, ctx) : { installable: false, reason: facts.error || 'unreachable' };
    installable += sum.installable ? 1 : 0;
    db.prepare('INSERT OR REPLACE INTO candidate_facts(full_name,data,install,inspected_at) VALUES (?,?,?,?)').run(c.full_name, JSON.stringify(facts), JSON.stringify(sum), now());
  }
  return { inspected: rows.length, installable };
}

// One step from a discovery to a working install: catalogue it with its facts, then return the action.
export function adoptCandidate(db, candidateId) {
  const c = db.prepare('SELECT * FROM scan_candidates WHERE id=?').get(candidateId);
  if (!c) throw new Error('Unknown candidate.');
  const f = db.prepare('SELECT data FROM candidate_facts WHERE full_name=?').get(c.full_name);
  let r;
  try { r = promoteCandidate(db, candidateId); } catch (e) { r = db.prepare('SELECT id, name FROM resources WHERE gh_full_name=?').get(c.full_name); if (!r) throw e; }
  if (f) setFacts(db, r.id, JSON.parse(f.data), 'live');
  return r;
}
