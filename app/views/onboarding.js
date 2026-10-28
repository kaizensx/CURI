import { h, fmtDate, relTime, fmtInt, fill } from '../lib/dom.js';
import { icon, brandMark } from '../lib/icons.js';
import { api, btn, linkBtn, status, badge, panel, pageHead, notice, kv, table, toast, confirmDialog } from '../lib/ui.js';
import { go, mount, setPoll } from '../app.js';
import { modePicker, claudeCard } from './control.js';

const WPS = [
  ['WP1-preflight', 'Verificar o Mac', 'Sistema, ferramentas, Claude Code e o que já está instalado — só leitura.', 'terminal'],
  ['WP2-snapshot', 'Cópia de segurança', 'Cópia com checksums das suas configurações Claude antes de qualquer alteração.', 'database'],
  ['WP3-import', 'Catálogo semente', 'Importar o catálogo inicial para o registo local, sem perder nenhum URL.', 'library'],
  ['WP4-plan', 'Rever e aprovar', 'Cada alteração ao seu perfil tem a sua própria aprovação.', 'shield'],
  ['WP5-provision', 'Aplicar', 'Escrever apenas o que aprovou, com transação reversível.', 'bolt'],
  ['WP6-verify', 'Verificar', 'Testes independentes do estado real — não confia em promessas.', 'check'],
];

