<img src="assets/logo.svg" width="48" align="right" alt="TRACE logo"/>

# Install

Pick your agent below. TRACE is one skill ([`skills/trace/SKILL.md`](skills/trace/SKILL.md)). Everything else in this repo loads that skill into different agents, plus one optional Stop hook and an optional local helper.

The plugins' automatic check is a small Node.js script, so `node` (22.23+ or 24) needs to be on the PATH of non-interactive shells. Nix and nvm users: check this first.

## Claude Code

```
/plugin marketplace add kg290/Trace
```
```
/plugin install trace@trace
```

Send these as two separate prompts. On Claude Code 2.1.275+ one prompt is enough: `/plugin install trace --marketplace kg290/Trace`. From a terminal, run `claude plugin marketplace add kg290/Trace`, then `claude plugin install trace@trace`.

The same commands work in the Claude Code desktop app: type them in the prompt box, or use **+** → **Plugins** → **Add plugin**.

Start a new session and type `/trace`. The plugin skill appears as **`/trace:trace`**.

## Codex

```bash
codex plugin marketplace add kg290/Trace
codex plugin add trace@trace
```

Run `codex`, open `/hooks`, review and trust TRACE's Stop hook, and start a new thread. You can also install from the plugin browser: open `/plugins` and choose **TRACE**. The Codex desktop app picks the plugin up after a restart.

Invoke it as **`$trace:trace`**, or pick TRACE under **`@`**.

## Any other agent, or one project only

Clone the repo and install the skill straight into a project:

```bash
git clone https://github.com/kg290/Trace.git && cd Trace
node install.mjs --project /path/to/project                 # Claude Code and Codex skill folders
node install.mjs --project /path/to/project --agent claude  # one host only (or codex)
node install.mjs --project /path/to/project --agent claude --auto-check
```

This copies `skills/trace` into the project's `.claude/skills/` and `.agents/skills/` and nothing else: no npm install, no browser download, no global changes. Other agents that read those folders can use it too. If yours doesn't, point it at [`skills/trace/SKILL.md`](skills/trace/SKILL.md) and ask it to install that file as a skill.

The installer never overwrites. It refuses to install over an existing skill and refuses to remove files you changed. Use either the plugin or this installer, not both, or TRACE shows up twice.

## The optional local helper

The skill works with your agent's own tools. The helper adds exact, repeatable checks: local browser flows with screenshots, HTTP, Node CLI and library checks, and frozen verification.

```bash
npm ci --ignore-scripts
npx playwright install chromium     # only for browser checks
npm run build
```

| You installed | How the skill finds the helper |
| --- | --- |
| The per-project installer | Reinstall after building. `runtime.json` then points at `dist/cli.js` |
| A plugin | Put `trace-local` on your PATH: `npm pack`, then `npm install -g ./trace-local-experiment-0.3.0.tgz --omit=dev --ignore-scripts` |

Check it with `trace-local --version`. Commands, statuses and permission flags are in [docs/CLI.md](docs/CLI.md).

## Automatic checks

| | Default | Turn off |
| --- | --- | --- |
| Claude Code plugin | On | `/config` → TRACE → *Automatic checks* |
| Codex plugin | Off until you trust the hook | Untrust it in `/hooks` |
| Per-project installer | Off | Leave out `--auto-check`, or uninstall |
| Any install | | `TRACE_AUTO_CHECK=0`, or `{"autoCheck": false}` in the project's `.trace.json` |

The check works in git projects. It runs once at the end of a task that changed code, never twice in a row, and stays silent otherwise.

## Update and remove

| | Update | Remove |
| --- | --- | --- |
| Claude Code | `/plugin marketplace update trace` | `/plugin uninstall trace@trace` |
| Codex | `codex plugin marketplace upgrade trace` | Uninstall in `/plugins`, then `codex plugin marketplace remove trace` |
| Per-project | `node install.mjs --project <path> --uninstall`, then install again | `node install.mjs --project <path> --uninstall` |

## Troubleshooting

**The automatic check never runs.** Check that `node --version` works in a non-interactive shell, that the project is a git repository, and (in Codex) that the hook is trusted in `/hooks`. Also make sure neither `TRACE_AUTO_CHECK=0` nor `{"autoCheck": false}` is set.

**TRACE appears twice.** You have both the plugin and a per-project install. Run `node install.mjs --project <path> --uninstall`.

**The skill says the helper is missing.** That's fine: it uses your agent's tools instead. To add the helper, see [The optional local helper](#the-optional-local-helper).

**It doesn't run on its own.** Name it: *use TRACE to check the feature you just built*.
