// Operating-system integration layer. Everything OS-specific (where executables and apps live, which
// package managers exist and how they list/install/remove, which credential store is used) is decided
// here so the rest of CURI speaks one vocabulary. macOS is tested end to end; Windows and Linux paths
// are implemented from each platform's documented mechanisms and are marked as such in deviceInfo().
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
const HOME = os.homedir();
export const OS = process.env.CURI_FAKE_OS || (process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux');
export const OS_LABEL = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };
// Honest support level shown in the UI: only what has been exercised on real hardware is "tested".
export const SUPPORT = { macos: 'tested', windows: 'implemented-untested', linux: 'implemented-untested' };
const SEP = OS === 'windows' ? ';' : ':';

export function searchPath() {
  const extra = OS === 'windows'
    ? [path.join(process.env.APPDATA || '', 'npm'), path.join(HOME, 'scoop', 'shims'), path.join(HOME, '.cargo', 'bin'), path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps'), path.join(HOME, '.local', 'bin')]
    : ['/opt/homebrew/bin', '/usr/local/bin', '/home/linuxbrew/.linuxbrew/bin', path.join(HOME, '.local/bin'), path.join(HOME, '.cargo/bin'), path.join(HOME, '.bun/bin'), path.join(HOME, 'go/bin'), '/snap/bin', '/usr/bin', '/bin'];
  return [...new Set([...extra, ...(process.env.PATH || '').split(SEP)].filter(Boolean))];
}
export const childEnv = () => ({ ...process.env, PATH: searchPath().join(SEP) });

export async function run(cmd, args, timeout = 4000) {
  try { const r = await pexec(cmd, args, { timeout, maxBuffer: 16 << 20, env: childEnv(), windowsHide: true }); return (r.stdout || r.stderr || '').toString(); }
  catch (e) { return e.stdout ? String(e.stdout) + String(e.stderr || '') : null; }
}
export const versionOf = text => (text || '').match(/\bv?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)\b/)?.[1] || null;

const EXTS = OS === 'windows' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.PS1').toLowerCase().split(';').concat(['']) : [''];
export function which(name) {
  for (const d of searchPath()) for (const ext of EXTS) {
    const p = path.join(d, name + ext);
    try { if (OS !== 'windows') fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch {}
  }
  return null;
}

// ---------- installed applications ----------
async function macApps() {
  const out = new Map();
  for (const root of ['/Applications', path.join(HOME, 'Applications')]) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.endsWith('.app')) out.set(e.name.slice(0, -4), { path: path.join(root, e.name) });
      else if (e.isDirectory() && !e.name.startsWith('.')) {
        try { for (const s of fs.readdirSync(path.join(root, e.name))) if (s.endsWith('.app')) out.set(`${e.name}/${s.slice(0, -4)}`, { path: path.join(root, e.name, s) }); } catch {}
      }
    }
  }
  return out;
}
export async function appVersion(app) {
  if (app.version) return app.version;
  if (OS === 'macos' && app.path) { const v = await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(app.path, 'Contents/Info.plist')], 3000); return v ? v.trim() : null; }
  return null;
}
// Windows: the documented Uninstall registry keys (machine + user, 64/32-bit views).
async function windowsApps() {
  const out = new Map();
  const roots = ['HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'];
  for (const r of roots) {
    const t = await run('reg', ['query', r, '/s'], 20000);
    if (!t) continue;
    for (const block of t.split(/\r?\n\r?\n/)) {
      const name = block.match(/DisplayName\s+REG_SZ\s+(.+)/)?.[1]?.trim();
      if (!name) continue;
      out.set(name, { version: block.match(/DisplayVersion\s+REG_SZ\s+(.+)/)?.[1]?.trim() || null, path: block.match(/InstallLocation\s+REG_SZ\s+(.+)/)?.[1]?.trim() || null });
    }
  }
  return out;
}
// Linux: XDG desktop entries (system, user, Flatpak, Snap).
async function linuxApps() {
  const out = new Map();
  const dirs = ['/usr/share/applications', '/usr/local/share/applications', path.join(HOME, '.local/share/applications'), '/var/lib/flatpak/exports/share/applications', path.join(HOME, '.local/share/flatpak/exports/share/applications'), '/var/lib/snapd/desktop/applications'];
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(d).filter(f => f.endsWith('.desktop')); } catch { continue; }
    for (const f of files) {
      try {
        const t = fs.readFileSync(path.join(d, f), 'utf8');
        if (/^NoDisplay=true/m.test(t)) continue;
        const name = t.match(/^Name=(.+)$/m)?.[1]?.trim();
        if (name) out.set(name, { path: path.join(d, f), id: f.replace(/\.desktop$/, '') });
      } catch {}
    }
  }
  return out;
}
export const installedApps = () => (OS === 'macos' ? macApps() : OS === 'windows' ? windowsApps() : linuxApps());

