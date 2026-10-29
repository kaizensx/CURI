import { h, relTime, fmtDate, fmtInt, fill, mod } from '../lib/dom.js';
import { icon, brandMark } from '../lib/icons.js';
import { api, btn, status, badge, panel, pageHead, empty, notice, kv, table, toast, meter, when, segmented, pager } from '../lib/ui.js';
import { go, params, applyTheme, currentTheme, applyMotion, currentMotion } from '../app.js';
import { withProgress } from '../lib/opmodal.js';

export async function jobs() {
  const [events, scans, s] = await Promise.all([api('jobs', { limit: 300 }), api('scans'), api('status')]);
  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'System', title: 'Tasks and monitoring', sub: 'No hidden background jobs: each task runs only when asked, or under the maintenance schedule you set.' }),
    h('div', { class: 'stack-lg reveal' },
      panel({ title: 'Providers and quotas', flush: true }, s.providers.length ? h('div', { class: 'rows' }, s.providers.map(p => h('div', { class: 'r' },
        h('span', { class: 'itile' }, icon('git')), h('div', { class: 'grow' }, h('div', { class: 't1' }, p.provider), h('div', { class: 't2' }, `${p.detail || ''} · checked ${relTime(p.checked_at)}`)),
        p.rate_limit ? h('div', { class: 'quota' }, h('div', { class: 'row' }, h('span', { class: 'micro' }, p.rate_limit.kind), h('span', { class: 'num' }, `${p.rate_limit.remaining}/${p.rate_limit.limit}`)), meter(p.rate_limit.remaining / p.rate_limit.limit, p.rate_limit.remaining < p.rate_limit.limit * 0.2 ? 'warn' : 'good', 'quota left'), h('div', { class: 't2' }, `reset ${relTime(p.rate_limit.reset)}${p.rate_limit.authenticated ? ' · with token' : ' · no token'}`)) : null,
        status(p.status)))) : empty('git', 'No provider contacted yet')),
      panel({ title: 'Discoveries', flush: true }, table([{ label: '#', num: true, cell: x => x.id }, { label: 'Mode', cell: x => x.mode }, { label: 'Status', cell: x => status(x.status) }, { label: 'Results', num: true, cell: x => x.n }, { label: 'Started', cell: x => when(x.started_at) }, { label: 'Duration', cell: x => (x.finished_at ? `${Math.round((new Date(x.finished_at) - new Date(x.started_at)) / 1000)} s` : '—') }, { label: 'Error', cell: x => x.error || '—' }], scans, { onRow: x => go('radar'), emptyText: 'No discoveries.' })),
      panel({ title: 'Events', meta: `${events.length}` }, h('div', { class: 'log tall', role: 'log' }, events.map(j => h('div', { class: j.level }, h('span', { class: 'muted' }, fmtDate(j.ts)), ` [${j.job}] ${j.step || ''} — ${j.message}`))))));
}

export async function audit() {
  const [log, approvals, txs] = await Promise.all([api('auditLog', { limit: 500 }), api('approvals'), api('transactions')]);
  let auditPage = 0;
  const actWrap = h('div');
  const drawAct = () => fill(actWrap, panel({ title: 'Activity', meta: `${log.entries.length} most recent`, flush: true }, table([{ label: '#', num: true, cell: e => e.id }, { label: 'When', cell: e => when(e.ts) }, { label: 'Actor', cell: e => e.actor }, { label: 'Action', cell: e => h('span', { class: 'mono' }, e.action) }, { label: 'Target', cell: e => h('span', { class: 'mono' }, e.target || '—') }, { label: 'Hash', cell: e => h('span', { class: 'mono muted' }, e.hash.slice(0, 12)) }], log.entries.slice(auditPage * 50, (auditPage + 1) * 50))), pager(log.entries.length, auditPage, 50, n => { auditPage = n; drawAct(); }, { noun: 'entries' }));
  drawAct();
  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'System', title: 'Audit', sub: 'Append-only log with a SHA-256 hash chain: changing a past entry breaks the chain.' }),
    h('section', { class: `panel bridge-hero ${log.chain.ok ? 'ok' : 'bad'}` }, h('div', { class: 'panel-body bh-status' }, h('span', { class: `result-ic ${log.chain.ok ? 'good' : 'bad'}` }, icon(log.chain.ok ? 'lock' : 'alert', 'lg')),
      h('div', null, h('h3', null, log.chain.ok ? 'Chain intact' : `Chain broken at entry ${log.chain.brokenAt}`), h('p', { class: 'muted' }, `${fmtInt(log.chain.checked)} entries verified just now.`)))),
    h('div', { class: 'stack-lg reveal' },
      panel({ title: 'Approvals', flush: true }, table([{ label: 'Action', cell: a => h('span', { class: 'mono' }, a.action) }, { label: 'Risk', cell: a => badge(a.risk_class, 'warn') }, { label: 'Decision', cell: a => status(a.decision) }, { label: 'Actor', cell: a => a.actor }, { label: 'Policy', cell: a => a.policy_version }, { label: 'When', cell: a => when(a.created_at) }], approvals, { emptyText: 'No approvals recorded.' })),
      panel({ title: 'Transactions', flush: true }, table([{ label: 'ID', cell: t => h('span', { class: 'mono' }, t.id) }, { label: 'Status', cell: t => status(t.status) }, { label: 'Manifest', cell: t => h('details', null, h('summary', { class: 'muted' }, 'show'), h('pre', null, JSON.stringify(t.manifest, null, 2))) }], txs, { emptyText: 'No transactions.' })),
      actWrap));
}

