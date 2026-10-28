// This device: the operating system, the AI agents found on it and what each one has (MCP servers,
// skills, plugins, claude.ai account skills), runtimes and package managers, and which catalogue
// resources are present. Read-only inventory; changes happen through Library actions.
import { h, relTime } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, empty, notice } from '../lib/ui.js';
import { go } from '../app.js';
import { runOperation } from './control.js';
import { stateChip, kindTile } from './common.js';

const RT = [['node', 'Node.js'], ['python3', 'Python'], ['git', 'Git'], ['uv', 'uv'], ['homebrew', 'Homebrew'], ['cargo', 'Rust'], ['docker', 'Docker'], ['go', 'Go'], ['claude', 'Claude Code'], ['xcode', 'Xcode']];
const SUPPORT = { tested: 'testado neste sistema', 'implemented-untested': 'implementado, ainda não testado neste sistema' };

function agentCard(a) {
  if (!a.present) return h('article', { class: 'agent absent' }, h('header', null, icon('agent'), h('strong', null, a.label), h('span', { class: 'muted', style: { marginLeft: 'auto', fontSize: '12px' } }, 'não encontrado')));
  const group = (title, items, render) => (items.length ? h('details', null, h('summary', null, `${title} · ${items.length}`, h('span', { class: 'muted' }, ` ${items.filter(i => i.matched).length} no catálogo`)), h('div', { class: 'items' }, items.map(render))) : null);
  const item = (name, tag, matched, extra) => h('div', { class: 'it' }, h('span', { class: 'n mono', title: name }, name), extra, h('span', { class: `tag ${matched ? 'cat' : ''}` }, matched ? 'no catálogo' : tag));
  return h('article', { class: 'agent' },
    h('header', null, icon('agent'), h('strong', null, a.label), a.writable ? h('span', { class: 'state installed', style: { marginLeft: 'auto' }, title: 'O CURI instala e remove através do próprio agente' }, 'Gerido') : h('span', { class: 'state reference', style: { marginLeft: 'auto' }, title: 'O CURI lê; alterações fazem-se no próprio agente' }, 'Só leitura')),
    h('div', { class: 'counts' },
      h('span', null, h('b', null, a.counts.mcp), 'MCP'), h('span', null, h('b', null, a.counts.skills), 'skills'), h('span', null, h('b', null, a.counts.plugins), 'plugins'),
      a.counts.account_skills ? h('span', null, h('b', null, a.counts.account_skills), 'da conta') : null),
    group('Servidores MCP', a.mcp, m => item(m.name, m.scope, m.matched, m.enabled === false ? h('span', { class: 'tag' }, 'desativado') : null)),
    group('Skills', a.skills, s => item(s.name, s.managed_by === 'curi' ? 'CURI' : s.scope, s.matched)),
    group('Plugins', a.plugins, p => item(p.id, p.scope === 'synced' ? 'conta' : p.enabled ? 'ativo' : 'desativado', p.matched)),
    group('Skills da conta claude.ai', a.account_skills, s => item(s.name, s.enabled ? s.origin || 'ativa' : 'desativada', s.matched)),
    h('footer', null, h('span', { style: { flex: 1 } }, a.manage?.how || ''),
      a.config ? btn('', () => api('revealAgentConfig', { agent: a.id }), { size: 'sm', kind: 'ghost', iconName: 'external', title: 'Mostrar o ficheiro de configuração' }) : null,
      a.manage?.url ? btn('', () => api('openExternal', { url: a.manage.url }), { size: 'sm', kind: 'ghost', iconName: 'cloud', title: 'Abrir as definições da conta' }) : null));
}

