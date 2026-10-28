import { h, relTime, fmtDate, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, btn, status, badge, panel, pageHead, empty, notice, kv, table, toast, confirmDialog, externalLink, segmented, meter, when } from '../lib/ui.js';
import { go, mount, setPoll, params } from '../app.js';
import { showOperation, withProgress } from '../lib/opmodal.js';

// ---------- shared: preview the policy decision, confirm, enqueue as explicitly approved ----------
const DECISION = { auto: ['good', 'Automático pela política'], ask: ['warn', 'Precisa da sua aprovação'], block: ['bad', 'Bloqueado'] };
// Preview → (confirm unless it is read-only observation) → enqueue → live progress modal → refresh view.
export async function runOperation(kind, params, title, { refresh = true } = {}) {
  const p = await api('opPreview', { kind, params });
  if (p.decision === 'block') {
    await confirmDialog({ title: `${title}: não é possível`, body: p.reasons, confirm: 'Entendido' });
    return null;
  }
  // The click is the intent: work the chosen autonomy mode already covers runs without a second question.
  // Anything the mode does not cover, and every removal, still asks here.
  if (!(p.decision === 'auto' && p.category !== 'destructive')) {
    const ok = await confirmDialog({ title, body: [`Recurso: ${p.resource}`, p.source ? `Origem: ${p.source}` : null, ...p.reasons].filter(Boolean), confirm: 'Executar', danger: p.category === 'destructive' });
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
  not_installed: ['x', 'O Claude Code não está instalado', 'O CURI funciona em modo catálogo. Para ligar o Claude, o CURI instala a CLI oficial no seu runtime (na próxima abertura da app) ou pode instalar a app Claude.'],
  inaccessible: ['alert', 'O Claude Code não responde', 'O executável existe mas não arrancou. Reinstale a app Claude ou reabra o CURI para o reinstalar no runtime.'],
  disconnected: ['bridge', 'O Claude Code não está ligado', 'Ligue a sua conta para o CURI poder verificar a integração com pedidos reais. O catálogo, a pesquisa e o radar funcionam sem ligação.'],
  connecting: ['clock', 'A aguardar a autorização no browser', 'Aprove o acesso na página que abriu. Esta janela atualiza-se sozinha quando terminar.'],
  connected: ['check', 'Claude Code ligado', 'Sessão ativa. Pode verificar com um pedido real (consome uso da sua conta).'],
  verified: ['check', 'Claude Code ligado e verificado', 'Um pedido real através do Claude Code usou o CURI com sucesso.'],
  expired: ['clock', 'A sessão expirou', 'Volte a ligar para renovar a sessão.'],
  external_provider: ['lock', 'Autenticação gerida por outro fornecedor', 'O Claude Code está configurado para Bedrock/Vertex; a autenticação é feita nessa configuração.'],
  no_model_access: ['lock', 'A conta não tem acesso ao modelo', 'A sessão está ativa mas o pedido de verificação foi recusado. Verifique o plano ou a organização da conta.'],
  offline: ['alert', 'Sem ligação à internet', 'Não foi possível contactar a Anthropic. Tudo o que é local continua disponível.'],
  failed: ['x', 'A ligação falhou', 'O início de sessão terminou sem sucesso.'],
  cancelled: ['x', 'Ligação cancelada', 'Nenhuma alteração foi feita.'],
};

export function claudeCard(s, refresh) {
  const [ic, title, body] = CLAUDE_COPY[s.state] || ['info', s.title, s.detail];
  const kind = ['connected', 'verified'].includes(s.state) ? 'good' : ['connecting'].includes(s.state) ? 'info' : ['disconnected', 'cancelled'].includes(s.state) ? '' : 'warn';
  const mode = h('select', { class: 'select', 'aria-label': 'Tipo de conta' }, h('option', { value: 'claudeai' }, 'Subscrição Claude (Pro/Max/Team)'), h('option', { value: 'console' }, 'Anthropic Console (faturação API)'), h('option', { value: 'sso' }, 'SSO da organização'));
  const code = h('input', { type: 'text', placeholder: 'Código de autorização', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Código de autorização' });
  const actions = [];
  if (['disconnected', 'expired', 'failed', 'cancelled', 'no_model_access'].includes(s.state)) actions.push(mode, btn('Ligar Claude', async () => { await withProgress('A iniciar a ligação ao Claude', () => api('claudeLoginStart', { mode: mode.value }).then(() => 'Abrimos o browser. Aprove o acesso lá; esta página atualiza-se sozinha.'), { stage: 'A abrir a página de autorização…' }); refresh(); }, { kind: 'primary', iconName: 'bridge' }));
  if (s.state === 'connecting') actions.push(btn('Cancelar', async () => { await api('claudeLoginCancel'); refresh(); }, { kind: 'ghost', iconName: 'x' }));
  if (['connected', 'verified', 'expired', 'no_model_access'].includes(s.state)) actions.push(btn('Verificar com um pedido real', async () => { await withProgress('Pedido real ao Claude através do CURI', async () => { const r = await api('claudeVerify'); return r.result.status === 'COMPLETED' ? `Verificado: o Claude respondeu "${r.result.answer || 'ok'}".` : { ok: false, message: `Verificação ${r.result.status}: ${r.result.reason || ''}` }; }, { stage: 'O Claude Code está a usar a ferramenta curi (até 2 min)…' }); refresh(); }, { iconName: 'shield' }));
  if (['connected', 'verified'].includes(s.state)) actions.push(btn('Terminar sessão', async () => { if (await confirmDialog({ title: 'Terminar a sessão do Claude Code?', body: 'Afeta o Claude Code em todo o Mac, não só o CURI.', confirm: 'Terminar sessão', danger: true })) { await withProgress('A terminar a sessão do Claude Code', () => api('claudeLogout').then(() => 'Sessão terminada.')); refresh(); } }, { kind: 'ghost' }));
  if (['offline', 'inaccessible', 'not_installed'].includes(s.state)) actions.push(btn('Tentar de novo', refresh, { iconName: 'refresh' }));
  return h('section', { class: `panel conn-hero ${kind}` }, h('div', { class: 'panel-body' },
    h('div', { class: 'bh-status' }, h('span', { class: `result-ic ${kind}` }, s.state === 'connecting' ? h('span', { class: 'spin' }) : icon(ic, 'lg')), h('div', { class: 'grow' }, h('div', { class: 'micro' }, 'Claude Code'), h('h3', null, title), h('p', { class: 'muted' }, body))),
    s.state === 'connecting' && s.login?.needs_code ? h('div', { class: 'stack' },
      h('p', { class: 'muted', style: { margin: 0 } }, 'Se o browser não abriu ou mostrou um código, abra a página manualmente e cole o código aqui.'),
      h('div', { class: 'row' }, s.login.manual_url ? externalLink(s.login.manual_url, 'Abrir a página de autorização') : null),
      h('div', { class: 'row nowrap' }, h('div', { class: 'field grow' }, icon('lock', 'sm'), code), btn('Enviar código', async () => { await api('claudeLoginCode', { code: code.value }); code.value = ''; setTimeout(refresh, 800); }, { kind: 'primary' }))) : null,
    h('div', { class: 'bh-facts' }, fact('Versão', s.version || '—'), fact('Método', s.method || '—'), fact('Fornecedor', s.provider || '—'), fact('Executável', h('span', { class: 'mono' }, s.binary || '—'))),
    h('div', { class: 'row' }, ...actions)));
}
const fact = (l, v) => h('div', null, h('span', { class: 'micro' }, l), h('div', null, v));

const CONN_STATUS = { connected: ['good', 'Ligado'], unverified: ['warn', 'Guardado, não testado'], invalid: ['bad', 'Credencial inválida'], forbidden: ['bad', 'Sem permissão'], unreachable: ['warn', 'Fornecedor inacessível'], error: ['bad', 'Erro'], not_configured: ['', 'Não ligado'] };

function providerCard(c, refresh) {
  const [k, label] = CONN_STATUS[c.status] || ['', c.status];
  const input = h('input', { type: 'password', placeholder: c.has_secret ? 'Substituir a credencial…' : 'Colar a chave ou token', autocomplete: 'off', spellcheck: 'false', 'aria-label': `Credencial ${c.name}` });
  const save = async () => {
    if (!input.value.trim()) { input.focus(); return; }
    const secret = input.value.trim();
    input.value = '';
    await withProgress(`A testar e guardar ${c.name}`, async () => { const r = await api('connectionSave', { provider: c.provider, secret }); return r.saved ? `${r.detail} Guardado no cofre do sistema.` : { ok: false, message: `${r.detail} Nada foi guardado; a credencial anterior foi mantida.` }; }, { stage: `A contactar ${c.name}…` }).catch(() => {});
    refresh();
  };
  input.addEventListener('keydown', e => e.key === 'Enter' && save());
  return h('article', { class: 'panel provider' }, h('div', { class: 'panel-body' },
    h('div', { class: 'row nowrap' }, h('span', { class: 'itile' }, icon(c.provider === 'github' ? 'git' : 'bolt')), h('div', { class: 'grow' }, h('div', { class: 't1' }, c.name), h('div', { class: 't2' }, c.account ? `Conta: ${c.account}` : c.hint)), h('span', { class: `badge ${k}` }, label)),
    c.detail ? h('p', { class: 'muted small' }, c.detail) : null,
    h('ul', { class: 'plain caps' }, c.capabilities.map(x => h('li', null, icon('check', 'sm'), x))),
    c.keychain ? h('div', { class: 'row nowrap' }, h('div', { class: 'field grow' }, icon('lock', 'sm'), input), btn(c.has_secret ? 'Substituir' : 'Guardar e testar', save, { kind: c.has_secret ? '' : 'primary' })) : notice('warn', 'O armazenamento seguro só está disponível no macOS.'),
    h('div', { class: 'row' },
      c.has_secret ? btn('Testar', async () => { await withProgress(`A testar ${c.name}`, async () => { const r = await api('connectionTest', { provider: c.provider }); return r.ok ? r.detail : { ok: false, message: r.detail || r.status }; }, { stage: `A contactar ${c.name}…` }).catch(() => {}); refresh(); }, { kind: 'ghost sm', iconName: 'refresh' }) : null,
      c.has_secret ? btn('Remover acesso local', async () => { if (await confirmDialog({ title: `Remover ${c.name}?`, body: 'Apaga a credencial do cofre do sistema. Para a invalidar de vez, revogue-a também no site do fornecedor.', confirm: 'Remover', danger: true })) { await withProgress(`A remover ${c.name}`, () => api('connectionRemove', { provider: c.provider }).then(r => (r.removed ? 'Credencial apagada do cofre do sistema.' : 'Não havia credencial no cofre do sistema.'))); refresh(); } }, { kind: 'ghost sm danger', iconName: 'trash' }) : null,
      h('span', { class: 'spacer' }), externalLink(c.docs, 'Como obter'),
      c.last_ok ? h('span', { class: 'muted small' }, `testado ${relTime(c.last_tested)}`) : null)));
}

// Reuse an existing GitHub sign-in (GitHub CLI) and read the user's stars, without pasting tokens.
function githubReuse(list, refresh) {
  const gh = list.find(c => c.provider === 'github');
  const box = h('div');
  api('githubExisting').then(x => {
    if (gh?.status === 'connected') fill(box, panel({ title: 'GitHub ligado', meta: gh.account || '' }, h('div', { class: 'row' }, h('p', { class: 'muted', style: { margin: 0, flex: 1 } }, 'Pesquisas com limites autenticados. O CURI pode rever os repositórios a que deu estrela e separar o que é útil aos seus agentes.'),
      btn('Ler as minhas estrelas', () => runOperation('github.stars', {}, 'Ler as estrelas do GitHub', { refresh: false }), { kind: 'primary', iconName: 'star' }))));
    else if (x.gh_logged_in) fill(box, panel({ title: 'Sessão do GitHub encontrada', meta: x.gh_user || 'GitHub CLI' }, h('div', { class: 'row' }, h('p', { class: 'muted', style: { margin: 0, flex: 1 } }, 'O GitHub CLI (gh) já tem sessão iniciada neste dispositivo. Com a sua autorização, o CURI pede-lhe o token pela via oficial (gh auth token), testa-o e guarda-o no cofre do sistema.'),
      btn('Reutilizar esta sessão', () => withProgress('A ligar o GitHub com a sessão do gh', async () => { const r = await api('githubAdoptCli'); refresh(); return r.saved ? `Ligado como ${r.account || 'GitHub'}.` : `Não ficou ligado: ${r.detail || 'teste falhou'}`; }), { kind: 'primary', iconName: 'link' }))));
    else fill(box);
  }).catch(() => {});
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
      pageHead({ title: 'Ligações', sub: 'Contas e credenciais. Chaves e tokens ficam no cofre do sistema operativo: o CURI nunca os mostra, regista nem exporta.' }),
      h('div', { class: first ? 'stack-lg reveal' : 'stack-lg' },
        claudeCard(s, render),
        githubReuse(list, render),
        h('div', { class: 'grid cols-2' }, list.map(c => providerCard(c, render))),
        panel({ title: 'Segredos de servidores MCP', meta: `${secrets.length}` }, secrets.length ? h('div', { class: 'rows' }, secrets.map(x => {
          const inp = h('input', { type: 'password', placeholder: 'Valor', autocomplete: 'off', 'aria-label': x.ref });
          return h('div', { class: 'r' }, icon('lock', 'sm'), h('div', { class: 'grow' }, h('div', { class: 't1 mono' }, x.ref), h('div', { class: 't2' }, `Usado por: ${x.users.join(', ')}`)), h('div', { class: 'field' }, inp),
            btn('Guardar', async () => { if (!inp.value) return; const value = inp.value; inp.value = ''; await withProgress(`A guardar ${x.ref}`, () => api('secretSave', { ref: x.ref, value }).then(() => 'Guardado no cofre do sistema.')); }, { kind: 'sm' }),
            btn('', async () => { if (await confirmDialog({ title: `Remover ${x.ref}?`, body: 'Os servidores que o usam deixam de arrancar até guardar um novo valor.', confirm: 'Remover', danger: true })) await withProgress(`A remover ${x.ref}`, () => api('secretRemove', { ref: x.ref }).then(r => (r.removed ? 'Removido do cofre do sistema.' : 'Não existia.'))); }, { kind: 'ghost sm', iconName: 'trash', title: 'Remover' }));
        })) : h('p', { class: 'muted', style: { margin: 0 } }, 'Nenhum servidor MCP definido pede segredos.'))));
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
    pageHead({ eyebrow: 'Integrações', title: 'Catálogo de integrações', sub: 'Instalações com versão fixa, análise estática antes de escrever e verificação depois. Nada é instalado só por aparecer no catálogo.' }),
    h('div', { class: 'stack-lg reveal' },
      panel({ title: 'Servidores MCP', meta: 'arrancados pelo Claude através do launcher do CURI', flush: true }, h('div', { class: 'rows' }, pr.mcp.map(m => h('div', { class: 'r' },
        h('span', { class: 'itile' }, icon('mcp')), h('div', { class: 'grow' }, h('div', { class: 't1' }, m.title, ' ', h('span', { class: 'muted mono small' }, m.args.at(-1))), h('div', { class: 't2' }, m.purpose)),
        m.trusted ? badge(m.publisher, 'info') : badge(`${m.publisher} · não confiável`, 'warn'),
        Object.entries(m.secrets_present).map(([k, ok]) => (ok ? badge(`${k} ✓`, 'good') : h('a', { class: 'badge warn', href: '#/connections' }, `falta ${k}`))),
        m.enabled ? status('configured', 'Ativo') : null,
        m.enabled ? btn('Desativar', () => runOperation('mcp.disable', { name: m.name }, `Desativar ${m.title}`), { kind: 'ghost sm' })
          : btn('Ativar', async () => { if (!m.defined) await api('mcpDefine', m); await runOperation('mcp.enable', { name: m.name }, `Ativar ${m.title}`); }, { kind: 'primary sm' }))))),
      panel({ title: 'Skills', meta: 'commit fixo · análise estática · verificação por checksum', flush: true }, h('div', { class: 'rows' }, pr.skills.map(s => h('div', { class: 'r' },
        h('span', { class: 'itile' }, icon('skills')), h('div', { class: 'grow' }, h('div', { class: 't1' }, s.name, s.commit ? h('span', { class: 'muted mono small' }, ` @${s.commit.slice(0, 7)}`) : null), h('div', { class: 't2' }, `${s.repo} · ${s.purpose}`)),
        s.trusted ? badge(s.publisher, 'info') : badge(`${s.publisher} · não confiável`, 'warn'),
        s.exists_unmanaged ? badge('existe (não gerida)', 'warn') : s.installed ? status('files-ok', 'Instalada') : null,
        s.installed ? [btn('Atualizar', () => runOperation('skill.install', { repo: s.repo, path: s.path }, `Atualizar ${s.name}`), { kind: 'ghost sm', iconName: 'refresh' }), btn('Remover', () => runOperation('skill.remove', { name: s.name }, `Remover ${s.name}`), { kind: 'ghost sm danger' })]
          : s.exists_unmanaged ? null : btn('Instalar', () => runOperation('skill.install', { repo: s.repo, path: s.path }, `Instalar ${s.name}`), { kind: 'primary sm' }))))),
      panel({ title: 'Servidores MCP personalizados', meta: `${custom.length}` }, custom.length ? h('div', { class: 'rows' }, custom.map(d => h('div', { class: 'r' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, d.name), h('div', { class: 't2 mono' }, d.transport === 'stdio' ? [d.command, ...d.args].join(' ') : d.url)),
        d.enabled ? status('configured', 'Ativo') : badge('inativo'),
        d.enabled ? btn('Desativar', () => runOperation('mcp.disable', { name: d.name }, `Desativar ${d.name}`), { kind: 'ghost sm' }) : [btn('Ativar', () => runOperation('mcp.enable', { name: d.name }, `Ativar ${d.name}`), { kind: 'primary sm' }), btn('', async () => { if (await confirmDialog({ title: `Apagar a definição ${d.name}?`, body: 'Só apaga a definição no CURI; o servidor não está ativo no Claude.', confirm: 'Apagar', danger: true })) { await api('mcpUndefine', { name: d.name }); mount(); } }, { kind: 'ghost sm', iconName: 'trash', title: 'Apagar definição' })]))) : null, form),
      panel({ title: 'Serviço de fundo' }, h('div', { class: 'row' }, agent.loaded ? status('configured', 'A correr no launchd') : agent.installed ? status('blocked', 'Instalado, não carregado') : badge('não instalado'),
        h('span', { class: 'muted' }, agent.loaded ? `De ${Math.round((agent.interval_s || 0) / 60)} em ${Math.round((agent.interval_s || 0) / 60)} min executa operações aprovadas e verificações agendadas, mesmo com a app fechada.` : 'Permite trabalho aprovado com a janela fechada (LaunchAgent do utilizador, sem privilégios).'),
        h('span', { class: 'spacer' }), agent.installed ? btn('Remover', () => runOperation('agent.remove', {}, 'Remover o serviço de fundo'), { kind: 'ghost sm danger' }) : btn('Instalar', () => runOperation('agent.install', { interval_s: 1800 }, 'Instalar o serviço de fundo'), { kind: 'primary sm' })))));
}

