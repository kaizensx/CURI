// Operation progress modal. Every install, removal, activation, verification and discovery is shown here,
// live, until it finishes. It cannot be dismissed while work is running; Cancel stops at a safe boundary.
import { h, fmtDate, fill } from './dom.js';
import { icon } from './icons.js';
import { api, toast } from './ui.js';

const STATUS = {
  queued: ['info', 'Queued'], running: ['info', 'Running'], awaiting_approval: ['warn', 'Needs your approval'],
  verified: ['good', 'Done and verified'], completed: ['good', 'Done'], failed: ['bad', 'Failed'],
  cancelled: ['', 'Cancelled'], blocked: ['bad', 'Blocked'], rejected: ['', 'Rejected'],
};
const TERMINAL = ['verified', 'completed', 'failed', 'cancelled', 'blocked', 'rejected'];

let current = null;           // { id, el, close }
const pending = [];           // ids waiting to be shown
const waiters = new Map();    // id -> [resolve]
const seen = new Set();       // ids already shown (the watcher never re-opens these)

function mountShell() {
  const scrim = h('div', { class: 'scrim op-scrim' });
  const box = h('div', { class: 'dialog op-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'op-title', 'aria-describedby': 'op-stage' });
  document.body.append(scrim, box);
  // Focus stays inside; Escape does nothing while running (the work is not hidden).
  const trap = e => {
    if (e.key === 'Escape' && current?.terminal) { e.preventDefault(); current.close(); }
    if (e.key === 'Tab') {
      const f = [...box.querySelectorAll('button, a[href]')];
      if (!f.length) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', trap, true);
  return { scrim, box, remove: () => { document.removeEventListener('keydown', trap, true); scrim.remove(); box.remove(); } };
}

function elapsed(from, to) {
  const s = Math.max(0, Math.round(((to ? new Date(to) : new Date()) - new Date(from)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function render(box, op, title, queued, state) {
  const [kind, label] = STATUS[op.status] || ['', op.status];
  const running = ['queued', 'running'].includes(op.status);
  const determinate = op.status === 'running' && op.progress != null && op.progress > 0;
  const pct = TERMINAL.includes(op.status) && ['verified', 'completed'].includes(op.status) ? 100 : determinate ? Math.round(op.progress * 100) : null;
  const logs = op.logs.slice(-8);
  const actions = [];
  if (op.status === 'awaiting_approval') {
    actions.push(h('button', { type: 'button', class: 'btn', onclick: async () => { await api('opReject', { id: op.id }); state.refresh(); } }, 'Reject'));
    actions.push(h('button', { type: 'button', class: 'btn primary', onclick: async () => { await api('opApprove', { id: op.id }); state.refresh(); } }, icon('check', 'sm'), ' Aprovar e continuar'));
  } else if (running) {
    actions.push(h('button', { type: 'button', class: 'btn', disabled: op.cancel_requested ? true : null, onclick: async () => { await api('opCancel', { id: op.id }); state.refresh(); } }, op.cancel_requested ? 'Cancelling at the next safe point…' : 'Cancel'));
  } else {
    if (['failed', 'cancelled'].includes(op.status)) actions.push(h('button', { type: 'button', class: 'btn', onclick: async () => { await api('opRetry', { id: op.id }); state.refresh(); } }, icon('refresh', 'sm'), ' Repetir'));
    actions.push(h('a', { class: 'btn ghost', href: `#/operations?id=${op.id}`, onclick: () => state.close() }, 'Details'));
    actions.push(h('button', { type: 'button', class: 'btn primary', onclick: () => state.close(), 'data-close': '' }, queued ? `Close (+${queued} queued)` : 'Close'));
  }
  const ic = running ? h('span', { class: 'spin lg' }) : icon(op.status === 'awaiting_approval' ? 'shield' : ['verified', 'completed'].includes(op.status) ? 'check' : op.status === 'cancelled' ? 'x' : 'alert', 'lg');
  fill(box, 
    h('div', { class: 'op-head' }, h('span', { class: `result-ic ${kind}` }, ic),
      h('div', { class: 'grow' }, h('h3', { id: 'op-title' }, title || op.resource || op.kind), title && op.resource ? h('div', { class: 'muted small mono' }, op.resource) : null),
      h('span', { class: `badge ${kind}` }, label)),
    h('div', { class: 'op-stage', id: 'op-stage', 'aria-live': 'polite' }, op.status === 'queued' ? 'Waiting its turn in the queue…' : op.stage || (running ? 'A preparar…' : '')),
    h('div', { class: `op-bar ${pct == null && running ? 'indet' : ''}`, role: 'progressbar', 'aria-label': 'Progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': pct == null ? null : String(pct) },
      h('i', { style: { width: pct == null ? '' : `${pct}%` } })),
    h('div', { class: 'op-meta muted small' }, h('span', null, pct == null ? (running ? 'This step has no measurable progress' : '') : `${pct}%`), h('span', { class: 'spacer' }),
      h('span', { class: 'num' }, op.started_at ? `Time: ${elapsed(op.started_at, TERMINAL.includes(op.status) ? op.finished_at : null)}` : ''), op.attempts > 1 ? h('span', null, ` · tentativa ${op.attempts}/${op.max_attempts}`) : null),
    op.status === 'awaiting_approval' ? h('div', { class: 'notice warn' }, icon('shield', 'sm'), h('div', null, op.decision_reasons.map(r => h('div', null, r)))) : null,
    op.error ? h('div', { class: 'notice bad' }, icon('alert', 'sm'), h('div', { class: 'selectable' }, op.error, op.recovery ? h('div', { class: 'muted small' }, `Recovery: ${typeof op.recovery === 'object' ? Object.entries(op.recovery).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v).slice(0, 120)}`).join(' · ') : op.recovery}`) : null)) : null,
    op.status === 'verified' && op.verification ? h('div', { class: 'notice info' }, icon('check', 'sm'), h('div', { class: 'small' }, summarize(op))) : null,
    h('div', { class: 'op-log log', role: 'log', 'aria-label': 'Operation log' }, logs.length ? logs.map(l => h('div', { class: l.level }, h('span', { class: 'muted' }, fmtDate(l.at, { timeStyle: 'medium' })), ' ', l.message)) : h('div', { class: 'muted' }, 'No log entries yet.')),
    queued && running ? h('div', { class: 'muted small' }, `${queued} more operation(s) queued; they'll show next.`) : null,
    h('div', { class: 'actions' }, actions));
}

function summarize(op) {
  const v = op.verification || {};
  if (op.kind === 'system.scan') return `${v.matched} catalogue resources found on this device (${v.changes?.installed?.length || 0} new, ${v.changes?.removed?.length || 0} no longer found).`;
  if (op.kind === 'skill.install') return v.idempotent ? 'Already installed at this version; nothing was rewritten.' : `Commit ${String(v.commit || '').slice(0, 7)} · ${v.files} files verified by checksum · ${v.scan_findings} findings.`;
  if (op.kind === 'mcp.enable') return v.healthy ? 'Claude Code connects to the server.' : `Registered; status in Claude: ${v.status}.`;
  if (op.kind === 'package.install' || op.kind === 'package.upgrade') return v.already_installed ? `Already installed (${v.version || 'unknown version'}); nothing changed.` : v.listed_by_manager || v.after ? `Confirmed by the package manager: version ${v.version || v.after}.` : null;
  if (op.kind === 'package.remove') return v.already_absent ? 'Wasn\'t installed.' : 'The package manager no longer lists it.';
  if (op.kind === 'plugin.install') return v.already_installed ? `Already installed (${v.already_installed}).` : v.plugin ? `Plugin ${v.plugin} ${v.version || ''} listed by Claude Code${v.enabled === false ? ' (disabled)' : ''}.` : null;
  if (op.kind === 'mcp.add') return v.healthy ? 'Claude Code connects to the server.' : v.needs_auth ? 'Registered; still needs sign-in in Claude Code (/mcp).' : `Registered; status in Claude: ${v.status}.`;
  if (op.kind === 'github.stars') return `${v.total} starred repositories; ${v.known} already in the catalogue; ${v.relevant} new and relevant to agents.`;
  if (op.kind === 'verify.run') return `${v.verdict}: ${v.passed}/${v.total} checks.`;
  if (op.kind === 'discover') return `${v.results} results (run #${v.scan_id}).`;
  if (op.kind === 'sources.verify') return `${v.ok} sources confirmed, ${v.fail} failed.`;
  return 'Result verified.';
}

async function show(id, title, { autoClose = false } = {}) {
  seen.add(id);
  if (current) { if (!pending.some(p => p.id === id) && current.id !== id) pending.push({ id, title, autoClose }); return; }
  const shell = mountShell();
  let timer = null, closed = false, lastOp = null, autoTimer = null;
  const state = {
    close() {
      if (closed) return;
      closed = true; clearInterval(timer); clearTimeout(autoTimer); shell.remove();
      (waiters.get(id) || []).forEach(r => r(lastOp)); waiters.delete(id);
      current = null;
      const next = pending.shift();
      if (next) show(next.id, next.title, { autoClose: next.autoClose });
    },
    async refresh() {
      let op;
      try { op = await api('opGet', { id }); } catch { shell.box.querySelector('#op-stage')?.replaceChildren('Lost connection to the engine; retrying…'); return; }
      if (!op || closed) return;
      lastOp = op;
      current.terminal = TERMINAL.includes(op.status);
      const wasFocusedClose = document.activeElement?.hasAttribute?.('data-close');
      const focusedLabel = shell.box.contains(document.activeElement) ? document.activeElement.textContent : null;
      render(shell.box, op, title, pending.length, state);
      if (focusedLabel) [...shell.box.querySelectorAll('button, a[href]')].find(b => b.textContent === focusedLabel)?.focus();
      if (current.terminal) {
        clearInterval(timer);
        const close = shell.box.querySelector('[data-close]');
        if (close && !wasFocusedClose) close.focus();
        if (autoClose && ['verified', 'completed'].includes(op.status) && !autoTimer) autoTimer = setTimeout(() => state.close(), 2500);
      } else if (!shell.box.contains(document.activeElement)) shell.box.querySelector('button')?.focus();
    },
  };
  current = { id, terminal: false, close: state.close };
  await state.refresh();
  timer = setInterval(() => state.refresh(), 450);
}

// Show an operation and resolve with its final state when the user closes the modal.
export function showOperation(id, title, opts) {
  const p = new Promise(r => waiters.set(id, [...(waiters.get(id) || []), r]));
  show(id, title, opts);
  return p;
}

// Watcher: any operation that starts running while the app is open (including automatic and background
// work) is shown. Nothing installs or removes out of sight.
export function startWatcher() {
  const tick = async () => {
    if (document.hidden) return;
    let running;
    try { running = await api('ops', { status: 'running', limit: 5 }); } catch { return; }
    for (const op of running) if (!seen.has(op.id)) show(op.id, null, { autoClose: op.actor === 'agent' && op.security_class === 'observe' });
    try { for (const op of await api('ops', { status: 'awaiting_approval', limit: 5 })) if (!seen.has(op.id)) show(op.id, null); } catch {}
  };
  tick();
  setInterval(tick, 1500);
}

// Same visibility for actions that are not queue operations (connection tests, health checks, exports).
export async function withProgress(title, fn, { stage = 'A trabalhar…' } = {}) {
  const shell = mountShell();
  const t0 = new Date().toISOString();
  const paint = (status, msg) => {
    const done = status !== 'running';
    fill(shell.box, 
      h('div', { class: 'op-head' }, h('span', { class: `result-ic ${status === 'ok' ? 'good' : status === 'error' ? 'bad' : 'info'}` }, done ? icon(status === 'ok' ? 'check' : 'alert', 'lg') : h('span', { class: 'spin lg' })), h('div', { class: 'grow' }, h('h3', { id: 'op-title' }, title))),
      h('div', { class: 'op-stage', id: 'op-stage', 'aria-live': 'polite' }, msg),
      h('div', { class: `op-bar ${done ? '' : 'indet'}`, role: 'progressbar', 'aria-label': 'Progress' }, h('i', { style: { width: done ? '100%' : '' } })),
      h('div', { class: 'op-meta muted small' }, h('span', null, done ? '' : 'No measurable progress'), h('span', { class: 'spacer' }), h('span', { class: 'num' }, `Time: ${elapsed(t0)}`)),
      done ? h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', 'data-close': '', onclick: () => shell.remove() }, 'Close')) : null);
    if (done) shell.box.querySelector('[data-close]').focus();
  };
  paint('running', stage);
  const tick = setInterval(() => paint('running', stage), 1000);
  try {
    const r = await fn();
    clearInterval(tick);
    const msg = typeof r === 'string' ? r : r?.message || 'Done.';
    if (r?.ok === false) paint('error', msg); else { paint('ok', msg); setTimeout(() => shell.remove(), 1600); }
    return r;
  } catch (e) {
    clearInterval(tick);
    paint('error', e.message);
    e.shown = true;
    throw e;
  }
}
