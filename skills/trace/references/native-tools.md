# 🖼️ Host tools

TRACE is a workflow for the existing agent, not a new browser driver.

1. Check the host's exposed tool list and relevant installed skills. In Codex, that may include computer-use or a browser connector; in Claude Code, it may include configured browser/MCP tools and image/file reading. Names and capabilities vary. Use only documented APIs actually available.
2. Select the current task's app. Prefer a fresh isolated browser context; reuse an owned task tab only when its scope is known. Never attach to unrelated personal tabs or copy login profiles.
3. Read an accessibility/DOM snapshot to locate controls, then exercise a bounded scenario. Capture initial, failing and final screenshots as needed (normally 2–4). Use condition-based waits rather than sleeps. A screenshot is evidence, not an executable reproduction.
4. Check the contract: e.g. save → confirm response → reload → inspect persisted value. Include an expected rejection and ensure state was not changed by it. For layout issues, capture viewport dimensions and bounding rectangles/overflow measurements; do not label an intentional visual change a defect.
5. Save exact criteria before editing. Hash the saved UTF-8 file with an available standard tool (`Get-FileHash -Algorithm SHA256`, `shasum -a 256`, or the project's existing runtime), retain its digest and repeat the same scenario. A hash is an integrity aid, not protection against a malicious file owner.
6. Close only the task-owned tabs/processes you created. Report blocked authentication or missing drivers without asking the user to manually reproduce the bug.

Screenshots can contain private data. Host browser tools do not inherit TRACE helper masking/egress controls. Prefer synthetic local fixtures; use an available masking capability when verified. Do not claim redaction if the selected tool cannot provide it. Never read full headers or storage just because a connector exposes them.

For desktop/mobile, use only a real supported driver that can operate and inspect that environment. If unavailable, check supported library/API/test surfaces and mark native screens untested. A text-only model should report visual interpretation unavailable while continuing meaningful nonvisual checks.