function customMcpForm() {
  const name = h('input', { type: 'text', placeholder: 'nome (ex.: meu-servidor)', 'aria-label': 'Nome' });
  const transport = h('select', { class: 'select', 'aria-label': 'Transporte' }, h('option', { value: 'stdio' }, 'stdio (processo local)'), h('option', { value: 'http' }, 'HTTP (remoto)'));
  const command = h('input', { type: 'text', placeholder: 'npx · uvx · node · python3 · /caminho/absoluto', 'aria-label': 'Comando' });
  const args = h('textarea', { class: 'area', rows: '3', placeholder: 'Um argumento por linha', 'aria-label': 'Argumentos' });
  const url = h('input', { type: 'url', placeholder: 'https://…', 'aria-label': 'URL' });
  const env = h('textarea', { class: 'area', rows: '2', placeholder: 'NOME=valor (não secreto), um por linha', 'aria-label': 'Variáveis' });
  const secrets = h('textarea', { class: 'area', rows: '2', placeholder: 'API_KEY=secret:nome  ·  GITHUB_TOKEN=provider:github', 'aria-label': 'Segredos' });
  const publisher = h('input', { type: 'text', placeholder: 'editor (dono do repositório)', 'aria-label': 'Editor' });
  const pairs = t => Object.fromEntries(t.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => [l.split('=')[0].trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const sync = () => { const s = transport.value === 'stdio'; command.closest('.field').hidden = !s; args.hidden = !s; url.closest('.field').hidden = s; };
  transport.addEventListener('change', sync);
  const el = h('details', { class: 'mcp-form' }, h('summary', { class: 'muted' }, icon('plus', 'sm'), ' Adicionar servidor personalizado'),
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, name), transport, h('div', { class: 'field' }, command), h('div', { class: 'field' }, url), h('div', { class: 'field' }, publisher),
      args, env, secrets,
      h('p', { class: 'muted small' }, 'Segredos nunca vão para o ~/.claude.json: o Claude arranca o launcher do CURI, que os lê do cofre do sistema no momento. Servidores de editores fora da lista de confiança pedem sempre aprovação.'),
      h('div', { class: 'row' }, h('span', { class: 'spacer' }), btn('Guardar definição', async () => {
        await api('mcpDefine', { name: name.value.trim(), transport: transport.value, command: command.value.trim(), args: args.value.split('\n').map(x => x.trim()).filter(Boolean), url: url.value.trim(), env: pairs(env), secret_env: pairs(secrets), publisher: publisher.value.trim() });
        toast('Definição guardada. Ative-a quando estiver pronta.', 'good'); mount();
      }, { kind: 'primary' }))));
  setTimeout(sync);
  return el;
}

