// Shared vocabulary for the new views: kind icons, presence states, and how a resource action runs.
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, toast, externalLink, overlay } from '../lib/ui.js';
import { fill } from '../lib/dom.js';
import { runOperation } from './control.js';
import { withProgress } from '../lib/opmodal.js';

export const KIND_ICON = { plugin: 'layers', 'skill-pack': 'skills', skill: 'skills', mcp: 'mcp', cli: 'terminal', app: 'grid', library: 'library', components: 'box', framework: 'library', reference: 'info' };
export const STATE_LABEL = { installed: 'Instalado', configured: 'Configurado', account: 'Na conta claude.ai', available: 'Disponível', project: 'Para projetos', reference: 'Referência' };
export const STATE_HINT = {
  installed: 'Existe neste dispositivo (instalado pelo CURI ou por outra via).',
  configured: 'Registado num agente (MCP ou plugin), sem instalação local própria.',
  account: 'Ativo na sua conta claude.ai e sincronizado para o Claude Desktop.',
  available: 'Pode ser instalado ou ativado a partir daqui.',
  project: 'Instala-se dentro de cada projeto, não no sistema.',
  reference: 'Fonte de consulta; não se instala.',
};
export const stateChip = st => h('span', { class: `state ${st || 'reference'}`, title: STATE_HINT[st] || '' }, STATE_LABEL[st] || 'Referência');
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
  if (a.disabled && a.prereq) return btn(a.prereq.label, () => runAction(a.prereq, a.missing?.join(', ') || name, after), { kind: kind || 'ghost', iconName: 'download', title: `Falta: ${a.missing.join(', ')}` });
  return btn(a.label, () => runAction(a, name, after), { kind: a.danger ? 'danger ghost' : kind, iconName: a.type === 'open' ? 'external' : a.danger ? 'trash' : a.op?.kind?.includes('install') || a.op?.kind === 'mcp.add' ? 'download' : a.op?.kind === 'mcp.check' ? 'activity' : 'refresh', disabled: a.disabled && !a.prereq, title: a.hint || (a.missing ? `Falta: ${a.missing.join(', ')}` : null) });
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiado', 'good'); } catch { toast('Não foi possível copiar', 'bad'); }
}
export const cmdLine = text => h('div', { class: 'cmd' }, h('code', null, text), btn('', () => copyText(text), { kind: 'ghost', size: 'sm', iconName: 'copy', title: 'Copiar' }));
export { externalLink, withProgress };

// ---------- Add a library/component to one of the user's projects ----------
const ECO = { js: 'JavaScript', py: 'Python', swift: 'Swift' };
export async function addToProject(name, commands) {
  const projects = await api('projects');
  return new Promise(resolve => {
    let sel = projects[0]?.path || null, done = false;
    const cmdSel = h('select', { class: 'select', 'aria-label': 'Comando' }, commands.map(c => h('option', { value: c.command }, c.command)));
    const comp = h('input', { type: 'text', placeholder: 'nome do componente, ex.: blur-text', 'aria-label': 'Componente' });
    const compRow = h('div', { class: 'field' }, comp);
    const list = h('div', { class: 'proj-list', role: 'radiogroup', 'aria-label': 'Projeto' });
    const other = h('input', { type: 'text', placeholder: '/caminho/para/o/projeto', 'aria-label': 'Outra pasta' });
    const syncComp = () => { compRow.hidden = !/<componente>/.test(cmdSel.value); };
    const renderList = items => fill(list, items.length ? items.map(p => {
      const b = h('button', { type: 'button', class: 'proj', role: 'radio', 'aria-checked': String(p.path === sel) },
        h('strong', null, p.name), h('span', { class: 'p' }, p.path.replace(/^\/Users\/[^/]+/, '~')),
        h('span', { class: 'eco' }, p.ecosystems.length ? p.ecosystems.map(e => h('span', null, `${ECO[e.id] || e.id} · ${e.manager}`)) : h('span', { class: 'warn' }, 'sem package.json nem pyproject')));
      b.addEventListener('click', () => { sel = p.path; renderList(items); });
      return b;
    }) : h('p', { class: 'muted' }, 'Ainda não há projetos conhecidos. Indique a pasta abaixo.'));
    renderList(projects);
    const finish = v => { if (!done) { done = true; close(); resolve(v); } };
    const go = btn('Adicionar', async () => {
      if (!sel) { toast('Escolha um projeto.', 'bad'); return; }
      const params = { path: sel, command: cmdSel.value, component: compRow.hidden ? undefined : comp.value.trim() };
      done = true; close();
      resolve(await runOperation('project.add', params, `Adicionar ${name} a ${sel.split('/').pop()}`, { refresh: false }));
    }, { kind: 'primary', iconName: 'download' });
    const node = h('div', { class: 'dialog wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pj-t' },
      h('h3', { id: 'pj-t' }, `Adicionar ${name} a um projeto`),
      h('p', { class: 'muted' }, 'O CURI usa o gestor do projeto (npm, pnpm, yarn, bun ou uv) e confirma no fim que a dependência ficou registada.'),
      list,
      h('div', { class: 'row nowrap' }, h('div', { class: 'field grow' }, other), btn('Usar esta pasta', async () => { const p = await api('projectAdd', { path: other.value }); sel = p.path; renderList(await api('projects')); other.value = ''; }, { iconName: 'plus' })),
      commands.length > 1 ? h('div', { class: 'field' }, cmdSel) : null, compRow,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => finish(null) }, 'Cancelar'), go));
    cmdSel.addEventListener('change', syncComp); syncComp();
    const close = overlay(node, { onClose: () => finish(null) });
  });
}

