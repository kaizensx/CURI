// SQLite storage via Node's built-in node:sqlite (no native deps). WAL + busy timeout so the
// desktop UI, CLI and MCP processes can share one registry concurrently.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.mjs';

export const SCHEMA_VERSION = 4;

const MIGRATIONS = [
  {
    version: 1,
    name: 'base registry',
    sql: `
CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  gh_full_name TEXT,
  type TEXT NOT NULL,
  primary_category TEXT,
  description TEXT,
  use_when TEXT,
  avoid_when TEXT,
  install_method TEXT,
  tier TEXT NOT NULL DEFAULT 'catalog',
  license TEXT DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'NEEDS_VERIFICATION',
  platforms TEXT,
  paid_auth TEXT,
  official_docs TEXT,
  superseded_by TEXT REFERENCES resources(id),
  risk_notes TEXT,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_verified TEXT
);
CREATE UNIQUE INDEX resources_gh ON resources(gh_full_name) WHERE gh_full_name IS NOT NULL;
CREATE TABLE resource_urls (
  id INTEGER PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  url_original TEXT NOT NULL,
  url_normalized TEXT NOT NULL,
  source TEXT NOT NULL,
  section TEXT,
  source_line INTEGER,
  batch_id INTEGER REFERENCES import_batches(id),
  created_at TEXT NOT NULL,
  UNIQUE(url_original, source, section)
);
CREATE INDEX resource_urls_norm ON resource_urls(url_normalized);
CREATE TABLE capabilities (id TEXT PRIMARY KEY, label TEXT NOT NULL, domain TEXT);
CREATE TABLE resource_capabilities (
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL REFERENCES capabilities(id),
  origin TEXT NOT NULL,
  PRIMARY KEY(resource_id, capability_id)
);
CREATE TABLE tags (resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY(resource_id, tag));
CREATE TABLE aliases (resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, alias TEXT NOT NULL, PRIMARY KEY(resource_id, alias));
CREATE TABLE evidence (
  id INTEGER PRIMARY KEY,
  resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  class TEXT NOT NULL CHECK(class IN ('original','corroborating','community','speculative')),
  summary TEXT NOT NULL,
  data TEXT,
  source_url TEXT,
  captured_at TEXT NOT NULL
);
CREATE TABLE import_batches (id INTEGER PRIMARY KEY, source TEXT NOT NULL, sha256 TEXT, counts TEXT, created_at TEXT NOT NULL);
CREATE TABLE scans (id INTEGER PRIMARY KEY, mode TEXT NOT NULL, params TEXT, status TEXT NOT NULL, error TEXT, queries TEXT, started_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE scan_candidates (
  id INTEGER PRIMARY KEY,
  scan_id INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  stars INTEGER,
  gh_created_at TEXT,
  gh_pushed_at TEXT,
  license TEXT,
  topics TEXT,
  query TEXT,
  query_kind TEXT,
  in_registry INTEGER NOT NULL DEFAULT 0,
  score TEXT,
  decision TEXT NOT NULL DEFAULT 'candidate',
  reason TEXT,
  captured_at TEXT NOT NULL,
  UNIQUE(scan_id, full_name)
);
CREATE TABLE installed_instances (
  id INTEGER PRIMARY KEY,
  resource_id TEXT REFERENCES resources(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  path TEXT,
  managed_by_curi INTEGER NOT NULL DEFAULT 0,
  checksum TEXT,
  health TEXT,
  details TEXT,
  observed_at TEXT NOT NULL,
  UNIQUE(kind, scope, name)
);
CREATE TABLE approvals (id INTEGER PRIMARY KEY, action TEXT NOT NULL, risk_class TEXT NOT NULL, decision TEXT NOT NULL, actor TEXT NOT NULL, policy_version TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL);
CREATE TABLE transactions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, manifest TEXT, created_at TEXT NOT NULL, committed_at TEXT, rolled_back_at TEXT);
CREATE TABLE config_snapshots (id INTEGER PRIMARY KEY, tx_id TEXT NOT NULL REFERENCES transactions(id), path TEXT NOT NULL, existed INTEGER NOT NULL, sha_before TEXT, backup_path TEXT, sha_after TEXT, created_at TEXT NOT NULL);
CREATE TABLE audit_log (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, details TEXT, prev_hash TEXT, hash TEXT NOT NULL);
CREATE TABLE bootstrap (id INTEGER PRIMARY KEY CHECK(id = 1), state TEXT NOT NULL, step TEXT, data TEXT, updated_at TEXT NOT NULL);
CREATE TABLE job_events (id INTEGER PRIMARY KEY, job TEXT NOT NULL, ts TEXT NOT NULL, level TEXT NOT NULL, step TEXT, message TEXT NOT NULL, data TEXT);
CREATE TABLE provider_status (provider TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT, rate_limit TEXT, checked_at TEXT NOT NULL);
CREATE TABLE user_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE VIRTUAL TABLE resources_fts USING fts5(id UNINDEXED, name, aliases, capabilities, tags, description, use_when, url, tokenize = 'unicode61 remove_diacritics 2');
`,
  },
  {
    version: 2,
    name: 'radar snapshots + http cache',
    sql: `
CREATE TABLE repo_snapshots (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, stars INTEGER, forks INTEGER, open_issues INTEGER, pushed_at TEXT, latest_release TEXT, archived INTEGER, source TEXT NOT NULL, captured_at TEXT NOT NULL);
CREATE INDEX repo_snapshots_name ON repo_snapshots(full_name, captured_at);
CREATE TABLE http_cache (url TEXT PRIMARY KEY, etag TEXT, last_modified TEXT, status INTEGER, body TEXT, fetched_at TEXT NOT NULL);
ALTER TABLE resources ADD COLUMN head_commit TEXT;
`,
  },
  {
    version: 3,
    name: 'connections, consent, operations queue, managed MCP definitions',
    sql: `
-- Connection metadata only. Secrets live in the macOS Keychain (service app.curi.credentials), never here.
CREATE TABLE connections (
  provider TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  account TEXT,
  has_secret INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_configured',
  detail TEXT,
  capabilities TEXT,
  last_tested TEXT,
  last_ok TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE consent (
  id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('standard','automatic','maximum')),
  scopes TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  actor TEXT NOT NULL
);
CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  resource TEXT,
  source TEXT,
  params TEXT,
  status TEXT NOT NULL,
  decision TEXT,
  decision_reasons TEXT,
  security_class TEXT,
  depends_on TEXT,
  lock_key TEXT,
  stage TEXT,
  progress REAL,
  logs TEXT NOT NULL DEFAULT '[]',
  checkpoint TEXT,
  verification TEXT,
  recovery TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  not_before TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  actor TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX operations_status ON operations(status, created_at);
CREATE TABLE mcp_definitions (
  name TEXT PRIMARY KEY,
  transport TEXT NOT NULL DEFAULT 'stdio',
  command TEXT,
  args TEXT NOT NULL DEFAULT '[]',
  url TEXT,
  env TEXT NOT NULL DEFAULT '{}',
  secret_env TEXT NOT NULL DEFAULT '{}',
  publisher TEXT,
  resource_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 4,
    name: 'resource facts (inspection)',
    sql: `
CREATE TABLE resource_facts (
  resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  source TEXT NOT NULL,
  inspected_at TEXT NOT NULL
);
`,
  },
];

export function now() { return new Date().toISOString(); }

export function openDb(file = paths.db, { targetVersion = SCHEMA_VERSION, backupBeforeMigrate = true } = {}) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT NOT NULL)');
  const current = currentVersion(db);
  if (current > SCHEMA_VERSION) {
    db.close();
    throw new Error(`Base de dados com schema v${current} é mais recente que este cliente (v${SCHEMA_VERSION}). Atualize o CURI; recusado para evitar corrupção.`);
  }
  const pending = MIGRATIONS.filter(m => m.version > current && m.version <= targetVersion);
  if (pending.length && current > 0 && backupBeforeMigrate && file !== ':memory:') {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const bak = path.join(path.dirname(file), `${path.basename(file)}.v${current}.${Date.now()}.bak`);
    fs.copyFileSync(file, bak);
  }
  for (const m of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?,?,?)').run(m.version, m.name, now());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

export function currentVersion(db) {
  return db.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').get().v;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getPref(db, key, fallback = null) {
  const r = db.prepare('SELECT value FROM user_preferences WHERE key=?').get(key);
  return r ? JSON.parse(r.value) : fallback;
}
export function setPref(db, key, value) {
  db.prepare('INSERT INTO user_preferences(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
}
