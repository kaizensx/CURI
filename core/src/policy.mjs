// Autonomy modes as an explicit operation-permission matrix, standing consent with revocation, and the
// pre-execution decision rules. A mode never overrides a failed technical check or native OS authorization.
import { now, getPref, setPref } from './db.mjs';
import { audit } from './audit-log.mjs';

export const POLICY_VERSION = 'curi-autonomy-1';
export const MODES = ['standard', 'automatic', 'maximum'];
export const MODE_LABEL = { standard: 'Padrão', automatic: 'Automático', maximum: 'Autonomia máxima' };

// category -> decision per mode: 'auto' (no app prompt), 'ask' (explicit approval per operation).
// Native administrator dialogs are always additionally required for 'privileged' work.
export const MATRIX = {
  observe:          { label: 'Verificar fontes, atualizar metadados, testar ligações e saúde', standard: 'auto', automatic: 'auto', maximum: 'auto' },
  curi_integration: { label: 'Instalar, reparar ou atualizar a skill e o MCP do próprio CURI', standard: 'ask', automatic: 'auto', maximum: 'auto' },
  runtime:          { label: 'Instalar ou atualizar o runtime do CURI (Node.js na pasta do CURI)', standard: 'ask', automatic: 'auto', maximum: 'auto' },
  cleanup:          { label: 'Limpar ficheiros temporários do CURI', standard: 'ask', automatic: 'auto', maximum: 'auto' },
  skill_trusted:    { label: 'Instalar skills de editores de confiança (commit fixo, análise limpa)', standard: 'ask', automatic: 'auto', maximum: 'auto' },
  mcp_trusted:      { label: 'Registar servidores MCP de editores de confiança', standard: 'ask', automatic: 'ask', maximum: 'auto' },
  package_trusted:  { label: 'Instalar ferramentas e apps de editores de confiança pelo gestor de pacotes (Homebrew, npm, uv, WinGet…)', standard: 'ask', automatic: 'auto', maximum: 'auto' },
  package_verified: { label: 'Instalar pacotes do catálogo cuja origem foi confirmada no registo oficial (npm, PyPI, Homebrew)', standard: 'ask', automatic: 'ask', maximum: 'auto' },
  plugin_trusted:   { label: 'Instalar plugins do Claude Code de editores de confiança', standard: 'ask', automatic: 'ask', maximum: 'auto' },
  project_change:   { label: 'Adicionar bibliotecas e componentes a um projeto seu (altera o package.json/pyproject)', standard: 'ask', automatic: 'ask', maximum: 'auto' },
  maintenance:      { label: 'Atualizar, reativar e reparar o que já está instalado', standard: 'ask', automatic: 'auto', maximum: 'auto' },
  background:       { label: 'Instalar o serviço de fundo do CURI (LaunchAgent do utilizador)', standard: 'ask', automatic: 'ask', maximum: 'auto' },
  untrusted:        { label: 'Instalar de editores desconhecidos', standard: 'ask', automatic: 'ask', maximum: 'ask' },
  destructive:      { label: 'Remover, desinstalar ou reverter', standard: 'ask', automatic: 'ask', maximum: 'ask' },
  privileged:       { label: 'Ações de administrador (com diálogo nativo do macOS)', standard: 'ask', automatic: 'ask', maximum: 'ask' },
  costly:           { label: 'Ações que consomem uso pago (pedidos a modelos)', standard: 'ask', automatic: 'ask', maximum: 'ask' },
};

export const DEFAULT_TRUSTED = ['anthropics', 'modelcontextprotocol', 'microsoft', 'chromedevtools', 'upstash', 'vercel-labs', 'expo', 'greensock', 'google', 'android', 'cloudflare'];

export function currentConsent(db) {
  const r = db.prepare('SELECT * FROM consent WHERE revoked_at IS NULL ORDER BY id DESC LIMIT 1').get();
  return r ? { ...r, scopes: JSON.parse(r.scopes) } : { mode: 'standard', scopes: {}, policy_version: POLICY_VERSION, granted_at: null, implicit: true };
}

export function trustedPublishers(db) { return getPref(db, 'trusted_publishers', DEFAULT_TRUSTED).map(x => x.toLowerCase()); }
export function setTrustedPublishers(db, list, actor = 'user') {
  const clean = [...new Set(list.map(x => String(x).trim().toLowerCase()).filter(x => /^[a-z0-9][a-z0-9-]{0,38}$/.test(x)))];
  setPref(db, 'trusted_publishers', clean);
  audit(db, actor, 'policy.trusted_publishers', null, { count: clean.length });
  return clean;
}

export function grantMode(db, mode, { actor = 'user' } = {}) {
  if (!MODES.includes(mode)) throw new Error('Modo inválido.');
  const ts = now();
  db.prepare('UPDATE consent SET revoked_at=? WHERE revoked_at IS NULL').run(ts);
  const scopes = Object.fromEntries(Object.entries(MATRIX).map(([k, v]) => [k, v[mode]]));
  db.prepare('INSERT INTO consent(mode,scopes,policy_version,granted_at,actor) VALUES (?,?,?,?,?)').run(mode, JSON.stringify(scopes), POLICY_VERSION, ts, actor);
  audit(db, actor, 'consent.grant', mode, { policy_version: POLICY_VERSION, auto: Object.keys(scopes).filter(k => scopes[k] === 'auto') });
  return currentConsent(db);
}

// Revocation drops to Standard immediately; callers re-evaluate queued work.
export function revoke(db, { actor = 'user' } = {}) {
  const ts = now();
  db.prepare('UPDATE consent SET revoked_at=? WHERE revoked_at IS NULL').run(ts);
  audit(db, actor, 'consent.revoke', null, null);
  return currentConsent(db);
}

// Pre-execution decision: covered by consent? source trusted? checks passed? scope unchanged?
export function evaluate(db, op) {
  const consent = currentConsent(db);
  const reasons = [];
  let category = op.category;
  const trustScoped = ['skill_trusted', 'mcp_trusted', 'package_trusted', 'plugin_trusted'];
  if (trustScoped.includes(category) && (!op.publisher || !trustedPublishers(db).includes(op.publisher.toLowerCase()))) {
    // A catalogued package whose registry entry points back at its repository keeps a verified provenance.
    category = category === 'package_trusted' && op.verifiedSource ? 'package_verified' : 'untrusted';
    reasons.push(op.publisher ? `Editor "${op.publisher}" não está na lista de confiança.` : 'Editor desconhecido.');
  }
  const rule = MATRIX[category];
  if (!rule) return { decision: 'block', category, reasons: [`Categoria desconhecida: ${category}`] };
  for (const c of op.checks || []) {
    if (c.ok === false) return { decision: 'block', category, reasons: [...reasons, `Verificação obrigatória falhou: ${c.name} — ${c.detail}`] };
  }
  if (op.requiresConnection && !op.connectionOk) return { decision: 'block', category, reasons: [...reasons, `Requer ligação a ${op.requiresConnection}.`] };
  if (op.scopeChanged) { reasons.push('As permissões pedidas mudaram desde a última aprovação.'); return { decision: 'ask', category, mode: consent.mode, reasons }; }
  const decision = rule[consent.mode] || 'ask';
  reasons.push(decision === 'auto' ? `Coberto pelo modo ${MODE_LABEL[consent.mode]} (${rule.label}).` : `O modo ${MODE_LABEL[consent.mode]} exige aprovação para: ${rule.label}.`);
  if (category === 'privileged') reasons.push('O macOS pedirá a palavra-passe de administrador.');
  return { decision, category, mode: consent.mode, reasons };
}
