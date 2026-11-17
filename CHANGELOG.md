# 📝 Changelog

[← README](README.md) · [Validation](docs/VALIDATION.md)

All notable changes to TRACE. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] · 2026-11-17

**A plugin for Claude Code and Codex, and proof that a fix worked, not just a pass.**

### ✨ Added
- **Claude Code plugin** (`.claude-plugin/`) with its own marketplace: `/plugin marketplace add kg290/Trace`. Includes the skill, automatic checks (an `auto_check` setting in `/config`) and an icon.
- **Codex plugin** (`.codex-plugin/`) with a repo marketplace (`.agents/plugins/marketplace.json`): `codex plugin marketplace add kg290/Trace`. Includes the skill, the Stop hook, starter prompts, brand color, icon and logo.
- One cross-host hook (`hooks/hooks.json`) that works under bash, PowerShell and cmd. Turn it off with `TRACE_AUTO_CHECK=0` or `{"autoCheck": false}` in `.trace.json`.
- Plugin installs find the helper through `trace-local` on PATH when no `runtime.json` exists.
- **Automatic task-boundary checks** for Claude Code: `install.mjs --agent claude --auto-check`. It runs once per task that changed code, never twice in a row, and uninstall removes it.
- **Baseline-aware statuses.** `reproduced`, `verified fix`, `still failing`, `regression` and `could not reproduce`. A pass counts as a fix only after a failing baseline.
- **Fix history** on every result: run count and time from the failing baseline to the verified fix.
- **Before/after evidence.** Every `verify` run saves a masked screenshot, and failed checks record what was actually observed.
- **Layout measurements** from `inspect` and `run`: element boxes, controls clipped at the viewport edge, horizontal overflow.
- **Generated-file checks** for CLIs (`files`). A stale file can't pass.
- **Expected-error checks** for libraries (`throws`).

### 🔧 Changed
- `verify` replays the agent's flow exactly, `waitFor` included. It checks "after actions" before a trailing reload and runs HTTP checks last.
- Requests blocked to other sites mark a run `blocked` only when a check actually failed.
- `run` names the failed step and the reason.
- Evidence is stored in the per-user helper folder, no longer next to your project.
- Tests and scripts use the OS temp folder and clean up after themselves.

### 🐛 Fixed
- A library call that hangs is reported `incomplete`, not `blocked`.
- Terminal color codes no longer leak into stored error messages.

### 🗑️ Removed
- The in-page action recorder and recipe reconstruction (the flow is the reproduction).
- Unused approval exclusions and unchecked contract hashes.
- The animated demo GIF; the README uses real static screenshots instead.

## [0.2.0] · 2026-11-17

**Bare invocation, existing tools first.** `/trace` checks the current project and recent work. It needs no recording, bug description or arguments.

### ✨ Added
- Dependency-free, project-scoped installer for Codex and Claude Code, with owned-file checks and conservative removal.
- Confirmed host skill discovery, and the seeded save/reload bug reproduced through existing Chrome DevTools tools.
- Real screenshots, architecture diagrams, contributor and security guidance, and a pinned GitHub Actions workflow.

### 🔧 Changed
- Host browser, screenshot, terminal and test tools come first. Helper details moved into on-demand references.

### 🗑️ Removed
- The manual recorder and workbench, the copy-handoff flow, a duplicate fixture, the old PowerShell installer, and unused body/server-log/source-map capture.
- The `@jridgewell/trace-mapping` dependency.

> [!IMPORTANT]
> **Upgrading from 0.1:** the `record`, `review` and `handoff` commands are gone. Uninstall an unchanged 0.1 skill before installing 0.2. Existing schema-1 evidence stays readable and is not rewritten.

## [0.1.0] · local prototype

Bounded local browser evidence, HTTP and Node checks, frozen verification criteria, and the seeded persistence demo. A private prototype, not a public release.