// =====================================================================================
// Automation & permissions
// =====================================================================================
const MODE_COPY = {
  standard: ['Padrão', 'Aprova cada instalação e alteração significativa. Verificações e leituras correm sozinhas.', 'lock'],
  automatic: ['Automático', 'Recomendado. Deteção, verificação, atualizações e reparações do que já instalou correm sozinhas, tal como skills e ferramentas de editores de confiança. O resto pede aprovação.', 'bolt'],
  maximum: ['Autonomia máxima', 'Também servidores MCP e plugins de editores de confiança, pacotes do catálogo com origem confirmada no registo oficial, código com análise limpa e o serviço de fundo. Remoções, editores desconhecidos, custos e ações de administrador pedem sempre.', 'sparkle'],
};

export function modePicker(pol, onChange) {
  const cur = pol.consent.implicit ? null : pol.consent.mode;
  return h('div', { class: 'modes', role: 'radiogroup', 'aria-label': 'Modo de gestão' }, pol.modes.map(m => {
    const [t, d, ic] = MODE_COPY[m];
    const b = h('button', { type: 'button', class: `mode ${cur === m ? 'on' : ''} ${m === 'automatic' ? 'rec' : ''}`, role: 'radio', 'aria-checked': String(cur === m) },
      h('div', { class: 'row nowrap' }, h('span', { class: 'itile' }, icon(ic)), h('strong', null, t), m === 'automatic' ? badge('recomendado', 'info') : null, h('span', { class: 'spacer' }), cur === m ? icon('check') : null),
      h('p', null, d),
      h('div', { class: 'mode-counts micro' }, `${Object.values(pol.matrix).filter(x => x[m] === 'auto').length} de ${Object.keys(pol.matrix).length} categorias sem pedido`));
    b.addEventListener('click', async () => {
      if (m === 'maximum' && !(await confirmDialog({ title: 'Ativar a autonomia máxima?', body: 'O CURI passa a instalar sem perguntar: skills, plugins e servidores MCP de editores de confiança (incluindo código, se a análise estiver limpa), pacotes do catálogo cuja origem foi confirmada no registo oficial, atualizações e o serviço de fundo. Remoções, editores desconhecidos, custos e ações de administrador continuam a pedir. Pode revogar a qualquer momento.', confirm: 'Ativar' }))) return;
      const r = await api('policyGrant', { mode: m });
      toast(`Modo ${t} ativo.${r.requeued_for_approval.length ? ` ${r.requeued_for_approval.length} operação(ões) voltaram a pedir aprovação.` : ''}`, 'good');
      onChange();
    });
    return b;
  }));
}