export async function settings() {
  const [p, pf] = await Promise.all([api('prefsGet'), api('preflight')]);
  const budget = h('input', { type: 'number', class: 'num-input', min: '0', max: '5000', value: String(p.github_budget), 'aria-label': 'GitHub budget' });
  const policy = h('select', { class: 'select', 'aria-label': 'Install policy' }, [['minimal-global', 'Minimal global (recommended)'], ['catalog-only', 'Catalogue only']].map(([v, l]) => h('option', { value: v, selected: v === p.install_policy || null }, l)));
  const model = h('input', { type: 'checkbox', role: 'switch', id: 'pm', checked: p.model_analysis || null });
  const file = h('input', { type: 'file', accept: 'application/json', 'aria-label': 'Import file', class: 'file' });
  const impOut = h('div');
  const readFile = async () => { if (!file.files[0]) throw new Error('Pick a file first.'); return JSON.parse(await file.files[0].text()); };
  const row = (t1, t2, ctl) => h('div', { class: 'r' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, t1), t2 ? h('div', { class: 't2' }, t2) : null), ctl);
  return h('div', { class: 'page narrow' },
    pageHead({ eyebrow: 'System', title: 'Settings' }),
    h('div', { class: 'stack-lg reveal' },
      panel({ title: 'Appearance and motion', flush: true }, h('div', { class: 'rows' },
        row('Theme', 'Follows the system by default.', segmented([['system', 'System'], ['dark', 'Dark'], ['light', 'Light']], currentTheme(), v => applyTheme(v), 'Theme')),
        row('Motion', 'Reduced removes movement and staggered entrances; Off removes every animation (state never depends on them). Your system\'s "Reduce motion" setting is always respected.', segmented([['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']], currentMotion(), v => applyMotion(v), 'Motion')))),
      panel({ title: 'Integrations and control', flush: true }, h('div', { class: 'rows' },
        row('Connections and credentials', 'Claude Code, GitHub, Anthropic API, OpenAI, Google AI.', h('a', { class: 'btn sm', href: '#/connections' }, 'Open')),
        row('Autonomy and permissions', 'Management mode, permission matrix, trusted publishers, background work.', h('a', { class: 'btn sm', href: '#/automation' }, 'Open')),
        row('Activity', 'What CURI installed or changed, and what waits for your OK.', h('a', { class: 'btn sm', href: '#/operations' }, 'Open')))),
      panel({ title: 'Discovery and installs', flush: true }, h('div', { class: 'rows' },
        row('GitHub request budget per run', 'Without a token: 60 requests/h and 10 searches/min.', budget),
        row('Install policy', 'Minimal global: only CURI\'s own skill and MCP; everything else on demand.', policy),
        row('Model-assisted analysis', 'Uses your Claude account; off by default.', h('span', { class: 'switch' }, model, h('span'))),
        row('Telemetry', 'Always off.', badge('off')),
        row('Scheduled searches', 'CURI looks for new projects once a week. Save your own searches in Library › New on GitHub; change how often in Autonomy.', badge('see Autonomy')),
        h('div', { class: 'r' }, h('span', { class: 'spacer' }), btn('Save', async () => { await api('prefsSet', { github_budget: Number(budget.value), install_policy: policy.value, model_analysis: model.checked }); toast('Preferences saved', 'good'); }, { kind: 'primary' })))),
      panel({ title: 'Data', flush: true }, h('div', { class: 'rows' },
        row('CURI data', h('span', { class: 'mono' }, pf.paths.curi_data)), row('Claude profile', h('span', { class: 'mono' }, pf.paths.claude_home)), row('User MCP', h('span', { class: 'mono' }, pf.paths.claude_json)),
        row('Export registry', 'Versioned JSON (curi-registry-export v1) with original URLs, evidence and snapshots.', btn('Export', () => withProgress('Exporting the registry', () => api('exportFile').then(r => `${r.count} resources exported to ${r.file}`), { stage: 'Writing the JSON file…' }), { iconName: 'download' })),
        h('div', { class: 'r col' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, 'Import registry'), h('div', { class: 't2' }, 'Imported INSTALLED/CONFIGURED states become NEEDS_VERIFICATION: an install is never inherited.')),
          h('div', { class: 'row' }, file, btn('Dry run', async () => { fill(impOut, kvResult(await api('importData', { data: await readFile(), dryRun: true }))); }, { iconName: 'search' }), btn('Import', async () => { const data = await readFile(); const r = await withProgress('Importing the registry', () => api('importData', { data, dryRun: false }).then(x => ({ ...x, message: `${x.created} created, ${x.merged} merged.` })), { stage: 'Validating and writing…' }); fill(impOut, kvResult(r)); }, { kind: 'primary', iconName: 'upload' })), impOut)))));
}
const kvResult = r => kv(Object.entries(r).map(([k, v]) => [k, String(v)]));

