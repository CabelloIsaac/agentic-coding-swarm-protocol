---
name: audit-repo
description: Runs the periodic repo audit (structure and invariants, runtime logic and harness, docs and process, scalability, security, protocol conformance) with deterministic metrics, parallel read-only subagents and a trend against the previous report in openspec/audits/. Use when asked for an audit, a global review, a security audit or a health check, before closing a roadmap wave, or when the session notice says the last audit is more than 14 days old. Not for reviewing one branch (use review).
argument-hint: "[full|diff|structure|harness|docs|scalability|security|protocol]"
---

# audit-repo

Say at the start: "Using audit-repo (<mode>)."

Mode: `$ARGUMENTS`, default `full` (the whole repo, focused on what changed since the last report). `diff` covers
only what changed since the last report (or the uncommitted work if there is none); a dimension name runs that
dimension alone.

**Resolve the commands first.** Read `swarm.json` at the repo root: `{audit}` is `commands.audit` (fallback
`pnpm audit:repo`), `{findings}` is `commands.findings` (fallback `node scripts/dev/findings.ts`), `{commit}` and `{land}` as in the `land` skill. Contract: [INTEGRATION.md](../../INTEGRATION.md).
Lint, typecheck, structural tests, domain validators, spec validation and the dependency audit use the repo's own
commands from `CLAUDE.md`; [checks.md](checks.md) shows the pnpm defaults.

## The gates

1. **Read-only.** Fix nothing, commit only the report, its metrics file and the ledger lines (`{findings} add`), spend nothing (no `.env`, mock modes).
2. **Every high finding is re-checked by you in the code** before it enters the report, and its severity is
   recalibrated. Subagents get things wrong in both directions.
3. **No debt metric rises without a written reason** in the report.

Why: gates only catch errors; debt grows silently between them (lint warnings went from 412 to 665 in ten days, with
every gate green). Reports kept outside the repo left nothing to compare against (chapter 09).

## Steps

```
- [ ] 0. Own worktree; check memory
- [ ] 1. Context (no subagents)
- [ ] 2. Deterministic checks (heavy ones after step 3)
- [ ] 3. Dimension subagents, one message
- [ ] 4. Re-check, recalibrate, merge, mark the trend
- [ ] 5. Report, commit, land
```

0. **Where and how.** In your own worktree (`audit-<date>`; `worktree` skill), never the main checkout; install
   dependencies if it is new. Read the memory line of the session notice (or the status command). Under pressure
   (swap above 75 %, or warn/critical): nothing in parallel except the subagents; the full test suite and the
   end-to-end demo run one at a time and **after** the subagents finish; subagents run single test files only.
   Never stop other sessions' processes; reaping needs the human's permission.

1. **Context, gathered by you.**
   - The latest `openspec/audits/<date>.md`: its commit sha and open `AUD-*` findings per dimension.
   - `git log --oneline <sha>..HEAD | wc -l` and `git diff --dirstat=files,0 <sha> | sort -rn | head -25`: the
     changed areas, which are the subagents' focus. No previous report: the last ~40 commits, and say this report
     is the baseline.
   - `{audit}`: metrics with deltas against the last snapshot. Check first that it excludes playground and sandbox
     folders and its own source (its regexes match themselves); otherwise the escape and TODO counts measure noise.
   - The roadmap command (default `pnpm roadmap`) and `npx openspec list`: active, nearly done, never started.

2. **Deterministic checks.** The list, the order and the known noise are in [checks.md](checks.md). Record one
   result line per check. Investigate a red before reporting it: name the cause, not the symptom.

3. **Subagents.** One read-only agent per dimension in the mode, all launched in **one message**. Each prompt is a
   brief from [dimension-briefs.md](dimension-briefs.md), filled with the worktree path, the changed areas and that
   dimension's open `AUD-*` findings. `quality-auditor` or a general read-only agent both work. They report; only you write to the ledger. The protocol
   dimension runs the conformance checks of [INTEGRATION.md](../../INTEGRATION.md) §6 (the list
   `/swarm:adopt --check` runs) by hand, read-only.

