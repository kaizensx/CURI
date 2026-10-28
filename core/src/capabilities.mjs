// Capabilities as people understand them: what an agent on this device can do today, what one
// action away would add, and where nothing exists yet. Also the decision-oriented comparison.
import fs from 'node:fs';
import path from 'node:path';
import { CORE_ROOT } from './paths.mjs';
import { CAPABILITIES, detectCapabilities } from './taxonomy.mjs';
import { profileFor, deviceContext, getFacts } from './facts.mjs';
import { presenceOf, summarizeFacts } from './actions.mjs';
import { trustedPublishers } from './policy.mjs';

let COPY = null;
export function copy() {
  if (!COPY) COPY = JSON.parse(fs.readFileSync(path.join(CORE_ROOT, 'data', 'capability-copy.json'), 'utf8'));
  return COPY;
}
export const capLabel = id => copy().capabilities[id]?.[0] || CAPABILITIES.find(c => c.id === id)?.label || id;

const USABLE = new Set(['mcp', 'plugin', 'skill', 'skill-pack', 'cli', 'app']);
const KIND_RANK = { plugin: 0, mcp: 1, 'skill-pack': 2, skill: 2, cli: 3, app: 4, components: 5, library: 6, framework: 6, reference: 9 };

function providerState(db, id, ctx) {
  const prof = profileFor(db, id, ctx);
  const pres = presenceOf(db, id);
  const f = getFacts(db, id);
  return { id, kind: prof.kind, kind_label: prof.kind_label, state: pres.state, where: [...new Set(pres.found.map(x => x.agent_label || (x.type === 'app' ? 'Aplicação' : x.type)))],
    ready: prof.options.some(o => o.ready), installable: prof.installable, stars: f?.stars ?? null, pushed_at: f?.pushed_at ?? null, archived: Boolean(f?.archived) };
}

export function capabilityMap(db) {
  const ctx = deviceContext(db);
  const rows = db.prepare(`SELECT rc.capability_id cap, r.id, r.name, r.status, r.description FROM resource_capabilities rc JOIN resources r ON r.id=rc.resource_id WHERE r.status NOT IN ('REJECTED','DEPRECATED')`).all();
  const byCap = new Map();
  const cache = new Map();
  for (const r of rows) {
    if (!cache.has(r.id)) cache.set(r.id, { ...providerState(db, r.id, ctx), name: r.name, description: r.description });
    const l = byCap.get(r.cap) || [];
    l.push(cache.get(r.id));
    byCap.set(r.cap, l);
  }
  const C = copy();
  const caps = CAPABILITIES.map(c => {
    const providers = (byCap.get(c.id) || []).sort((a, b) => ((b.state ? 1 : 0) - (a.state ? 1 : 0)) || ((KIND_RANK[a.kind] ?? 7) - (KIND_RANK[b.kind] ?? 7)) || ((b.stars || 0) - (a.stars || 0)));
    const present = providers.filter(p => p.state && (USABLE.has(p.kind) || p.state === 'account'));
    const obtainable = providers.filter(p => !p.state && p.ready && USABLE.has(p.kind) && !p.archived);
    const projectOnly = providers.filter(p => ['library', 'framework', 'components'].includes(p.kind));
    const [label, mode, can] = C.capabilities[c.id] || [c.label, 'build', c.label];
    const status = present.length ? 'ready' : obtainable.length ? 'one-step' : projectOnly.length ? 'project' : providers.length ? 'reference' : 'gap';
    return { id: c.id, domain: c.domain, label, can, mode, status, providers: providers.slice(0, 12), present: present.map(p => p.id), recommended: obtainable[0] || null, counts: { total: providers.length, present: present.length, obtainable: obtainable.length } };
  });
  const domains = Object.entries(C.domains).map(([id, [label, sub]]) => {
    const list = caps.filter(c => c.domain === id);
    return { id, label, sub, total: list.length, ready: list.filter(c => c.status === 'ready').length, one_step: list.filter(c => c.status === 'one-step').length, agent: list.filter(c => c.mode === 'agent').length };
  }).filter(d => d.total);
  const agentCaps = caps.filter(c => c.mode === 'agent');
  return {
    summary: { agent_total: agentCaps.length, agent_ready: agentCaps.filter(c => c.status === 'ready').length, agent_one_step: agentCaps.filter(c => c.status === 'one-step').length, gaps: caps.filter(c => c.status === 'gap').map(c => c.id) },
    domains, capabilities: caps,
    // Strongest next steps: agent capabilities missing here that one trusted action would add.
    recommendations: agentCaps.filter(c => c.status === 'one-step' && c.recommended).map(c => ({ capability: c.id, label: c.label, can: c.can, resource: c.recommended }))
      .sort((a, b) => ((KIND_RANK[a.resource.kind] ?? 7) - (KIND_RANK[b.resource.kind] ?? 7)) || ((b.resource.stars || 0) - (a.resource.stars || 0))).slice(0, 8),
  };
}

