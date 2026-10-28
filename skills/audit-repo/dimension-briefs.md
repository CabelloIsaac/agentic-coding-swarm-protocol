# Dimension briefs

Every brief starts with this common block, then adds its dimension's questions.

```
Audit dimension: <name>. Worktree: <absolute path>. Commit: <sha>.
Read-only: do not edit, commit, or run anything that writes or spends (no .env, mock modes only).
Do not run the full test suite; single test files only.
Areas changed since the last audit (<sha>): <git diff --dirstat output>. Focus there first.
Open findings for this dimension from the last report: <AUD-* ids with one line each, or "none">.
For each open finding, say whether it is still open, worse, partly resolved or resolved, with evidence.

Output, ≤ 700 words. Per finding:
AUD-<stable-topic-id> · severity (high/medium/low) · confirmed|suspected
file:line · failure scenario · impact · proposed fix
Reuse the previous id when it is the same finding.
High = breaks an invariant, causes real bugs, is exploitable, or loses money or data.
Medium = erodes structure or will cause bugs at scale. Low = debt with no near-term failure.
Only what you can point to in the code. No style. Never copy a secret's value.
```

## 1. Structure and invariants (and real versus documented structure)

Read `CLAUDE.md`, the architecture doc's invariants table and its kernel section.

- **Every rule in `CLAUDE.md`, with evidence**: point to the code or test that shows it holds, or the place where it
  does not.
- **Run the architecture test and hunt its holes:**
  - directories its file walker does not visit (`scripts/`, app config files such as `next.config.*`, tooling);
  - patterns its regexes miss: dynamic `import()` (`await import('node:fs')`), `createRequire`,
    `child_process` / `node:child_process`, alternative HTTP clients (`undici`, `axios`, `got`), SDKs imported
    through a re-export;
  - exception and pending lists (`EXCEPTIONS`, `PENDING`, allowlists) that grew since the last audit, each new entry
    with or without a reason;
  - invariants in the table without a test, or tests without a row.
- **Real versus documented structure:** compare the real folders (core modules, integrations, apps, scripts) with
  the architecture doc, the per-area docs and the roadmap:
  - folders that exist and are not documented, or documented and missing;
  - modules that duplicate a responsibility (several senders for the same channel, several notifiers);
  - import cycles between modules, especially inside the kernel;
  - files over 500 lines (list the ones that grew).
- **Seed data:** nothing writes to the seed tenants by default, the CLI included, not only the apps.
- **Apps follow the same rules:** no storage access, no integrations imported directly, an actor on every write.

## 2. Runtime logic and harness

Read the ADRs on the run shape, idempotency and the LLM boundary, then the runtime. Look for:

- **Runs never closed**, or closed with the wrong status or cost (a run opened before the `try` that closes it).
- **Spend without a budget check**: LLM or paid calls outside a run, a budget guard built with a zero month-to-date
  spend, spend that does not count toward the monthly total.
- **Intermediate states with no recovery**: detached processes and states (`generating`, `approved`, `queued`,
  `rendering`) that stay forever when a job dies or times out; a reaper that closes the run but not the entity.
- **Lock-free duplicates**: read-then-append transitions without atomicity; webhooks re-delivered; two workers
  picking the same item.
- **Idempotency keys that change on retry** for an external effect (publish, send, buy, deploy), or a retry that
  pays again for the same job.
- **`pass` without evaluation**: an action marked completed/pass when its own check could not run (it must be
  `skipped`).
- **LLM writes**: the model executing anything other than reads inside the loop, in new paths (chat, messaging,
  interviews, tools with media); approvals by message that do not check the sender and a concrete pending approval.
- **Destructive operations without a version**: customer data changed or deleted outside the history; writes with
  no actor (count `system`/`unknown` actors in the change logs).
- **Decisions without evidence**: decisions that cite no evidence or evidence that does not exist.
- **Wall-clock time in the domain**: `Date.now()` / `new Date()` outside the clock module, which breaks simulation
  and replay.
- (In a product without an agent runtime: the main request path, error handling, retries and job recovery.)

## 3. Docs, process and the development harness

- **Specs:** `openspec validate --all --json`: which changes fail and why (MODIFIED blocks missing scenarios).
- **Changes:** nearly done and not archived, and what is missing (code, or only work outside the repo); absorbed
  changes still active; changes at zero tasks done for weeks; stale pending tasks and meta-tasks ("verify green");
  recent code with no change behind it (feature commits that name no change); `roadmap.yaml` against the change
  folders.
