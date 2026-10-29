// What the menu bar icon shows. The desktop shell reads one `CURI-STATUS {json}` line from stdout
// whenever this changes, and sends plain commands back on stdin (`check`). No network, no IPC.
import { getPref } from './db.mjs';

const verb = { install: 'Installed', upgrade: 'Updated', update: 'Updated', remove: 'Removed', uninstall: 'Removed', enable: 'Enabled', disable: 'Disabled', add: 'Added', scan: 'Scanned' };
const nameOf = r => String(r || '').replace(/^[a-z]+:/, '').split('/').pop();

export function trayStatus(db) {
  const count = s => db.prepare('SELECT COUNT(*) n FROM operations WHERE status=?').get(s).n;
  const last = db.prepare(`SELECT id, kind, resource, status, error FROM operations WHERE status IN ('verified','completed','failed') AND kind NOT IN ('system.scan','discover','github.stars') ORDER BY finished_at DESC LIMIT 1`).get();
  const lastMaint = getPref(db, 'last_maintenance', null);
  const suggestions = getPref(db, 'maintenance_suggestions', []).filter(s => !s.blocked);
  let finished = null;
  if (last) {
    const action = last.kind.split('.').pop();
    const what = nameOf(last.resource) || last.kind.split('.')[0];
    finished = { id: last.id, ok: last.status !== 'failed', title: last.status === 'failed' ? `Couldn't finish: ${what}` : `${verb[action] || 'Done'}: ${what}`, body: last.status === 'failed' ? String(last.error || '').slice(0, 140) : '' };
  }
  const running = count('running') + count('queued'), waiting = count('awaiting_approval');
  const checked_at = lastMaint?.at || getPref(db, 'last_system_scan', null)?.scanned_at || null;
  return { running, waiting, suggestions: suggestions.length, checked_at, finished, summary: summarize({ running, waiting, suggestions: suggestions.length, checked_at }) };
}

const ago = iso => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60e3);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The first line of the menu: the one thing worth knowing right now.
export function summarize({ running, waiting, suggestions, checked_at }) {
  if (running) return `Working on ${plural(running, 'task', 'tasks')}…`;
  if (waiting) return `${plural(waiting, 'thing needs', 'things need')} your OK`;
  if (suggestions) return `${plural(suggestions, 'suggestion', 'suggestions')} to review`;
  return checked_at ? `Up to date · checked ${ago(checked_at)}` : 'Up to date';
}

// Prints a status line when something changed, and handles stdin commands until stdin closes.
export function trayChannel(db, { check, every = 15e3 } = {}) {
  let prev = '';
  const emit = force => {
    try {
      const s = JSON.stringify(trayStatus(db));
      if (force || s !== prev) { prev = s; process.stdout.write(`CURI-STATUS ${s}\n`); }
    } catch {}
  };
  const timer = setInterval(emit, every);
  timer.unref();
  emit(true);
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const cmd = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (cmd === 'check') Promise.resolve(check()).finally(() => emit(true));
      else if (cmd === 'status') emit(true);
    }
  });
  return () => clearInterval(timer);
}
