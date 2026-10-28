// Shared vocabulary for the new views: kind icons, presence states, and how a resource action runs.
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, toast, externalLink, overlay } from '../lib/ui.js';
import { fill } from '../lib/dom.js';
import { runOperation } from './control.js';
import { withProgress } from '../lib/opmodal.js';

export const KIND_ICON = { plugin: 'layers', 'skill-pack': 'skills', skill: 'skills', mcp: 'mcp', cli: 'terminal', app: 'grid', library: 'library', components: 'box', framework: 'library', reference: 'info' };
export const STATE_LABEL = { installed: 'Installed', configured: 'Configured', account: 'In your claude.ai account', available: 'Available', project: 'For projects', reference: 'Reference' };
export const STATE_HINT = {
  installed: 'Present on this device (installed by CURI or another way).',
  configured: 'Registered in an agent (MCP or plugin), with no local install of its own.',
  account: 'Active in your claude.ai account and synced to Claude Desktop.',
  available: 'Can be installed or enabled from here.',
  project: 'Installs inside each project, not system-wide.',
  reference: 'Reference material; nothing to install.',
};
export const stateChip = st => h('span', { class: `state ${st || 'reference'}`, title: STATE_HINT[st] || '' }, STATE_LABEL[st] || 'Reference');
export const kindTile = (kind, on = false) => h('span', { class: `ktile ${on ? 'on' : ''}`, 'aria-hidden': 'true' }, icon(KIND_ICON[kind] || 'info'));
export const where = list => (list?.length ? h('span', { class: 'where' }, list.slice(0, 3).map(w => h('span', null, w)), list.length > 3 ? h('span', null, `+${list.length - 3}`) : null) : null);

// Runs one action object from the engine's resource view. Ops go through the visible progress modal.
export async function runAction(a, name, after) {
  if (a.type === 'open') { await api('openExternal', { url: a.url }); return; }
  if (a.type === 'reveal') { await api('revealAgentConfig', { agent: a.agent }); return; }
  if (a.type === 'op') {
    const final = await runOperation(a.op.kind, a.op.params, `${a.label} — ${name}`, { refresh: false });
    after?.(final);
  }
}
export function actionButton(a, name, after, { kind = '' } = {}) {
  if (a.disabled && a.prereq) return btn(a.prereq.label, () => runAction(a.prereq, a.missing?.join(', ') || name, after), { kind: kind || 'ghost', iconName: 'download', title: `Missing: ${a.missing.join(', ')}` });
  return btn(a.label, () => runAction(a, name, after), { kind: a.danger ? 'danger ghost' : kind, iconName: a.type === 'open' ? 'external' : a.danger ? 'trash' : a.op?.kind?.includes('install') || a.op?.kind === 'mcp.add' ? 'download' : a.op?.kind === 'mcp.check' ? 'activity' : 'refresh', disabled: a.disabled && !a.prereq, title: a.hint || (a.missing ? `Missing: ${a.missing.join(', ')}` : null) });
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied', 'good'); } catch { toast('Couldn\'t copy', 'bad'); }
}
export const cmdLine = text => h('div', { class: 'cmd' }, h('code', null, text), btn('', () => copyText(text), { kind: 'ghost', size: 'sm', iconName: 'copy', title: 'Copy' }));
export { externalLink, withProgress };

// ---------- Add a library/component to one of the user's projects ----------
const ECO = { js: 'JavaScript', py: 'Python', swift: 'Swift' };
export async function addToProject(name, commands) {
  const projects = await api('projects');
  return new Promise(resolve => {
    let sel = projects[0]?.path || null, done = false;
    const cmdSel = h('select', { class: 'select', 'aria-label': 'Command' }, commands.map(c => h('option', { value: c.command }, c.command)));
    const comp = h('input', { type: 'text', placeholder: 'component name, e.g. blur-text', 'aria-label': 'Component' });
    const compRow = h('div', { class: 'field' }, comp);
    const list = h('div', { class: 'proj-list', role: 'radiogroup', 'aria-label': 'Project' });
    const other = h('input', { type: 'text', placeholder: '/path/to/your/project', 'aria-label': 'Another folder' });
    const syncComp = () => { compRow.hidden = !/<componente>/.test(cmdSel.value); };
    const renderList = items => fill(list, items.length ? items.map(p => {
      const b = h('button', { type: 'button', class: 'proj', role: 'radio', 'aria-checked': String(p.path === sel) },
        h('strong', null, p.name), h('span', { class: 'p' }, p.path.replace(/^\/Users\/[^/]+/, '~')),
        h('span', { class: 'eco' }, p.ecosystems.length ? p.ecosystems.map(e => h('span', null, `${ECO[e.id] || e.id} · ${e.manager}`)) : h('span', { class: 'warn' }, 'no package.json or pyproject')));
      b.addEventListener('click', () => { sel = p.path; renderList(items); });
      return b;
    }) : h('p', { class: 'muted' }, 'No known projects yet. Pick a folder below.'));
    renderList(projects);
    const finish = v => { if (!done) { done = true; close(); resolve(v); } };
    const go = btn('Add', async () => {
      if (!sel) { toast('Pick a project.', 'bad'); return; }
      const params = { path: sel, command: cmdSel.value, component: compRow.hidden ? undefined : comp.value.trim() };
      done = true; close();
      resolve(await runOperation('project.add', params, `Add ${name} to ${sel.split('/').pop()}`, { refresh: false }));
    }, { kind: 'primary', iconName: 'download' });
    const node = h('div', { class: 'dialog wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pj-t' },
      h('h3', { id: 'pj-t' }, `Add ${name} to a project`),
      h('p', { class: 'muted' }, 'CURI uses the project\'s own package manager (npm, pnpm, yarn, bun or uv) and checks that the dependency was recorded.'),
      list,
      h('div', { class: 'row nowrap' }, h('div', { class: 'field grow' }, other), btn('Use this folder', async () => { const p = await api('projectAdd', { path: other.value }); sel = p.path; renderList(await api('projects')); other.value = ''; }, { iconName: 'plus' })),
      commands.length > 1 ? h('div', { class: 'field' }, cmdSel) : null, compRow,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => finish(null) }, 'Cancel'), go));
    cmdSel.addEventListener('change', syncComp); syncComp();
    const close = overlay(node, { onClose: () => finish(null) });
  });
}

