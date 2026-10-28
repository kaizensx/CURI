// Discovery engine: TASK_DRIVEN, FRONTIER_RECON (multi-window + independent slice), GAP_AUDIT,
// and radar velocity computed only from real snapshots. Candidates are never installed.
import { now, tx } from './db.mjs';
import { ghFetch, recordSnapshot } from './github.mjs';
import { agentRelevance } from './relevance.mjs';
import { scoreCandidate } from './score.mjs';
import { detectCapabilities, contentTokens, CAPABILITIES } from './taxonomy.mjs';
import { audit, jobEvent } from './audit-log.mjs';
import { addUrl } from './registry.mjs';

export const WINDOWS = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

export function windowStart(win, ref = new Date()) {
  const days = WINDOWS[win];
  if (!days) throw new Error(`Invalid window: ${win}`);
  return new Date(ref.getTime() - days * 86400000).toISOString().slice(0, 10);
}

// Disciplines deliberately outside the seeded catalogue, for the category-blind slice.
const OPEN_DOMAINS = ['geospatial gis', 'aerospace flight software', 'bioinformatics pipeline', 'robotics ros2', 'quantum computing', 'computational chemistry', 'music notation', 'legal document analysis', 'astronomy data', 'agriculture sensing', 'medical imaging dicom', 'finite element simulation', 'typography font tooling', 'photogrammetry', 'satellite imagery', 'circuit simulation spice', 'game engine tooling', 'accessibility assistive tech', 'climate modeling', 'genomics variant calling'];

