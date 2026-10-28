import { h, relTime, fmtDate, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, linkBtn, status, badge, panel, pageHead, empty, notice, kv, table, toast, confirmDialog, dot, when } from '../lib/ui.js';
import { mount } from '../app.js';
import { runOperation } from './control.js';
import { withProgress } from '../lib/opmodal.js';

const CHECK_LABEL = {
  'db.integrity': 'Database integrity', 'registry.seed_preservation': 'All seed URLs preserved', 'index.fts_consistency': 'Search index consistent',
  'search.smoke': 'Routing (REA, React Bits, Blender)', 'cli.smoke': 'CLI answers in JSON', 'mcp.live_stdio': 'MCP answers live', 'mcp.access_control': 'MCP recusa pedidos perigosos',
  'audit.hash_chain': 'Audit chain intact', 'bridge.skill_files': 'Skill installed and intact', 'bridge.mcp_config': 'MCP entry correct', 'bridge.idempotent_plan': 'Re-applying duplicates nothing',
  'bridge.mcp_health_via_claude': 'Claude Code connects to the MCP', 'claude.clean_session': 'A clean Claude session uses CURI',
};
const sevKind = s => (s.high ? 'fail' : s.medium ? 'blocked' : 'pass');

function scanResult(r, title) {
  return panel({ title: `Static analysis · ${title}`, meta: `${r.bytes} bytes` },
    h('div', { class: 'row', style: { marginBottom: '10px' } }, status(r.verdict === 'pass' ? 'pass' : r.verdict === 'review' ? 'blocked' : 'fail', r.verdict === 'pass' ? 'No findings' : r.verdict === 'review' ? 'Review' : 'Block'), h('span', { class: 'muted' }, 'Analysis without execution; content is treated as data.')),
    r.findings.length ? table([{ label: 'Rule', cell: f => h('span', { class: 'mono' }, f.rule) }, { label: 'Severity', cell: f => badge(f.severity, f.severity === 'high' ? 'bad' : f.severity === 'medium' ? 'warn' : '') }, { label: 'Line', num: true, cell: f => f.line }, { label: 'Message', cell: f => f.message }, { label: 'Excerpt', cell: f => h('span', { class: 'mono' }, f.excerpt) }], r.findings) : null);
}

export async function skills() {
  const [inv, audit] = await Promise.all([api('inventory'), api('audit')]);
  const scanSlot = h('div');
  const byScope = inv.skills.reduce((m, s) => (m[s.scope] = (m[s.scope] || 0) + 1, m), {});
  const flagged = inv.skills.filter(s => s.security.high || s.security.medium).length;
  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'Manage', title: 'Skills', sub: `Skills found in ${inv.claude_home}. CURI only changes its own skill; the others are inspected, never modified.` }),
    h('section', { class: 'panel kpis small' },
      kpiMini('On disk', inv.skills.length), kpiMini('User scope', byScope.user || 0), kpiMini('Via plugins', byScope.plugin || 0), kpiMini('Managed by CURI', inv.skills.filter(s => s.managed_by_curi).length), kpiMini('With findings', flagged)),
    h('div', { class: 'stack-lg reveal' },
      inv.limits.map(l => notice('info', l)),
      panel({ title: 'Installed', flush: true }, inv.skills.length ? h('div', { class: 'rows' }, inv.skills.map(s => h('div', { class: 'r' },
        h('span', { class: 'itile' }, icon('skills')),
        h('div', { class: 'grow' }, h('div', { class: 't1' }, s.name), h('div', { class: 't2 clamp1' }, s.description || 'no description')),
        badge(s.scope), s.managed_by_curi ? badge('CURI', 'info') : null, status(sevKind(s.security), s.security.high ? `${s.security.high} alto` : s.security.medium ? `${s.security.medium} medium` : 'limpo'),
        btn('Scan', async () => { const r = await withProgress(`A analisar ${s.name}`, () => api('scanSkill', { dir: s.dir }).then(x => ({ ...x, message: `${x.findings.length} achado(s).` }))); fill(scanSlot, scanResult(r, s.name)); scanSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, { kind: 'ghost sm', iconName: 'shield' }))))
        : empty('skills', 'No skills on disk')),
      scanSlot,
      panel({ title: 'Conflicts between scopes' }, inv.conflicts.length ? table([{ label: 'Name', cell: c => c.name }, { label: 'Locations', cell: c => h('span', { class: 'mono' }, c.locations.join(' · ')) }], inv.conflicts) : h('div', { class: 'row muted' }, icon('check'), 'No name conflicts on disk.')),
      h('div', { class: 'grid cols-2' },
        panel({ title: 'Precedence policy' }, h('ol', { class: 'precedence' }, audit.precedence_policy.map(p => h('li', null, h('span', { class: 'rank num' }, p.rank), p.rule)))),
        panel({ title: 'Overlaps in catalogued packs', meta: `${audit.skill_overlaps.length}`, flush: true }, table([{ label: 'Capability', cell: o => o.capability }, { label: 'By precedence', cell: o => o.resources.map(r => r.name).join(' → ') }], audit.skill_overlaps.slice(0, 20))))));
}
const kpiMini = (l, v) => h('div', { class: 'kpi' }, h('span', { class: 'micro' }, l), h('div', { class: 'kpi-value num' }, v));