// ---------- decision-oriented comparison ----------
const days = iso => (iso ? Math.round((Date.now() - new Date(iso)) / 864e5) : null);
export function compareDecision(db, ids, { useCase = '' } = {}) {
  const ctx = deviceContext(db);
  const trusted = new Set(trustedPublishers(db));
  const want = useCase ? new Set(detectCapabilities(useCase).map(c => c.id)) : null;
  const items = ids.map(id => {
    const r = db.prepare('SELECT * FROM resources WHERE id=?').get(id);
    if (!r) return null;
    const prof = profileFor(db, id, ctx);
    const pres = presenceOf(db, id);
    const facts = summarizeFacts(getFacts(db, id));
    const caps = db.prepare('SELECT capability_id FROM resource_capabilities WHERE resource_id=?').all(id).map(x => x.capability_id);
    const best = prof.options.find(o => o.supported_here) || null;
    const steps = [];
    if (best?.missing?.length) steps.push(`Instalar primeiro: ${best.missing.join(', ')}`);
    if (best?.secrets?.length) steps.push(`Guardar chave: ${best.secrets.join(', ')}`);
    if (best?.auth === 'oauth') steps.push('Autenticar no Claude Code (/mcp)');
    for (const s of best?.setup || []) steps.push(s);
    const install = pres.state ? { level: 'present', text: 'Já está neste dispositivo' }
      : !prof.installable ? { level: ['library', 'framework', 'components'].includes(prof.kind) ? 'project' : 'none', text: ['library', 'framework', 'components'].includes(prof.kind) ? 'Instala-se em cada projeto' : 'Não se instala (referência)' }
      : !best ? { level: 'unsupported', text: 'Sem método de instalação para este sistema' }
      : steps.length ? { level: 'steps', text: `Um clique + ${steps.length} passo(s)` } : { level: 'one-click', text: 'Um clique' };
    const deps = [...new Set([...(best?.requires || []), ...(facts?.engines?.node ? [`Node ${facts.engines.node}`] : []), ...(facts?.requires_python ? [`Python ${facts.requires_python}`] : [])])];
    const owner = r.gh_full_name?.split('/')[0];
    const security = [];
    if (best?.method === 'mcp' && best.transport !== 'stdio') security.push('Servidor remoto: os pedidos saem do dispositivo');
    if (best?.method === 'mcp' && best.transport === 'stdio') security.push('Corre localmente com as permissões do utilizador');
    if (best?.method === 'package') security.push(`Instala-se pelo ${best.manager === 'cask' ? 'Homebrew Cask' : best.manager}; corre com as permissões do utilizador`);
    if (best?.method === 'skill' && best.has_scripts) security.push('A skill inclui scripts (revisão antes de instalar)');
    if (prof.kind === 'plugin') security.push('Plugins podem incluir hooks e servidores MCP');
    if (r.paid_auth) security.push(`Conta/pagamento: ${r.paid_auth}`);
    if (prof.secrets.length) security.push(`Precisa de chave: ${prof.secrets.join(', ')}`);
    if (r.risk_notes) security.push(r.risk_notes);
    const pushedDays = days(facts?.pushed_at);
    return {
      id, name: r.name, kind: prof.kind, kind_label: prof.kind_label, description: r.description || facts?.description || null, agent_use: prof.agent_use,
      capabilities: caps.map(c => ({ id: c, label: capLabel(c) })),
      matches_use_case: want ? caps.filter(c => want.has(c)).map(capLabel) : null,
      presence: { state: pres.state, where: [...new Set(pres.found.map(f => f.agent_label || f.type))] },
      install, install_method: best ? best.label || best.method : null, steps, deps,
      security, publisher: owner ? { name: owner, trusted: trusted.has(owner.toLowerCase()) } : null,
      maintenance: facts ? { stars: facts.stars, pushed_days: pushedDays, archived: facts.archived, release: facts.latest_release?.tag || null, state: facts.archived ? 'Arquivado' : pushedDays == null ? '—' : pushedDays < 30 ? 'Ativo' : pushedDays < 180 ? 'Regular' : pushedDays < 365 ? 'Lento' : 'Parado' } : null,
      license: facts?.license || r.license || 'desconhecida', platforms: [...new Set(prof.options.flatMap(o => o.os || ['macos', 'windows', 'linux']))],
      use_when: r.use_when || null, avoid_when: r.avoid_when || null,
    };
  }).filter(Boolean);
  // Distinctions: capabilities only some of them have.
  const all = new Map();
  for (const it of items) for (const c of it.capabilities) all.set(c.id, (all.get(c.id) || 0) + 1);
  for (const it of items) { it.unique = it.capabilities.filter(c => all.get(c.id) === 1).map(c => c.label); it.shared = it.capabilities.filter(c => all.get(c.id) === items.length).map(c => c.label); }
  // Guidance is a set of situational statements, never a total score.
  const guidance = [];
  const present = items.filter(i => i.presence.state);
  if (present.length && present.length < items.length) guidance.push({ text: `${present.map(i => i.name).join(' e ')} já ${present.length > 1 ? 'estão' : 'está'} neste dispositivo — não precisa de instalar nada para começar.`, ids: present.map(i => i.id) });
  const direct = items.filter(i => ['mcp', 'plugin', 'skill', 'skill-pack'].includes(i.kind));
  if (direct.length && direct.length < items.length) guidance.push({ text: `Para o agente usar diretamente, ${direct.map(i => i.name).join(' / ')} ${direct.length > 1 ? 'integram-se' : 'integra-se'} no Claude Code sem código.`, ids: direct.map(i => i.id) });
  const easy = items.filter(i => i.install.level === 'one-click');
  if (easy.length && easy.length < items.length) guidance.push({ text: `Instalação mais simples: ${easy.map(i => i.name).join(', ')} (um clique, sem passos manuais).`, ids: easy.map(i => i.id) });
  const stale = items.filter(i => ['Parado', 'Arquivado'].includes(i.maintenance?.state));
  if (stale.length) guidance.push({ text: `${stale.map(i => i.name).join(', ')}: sem atividade recente — prefira ${stale.length > 1 ? 'estes' : 'este'} só se precisar de algo específico.`, ids: stale.map(i => i.id), tone: 'warn' });
  if (want?.size) {
    const covering = items.filter(i => i.matches_use_case?.length);
    const same = covering.length === items.length && covering.every(i => i.matches_use_case.join() === covering[0].matches_use_case.join());
    if (same) guidance.push({ text: `Para "${useCase.slice(0, 80)}" todos servem (${covering[0].matches_use_case.join(', ')}); decida pelas diferenças abaixo.`, ids: covering.map(i => i.id) });
    else for (const it of covering) guidance.push({ text: `Para "${useCase.slice(0, 80)}": ${it.name} cobre ${it.matches_use_case.join(', ')}.`, ids: [it.id] });
    const none = items.filter(i => !i.matches_use_case?.length);
    if (none.length && none.length < items.length) guidance.push({ text: `${none.map(i => i.name).join(', ')} não ${none.length > 1 ? 'cobrem' : 'cobre'} diretamente esse caso.`, ids: none.map(i => i.id), tone: 'warn' });
  }
  for (const it of items) if (it.unique.length) guidance.push({ text: `Só ${it.name}: ${it.unique.slice(0, 4).join(', ')}.`, ids: [it.id] });
  return { items, guidance, use_case: useCase || null };
}
