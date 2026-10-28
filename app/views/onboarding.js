import { h, fmtDate, relTime, fmtInt, fill } from '../lib/dom.js';
import { icon, brandMark } from '../lib/icons.js';
import { api, btn, linkBtn, status, badge, panel, pageHead, notice, kv, table, toast, confirmDialog } from '../lib/ui.js';
import { go, mount, setPoll } from '../app.js';
import { modePicker, claudeCard } from './control.js';

const WPS = [
  ['WP1-preflight', 'Check this device', 'System, tools, Claude Code and what\'s already installed. Read-only.', 'terminal'],
  ['WP2-snapshot', 'Backup', 'A checksummed copy of your Claude configuration before any change.', 'database'],
  ['WP3-import', 'Seed catalogue', 'Import the starter catalogue into the local registry, without losing a single URL.', 'library'],
  ['WP4-plan', 'Review and approve', 'Every change to your profile has its own approval.', 'shield'],
  ['WP5-provision', 'Apply', 'Write only what you approved, in a reversible transaction.', 'bolt'],
  ['WP6-verify', 'Verify', 'Independent checks of the real state. No promises taken on trust.', 'check'],
];

export async function welcome() {
  const [s, b] = await Promise.all([api('status'), api('bootstrapState')]);
  const started = b.state !== 'UNINITIALIZED';
  return h('div', { class: 'page welcome' },
    h('section', { class: 'hero' },
      h('div', { class: 'hero-mark', 'aria-hidden': 'true' }, brandMark({ size: 52 })),
      h('div', { class: 'micro' }, 'Claude Universal Resource Intelligence'),
      h('h1', null, 'The right tool, at the right moment.'),
      h('p', null, 'CURI keeps a local, verifiable registry of skills, MCP servers, libraries and tools. It shows you what your agents already have, installs what\'s missing with one click, and never installs anything behind your back.'),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        linkBtn(['READY', 'PARTIAL_READY'].includes(b.state) ? 'Review setup' : started ? 'Continue setup' : 'Start setup', '#/wizard', { kind: 'primary', iconName: 'wizard' }),
        s.resources ? linkBtn('Explore in read-only mode', '#/library', { iconName: 'library' })
          : btn('Explore in read-only mode', async () => { await api('bootstrapAdvance'); toast('Preparing the local catalogue…'); setTimeout(() => go('library'), 1500); }, { iconName: 'library' })),
      h('div', { class: 'hero-state' }, 'Current state ', status(b.state))),
    h('div', { class: 'grid cols-3 reveal' },
      pillar('lock', 'Local and private', 'The database lives on your computer. No telemetry. The interface only listens on 127.0.0.1, with a token.'),
      pillar('shield', 'Nothing without approval', 'Exactly two possible changes to your Claude profile, each approved separately and reversible.'),
      pillar('check', 'Proven, not promised', 'It only says "Ready" after independent checks of the real state.')));
}
const pillar = (ic, t, d) => h('div', { class: 'pillar' }, h('span', { class: 'itile' }, icon(ic)), h('h3', null, t), h('p', null, d));