// ---------- Personal layer (favourite, collections, notes, kind, own command, hide) ----------
const KINDS = [['', 'Automático'], ['plugin', 'Plugin do Claude Code'], ['skill-pack', 'Pacote de skills'], ['skill', 'Skill'], ['mcp', 'Servidor MCP'], ['cli', 'Linha de comando'], ['app', 'Aplicação'], ['components', 'Componentes de UI'], ['library', 'Biblioteca'], ['framework', 'Framework'], ['reference', 'Referência']];
export async function personalPanel(id, mine, onChange) {
  const cols = await api('collections');
  const save = async patch => { const r = await api('mark', { id, patch }); Object.assign(mine, r); onChange?.(r); return r; };
  const fav = btn(mine.fav ? 'Nos favoritos' : 'Favorito', async () => { await save({ fav: !mine.fav }); fill(fav.querySelector('.btn-content'), icon('star', 'sm'), mine.fav ? 'Nos favoritos' : 'Favorito'); fav.classList.toggle('on', Boolean(mine.fav)); }, { iconName: 'star', kind: 'ghost' });
  fav.classList.toggle('on', Boolean(mine.fav));
  const chips = h('div', { class: 'capchips' });
  const renderChips = () => fill(chips, [...new Set([...cols.map(c => c.name), ...(mine.collections || [])])].map(c => {
    const on = (mine.collections || []).includes(c);
    const b = h('button', { type: 'button', class: `capchip toggle ${on ? 'on' : ''}`, 'aria-pressed': String(on) }, c);
    b.addEventListener('click', async () => { await save({ collections: on ? mine.collections.filter(x => x !== c) : [...(mine.collections || []), c] }); renderChips(); });
    return b;
  }), btn('Nova coleção', async () => { const n = await (await import('../lib/ui.js')).promptDialog({ title: 'Nova coleção', placeholder: 'ex.: Projeto cliente, Para testar', confirm: 'Criar' }); if (!n) return; cols.push({ name: n.trim() }); await save({ collections: [...(mine.collections || []), n.trim()] }); renderChips(); }, { size: 'sm', kind: 'ghost', iconName: 'plus' }));
  renderChips();
  const notes = h('textarea', { class: 'area', rows: '3', placeholder: 'Notas suas sobre este recurso (só ficam neste dispositivo).', 'aria-label': 'Notas', value: mine.notes || '' });
  let t; notes.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => save({ notes: notes.value }), 500); });
  const kind = h('select', { class: 'select', 'aria-label': 'Tipo' }, KINDS.map(([v, l]) => h('option', { value: v, selected: (mine.kind || '') === v || null }, l)));
  kind.addEventListener('change', async () => { await save({ kind: kind.value || null }); toast('Tipo atualizado', 'good'); onChange?.(mine, true); });
  const cmd = h('input', { type: 'text', class: 'mono', placeholder: 'ex.: pnpm add @minha/lib', value: mine.command || '', 'aria-label': 'Comando de projeto próprio' });
  const hide = btn(mine.hidden ? 'Mostrar na Biblioteca' : 'Ocultar da Biblioteca', async () => { await save({ hidden: !mine.hidden }); toast(mine.hidden ? 'Oculto (veja em Mostrar › Ocultos)' : 'Visível de novo', 'good'); onChange?.(mine, true); }, { kind: 'ghost', size: 'sm', iconName: 'x' });
  return h('div', { class: 'box pad stack mine' },
    h('div', { class: 'row nowrap' }, fav, h('span', { class: 'grow' }), hide),
    h('div', { class: 'stack-xs' }, h('span', { class: 'micro' }, 'Coleções'), chips),
    h('div', { class: 'stack-xs' }, h('span', { class: 'micro' }, 'Notas'), notes),
    h('div', { class: 'stack-xs' }, h('span', { class: 'micro' }, 'Tipo'), kind),
    h('div', { class: 'stack-xs' }, h('span', { class: 'micro' }, 'Comando de projeto próprio'), h('div', { class: 'row nowrap' }, h('div', { class: 'field grow' }, cmd), btn('Guardar', async () => { await save({ command: cmd.value }); toast('Guardado', 'good'); onChange?.(mine, true); }, { size: 'sm' }))));
}
