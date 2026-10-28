// Static, non-executing scanner for skills / READMEs / MCP descriptions / hook configs.
// Content is treated as untrusted data; findings never grant or remove authority by themselves.

const RULES = [
  { id: 'prompt-injection', sev: 'high', rx: /\b(ignore|disregard|override)\b.{0,40}\b(previous|prior|above|all|system)\b.{0,40}\b(instructions?|rules?|prompts?|polic(y|ies))/i, msg: 'Tentativa de sobrepor instruções (prompt injection).' },
  { id: 'authority-claim', sev: 'medium', rx: /\b(as (the )?(system|administrator|anthropic)|this (message|instruction) (is|comes) from (anthropic|the system)|pre-?authori[sz]ed)\b/i, msg: 'Alegação de autoridade dentro de conteúdo externo.' },
  { id: 'permission-bypass', sev: 'high', rx: /(dangerously-skip-permissions|bypassPermissions|--no-verify|permission[s]?\s*[:=]\s*["']?allow-all)/i, msg: 'Desativa controlos de permissões.' },
  { id: 'pipe-to-shell', sev: 'high', rx: /(curl|wget)[^\n|]{0,200}\|\s*(sudo\s+)?(ba|z)?sh\b/i, msg: 'Executa script remoto diretamente (curl | sh).' },
  { id: 'encoded-exec', sev: 'high', rx: /(base64\s+(-d|--decode)[^\n]{0,80}\|\s*(ba)?sh|eval\s*\(\s*atob|python\d?\s+-c\s+["'][^"']*exec\()/i, msg: 'Execução de payload codificado.' },
  { id: 'destructive', sev: 'high', rx: /\brm\s+-rf\s+(\/|~|\$HOME)(\s|$)|\bmkfs\.|\bdd\s+if=.+of=\/dev\//i, msg: 'Comando destrutivo.' },
  { id: 'credential-access', sev: 'high', rx: /(~|\$HOME)\/\.(ssh|aws|gnupg|config\/gh)\b|\.aws\/credentials|security\s+find-(generic|internet)-password|keychain/i, msg: 'Acede a credenciais locais.' },
  { id: 'claude-config-write', sev: 'medium', rx: /(>{1,2}|tee|writeFile[^\n]{0,40})\s*[^\n]{0,40}(\.claude\/(settings|CLAUDE)|\.claude\.json)/i, msg: 'Escreve na configuração global do Claude.' },
  { id: 'exfil', sev: 'medium', rx: /(curl|wget|fetch|requests\.post)[^\n]{0,120}(-d\b|--data|POST)[^\n]{0,120}(env|token|secret|key|\$\w+)/i, msg: 'Possível exfiltração de dados por rede.' },
  { id: 'hooks', sev: 'low', rx: /"(PreToolUse|PostToolUse|SessionStart|UserPromptSubmit|Stop|Notification)"\s*:/, msg: 'Define hooks que executam automaticamente.' },
  { id: 'persistence', sev: 'medium', rx: /(launchctl\s+load|LaunchAgents|crontab\s+-|systemctl\s+enable|\.zshrc|\.bashrc)/i, msg: 'Mecanismo de persistência / alteração de shell.' },
  { id: 'hidden-unicode', sev: 'medium', rx: /[​-‏‪-‮⁦-⁩\u{E0000}-\u{E007F}]/u, msg: 'Caracteres invisíveis/bidi (possível instrução escondida).' },
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