- **ADRs:** numbered and in the index; no orphan drafts; titles that still say draft; status headers present.
- **Docs test and what it misses:** run it, then look for commands missing from the README, modules without a
  section, environment variables missing from `.env.example`, extension guides that no longer match the code,
  invariant numbering in the prose that differs from the table, a stale known-debt table in `quality.md`, main specs
  with an empty Purpose.
- **Style through `git diff`:** new `any`, `as unknown as`, `@ts-ignore`; schemas on every contract; the language
  policy; new files without a test; the coverage floor lowered or not raised.
- **Development harness:** `CLAUDE.md`, the hooks in `.claude/settings.json`, the skills and the dev scripts
  (verify, land, worktree, roadmap, ADR) say and do the same thing; skills that cite missing files or commands;
  cleanup commands that could delete uncommitted work.
- **Secrets:** in tracked files (paths only, masked); `.gitignore` covers `.env` and runtime storage.

## 4. Scalability

Read the scaling doc. Look for:

- **State in process memory** that breaks with several workers or instances, or grows without a cap (maps keyed by
  tenant or user, in-memory rate limiters, semaphores per process).
- **Read-modify-write without a lock** across processes; sequences generated in memory.
- **O(n) reads of the history on hot paths**: every incoming message, every request, every scheduler tick reading
  a whole event log; `keys()` followed by one read per key.
- **Binaries in memory**: whole files, audio or video read into memory or stored base64 in a key-value table.
- **`spawn` without a cap**: child processes per request without a queue, a limit or a timeout.
- **Polling that blocks or re-sends paid jobs** on retry.
- **Per-instance limits** on public endpoints and webhooks (rate limits in memory, file locks).
- **Missing indexes** for the usual filters; N+1 queries per tenant; N+1 calls to external systems.
- **Scheduler fairness** between tenants, orphan jobs, leases, jobs without timeout, retry limit or dead-letter path.
- List the limits the scaling doc should state and does not.

## 5. Security

A defensive review of the repo itself, **in this order**:

1. **Incoming webhooks:** HMAC verified in constant time, verify token, replay protection (the event id and a
   timestamp inside the signature), body size capped before verification, nothing processed before verification.
2. **Authentication and sessions:** magic links (entropy, expiry, single use), cookies (`HttpOnly`, `Secure`,
   `SameSite`), middleware that covers every route, authorization per tenant (change the id in the URL), CSRF on
   actions with effects, admin routes.
3. **Actions by message or chat:** the sender is the tenant's owner or member with the right role; approvals
   reference a concrete, still pending approval; attempt limits.
4. **Prompt injection:** external content (imported pages, reviews, messages, uploaded files, integration results)
   reaching the model while it has tools with effects; model output landing in HTML (XSS), paths, commands or URLs.
5. **Path traversal:** ids or slugs from users or the model joined into filesystem paths.
6. **Process execution:** `spawn`/`exec` with interpolation or `shell: true`; secrets in argv or in child
   environments.
7. **SSRF:** URLs fetched on behalf of users or tenants (private IPs, redirects, `file:`, size, timeout, DNS
   rebinding checked on every hop).
8. **Secrets and personal data** in tracked files, logs and event logs (paths only; real phone numbers or emails in
   tests count).
9. **Database:** interpolated SQL, an app role with more privileges than it needs (or too few, which pushes
   deployments to the owner role), long-lived presigned URLs.
10. **Dependencies:** the dependency audit once (`pnpm audit --prod` or `{audit} --deps`); check whether each
    critical or high advisory is reachable.
11. **Abuse:** rate limits on public flows and on endpoints that spend money.

Ask for a "what is fine" list: verified controls that must not regress.

## 6. Protocol conformance

Compare the repo with the protocol it claims to follow. Run each check of [INTEGRATION.md](../../INTEGRATION.md) §6
up to the `level` in `swarm.json` (the same list `/swarm:adopt --check` runs), read-only.

- One line per check: id, pass or fail, evidence (file, command output).
- A score per level (`level 0 → 4/5`).
- What the repo does that the protocol does not cover yet (candidates to contribute back).
- What the protocol requires and the repo lacks, and whether an active change already covers each gap.
- Defects shared by the repo and the protocol's reference implementation: report them for both.