export async function mcp() {
  const inv = await api('inventory');
  const health = new Map();
  let tested = null;
  const grid = h('div', { class: 'conn-grid reveal' });
  const draw = () => fill(grid, ...(inv.mcp.length ? inv.mcp.map(s => {
    const hl = health.get(s.name);
    return h('article', { class: 'panel conn' }, h('div', { class: 'panel-body' },
      h('div', { class: 'row nowrap' }, h('span', { class: 'itile' }, icon('mcp')), h('div', { class: 'grow' }, h('div', { class: 't1' }, s.name), h('div', { class: 't2' }, `${s.scope}${s.project ? ` · ${s.project}` : ''} · ${s.transport}`)),
        hl ? status(hl.healthy ? 'pass' : 'fail', hl.healthy ? 'Connected' : 'Failed') : badge(tested ? 'not listed' : 'configurado')),
      h('div', { class: 'mono conn-cmd selectable' }, [s.command, ...(s.args || [])].join(' ')),
      h('div', { class: 'row' }, s.env_keys.length ? s.env_keys.map(k => badge(`env ${k}`)) : h('span', { class: 'muted' }, 'no environment variables'), s.name === 'curi' ? badge('managed by CURI', 'info') : null),
      hl && !hl.healthy ? notice('bad', hl.status) : null));
  }) : [panel({}, empty('mcp', 'No MCP servers configured'))]));
  draw();
  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'Manage', title: 'MCP servers', sub: 'Configured isn\'t the same as working. The test starts each server the way a Claude session would. Environment variable values are never read, only their names.', actions: [
      btn('Test connections', async () => { await withProgress('Testing MCP servers', async () => { const r = await api('mcpHealth'); if (!r.available) return { ok: false, message: 'Claude Code isn\'t installed.' }; tested = new Date().toISOString(); health.clear(); r.servers.forEach(s => health.set(s.name, s)); draw(); return `${r.servers.filter(s => s.healthy).length} of ${r.servers.length} connected.`; }, { stage: 'Claude Code is starting each configured server…' }).catch(() => {}); }, { kind: 'primary', iconName: 'refresh' })] }),
    inv.mcp_duplicates.length ? notice('warn', `Possible duplicates: ${inv.mcp_duplicates.map(d => d.entries.join(' = ')).join(' · ')}`) : null,
    grid);
}

