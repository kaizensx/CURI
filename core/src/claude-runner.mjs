// Bounded Claude Code job runner. Uses the user's own installed CLI and its normal auth; never
// bypasses permissions, never reads credentials. Output is validated before anything is stored.
import { spawn } from 'node:child_process';
import { findClaudeBinary, claudeAuthStatus } from './env.mjs';

export async function runClaudeJob({ prompt, allowedTools = [], timeoutMs = 180000, maxTurns = 4, cwd } = {}) {
  const bin = findClaudeBinary();
  if (!bin) return { status: 'BLOCKED', reason: 'Claude Code CLI not found.' };
  const auth = await claudeAuthStatus(bin);
  if (auth.loggedIn === false) return { status: 'BLOCKED', reason: 'Claude Code CLI isn\'t signed in (claude auth login). No job was run.', auth };
  const args = ['-p', prompt, '--output-format', 'json', '--max-turns', String(maxTurns)];
  if (allowedTools.length) args.push('--allowedTools', allowedTools.join(','));
  return new Promise(resolve => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', d => { out += d; if (out.length > 2e6) child.kill('SIGTERM'); });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      clearTimeout(timer);
      let parsed = null;
      try { parsed = JSON.parse(out); } catch {}
      if (code !== 0 || !parsed) return resolve({ status: 'FAILED', exitCode: code, reason: (err || out).slice(0, 600) });
      resolve({ status: parsed.is_error ? 'FAILED' : 'COMPLETED', result: parsed.result, cost_usd: parsed.total_cost_usd ?? null, num_turns: parsed.num_turns ?? null, session_id: parsed.session_id ?? null });
    });
  });
}
