# Dimension briefs

Every brief starts with this common block, then adds its dimension's questions.

```
Audit dimension: <name>. Worktree: <absolute path>. Commit: <sha>.
Read-only: do not edit, commit, or run anything that writes or spends (no .env, mock modes only).
Areas changed since the last audit (<sha>): <git diff --dirstat output>.
Open findings for this dimension from the last report: <AUD-* ids with one line each, or "none">.
For each open finding, say whether it is still open or resolved, with evidence.

Output, ≤ 700 words. Per finding:
AUD-<stable-topic-id> · severity (high/medium/low) · confirmed|suspected
file:line · failure scenario · impact · proposed fix
High = breaks an invariant, causes real bugs, is exploitable, or loses money or data.
Only what you can point to in the code. No style.
```

## 1. Structure and invariants

- Does the real folder structure match the documented one (architecture docs, module index)?
- New entries in allowlists or exception tables? Each with a reason? Stale entries?
- Invariants in the table without a test, or tests without a row in the table?
- Imports that cross a boundary the architecture test does not cover yet.
- Files over 500 lines; new folders without documentation.

## 2. Runtime logic and harness

- Agent loop: is every action that writes planned and approved, never executed inside the read loop?
- Budget checked before every spend (LLM, external calls)?
- External effects wrapped for idempotency; retries safe?
- "Completed = verified": can an action end `pass` without its own evaluation?
- Decisions that do not cite existing evidence.
- (In a product without an agent runtime: the main request path, error handling and retries.)

## 3. Docs and process

- ADRs without a status header, or numbered ADRs whose title still says draft.
- Main specs with "TBD" in Purpose; changes ≥ 90 % done and not archived; changes never started.
- Roadmap entries that do not match the change folders.
- The development harness itself: hooks, skills and scripts that are broken, unused or undocumented.
- Environment variables used in code and missing from `.env.example`.

## 4. Scalability

- Storage access that is O(n) over all records per request; full scans of event logs.
- Queues or jobs without timeout, retry limit or dead-letter path.
- Unbounded caches, in-memory maps keyed by tenant or user.
- N+1 calls to external systems.

## 5. Security

- Authentication and authorization on every entry point added since the last audit.
- SSRF: URLs the system fetches that come from users or tenants.
- Secrets in tracked files (report paths, never values) or in logs.
- Personal data stored, logged or sent beyond what the feature needs.
- Dependencies: the dependency audit output; new packages and their maintainers.
- Prompt injection reaching a tool with side effects.