4. **Re-check, recalibrate and merge.** Open every high finding's `file:line` and confirm the failure scenario.
   Downgrade or drop what does not hold; raise what is worse than reported (a "low" dependency advisory becomes high
   when the vulnerable path is reachable without authentication). Merge duplicates across dimensions: the same file
   often shows up in harness, scalability and security. Mark each `AUD-*` as new, still open, worse, partly
   resolved, resolved (with the commit or change) or reopened. Ids stay stable across audits. Every metric that rose
   becomes a finding or carries its reason.
   - **Detection data, for every new finding.** `introduced`: the commit that introduced the defect, found with
     `git log -S '<snippet>'`, `git blame -L <a>,<b> <file>` or `git log -L <a>,<b>:<file>`; write `unknown` when
     history does not tell. `detected`: today (a carried-over finding keeps the date of the audit that first
     reported it). `catchable_at_review`: `yes` when the defect was visible in the diff of the change that introduced
     it and a class of [defect-classes.md](../../checklists/defect-classes.md) marked *diff* covers it; then the
     per-change review let it escape. A *diff* finding with no class is a new class: propose it in the report.
   - **Rules that erode.** When a finding or a risen metric breaks a rule written in `CLAUDE.md`, record that rule.
     If the rule is marked `(preference)`, propose the mechanism that would enforce it (a ratchet, a test, a hook);
     if it is marked `enforced:`, the mechanism has a hole: that is a finding of its own.

5. **Ledger, then report.** The audit's output is ledger lines, not a prose list. For every finding that survived
   step 4 and is not already in the ledger, run one `{findings} add --severity <high|medium|low> --title "<what>"
   --file <path> [--line N] --source audit --owner <who> --dc <DC-xxx> --introduced <sha|unknown>
   [--catchable-at-review]` (a carried-over finding keeps its id and its `--opened`/`--detected` dates; the SLA
   clock starts at `opened`). Ask the human for owners; a HIGH without one fails conformance L2.8. Resolved findings
   are closed with `{findings} close <id> --by <sha>`; a risk the human accepts with `{findings} accept <id> --reason
   "<why>"`. Then write the detection data to `openspec/audits/<date>.findings.json` (an array of
   `{ id, severity, introduced, detected, catchable_at_review, rule? }`), and run
   `{audit} --write --findings openspec/audits/<date>.findings.json`: it stores
   `openspec/audits/<date>.metrics.json` with the median detection latency, the escape rate, the count of
   `preference` rules and the rules found eroding. Write `openspec/audits/<YYYY-MM-DD>.md` from
   [skeleton.md](skeleton.md), starting with its **Cierre** section (the closure numbers from `{findings} stats` and
   the metrics table: open, overdue, median age, opened/closed 14 days, ratio, hot files). Commit the three files and the ledger with `{commit} "audit: report <date>"` and integrate with
   `{land}`.

## Severity

High = breaks an invariant, causes real bugs, is exploitable, or loses money or data. Medium = erodes structure or
will cause bugs at scale. Low = debt with no near-term failure. Each finding is **confirmed** (you read the code and
the scenario holds) or **suspected** (plausible, not proven).

## Red flags

| Thought | Reality |
| --- | --- |
| "This is quick to fix; I will fix it while auditing." | The audit is read-only. Propose a change for it. |
| "The subagent marked it high; it goes in as is." | Re-check it in the code and recalibrate. Unverified highs destroy trust in the report. |
| "`any` and TODO went up; that is debt." | First check what the metric counts. In the reference project the rise came from the playground and the audit script's own regexes. |
| "Warnings went up a bit; not worth mentioning." | No debt metric rises without a written reason. |
| "The demo run failed; report the code as broken." | Investigate first: dirty seed data fails it too. Report the cause. |
| "No previous report, so no trend section." | Then this report is the baseline; say so. |
| "Finding the introducing commit takes too long; skip it." | `git log -S` takes seconds. Without `introduced` there is no latency, and nobody learns which review let it through. `unknown` is fine when history truly does not tell. |
| "The rule is in CLAUDE.md, so it is covered." | A rule marked `preference` is held by habit only. In the reference project the coverage floor sat 2.7 points under measured for 19 days with the rule written down. Propose the mechanism. |
| "I will save the report in docs/." | The docs test requires cited paths to exist; reports cite code that later moves. Use `openspec/audits/`. |
| "Run the full suite while the subagents work." | Under memory pressure both slow down and time out. Heavy checks go after the subagents. |
| "Run all subagents one after another." | Launch them in one message; serialize only the heavy commands. |

## Output in chat

Seven lines: closure first (`{findings} stats`: open, overdue, median age, ratio); commit and mode; counts by severity (new / open / resolved); the top two findings; metric deltas that
rose; median detection latency and escape rate with their trend; an offer to open a change for the first block of
the proposed order. Nothing is fixed unless the human asks.

Depth: [chapter 09](../../manual/09-periodic-audit.md), [chapter 15](../../manual/15-review-processes.md).
