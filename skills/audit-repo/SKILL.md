---
name: audit-repo
description: Runs the periodic five-dimension repo audit (structure and invariants, runtime logic and harness, docs and process, scalability, security) with deterministic metrics, parallel read-only subagents and a trend against the previous report in openspec/audits/. Use when asked for an audit, a global review or a health check, before closing a roadmap wave, or when the session notice says the last audit is more than 14 days old. Not for reviewing one branch (use review).
argument-hint: "[full|diff|structure|harness|docs|scalability|security]"
---

# audit-repo

Say at the start: "Using audit-repo (<mode>)."

Mode: `$ARGUMENTS`, default `full`. `diff` covers only what changed since the last report; a dimension name runs
that dimension alone.

**Resolve the commands first.** Read `swarm.json` at the repo root: `{audit}` is `commands.audit` (fallback
`pnpm audit:repo`), `{commit}` and `{land}` as in the `land` skill. Contract: [INTEGRATION.md](../../INTEGRATION.md).
Lint, typecheck, structural tests, spec validation and the dependency audit use the repo's own commands from
`CLAUDE.md`; the examples show the pnpm defaults.

## The gates

1. **Read-only.** Fix nothing, commit only the report and its metrics file, spend nothing (no `.env`, mock modes).
2. **Every high finding is re-checked by you in the code** before it enters the report. Subagents get things wrong.
3. **No debt metric rises without a written reason** in the report.

Why: gates only catch errors; debt grows silently between them (lint warnings went from 412 to 665 in ten days, with
every gate green). Reports kept outside the repo left nothing to compare against (chapter 09).

## Steps

```
- [ ] 0. Own worktree; check memory
- [ ] 1. Context (no subagents)
- [ ] 2. Deterministic checks
- [ ] 3. Dimension subagents, one message
- [ ] 4. Re-check, merge, mark the trend
- [ ] 5. Report, commit, land
```

0. **Where.** In your own worktree (`audit-<date>`; `worktree` skill). If the session notice reports memory warn or
   critical, run the heavy steps one at a time. Never stop other sessions' processes.

1. **Context, gathered by you.**
   - The latest `openspec/audits/<date>.md` and its open `AUD-*` findings; its commit sha.
   - `git log --oneline <sha>..HEAD` and `git diff --dirstat <sha>..HEAD`: the areas that changed.
   - `{audit}`: metrics with deltas against the last snapshot.
   - The roadmap command (default `pnpm roadmap`): active, nearly done and never started changes.

2. **Deterministic checks.** Run each and record the result line:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test:arch
   pnpm exec openspec validate --all --no-interactive
   pnpm audit --prod
   ```

   Known noise: a vitest RPC timeout (`Timeout calling "onTaskUpdate"`) with every test passed is load, not a
   finding. Any other red is a finding.

3. **Subagents.** One read-only agent per dimension in the mode, all launched in **one message**. Each prompt is a
   brief from [dimension-briefs.md](dimension-briefs.md), filled with the worktree path, the changed areas and that
   dimension's open `AUD-*` findings. `quality-auditor` or a general read-only agent both work.

4. **Re-check and merge.** Open every high finding's `file:line` and confirm the failure scenario; downgrade or drop
   what does not hold. Merge duplicates across dimensions. Mark each `AUD-*` as new, still open, or resolved (with
   the commit or change that resolved it). Ids stay stable across audits.

5. **Report.** `{audit} --write` (stores `openspec/audits/<date>.metrics.json`), then write
   `openspec/audits/<YYYY-MM-DD>.md` from [skeleton.md](skeleton.md). Commit both with `{commit}` and
   integrate with `{land}`.

## Severity

High = breaks an invariant, causes real bugs, is exploitable, or loses money or data. Medium = erodes structure or
will cause bugs at scale. Low = debt with no near-term failure.

## Red flags

| Thought | Reality |
| --- | --- |
| "This is quick to fix; I will fix it while auditing." | The audit is read-only. Propose a change for it. |
| "The subagent marked it high; it goes in as is." | Re-check it in the code. Unverified highs destroy trust in the report. |
| "Warnings went up a bit; not worth mentioning." | No debt metric rises without a written reason. |
| "No previous report, so no trend section." | Then this report is the baseline; say so. |
| "I will save the report in docs/." | The docs test requires cited paths to exist; reports cite code that later moves. Use `openspec/audits/`. |
| "Run all five subagents one after another." | Launch them in one message; serialize only the heavy commands under memory pressure. |

## Output in chat

Five lines: commit and mode; counts by severity (new / open / resolved); the top two findings; metric deltas that
rose; an offer to open a change for the first block of the proposed order. Nothing is fixed unless the human asks.

Depth: [chapter 09](../../manual/09-periodic-audit.md), [chapter 15](../../manual/15-review-processes.md).