function maintenancePanel(m) {
  const inputs = new Map();
  return panel({ title: 'Manutenção automática', meta: m.last ? `última ${relTime(m.last.at)}` : 'ainda não correu', flush: true },
    h('div', { class: 'rows' }, m.tasks.map(t => {
      const inp = h('input', { type: 'number', class: 'num-input', min: '0', max: '720', value: String(t.every_hours), 'aria-label': `Horas entre execuções: ${t.label}` });
      inputs.set(t.pref, inp);
      return h('div', { class: 'r' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, t.label), h('div', { class: 't2' }, t.last ? `Última vez ${relTime(t.last)}` : 'Ainda não correu')), h('span', { class: 'muted small' }, 'cada'), inp, h('span', { class: 'muted small' }, 'h'));
    }),
    m.suggestions.length ? h('div', { class: 'r' }, icon('shield', 'sm'), h('div', { class: 'grow' }, h('div', { class: 't1' }, `${m.suggestions.length} tarefa(s) fora do que o modo atual cobre`), h('div', { class: 't2' }, m.suggestions.slice(0, 3).map(s => s.label).join(' · ')))) : null,
    h('div', { class: 'r' }, h('span', { class: 'muted small grow' }, '0 = desligado. Cada tarefa só corre sozinha se o modo de autonomia a cobrir; o resto aparece no Início como sugestão.'),
      btn('Correr agora', async () => { const r = await api('maintenanceRun'); toast(`${r.queued.length} tarefa(s) iniciada(s)${r.suggestions.length ? `; ${r.suggestions.length} à espera de autorização` : ''}`, 'good'); }, { iconName: 'play' }),
      btn('Guardar', async () => { const prefs = {}; for (const [k, inp] of inputs) prefs[k] = Number(inp.value); await api('prefsSet', prefs); toast('Guardado', 'good'); }, { kind: 'primary' }))));
}

