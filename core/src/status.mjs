import { currentVersion } from './db.mjs';

export function statusSummary(db) {
  const count = sql => db.prepare(sql).get().n;
  const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM resources GROUP BY status').all().map(r => [r.status, r.n]));
  const byType = Object.fromEntries(db.prepare('SELECT type, COUNT(*) n FROM resources GROUP BY type').all().map(r => [r.type, r.n]));
  const boot = db.prepare('SELECT state, step, updated_at FROM bootstrap WHERE id=1').get() || { state: 'UNINITIALIZED' };
  const lastScan = db.prepare('SELECT id, mode, status, started_at, finished_at FROM scans ORDER BY id DESC LIMIT 1').get() || null;
  const lastVerify = db.prepare("SELECT ts, details FROM audit_log WHERE action='verify.run' ORDER BY id DESC LIMIT 1").get();
  return {
    schema_version: currentVersion(db),
    resources: count('SELECT COUNT(*) n FROM resources'),
    source_urls: count('SELECT COUNT(*) n FROM resource_urls'),
    verified_sources: count('SELECT COUNT(*) n FROM resources WHERE last_verified IS NOT NULL'),
    pending_review: byStatus.PENDING_REVIEW || 0,
    by_status: byStatus,
    by_type: byType,
    capabilities_covered: count('SELECT COUNT(DISTINCT capability_id) n FROM resource_capabilities'),
    candidates_open: count("SELECT COUNT(*) n FROM scan_candidates WHERE decision='candidate' AND in_registry=0"),
    installed_by_curi: db.prepare('SELECT kind, name, health, observed_at FROM installed_instances WHERE managed_by_curi=1').all(),
    bootstrap: boot,
    last_scan: lastScan,
    last_verification: lastVerify ? { ts: lastVerify.ts, ...JSON.parse(lastVerify.details) } : null,
    providers: db.prepare('SELECT provider, status, detail, rate_limit, checked_at FROM provider_status').all().map(p => ({ ...p, rate_limit: p.rate_limit ? JSON.parse(p.rate_limit) : null })),
  };
}
