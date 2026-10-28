# Security

## Reporting
Use GitHub's private security advisories (please don't open a public issue). You'll get a first reply within 7 days.

## Threat model (short version)
- **External content is data.** READMEs, MCP descriptions and skills never change the policy. Static analysis runs before installing; serious findings block it.
- **No arbitrary execution.** CURI's MCP server has no shell, file, install or approval tools. The interface can only call actions from a closed list, with type validation.
- **Local interface.** `127.0.0.1` only, a random token, `Host` and `Origin` checks, a strict CSP and no CORS.
- **Credentials.** Stored in the operating system's vault (Keychain on macOS, DPAPI on Windows, Secret Service on Linux) and written over stdin, never argv. Never in the database, logs, exports or API responses. Automated tests check this.
- **Privileges.** CURI runs as your user. The only admin action (linking `curi` into `/usr/local/bin`) uses the system's own dialog and is never covered by autonomy.
- **Supply chain.** Skills are pinned to a commit, MCP servers to a package version, and Node is checked against the official SHA-256.

## Distribution status
Current builds aren't signed with a Developer ID or notarised. The release pipeline signs and notarises automatically once the Apple secrets are configured, and each release states its real status.