export async function automation() {
  const [pol, prefs, maint] = await Promise.all([api('policy'), api('prefsAll'), api('maintenance')]);
  const pub = h('textarea', { class: 'area', rows: '3', 'aria-label': 'Editores de confiança', value: pol.trusted.join('\n') });
  const hours = h('input', { type: 'number', class: 'num-input', min: '0', max: '168', value: String(prefs.auto_verify_hours ?? 24), 'aria-label': 'Horas entre verificações' });
  const notifyMode = h('select', { class: 'select', 'aria-label': 'Notificações' }, [['all', 'Depois de cada operação'], ['errors', 'Só erros e pedidos de aprovação'], ['none', 'Nenhuma (aprovações continuam visíveis na app)']].map(([v, l]) => h('option', { value: v, selected: (prefs.notify_mode || 'errors') === v || null }, l)));
  const battery = h('input', { type: 'checkbox', role: 'switch', id: 'bat', checked: prefs.pause_on_battery !== false || null });
  const modes = ['standard', 'automatic', 'maximum'];
  return h('div', { class: 'page' },
    pageHead({ title: 'Autonomia', sub: 'O que o CURI faz sozinho e o que lhe pergunta. O consentimento cobre categorias definidas, não acesso ilimitado; o sistema operativo continua a pedir a palavra-passe para ações de administrador.' }),
    h('div', { class: 'stack-lg reveal' },
      pol.consent.implicit ? notice('info', 'Ainda não escolheu um modo: está em Padrão (aprova tudo).') : notice('info', `Modo atual: ${MODE_COPY[pol.consent.mode][0]}, concedido ${relTime(pol.consent.granted_at)} (política ${pol.version}).`),
      modePicker(pol, () => mount()),
      maintenancePanel(maint),
      h('div', { class: 'row' }, h('span', { class: 'spacer' }), !pol.consent.implicit && pol.consent.mode !== 'standard' ? btn('Revogar agora', async () => { const r = await api('policyRevoke'); toast(`Autonomia revogada. ${r.requeued_for_approval.length} operação(ões) em fila voltaram a pedir aprovação. Operações já concluídas não são desfeitas.`, 'good'); mount(); }, { kind: 'danger', iconName: 'x' }) : null),
      panel({ title: 'Matriz de permissões', meta: 'automático = sem pedido · aprovar = pede sempre', flush: true }, h('div', { class: 'table-wrap' }, h('table', { class: 't matrix' },
        h('thead', null, h('tr', null, h('th', null, 'Categoria'), modes.map(m => h('th', { class: m === pol.consent.mode && !pol.consent.implicit ? 'cur' : null }, MODE_COPY[m][0])))),
        h('tbody', null, Object.entries(pol.matrix).map(([k, v]) => h('tr', null, h('td', null, v.label), modes.map(m => h('td', { class: m === pol.consent.mode && !pol.consent.implicit ? 'cur' : null }, v[m] === 'auto' ? h('span', { class: 'badge good' }, icon('check'), 'automático') : h('span', { class: 'badge' }, icon('lock'), 'aprovar'))))))))),
      h('div', { class: 'grid cols-2' },
        panel({ title: 'Editores de confiança' }, h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Donos de repositórios GitHub cujo código pode ser instalado sob a política. Um por linha. Fora desta lista, tudo pede aprovação.'), pub,
          h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'spacer' }), btn('Guardar', async () => { const r = await api('trustedSet', { publishers: pub.value.split('\n') }); toast(`${r.length} editores de confiança`, 'good'); }, { kind: 'primary' }))),
        panel({ title: 'Trabalho de fundo e avisos', flush: true }, h('div', { class: 'rows' },
          h('div', { class: 'r' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, 'Verificar fontes automaticamente'), h('div', { class: 't2' }, 'De quantas em quantas horas (0 = nunca). Usa o serviço de fundo.')), hours),
          h('div', { class: 'r' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, 'Pausar com bateria'), h('div', { class: 't2' }, 'Não inicia trabalho agendado enquanto o Mac está a bateria.')), h('span', { class: 'switch' }, battery, h('span'))),
          h('div', { class: 'r' }, h('div', { class: 'grow' }, h('div', { class: 't1' }, 'Notificações'), h('div', { class: 't2' }, 'Desligar avisos nunca aprova operações.')), notifyMode),
          h('div', { class: 'r' }, h('span', { class: 'spacer' }), btn('Guardar', async () => { await api('prefsSet', { auto_verify_hours: Number(hours.value), pause_on_battery: battery.checked, notify_mode: notifyMode.value }); toast('Guardado', 'good'); }, { kind: 'primary' })))))));
}

