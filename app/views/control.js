import { h, relTime, fmtDate, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, status, badge, panel, pageHead, empty, notice, kv, table, toast, confirmDialog, externalLink, segmented, meter, when, pager } from '../lib/ui.js';
import { go, mount, setPoll, params } from '../app.js';
import { showOperation, withProgress } from '../lib/opmodal.js';

// ---------- shared: preview the policy decision, confirm, enqueue as explicitly approved ----------
const DECISION = { auto: ['good', 'Automatic by policy'], ask: ['warn', 'Needs your approval'], block: ['bad', 'Blocked'] };
// Preview → (confirm unless it is read-only observation) → enqueue → live progress modal → refresh view.
export async function runOperation(kind, params, title, { refresh = true } = {}) {
  const p = await api('opPreview', { kind, params });
  if (p.decision === 'block') {
    await confirmDialog({ title: `${title}: not possible`, body: p.reasons, confirm: 'Got it' });
    return null;
  }
  // The click is the intent: work the chosen autonomy mode already covers runs without a second question.
  // Anything the mode does not cover, and every removal, still asks here.
  if (!(p.decision === 'auto' && p.category !== 'destructive')) {
    const ok = await confirmDialog({ title, body: [`Resource: ${p.resource}`, p.source ? `Source: ${p.source}` : null, ...p.reasons].filter(Boolean), confirm: 'Run', danger: p.category === 'destructive' });
    if (!ok) return null;
  }
  const op = await api('opEnqueue', { kind, params, approved: true });
  const final = await showOperation(op.id, title);
  if (refresh) mount();
  return final;
}

// =====================================================================================
// Connections
// =====================================================================================
const CLAUDE_COPY = {
  not_installed: ['x', 'Claude Code isn\'t installed', 'CURI works in catalogue mode. To connect Claude, CURI installs the official CLI into its own runtime the next time the app opens, or you can install the Claude app.'],
  inaccessible: ['alert', 'Claude Code isn\'t responding', 'The executable exists but didn\'t start. Reinstall the Claude app, or reopen CURI to reinstall it in the runtime.'],
  disconnected: ['bridge', 'Claude Code isn\'t connected', 'Connect your account so CURI can verify the integration with real requests. The catalogue, search and discovery work without it.'],
  connecting: ['clock', 'Waiting for approval in the browser', 'Approve access on the page that opened. This window updates on its own when you\'re done.'],
  connected: ['check', 'Claude Code connected', 'Session active. You can verify it with a real request (uses your account\'s quota).'],
  verified: ['check', 'Claude Code connected and verified', 'A real request through Claude Code used CURI successfully.'],
  expired: ['clock', 'Session expired', 'Connect again to renew the session.'],
  external_provider: ['lock', 'Sign-in handled by another provider', 'Claude Code is set up for Bedrock/Vertex; sign-in happens in that configuration.'],
  no_model_access: ['lock', 'This account can\'t use the model', 'The session is active but the verification request was refused. Check the account\'s plan or organisation.'],
  offline: ['alert', 'No internet connection', 'Couldn\'t reach Anthropic. Everything local still works.'],
  failed: ['x', 'Connection failed', 'Sign-in ended without success.'],
  cancelled: ['x', 'Connection cancelled', 'Nothing was changed.'],
};

