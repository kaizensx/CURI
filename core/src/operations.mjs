// Persistent operations queue: approval-aware, resumable, idempotent handlers, per-resource locks,
// bounded retries, safe cancellation at stage boundaries, and recovery after a crash or restart.
import crypto from 'node:crypto';
import { now, tx } from './db.mjs';
import { audit, redact } from './audit-log.mjs';
import { evaluate, currentConsent } from './policy.mjs';

// queued -> running -> verified | completed | failed | cancelled ; awaiting_approval ; blocked ; interrupted -> queued
export const TERMINAL = ['verified', 'completed', 'failed', 'cancelled', 'blocked', 'rejected'];
const handlers = new Map();
export function registerHandler(kind, h) { handlers.set(kind, h); }
export const kinds = () => [...handlers.keys()];

const parse = r => r && ({ ...r, params: JSON.parse(r.params || '{}'), logs: JSON.parse(r.logs || '[]'), decision_reasons: JSON.parse(r.decision_reasons || '[]'), verification: JSON.parse(r.verification || 'null'), recovery: JSON.parse(r.recovery || 'null'), checkpoint: JSON.parse(r.checkpoint || 'null'), depends_on: JSON.parse(r.depends_on || '[]') });

export const getOp = (db, id) => parse(db.prepare('SELECT * FROM operations WHERE id=?').get(id));
export function listOps(db, { status, limit = 200, q } = {}) {
  const where = [], args = [];
  if (status) { where.push('status=?'); args.push(status); }
  if (q) { where.push('(kind LIKE ? OR resource LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  return db.prepare(`SELECT * FROM operations ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`).all(...args, limit).map(parse);
}

function log(db, id, level, message) {
  const r = db.prepare('SELECT logs FROM operations WHERE id=?').get(id);
  const logs = JSON.parse(r?.logs || '[]');
  logs.push({ at: now(), level, message: redact(String(message)).slice(0, 1000) });
  db.prepare('UPDATE operations SET logs=?, updated_at=? WHERE id=?').run(JSON.stringify(logs.slice(-200)), now(), id);
}
const set = (db, id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE operations SET ${keys.map(k => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`).run(...keys.map(k => (fields[k] !== null && typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : fields[k])), now(), id);
};

// Enqueue: the handler's plan() describes category/publisher/checks; the policy decides auto/ask/block.
export async function enqueue(db, kind, params = {}, { actor = 'user', dependsOn = [] } = {}) {
  const h = handlers.get(kind);
  if (!h) throw new Error(`Unsupported operation: ${kind}`);
  const plan = await h.plan(db, params);
  const existing = db.prepare(`SELECT id FROM operations WHERE kind=? AND lock_key=? AND status IN ('queued','running','awaiting_approval','interrupted')`).get(kind, plan.lockKey);
  if (existing) return getOp(db, existing.id); // idempotent enqueue: no duplicate pending work
  const ev = evaluate(db, plan);
  const id = `op-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const status = ev.decision === 'block' ? 'blocked' : ev.decision === 'ask' && actor !== 'user-approved' ? 'awaiting_approval' : 'queued';
  db.prepare(`INSERT INTO operations(id,kind,resource,source,params,status,decision,decision_reasons,security_class,depends_on,lock_key,max_attempts,actor,approved_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, kind, plan.resource, plan.source || null, JSON.stringify(params), status, ev.decision, JSON.stringify(ev.reasons), ev.category, JSON.stringify(dependsOn), plan.lockKey, plan.maxAttempts ?? 3, actor,
    actor === 'user-approved' ? 'user' : ev.decision === 'auto' ? `policy:${ev.mode}` : null, now(), now());
  audit(db, actor, 'operation.enqueue', id, { kind, resource: plan.resource, status, decision: ev.decision, category: ev.category });
  return getOp(db, id);
}

// What would happen if this were enqueued now (no side effects).
export async function preview(db, kind, params) {
  const h = handlers.get(kind);
  if (!h) throw new Error(`Unsupported operation: ${kind}`);
  const plan = await h.plan(db, params);
  const ev = evaluate(db, plan);
  return { kind, resource: plan.resource, source: plan.source || null, category: ev.category, decision: ev.decision, mode: ev.mode, reasons: ev.reasons };
}

export function approve(db, id, { actor = 'user' } = {}) {
  const op = getOp(db, id);
  if (!op || op.status !== 'awaiting_approval') throw new Error('This operation isn\'t waiting for approval.');
  set(db, id, { status: 'queued', approved_by: actor });
  audit(db, actor, 'operation.approve', id, { kind: op.kind, category: op.security_class });
  return getOp(db, id);
}

export function reject(db, id, { actor = 'user' } = {}) {
  const op = getOp(db, id);
  if (!op || !['awaiting_approval', 'queued', 'blocked', 'interrupted'].includes(op.status)) throw new Error('This operation can\'t be rejected in its current state.');
  set(db, id, { status: 'rejected', finished_at: now() });
  audit(db, actor, 'operation.reject', id, { kind: op.kind });
  return getOp(db, id);
}

// Queued work is cancelled immediately; running work stops at its next safe boundary.
export function cancel(db, id, { actor = 'user' } = {}) {
  const op = getOp(db, id);
  if (!op) throw new Error('Unknown operation.');
  if (op.status === 'running') { set(db, id, { cancel_requested: 1 }); log(db, id, 'warn', 'Cancellation requested: the operation stops at the next safe point.'); }
  else if (!TERMINAL.includes(op.status)) set(db, id, { status: 'cancelled', finished_at: now() });
  audit(db, actor, 'operation.cancel', id, { status: op.status });
  return getOp(db, id);
}

export function retry(db, id, { actor = 'user' } = {}) {
  const op = getOp(db, id);
  if (!op || !['failed', 'interrupted', 'cancelled'].includes(op.status)) throw new Error('Only failed, interrupted or cancelled operations can be retried.');
  set(db, id, { status: 'queued', attempts: 0, error: null, cancel_requested: 0, not_before: null });
  audit(db, actor, 'operation.retry', id, null);
  return getOp(db, id);
}

// Consent changed: auto-approved queued work that is no longer covered goes back to awaiting approval.
export async function reevaluateQueued(db) {
  const changed = [];
  for (const op of listOps(db, { status: 'queued', limit: 1000 })) {
    if (op.approved_by === 'user') continue;
    const plan = await handlers.get(op.kind).plan(db, op.params);
    const ev = evaluate(db, plan);
    if (ev.decision !== 'auto') { set(db, op.id, { status: ev.decision === 'block' ? 'blocked' : 'awaiting_approval', decision: ev.decision, decision_reasons: ev.reasons, approved_by: null }); changed.push(op.id); }
  }
  return changed;
}

// After a crash, running work is marked interrupted and requeued; handlers are idempotent.
export function recover(db) {
  const rows = db.prepare(`SELECT id FROM operations WHERE status='running'`).all();
  for (const r of rows) { set(db, r.id, { status: 'queued', stage: 'recovered' }); log(db, r.id, 'warn', 'Resumed after CURI was interrupted.'); }
  return rows.length;
}

// Atomically claim the next runnable operation (deps done, no running op on the same lock, backoff elapsed).
function claim(db) {
  return tx(db, () => {
    const candidates = db.prepare(`SELECT * FROM operations WHERE status='queued' AND (not_before IS NULL OR not_before <= ?) ORDER BY created_at LIMIT 20`).all(now());
    for (const c of candidates) {
      const deps = JSON.parse(c.depends_on || '[]');
      if (deps.some(d => !['verified', 'completed'].includes(db.prepare('SELECT status FROM operations WHERE id=?').get(d)?.status))) continue;
      if (db.prepare(`SELECT 1 FROM operations WHERE status='running' AND lock_key=?`).get(c.lock_key)) continue;
      db.prepare(`UPDATE operations SET status='running', attempts=attempts+1, started_at=COALESCE(started_at, ?), updated_at=? WHERE id=? AND status='queued'`).run(now(), now(), c.id);
      return c.id;
    }
    return null;
  });
}

const INVENTORY_KINDS = /^(package|plugin|mcp|skill)\.(install|upgrade|update|remove|uninstall|enable|disable|add)$/;

export async function runNext(db) {
  const id = claim(db);
  if (!id) return null;
  const op = getOp(db, id);
  const h = handlers.get(op.kind);
  const ctx = {
    stage: (name, progress = null) => { set(db, id, { stage: name, progress }); log(db, id, 'info', name); },
    progress: value => set(db, id, { progress: value }),
    log: (m, level = 'info') => log(db, id, level, m),
    checkpoint: data => set(db, id, { checkpoint: data }),
    get checkpointData() { return getOp(db, id).checkpoint; },
    cancelled: () => Boolean(db.prepare('SELECT cancel_requested FROM operations WHERE id=?').get(id)?.cancel_requested),
    approvedByUser: op.approved_by === 'user',
    mode: currentConsent(db).mode,
  };
  try {
    const out = await h.run(db, op.params, ctx);
    if (out?.needsApproval) { set(db, id, { status: 'awaiting_approval', decision: 'ask', decision_reasons: out.needsApproval, approved_by: null, attempts: 0 }); log(db, id, 'warn', out.needsApproval.join(' ')); audit(db, 'system', 'operation.paused_for_approval', id, { kind: op.kind }); return getOp(db, id); }
    if (out?.cancelled) { set(db, id, { status: 'cancelled', finished_at: now(), recovery: out.recovery || null }); audit(db, 'system', 'operation.cancelled', id, null); return getOp(db, id); }
    // Anything that adds, removes or toggles something on the device re-reads the inventory before the
    // operation closes, so the Library shows the new state the moment the progress window goes away.
    if (INVENTORY_KINDS.test(op.kind) && !process.env.CURI_SKIP_RESCAN) {
      try {
        const { scanSystem } = await import('./detect.mjs');
        ctx.stage('Updating what CURI sees on this device', 0.96);
        await scanSystem(db);
      } catch (e) { log(db, id, 'warn', `Couldn't refresh the inventory: ${e.message}`); }
    }
    set(db, id, { status: out?.verified ? 'verified' : 'completed', verification: out?.verification || null, recovery: out?.recovery || null, progress: 1, stage: out?.verified ? 'verified' : 'done (no independent verification)', finished_at: now() });
    audit(db, 'system', 'operation.done', id, { kind: op.kind, verified: Boolean(out?.verified) });
  } catch (e) {
    const fresh = getOp(db, id);
    const permanent = e.permanent || fresh.attempts >= fresh.max_attempts;
    log(db, id, 'error', e.message);
    if (permanent) { set(db, id, { status: 'failed', error: redact(e.message).slice(0, 500), recovery: e.recovery || null, finished_at: now() }); audit(db, 'system', 'operation.failed', id, { kind: op.kind }); }
    else set(db, id, { status: 'queued', error: redact(e.message).slice(0, 500), not_before: new Date(Date.now() + 2000 * 2 ** fresh.attempts).toISOString() });
  }
  return getOp(db, id);
}

export async function drain(db, { max = 20 } = {}) {
  const done = [];
  for (let i = 0; i < max; i++) { const r = await runNext(db); if (!r) break; done.push(r); }
  return done;
}

export function permanent(message, recovery) { const e = new Error(message); e.permanent = true; e.recovery = recovery; return e; }