// ---------- package managers ----------
// list(): Map name -> version. install/remove/upgrade(): argv for execFile (never a shell string).
const parseLines = t => new Map((t || '').split('\n').filter(Boolean).map(l => { const [n, ...v] = l.trim().split(/\s+/); return [n, v.at(-1) || null]; }));
export const MANAGERS = {
  brew: { label: 'Homebrew', os: ['macos', 'linux'], bin: 'brew',
    list: async b => parseLines(await run(b, ['list', '--formula', '--versions'], 30000)),
    install: (n, v) => ['install', n], remove: n => ['uninstall', n], upgrade: n => ['upgrade', n] },
  cask: { label: 'Homebrew Cask', os: ['macos'], bin: 'brew',
    list: async b => parseLines(await run(b, ['list', '--cask', '--versions'], 30000)),
    install: n => ['install', '--cask', n], remove: n => ['uninstall', '--cask', n], upgrade: n => ['upgrade', '--cask', n] },
  npm: { label: 'npm (global)', os: ['macos', 'linux', 'windows'], bin: 'npm',
    list: async b => { try { return new Map(Object.entries(JSON.parse(await run(b, ['ls', '-g', '--depth=0', '--json'], 30000)).dependencies || {}).map(([k, v]) => [k, v.version || null])); } catch { return new Map(); } },
    install: (n, v) => ['install', '-g', v ? `${n}@${v}` : n], remove: n => ['uninstall', '-g', n], upgrade: n => ['install', '-g', `${n}@latest`] },
  uv: { label: 'uv tool', os: ['macos', 'linux', 'windows'], bin: 'uv',
    list: async b => new Map(((await run(b, ['tool', 'list'], 20000)) || '').split('\n').filter(l => /^\S+ v\d/.test(l)).map(l => { const [n, v] = l.split(/\s+/); return [n.toLowerCase(), v.replace(/^v/, '')]; })),
    install: (n, v) => ['tool', 'install', v ? `${n}==${v}` : n], remove: n => ['tool', 'uninstall', n], upgrade: n => ['tool', 'upgrade', n] },
  pipx: { label: 'pipx', os: ['macos', 'linux', 'windows'], bin: 'pipx',
    list: async b => { try { return new Map(Object.entries(JSON.parse(await run(b, ['list', '--json'], 20000)).venvs || {}).map(([k, v]) => [k.toLowerCase(), v.metadata?.main_package?.package_version || null])); } catch { return new Map(); } },
    install: (n, v) => ['install', v ? `${n}==${v}` : n], remove: n => ['uninstall', n], upgrade: n => ['upgrade', n] },
  cargo: { label: 'Cargo', os: ['macos', 'linux', 'windows'], bin: 'cargo',
    list: async b => new Map(((await run(b, ['install', '--list'], 20000)) || '').split('\n').filter(l => /^\S+ v/.test(l)).map(l => { const m = l.match(/^(\S+) v([^:\s]+)/); return [m[1], m[2]]; })),
    install: (n, v) => ['install', '--locked', ...(v ? ['--version', v] : []), n], remove: n => ['uninstall', n], upgrade: n => ['install', '--locked', n] },
  winget: { label: 'WinGet', os: ['windows'], bin: 'winget',
    list: async b => new Map(((await run(b, ['list', '--accept-source-agreements', '--disable-interactivity'], 60000)) || '').split('\n').map(l => l.trim().split(/\s{2,}/)).filter(c => c.length >= 3).map(c => [c[1], c[2]])),
    install: n => ['install', '--id', n, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], remove: n => ['uninstall', '--id', n, '--exact', '--silent', '--disable-interactivity'], upgrade: n => ['upgrade', '--id', n, '--exact', '--silent', '--disable-interactivity'] },
  scoop: { label: 'Scoop', os: ['windows'], bin: 'scoop',
    list: async b => new Map(((await run(b, ['list'], 30000)) || '').split('\n').map(l => l.trim().split(/\s+/)).filter(c => c.length >= 2 && !/^(Name|----|Installed)/.test(c[0])).map(c => [c[0], c[1]])),
    install: n => ['install', n], remove: n => ['uninstall', n], upgrade: n => ['update', n] },
  flatpak: { label: 'Flatpak', os: ['linux'], bin: 'flatpak',
    list: async b => new Map(((await run(b, ['list', '--app', '--columns=application,version'], 30000)) || '').split('\n').filter(Boolean).map(l => l.split('\t'))),
    install: n => ['install', '--user', '-y', 'flathub', n], remove: n => ['uninstall', '--user', '-y', n], upgrade: n => ['update', '--user', '-y', n] },
};
// System package managers that need root are detected for inventory only; CURI never runs them unattended.
export const SYSTEM_MANAGERS = { apt: 'dpkg-query', dnf: 'rpm', pacman: 'pacman', snap: 'snap', choco: 'choco' };

