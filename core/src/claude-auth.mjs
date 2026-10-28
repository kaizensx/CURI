// Claude Code connection state machine and a supervised, terminal-free wrapper around the official
// `claude auth login` flow (verified against Claude Code 2.1.309): the CLI opens the browser via the
// system handler, completes on a localhost callback, and falls back to a one-time code read on stdin.
// CURI never reads, stores or forwards Claude credentials.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findClaudeBinary, claudeAuthStatus } from './env.mjs';
import { now } from './db.mjs';
import { audit } from './audit-log.mjs';

const pexec = promisify(execFile);
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export const STATES = {
  not_installed: { title: 'O Claude Code não está instalado', action: 'install' },
  inaccessible: { title: 'O Claude Code não responde', action: 'repair' },
  disconnected: { title: 'O Claude Code não está ligado', action: 'connect' },
  connecting: { title: 'A aguardar a autorização no browser', action: 'cancel' },
  connected: { title: 'Claude Code ligado', action: 'verify' },
  verified: { title: 'Claude Code ligado e verificado', action: null },
  expired: { title: 'A sessão do Claude Code expirou', action: 'connect' },
  external_provider: { title: 'Autenticação gerida por outro fornecedor', action: null },
  no_model_access: { title: 'A conta não tem acesso ao modelo', action: 'connect' },
  offline: { title: 'Sem ligação à internet', action: 'retry' },
  failed: { title: 'A ligação falhou', action: 'connect' },
  cancelled: { title: 'Ligação cancelada', action: 'connect' },
};

let session = null; // the single supervised login process
let lastVerification = null; // { ok, at, classification, detail }

