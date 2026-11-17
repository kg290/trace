<img src="../assets/logo.svg" width="48" align="right" alt="TRACE logo"/>

# Design decisions

[← README](../README.md) · [Architecture](ARCHITECTURE.md) · [Validation](VALIDATION.md)

Browser automation, screenshots, replay and assertions all exist already. TRACE's job is to put them to work for the agent you already use, so that **you** stop being the tester.

## Decisions and why

| Decision | Why |
| --- | --- |
| **A skill, not a new agent** | Your agent already understands the project and has tools. A second agent would duplicate that context and that cost. |
| **Host tools first** | A capable host shouldn't need a second browser install just to check a feature. |
| **A small, optional helper** | Exact local checks, bounded evidence and repeatable verification still help when the host lacks them. |
| **Screenshots plus behavior** | Pixels show the state. Responses, outputs and saved data prove the contract. |
| **Freeze checks before fixing** | A fix can't look verified by swapping a failing check for a weaker one. |
| **Failing baseline required** | A pass that never failed is "could not reproduce", not a fix. |
| **The flow is the reproduction** | Verify replays exactly what the agent ran, not a lossy reconstruction of it. |
| **Bounded scenarios** | Six meaningful checks can be reviewed. Unlimited exploration isn't coverage. |
| **Measure, don't promise** | Runs and time to a verified fix are recorded. No savings are claimed without data. |
| **Opt-in automation** | Checks at task boundaries run only when you install the hook, never mid-task. |

## Complexity removed

Version 0.2 removed:
- the manual recorder and its workbench UI,
- the copy-paste handoff flow,
- an old PowerShell installer,
- a duplicate fixture,
- unused source-map, server-log and body-capture code,
- one runtime dependency (`@jridgewell/trace-mapping`).

The next release also removes the in-page action recorder and recipe reconstruction, because verify now replays the flow itself. The build wipes `dist/` first, so deleted code can't ship.

The safety rails stayed: privacy filtering, frozen checks, persistence regressions and package lifecycle tests.

## References

- [Agent Skills specification](https://agentskills.io/specification): skill metadata and progressive references
- [Claude Code skills](https://code.claude.com/docs/en/skills): project skills and slash invocation
- [Claude Code hooks](https://code.claude.com/docs/en/hooks): the Stop hook used by `--auto-check`
- [Playwright](https://playwright.dev/docs/intro): browser automation, pinned in the lockfile
- [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp): a host browser integration used during validation
- [GitHub Mermaid support](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams): diagrams in these docs

## Not established yet

There is no competitor comparison, blind multi-project bug-finding evaluation, user-effort study or end-to-end token-savings measurement yet. The demo uses a known, seeded bug. The name TRACE is provisional.
