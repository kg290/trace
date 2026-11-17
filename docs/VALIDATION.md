<img src="../assets/logo.svg" width="48" align="right" alt="TRACE logo"/>

# Validation ledger

[← README](../README.md) · [Demo](DEMO.md) · [Contributing](../CONTRIBUTING.md)

What has actually been tested, and what hasn't. Results describe the surfaces listed here; they never mean "bug-free".

**Environment:** Windows · Node **22.23.3** · Playwright **1.65.1** · Claude Code **2.1.318** · Codex **0.169.0-alpha.11.1** · tested **2026-11-17**

## Automated checks: 22 passing

| Suite | Result | Covers |
| --- | :---: | --- |
| Unit & integration | **14 / 14** | Discovery boundaries, exact HTTP/CLI/library contracts, expected library errors, generated CLI files (stale files rejected), baseline-aware statuses, UTF-8 chunking, long comparisons, installer ownership, auto-check hook and its opt-outs, plugin manifests agree across hosts |
| Browser | **7 / 7** | Reproduce → fix → verified, never-failing baseline = could not reproduce, check order and observed values, named failing step, layout measurements, origin blocking, network classification, masking, lifecycle failures, frozen criteria |
| Independent regression | **1 / 1** | The demo app's contract, tested with plain Playwright and no TRACE code |

## Distribution & tooling

| Check | Result | What it shows |
| --- | :---: | --- |
| TypeScript build & unused-symbol check | ✅ | Source, callers, tests and fixtures compile |
| Standalone installer | ✅ | Both host skill folders work without `node_modules` or `dist`, and no user file is overwritten |
| Packed helper (`pack:smoke`) | ✅ | Clean install from the packed tarball; screenshots, verification, library probe, revoke/delete, owned removal |
| Docs check | ✅ | Every local Markdown link resolves, code fences balance, demo assets and frozen demo criteria are unchanged |
| Skill metadata | ✅ | Valid skill frontmatter (not a test of model behavior) |
| Claude Code plugin | ✅ `claude plugin validate --strict` | Plugin and marketplace manifests load, every path exists (Claude Code 2.1.318) |
| Plugin Stop hook | ✅ bash · PowerShell | The same hook command asks once after a change, then stays silent; `TRACE_AUTO_CHECK=0` turns it off |
| Codex plugin | ⚠️ Manifest only | Matches the Codex app-server schema and documented format; not yet installed end to end through `codex plugin marketplace add` |
| Dependency audit | ✅ 0 advisories | npm advisory database at test time, not a full security audit |

## Host qualification

| Host | Result |
| --- | --- |
| **Claude Code** | `/trace` is listed with no required arguments |
| **Codex** | `trace` is listed as enabled by `skills/list` |
| **Host browser** (Chrome DevTools tools) | Reproduced the seeded bug and verified the fix with unchanged criteria, without TRACE's helper |

Neither discovery probe started a model turn. Two notes from testing:
- Codex only discovers the skill when it is installed at the project root you actually open.
- Claude Code's `--bare` mode doesn't list project skills; normal sessions do.

**Not qualified:** how every model responds to a bare invocation, every desktop picker's `@` syntax, and every host/model combination.

## Fix verification

The demo froze its four checks before switching from the broken client to the working one, on the same origin with the same data file. Screenshots, response statuses, visible values, API state and an unchanged criteria hash back the result. See the [demo](DEMO.md) and the [portable result](native-validation.json).

The helper enforces the same rules in code. It rejects a changed hash, a changed origin or a missing permission. It requires a failing baseline before reporting a verified fix, and it treats expected error responses as valid outcomes.

## Resource usage

The installer makes no model calls and downloads nothing. `npm run measure` records synthetic action time, CPU and memory samples, and event and image bytes. It measures capture overhead, not debugging productivity.

There is **no** complete token or cost accounting and **no** user-effort comparison yet, so no savings are claimed. Each helper result records the number of runs and the time from the failing baseline to the verified fix, which gives real per-fix numbers to build on.

## Not yet qualified

- macOS, and Linux until a hosted CI run
- Native desktop and mobile drivers
- Authenticated production applications
- Non-Node runtimes through the helper
- Isolation from malicious project code
- Complete privacy filtering
- Blind bug discovery across many projects

Unsupported environments are reported as **unsupported**, never as passes.

## Reproduce

Run the commands in [CONTRIBUTING.md](../CONTRIBUTING.md#run-the-checks). Machine-specific output goes to the git-ignored `.test-output/`.

## Prompt hook compatibility

Two fresh Windows CLI sessions received the same request in separate copies of a one-file Node project: “Fix total so that an empty list returns zero and the sum of 2 and 3 remains 5. Check both cases.” The prompt did not mention TRACE. Claude Code loaded the working-tree plugin from a local directory. Codex loaded the same plugin from a local marketplace with hook trust scoped to the test process.

| Host | Receipt frozen (UTC, 2026-11-17) | First source edit (UTC) | Result after the edit |
| --- | --- | --- | --- |
| Claude Code 2.1.318 | 20:04:12.106 | 20:04:15.283 | Observed 0 and 5 and read the original receipt |
| Codex CLI 0.169.0-alpha.11.1 | 20:09:41.737 | 20:09:59.397 | Asserted 0 and 5 and read the original receipt |

Each transcript shows the freeze returning before the first edit to `total.mjs`. The final successful read used the same task ID and SHA-256 digest as that session’s freeze. The stored receipt bytes independently matched those digests:

- Claude Code: `864d71bde5bda7f2baf9894e0326231ed0fa1045a7e8ea0d1dbb5b95ce73c32f`
- Codex: `1f507afdf6ed496d5898ca5188959aaf40a303b53782cf799dd7d735880b4332`

The first Claude trial exposed a blocked stdin pipeline. The successful trials used the direct argument form of `freeze`. Codex’s alternate shell needed the same custom `TRACE_HOME` as the hook and retried successfully before editing. With a custom store, configure that environment variable consistently across tools.

These trials cover one task per host with hooks enabled. The prompt hook asks the agent to freeze before editing. It does not intercept every file write.
