// Append-only, hash-chained activity log. Tampering with any row breaks verifyChain().
import crypto from 'node:crypto';
import { now } from './db.mjs';

const SECRET_RX = /(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;

export function redact(value) {
  if (value == null) return value;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  const r = s.replace(SECRET_RX, '[REDACTED]');
  return typeof value === 'string' ? r : JSON.parse(r);
}

function digest(prev, row) {
  return crypto.createHash('sha256').update((prev || '') + '\n' + JSON.stringify([row.ts, row.actor, row.action, row.target, row.details])).digest('hex');
}

export function audit(db, actor, action, target = null, details = null) {
  const prev = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get();
  const row = { ts: now(), actor, action, target, details: details == null ? null : JSON.stringify(redact(details)) };
  const hash = digest(prev?.hash, row);
  db.prepare('INSERT INTO audit_log(ts, actor, action, target, details, prev_hash, hash) VALUES (?,?,?,?,?,?,?)')
    .run(row.ts, actor, action, target, row.details, prev?.hash ?? null, hash);
  return hash;
}

export function verifyChain(db) {
  let prev = null, n = 0;
  for (const r of db.prepare('SELECT * FROM audit_log ORDER BY id').all()) {
    if ((r.prev_hash ?? null) !== prev || digest(prev, r) !== r.hash) return { ok: false, brokenAt: r.id, checked: n };
    prev = r.hash; n++;
  }
  return { ok: true, checked: n };
}

export function jobEvent(db, job, level, step, message, data = null) {
  db.prepare('INSERT INTO job_events(job, ts, level, step, message, data) VALUES (?,?,?,?,?,?)')
    .run(job, now(), level, step, message, data == null ? null : JSON.stringify(redact(data)));
}
