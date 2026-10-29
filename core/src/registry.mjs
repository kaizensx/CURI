// Authoritative resource registry: identity, classification, seed import, FTS indexing, export/import.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { now, tx } from './db.mjs';
import { normalizeUrl, githubRepo, githubTopic, slugId, extractUrls } from './url.mjs';
import { CAPABILITIES, CAP_BY_ID, detectCapabilities, fold } from './taxonomy.mjs';
import { audit } from './audit-log.mjs';
import { CORE_ROOT, paths } from './paths.mjs';

export const STATUSES = ['INSTALLED', 'CONFIGURED', 'CATALOGUED', 'ON_DEMAND', 'REQUIRES_AUTHENTICATION', 'REQUIRES_APPROVAL', 'UNSUPPORTED', 'DEPRECATED', 'UNAVAILABLE', 'NEEDS_VERIFICATION', 'PENDING_REVIEW', 'REJECTED'];
export const TYPES = ['Skill', 'Plugin', 'MCP', 'Library', 'Framework', 'Tool', 'Documentation', 'Registry', 'Template', 'Inspiration'];
export const EXPORT_FORMAT = 'curi-registry-export';
export const EXPORT_VERSION = 1;

let ENRICH;
function enrichment() {
  if (!ENRICH) {
    const raw = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'data', 'enrichment.json'), 'utf8')).resources;
    ENRICH = new Map(Object.entries(raw).map(([u, v]) => [normalizeUrl(u), v]));
  }
  return ENRICH;
}

export function ensureCapabilities(db) {
  const ins = db.prepare('INSERT INTO capabilities(id,label,domain) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label, domain=excluded.domain');
  for (const c of CAPABILITIES) ins.run(c.id, c.label, c.domain);
}

// The curated capability links ship with the app. The seed import only runs on an empty registry, so on
// every launch the links are added to resources already catalogued: a new capability in an update shows
// up with its providers without re-importing anything. Never removes a link.
export function syncCuratedCapabilities(db) {
  ensureCapabilities(db);
  const find = db.prepare('SELECT resource_id id FROM resource_urls WHERE url_normalized=? LIMIT 1');
  const ins = db.prepare("INSERT OR IGNORE INTO resource_capabilities(resource_id,capability_id,origin) VALUES (?,?,'curator')");
  let added = 0;
  for (const [url, e] of enrichment()) {
    if (!e.c?.length) continue;
    const r = find.get(url);
    if (r) for (const cap of e.c) if (CAP_BY_ID.has(cap)) added += Number(ins.run(r.id, cap).changes);
  }
  return added;
}

// ---------- seed parsing ----------
export const SEED_FILES = ['catalog.md', 'frontier.md'].map(f => path.join(paths.seedsDir, f));
function sectionOf(line) {
  return line.startsWith('## ') ? line.slice(3).trim() : null;
}

export function parseSeedFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  let section = 'unsectioned';
  const out = [];
  lines.forEach((line, i) => {
    const s = sectionOf(line);
    if (s) section = s;
    for (const { url } of extractUrls(line)) out.push({ url, line: i + 1, section, source: path.basename(file) });
  });
  return { text, sha256: crypto.createHash('sha256').update(text).digest('hex'), entries: out };
}