export async function packageManagers() {
  const out = {};
  for (const [k, m] of Object.entries(MANAGERS)) {
    if (!m.os.includes(OS)) continue;
    const b = which(m.bin);
    out[k] = b ? { available: true, path: b, label: m.label } : { available: false, label: m.label };
  }
  for (const [k, b] of Object.entries(SYSTEM_MANAGERS)) if (which(b)) out[k] = { available: true, path: which(b), label: k, system: true };
  return out;
}

// Python: pip listings per interpreter (for libraries/tools installed with pip outside pipx/uv).
export async function pythonPackages() {
  const pkgs = new Map(), pythons = [];
  const cands = OS === 'windows' ? ['py', 'python'] : ['python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'];
  const seen = new Set();
  for (const c of cands) {
    const p = c.includes('/') ? (fs.existsSync(c) ? fs.realpathSync(c) : null) : which(c);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const t = await run(p, ['-m', 'pip', 'list', '--format', 'json', '--disable-pip-version-check'], 20000);
    let list;
    try { list = JSON.parse(t); } catch { continue; }
    pythons.push({ python: p, packages: list.length });
    for (const x of list) if (!pkgs.has(x.name.toLowerCase())) pkgs.set(x.name.toLowerCase(), { version: x.version, python: p });
  }
  return { pythons, pkgs };
}

export function deviceInfo() {
  return { os: OS, label: OS_LABEL[OS], support: SUPPORT[OS], arch: os.arch(), release: os.release(), credential_store: OS === 'macos' ? 'Keychain do macOS' : OS === 'windows' ? 'Gestor de Credenciais do Windows' : 'Secret Service (libsecret)' };
}

// Open a URL in the default browser / reveal a file in the OS file manager (no shell interpolation).
export function openExternal(target, { reveal = false } = {}) {
  const [cmd, args] = OS === 'macos' ? ['open', reveal ? ['-R', target] : [target]]
    : OS === 'windows' ? (reveal ? ['explorer.exe', [`/select,${target}`]] : ['rundll32.exe', ['url.dll,FileProtocolHandler', target]])
    : ['xdg-open', [reveal ? path.dirname(target) : target]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}