// =====================================================================================
// Operations
// =====================================================================================
const OP_STATUS = { queued: ['info', 'Na fila'], running: ['info', 'A executar'], awaiting_approval: ['warn', 'Aguarda aprovação'], verified: ['good', 'Verificada'], completed: ['good', 'Concluída'], failed: ['bad', 'Falhou'], cancelled: ['', 'Cancelada'], blocked: ['bad', 'Bloqueada'], rejected: ['', 'Rejeitada'], interrupted: ['warn', 'Interrompida'] };
const opBadge = s => { const [k, l] = OP_STATUS[s] || ['', s]; return h('span', { class: `badge ${k}` }, s === 'running' ? h('span', { class: 'spin' }) : null, l); };

function opDetail(o) {
  return h('div', { class: 'op-detail' },
    kv([['Tipo', h('span', { class: 'mono' }, o.kind)], ['Recurso', o.resource], ['Origem', o.source], ['Categoria', o.security_class], ['Decisão', o.decision_reasons.join(' ')], ['Aprovada por', o.approved_by || '—'], ['Tentativas', `${o.attempts}/${o.max_attempts}`], ['Criada', fmtDate(o.created_at)], ['Terminada', fmtDate(o.finished_at)], o.error ? ['Erro', h('span', { class: 'warn-text' }, o.error)] : null]),
    o.verification ? h('div', null, h('div', { class: 'micro' }, 'Verificação'), h('pre', null, JSON.stringify(o.verification, null, 2))) : null,
    o.recovery ? h('div', null, h('div', { class: 'micro' }, 'Recuperação'), h('pre', null, JSON.stringify(o.recovery, null, 2))) : null,
    h('div', { class: 'micro' }, 'Registo'), h('div', { class: 'log' }, o.logs.map(l => h('div', { class: l.level }, h('span', { class: 'muted' }, fmtDate(l.at, { timeStyle: 'medium' })), ' ', l.message))));
}