function sectionTag(section) {
  return fold(section).replace(/^[a-j0-9]+\.\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// ---------- classification ----------
export function classify(url, { section = '', title = '', description = '', topics = [] } = {}) {
  const norm = normalizeUrl(url);
  const e = enrichment().get(norm);
  const gh = githubRepo(url);
  const topic = githubTopic(url);
  const text = [title, description, topics.join(' '), gh ? gh.repo.replace(/[-_]/g, ' ') : '', topic ? topic.replace(/-/g, ' ') : ''].join(' ');
  const detected = detectCapabilities(text).map(h => h.id);
  let type = e?.t;
  if (!type) {
    if (topic || /trending|directory|registry|awesome|marketplace/.test(norm)) type = 'Registry';
    else if (/mcp/.test(fold(text))) type = 'MCP';
    else if (/skill/.test(fold(text))) type = 'Skill';
    else if (gh) type = 'Tool';
    else type = 'Documentation';
  }
  const caps = [...new Set([...(e?.c || []), ...detected])].filter(c => CAP_BY_ID.has(c));
  if (topic && !caps.includes('github-discovery')) caps.push('github-discovery');
  const name = e?.n || (gh ? gh.repo : topic ? `GitHub topic: ${topic}` : new URL(norm).hostname);
  return {
    id: slugId(e?.alias_of || url),
    aliasOf: e?.alias_of ? normalizeUrl(e.alias_of) : null,
    name,
    canonical_url: norm,
    gh_full_name: gh?.fullName ?? null,
    type,
    caps,
    capOrigins: Object.fromEntries(caps.map(c => [c, e?.c?.includes(c) ? 'curator' : 'keyword'])),
    primary_category: caps[0] ? CAP_BY_ID.get(caps[0]).domain : (sectionTag(section) || 'uncategorized'),
    description: description || e?.d || null,
    use_when: e?.u || null,
    avoid_when: e?.a || (type === 'Registry' ? 'Discovery source only — never an install authorization.' : null),
    tier: e?.tier || 'catalog',
    license: e?.lic || 'unknown',
    paid_auth: e?.paid || null,
    risk_notes: e?.risk || null,
    provenance: e ? 'curator-model-knowledge' : 'heuristic',
  };
}

// ---------- write path ----------
export function indexResource(db, id) {
  const r = db.prepare('SELECT * FROM resources WHERE id=?').get(id);
  db.prepare('DELETE FROM resources_fts WHERE id=?').run(id);
  if (!r) return;
  const aliases = db.prepare('SELECT alias FROM aliases WHERE resource_id=?').all(id).map(a => a.alias);
  const urls = db.prepare('SELECT DISTINCT url_original FROM resource_urls WHERE resource_id=?').all(id).map(u => u.url_original);
  const caps = db.prepare('SELECT c.id, c.label FROM resource_capabilities rc JOIN capabilities c ON c.id=rc.capability_id WHERE rc.resource_id=?').all(id);
  const tags = db.prepare('SELECT tag FROM tags WHERE resource_id=?').all(id).map(t => t.tag);
  db.prepare('INSERT INTO resources_fts(id,name,aliases,capabilities,tags,description,use_when,url) VALUES (?,?,?,?,?,?,?,?)').run(
    id, r.name, aliases.join(' ; '), caps.map(c => `${c.id.replace(/-/g, ' ')} ${c.label}`).join(' ; '),
    [...tags, r.type, r.primary_category].join(' ; '), r.description || '', [r.use_when, r.avoid_when].filter(Boolean).join(' '), [r.canonical_url, ...urls].join(' '));
}

export function findByUrl(db, url) {
  const norm = normalizeUrl(url);
  const gh = githubRepo(url);
  return db.prepare(`SELECT r.* FROM resources r WHERE r.canonical_url=? OR r.id IN (SELECT resource_id FROM resource_urls WHERE url_normalized=?)
    ${gh ? 'OR r.gh_full_name=?' : ''} LIMIT 1`).get(...(gh ? [norm, norm, gh.fullName] : [norm, norm]));
}

function upsertFromClassification(db, c, { status, source, section, line, batchId, url, actor }) {
  const ts = now();
  let existing = findByUrl(db, url) || (c.aliasOf ? findByUrl(db, c.aliasOf) : null);
  let created = false;
  if (!existing) {
    db.prepare(`INSERT INTO resources(id,name,canonical_url,gh_full_name,type,primary_category,description,use_when,avoid_when,tier,license,status,paid_auth,risk_notes,provenance,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(c.id, c.name, c.aliasOf || c.canonical_url, c.aliasOf ? null : c.gh_full_name, c.type, c.primary_category, c.description, c.use_when, c.avoid_when, c.tier, c.license, status, c.paid_auth, c.risk_notes, c.provenance, ts, ts);
    existing = db.prepare('SELECT * FROM resources WHERE id=?').get(c.id);
    created = true;
  } else if (c.gh_full_name && !existing.gh_full_name && !db.prepare('SELECT 1 FROM resources WHERE gh_full_name=?').get(c.gh_full_name)) {
    db.prepare('UPDATE resources SET gh_full_name=?, updated_at=? WHERE id=?').run(c.gh_full_name, ts, existing.id);
  }
  const id = existing.id;
  db.prepare('INSERT OR IGNORE INTO resource_urls(resource_id,url_original,url_normalized,source,section,source_line,batch_id,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, url, normalizeUrl(url), source, section, line ?? null, batchId ?? null, ts);
  const insCap = db.prepare('INSERT OR IGNORE INTO resource_capabilities(resource_id,capability_id,origin) VALUES (?,?,?)');
  for (const cap of c.caps) insCap.run(id, cap, c.capOrigins[cap]);
  if (section) db.prepare('INSERT OR IGNORE INTO tags(resource_id,tag) VALUES (?,?)').run(id, sectionTag(section));
  if (c.name !== existing.name) db.prepare('INSERT OR IGNORE INTO aliases(resource_id,alias) VALUES (?,?)').run(id, c.name);
  if (created && c.provenance === 'curator-model-knowledge' && c.description) {
    db.prepare('INSERT INTO evidence(resource_id,kind,class,summary,source_url,captured_at) VALUES (?,?,?,?,?,?)')
      .run(id, 'classification', 'speculative', 'Initial description/capabilities from curator knowledge (not verified).', null, ts);
  }
  indexResource(db, id);
  return { id, created };
}

export function importSeeds(db, files = SEED_FILES, { dryRun = false, actor = 'system' } = {}) {
  ensureCapabilities(db);
  const report = { files: [], urlOccurrences: 0, uniqueOriginalUrls: 0, created: 0, linkedExisting: 0, invalid: [], dryRun };
  const all = [];
  for (const f of files) {
    const p = parseSeedFile(f);
    report.files.push({ file: path.basename(f), sha256: p.sha256, urls: p.entries.length });
    all.push(...p.entries.map(e => ({ ...e, fileSha: p.sha256 })));
  }
  report.urlOccurrences = all.length;
  report.uniqueOriginalUrls = new Set(all.map(e => e.url)).size;
  // Alias targets first so alias URLs attach to an existing canonical record.
  const aliasTargets = new Set([...enrichment().values()].map(v => v.alias_of && normalizeUrl(v.alias_of)).filter(Boolean));
  all.sort((a, b) => Number(aliasTargets.has(safeNorm(b.url))) - Number(aliasTargets.has(safeNorm(a.url))));
  const before = db.prepare('SELECT COUNT(*) n FROM resources').get().n;
  const run = () => {
    const batchId = dryRun ? null : db.prepare('INSERT INTO import_batches(source,sha256,counts,created_at) VALUES (?,?,?,?)').run(files.map(f => path.basename(f)).join('+'), report.files.map(f => f.sha256).join(','), null, now()).lastInsertRowid;
    for (const e of all) {
      let c;
      try { c = classify(e.url, { section: e.section }); } catch (err) { report.invalid.push({ url: e.url, error: err.message }); continue; }
      if (dryRun) continue;
      const r = upsertFromClassification(db, c, { status: 'CATALOGUED', source: e.source, section: e.section, line: e.line, batchId, url: e.url, actor });
      if (r.created) report.created++; else report.linkedExisting++;
    }
    report.resourcesBefore = before;
    report.resourcesAfter = db.prepare('SELECT COUNT(*) n FROM resources').get().n;
    if (!dryRun) {
      db.prepare('UPDATE import_batches SET counts=? WHERE id=?').run(JSON.stringify(report), batchId);
      audit(db, actor, 'seed.import', report.files.map(f => f.file).join('+'), { created: report.created, linked: report.linkedExisting, invalid: report.invalid.length });
    }
  };
  if (dryRun) run(); else tx(db, run);
  return report;
}

function safeNorm(u) { try { return normalizeUrl(u); } catch { return u; } }

// Adds a single user/agent-supplied URL. Never marks INSTALLED; new records start NEEDS_VERIFICATION
// (or PENDING_REVIEW when coming from an agent).
export function addUrl(db, url, { source = 'user', note = null, actor = 'user', pending = false, hints = {} } = {}) {
  ensureCapabilities(db);
  normalizeUrl(url); // throws on invalid input
  const existing = findByUrl(db, url);
  const c = classify(url, hints);
  const res = tx(db, () => {
    const r = upsertFromClassification(db, c, { status: pending ? 'PENDING_REVIEW' : 'NEEDS_VERIFICATION', source, section: hints.section || null, url, actor });
    if (note) db.prepare('INSERT INTO evidence(resource_id,kind,class,summary,captured_at) VALUES (?,?,?,?,?)').run(r.id, 'note', 'community', String(note).slice(0, 2000), now());
    audit(db, actor, existing ? 'resource.sighting' : 'resource.add', r.id, { url, source });
    return r;
  });
  return { ...getResource(db, res.id), duplicate: Boolean(existing) };
}

export function getResource(db, id) {
  const r = db.prepare('SELECT * FROM resources WHERE id=?').get(id);
  if (!r) return null;
  return {
    ...r,
    capabilities: db.prepare('SELECT c.id, c.label, rc.origin FROM resource_capabilities rc JOIN capabilities c ON c.id=rc.capability_id WHERE rc.resource_id=? ORDER BY c.id').all(id),
    tags: db.prepare('SELECT tag FROM tags WHERE resource_id=?').all(id).map(t => t.tag),
    aliases: db.prepare('SELECT alias FROM aliases WHERE resource_id=?').all(id).map(a => a.alias),
    urls: db.prepare('SELECT url_original, source, section, source_line, created_at FROM resource_urls WHERE resource_id=? ORDER BY id').all(id),
    evidence: db.prepare('SELECT kind, class, summary, source_url, captured_at FROM evidence WHERE resource_id=? ORDER BY id DESC LIMIT 30').all(id),
    snapshots: r.gh_full_name ? db.prepare('SELECT stars, forks, pushed_at, latest_release, archived, source, captured_at FROM repo_snapshots WHERE full_name=? ORDER BY captured_at DESC LIMIT 20').all(r.gh_full_name) : [],
    installed: db.prepare('SELECT kind, scope, name, path, health, managed_by_curi, details, observed_at FROM installed_instances WHERE resource_id=?').all(id).map(i => ({ ...i, details: JSON.parse(i.details || 'null') })),
  };
}

export function listResources(db, { status, type, capability, tier, limit = 500, offset = 0 } = {}) {
  const where = [], args = [];
  if (status) { where.push('r.status=?'); args.push(status); }
  if (type) { where.push('r.type=?'); args.push(type); }
  if (tier) { where.push('r.tier=?'); args.push(tier); }
  if (capability) { where.push('r.id IN (SELECT resource_id FROM resource_capabilities WHERE capability_id=?)'); args.push(capability); }
  return db.prepare(`SELECT r.id, r.name, r.type, r.status, r.tier, r.primary_category, r.canonical_url, r.license, r.last_verified, r.description, r.risk_notes,
      (SELECT group_concat(capability_id, ',') FROM resource_capabilities WHERE resource_id=r.id) caps
    FROM resources r ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, limit, offset)
    .map(r => ({ ...r, caps: r.caps ? r.caps.split(',') : [] }));
}

export function setStatus(db, id, status, { actor = 'user', reason = null } = {}) {
  if (!STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
  if (status === 'INSTALLED') {
    const inst = db.prepare("SELECT 1 FROM installed_instances WHERE resource_id=? AND health IN ('verified','detected','files-ok','configured')").get(id);
    if (!inst) throw new Error('INSTALLED needs verified install evidence (installed_instances with health=verified).');
  }
  tx(db, () => {
    db.prepare('UPDATE resources SET status=?, updated_at=? WHERE id=?').run(status, now(), id);
    audit(db, actor, 'resource.status', id, { status, reason });
  });
}

export function exportRegistry(db) {
  const resources = db.prepare('SELECT id FROM resources ORDER BY id').all().map(r => getResource(db, r.id));
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, schema: db.prepare('SELECT MAX(version) v FROM schema_migrations').get().v, exported_at: now(), count: resources.length, resources };
}

export function importRegistry(db, data, { actor = 'user', dryRun = false } = {}) {
  if (data?.format !== EXPORT_FORMAT) throw new Error('Unknown export format.');
  if (data.version > EXPORT_VERSION) throw new Error(`Export v${data.version} is newer than supported (v${EXPORT_VERSION}).`);
  const report = { incoming: data.resources.length, created: 0, merged: 0, dryRun };
  if (dryRun) {
    for (const r of data.resources) (db.prepare('SELECT 1 FROM resources WHERE id=?').get(r.id) ? report.merged++ : report.created++);
    return report;
  }
  ensureCapabilities(db);
  tx(db, () => {
    for (const r of data.resources) {
      const exists = db.prepare('SELECT 1 FROM resources WHERE id=?').get(r.id);
      if (!exists) {
        db.prepare(`INSERT INTO resources(id,name,canonical_url,gh_full_name,type,primary_category,description,use_when,avoid_when,tier,license,status,paid_auth,risk_notes,provenance,created_at,updated_at,last_verified)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.id, r.name, r.canonical_url, r.gh_full_name, r.type, r.primary_category, r.description, r.use_when, r.avoid_when, r.tier, r.license,
          r.status === 'INSTALLED' || r.status === 'CONFIGURED' ? 'NEEDS_VERIFICATION' : r.status, r.paid_auth, r.risk_notes, `import:${r.provenance}`, r.created_at, now(), r.last_verified);
        report.created++;
      } else report.merged++;
      for (const u of r.urls || []) db.prepare('INSERT OR IGNORE INTO resource_urls(resource_id,url_original,url_normalized,source,section,source_line,created_at) VALUES (?,?,?,?,?,?,?)').run(r.id, u.url_original, normalizeUrl(u.url_original), u.source, u.section, u.source_line, u.created_at);
      for (const c of r.capabilities || []) if (CAP_BY_ID.has(c.id)) db.prepare('INSERT OR IGNORE INTO resource_capabilities VALUES (?,?,?)').run(r.id, c.id, c.origin);
      for (const t of r.tags || []) db.prepare('INSERT OR IGNORE INTO tags VALUES (?,?)').run(r.id, t);
      for (const a of r.aliases || []) db.prepare('INSERT OR IGNORE INTO aliases VALUES (?,?)').run(r.id, a);
      indexResource(db, r.id);
    }
    audit(db, actor, 'registry.import', null, report);
  });
  return report;
}