export async function about() {
  const [s, b] = await Promise.all([api('status'), api('bootstrapState')]);
  const keys = [[mod('K'), 'Command palette'], [mod('1–6'), 'Move between sections'], [mod(','), 'Settings'], ['/', 'Focus the page search'], [mod('R'), 'Refresh data'], ['Esc', 'Close dialogs and menus'], ['Right-click or ⋯', 'Actions on a resource'], ['Drag a URL', 'Add to the catalogue']];
  return h('div', { class: 'page narrow' },
    h('div', { class: 'about-mark' }, brandMark({ size: 64 }), h('img', { src: 'brand/curi-wordmark-on-dark.svg', alt: 'CURI', class: 'about-wordmark' })),
    pageHead({ eyebrow: 'System', title: 'About CURI', sub: `CURI ${s.version || ''}: Node engine (SQLite/FTS5), CLI, stdio MCP server, Claude skill and native Tauri app.` }),
    h('div', { class: 'grid cols-2 reveal' },
      panel({ title: 'Updates', actions: btn('Check', async () => {
        const box = document.getElementById('upd');
        // The desktop app checks and installs signed updates itself; the answer arrives as an update banner.
        const r = await api('shellCommand', { cmd: 'update-check' });
        if (r.sent) { fill(box, h('p', { class: 'muted', style: { margin: 0 } }, 'Checking GitHub for a newer version…')); addEventListener('curi-update', e => fill(box, notice(e.detail.error ? 'warn' : 'info', e.detail.error ? `Couldn't check: ${e.detail.error}` : e.detail.upToDate ? `You're on the latest version (${e.detail.current}).` : `CURI ${e.detail.version} is ready to install; see the banner.`)), { once: true }); return; }
        const u = await api('updateCheck');
        fill(box, u.status === 'available' ? h('div', { class: 'stack' }, notice('info', `Version ${u.latest} is available (you have ${u.current}).${u.has_checksums ? ' The release publishes SHA256SUMS to verify the download.' : ' Note: this release doesn\'t publish SHA256SUMS.'}`), h('a', { class: 'btn primary', href: u.url, onclick: e => { e.preventDefault(); api('openExternal', { url: u.url }); } }, 'Open the release page'))
          : notice(u.status === 'up_to_date' ? 'info' : 'warn', u.status === 'up_to_date' ? `You're on the latest version (${u.current}).` : u.detail));
      }, { kind: 'ghost sm', iconName: 'refresh' }) }, h('div', { id: 'upd' }, h('p', { class: 'muted', style: { margin: 0 } }, 'CURI checks for a new version on launch and every six hours, and tells you when one is ready. Updates are signed and install with one click.'))),
      panel({ title: 'Status' }, kv([['Setup', status(b.state)], ['Schema', `v${s.schema_version}`], ['Resources', fmtInt(s.resources)], ['Verified sources', fmtInt(s.verified_sources)], ['Version', s.version || '—'], ['Platform', navigator.userAgent.includes('Windows') ? 'Windows' : /Mac/.test(navigator.platform) ? 'macOS' : 'Linux']])),
      panel({ title: 'Shortcuts' }, h('dl', { class: 'keys' }, keys.flatMap(([k, d]) => [h('dt', null, h('kbd', null, k)), h('dd', null, d)]))),
      panel({ title: 'Known limitations' }, h('ul', { class: 'plain' }, ['claude.ai account skills are read from Claude Desktop\'s synced copy; manage them on claude.ai.', 'Star velocity needs at least two real snapshots in the window.', 'Without GITHUB_TOKEN: 60 requests/h and 10 searches/min.', 'Seed descriptions are "speculative" until verified.', 'Builds aren\'t signed by Apple or Microsoft yet, so the first install from a browser shows a warning; the install commands and in-app updates don\'t.'].map(t => h('li', null, icon('info', 'sm'), t)))),
      panel({ title: 'Recovery' }, h('ul', { class: 'plain' }, [['curi doctor', 'diagnostics'], ['curi drift', 'external changes'], ['curi rollback <tx>', 'revert integration'], ['curi backup', 'database copy'], ['npm test', 'test suite (core/)']].map(([c, d]) => h('li', null, icon('terminal', 'sm'), h('code', { class: 'mono' }, c), h('span', { class: 'muted' }, ` — ${d}`)))))));
}