export async function device() {
  const d = await api('device');
  const r = d.scan;
  const scan = btn('Detetar agora', () => runOperation('system.scan', {}, 'Detetar o que está instalado'), { kind: 'primary', iconName: 'refresh' });
  const head = h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Este dispositivo'),
    h('p', null, `${d.label} · ${d.arch} · suporte ${SUPPORT[d.support] || d.support}. Credenciais no ${d.credential_store}.${r ? ` Última deteção ${relTime(r.scanned_at)}.` : ''}`)), h('div', { class: 'actions' }, scan));
  if (!r?.agents) return h('div', { class: 'page' }, head, empty('device', 'Ainda não foi feita uma deteção completa', 'O CURI lê, sem alterar nada, as apps, as ferramentas de linha de comando, os gestores de pacotes e a configuração de cada agente (Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI, Windsurf, VS Code), e associa tudo ao catálogo.', scan));
  const managers = Object.entries(r.managers || {});
  const present = r.agents.filter(a => a.present);
  return h('div', { class: 'page' }, head,
    h('div', { class: 'sec' }, h('h2', null, 'Agentes'), h('span', { class: 'meta' }, `${present.length} encontrados`)),
    h('div', { class: 'agents' }, [...present, ...r.agents.filter(a => !a.present)].map(agentCard)),
    h('div', { class: 'sec' }, h('h2', null, 'Do catálogo, presentes aqui'), h('span', { class: 'meta' }, `${r.matched.length} recursos`), h('span', { class: 'end' }, btn('Ver na Biblioteca', () => go('library?view=here'), { kind: 'ghost', size: 'sm', iconName: 'arrow' }))),
    r.matched.length ? h('div', { class: 'rlist' }, r.matched.map(m => {
      const el = h('div', { class: 'rrow', tabindex: '0', role: 'link' }, kindTile(m.kind, true),
        h('div', { class: 'rmain' }, h('div', { class: 'rname' }, h('strong', null, m.name)), h('div', { class: 'rdesc' }, m.found.slice(0, 4).map(f => `${f.agent_label || f.type} · ${f.name}${f.version ? ` ${f.version}` : ''}`).join('   '))),
        h('div', { class: 'rmeta' }, stateChip(m.state)), h('div', { class: 'ract' }));
      const open = () => go(`resource/${encodeURIComponent(m.id)}`);
      el.addEventListener('click', open); el.addEventListener('keydown', e => e.key === 'Enter' && open());
      return el;
    })) : empty('search', 'Nenhum recurso do catálogo encontrado'),
    h('div', { class: 'sec' }, h('h2', null, 'Ferramentas base')),
    h('div', { class: 'rt' }, RT.filter(([k]) => k in (r.runtimes || {})).map(([k, l]) => h('div', { class: r.runtimes[k] ? '' : 'off' }, h('span', { class: 'micro' }, l), h('span', { class: 'v' }, r.runtimes[k] || 'não encontrado')))),
    h('div', { class: 'sec' }, h('h2', null, 'Gestores de pacotes')),
    h('div', { class: 'rt' }, managers.map(([k, m]) => h('div', { class: m.available ? '' : 'off' }, h('span', { class: 'micro' }, m.label), h('span', { class: 'v' }, m.available ? (m.system ? 'sistema (só leitura)' : `${m.count ?? '—'} pacotes`) : 'não instalado')))),
    r.not_in_catalog?.apps?.length ? [h('div', { class: 'sec' }, h('h2', null, 'Aplicações fora do catálogo'), h('span', { class: 'meta' }, `${r.not_in_catalog.apps.length}`)),
      h('div', { class: 'box pad' }, h('div', { class: 'capchips' }, r.not_in_catalog.apps.map(a => h('span', { class: 'capchip' }, a))))] : null,
    h('div', { style: { marginTop: '22px' } }, notice('info', 'Bibliotecas usadas dentro de projetos (React, Zod, Three.js…) não são detetadas a nível do sistema: pertencem a cada projeto. Skills e conectores da conta claude.ai são lidos a partir da cópia sincronizada pelo Claude Desktop; geri-los faz-se em claude.ai.')));
}
