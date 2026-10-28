import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every test file gets its own CURI data dir and its own fake Claude profile.
export function sandbox(name, { realClaude = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `curi-${name}-`));
  process.env.CURI_HOME = path.join(root, 'curi');
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  process.env.CURI_KEYCHAIN_SERVICE = `app.curi.test.${name}`;
  process.env.CURI_LAUNCHAGENTS_DIR = path.join(root, 'LaunchAgents');
  process.env.CURI_AGENT_LABEL = `app.curi.test.${name}`;
  delete process.env.CURI_CLAUDE_HOME;
  delete process.env.CURI_CLAUDE_JSON;
  if (!realClaude) process.env.CURI_CLAUDE_BIN = path.join(root, 'no-claude-here');
  fs.mkdirSync(process.env.CURI_HOME, { recursive: true });
  fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
  return root;
}
