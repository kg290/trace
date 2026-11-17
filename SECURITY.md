# 🔐 Security policy

[← README](README.md) · [Privacy & permissions](docs/PRIVACY.md)

## Supported versions

| Version | Supported |
| --- | :---: |
| Latest `main` | ✅ |
| Older releases | ❌ |

TRACE is experimental. Fixes land on the current source. There is no long-term support branch and no guaranteed response time.

## 🚨 Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's **Report a vulnerability** button under this repository's **Security** tab. If that isn't available, contact the maintainer through a verified private channel.

Useful things to include:

- the TRACE version, host (Claude Code / Codex) and operating system,
- which integration is affected: browser, HTTP, CLI, library or installer,
- the smallest **synthetic** reproduction,
- what boundary you expected, and what actually happened.

Please don't include real secrets, live exploits against third parties, or personal data.

## In scope

- Secrets, cookies or private fields leaking into stored evidence or screenshots
- Path traversal or symlink escapes in the installer or evidence store
- Running code or making network requests without the matching permission flag
- Browser checks reaching origins other than the local app
- Frozen checks changed without being detected

## Known boundaries (not vulnerabilities)

- **Project code is not sandboxed.** Node checks run trusted project code with your permissions.
- **The skill follows instructions.** Its behavior depends on the model and on your host's tool permissions.
- **Masking is best effort.** It covers known private fields, not every possible personal detail in text or pixels.
- **Hashes are not signatures.** They detect changed checks but don't stop a malicious owner of the files.

Read [Privacy & permissions](docs/PRIVACY.md) before using TRACE on an application with sensitive data.
