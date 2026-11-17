<img src="assets/logo.svg" width="48" align="right" alt="TRACE logo"/>

# Roadmap

What's next for TRACE.

**Where 0.3 stands.** TRACE is a plugin for Claude Code and Codex. A bare `/trace` picks a bounded set of scenarios from the request, the diff, the docs and the tests. It runs them with the agent's own tools or the local helper, and reports compact findings with evidence. Fixes are proven against frozen checks that must fail first. Web apps, HTTP APIs, Node CLIs and Node libraries are covered end to end. Desktop and mobile apps are reported as unsupported. See the [validation ledger](docs/VALIDATION.md) for what is and isn't tested.

---

## Now

**Qualify the Codex plugin end to end.** Install from `kg290/trace` with `codex plugin marketplace add`, trust the hook, run a bare `$trace:trace` on the demo, and record the result. Until then the Codex plugin is checked against its schema only.

**Ship the helper inside the plugin.** Plugin users install the helper by hand today. Next: start it lazily, so HTTP, CLI and library checks work with zero dependencies, and offer the Playwright browser as an opt-in download.

**Measure a real fix loop.** The same bug fixed with and without TRACE, on the same model, with several runs per arm. Record the user's turns, the agent's turns, the tokens and the time to a verified fix. No savings claim until those numbers exist.

---

## Next

- **Find more dev servers.** Discovery finds Vite apps today. Next: Next.js, Remix, Astro, plain Express, and `PORT=` conventions, still without scanning ports.
- **Python checks in the helper.** `pytest`-style library calls and `python -m` CLIs, with the same frozen-check and baseline rules as Node.
- **Responsive layout checks.** Run the same flow at phone and desktop widths and report clipped controls and overflow at each.
- **macOS in CI,** next to Windows and Ubuntu.
- **More hosts.** Cursor, OpenCode, Gemini CLI and GitHub Copilot, each only once it is actually tested.

---

## Later

- **Desktop and mobile** through real drivers your host already provides (for example a computer-use or device-automation tool), never a fake browser preview.
- **Authenticated apps** with a declared, synthetic test account and a clear permission boundary.
- **A shareable report.** One static page per run, with the finding, the before/after screenshots and the frozen criteria, for a PR or an issue.

---

Have an idea or a use case? [Open an issue](https://github.com/kg290/trace/issues).
