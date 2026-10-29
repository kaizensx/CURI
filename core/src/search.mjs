// Intent search: capability inference + FTS5 bm25 with field weights + transparent explanation.
import { detectCapabilities, contentTokens, SYNONYMS, fold } from './taxonomy.mjs';

const DISCOVERY_INTENT = /(registry|directory|diretorio|catalog|catalogo|awesome|trending|marketplace|find skill|procurar skill|discover)/;

function ftsQuery(q) {
  const toks = contentTokens(q);
  const expanded = new Set();
  for (const t of toks) {
    expanded.add(t);
    for (const s of SYNONYMS[t] || []) expanded.add(s);
  }
  const parts = [...expanded].map(t => t.replace(/["*]/g, '')).filter(t => t.length >= 2).map(t => (t.length >= 4 ? `"${t}"*` : `"${t}"`));
  return { expr: parts.join(' OR '), terms: [...expanded] };
}

export function search(db, query, { limit = 10, type, status, capability, tier, license, includeRegistries } = {}) {
  const q = String(query || '').slice(0, 500);
  const intents = detectCapabilities(q);
  const intentIds = intents.map(i => i.id);
  const { expr, terms } = ftsQuery(q);
  const scores = new Map();
  const bump = (id, key, v, why) => {
    const s = scores.get(id) || { id, cap: 0, text: 0, why: [] };
    s[key] += v;
    if (why) s.why.push(why);
    scores.set(id, s);
  };

  if (expr) {
    let rows = [];
    try {
      rows = db.prepare(`SELECT id, bm25(resources_fts, 0, 10, 8, 5, 3, 2, 2, 1) AS rank FROM resources_fts WHERE resources_fts MATCH ? ORDER BY rank LIMIT 200`).all(expr);
    } catch { rows = []; }
    const best = rows.length ? -rows[0].rank : 1;
    for (const r of rows) bump(r.id, 'text', best > 0 ? (-r.rank) / best : 0, null);
  }
  if (intentIds.length) {
    const totalW = intents.reduce((a, i) => a + i.weight, 0);
    const rows = db.prepare(`SELECT resource_id, capability_id, origin FROM resource_capabilities WHERE capability_id IN (${intentIds.map(() => '?').join(',')})`).all(...intentIds);
    for (const r of rows) {
      const i = intents.find(x => x.id === r.capability_id);
      bump(r.resource_id, 'cap', i.weight / totalW, `capacidade:${r.capability_id}`);
    }
  }

  const wantRegistries = includeRegistries ?? DISCOVERY_INTENT.test(fold(q));
  const getR = db.prepare('SELECT id, name, type, status, tier, canonical_url, description, use_when, avoid_when, license, last_verified, risk_notes, paid_auth FROM resources WHERE id=?');
  let results = [];
  for (const s of scores.values()) {
    const r = getR.get(s.id);
    if (!r) continue;
    if (type && r.type !== type) continue;
    if (status && r.status !== status) continue;
    if (tier && r.tier !== tier) continue;
    if (license && !fold(r.license).includes(fold(license))) continue;
    if (capability && !db.prepare('SELECT 1 FROM resource_capabilities WHERE resource_id=? AND capability_id=?').get(r.id, capability)) continue;
    let score = s.cap * 0.6 + s.text * 0.4;
    const adj = [];
    if (r.type === 'Registry' && !wantRegistries) { score *= 0.6; adj.push('directory or discovery source (penalised)'); }
    if (r.status === 'REJECTED' || r.status === 'DEPRECATED') { score *= 0.3; adj.push(`estado ${r.status}`); }
    // "alternative to X": X is the reference point, not an answer.
    if (/alternativ/.test(fold(q)) && contentTokens(r.name).some(t => t.length >= 3 && fold(q).split(/\W+/).includes(t))) { score *= 0.4; adj.push('is the resource being compared against'); }
    if (r.last_verified) { score += 0.03; adj.push('verified source'); }
    if (r.status === 'INSTALLED' || r.status === 'CONFIGURED') { score += 0.05; adj.push('already available locally'); }
    results.push({
      ...r,
      score: Math.round(score * 1000) / 1000,
      explanation: {
        matched_capabilities: [...new Set(s.why.map(w => w.replace('capacidade:', '')))],
        text_match: Math.round(s.text * 100) / 100,
        adjustments: adj,
        verified: Boolean(r.last_verified),
      },
    });
  }
  results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  results = results.slice(0, Math.max(1, Math.min(limit, 100)));
  return {
    query: q,
    intent: { capabilities: intents.map(i => ({ id: i.id, label: i.label, matched: i.matched })), domains: [...new Set(intents.map(i => i.domain))], terms },
    coverage: results.length ? (results[0].score >= 0.35 ? 'strong' : 'weak') : 'none',
    advice: !results.length || results[0].score < 0.35
      ? 'Thin local coverage: consider external discovery (curi discover --mode task) and check primary sources.'
      : 'Enough local coverage: check the chosen resource\'s official docs before using its APIs.',
    results,
  };
}

export function compare(db, ids) {
  const fields = ['name', 'type', 'status', 'tier', 'license', 'canonical_url', 'description', 'use_when', 'avoid_when', 'risk_notes', 'paid_auth', 'last_verified'];
  const items = ids.map(id => {
    const r = db.prepare('SELECT * FROM resources WHERE id=?').get(id);
    if (!r) return { id, missing: true };
    const caps = db.prepare('SELECT capability_id FROM resource_capabilities WHERE resource_id=?').all(id).map(c => c.capability_id);
    const snap = r.gh_full_name ? db.prepare('SELECT stars, pushed_at, latest_release, archived, captured_at FROM repo_snapshots WHERE full_name=? ORDER BY captured_at DESC LIMIT 1').get(r.gh_full_name) : null;
    const ev = db.prepare('SELECT class, COUNT(*) n FROM evidence WHERE resource_id=? GROUP BY class').all(id);
    return { id, ...Object.fromEntries(fields.map(f => [f, r[f] ?? null])), capabilities: caps, latest_snapshot: snap || null, evidence: Object.fromEntries(ev.map(e => [e.class, e.n])) };
  });
  const present = items.filter(i => !i.missing);
  const all = new Set(present.flatMap(i => i.capabilities));
  const shared = [...all].filter(c => present.every(i => i.capabilities.includes(c)));
  const missingEvidence = present.flatMap(i => [
    !i.last_verified && `${i.id}: source never checked`,
    i.license === 'unknown' && `${i.id}: unknown licence`,
    !i.latest_snapshot && `${i.id}: no maintenance or activity snapshot`,
  ].filter(Boolean));
  return { items, shared_capabilities: shared, unique_capabilities: Object.fromEntries(present.map(i => [i.id, i.capabilities.filter(c => !shared.includes(c))])), missing_evidence: missingEvidence };
}