export async function welcome() {
  const [s, b] = await Promise.all([api('status'), api('bootstrapState')]);
  const started = b.state !== 'UNINITIALIZED';
  return h('div', { class: 'page welcome' },
    h('section', { class: 'hero' },
      h('div', { class: 'hero-mark', 'aria-hidden': 'true' }, brandMark({ size: 52 })),
      h('div', { class: 'micro' }, 'Claude Universal Resource Intelligence'),
      h('h1', null, 'A ferramenta certa, no momento certo.'),
      h('p', null, 'O CURI mantém um registo local e verificável de skills, servidores MCP, bibliotecas e documentação — e dá ao Claude Code uma forma leve de os encontrar, comparar e propor, sem instalar nada às escondidas.'),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        linkBtn(['READY', 'PARTIAL_READY'].includes(b.state) ? 'Rever configuração' : started ? 'Continuar configuração' : 'Começar configuração', '#/wizard', { kind: 'primary', iconName: 'wizard' }),
        s.resources ? linkBtn('Explorar em modo só leitura', '#/library', { iconName: 'library' })
          : btn('Explorar em modo só leitura', async () => { await api('bootstrapAdvance'); toast('A preparar o catálogo local…'); setTimeout(() => go('library'), 1500); }, { iconName: 'library' })),
      h('div', { class: 'hero-state' }, 'Estado atual ', status(b.state))),
    h('div', { class: 'grid cols-3 reveal' },
      pillar('lock', 'Local e privado', 'Base de dados no seu Mac. Sem telemetria. Interface só em 127.0.0.1 com token.'),
      pillar('shield', 'Nada sem aprovação', 'Exatamente duas alterações possíveis ao perfil Claude, cada uma aprovada à parte e reversível.'),
      pillar('check', 'Provado, não prometido', 'Só mostra "Pronto" depois de verificações independentes ao estado real.')));
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

    const stepper = h('ol', { class: 'stepper', 'aria-label': 'Passos da configuração' }, WPS.map(([id, title, desc, ic], i) => {
      const st = done[id] ? 'done' : i === currentIdx && !terminal ? (busy ? 'active' : b.state === 'APPROVAL_REQUIRED' && id === 'WP5-provision' ? 'waiting' : 'next') : 'todo';
      return h('li', { class: `step ${st}`, 'aria-current': st === 'active' || st === 'waiting' ? 'step' : null },
        h('span', { class: 'step-node' }, st === 'done' ? icon('check', 'sm') : st === 'active' ? h('span', { class: 'spin' }) : icon(ic, 'sm')),
        h('div', null, h('div', { class: 'step-title' }, title), h('div', { class: 'step-desc' }, done[id] ? `Concluído ${relTime(done[id].at)}` : desc)));
    }));

    const controls = h('div', { class: 'row' },
      ['UNINITIALIZED', 'PREFLIGHT', 'ENVIRONMENT_AUDITED', 'PLAN_READY', 'RECOVERING', 'VERIFYING', 'PROVISIONING'].includes(b.state)
        ? btn(b.state === 'UNINITIALIZED' ? 'Começar' : 'Continuar', async () => { await api('bootstrapAdvance'); setTimeout(render, 300); }, { kind: 'primary', iconName: 'play', disabled: busy }) : null,
      b.state === 'PAUSED' ? btn('Retomar', async () => { await api('bootstrapResume'); render(); }, { iconName: 'play' })
        : !terminal ? btn('Pausar', async () => { await api('bootstrapPause'); render(); }, { kind: 'ghost', iconName: 'pause' }) : null,
      done['WP5-provision'] ? btn('Reverter integração', async () => {
        if (!await confirmDialog({ title: 'Reverter a integração Claude?', body: 'Remove apenas o que o CURI escreveu (skill e entrada MCP). Alterações feitas por si a esses ficheiros bloqueiam a remoção.', confirm: 'Reverter', danger: true })) return;
        const r = await api('bootstrapRollback'); toast(`Reversão: ${r.rollback.status}`, r.rollback.status === 'rolled_back' ? 'good' : 'bad'); render();
      }, { kind: 'ghost danger', iconName: 'undo' }) : null,
      !terminal && b.state !== 'UNINITIALIZED' ? btn('Cancelar', async () => { if (await confirmDialog({ title: 'Cancelar a configuração?', body: 'O progresso fica guardado; pode retomar mais tarde.', confirm: 'Cancelar configuração' })) { await api('bootstrapCancel'); render(); } }, { kind: 'ghost' }) : null);

    const sections = [];
    const pf = b.data?.preflight;
    if (pf) sections.push(panel({ title: 'O seu Mac', meta: relTime(pf.checked_at) }, kv([
      ['Sistema', `macOS ${pf.os.macos || pf.os.release} · ${pf.os.arch} · ${pf.disk_free_gb} GB livres`],
      ['Ferramentas', `Node ${pf.toolchain.node} · ${pf.toolchain.git || 'git ausente'} · Rust ${pf.toolchain.rust ? 'instalado' : 'ausente'}`],
      ['GitHub', pf.network.github ? status('ok', 'acessível') : status('unreachable')],
      ['Claude Code', pf.claude.binary ? `${pf.claude.version}${pf.claude.on_path ? '' : ' (embutido na app Claude)'}` : status('fail', 'não encontrado')],
      ['Ligação Claude', pf.claude.auth?.loggedIn === true ? status('ok', 'ligado') : h('span', null, status('blocked', 'não ligado'), ' ', h('a', { href: '#/connections', class: 'ext' }, 'Ligar Claude'))],
      ['Já instalado', `${b.data.inventory?.skills?.length ?? 0} skills · ${b.data.inventory?.mcp?.length ?? 0} servidores MCP · CLAUDE.md ${b.data.inventory?.claude_md?.exists ? 'existe (não será tocado)' : 'inexistente'}`]])));
    if (done['WP2-snapshot']) sections.push(panel({ title: 'Cópia de segurança', meta: `${done['WP2-snapshot'].evidence.files.filter(f => f.existed).length} ficheiros`, flush: true },
      h('div', { class: 'rows' }, done['WP2-snapshot'].evidence.files.map(f => h('div', { class: 'r' }, icon(f.existed ? 'check' : 'x', 'sm'), h('div', { class: 'grow' }, h('div', { class: 't1 mono' }, f.path), h('div', { class: 't2 mono' }, f.sha256 ? `sha256 ${f.sha256.slice(0, 24)}…` : 'não existia')))))));
    if (done['WP3-import']) { const e = done['WP3-import'].evidence; sections.push(panel({ title: 'Catálogo' }, h('div', { class: 'flow' },
      flowStep(fmtInt(e.occurrences), 'ocorrências de URL'), icon('chevron'), flowStep(fmtInt(e.unique_urls), 'URLs originais'), icon('chevron'), flowStep(fmtInt(e.after), 'recursos canónicos')),
      h('p', { class: 'muted', style: { margin: '12px 0 0' } }, `${e.created} criados agora · ${e.linked} avistamentos ligados · ${e.invalid} inválidos. Todos começam como catalogados, não verificados.`))); }

    if (b.state === 'APPROVAL_REQUIRED' && b.data.plan) {
      const p = b.data.plan;
      const pending = p.actions.filter(a => a.state !== 'already-applied');
      const toggles = pending.map(a => ({ a, input: h('input', { type: 'checkbox', role: 'switch', id: `ap-${a.id}` }) }));
      const nv = h('input', { type: 'checkbox', role: 'switch', id: 'ap-net' }), cs = h('input', { type: 'checkbox', role: 'switch', id: 'ap-cs' });
      const opt = (input, title, risk, kind, desc, detail) => h('label', { class: 'approval', for: input.id }, h('span', { class: 'switch' }, input, h('span')),
        h('div', { class: 'grow' }, h('div', { class: 'row' }, h('strong', null, title), badge(risk, kind)), h('div', { class: 'muted' }, desc), detail ? h('div', { class: 'mono path' }, detail) : null));
      sections.unshift(panel({ title: 'Rever e aprovar', meta: 'nada é escrito sem aprovação', cls: 'approvals' },
        h('div', { class: 'stack' },
          pending.length ? toggles.map(({ a, input }) => opt(input, a.id === 'skill.write' ? 'Instalar a skill curi-resource-router' : a.state === 'update' ? 'Atualizar a entrada MCP "curi"' : 'Registar o servidor MCP "curi"', a.risk, 'warn',
            a.id === 'skill.write' ? 'Uma skill compacta (≈2 KB) que ensina o Claude a consultar o registo.' : a.exposes || 'Servidor stdio só de leitura; arrancado pelo Claude Code quando precisar.', a.path || a.via)) : notice('info', 'A integração já está aplicada.'),
          p.conflicts.map(c => notice('bad', `Conflito (${c.action}): ${c.reason}`)),
          h('div', { class: 'micro', style: { marginTop: '8px' } }, 'Opcional'),
          opt(nv, 'Verificar fontes online', 'NETWORK_DISCOVERY', 'info', 'git ls-remote em até 40 repositórios. Sem quota da API, sem executar código.'),
          opt(cs, 'Testar com um pedido real ao Claude', 'COST_BEARING', 'warn', 'Faz um pedido ao Claude que usa a ferramenta curi, para provar a integração de ponta a ponta. Consome uso da sua conta; requer o Claude ligado.'),
          h('details', { class: 'untouched' }, h('summary', null, 'O que nunca é tocado'), h('ul', { class: 'plain' }, p.untouched.map(u => h('li', null, icon('lock', 'sm'), u)))),
          h('div', { class: 'row' }, h('span', { class: 'spacer' }), btn('Continuar com estas escolhas', async () => {
            await api('bootstrapAdvance', { decisions: { approve: toggles.filter(t => t.input.checked).map(t => t.a.id).concat(p.actions.filter(a => a.state === 'already-applied').map(a => a.id)), networkVerify: nv.checked, cleanSession: cs.checked } });
            toast('Aprovações registadas no registo de auditoria.', 'good');
            setTimeout(render, 300);
          }, { kind: 'primary', iconName: 'check' })))));
    }

    const ver = done['WP6-verify']?.evidence;
    if (ver) sections.unshift(panel({ title: 'Resultado', cls: `result ${ver.verdict}` },
      h('div', { class: 'result-hero' }, h('span', { class: `result-ic ${ver.verdict === 'READY' ? 'good' : ver.verdict === 'FAILED' ? 'bad' : 'warn'}` }, icon(ver.verdict === 'READY' ? 'check' : ver.verdict === 'FAILED' ? 'x' : 'alert', 'lg')),
        h('div', null, h('h3', null, ver.verdict === 'READY' ? 'Tudo verificado' : ver.verdict === 'PARTIAL_READY' ? 'Pronto, com limitações' : 'A verificação falhou'), h('p', { class: 'muted' }, `${ver.passed} de ${ver.total} verificações passaram.`))),
      h('div', { class: 'segmeter' }, Array.from({ length: ver.total }, (_, i) => h('i', { class: i < ver.passed ? 'pass' : 'fail' }))),
      ver.mandatory_failed?.length ? notice('bad', `Obrigatórias falhadas: ${ver.mandatory_failed.join(', ')}`) : null,
      [...(ver.optional_unavailable || []), ...(ver.missing || [])].length ? notice('warn', `Indisponível: ${[...(ver.optional_unavailable || []), ...(ver.missing || [])].join(' · ')}`) : null,
      h('div', { class: 'row', style: { marginTop: '12px' } }, linkBtn('Abrir o painel', '#/dashboard', { kind: 'primary', iconName: 'dashboard' }), linkBtn('Detalhes da verificação', '#/bridge', { kind: 'ghost' }))));

    // Consent and Claude connection are part of onboarding, but never block the catalogue.
    if (pol.consent.implicit) sections.unshift(panel({ title: 'Instalação automática e gestão do sistema', cls: 'consent' },
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'Escolha o que o CURI pode fazer sem lhe perguntar. Pode mudar ou revogar em Automação e permissões a qualquer momento.'),
      modePicker(pol, render),
      h('div', { class: 'row', style: { marginTop: '12px' } }, h('a', { class: 'btn ghost', href: '#/automation' }, 'Rever permissões em detalhe'), h('span', { class: 'spacer' }),
        btn('Continuar com aprovação manual', async () => { await api('policyGrant', { mode: 'standard' }); toast('Modo Padrão: aprova cada instalação.', 'good'); render(); }, { kind: 'ghost' }))));
    if (!['connected', 'verified', 'external_provider'].includes(cs.state)) sections.unshift(claudeCard(cs, render));
    if (!sections.length) sections.push(panel({}, h('div', { class: 'empty' }, h('div', { class: 'glyph' }, icon('wizard', 'lg')), h('h4', null, 'Pronto para começar'), h('p', null, 'O primeiro passo é só de leitura: inspeciona o seu Mac e o Claude Code. Pode pausar ou cancelar a qualquer momento — o progresso é guardado.'))));

    const log = jobs.filter(j => j.job === 'bootstrap').slice(0, 40);
    fill(root, 
      pageHead({ eyebrow: 'Configuração', title: terminal ? 'Configuração concluída' : 'Configuração guiada', sub: 'Cada passo grava um checkpoint durável. Pode fechar a app: ao reabrir, retoma no primeiro passo não verificado e nada é aplicado duas vezes.', actions: [status(b.state), controls] }),
      h('div', { class: 'wizard-grid' },
        h('aside', { class: 'panel wizard-steps' }, h('div', { class: 'panel-body' }, h('div', { class: 'row', style: { marginBottom: '14px' } }, h('span', { class: 'micro' }, 'Progresso'), h('span', { class: 'spacer' }), h('span', { class: 'num' }, `${doneCount}/${WPS.length} verificados`)), stepper)),
        h('div', { class: 'stack' }, ...sections,
          h('details', { class: 'panel log-panel' }, h('summary', { class: 'panel-head' }, h('h2', null, 'Registo de eventos'), h('span', { class: 'micro' }, `${log.length}`)),
            h('div', { class: 'panel-body' }, h('div', { class: 'log', role: 'log' }, log.map(j => h('div', { class: j.level }, h('span', { class: 'muted' }, fmtDate(j.ts)), ' ', j.step || '', ' — ', j.message))))))));
    if (lastState && lastState !== b.state && ['READY', 'PARTIAL_READY', 'FAILED'].includes(b.state)) api('notify', { title: 'CURI', body: `Configuração: ${b.state}` }).catch(() => {});
    lastState = b.state;
    return busy;
  }
  const busy = await render();
  setPoll(async () => render(), busy ? 1200 : 2000);
  return root;
}
const flowStep = (n, l) => h('div', { class: 'flow-step' }, h('div', { class: 'num flow-n' }, n), h('div', { class: 'micro' }, l));
