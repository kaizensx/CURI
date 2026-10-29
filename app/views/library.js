// Library: every resource with its real kind, its real presence on this device, and the action that
// fits it. Resource sheet: what it is, how an agent uses it, where it already is, every working way to
// get it here, project usage, alternatives. Compare: a decision table, not a score.
import { h, fmtDate, relTime, compact, fill, mod } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, toast, contextMenu, empty, notice } from '../lib/ui.js';
import { go, mount, params, compareTray } from '../app.js';
import { runOperation } from './control.js';
import { installedView } from './installed.js';
import { catalogueView } from './catalogue.js';
import { discoverView } from './discover.js';
import { KIND_ICON, STATE_LABEL, stateChip, kindTile, where, runAction, actionButton, cmdLine, addToProject, personalPanel } from './common.js';

export const TYPE_ICON = { Skill: 'skills', Plugin: 'layers', MCP: 'mcp', Library: 'library', Framework: 'library', Tool: 'terminal', Documentation: 'info', Registry: 'search', Template: 'copy', Inspiration: 'sparkle' };

export function resourceMenu(r) {
  return [
    { label: 'Open details', icon: 'chevron', run: () => go(`resource/${encodeURIComponent(r.id)}`) },
    { label: 'Open source in browser', icon: 'external', run: () => api('openExternal', { url: r.canonical_url }) },
    { label: 'Copy URL', icon: 'copy', run: async () => { await navigator.clipboard.writeText(r.canonical_url); toast('URL copied'); } },
    '-',
    { label: compareTray.has(r.id) ? 'Remove from comparison' : 'Add to comparison', icon: 'compare', run: () => compareTray.toggle(r.id) },
    { label: 'Refresh project data', icon: 'refresh', run: () => runOperation('resource.inspect', { id: r.id }, `Refresh data: ${r.name}`) },
  ];
}

// The one useful thing to do from a row, for every kind of resource.
export async function quickAction(r, after) {
  if (!r.state && r.installable && r.kind !== 'reference') {
    const pick = v => v.actions.primary || v.actions.install.find(x => !x.disabled && !x.shared);
    let v = await api('resourceView', { id: r.id });
    let a = pick(v);
    // Only a missing prerequisite stands in the way: install it first, then the resource.
    if (!a) { const pre = v.actions.install.find(x => x.prereq); if (pre) { await runAction(pre.prereq, pre.missing.join(', ')); v = await api('resourceView', { id: r.id }); a = pick(v); } }
    if (a) return runAction(a, r.name, after);
  }
  if (r.has_project) {
    const v = await api('resourceView', { id: r.id });
    if (v.actions.project.length) return addToProject(r.name, v.actions.project).then(after);
  }
  return go(`resource/${encodeURIComponent(r.id)}`);
}
export const quickLabel = r => (!r.state && r.installable && r.kind !== 'reference' ? [r.kind === 'components' ? 'Give to agent' : 'Get', 'download', 'primary']
  : r.has_project && !r.state ? ['Add to project', 'plus', ''] : ['Manage', 'settings', 'ghost']);

export async function library() {
  const tab = params().get('tab') || 'catalogue';
  const count = h('span', { class: 'n' });
  const tabs = h('nav', { class: 'tabs lib-tabs', 'aria-label': 'Library' },
    h('a', { href: '#/library?tab=catalogue', 'aria-current': tab === 'catalogue' ? 'page' : null }, icon('library', 'sm'), 'Catalogue'),
    h('a', { href: '#/library?tab=installed', onclick: e => { if (tab === 'installed') e.preventDefault(); }, 'aria-current': tab === 'installed' ? 'page' : null }, icon('check', 'sm'), 'Installed', tab === 'installed' ? count : null),
    h('a', { href: '#/library?tab=new', 'aria-current': tab === 'new' ? 'page' : null }, icon('radar', 'sm'), 'New on GitHub'));
  if (tab === 'new') {
    // New projects found on GitHub that aren't in the catalogue yet; adding one puts it in the catalogue.
    const page = await discoverView();
    page.querySelector('.page-head h1')?.replaceChildren('New on GitHub');
    const actions = page.querySelector('.page-head .actions');
    if (actions) actions.prepend(tabs); else page.querySelector('.page-head')?.append(h('div', { class: 'actions' }, tabs));
    return page;
  }
  if (tab === 'installed') {
    const body = await installedView(n => { count.textContent = String(n); });
    return h('div', { class: 'page' },
      h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Library'), h('p', null, 'What your agents and this computer already have, and where each thing lives.')), h('div', { class: 'actions' }, tabs)),
      body);
  }
  return catalogueView(tabs);
}