export async function bridge() {
  const [pf, plan, txs, drift, s] = await Promise.all([api('preflight'), api('bridgePlan'), api('transactions'), api('drift'), api('status')]);
  const results = h('div');
  const pending = plan.actions.filter(a => a.state !== 'already-applied');
  const toggles = pending.map(a => ({ a, input: h('input', { type: 'checkbox', role: 'switch', id: `b-${a.id}` }) }));
  const cs = h('input', { type: 'checkbox', role: 'switch', id: 'b-cs' });
  const integ = s.installed_by_curi;
  const lv = s.last_verification;
  const healthy = integ.length && integ.every(i => ['files-ok', 'configured'].includes(i.health)) && !drift.drift.length;

  const runVerify = async () => {
    const op = await runOperation('verify.run', { requireBridge: integ.length > 0, cleanSession: cs.checked }, cs.checked ? 'Verification with a real request to Claude' : 'Independent verification', { refresh: false });
    const v = op?.verification;
    if (!v?.checks) return;
    fill(results, panel({ title: 'Independent verification', meta: `${v.passed}/${v.total} · ${v.verdict}`, flush: true },
      h('div', { class: 'rows' }, v.checks.map(c => h('details', { class: 'r check' }, h('summary', { class: 'row nowrap' }, h('span', { class: `check-ic ${c.status}` }, icon(c.status === 'pass' ? 'check' : c.status === 'blocked' ? 'lock' : 'x', 'sm')),
        h('div', { class: 'grow' }, h('div', { class: 't1' }, CHECK_LABEL[c.id] || c.id), h('div', { class: 't2 mono' }, `${c.id}${c.mandatory ? '' : ' · opcional'}`)), h('span', { class: 'muted num' }, `${c.ms} ms`), icon('chevronDown', 'sm')),
        h('pre', { class: 'evidence' }, JSON.stringify(c.evidence, null, 2))))),
      h('div', { class: 'panel-foot mono muted' }, v.receipt_file)));
  };

  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'Manage', title: 'Claude integration', sub: 'A compact skill and a read-only stdio MCP server. They work without the app open: Claude Code starts the MCP directly.' }),
    h('section', { class: `panel bridge-hero ${healthy ? 'ok' : integ.length ? 'warn' : ''}` }, h('div', { class: 'panel-body' },
      h('div', { class: 'bh-status' }, h('span', { class: `result-ic ${healthy ? 'good' : integ.length ? 'warn' : ''}` }, icon(healthy ? 'check' : integ.length ? 'alert' : 'bridge', 'lg')),
        h('div', null, h('h3', null, healthy ? 'Integration active' : integ.length ? 'Integration needs attention' : 'Integration not applied'),
          h('p', { class: 'muted' }, lv ? `Last check ${relTime(lv.ts)}: ${lv.passed}/${lv.total}` : 'No verification recorded yet.'))),
      h('div', { class: 'bh-facts' },
        fact('Claude Code', pf.claude.version || 'not found'), fact('Connection', pf.claude.auth?.loggedIn === true ? 'connected' : h('a', { href: '#/connections', class: 'ext' }, pf.claude.auth?.loggedIn === false ? 'not connected, connect Claude' : 'unknown, see Connections')),
        fact('MCP protocol', 'stdio · 2024-11 → 2025-11'), fact('Profile', h('span', { class: 'mono' }, pf.paths.claude_home))),
      h('div', { class: 'row' }, h('label', { class: 'row nowrap', for: 'b-cs' }, h('span', { class: 'switch' }, cs, h('span')), 'Include a real request to Claude ', badge('consome uso', 'warn')), h('span', { class: 'spacer' }), btn('Run verification', runVerify, { kind: 'primary', iconName: 'shield' })))),
    h('div', { class: 'stack-lg reveal' },
      results,
      drift.drift.length ? notice('bad', `Drift: ${drift.drift.map(d => d.name).join(', ')} was changed outside CURI. It won't be overwritten automatically.`) : null,
      panel({ title: 'Observed state', flush: true }, integ.length ? h('div', { class: 'rows' }, integ.map(i => h('div', { class: 'r' }, h('span', { class: 'itile' }, icon(i.kind === 'mcp' ? 'mcp' : 'skills')), h('div', { class: 'grow' }, h('div', { class: 't1' }, `${i.kind} · ${i.name}`), h('div', { class: 't2' }, `observado ${relTime(i.observed_at)}`)), status(i.health)))) : empty('bridge', 'Nothing applied', 'Use the guided setup or approve the actions below.')),
      panel({ title: 'Proposed changes', meta: pending.length ? `${pending.length} pendente(s)` : 'up to date' },
        h('div', { class: 'stack' }, plan.actions.map(a => h('div', { class: 'row nowrap plan-row' }, status(a.state === 'already-applied' ? 'pass' : 'pending', a.state === 'already-applied' ? 'Applied' : a.state === 'update' ? 'Update' : 'New'), h('strong', null, a.id), badge(a.risk, 'warn'), h('span', { class: 'mono muted clamp1 grow' }, a.path || a.via || a.target))),
          plan.conflicts.map(c => notice('bad', `${c.action}: ${c.reason}`)),
          pending.find(a => a.preview) ? h('details', null, h('summary', { class: 'muted' }, 'Preview SKILL.md'), h('pre', null, pending.find(a => a.preview).preview)) : null,
          toggles.length ? [toggles.map(({ a, input }) => h('label', { class: 'row nowrap', for: input.id }, h('span', { class: 'switch' }, input, h('span')), `I approve ${a.id}`)),
            h('div', { class: 'row' }, h('span', { class: 'spacer' }), btn('Apply approved', async () => {
              if (toggles.some(t => !t.input.checked)) { toast('Approve both changes: the integration applies them together.', 'bad'); return; }
              await runOperation('curi.integration', {}, 'Apply the Claude integration');
            }, { kind: 'primary', iconName: 'check' }))] : null)),
      panel({ title: 'Transactions', flush: true }, table([
        { label: 'ID', cell: t => h('span', { class: 'mono' }, t.id) }, { label: 'Kind', cell: t => t.kind }, { label: 'Status', cell: t => status(t.status) }, { label: 'Created', cell: t => when(t.created_at) },
        { label: '', cell: t => (t.status === 'committed' ? btn('Revert', () => runOperation('curi.rollback', { tx: t.id }, `Revert ${t.id}`), { kind: 'ghost sm danger', iconName: 'undo' }) : null) }], txs, { emptyText: 'No transactions.' }))));
}
const fact = (l, v) => h('div', null, h('span', { class: 'micro' }, l), h('div', null, v));