export function claudeCard(s, refresh) {
  const [ic, title, body] = CLAUDE_COPY[s.state] || ['info', s.title, s.detail];
  const kind = ['connected', 'verified'].includes(s.state) ? 'good' : ['connecting'].includes(s.state) ? 'info' : ['disconnected', 'cancelled'].includes(s.state) ? '' : 'warn';
  const mode = h('select', { class: 'select', 'aria-label': 'Account type' }, h('option', { value: 'claudeai' }, 'Claude subscription (Pro/Max/Team)'), h('option', { value: 'console' }, 'Anthropic Console (API billing)'), h('option', { value: 'sso' }, 'Organisation SSO'));
  const code = h('input', { type: 'text', placeholder: 'Authorisation code', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Authorisation code' });
  const actions = [];
  if (['disconnected', 'expired', 'failed', 'cancelled', 'no_model_access'].includes(s.state)) actions.push(mode, btn('Connect Claude', async () => { await withProgress('Starting the Claude connection', () => api('claudeLoginStart', { mode: mode.value }).then(() => 'We opened your browser. Approve access there; this page updates on its own.'), { stage: 'Opening the authorisation page…' }); refresh(); }, { kind: 'primary', iconName: 'bridge' }));
  if (s.state === 'connecting') actions.push(btn('Cancel', async () => { await api('claudeLoginCancel'); refresh(); }, { kind: 'ghost', iconName: 'x' }));
  if (['connected', 'verified', 'expired', 'no_model_access'].includes(s.state)) actions.push(btn('Verify with a real request', async () => { await withProgress('Real request to Claude through CURI', async () => { const r = await api('claudeVerify'); return r.result.status === 'COMPLETED' ? `Verified: Claude answered "${r.result.answer || 'ok'}".` : { ok: false, message: `Verification ${r.result.status}: ${r.result.reason || ''}` }; }, { stage: 'Claude Code is using the curi tool (up to 2 min)…' }); refresh(); }, { iconName: 'shield' }));
  if (['connected', 'verified'].includes(s.state)) actions.push(btn('Sign out', async () => { if (await confirmDialog({ title: 'Sign out of Claude Code?', body: 'This affects Claude Code across the whole computer, not just CURI.', confirm: 'Sign out', danger: true })) { await withProgress('Signing out of Claude Code', () => api('claudeLogout').then(() => 'Signed out.')); refresh(); } }, { kind: 'ghost' }));
  if (['offline', 'inaccessible', 'not_installed'].includes(s.state)) actions.push(btn('Try again', refresh, { iconName: 'refresh' }));
  return h('section', { class: `panel conn-hero ${kind}` }, h('div', { class: 'panel-body' },
    h('div', { class: 'bh-status' }, h('span', { class: `result-ic ${kind}` }, s.state === 'connecting' ? h('span', { class: 'spin' }) : icon(ic, 'lg')), h('div', { class: 'grow' }, h('div', { class: 'micro' }, 'Claude Code'), h('h3', null, title), h('p', { class: 'muted' }, body))),
    s.state === 'connecting' && s.login?.needs_code ? h('div', { class: 'stack' },
      h('p', { class: 'muted', style: { margin: 0 } }, 'If the browser didn\'t open or showed a code, open the page yourself and paste the code here.'),
      h('div', { class: 'row' }, s.login.manual_url ? externalLink(s.login.manual_url, 'Open the authorisation page') : null),
      h('div', { class: 'row nowrap' }, h('div', { class: 'field grow' }, icon('lock', 'sm'), code), btn('Send code', async () => { await api('claudeLoginCode', { code: code.value }); code.value = ''; setTimeout(refresh, 800); }, { kind: 'primary' }))) : null,
    h('div', { class: 'bh-facts' }, fact('Version', s.version || '—'), fact('Method', s.method || '—'), fact('Provider', s.provider || '—'), fact('Executable', h('span', { class: 'mono' }, s.binary || '—'))),
    h('div', { class: 'row' }, ...actions)));
}
const fact = (l, v) => h('div', null, h('span', { class: 'micro' }, l), h('div', null, v));

const CONN_STATUS = { connected: ['good', 'Connected'], unverified: ['warn', 'Saved, not tested'], invalid: ['bad', 'Invalid credential'], forbidden: ['bad', 'No permission'], unreachable: ['warn', 'Provider unreachable'], error: ['bad', 'Error'], not_configured: ['', 'Not connected'] };

function providerCard(c, refresh) {
  const [k, label] = CONN_STATUS[c.status] || ['', c.status];
  const input = h('input', { type: 'password', placeholder: c.has_secret ? 'Replace the credential…' : 'Paste the key or token', autocomplete: 'off', spellcheck: 'false', 'aria-label': `${c.name} credential` });
  const save = async () => {
    if (!input.value.trim()) { input.focus(); return; }
    const secret = input.value.trim();
    input.value = '';
    await withProgress(`Testing and saving ${c.name}`, async () => { const r = await api('connectionSave', { provider: c.provider, secret }); return r.saved ? `${r.detail} Saved to the system vault.` : { ok: false, message: `${r.detail} Nothing was saved; the previous credential was kept.` }; }, { stage: `Contacting ${c.name}…` }).catch(() => {});
    refresh();
  };
  input.addEventListener('keydown', e => e.key === 'Enter' && save());
  return h('article', { class: 'panel provider' }, h('div', { class: 'panel-body' },
    h('div', { class: 'row nowrap' }, h('span', { class: 'itile' }, icon(c.provider === 'github' ? 'git' : 'bolt')), h('div', { class: 'grow' }, h('div', { class: 't1' }, c.name), h('div', { class: 't2' }, c.account ? `Account: ${c.account}` : c.hint)), h('span', { class: `badge ${k}` }, label)),
    c.detail ? h('p', { class: 'muted small' }, c.detail) : null,
    h('ul', { class: 'plain caps' }, c.capabilities.map(x => h('li', null, icon('check', 'sm'), x))),
    c.keychain ? h('div', { class: 'row nowrap' }, h('div', { class: 'field grow' }, icon('lock', 'sm'), input), btn(c.has_secret ? 'Replace' : 'Save and test', save, { kind: c.has_secret ? '' : 'primary' })) : notice('warn', 'Secure storage isn\'t available on this system.'),
    h('div', { class: 'row' },
      c.has_secret ? btn('Test', async () => { await withProgress(`Testing ${c.name}`, async () => { const r = await api('connectionTest', { provider: c.provider }); return r.ok ? r.detail : { ok: false, message: r.detail || r.status }; }, { stage: `Contacting ${c.name}…` }).catch(() => {}); refresh(); }, { kind: 'ghost sm', iconName: 'refresh' }) : null,
      c.has_secret ? btn('Remove local access', async () => { if (await confirmDialog({ title: `Remove ${c.name}?`, body: 'Deletes the credential from the system vault. To invalidate it for good, revoke it on the provider\'s website too.', confirm: 'Remove', danger: true })) { await withProgress(`Removing ${c.name}`, () => api('connectionRemove', { provider: c.provider }).then(r => (r.removed ? 'Credential deleted from the system vault.' : 'There was no credential in the system vault.'))); refresh(); } }, { kind: 'ghost sm danger', iconName: 'trash' }) : null,
      h('span', { class: 'spacer' }), externalLink(c.docs, 'How to get one'),
      c.last_ok ? h('span', { class: 'muted small' }, `tested ${relTime(c.last_tested)}`) : null)));
}

// Reuse an existing GitHub sign-in (GitHub CLI) and read the user's stars, without pasting tokens.
let ghCache = null;
function githubReuse(list, refresh) {
  const gh = list.find(c => c.provider === 'github');
  const box = h('div');
  // Drawn straight away from the last answer, so the 4-second refresh never blanks the card; the
  // background check only redraws when something actually changed.
  const paint = x => {
    if (gh?.status === 'connected') fill(box, panel({ title: 'GitHub connected', meta: gh.account || '' }, h('div', { class: 'row' }, h('p', { class: 'muted', style: { margin: 0, flex: 1 } }, 'Searches use authenticated limits. CURI can review the repositories you starred and pick out what\'s useful to your agents.'),
      btn('Read my stars', () => runOperation('github.stars', {}, 'Read GitHub stars', { refresh: false }), { kind: 'primary', iconName: 'star' }))));
    else if (x.gh_logged_in) fill(box, panel({ title: 'GitHub session found', meta: x.gh_user || 'GitHub CLI' }, h('div', { class: 'row' }, h('p', { class: 'muted', style: { margin: 0, flex: 1 } }, 'The GitHub CLI (gh) is already signed in on this device. With your permission, CURI asks it for the token the official way (gh auth token), tests it and stores it in the system vault.'),
      btn('Reuse this session', () => withProgress('Connecting GitHub with the gh session', async () => { const r = await api('githubAdoptCli'); refresh(); return r.saved ? `Connected as ${r.account || 'GitHub'}.` : `Not connected: ${r.detail || 'test failed'}`; }), { kind: 'primary', iconName: 'link' }))));
    else fill(box);
  };
  const key = x => `${gh?.status}|${gh?.account}|${x.gh_logged_in}|${x.gh_user}`;
  if (ghCache) paint(ghCache);
  else if (gh?.status === 'connected') paint({});
  api('githubExisting').then(x => { if (!ghCache || key(x) !== key(ghCache)) paint(x); ghCache = x; }).catch(() => {});
  return box;
}

export async function connections() {
  const root = h('div', { class: 'page' });
  let first = true; // entrance motion only on first paint, never on live refresh
  async function render() {
    const [s, list, defs] = await Promise.all([api('claudeStatus'), api('connections'), api('mcpDefs')]);
    const secretRefs = [...new Set(defs.flatMap(d => Object.values(d.secret_env)).filter(r => r.startsWith('secret:')))];
    const secrets = await Promise.all(secretRefs.map(async ref => ({ ref, users: defs.filter(d => Object.values(d.secret_env).includes(ref)).map(d => d.name) })));
    fill(root, 
      pageHead({ title: 'Connections', sub: 'Accounts and credentials. Keys and tokens live in your operating system\'s vault: CURI never shows, logs or exports them.' }),
      h('div', { class: first ? 'stack-lg reveal' : 'stack-lg' },
        claudeCard(s, render),
        githubReuse(list, render),
        h('div', { class: 'grid cols-2' }, list.map(c => providerCard(c, render))),
        panel({ title: 'MCP server secrets', meta: `${secrets.length}` }, secrets.length ? h('div', { class: 'rows' }, secrets.map(x => {
          const inp = h('input', { type: 'password', placeholder: 'Value', autocomplete: 'off', 'aria-label': x.ref });
          return h('div', { class: 'r' }, icon('lock', 'sm'), h('div', { class: 'grow' }, h('div', { class: 't1 mono' }, x.ref), h('div', { class: 't2' }, `Used by: ${x.users.join(', ')}`)), h('div', { class: 'field' }, inp),
            btn('Save', async () => { if (!inp.value) return; const value = inp.value; inp.value = ''; await withProgress(`Saving ${x.ref}`, () => api('secretSave', { ref: x.ref, value }).then(() => 'Saved to the system vault.')); }, { kind: 'sm' }),
            btn('', async () => { if (await confirmDialog({ title: `Remove ${x.ref}?`, body: 'Servers that use it won\'t start until you save a new value.', confirm: 'Remove', danger: true })) await withProgress(`Removing ${x.ref}`, () => api('secretRemove', { ref: x.ref }).then(r => (r.removed ? 'Removed from the system vault.' : 'It didn\'t exist.'))); }, { kind: 'ghost sm', iconName: 'trash', title: 'Remove' }));
        })) : h('p', { class: 'muted', style: { margin: 0 } }, 'No defined MCP server needs secrets.'))));
    first = false;
    return s.state === 'connecting';
  }
  const connecting = await render();
  setPoll(() => render(), connecting ? 1500 : 4000);
  return root;
}

// =====================================================================================
// Integrations catalogue
// =====================================================================================
export async function integrations() {
  const [pr, defs, agent] = await Promise.all([api('presets'), api('mcpDefs'), api('agentStatus')]);
  const custom = defs.filter(d => !pr.mcp.some(m => m.name === d.name));
  const form = customMcpForm();
  return h('div', { class: 'page' },
    pageHead({ eyebrow: 'Integrations', title: 'Integration catalogue', sub: 'Pinned versions, static analysis before writing and verification afterwards. Nothing is installed just because it\'s in the catalogue.' }),
    h('div', { class: 'stack-lg reveal' },
      panel({ title: 'MCP servers', meta: 'started by Claude through the CURI launcher', flush: true }, h('div', { class: 'rows' }, pr.mcp.map(m => h('div', { class: 'r' },
        h('span', { class: 'itile' }, icon('mcp')), h('div', { class: 'grow' }, h('div', { class: 't1' }, m.title, ' ', h('span', { class: 'muted mono small' }, m.args.at(-1))), h('div', { class: 't2' }, m.purpose)),
        m.trusted ? badge(m.publisher, 'info') : badge(`${m.publisher} · untrusted`, 'warn'),
        Object.entries(m.secrets_present).map(([k, ok]) => (ok ? badge(`${k} ✓`, 'good') : h('a', { class: 'badge warn', href: '#/connections' }, `missing ${k}`))),
        m.enabled ? status('configured', 'Active') : null,
        m.enabled ? btn('Disable', () => runOperation('mcp.disable', { name: m.name }, `Disable ${m.title}`), { kind: 'ghost sm' })
          : btn('Enable', async () => { if (!m.defined) await api('mcpDefine', m); await runOperation('mcp.enable', { name: m.name }, `Enable ${m.title}`); }, { kind: 'primary sm' }))))),
      panel({ title: 'Skills', meta: 'pinned commit · static analysis · checksum verification', flush: true }, h('div', { class: 'rows' }, pr.skills.map(s => h('div', { class: 'r' },
        h('span', { class: 'itile' }, icon('skills')), h('div', { class: 'grow' }, h('div', { class: 't1' }, s.name, s.commit ? h('span', { class: 'muted mono small' }, ` @${s.commit.slice(0, 7)}`) : null), h('div', { class: 't2' }, `${s.repo} · ${s.purpose}`)),
        s.trusted ? badge(s.publisher, 'info') : badge(`${s.publisher} · untrusted`, 'warn'),
        s.exists_unmanaged ? badge('exists (not managed)', 'warn') : s.installed ? status('files-ok', 'Installed') : null,
        s.installed ? [btn('Update', () => runOperation('skill.install', { repo: s.repo, path: s.path }, `Update ${s.name}`), { kind: 'ghost sm', iconName: 'refresh' }), btn('Remove', () => runOperation('skill.remove', { name: s.name }, `Remove ${s.name}`), { kind: 'ghost sm danger' })]
          : s.exists_unmanaged ? null : btn('Install', () => runOperation('skill.install', { repo: s.repo, path: s.path }, `Install ${s.name}`), { kind: 'primary sm' }))))),
      panel({ title: 'Custom MCP servers', meta: `${custom.length}` }, custom.length ? h('div', { class: 'rows' }, custom.map(d => h('div', { class: 'r' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, d.name), h('div', { class: 't2 mono' }, d.transport === 'stdio' ? [d.command, ...d.args].join(' ') : d.url)),
        d.enabled ? status('configured', 'Active') : badge('inactive'),
        d.enabled ? btn('Disable', () => runOperation('mcp.disable', { name: d.name }, `Disable ${d.name}`), { kind: 'ghost sm' }) : [btn('Enable', () => runOperation('mcp.enable', { name: d.name }, `Enable ${d.name}`), { kind: 'primary sm' }), btn('', async () => { if (await confirmDialog({ title: `Delete the ${d.name} definition?`, body: 'Only deletes the definition in CURI; the server isn\'t active in Claude.', confirm: 'Delete', danger: true })) { await api('mcpUndefine', { name: d.name }); mount(); } }, { kind: 'ghost sm', iconName: 'trash', title: 'Delete definition' })]))) : null, form),
      panel({ title: 'Background service' }, h('div', { class: 'row' }, agent.loaded ? status('configured', 'Running in launchd') : agent.installed ? status('blocked', 'Installed, not loaded') : badge('not installed'),
        h('span', { class: 'muted' }, agent.loaded ? `Every ${Math.round((agent.interval_s || 0) / 60)} min it runs approved operations and scheduled checks, even with the app closed.` : 'Lets approved work run with the window closed (user LaunchAgent, no privileges).'),
        h('span', { class: 'spacer' }), agent.installed ? btn('Remove', () => runOperation('agent.remove', {}, 'Remove the background service'), { kind: 'ghost sm danger' }) : btn('Install', () => runOperation('agent.install', { interval_s: 1800 }, 'Install the background service'), { kind: 'primary sm' })))));
}

function customMcpForm() {
  const name = h('input', { type: 'text', placeholder: 'name (e.g. my-server)', 'aria-label': 'Name' });
  const transport = h('select', { class: 'select', 'aria-label': 'Transport' }, h('option', { value: 'stdio' }, 'stdio (local process)'), h('option', { value: 'http' }, 'HTTP (remote)'));
  const command = h('input', { type: 'text', placeholder: 'npx · uvx · node · python3 · /absolute/path', 'aria-label': 'Command' });
  const args = h('textarea', { class: 'area', rows: '3', placeholder: 'One argument per line', 'aria-label': 'Arguments' });
  const url = h('input', { type: 'url', placeholder: 'https://…', 'aria-label': 'URL' });
  const env = h('textarea', { class: 'area', rows: '2', placeholder: 'NAME=value (not secret), one per line', 'aria-label': 'Variables' });
  const secrets = h('textarea', { class: 'area', rows: '2', placeholder: 'API_KEY=secret:name  ·  GITHUB_TOKEN=provider:github', 'aria-label': 'Secrets' });
  const publisher = h('input', { type: 'text', placeholder: 'publisher (repository owner)', 'aria-label': 'Publisher' });
  const pairs = t => Object.fromEntries(t.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => [l.split('=')[0].trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const sync = () => { const s = transport.value === 'stdio'; command.closest('.field').hidden = !s; args.hidden = !s; url.closest('.field').hidden = s; };
  transport.addEventListener('change', sync);
  const el = h('details', { class: 'mcp-form' }, h('summary', { class: 'muted' }, icon('plus', 'sm'), ' Add a custom server'),
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, name), transport, h('div', { class: 'field' }, command), h('div', { class: 'field' }, url), h('div', { class: 'field' }, publisher),
      args, env, secrets,
      h('p', { class: 'muted small' }, 'Secrets never go into ~/.claude.json: Claude starts the CURI launcher, which reads them from the system vault at that moment. Servers from publishers outside the trusted list always ask for approval.'),
      h('div', { class: 'row' }, h('span', { class: 'spacer' }), btn('Save definition', async () => {
        await api('mcpDefine', { name: name.value.trim(), transport: transport.value, command: command.value.trim(), args: args.value.split('\n').map(x => x.trim()).filter(Boolean), url: url.value.trim(), env: pairs(env), secret_env: pairs(secrets), publisher: publisher.value.trim() });
        toast('Definition saved. Enable it when you\'re ready.', 'good'); mount();
      }, { kind: 'primary' }))));
  setTimeout(sync);
  return el;
}

// =====================================================================================
// Automation & permissions
// =====================================================================================
const MODE_COPY = {
  standard: ['Standard', 'Approves every install and significant change. Checks and reads run on their own.', 'lock'],
  automatic: ['Automatic', 'Recommended. Detection, verification, updates and repairs of what you already installed run on their own, as do skills and tools from trusted publishers. Everything else asks first.', 'bolt'],
  maximum: ['Maximum autonomy', 'Also MCP servers and plugins from trusted publishers, catalogue packages whose source is confirmed in the official registry, code with a clean scan and the background service. Removals, unknown publishers, costs and admin actions always ask.', 'sparkle'],
};

export function modePicker(pol, onChange) {
  const cur = pol.consent.implicit ? null : pol.consent.mode;
  return h('div', { class: 'modes', role: 'radiogroup', 'aria-label': 'Management mode' }, pol.modes.map(m => {
    const [t, d, ic] = MODE_COPY[m];
    const b = h('button', { type: 'button', class: `mode ${cur === m ? 'on' : ''} ${m === 'automatic' ? 'rec' : ''}`, role: 'radio', 'aria-checked': String(cur === m) },
      h('div', { class: 'row nowrap' }, h('span', { class: 'itile' }, icon(ic)), h('strong', null, t), m === 'automatic' ? badge('recommended', 'info') : null, h('span', { class: 'spacer' }), cur === m ? icon('check') : null),
      h('p', null, d),
      h('div', { class: 'mode-counts micro' }, `${Object.values(pol.matrix).filter(x => x[m] === 'auto').length} of ${Object.keys(pol.matrix).length} categories without asking`));
    b.addEventListener('click', async () => {
      if (m === 'maximum' && !(await confirmDialog({ title: 'Turn on maximum autonomy?', body: 'CURI will install without asking: skills, plugins and MCP servers from trusted publishers (including code, if the scan is clean), catalogue packages whose source is confirmed in the official registry, updates and the background service. Removals, unknown publishers, costs and admin actions still ask. You can revoke it at any time.', confirm: 'Turn on' }))) return;
      const r = await api('policyGrant', { mode: m });
      toast(`${t} mode on.${r.requeued_for_approval.length ? ` ${r.requeued_for_approval.length} operation(s) went back to asking for approval.` : ''}`, 'good');
      onChange();
    });
    return b;
  }));
}

// Upper bounds match the engine's validators; values are clamped to whole hours before saving.
const MAX_HOURS = { auto_scan_hours: 168, auto_verify_hours: 168, auto_repair_hours: 168 };
function maintenancePanel(m) {
  const inputs = new Map();
  return panel({ title: 'Automatic maintenance', meta: m.last ? `last ${relTime(m.last.at)}` : 'hasn\'t run yet', flush: true },
    h('div', { class: 'rows' }, m.tasks.map(t => {
      const inp = h('input', { type: 'number', class: 'num-input', min: '0', max: String(MAX_HOURS[t.pref] || 720), step: '1', value: String(t.every_hours), 'aria-label': `Hours between runs: ${t.label}` });
      inputs.set(t.pref, inp);
      return h('div', { class: 'r' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, t.label), h('div', { class: 't2' }, t.last ? `Last run ${relTime(t.last)}` : 'Hasn\'t run yet')), h('span', { class: 'muted small' }, 'every'), inp, h('span', { class: 'muted small' }, 'h'));
    }),
    m.suggestions.length ? h('div', { class: 'r' }, icon('shield', 'sm'), h('div', { class: 'grow' }, h('div', { class: 't1' }, `${m.suggestions.length} task(s) outside what the current mode covers`), h('div', { class: 't2' }, m.suggestions.slice(0, 3).map(s => s.label).join(' · ')))) : null,
    h('div', { class: 'r' }, h('span', { class: 'muted small grow' }, '0 = off. Each task only runs on its own if your autonomy mode covers it; the rest shows up on Home as a suggestion.'),
      btn('Run now', async () => { const r = await api('maintenanceRun'); toast(`${r.queued.length} task${r.queued.length === 1 ? '' : 's'} started${r.suggestions.length ? `; ${r.suggestions.length} waiting for permission` : ''}`, 'good'); }, { iconName: 'play' }),
      btn('Save', async () => { const prefs = {}; for (const [k, inp] of inputs) { prefs[k] = Math.min(MAX_HOURS[k] || 720, Math.max(0, Math.round(Number(inp.value) || 0))); inp.value = String(prefs[k]); } await api('prefsSet', prefs); toast('Saved', 'good'); }, { kind: 'primary' }))));
}

