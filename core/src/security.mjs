// Static, non-executing scanner for skills / READMEs / MCP descriptions / hook configs.
// Content is treated as untrusted data; findings never grant or remove authority by themselves.

const RULES = [
  { id: 'prompt-injection', sev: 'high', rx: /\b(ignore|disregard|override)\b.{0,40}\b(previous|prior|above|all|system)\b.{0,40}\b(instructions?|rules?|prompts?|polic(y|ies))/i, msg: 'Attempt to override instructions (prompt injection).' },
  { id: 'authority-claim', sev: 'medium', rx: /\b(as (the )?(system|administrator|anthropic)|this (message|instruction) (is|comes) from (anthropic|the system)|pre-?authori[sz]ed)\b/i, msg: 'Claims authority from inside external content.' },
  { id: 'permission-bypass', sev: 'high', rx: /(dangerously-skip-permissions|bypassPermissions|--no-verify|permission[s]?\s*[:=]\s*["']?allow-all)/i, msg: 'Turns off permission controls.' },
  { id: 'pipe-to-shell', sev: 'high', rx: /(curl|wget)[^\n|]{0,200}\|\s*(sudo\s+)?(ba|z)?sh\b/i, msg: 'Runs a remote script directly (curl | sh).' },
  { id: 'encoded-exec', sev: 'high', rx: /(base64\s+(-d|--decode)[^\n]{0,80}\|\s*(ba)?sh|eval\s*\(\s*atob|python\d?\s+-c\s+["'][^"']*exec\()/i, msg: 'Runs an encoded payload.' },
  { id: 'destructive', sev: 'high', rx: /\brm\s+-rf\s+(\/|~|\$HOME)(\s|$)|\bmkfs\.|\bdd\s+if=.+of=\/dev\//i, msg: 'Destructive command.' },
  { id: 'credential-access', sev: 'high', rx: /(~|\$HOME)\/\.(ssh|aws|gnupg|config\/gh)\b|\.aws\/credentials|security\s+find-(generic|internet)-password|keychain/i, msg: 'Reads local credentials.' },
  { id: 'claude-config-write', sev: 'medium', rx: /(>{1,2}|tee|writeFile[^\n]{0,40})\s*[^\n]{0,40}(\.claude\/(settings|CLAUDE)|\.claude\.json)/i, msg: 'Writes to Claude\'s global configuration.' },
  { id: 'exfil', sev: 'medium', rx: /(curl|wget|fetch|requests\.post)[^\n]{0,120}(-d\b|--data|POST)[^\n]{0,120}(env|token|secret|key|\$\w+)/i, msg: 'Possible data exfiltration over the network.' },
  { id: 'hooks', sev: 'low', rx: /"(PreToolUse|PostToolUse|SessionStart|UserPromptSubmit|Stop|Notification)"\s*:/, msg: 'Defines hooks that run automatically.' },
  { id: 'persistence', sev: 'medium', rx: /(launchctl\s+load|LaunchAgents|crontab\s+-|systemctl\s+enable|\.zshrc|\.bashrc)/i, msg: 'Persistence mechanism / shell profile change.' },
  { id: 'hidden-unicode', sev: 'medium', rx: /[​-‏‪-‮⁦-⁩\u{E0000}-\u{E007F}]/u, msg: 'Invisible/bidi characters (possible hidden instruction).' },
];

export function scanText(text, { source = 'unknown' } = {}) {
  const s = String(text || '');
  const findings = [];
  const lines = s.split('\n');
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      if (rule.rx.test(line)) findings.push({ rule: rule.id, severity: rule.sev, message: rule.msg, line: i + 1, excerpt: line.trim().slice(0, 160) });
    });
  }
  const summary = { high: 0, medium: 0, low: 0 };
  for (const f of findings) summary[f.severity]++;
  return { source, bytes: s.length, findings, summary, verdict: summary.high ? 'block' : summary.medium ? 'review' : 'pass', scanned_at: new Date().toISOString() };
}