export async function security() {
  const [a, inv] = await Promise.all([api('audit'), api('inventory')]);
  const area = h('textarea', { class: 'area', 'aria-label': 'Text to scan', placeholder: 'Paste a README, SKILL.md, MCP description or hooks configuration…' });
  const out = h('div');
  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'Manage', title: 'Security', sub: 'External content is treated as untrusted data. Static analysis runs nothing and never grants authority.' }),
    h('div', { class: 'grid cols-main reveal' },
      panel({ title: 'Scan content' }, area, h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'muted' }, '12 rules: prompt injection, pipe-to-shell, credentials, hooks, persistence, hidden unicode…'), h('span', { class: 'spacer' }),
        btn('Scan', async () => { if (!area.value.trim()) return; fill(out, scanResult(await api('scanText', { text: area.value }), 'texto colado')); }, { kind: 'primary', iconName: 'shield' })), out),
      panel({ title: 'Policy in force' }, h('ul', { class: 'plain policy' }, [
        ['lock', 'No silent installs; every risky action has its own approval.'], ['mcp', 'CURI\'s MCP: no shell, no file access, validated arguments.'],
        ['shield', 'App: 127.0.0.1 only, token, Host/Origin checks, strict CSP, no CORS.'], ['alert', 'Offensive tools (pentest, RE) only against authorised targets.'], ['activity', 'Telemetry off.']].map(([ic, t]) => h('li', null, icon(ic, 'sm'), t))))),
    h('div', { class: 'stack-lg', style: { marginTop: '16px' } },
      panel({ title: 'Resources with risk notes', meta: `${a.risks.length}`, flush: true }, table([{ label: 'Resource', cell: r => h('a', { href: `#/resource/${encodeURIComponent(r.id)}` }, r.name) }, { label: 'Note', cell: r => r.risk_notes }], a.risks)),
      h('div', { class: 'grid cols-2' },
        panel({ title: 'Local skills', flush: true }, table([{ label: 'Skill', cell: s => s.name }, { label: 'Scope', cell: s => s.scope }, { label: 'High', num: true, cell: s => s.security.high }, { label: 'Medium', num: true, cell: s => s.security.medium }, { label: 'Low', num: true, cell: s => s.security.low }], inv.skills)),
        panel({ title: 'Orchestration (max. 1 active)', flush: true }, table([{ label: 'Framework', cell: o => o.name }, { label: 'Precedence', num: true, cell: o => o.rank }], a.orchestration_frameworks.items))),
      panel({ title: 'Unavailable or deprecated', flush: true }, table([{ label: 'Resource', cell: r => r.name }, { label: 'Status', cell: r => status(r.status) }], a.unavailable_or_deprecated, { emptyText: 'None.' }))));
}