// ---------- Personal layer (favourite, collections, notes, kind, own command, hide) ----------
const KINDS = [['', 'Automatic'], ['plugin', 'Claude Code plugin'], ['skill-pack', 'Skill pack'], ['skill', 'Skill'], ['mcp', 'MCP server'], ['cli', 'Command-line tool'], ['app', 'App'], ['components', 'UI components'], ['library', 'Library'], ['framework', 'Framework'], ['reference', 'Reference']];
export async function personalPanel(id, mine, onChange) {
  const cols = await api('collections');
  const save = async patch => { const r = await api('mark', { id, patch }); Object.assign(mine, r); onChange?.(r); return r; };
  const fav = btn(mine.fav ? 'Favourite' : 'Favourite', async () => { await save({ fav: !mine.fav }); fill(fav.querySelector('.btn-content'), icon('star', 'sm'), mine.fav ? 'Favourite' : 'Favourite'); fav.classList.toggle('on', Boolean(mine.fav)); }, { iconName: 'star', kind: 'ghost' });
  fav.classList.toggle('on', Boolean(mine.fav));
  const chips = h('div', { class: 'capchips' });
  const renderChips = () => fill(chips, [...new Set([...cols.map(c => c.name), ...(mine.collections || [])])].map(c => {
    const on = (mine.collections || []).includes(c);
    const b = h('button', { type: 'button', class: `capchip toggle ${on ? 'on' : ''}`, 'aria-pressed': String(on) }, c);
    b.addEventListener('click', async () => { await save({ collections: on ? mine.collections.filter(x => x !== c) : [...(mine.collections || []), c] }); renderChips(); });
    return b;
  }), btn('New collection', async () => { const n = await (await import('../lib/ui.js')).promptDialog({ title: 'New collection', placeholder: 'e.g. Client project, To try', confirm: 'Create' }); if (!n) return; cols.push({ name: n.trim() }); await save({ collections: [...(mine.collections || []), n.trim()] }); renderChips(); }, { size: 'sm', kind: 'ghost', iconName: 'plus' }));
  renderChips();
  const notes = h('textarea', { class: 'area', rows: '3', placeholder: 'Your notes about this resource (they stay on this device).', 'aria-label': 'Notes', value: mine.notes || '' });
  let t; notes.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => save({ notes: notes.value }), 500); });
  const kind = h('select', { class: 'select', 'aria-label': 'Kind' }, KINDS.map(([v, l]) => h('option', { value: v, selected: (mine.kind || '') === v || null }, l)));
  kind.addEventListener('change', async () => { await save({ kind: kind.value || null }); toast('Kind updated', 'good'); onChange?.(mine, true); });
  const cmd = h('input', { type: 'text', class: 'mono', placeholder: 'ex.: pnpm add @minha/lib', value: mine.command || '', 'aria-label': 'Your own project command' });
  const hide = btn(mine.hidden ? 'Show in Library' : 'Hide from Library', async () => { await save({ hidden: !mine.hidden }); toast(mine.hidden ? 'Hidden (see Show › Hidden)' : 'Visible again', 'good'); onChange?.(mine, true); }, { kind: 'ghost', size: 'sm', iconName: 'x' });
  return h('div', { class: 'box pad stack mine' },
    h('div', { class: 'row nowrap' }, fav, h('span', { class: 'grow' }), hide),
    h('div', { class: 'stack-xs' }, h('span', { class: 'micro' }, 'Collections'), chips),
    h('div', { class: 'stack-xs' }, h('span', { class: 'micro' }, 'Notes'), notes),
    h('div', { class: 'stack-xs' }, h('span', { class: 'micro' }, 'Kind'), kind),
    h('div', { class: 'stack-xs' }, h('span', { class: 'micro' }, 'Your own project command'), h('div', { class: 'row nowrap' }, h('div', { class: 'field grow' }, cmd), btn('Save', async () => { await save({ command: cmd.value }); toast('Saved', 'good'); onChange?.(mine, true); }, { size: 'sm' }))));
}