function seededPick(arr, n, seed) {
  const a = [...arr]; let s = seed;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor(s / 233280 * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

export function planFrontierQueries(db, { windows = ['7d', '30d'], maxQueries = 8, ref = new Date(), seed = ref.getUTCDate() } = {}) {
  const caps = db.prepare('SELECT capability_id, COUNT(*) n FROM resource_capabilities GROUP BY capability_id').all();
  const weak = CAPABILITIES.filter(c => (caps.find(x => x.capability_id === c.id)?.n || 0) < 3);
  const nIndep = Math.max(1, Math.ceil(maxQueries * 0.25));
  const nGap = Math.max(0, Math.min(Math.floor(maxQueries * 0.25), maxQueries - nIndep - 1));
  const nAgent = Math.max(0, maxQueries - nIndep - nGap);
  // Interface × domain: how an agent would reach it, in a field it could not reach before.
  const agentTopics = ['topic:mcp-server', 'topic:claude-code', 'topic:agent-skills', 'topic:model-context-protocol', 'topic:computer-use', 'topic:claude-skills',
    'mcp server blender', 'mcp server cad', 'mcp server video', 'mcp server audio', 'mcp server security', 'mcp server reverse engineering', 'mcp server scientific', 'mcp server robotics', 'mcp server gis', 'mcp server spreadsheet',
    'headless cli 3d', 'command-line pcb kicad', 'cli json output', 'python api automation scientific', 'browser automation agent', 'desktop automation accessibility'];
  const agent = seededPick(agentTopics, nAgent, seed).map((t, i) => {
    const w = windows[i % windows.length];
    return { kind: 'capability-first', window: w, q: `${t} created:>=${windowStart(w, ref)} stars:>=20` };
  });
  const gaps = seededPick(weak.length ? weak : CAPABILITIES, nGap, seed + 7).map(c => ({ kind: 'gap', window: '90d', q: `${c.keywords[0]} pushed:>=${windowStart('90d', ref)} stars:>=50` }));
  const indep = seededPick(OPEN_DOMAINS, nIndep, seed + 13).map(d => ({ kind: 'independent', window: '90d', q: `${d} pushed:>=${windowStart('90d', ref)} stars:>=30` }));
  return [...agent, ...gaps, ...indep];
}

function registryCapCounts(db) {
  return new Map(db.prepare('SELECT capability_id, COUNT(*) n FROM resource_capabilities GROUP BY capability_id').all().map(r => [r.capability_id, r.n]));
}

async function runQueries(db, scanId, queries, { intentText, perQuery = 10, delayMs = 0, onEvent = () => {} }) {
  const counts = registryCapCounts(db);
  const job = `scan:${scanId}`;
  let total = 0, errors = 0;
  for (const [i, q] of queries.entries()) {
    if (i && delayMs) await new Promise(r => setTimeout(r, delayMs));
    let res;
    try {
      res = await ghFetch(db, `/search/repositories?q=${encodeURIComponent(q.q)}&sort=${q.kind === 'task' ? 'best-match' : 'stars'}&order=desc&per_page=${perQuery}`);
    } catch (e) {
      errors++;
      jobEvent(db, job, 'error', q.kind, `Query failed: ${e.message}`, q);
      onEvent({ level: 'error', q, error: e.message });
      if (e.code === 'RATE_LIMIT' || e.code === 'OFFLINE') break;
      continue;
    }
    if (res.status !== 200) { errors++; jobEvent(db, job, 'error', q.kind, `HTTP ${res.status}`, q); continue; }
    const items = res.body.items || [];
    tx(db, () => {
      for (const it of items) {
        const full = it.full_name.toLowerCase();
        const inReg = Boolean(db.prepare('SELECT 1 FROM resources WHERE gh_full_name=?').get(full));
        const rel = agentRelevance({ name: it.name, description: it.description, topics: it.topics, stars: it.stargazers_count, created_at: it.created_at, pushed_at: it.pushed_at, license: it.license?.spdx_id || null, fork: it.fork, archived: it.archived });
        const score = scoreCandidate({ queryText: intentText || q.q.replace(/\S+:\S+/g, ''), description: it.description || '', topics: it.topics || [], name: it.name, license: it.license?.spdx_id || (it.license ? 'NOASSERTION' : 'none'), pushedAt: it.pushed_at, archived: it.archived }, { registryCapCounts: counts });
        recordSnapshot(db, it, 'github-search');
        db.prepare(`INSERT OR IGNORE INTO scan_candidates(scan_id,full_name,url,description,stars,gh_created_at,gh_pushed_at,license,topics,query,query_kind,in_registry,score,decision,reason,captured_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(scanId, full, it.html_url, (it.description || '').slice(0, 500), it.stargazers_count, it.created_at, it.pushed_at, it.license?.spdx_id || null, JSON.stringify(it.topics || []), q.q, q.kind, inReg ? 1 : 0, JSON.stringify({ ...score, agent: rel }),
          score.hard_gates.length ? 'rejected' : rel.noise ? 'filtered' : 'candidate', score.hard_gates.join('; ') || rel.noise || score.note, now());
      }
    });
    total += items.length;
    jobEvent(db, job, 'info', q.kind, `${items.length} results for "${q.q}"`, { rateLimit: res.rateLimit });
    onEvent({ level: 'info', q, n: items.length });
  }
  return { total, errors };
}

export async function discover(db, { mode = 'task', intent = '', windows, maxQueries = 6, perQuery = 10, delayMs, actor = 'user', onEvent, onPlan } = {}) {
  let queries;
  if (mode === 'task') {
    if (!intent.trim()) throw new Error('Task mode needs an intent.');
    const caps = detectCapabilities(intent);
    const kw = contentTokens(intent).slice(0, 5).join(' ');
    queries = [{ kind: 'task', window: null, q: `${kw} stars:>=10` }];
    const c0 = caps[0] && CAPABILITIES.find(c => c.id === caps[0].id);
    if (c0) queries.push({ kind: 'task', window: null, q: `${c0.keywords[0]} stars:>=10` });
    // Same need, reached through agent interfaces.
    queries.push({ kind: 'task', window: null, q: `${kw} mcp stars:>=5` }, { kind: 'task', window: null, q: `${kw} cli stars:>=10` });
  } else if (mode === 'frontier') {
    queries = planFrontierQueries(db, { windows: windows || ['7d', '30d'], maxQueries });
  } else throw new Error(`Unknown discovery mode: ${mode}`);
  onPlan?.(queries);
  const scanId = db.prepare('INSERT INTO scans(mode,params,status,queries,started_at) VALUES (?,?,?,?,?)').run(mode, JSON.stringify({ intent, windows, maxQueries }), 'running', JSON.stringify(queries), now()).lastInsertRowid;
  audit(db, actor, 'discover.start', `scan:${scanId}`, { mode, queries: queries.length });
  let r;
  try {
    r = await runQueries(db, scanId, queries, { intentText: intent, perQuery, delayMs: delayMs ?? (mode === 'frontier' ? 6500 : 0), onEvent });
  } catch (e) {
    db.prepare('UPDATE scans SET status=?, error=?, finished_at=? WHERE id=?').run('failed', e.message, now(), scanId);
    throw e;
  }
  const status = r.errors && !r.total ? 'failed' : r.errors ? 'partial' : 'completed';
  db.prepare('UPDATE scans SET status=?, error=?, finished_at=? WHERE id=?').run(status, r.errors ? `${r.errors} consulta(s) falharam` : null, now(), scanId);
  const kinds = queries.reduce((m, q) => (m[q.kind] = (m[q.kind] || 0) + 1, m), {});
  audit(db, actor, 'discover.finish', `scan:${scanId}`, { status, total: r.total, kinds });
  return { scanId, status, queries, independentShare: (kinds.independent || 0) / queries.length, ...r, candidates: listCandidates(db, scanId) };
}

export function listCandidates(db, scanId, { onlyNew = false, limit = 100 } = {}) {
  return db.prepare(`SELECT * FROM scan_candidates WHERE scan_id=? ${onlyNew ? 'AND in_registry=0' : ''} ORDER BY (decision='filtered'), json_extract(score,'$.agent.score') DESC NULLS LAST, json_extract(score,'$.total') DESC NULLS LAST, stars DESC LIMIT ?`).all(scanId, limit)
    .map(c => ({ ...c, topics: JSON.parse(c.topics || '[]'), score: JSON.parse(c.score || 'null') }));
}

// Promotion catalogues the candidate as NEEDS_VERIFICATION. It never installs or executes anything.
export function promoteCandidate(db, candidateId, { actor = 'user' } = {}) {
  const c = db.prepare('SELECT * FROM scan_candidates WHERE id=?').get(candidateId);
  if (!c) throw new Error('Unknown candidate.');
  const r = addUrl(db, c.url, { source: `discovery:scan-${c.scan_id}`, actor, hints: { description: c.description, topics: JSON.parse(c.topics || '[]'), title: c.full_name.split('/')[1] }, note: `Discovered via "${c.query}" (${c.query_kind})` });
  db.prepare('UPDATE scan_candidates SET decision=\'promoted\', in_registry=1 WHERE id=?').run(candidateId);
  return r;
}

export function rejectCandidate(db, candidateId, reason, { actor = 'user' } = {}) {
  db.prepare('UPDATE scan_candidates SET decision=\'rejected\', reason=? WHERE id=?').run(String(reason || 'rejected by the user').slice(0, 500), candidateId);
  audit(db, actor, 'candidate.reject', `candidate:${candidateId}`, { reason });
}

// Star velocity only from >=2 real snapshots spanning the window; otherwise explicit insufficiency.
export function starVelocity(db, fullName, win, ref = new Date()) {
  const days = WINDOWS[win];
  const snaps = db.prepare('SELECT stars, captured_at FROM repo_snapshots WHERE full_name=? AND stars IS NOT NULL ORDER BY captured_at').all(fullName.toLowerCase());
  if (snaps.length < 2) return { window: win, status: 'insufficient_history', snapshots: snaps.length };
  const latest = snaps[snaps.length - 1];
  const target = new Date(ref.getTime() - days * 86400000);
  const base = [...snaps].reverse().find(s => new Date(s.captured_at) <= target);
  if (!base) return { window: win, status: 'insufficient_history', snapshots: snaps.length, oldest: snaps[0].captured_at };
  return { window: win, status: 'ok', delta: latest.stars - base.stars, from: base.captured_at, to: latest.captured_at };
}

export function gapAudit(db) {
  const counts = registryCapCounts(db);
  const verified = new Map(db.prepare(`SELECT rc.capability_id c, COUNT(*) n FROM resource_capabilities rc JOIN resources r ON r.id=rc.resource_id WHERE r.last_verified IS NOT NULL GROUP BY rc.capability_id`).all().map(r => [r.c, r.n]));
  const domains = {};
  for (const c of CAPABILITIES) {
    const n = counts.get(c.id) || 0;
    (domains[c.domain] ||= { domain: c.domain, capabilities: 0, resources: 0, gaps: [] });
    domains[c.domain].capabilities++;
    domains[c.domain].resources += n;
    if (n < 2) domains[c.domain].gaps.push({ id: c.id, label: c.label, resources: n, verified: verified.get(c.id) || 0 });
  }
  const unknownDesc = db.prepare('SELECT COUNT(*) n FROM resources WHERE description IS NULL').get().n;
  const unverified = db.prepare('SELECT COUNT(*) n FROM resources WHERE last_verified IS NULL').get().n;
  // Distinct resources per domain (a resource with several capabilities in one domain counts once).
  const distinct = new Map(db.prepare(`SELECT c.domain d, COUNT(DISTINCT rc.resource_id) n, COUNT(DISTINCT CASE WHEN r.last_verified IS NOT NULL THEN r.id END) v
    FROM resource_capabilities rc JOIN capabilities c ON c.id=rc.capability_id JOIN resources r ON r.id=rc.resource_id GROUP BY c.domain`).all().map(r => [r.d, r]));
  for (const d of Object.values(domains)) { d.distinct_resources = distinct.get(d.domain)?.n || 0; d.distinct_verified = distinct.get(d.domain)?.v || 0; }
  return {
    capabilities: CAPABILITIES.map(c => ({ id: c.id, label: c.label, domain: c.domain, resources: counts.get(c.id) || 0, verified: verified.get(c.id) || 0 })),
    domains: Object.values(domains),
    weak_evidence: { resources_without_description: unknownDesc, unverified_resources: unverified },
    open_domains_not_covered: OPEN_DOMAINS,
  };
}

// The user's own GitHub stars, triaged for agent relevance and reconciled with the catalogue.
export async function importStars(db, { maxPages = 5, onStage = () => {}, actor = 'user' } = {}) {
  const me = await ghFetch(db, '/user');
  if (me.status !== 200) throw Object.assign(new Error('Connect GitHub (Connections) to read your stars.'), { code: 'AUTH' });
  const login = me.body.login;
  const scanId = db.prepare('INSERT INTO scans(mode,params,status,queries,started_at) VALUES (?,?,?,?,?)').run('stars', JSON.stringify({ login }), 'running', JSON.stringify([{ kind: 'stars', q: `stars of @${login}` }]), now()).lastInsertRowid;
  let total = 0, relevant = 0, known = 0;
  for (let page = 1; page <= maxPages; page++) {
    onStage(`Reading @${login}'s stars (page ${page})`, page / (maxPages + 1));
    const r = await ghFetch(db, `/user/starred?per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.body) || !r.body.length) break;
    tx(db, () => {
      for (const it of r.body) {
        const full = it.full_name.toLowerCase();
        const inReg = Boolean(db.prepare('SELECT 1 FROM resources WHERE gh_full_name=?').get(full));
        const rel = agentRelevance({ name: it.name, description: it.description, topics: it.topics, stars: it.stargazers_count, created_at: it.created_at, pushed_at: it.pushed_at, license: it.license?.spdx_id || null, fork: it.fork, archived: it.archived });
        known += inReg ? 1 : 0;
        relevant += !rel.noise && !inReg ? 1 : 0;
        db.prepare(`INSERT OR IGNORE INTO scan_candidates(scan_id,full_name,url,description,stars,gh_created_at,gh_pushed_at,license,topics,query,query_kind,in_registry,score,decision,reason,captured_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(scanId, full, it.html_url, (it.description || '').slice(0, 500), it.stargazers_count, it.created_at, it.pushed_at, it.license?.spdx_id || null, JSON.stringify(it.topics || []), `stars of @${login}`, 'stars', inReg ? 1 : 0, JSON.stringify({ agent: rel, total: rel.score }), rel.noise ? 'filtered' : 'candidate', rel.noise, now());
      }
    });
    total += r.body.length;
    if (r.body.length < 100) break;
  }
  db.prepare('UPDATE scans SET status=?, finished_at=? WHERE id=?').run('completed', now(), scanId);
  audit(db, actor, 'github.stars', `scan:${scanId}`, { total, relevant, known });
  return { scanId, login, total, relevant, known };
}
