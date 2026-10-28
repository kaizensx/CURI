// Secret storage in the operating system's credential store: macOS Keychain (/usr/bin/security),
// Linux Secret Service (secret-tool / libsecret) and, on Windows, DPAPI-protected blobs bound to the
// user account. Secrets travel over stdin (never argv, so they never appear in `ps`) and are never
// written to the database, logs, exports or errors.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OS, which } from './platform.mjs';
import { dataDir, ensureDir } from './paths.mjs';

const pexec = promisify(execFile);
export const SERVICE = process.env.CURI_KEYCHAIN_SERVICE || 'app.curi.credentials';
const ACCOUNT_RX = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;

export const BACKEND = OS === 'macos' ? 'keychain' : OS === 'windows' ? 'dpapi' : 'secret-service';
export const available = () => OS === 'macos' || OS === 'windows' || Boolean(which('secret-tool'));

function feed(cmd, args, input, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', capture ? 'pipe' : 'ignore', 'pipe'], windowsHide: true });
    let out = '', err = '';
    if (capture) p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `exit ${code}`))));
    p.stdin.end(input);
  });
}
const dpapiFile = account => path.join(ensureDir(path.join(dataDir(), 'vault')), `${SERVICE}.${account.replace(/:/g, '_')}.dpapi`);
const PS = ['-NoProfile', '-NonInteractive', '-Command'];
const PS_PROTECT = "Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s),$null,'CurrentUser'); [Convert]::ToBase64String($b)";
const PS_UNPROTECT = "Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($s.Trim()),$null,'CurrentUser'); [Text.Encoding]::UTF8.GetString($b)";


function checkAccount(account) {
  if (!ACCOUNT_RX.test(account)) throw new Error('Identificador de credencial inválido.');
}

export function setSecret(account, secret) {
  checkAccount(account);
  if (!available()) return Promise.reject(new Error('Não há um cofre de credenciais disponível neste sistema (no Linux instale o libsecret: secret-tool).'));
  if (typeof secret !== 'string' || !secret.length || secret.length > 8192 || /[\r\n\0]/.test(secret)) return Promise.reject(new Error('Credencial vazia ou com caracteres inválidos.'));
  if (BACKEND === 'secret-service') return feed('secret-tool', ['store', '--label', `CURI — ${account}`, 'service', SERVICE, 'account', account], secret).then(() => true, () => { throw new Error('O Secret Service recusou guardar a credencial.'); });
  if (BACKEND === 'dpapi') return feed('powershell.exe', [...PS, PS_PROTECT], secret, { capture: true }).then(b64 => { fs.writeFileSync(dpapiFile(account), b64.trim(), { mode: 0o600 }); return true; });
  const esc = secret.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return new Promise((resolve, reject) => {
    const p = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => (code === 0 && !/error|could not/i.test(err) ? resolve(true) : reject(new Error('O Porta-chaves recusou guardar a credencial.'))));
    p.stdin.end(`add-generic-password -U -s "${SERVICE}" -a "${account}" -l "CURI — ${account}" -w "${esc}"\n`);
  });
}

export async function getSecret(account) {
  checkAccount(account);
  if (!available()) return null;
  if (BACKEND === 'secret-service') { try { const { stdout } = await pexec('secret-tool', ['lookup', 'service', SERVICE, 'account', account], { timeout: 10000 }); return stdout.replace(/\n$/, '') || null; } catch { return null; } }
  if (BACKEND === 'dpapi') { try { return (await feed('powershell.exe', [...PS, PS_UNPROTECT], fs.readFileSync(dpapiFile(account), 'utf8'), { capture: true })).replace(/\r?\n$/, ''); } catch { return null; } }
  try {
    const { stdout } = await pexec('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'], { timeout: 10000 });
    return stdout.replace(/\n$/, '');
  } catch { return null; }
}

export async function hasSecret(account) {
  checkAccount(account);
  if (!available()) return false;
  if (BACKEND !== 'keychain') return (BACKEND === 'dpapi' ? fs.existsSync(dpapiFile(account)) : Boolean(await getSecret(account)));
  try { await pexec('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', account], { timeout: 10000 }); return true; } catch { return false; }
}

export async function deleteSecret(account) {
  checkAccount(account);
  if (!available()) return false;
  if (BACKEND === 'dpapi') { try { fs.unlinkSync(dpapiFile(account)); return true; } catch { return false; } }
  if (BACKEND === 'secret-service') { try { await pexec('secret-tool', ['clear', 'service', SERVICE, 'account', account], { timeout: 10000 }); return true; } catch { return false; } }
  try { await pexec('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', account], { timeout: 10000 }); return true; } catch { return false; }
}
