---
name: verify
description: Runs the repository's single quality gate (the verify command from swarm.json, default pnpm verify, or its quick level while iterating), triages each red step from its log tail and reports the result as evidence. Use before saying a change is done, fixed, passing or ready to land, after a rebase, after a subagent reports success, or when the user asks whether everything passes. Also use when verify is red with timeouts, "Cannot find package", a coverage drop or one intermittent test.
argument-hint: "[--quick]"
allowed-tools: Bash(pnpm verify) Bash(pnpm verify *) Bash(pnpm vitest run *) Bash(pnpm install *) Bash(uptime) Bash(tail *) Bash(git status *) Bash(git diff *)
---

# verify

Say at the start: "Using verify (full|quick)."

**Resolve the commands first.** Read `swarm.json` at the repo root: `{verify}` is `commands.verify` and
`{verifyQuick}` is `commands.verifyQuick`. Only when the file or a key is missing, fall back to `pnpm verify` and
`pnpm verify --quick`, and say in the report that you did. The manifest contract is in
[INTEGRATION.md](../../INTEGRATION.md). The examples below show the pnpm defaults; other stacks print different
lines, so match the meaning, not the exact text.

## The gate

A claim that work is done, fixed or passing needs a **full** `{verify}` that ran **after your last edit**, with
its final line shown. A quick run, an earlier run, a single test file or a subagent's report is not that evidence.

Why it is strict: `--quick` selects tests through the import graph and cannot see tests that read YAML or templates
without importing them (chapter 02). `land` runs the full gate anyway, so a premature "done" only moves the failure
inside the land lock, where it blocks every other session.

## When not to use it

- Checking one test while you edit: run that file with the repo's single-test command (`CLAUDE.md`;
  default `pnpm vitest run <file>`). Use this skill to close.
- A failure whose cause you do not know after reading the tail: switch to the `debug` skill, then come back here.
- CI red on the integration branch with nothing of yours in it: report it; do not fix it from your branch.

## Steps

1. **Pick the level.**

   | Situation | Command |
   | --- | --- |
   | Iterating, after each meaningful edit | `{verifyQuick}` |
   | Closing a task, before `land`, after a rebase, user asks "does it pass?" | `{verify}` |

2. **Run it as is.** Do not pipe it through `grep` or `tail`: it already prints one line per step plus the last 40
   lines of each failure. The full level takes minutes; give the command a 10-minute timeout or run it in the
   background and wait for it.

3. **Read the last line.**
   - `✓ all green (Ns)` → go to **Report**.
   - `✗ N step(s) red (Ns) · logs in storage/tmp/verify/` → step 4.

4. **Triage each red step.** Read the tail printed under `── <step> ──`. Only if it is not enough:
   `tail -n 200 storage/tmp/verify/<step>.log`. Never read a whole log. Then classify:

   | What the tail shows | Class | Action |
   | --- | --- | --- |
   | `Test timed out` / `Hook timed out` in files your diff does not touch | maybe load | `uptime`; if load is high, `pnpm vitest run <those files>`. Green alone → load, report it as such; red alone → real |
   | `Cannot find package` / `Cannot find module` after a rebase | stale deps | the repo's install command (`pnpm install`), rerun |
   | type errors inside a generated folder (`.next/types`, codegen output) | stale build output | delete that git-ignored folder, rerun |
   | coverage below the threshold | real | add tests for what you added; the floor never goes down |
   | architecture or docs test | real | fix the code or the doc (the `docs-keeper` agent syncs docs); an allowlist entry needs a reason and a doc update |
   | the same test passes and fails across runs | flaky | flaky-test policy (chapter 04): suspect the test first; never retry until green |
   | anything else | real | fix it, then back to step 2 |

   The full table, with exact signatures and the one tolerated infrastructure flake, is in
   [failures.md](failures.md).

5. **Loop until green.** If two fixes for the same failure did not work, stop patching and use the `debug` skill.

## Red flags

If you catch yourself thinking one of these, stop and do what the right-hand column says.

| Thought | Reality |
| --- | --- |
| "Quick was green, so it is done." | Quick misses tests that read YAML or templates. Run the full level. |
| "I ran it before my last edit." | That evidence is stale. Run it again. |
| "The subagent said all tests pass." | A report is not output. Run it yourself, or check the command and output it returned. |
| "Only an unrelated test fails." | Two green branches can be red together (a semantic clash). Read the test before calling it unrelated. |
| "It is just a timeout; CI will pass." | Prove it: `uptime` plus the failing files green on their own. A timeout in a file you touched is yours. |
| "I will `.skip` it, lower the floor or add an allowlist entry to unblock." | That weakens the gate. Fix the cause or ask the human; the plugin hook warns when a gate file is edited. |
| "Let me rerun until it passes." | Retries hide concurrency bugs. Classify it with the table above. |
| "I will read the full log to be safe." | 3,000 lines burn the session. Tail first; 200 lines at most. |

## Report

Always answer with this block, never with "everything passes":

```
verify: pnpm verify (full) · ✓ all green (212s)
Steps: lint ✓ · typecheck ✓ · validators ✓ · specs ✓ · tests+coverage ✓
Optional suites: <included | skipped (reason)>
Commands: swarm.json | fallback pnpm defaults (no swarm.json)
```

When something is red or was tolerated:

```
verify: pnpm verify (full) · ✗ 1 step red (198s)
Red: tests · src/billing/invoice.test.ts › "rounds totals" (expected 10.01, got 10)
Class: real | load (uptime 38.2; rerun alone ✓) | stale deps (pnpm install, rerun ✓)
Next: <what you are doing about it>
```

Use the command you actually ran (from `swarm.json` or the fallback). A quick run is reported as such and never
closes a task.

Depth: [chapter 02](../../manual/02-verification.md) (the gate, load protocol), [chapter 04](../../manual/04-testing.md)
(flaky-test policy), [chapter 11](../../manual/11-anti-patterns.md) (verification anti-patterns).