export async function operations() {
  const root = h('div', { class: 'page' });
  let filter = params().get('status') || 'all', q = '', open = params().get('id');
  const search = h('input', { type: 'search', placeholder: 'Procurar por tipo ou recurso', 'aria-label': 'Procurar operações' });
  search.addEventListener('input', () => { q = search.value; render(); });
  async function render() {
    const all = await api('ops', { limit: 500, q });
    const pending = all.filter(o => o.status === 'awaiting_approval');
    const active = all.filter(o => ['queued', 'running'].includes(o.status));
    const shown = all.filter(o => filter === 'all' || o.status === filter);
    const list = h('div', { class: 'rows' }, shown.map(o => {
      const row = h('details', { class: 'r op', open: o.id === open || null },
        h('summary', { class: 'row nowrap' }, opBadge(o.status), h('div', { class: 'grow' }, h('div', { class: 't1' }, o.resource || o.kind), h('div', { class: 't2' }, `${o.kind} · ${o.stage || ''} · ${relTime(o.updated_at)}`)),
          o.status === 'running' && o.progress != null ? h('div', { style: { width: '120px' } }, meter(o.progress)) : null,
          o.status === 'awaiting_approval' ? [btn('Aprovar', async () => { await api('opApprove', { id: o.id }); render(); }, { kind: 'primary sm' }), btn('Rejeitar', async () => { await api('opReject', { id: o.id }); render(); }, { kind: 'ghost sm' })] : null,
          ['queued', 'running'].includes(o.status) ? btn('Cancelar', async () => { await api('opCancel', { id: o.id }); render(); }, { kind: 'ghost sm' }) : null,
          ['failed', 'interrupted', 'cancelled'].includes(o.status) ? btn('Repetir', async () => { await api('opRetry', { id: o.id }); render(); }, { kind: 'ghost sm', iconName: 'refresh' }) : null),
        opDetail(o));
      row.addEventListener('toggle', () => { open = row.open ? o.id : open === o.id ? null : open; });
      return row;
    }));
    fill(root, ...[
      pageHead({ eyebrow: 'Controlo', title: 'Operações', sub: 'Fila persistente: sobrevive a reinícios, não duplica trabalho e regista cada decisão. Cancelar pára no próximo ponto seguro; o que já foi escrito fica descrito em "Recuperação".' }),
      h('section', { class: 'panel kpis small' }, kpi('Aguardam aprovação', pending.length), kpi('Ativas', active.length), kpi('Verificadas', all.filter(o => o.status === 'verified').length), kpi('Falhadas', all.filter(o => o.status === 'failed').length), kpi('Total', all.length)),
      pending.length ? notice('warn', `${pending.length} operação(ões) à espera da sua decisão.`) : null,
      h('div', { class: 'toolbar' }, segmented([['all', 'Todas'], ['awaiting_approval', 'Aprovação'], ['running', 'A executar'], ['queued', 'Na fila'], ['verified', 'Verificadas'], ['failed', 'Falhadas']], filter, v => { filter = v; render(); }, 'Filtro'), h('span', { class: 'spacer' }), h('div', { class: 'field' }, icon('search', 'sm'), search)),
      panel({ flush: true }, shown.length ? list : empty('activity', 'Sem operações', 'Instalações, reparações e verificações aparecem aqui.'))].filter(Boolean));
  }
  await render();
  setPoll(() => (document.querySelector('.op[open] :focus') ? null : render()), 2500);
  return root;
}
const kpi = (l, v) => h('div', { class: 'kpi' }, h('span', { class: 'micro' }, l), h('div', { class: 'kpi-value num' }, v));
