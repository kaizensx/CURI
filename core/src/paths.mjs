// Resolves every on-disk location CURI uses. All are overridable by env vars so tests and
// other users never touch the real profile unintentionally.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CORE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(CORE_ROOT, '..');

export function dataDir() {
  if (process.env.CURI_HOME) return process.env.CURI_HOME;
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'CURI');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'CURI');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'curi');
}

export function claudeHome() {
  return process.env.CURI_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// User-scope MCP registrations live in ~/.claude.json (outside ~/.claude) for the default profile.
export function claudeJsonPath() {
  if (process.env.CURI_CLAUDE_JSON) return process.env.CURI_CLAUDE_JSON;
  if (process.env.CLAUDE_CONFIG_DIR) return path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json');
  return path.join(os.homedir(), '.claude.json');
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  return p;
}

export const paths = {
  get db() { return path.join(ensureDir(dataDir()), 'curi.db'); },
  get backups() { return ensureDir(path.join(dataDir(), 'backups')); },
  get exports() { return ensureDir(path.join(dataDir(), 'exports')); },
  get logs() { return ensureDir(path.join(dataDir(), 'logs')); },
  get uiToken() { return path.join(ensureDir(dataDir()), 'ui-token'); },
  seedsDir: path.join(CORE_ROOT, 'data', 'seeds'),
  skillTemplateDir: path.join(REPO_ROOT, 'bridge', 'skill', 'curi-resource-router'),
  appDir: path.join(REPO_ROOT, 'app'),
  cliEntry: path.join(CORE_ROOT, 'bin', 'curi.mjs'),
};