export async function wizard() {
  const root = h('div', { class: 'page' });
  let lastState = null;

  async function render() {
    if (document.activeElement?.closest?.('.approvals')) return true; // don't steal the user's in-progress choices
    const [b, jobs, running, pol, cs] = await Promise.all([api('bootstrapState'), api('jobs', { limit: 80 }), api('running'), api('policy'), api('claudeStatus')]);
    const busy = running.jobs.includes('bootstrap');
    const done = b.data?.completed || {};
    const doneCount = WPS.filter(([id]) => done[id]).length;
    const currentIdx = WPS.findIndex(([id]) => !done[id]);
    const terminal = ['READY', 'PARTIAL_READY', 'FAILED', 'CANCELLED'].includes(b.state);

    const stepper = h('ol', { class: 'stepper', 'aria-label': 'Setup steps' }, WPS.map(([id, title, desc, ic], i) => {
      const st = done[id] ? 'done' : i === currentIdx && !terminal ? (busy ? 'active' : b.state === 'APPROVAL_REQUIRED' && id === 'WP5-provision' ? 'waiting' : 'next') : 'todo';
      return h('li', { class: `step ${st}`, 'aria-current': st === 'active' || st === 'waiting' ? 'step' : null },
        h('span', { class: 'step-node' }, st === 'done' ? icon('check', 'sm') : st === 'active' ? h('span', { class: 'spin' }) : icon(ic, 'sm')),
        h('div', null, h('div', { class: 'step-title' }, title), h('div', { class: 'step-desc' }, done[id] ? `Done ${relTime(done[id].at)}` : desc)));
    }));

    const controls = h('div', { class: 'row' },
      ['UNINITIALIZED', 'PREFLIGHT', 'ENVIRONMENT_AUDITED', 'PLAN_READY', 'RECOVERING', 'VERIFYING', 'PROVISIONING'].includes(b.state)
        ? btn(b.state === 'UNINITIALIZED' ? 'Start' : 'Continue', async () => { await api('bootstrapAdvance'); setTimeout(render, 300); }, { kind: 'primary', iconName: 'play', disabled: busy }) : null,
      b.state === 'PAUSED' ? btn('Resume', async () => { await api('bootstrapResume'); render(); }, { iconName: 'play' })
        : !terminal ? btn('Pause', async () => { await api('bootstrapPause'); render(); }, { kind: 'ghost', iconName: 'pause' }) : null,
      done['WP5-provision'] ? btn('Revert integration', async () => {
        if (!await confirmDialog({ title: 'Revert the Claude integration?', body: 'Removes only what CURI wrote (the skill and the MCP entry). Changes you made to those files block the removal.', confirm: 'Revert', danger: true })) return;
        const r = await api('bootstrapRollback'); toast(`Rollback: ${r.rollback.status}`, r.rollback.status === 'rolled_back' ? 'good' : 'bad'); render();
      }, { kind: 'ghost danger', iconName: 'undo' }) : null,
      !terminal && b.state !== 'UNINITIALIZED' ? btn('Cancel', async () => { if (await confirmDialog({ title: 'Cancel setup?', body: 'Progress is saved; you can resume later.', confirm: 'Cancel setup' })) { await api('bootstrapCancel'); render(); } }, { kind: 'ghost' }) : null);

    const sections = [];
    const pf = b.data?.preflight;
    if (pf) sections.push(panel({ title: 'Your computer', meta: relTime(pf.checked_at) }, kv([
      ['System', `macOS ${pf.os.macos || pf.os.release} · ${pf.os.arch} · ${pf.disk_free_gb} GB livres`],
      ['Tools', `Node ${pf.toolchain.node} · ${pf.toolchain.git || 'no git'} · Rust ${pf.toolchain.rust ? 'installed' : 'missing'}`],
      ['GitHub', pf.network.github ? status('ok', 'reachable') : status('unreachable')],
      ['Claude Code', pf.claude.binary ? `${pf.claude.version}${pf.claude.on_path ? '' : ' (bundled with the Claude app)'}` : status('fail', 'not found')],
      ['Claude connection', pf.claude.auth?.loggedIn === true ? status('ok', 'connected') : h('span', null, status('blocked', 'not connected'), ' ', h('a', { href: '#/connections', class: 'ext' }, 'Connect Claude'))],
      ['Already installed', `${b.data.inventory?.skills?.length ?? 0} skills · ${b.data.inventory?.mcp?.length ?? 0} servidores MCP · CLAUDE.md ${b.data.inventory?.claude_md?.exists ? 'exists (won\'t be touched)' : 'inexistente'}`]])));
    if (done['WP2-snapshot']) sections.push(panel({ title: 'Backup', meta: `${done['WP2-snapshot'].evidence.files.filter(f => f.existed).length} files`, flush: true },
      h('div', { class: 'rows' }, done['WP2-snapshot'].evidence.files.map(f => h('div', { class: 'r' }, icon(f.existed ? 'check' : 'x', 'sm'), h('div', { class: 'grow' }, h('div', { class: 't1 mono' }, f.path), h('div', { class: 't2 mono' }, f.sha256 ? `sha256 ${f.sha256.slice(0, 24)}…` : 'didn\'t exist')))))));
    if (done['WP3-import']) { const e = done['WP3-import'].evidence; sections.push(panel({ title: 'Catalogue' }, h('div', { class: 'flow' },
      flowStep(fmtInt(e.occurrences), 'URL occurrences'), icon('chevron'), flowStep(fmtInt(e.unique_urls), 'URLs originais'), icon('chevron'), flowStep(fmtInt(e.after), 'canonical resources')),
      h('p', { class: 'muted', style: { margin: '12px 0 0' } }, `${e.created} created now · ${e.linked} sightings linked · ${e.invalid} invalid. All start as catalogued, not verified.`))); }

    if (b.state === 'APPROVAL_REQUIRED' && b.data.plan) {
      const p = b.data.plan;
      const pending = p.actions.filter(a => a.state !== 'already-applied');
      const toggles = pending.map(a => ({ a, input: h('input', { type: 'checkbox', role: 'switch', id: `ap-${a.id}` }) }));
      const nv = h('input', { type: 'checkbox', role: 'switch', id: 'ap-net' }), cs = h('input', { type: 'checkbox', role: 'switch', id: 'ap-cs' });
      const opt = (input, title, risk, kind, desc, detail) => h('label', { class: 'approval', for: input.id }, h('span', { class: 'switch' }, input, h('span')),
        h('div', { class: 'grow' }, h('div', { class: 'row' }, h('strong', null, title), badge(risk, kind)), h('div', { class: 'muted' }, desc), detail ? h('div', { class: 'mono path' }, detail) : null));
      sections.unshift(panel({ title: 'Review and approve', meta: 'nothing is written without approval', cls: 'approvals' },
        h('div', { class: 'stack' },
          pending.length ? toggles.map(({ a, input }) => opt(input, a.id === 'skill.write' ? 'Install the curi-resource-router skill' : a.state === 'update' ? 'Update the "curi" MCP entry' : 'Register the "curi" MCP server', a.risk, 'warn',
            a.id === 'skill.write' ? 'A compact skill (≈2 KB) that teaches Claude to query the registry.' : a.exposes || 'Read-only stdio server, started by Claude Code when needed.', a.path || a.via)) : notice('info', 'The integration is already applied.'),
          p.conflicts.map(c => notice('bad', `Conflict (${c.action}): ${c.reason}`)),
          h('div', { class: 'micro', style: { marginTop: '8px' } }, 'Optional'),
          opt(nv, 'Verify sources online', 'NETWORK_DISCOVERY', 'info', 'git ls-remote on up to 40 repositories. No API quota, no code runs.'),
          opt(cs, 'Test with a real request to Claude', 'COST_BEARING', 'warn', 'Sends Claude a request that uses the curi tool, to prove the integration end to end. Uses your account\'s quota; needs Claude connected.'),
          h('details', { class: 'untouched' }, h('summary', null, 'What\'s never touched'), h('ul', { class: 'plain' }, p.untouched.map(u => h('li', null, icon('lock', 'sm'), u)))),
          h('div', { class: 'row' }, h('span', { class: 'spacer' }), btn('Continue with these choices', async () => {
            await api('bootstrapAdvance', { decisions: { approve: toggles.filter(t => t.input.checked).map(t => t.a.id).concat(p.actions.filter(a => a.state === 'already-applied').map(a => a.id)), networkVerify: nv.checked, cleanSession: cs.checked } });
            toast('Approvals recorded in the audit log.', 'good');
            setTimeout(render, 300);
          }, { kind: 'primary', iconName: 'check' })))));
    }

    const ver = done['WP6-verify']?.evidence;
    if (ver) sections.unshift(panel({ title: 'Result', cls: `result ${ver.verdict}` },
      h('div', { class: 'result-hero' }, h('span', { class: `result-ic ${ver.verdict === 'READY' ? 'good' : ver.verdict === 'FAILED' ? 'bad' : 'warn'}` }, icon(ver.verdict === 'READY' ? 'check' : ver.verdict === 'FAILED' ? 'x' : 'alert', 'lg')),
        h('div', null, h('h3', null, ver.verdict === 'READY' ? 'All verified' : ver.verdict === 'PARTIAL_READY' ? 'Ready, with limitations' : 'Verification failed'), h('p', { class: 'muted' }, `${ver.passed} of ${ver.total} checks passed.`))),
      h('div', { class: 'segmeter' }, Array.from({ length: ver.total }, (_, i) => h('i', { class: i < ver.passed ? 'pass' : 'fail' }))),
      ver.mandatory_failed?.length ? notice('bad', `Required checks failed: ${ver.mandatory_failed.join(', ')}`) : null,
      [...(ver.optional_unavailable || []), ...(ver.missing || [])].length ? notice('warn', `Unavailable: ${[...(ver.optional_unavailable || []), ...(ver.missing || [])].join(' · ')}`) : null,
      h('div', { class: 'row', style: { marginTop: '12px' } }, linkBtn('Open Home', '#/dashboard', { kind: 'primary', iconName: 'dashboard' }), linkBtn('Verification details', '#/bridge', { kind: 'ghost' }))));

    // Consent and Claude connection are part of onboarding, but never block the catalogue.
    if (pol.consent.implicit) sections.unshift(panel({ title: 'Automatic installs and system management', cls: 'consent' },
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'Choose what CURI may do without asking. You can change or revoke it any time in Settings › Autonomy.'),
      modePicker(pol, render),
      h('div', { class: 'row', style: { marginTop: '12px' } }, h('a', { class: 'btn ghost', href: '#/automation' }, 'Review permissions in detail'), h('span', { class: 'spacer' }),
        btn('Continue with manual approval', async () => { await api('policyGrant', { mode: 'standard' }); toast('Standard mode: you approve every install.', 'good'); render(); }, { kind: 'ghost' }))));
    if (!['connected', 'verified', 'external_provider'].includes(cs.state)) sections.unshift(claudeCard(cs, render));
    if (!sections.length) sections.push(panel({}, h('div', { class: 'empty' }, h('div', { class: 'glyph' }, icon('wizard', 'lg')), h('h4', null, 'Ready to start'), h('p', null, 'The first step is read-only: it inspects your computer and Claude Code. You can pause or cancel at any time; progress is saved.'))));

    const log = jobs.filter(j => j.job === 'bootstrap').slice(0, 40);
    fill(root, 
      pageHead({ eyebrow: 'Setup', title: terminal ? 'Setup complete' : 'Guided setup', sub: 'Each step saves a durable checkpoint. You can close the app: when you reopen it, it resumes at the first unverified step and nothing is applied twice.', actions: [status(b.state), controls] }),
      h('div', { class: 'wizard-grid' },
        h('aside', { class: 'panel wizard-steps' }, h('div', { class: 'panel-body' }, h('div', { class: 'row', style: { marginBottom: '14px' } }, h('span', { class: 'micro' }, 'Progress'), h('span', { class: 'spacer' }), h('span', { class: 'num' }, `${doneCount}/${WPS.length} verificados`)), stepper)),
        h('div', { class: 'stack' }, ...sections,
          h('details', { class: 'panel log-panel' }, h('summary', { class: 'panel-head' }, h('h2', null, 'Event log'), h('span', { class: 'micro' }, `${log.length}`)),
            h('div', { class: 'panel-body' }, h('div', { class: 'log', role: 'log' }, log.map(j => h('div', { class: j.level }, h('span', { class: 'muted' }, fmtDate(j.ts)), ' ', j.step || '', ' — ', j.message))))))));
    if (lastState && lastState !== b.state && ['READY', 'PARTIAL_READY', 'FAILED'].includes(b.state)) api('notify', { title: 'CURI', body: `Setup: ${b.state}` }).catch(() => {});
    lastState = b.state;
    return busy;
  }
  const busy = await render();
  setPoll(async () => render(), busy ? 1200 : 2000);
  return root;
}
const flowStep = (n, l) => h('div', { class: 'flow-step' }, h('div', { class: 'num flow-n' }, n), h('div', { class: 'micro' }, l));
