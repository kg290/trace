<img src="../assets/logo.svg" width="48" align="right" alt="TRACE logo"/>

# Privacy & permissions

[← README](../README.md) · [Architecture](ARCHITECTURE.md) · [Security policy](../SECURITY.md)

**TL;DR:** TRACE checks your *local* software with your agent's existing permissions. It masks private fields, keeps evidence outside your project, and never uploads anything itself. "Check my project" never authorizes production changes, payments, destructive actions or messages to other people.

## / ❌ At a glance

| TRACE does | TRACE never does |
| --- | --- |
| Run bounded checks on your local app, API, CLI or library | Touch production, make payments or send messages |
| Mask password, token, email, card and other private fields in screenshots | Keep cookies, headers, storage, request bodies, HAR files or videos |
| Remove known secrets (bearer tokens, API keys, JWTs, private keys, emails) from text | Copy your browser profile or attach to your personal tabs |
| Keep evidence in a private folder outside your project | Send telemetry, call a model, or upload evidence |
| Ask for an explicit flag before running code or writing test data | Treat page text, logs or repo content as instructions |

## Which tool is collecting?

TRACE uses your host's tools first. Their guarantees differ from the helper's, so TRACE never claims the helper's protections for a host tool that lacks them.

| | Host tools | TRACE helper |
| --- | --- | --- |
| **Browser session** | Isolated when the tool supports it | Always a fresh Chromium, with no login profile copied |
| **Screenshots** | Whatever masking that tool offers | Known private fields masked. Frames, canvas and video cause the image to be skipped. |
| **Network** | Your host's policies | Only the local app's origin. Other sites, WebSockets and service workers are blocked. |
| **Who reads evidence** | Your current agent | Your current agent, after the invocation approves it |
| **Uploads** | Your host's policies | None |

> [!IMPORTANT]
> Collecting evidence locally doesn't make a cloud-hosted agent conversation offline. Whatever your agent reads is shared under your host's policies.

## Use synthetic data

Prefer local fixtures and made-up data. Mark private regions with `data-private` or `data-trace-private`, and the helper keeps them out of screenshots and text. Real input values are kept only when a flow declares `testData: true`. Masking catches **known** private fields. Personal details in free text or images can still appear, so skip a screenshot when it can't be made safe.

The browser sees raw data while it works. The filtering applies to what's **kept**, and it isn't a data-loss-prevention system.

## Storage, approval & deletion

- **Location:** outside your project, in a per-user folder by default. The helper refuses a store inside the project.
- **Integrity:** atomic writes, SHA-256 integrity files, and checks that reject symlinked paths. Private file modes are used where the OS supports them; on Windows, files inherit the parent folder's permissions.
- **Approval:** raw and agent-readable copies are separate. `revoke <id>` blocks future reads, and `delete <id>` removes the incident.
- **Limits of deletion:** neither command can take back data that was already read, exported, backed up or pasted into a conversation. TRACE never deletes evidence automatically.

## Execution limits

| Limit | Value |
| --- | --- |
| Events per capture | 2,000 (2 MB) |
| Capture duration | 5 minutes |
| Screenshots per flow | 6, at most 1 MB each |
| Node check runtime and output | 10 seconds, 16 KB |
| Checks per plan · per oracle · steps per flow | 8 · 20 · 100 |

Anything dropped, blocked or incomplete is recorded, never silently skipped.

> [!WARNING]
> **Node checks are not sandboxed.** They run your project's code with your permissions, including file, network and child-process access. "Read-only" states intent, not containment. Only check trusted code and services you own.

## Before you publish evidence

Generated host configuration, evidence stores, dependencies, build output and release archives are git-ignored. The demo images in this repo contain synthetic data only. Review any new evidence before sharing it: `.gitignore` is a convenience, not a security filter.
