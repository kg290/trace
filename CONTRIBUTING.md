<img src="assets/logo.svg" width="48" align="right" alt="TRACE logo"/>

# 🤝 Contributing to TRACE

[← README](README.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md)

Thanks for helping. TRACE has one rule that shapes every change:

> **Check real behavior against a known expectation, keep the evidence, and re-check the same expectation after a fix.** If something can't be checked, say so. Never fake a pass.

## 🧭 Ways to help

| | |
| --- | --- |
| 🐛 **Report a wrong finding** | TRACE called something a bug that isn't, or missed one. [Open a bug report](.github/ISSUE_TEMPLATE/bug_report.md). |
| 🔌 **Add an integration** | A new runtime, host or driver. Read [Add an integration](docs/ARCHITECTURE.md#-adding-an-integration) first. |
| 📝 **Improve the docs** | Fix what confused you. That's often the most valuable PR. |

## 🛠️ Setup

You need the Node version in [`.node-version`](.node-version) (22.23+ or 24).

```sh
npm ci --ignore-scripts
npx playwright install chromium      # Linux: add --with-deps
npm run build
```

## ✅ Run the checks

| Command | What it covers |
| --- | --- |
| `npm run check` | TypeScript, including unused symbols |
| `npm test` | Unit and integration tests: installer, HTTP/CLI/library checks, statuses, auto-check hook |
| `npm run test:browser` | Browser tests: flows, verification, masking, origin blocking, failure handling |
| `npm run test:independent` | A Playwright test of the demo app that imports no TRACE code |
| `npm run docs:check` | Markdown links, code fences, demo assets, frozen demo criteria |
| `npm run pack:smoke` | Packs, installs and runs the helper from a clean folder |
| `claude plugin validate --strict .` | Claude Code plugin and marketplace manifests (needs the `claude` CLI) |

Plugin manifests live in `.claude-plugin/` and `.codex-plugin/`, and both point at the same `skills/` and `hooks/hooks.json`. Keep their `version` equal to `package.json`; `npm test` checks this. To try local changes, use `claude --plugin-dir .`, or add this folder as a Codex marketplace with `codex plugin marketplace add ./`.

Tests use synthetic data, bind only to `127.0.0.1`, need no model credentials, and clean up their temporary folders.

> [!TIP]
> Keeping browser downloads or the npm cache on another drive? Set `PLAYWRIGHT_BROWSERS_PATH` and `npm_config_cache` before installing. Use the same `npm_config_cache` for `pack:smoke`, because it installs offline.

## 📐 What makes a good change

- **Start from a concrete problem.** Describe what happened and what should happen.
- **Reuse before adding.** Prefer an existing tool, helper or dependency over a new driver, daemon or abstraction.
- **Keep the safety rails.** Input validation, path checks, permission flags and private-data filtering stay in place.
- **Fixes need a failing check first.** Reproduce the bug, then re-run the *same* check after the fix.
- **Add one focused test** for new behavior. Don't copy the implementation into the test.
- **Report gaps honestly.** Keep blocked or untested results separate from passes.

Changes often reach further than the file you edited: callers, fixtures, CLI help, installer ownership lists, skill references, package contents and docs. Search before you edit. `npm run build` wipes `dist/` first, so deleted modules can't sneak into a release.

## 🔀 Pull requests

The [PR template](.github/pull_request_template.md) asks for three things: the problem, how you validated it, and the evidence. Keep it proportional to the change.

Never commit evidence stores, absolute local paths, credentials or generated `runtime.json` files. Use synthetic or sanitized evidence only.

## 📦 Releases

The skill installs without dependencies. The optional helper is packed with `npm pack` and is not published to a registry. Before a release:

1. Run every check above.
2. Inspect the packed file list and confirm no private evidence is inside.
3. Update the [changelog](CHANGELOG.md) and record checksums.

Publishing is a separate maintainer action.