// ---------- Resource sheet ----------
const EV = { registry: 'confirmed in registry', curated: 'reviewed', manifest: 'declared by the project', documented: 'documented' };
const METHOD = { plugin: 'Claude Code plugin', skill: 'Claude Code skill', mcp: 'MCP server in Claude Code', package: 'Package manager', download: 'Official installer' };
const TYPE_PT = { bin: 'Executable', app: 'App', brew: 'Homebrew', cask: 'Homebrew Cask', npm: 'npm global', uv: 'uv tool', pipx: 'pipx', pip: 'Python (pip)', cargo: 'Cargo', winget: 'WinGet', scoop: 'Scoop', flatpak: 'Flatpak', mcp: 'MCP server', plugin: 'Plugin', skill: 'Skill', 'account-skill': 'Account skill', dir: 'Folder', env: 'Variable' };

export async function resource(id) {
  const v = await api('resourceView', { id });
  if (!v) return h('div', { class: 'page' }, empty('alert', 'Resource not found', id));
  const { resource: r, profile: pf, presence: pr, actions: A, facts: f } = v;
  const after = () => mount();
  const sub = [pf.kind_label, r.gh_full_name?.split('/')[0], f?.license && f.license !== 'none' ? f.license : null].filter(Boolean);
  const head = h('header', { class: 'sheet-head' }, kindTile(pf.kind, Boolean(pr.state)),
    h('div', null, h('h1', null, r.name), h('div', { class: 'sub' }, sub.map(s => h('span', null, s)), stateChip(v.state))),
    h('div', { class: 'row' }, btn('', () => { compareTray.toggle(r.id); toast(compareTray.has(r.id) ? 'In comparison' : 'Out of comparison'); }, { kind: 'ghost', iconName: 'compare', title: 'Compare' }),
      btn('', e => contextMenu(e.clientX, e.clientY, resourceMenu(r)), { kind: 'ghost', iconName: 'dots', title: 'More' })));

  // Action bar: the one thing to do next, then management, then documentation.
  const lead = A.primary ? null : pr.state ? `Already installed${pr.found?.length ? ` in ${[...new Set(pr.found.map(f => f.agent_label || 'this computer'))].join(', ')}` : ''}. Nothing to install.` : pf.kind === 'reference' ? 'Reference material.' : null;
  const bar = h('div', { class: 'actionbar' },
    A.primary ? actionButton(A.primary, r.name, after, { kind: 'primary' }) : !pr.state && A.project.length ? btn('Add to a project', () => addToProject(r.name, A.project).then(after), { kind: 'primary', iconName: 'plus' }) : lead ? h('span', { class: 'lead' }, lead) : null,
    ...A.manage.slice(0, 4).map(a => actionButton(a, r.name, after, { kind: 'ghost' })),
    h('span', { class: 'grow' }),
    ...A.docs.map(a => btn(a.label, () => runAction(a, r.name), { kind: 'ghost', iconName: 'external' })));

  const presence = pr.found.length ? h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, pr.found.map(x => h('li', null, icon(x.type === 'mcp' ? 'mcp' : x.type === 'app' ? 'grid' : x.type.includes('skill') ? 'skills' : x.type === 'plugin' ? 'layers' : 'terminal', 'sm'),
    h('div', { class: 'grow' }, h('div', null, `${TYPE_PT[x.type] || x.type} · `, h('span', { class: 'mono' }, x.name)), h('div', { class: 't2' }, [x.agent_label, x.version, x.scope && !['system', 'user'].includes(x.scope) ? x.scope : null, x.managed_by === 'curi' ? 'managed by CURI' : x.managed_by === 'account' ? 'managed by your account' : 'installed outside CURI'].filter(Boolean).join(' · '))),
    x.enabled === false ? h('span', { class: 'state reference' }, 'Disabled') : null)))) : null;

  const options = A.install.length ? h('div', { class: 'box' }, A.install.map(a => h('div', { class: 'opt' },
    h('div', null, h('div', { class: 't' }, a.label), h('div', { class: 's' }, [a.sub, a.evidence ? EV[a.evidence] : null, a.missing ? `needs ${a.missing.join(', ')}` : null, a.secrets?.length ? `key: ${a.secrets.join(', ')}` : null, a.auth === 'oauth' ? 'OAuth sign-in in Claude Code' : null, a.scripts ? 'includes scripts' : null].filter(Boolean).join(' · '))),
    actionButton({ ...a, label: a.prereq && a.disabled ? a.label : a.op?.kind === 'mcp.add' ? 'Enable' : a.op?.kind === 'package.install' ? 'Install' : a.op?.kind === 'plugin.install' ? 'Install' : a.op?.kind === 'skill.install' ? 'Install' : a.label }, r.name, after, { kind: a === A.primary ? 'primary' : '' }),
    a.setup?.length ? h('ol', { class: 'steps' }, a.setup.map(s => h('li', null, s))) : null))) : null;

  const project = A.project.length ? h('div', { class: 'stack' },
    h('div', { class: 'row' }, btn('Add to a project', () => addToProject(r.name, A.project).then(after), { kind: A.primary || pr.state ? '' : 'primary', iconName: 'plus' }), h('span', { class: 'muted small' }, 'or copy the command:')),
    A.project.map(c => cmdLine(c.command))) : null;
  const mine = await personalPanel(r.id, v.mine || {}, (m, refresh) => { if (refresh) mount(); });
  const assist = A.assist.length ? h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, A.assist.map(a => h('li', null, icon('info', 'sm'), h('div', { class: 'grow' }, h('div', null, a.label), a.hint ? h('div', { class: 't2' }, a.hint) : null), btn('Open', () => runAction(a, r.name), { size: 'sm', iconName: 'external' }))))) : null;

  const capsBox = v.capabilities?.length ? h('div', { class: 'capchips' }, v.capabilities.map(c => h('a', { class: 'capchip', href: `#/capabilities?all=1&focus=${encodeURIComponent(c.id)}` }, c.label))) : null;
  const dl = [];
  const fact = (k, val) => { if (val != null && val !== '') dl.push(h('dt', null, k), h('dd', null, val)); };
  if (f) {
    fact('Stars', f.stars != null ? compact(f.stars) : null);
    fact('Last change', f.pushed_at ? relTime(f.pushed_at) : null);
    fact('Latest release', f.latest_release ? `${f.latest_release.tag} · ${fmtDate(f.latest_release.published_at, { dateStyle: 'medium' })}` : null);
    fact('Licence', f.license);
    fact('Language', f.language);
    for (const [k, list] of Object.entries(f.packages || {})) fact(k === 'pypi' ? 'PyPI' : k === 'cask' ? 'Homebrew Cask' : k === 'brew' ? 'Homebrew' : k, list.map(x => `${x.name} ${x.version || ''}`).join(', '));
    if (f.skills) fact('Skills', `${f.skills}${f.internal_skills ? ` (+${f.internal_skills} internal to the repository)` : ''}`);
    if (f.plugins) fact('Plugins', f.plugins);
    if (f.archived) fact('Status', 'Archived');
    fact('Data from', `${f.source === 'web' ? 'site' : 'GitHub'} · ${relTime(f.inspected_at)}`);
  }
  const alts = v.alternatives.length ? h('div', { class: 'box' }, h('ul', { class: 'plain-list' }, v.alternatives.map(a => h('li', null, icon(KIND_ICON[a.kind] || 'info', 'sm'),
    h('a', { class: 'grow', href: `#/resource/${encodeURIComponent(a.id)}` }, h('div', null, a.name), h('div', { class: 't2' }, a.related ? 'Works alongside' : `${Math.round(a.overlap * 100)}% of capabilities in common`)),
    ['INSTALLED', 'CONFIGURED'].includes(a.status) ? stateChip('installed') : null))),
    h('div', { style: { padding: '8px 10px 10px' } }, btn('Compare with these', () => { compareTray.clear(); compareTray.add(r.id); v.alternatives.slice(0, 3).forEach(a => compareTray.add(a.id)); go('compare'); }, { kind: 'ghost', size: 'sm', iconName: 'compare' }))) : null;

  const sec = (title, meta, node) => (node ? [h('div', { class: 'sec' }, h('h2', null, title), meta ? h('span', { class: 'meta' }, meta) : null), node] : []);
  return h('div', { class: 'page' }, head, bar,
    h('div', { class: 'sheet' },
      h('div', null,
        ...sec('What it is', null, h('div', { class: 'stack' }, h('p', { class: 'prose' }, r.description || f?.description || 'No verified description.'), h('p', { class: 'prose dim' }, pf.agent_use), pf.notes ? notice('info', pf.notes) : null, r.risk_notes ? notice('warn', r.risk_notes) : null)),
        ...sec('On this device', pr.found.length ? `${pr.found.length} occurrence${pr.found.length > 1 ? 's' : ''}` : null, presence || h('p', { class: 'prose dim' }, v.device.scanned_at ? `Not found in the last scan (${relTime(v.device.scanned_at)}).` : 'No scan yet.')),
        ...sec(pr.state ? 'Other ways to get it' : 'Install or enable', A.install.length ? 'each option runs visibly, with progress and verification' : null, options),
        ...sec('Managed elsewhere', null, assist),
        ...sec('Use in a project', 'runs in the project folder', project)),
      h('div', null,
        ...sec('Yours', 'only on this device', mine),
        ...sec('Facts', null, dl.length ? h('div', { class: 'box pad' }, h('dl', { class: 'facts' }, dl)) : h('p', { class: 'prose dim' }, 'No inspection data.')),
        ...sec('Capabilities', null, capsBox),
        ...sec('Alternatives and companions', null, alts))));
}