export async function automation() {
  const [pol, prefs, maint] = await Promise.all([api('policy'), api('prefsAll'), api('maintenance')]);
  const pub = h('textarea', { class: 'area', rows: '3', 'aria-label': 'Trusted publishers', value: pol.trusted.join('\n') });
  const hours = h('input', { type: 'number', class: 'num-input', min: '0', max: '168', value: String(prefs.auto_verify_hours ?? 24), 'aria-label': 'Hours between checks' });
  const notifyMode = h('select', { class: 'select', 'aria-label': 'Notifications' }, [['all', 'After every operation'], ['errors', 'Only errors and approval requests'], ['none', 'None (approvals stay visible in the app)']].map(([v, l]) => h('option', { value: v, selected: (prefs.notify_mode || 'errors') === v || null }, l)));
  const battery = h('input', { type: 'checkbox', role: 'switch', id: 'bat', checked: prefs.pause_on_battery !== false || null });
  const modes = ['standard', 'automatic', 'maximum'];
  return h('div', { class: 'page' },
    pageHead({ title: 'Autonomy', sub: 'What CURI does on its own and what it asks you first. Consent covers defined categories, not unlimited access; your operating system still asks for your password for admin actions.' }),
    h('div', { class: 'stack-lg reveal' },
      pol.consent.implicit ? notice('info', 'You haven\'t picked a mode yet: you\'re on Standard (approve everything).') : notice('info', `Current mode: ${MODE_COPY[pol.consent.mode][0]}, granted ${relTime(pol.consent.granted_at)} (policy ${pol.version}).`),
      modePicker(pol, () => mount()),
      maintenancePanel(maint),
      h('div', { class: 'row' }, h('span', { class: 'spacer' }), !pol.consent.implicit && pol.consent.mode !== 'standard' ? btn('Revoke now', async () => { const r = await api('policyRevoke'); toast(`Autonomy revoked. ${r.requeued_for_approval.length} queued operation(s) went back to asking for approval. Finished operations aren't undone.`, 'good'); mount(); }, { kind: 'danger', iconName: 'x' }) : null),
      panel({ title: 'Permission matrix', meta: 'automatic = no prompt · approve = always asks', flush: true }, h('div', { class: 'table-wrap' }, h('table', { class: 't matrix' },
        h('thead', null, h('tr', null, h('th', null, 'Category'), modes.map(m => h('th', { class: m === pol.consent.mode && !pol.consent.implicit ? 'cur' : null }, MODE_COPY[m][0])))),
        h('tbody', null, Object.entries(pol.matrix).map(([k, v]) => h('tr', null, h('td', null, v.label), modes.map(m => h('td', { class: m === pol.consent.mode && !pol.consent.implicit ? 'cur' : null }, v[m] === 'auto' ? h('span', { class: 'badge good' }, icon('check'), 'automatic') : h('span', { class: 'badge' }, icon('lock'), 'asks'))))))))),
      h('div', { class: 'grid cols-2' },
        panel({ title: 'Trusted publishers' }, h('p', { class: 'muted small', style: { marginTop: 0 } }, 'GitHub repository owners whose code may be installed under the policy. One per line. Anything outside this list asks for approval.'), pub,
          h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'spacer' }), btn('Save', async () => { const r = await api('trustedSet', { publishers: pub.value.split('\n') }); toast(`${r.length} trusted publishers`, 'good'); }, { kind: 'primary' }))),
        panel({ title: 'Background work and alerts', flush: true }, h('div', { class: 'rows' },
          h('div', { class: 'r' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, 'Check sources automatically'), h('div', { class: 't2' }, 'Every how many hours (0 = never). Uses the background service.')), hours),
          h('div', { class: 'r' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, 'Pause on battery'), h('div', { class: 't2' }, 'Doesn\'t start scheduled work while the computer is on battery.')), h('span', { class: 'switch' }, battery, h('span'))),
          h('div', { class: 'r' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, 'Notifications'), h('div', { class: 't2' }, 'Turning alerts off never approves operations.')), notifyMode),
          h('div', { class: 'r' }, h('span', { class: 'spacer' }), btn('Save', async () => { await api('prefsSet', { auto_verify_hours: Number(hours.value), pause_on_battery: battery.checked, notify_mode: notifyMode.value }); toast('Saved', 'good'); }, { kind: 'primary' })))))));
}

