# Privacy

Everything CURI knows stays on your computer, in its data folder. There's no CURI account, no CURI server, no telemetry and no automatic crash reports.

## What leaves your computer, and when

| Destination | When | What's sent | Can you turn it off |
|---|---|---|---|
| `api.github.com`, `github.com`, `codeload.github.com`, `raw.githubusercontent.com` | Checking sources, Discover, inspecting a project, installing skills | Search terms and repository names; your token if you connected one | Don't use Discover; without a token you're anonymous |
| `registry.npmjs.org`, `pypi.org`, `crates.io`, `formulae.brew.sh` | Confirming that a package exists and belongs to the project | Package names | Yes (the starter catalogue's data ships with the app) |
| Package managers (Homebrew, npm, uv, WinGet…) | When you install, update or remove something | Whatever the manager normally asks its own registry | Yes |
| `api.github.com/user/starred` | When you ask CURI to read your stars, or you turn that task on | Your GitHub token | Yes |
| `api.anthropic.com` | Checking connectivity; testing your API key if you saved one | A HEAD request; `GET /v1/models` with the key | Yes |
| Claude (through Claude Code) | Only when you click "Verify with a real request" | A fixed test prompt; uses your account's quota | Yes (never automatic) |
| `api.openai.com`, `generativelanguage.googleapis.com` | Testing a key you saved | A model listing request | Yes |
| `nodejs.org` | Installing missing dependencies on first launch | Download requests | Yes (if Node and Claude Code are already there) |
| MCP servers you enable | When Claude uses them | Whatever that server sends, under its own policy | Disable the server |

## What CURI reads on your computer (never sent anywhere)
To recognise what you already have, detection reads (read-only):
- app and executable names, and package manager listings;
- each agent's MCP server, skill and plugin configuration: `~/.claude.json`, `~/.claude/skills`, `.mcp.json` in known projects, `claude plugin list`, `claude_desktop_config.json`, `~/.codex/config.toml` and `~/.codex/skills`, `~/.cursor/mcp.json`, `~/.gemini/settings.json`, Windsurf and VS Code;
- for claude.ai account skills, only the manifest Claude Desktop syncs (name, description, enabled).

Authentication files (`auth.json`, cookies, tokens) are never opened. The GitHub CLI session is reused only when you click "Reuse this session", through the official `gh auth token` command.

## What's never sent
Your projects' contents, your files, your Claude conversation history, or credentials to any service that didn't ask for them.

## Retention and removal
- Audit log and operations history: local; exportable from Settings.
- Removing a connection deletes the credential from the system vault (the key stays valid at the provider until you revoke it there).
- CURI opens at login, per user and without admin rights: a LaunchAgent on macOS (`~/Library/LaunchAgents/app.curi.desktop.plist`, which also brings CURI back if it crashes), the `Run` key under `HKEY_CURRENT_USER` on Windows, and `~/.config/autostart/curi.desktop` on Linux. Untick "Open at Login" in the menu bar or tray icon to remove it; "Quit CURI" there stops everything until you open it again. Notifications are your system's own, sent locally.
- CURI's data lives in `~/Library/Application Support/CURI` on macOS, `%APPDATA%\CURI` on Windows and `~/.local/share/curi` on Linux.
- Deleting CURI's data folder removes all of CURI's data; the Claude integration can be rolled back from Settings › Claude integration.

Consent for automatic installs (Autonomy) is separate from consent to spend money (model requests), which is always asked for.