async function online() {
  try { const r = await fetch('https://api.anthropic.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) }); return r.status < 600; } catch { return false; }
}

// Classify a Claude CLI failure message into a state. Matching is on documented/observable text only.
export function classifyFailure(text) {
  const t = String(text || '').toLowerCase();
  if (/expired|token.*(invalid|revoked)|401|re-?authenticate|please run \/login|not logged in|invalid api key/.test(t)) return 'expired';
  if (/model.*(not available|not found|access)|403|permission|not have access|organization/.test(t)) return 'no_model_access';
  if (/enotfound|econnrefused|network|getaddrinfo|timed? ?out|offline/.test(t)) return 'offline';
  return 'failed';
}

export async function status() {
  const bin = findClaudeBinary();
  const base = { binary: bin, at: now(), login: session ? publicSession() : null, verification: lastVerification };
  if (!bin) return { ...base, state: 'not_installed', ...STATES.not_installed, detail: 'Nenhum executável "claude" encontrado no PATH, em ~/.local/bin nem na app Claude.' };
  let version;
  try { version = (await pexec(bin, ['--version'], { timeout: 10000 })).stdout.trim(); }
  catch (e) { return { ...base, state: 'inaccessible', ...STATES.inaccessible, detail: `O executável existe mas não arrancou: ${String(e.message).slice(0, 160)}` }; }
  if (session && session.state === 'connecting') return { ...base, version, state: 'connecting', ...STATES.connecting, detail: 'Aprove o acesso na página que abriu no browser. Esta janela atualiza-se sozinha.' };
  const auth = await claudeAuthStatus(bin);
  const info = { ...base, version, method: auth.authMethod, provider: auth.apiProvider };
  if (auth.apiProvider && auth.apiProvider !== 'firstParty') return { ...info, state: 'external_provider', ...STATES.external_provider, detail: `O Claude Code usa ${auth.apiProvider}; a autenticação é gerida pela configuração desse fornecedor.` };
  if (auth.loggedIn) {
    if (lastVerification && !lastVerification.ok) return { ...info, state: lastVerification.classification, ...STATES[lastVerification.classification], detail: lastVerification.detail };
    return lastVerification?.ok ? { ...info, state: 'verified', ...STATES.verified, detail: `Verificado ${lastVerification.at}.` } : { ...info, state: 'connected', ...STATES.connected, detail: 'Sessão ativa no Claude Code. Ainda não foi feito um pedido de verificação.' };
  }
  if (session && ['failed', 'cancelled'].includes(session.state)) return { ...info, state: session.state, ...STATES[session.state], detail: session.detail };
  if (!(await online())) return { ...info, state: 'offline', ...STATES.offline, detail: 'Não foi possível contactar api.anthropic.com. O catálogo continua a funcionar offline.' };
  return { ...info, state: 'disconnected', ...STATES.disconnected, detail: 'Ligue a sua conta Claude para o CURI poder verificar a integração numa sessão real. Sem ligação, o catálogo, a pesquisa e o radar continuam disponíveis.' };
}

function publicSession() {
  return { state: session.state, started_at: session.started_at, needs_code: session.needsCode, manual_url: session.manualUrl, detail: session.detail, mode: session.mode };
}

export function startLogin(db, { mode = 'claudeai', email } = {}) {
  const bin = findClaudeBinary();
  if (!bin) throw new Error('O Claude Code não está instalado.');
  if (session?.state === 'connecting') return publicSession();
  const args = ['auth', 'login'];
  if (mode === 'console') args.push('--console');
  if (mode === 'sso') args.push('--sso');
  if (email) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email inválido.'); args.push('--email', email); }
  const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
  session = { child, state: 'connecting', started_at: now(), needsCode: false, manualUrl: null, detail: 'Browser aberto para autorização.', mode, buf: '' };
  const onData = d => {
    session.buf += String(d);
    const url = session.buf.match(/https:\/\/claude\.com\/cai\/oauth\/authorize\?\S+/)?.[0] || session.buf.match(/https:\/\/\S*oauth\S*authorize\?\S+/)?.[0];
    if (url) session.manualUrl = url; // offered only as a fallback link; it carries a PKCE challenge, not a credential
    if (/paste code/i.test(session.buf)) session.needsCode = true;
  };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  const timer = setTimeout(() => { if (session?.child === child && session.state === 'connecting') { session.state = 'failed'; session.detail = 'Tempo esgotado (10 min) sem autorização. Pode tentar de novo.'; child.kill('SIGTERM'); } }, LOGIN_TIMEOUT_MS);
  child.on('close', async code => {
    clearTimeout(timer);
    if (session?.child !== child) return;
    if (session.state === 'cancelled') return;
    const auth = await claudeAuthStatus(bin);
    if (code === 0 && auth.loggedIn) { session.state = 'done'; session.detail = 'Ligado.'; lastVerification = null; audit(db, 'user', 'claude.login', null, { mode, method: auth.authMethod }); }
    else if (session.state === 'connecting') { session.state = 'failed'; session.detail = `O Claude Code terminou sem iniciar sessão (código ${code}). ${classifyFailure(session.buf) === 'offline' ? 'Verifique a ligação à internet.' : ''}`.trim(); audit(db, 'user', 'claude.login.failed', null, { code }); }
  });
  audit(db, 'user', 'claude.login.start', null, { mode });
  return publicSession();
}

// The fallback one-time authorization code is forwarded to the official CLI prompt, never stored.
export function submitCode(code) {
  if (!session || session.state !== 'connecting') throw new Error('Não há nenhum início de sessão em curso.');
  if (typeof code !== 'string' || !/^[A-Za-z0-9._#~-]{8,512}$/.test(code.trim())) throw new Error('Código com formato inválido.');
  session.child.stdin.write(code.trim() + '\n');
  return { submitted: true };
}

export function cancelLogin(db) {
  if (!session || session.state !== 'connecting') return { cancelled: false };
  session.state = 'cancelled'; session.detail = 'Cancelado por si. Nenhuma alteração foi feita.';
  session.child.kill('SIGTERM');
  audit(db, 'user', 'claude.login.cancel', null, null);
  return { cancelled: true };
}

export async function logout(db) {
  const bin = findClaudeBinary();
  if (!bin) throw new Error('O Claude Code não está instalado.');
  await pexec(bin, ['auth', 'logout'], { timeout: 20000 });
  lastVerification = null; session = null;
  audit(db, 'user', 'claude.logout', null, null);
  return status();
}

// Records the outcome of a real request through Claude Code (the clean-session check), which is the
// only way to tell "logged in" from "logged in and actually able to use the model".
export function recordVerification(result) {
  if (result.status === 'BLOCKED') return;
  const ok = result.status === 'COMPLETED' && result.ok !== false;
  lastVerification = { ok, at: now(), classification: ok ? 'verified' : classifyFailure(result.reason || result.result), detail: ok ? 'Pedido real concluído através do Claude Code.' : String(result.reason || result.result || '').slice(0, 300) };
}