// =====================================================================================
// Operations
// =====================================================================================
const OP_STATUS = { queued: ['info', 'Queued'], running: ['info', 'Running'], awaiting_approval: ['warn', 'Awaiting approval'], verified: ['good', 'Verified'], completed: ['good', 'Done'], failed: ['bad', 'Failed'], cancelled: ['', 'Cancelled'], blocked: ['bad', 'Blocked'], rejected: ['', 'Rejected'], interrupted: ['warn', 'Interrupted'] };
const opBadge = s => { const [k, l] = OP_STATUS[s] || ['', s]; return h('span', { class: `badge ${k}` }, s === 'running' ? h('span', { class: 'spin' }) : null, l); };

function opDetail(o) {
  return h('div', { class: 'op-detail' },
    kv([['Kind', h('span', { class: 'mono' }, o.kind)], ['Resource', o.resource], ['Source', o.source], ['Category', o.security_class], ['Decision', o.decision_reasons.join(' ')], ['Approved by', o.approved_by || '—'], ['Attempts', `${o.attempts}/${o.max_attempts}`], ['Created', fmtDate(o.created_at)], ['Finished', fmtDate(o.finished_at)], o.error ? ['Error', h('span', { class: 'warn-text' }, o.error)] : null]),
    o.verification ? h('div', null, h('div', { class: 'micro' }, 'Verification'), h('pre', null, JSON.stringify(o.verification, null, 2))) : null,
    o.recovery ? h('div', null, h('div', { class: 'micro' }, 'Recovery'), h('pre', null, JSON.stringify(o.recovery, null, 2))) : null,
    h('div', { class: 'micro' }, 'Log'), h('div', { class: 'log' }, o.logs.map(l => h('div', { class: l.level }, h('span', { class: 'muted' }, fmtDate(l.at, { timeStyle: 'medium' })), ' ', l.message))));
}

