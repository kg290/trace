<img src="../assets/logo.svg" width="48" align="right" alt="TRACE logo"/>

# Helper CLI

[← README](../README.md) · [Browser flows](../skills/trace/references/helper.md) · [Nonvisual checks](../skills/trace/references/checks.md)

> [!NOTE]
> **Most people never type these commands.** Your agent runs them for you when its own tools aren't enough. This page is for contributors, and for anyone curious what happens under the hood. The helper contains no LLM and never decides on its own what "correct" means.

## Setup

```sh
npm ci --ignore-scripts
npx playwright install chromium    # only needed for browser checks
npm run build
node dist/cli.js --help
```

Then install (or reinstall) the skill so that `runtime.json` points at this helper:

```sh
node install.mjs --project /path/to/project
```

If you move or delete this checkout, reinstall from the new location. HTTP, CLI and library checks need no browser download.

**Using the plugin?** Plugin installs have no `runtime.json`, so the skill looks for `trace-local` on your PATH instead. Install the packed helper globally:

```sh
npm pack
npm install -g ./trace-local-experiment-0.3.0.tgz --omit=dev --ignore-scripts
trace-local --version
```

To keep tools isolated instead, use `npm install --prefix /path/to/tools <tgz> --omit=dev --ignore-scripts`.

## Commands

Run commands as `node dist/cli.js <command>` from the checkout, or as `trace-local <command>` when installed from the package.

### Web apps

| Command | What it does |
| --- | --- |
| `discover --project .` | Finds this project's running local app (Vite) without scanning other ports |
| `inspect --project . --url <app> --share-with-current-agent` | Screenshot, visible controls, layout measurements. Not a behavioral pass. |
| `run --project . --url <app> --file flow.json --share-with-current-agent --allow-local-side-effects` | Runs a bounded flow with a screenshot after each step, and names any failed step |
| `oracle <id> --file oracle.json` | Freezes the expected outcomes and prints their SHA-256 |
| `verify <id> --project . --url <origin> --oracle-sha <sha> --allow-local-side-effects` | Replays the flow and checks the frozen expectations; baseline-aware |

### APIs, CLIs & libraries

| Command | What it does |
| --- | --- |
| `plan --project . --file checks.json` | Freezes a check plan and prints its ID and SHA-256 |
| `check <id> --project . --plan-sha <sha> --allow-local-execution` | Runs it. Add `--allow-local-side-effects` for plans that write test data. |

### Evidence

| Command | What it does |
| --- | --- |
| `incident <id>` | Compact brief and screenshot paths |
| `evidence <id> --after 0 --limit 25 [--kind response]` | Event timeline, one page at a time |
| `export <id> --out <new-folder>` | Copies approved evidence to a folder you choose |
| `revoke <id>` · `delete <id>` | Blocks future reads · deletes the incident |

### Skill

| Command | What it does |
| --- | --- |
| `install-skill --project . --agent claude [--auto-check]` | Installs for one host (`codex` or `claude`) |
| `uninstall-skill --project . --agent claude` | Removes only unchanged, installer-owned files and the auto-check hook |

## Statuses & exit codes

| Exit | Meaning |
| :---: | --- |
| `0` | The command finished. For `check` and `verify`: everything passed or was verified |
| `2` | Something isn't verified: `reproduced`, `still failing`, `regression`, `could not reproduce`, `blocked`, `needs review`… |
| `1` | The command itself failed: bad input, a changed frozen check, or a missing permission flag |

Always read the status and omissions in the output, not just the exit code. A clean inspection can still report incomplete coverage.

## Where evidence lives

| OS | Default store |
| --- | --- |
| Windows | `%LOCALAPPDATA%\trace-local\incidents` |
| macOS / Linux | `~/.local/share/trace-local/incidents` |

Override with `--store <folder>` or `TRACE_HOME`. The store must be outside the project you're checking.

## Permission flags

| Flag | Allows |
| --- | --- |
| `--share-with-current-agent` | Letting the current agent read the captured evidence |
| `--allow-local-side-effects` | Clicking, saving or writing test data in your **local** app |
| `--allow-local-execution` | Running your project's Node code (this is **not** a sandbox) |

Flags record a permission you already gave. They never cover production, payments, outside messages or destructive actions.

## Input formats

- **Browser flows and oracles:** [helper reference](../skills/trace/references/helper.md)
- **HTTP, CLI and library plans:** [check reference](../skills/trace/references/checks.md)

Every expectation needs a source: your request, the docs, or an existing contract. A 422 can be the correct answer, and exit code 0 alone doesn't prove a feature works.
