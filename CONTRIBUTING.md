<img src="assets/logo.svg" width="48" align="right" alt="TRACE logo"/>

# Contributing

Thanks for helping. Here is what gets merged, and what needs to come with it.

TRACE has one rule that shapes every change: **check real behavior against a known expectation, keep the evidence, and re-check the same expectation after a fix.** If something can't be checked, say so. Never fake a pass.

## Wrong findings are bugs

If TRACE called something a defect that isn't, missed one, or claimed a fix it never saw fail, [open an issue](https://github.com/kg290/Trace/issues/new?template=bug_report.md). Include the expectation TRACE used and where the real one comes from. A sanitized finding is enough, and no video is needed.

## Changes to the skill need a before and after

The skill text ([`skills/trace/SKILL.md`](skills/trace/SKILL.md) and `references/`) is what every TRACE user's agent reads. A change there gets merged only if the PR shows:

- the scenario your change should improve, run before and after on the same model,
- one existing scenario it could break, run before and after, still behaving,
- which host and model you used.

The demo fixtures ([`examples/profile`](examples/profile/README.md) and [`examples/number-kit`](examples/number-kit/README.md)) are the cheapest place to show it.

## Code changes need a test

New behavior in `src/`, `install.mjs` or the hook gets one focused test that fails without the change. Don't copy the implementation into the test. Bug fixes start from a failing test and keep it.

A new integration (a runtime, host or driver) needs a real way to operate and inspect the environment, a test that shows it reports a failure, and a stated permission boundary. Until then the area stays **unsupported**. Read [Adding an integration](docs/ARCHITECTURE.md#adding-an-integration) first.

## Setup

Use the Node version in [`.node-version`](.node-version) (22.23+ or 24).

```bash
npm ci --ignore-scripts
npx playwright install chromium      # Linux: add --with-deps
npm run build
```

## Checks

| Command | Covers |
| --- | --- |
| `npm run check` | TypeScript, including unused symbols |
| `npm test` | Installer, HTTP/CLI/library checks, statuses, auto-check hook, plugin manifests |
| `npm run test:browser` | Flows, verification, masking, origin blocking, failure handling |
| `npm run test:independent` | The demo app's contract with plain Playwright, without TRACE |
| `npm run docs:check` | Markdown links, code fences, demo assets, frozen demo criteria |
| `npm run pack:smoke` | Packs, installs (cache first) and runs the helper from a clean folder |
| `claude plugin validate --strict .` | Claude Code plugin and marketplace manifests |

CI runs all of these except the last on Windows and Ubuntu. Tests use synthetic data, bind only to `127.0.0.1`, need no model credentials, and clean up after themselves.

To try local plugin changes, use `claude --plugin-dir .`, or add the folder as a Codex marketplace with `codex plugin marketplace add ./`. Keep the `version` in `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` equal to `package.json`; `npm test` checks this.

## Before you open a PR

- Search what your change reaches: callers, fixtures, CLI help, the installer's owned-file list, skill references, package contents and docs.
- Keep the safety rails: input validation, path checks, permission flags and private-data filtering.
- Never commit evidence stores, absolute local paths, credentials or a generated `runtime.json`.
- Fill in the [PR template](.github/pull_request_template.md): what and why, how it was checked, the evidence, and what isn't covered.

## Releases

1. Bump the version in `package.json`, `src/types.ts` and both plugin manifests.
2. Run every check above, and inspect `npm pack --dry-run` for private files.
3. Move *Unreleased* in the [CHANGELOG](CHANGELOG.md) under the new version.
4. Tag `vX.Y.Z` and publish a GitHub release.