export async function operations() {
  const root = h('div', { class: 'page' });
  let filter = params().get('status') || 'all', q = '', open = params().get('id'), page = 0;
  const search = h('input', { type: 'search', maxlength: '100', placeholder: 'Search by kind or resource', 'aria-label': 'Search operations' });
  search.addEventListener('input', () => { q = search.value; page = 0; render(); });
  async function render() {
    const all = await api('ops', { limit: 500, q });
    const pending = all.filter(o => o.status === 'awaiting_approval');
    const active = all.filter(o => ['queued', 'running'].includes(o.status));
    const shown = all.filter(o => filter === 'all' || o.status === filter);
    if (page * 30 >= shown.length) page = 0;
    const list = h('div', { class: 'rows' }, shown.slice(page * 30, (page + 1) * 30).map(o => {
      const row = h('details', { class: 'r op', open: o.id === open || null },
        h('summary', { class: 'row nowrap' }, opBadge(o.status), h('div', { class: 'grow' }, h('div', { class: 't1' }, o.resource || o.kind), h('div', { class: 't2' }, `${o.kind} · ${o.stage || ''} · ${relTime(o.updated_at)}`)),
          o.status === 'running' && o.progress != null ? h('div', { style: { width: '120px' } }, meter(o.progress)) : null,
          o.status === 'awaiting_approval' ? [btn('Approve', async () => { await api('opApprove', { id: o.id }); render(); }, { kind: 'primary sm' }), btn('Reject', async () => { await api('opReject', { id: o.id }); render(); }, { kind: 'ghost sm' })] : null,
          ['queued', 'running'].includes(o.status) ? btn('Cancel', async () => { await api('opCancel', { id: o.id }); render(); }, { kind: 'ghost sm' }) : null,
          ['failed', 'interrupted', 'cancelled'].includes(o.status) ? btn('Retry', async () => { await api('opRetry', { id: o.id }); render(); }, { kind: 'ghost sm', iconName: 'refresh' }) : null),
        opDetail(o));
      row.addEventListener('toggle', () => { open = row.open ? o.id : open === o.id ? null : open; });
      return row;
    }));
    fill(root, ...[
      pageHead({ eyebrow: 'Control', title: 'Activity', sub: 'Everything CURI installed, changed or checked, and what is waiting for your OK. Work survives restarts and is never done twice; cancelling stops at the next safe point.' }),
      h('section', { class: 'panel kpis small' }, kpi('Awaiting approval', pending.length), kpi('Active', active.length), kpi('Verified', all.filter(o => o.status === 'verified').length), kpi('Failed', all.filter(o => o.status === 'failed').length), kpi('Total', all.length)),
      pending.length ? notice('warn', `${pending.length} operation(s) waiting for your decision.`) : null,
      h('div', { class: 'toolbar' }, segmented([['all', 'All'], ['awaiting_approval', 'Approval'], ['running', 'Running'], ['queued', 'Queued'], ['verified', 'Verified'], ['failed', 'Failed']], filter, v => { filter = v; page = 0; render(); }, 'Filter'), h('span', { class: 'spacer' }), h('div', { class: 'field' }, icon('search', 'sm'), search)),
      panel({ flush: true }, shown.length ? list : empty('activity', 'No operations', 'Installs, repairs and checks show up here.')),
      pager(shown.length, page, 30, n => { page = n; render(); }, { noun: 'operations' })].filter(Boolean));
  }
  await render();
  setPoll(() => (document.querySelector('.op[open] :focus') ? null : render()), 2500);
  return root;
}
const kpi = (l, v) => h('div', { class: 'kpi' }, h('span', { class: 'micro' }, l), h('div', { class: 'kpi-value num' }, v));