// ---------- Compare ----------
export async function compare() {
  const linked = params().get('ids');
  if (linked) { compareTray.clear(); linked.split(',').slice(0, 5).forEach(id => compareTray.add(id)); }
  const ids = [...compareTray.ids];
  if (ids.length < 2) return h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Compare'))),
    empty('compare', 'Pick at least two resources', `In the catalogue, ${mod()}click two or more cards (or use a card's ⋯ menu › Select), then choose Compare.`, btn('Go to Library', () => go('library'), { kind: 'primary' })));
  const p = params();
  const input = h('input', { type: 'search', value: p.get('use') || '', maxlength: '300', placeholder: 'What for? e.g. "test my site in the browser"', 'aria-label': 'Use case' });
  const out = h('div');
  const load = async () => {
    const r = await api('compareDecision', { ids, useCase: input.value.trim() });
    const it = r.items;
    const rowH = (label, fn) => h('tr', null, h('th', { scope: 'row' }, label), it.map(x => h('td', null, fn(x))));
    const ul = list => (list?.length ? h('ul', null, list.map(s => h('li', null, s))) : h('span', { class: 'muted' }, '—'));
    fill(out,
      r.guidance.length ? h('ul', { class: 'guidance' }, r.guidance.map(g => h('li', { class: g.tone || '' }, icon(g.tone === 'warn' ? 'alert' : 'arrow', 'sm'), h('span', null, g.text)))) : null,
      h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Criterion')), it.map(x => h('th', { scope: 'col' }, h('div', { class: 'colhead' },
          h('a', { href: `#/resource/${encodeURIComponent(x.id)}` }, h('strong', null, x.name)), h('span', { class: 'muted' }, x.kind_label),
          h('div', { class: 'row' }, x.presence.state ? stateChip(x.presence.state) : btn('See options', () => go(`resource/${encodeURIComponent(x.id)}`), { size: 'sm', kind: 'primary', iconName: 'download' }),
            btn('', () => { compareTray.delete(x.id); mount(); }, { size: 'sm', kind: 'ghost', iconName: 'x', title: 'Remove' }))))))),
        h('tbody', null,
          rowH('What it does', x => x.description || '—'),
          rowH('How the agent uses it', x => x.agent_use),
          r.use_case ? rowH(`For "${r.use_case}"`, x => (x.matches_use_case?.length ? x.matches_use_case.join(', ') : h('span', { class: 'muted' }, 'doesn\'t cover it directly'))) : null,
          rowH('Only this one offers', x => ul(x.unique)),
          rowH('On this device', x => (x.presence.state ? `${STATE_LABEL[x.presence.state]}${x.presence.where.length ? ` · ${x.presence.where.join(', ')}` : ''}` : 'No')),
          rowH('Install', x => h('div', null, h('div', null, x.install.text), x.install_method ? h('div', { class: 'muted' }, x.install_method) : null, x.steps.length ? ul(x.steps) : null)),
          rowH('Dependencies', x => ul(x.deps)),
          rowH('Security', x => ul(x.security)),
          rowH('Publisher', x => (x.publisher ? `${x.publisher.name}${x.publisher.trusted ? ' · trusted' : ''}` : '—')),
          rowH('Upkeep', x => (x.maintenance ? `${x.maintenance.state}${x.maintenance.pushed_days != null ? ` · ${x.maintenance.pushed_days} days ago` : ''}${x.maintenance.release ? ` · ${x.maintenance.release}` : ''}${x.maintenance.stars != null ? ` · ${compact(x.maintenance.stars)} ★` : ''}` : '—')),
          rowH('Licence', x => x.license),
          it.some(x => x.use_when) ? rowH('When to choose it', x => x.use_when || '—') : null,
          it.some(x => x.avoid_when) ? rowH('When to avoid it', x => x.avoid_when || '—') : null))));
  };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch(e => toast(e.message, 'bad')), 300); });
  await load();
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Compare'), h('p', null, 'Concrete differences to help you decide: what each does, what only it does, what it takes to run here, risks and upkeep. No arbitrary scores.')),
      h('div', { class: 'actions' }, btn('Clear', () => { compareTray.clear(); go('library'); }, { kind: 'ghost' }))),
    h('div', { class: 'lib-top' }, h('div', { class: 'searchbox' }, icon('search', 'sm'), input)), out);
}
