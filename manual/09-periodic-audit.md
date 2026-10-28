# 09 · Periodic repo audit

**Rule:** every two weeks, or before closing a roadmap wave, run an audit across five dimensions with deterministic
metrics, a versioned report and a comparison with the previous one. No debt metric rises without a written reason.
Decided in an ADR.

## Why

Gates only fail on errors. In ten days, lint warnings went from 412 to 665; there were 29 active changes (6 at 90 %
and never archived, 6 never started), 3 `openspec validate` errors that no gate saw, and 19 undocumented
environment variables. Earlier reports went to a git-ignored folder, so there was nothing to compare against.

## The five dimensions

1. **Structure and invariants**, including the actual structure versus the documented one.
2. **Runtime logic and harness** (in an agent product: loop, policy, budget, idempotency).
3. **Format, docs and process**, including the development harness itself (hooks, skills, scripts).
4. **Scalability.**
5. **Security.**

## The deterministic part: `pnpm audit:repo [--write] [--deps] [--json]`

Seconds, no network (except `--deps`), no spend. It measures: lint warnings per rule; `any`, `as unknown as`,
`@ts-ignore`, `biome-ignore` (and those without a reason); files > 500 lines; TODO/FIXME/HACK; active, nearly done
(≥ 90 % with ≥ 5 tasks) and unstarted changes; `openspec validate` errors and warnings; `process.env.X` missing from
`.env.example`; secret patterns in tracked files (paths only, never values); draft ADRs; coverage floor and measured
value; days since the last audit. With `--write` it saves `openspec/audits/<date>.metrics.json`, and the next run
prints the deltas.

## The judgment part: the audit skill

Modes: `full`, `diff` or a single dimension. Runs in its own worktree; read-only; never spends; commits only its
report.

1. Context without subagents: the previous report and its open `AUD-*` items, `git log` and `git diff --dirstat`
   since its commit, `audit:repo`, `roadmap`.
2. Deterministic checks with the exact bash block and the known noise annotated.
3. Read-only subagents in parallel, one per dimension, launched in a single message, each with a full prompt:
   worktree path, constraints, changed areas, previous findings for that dimension, output format (severity,
   `file:line`, scenario, fix, confirmed vs suspected, stable `AUD-*` id, ≤ 700 words).
4. The main agent **re-checks every high finding in the code**, merges duplicates and marks each one new / open /
   resolved.
5. Report, `wt:commit`, `land`. A short summary in chat and an offer to open a change for the first block. **It
   fixes nothing unless asked.**

## The report (`openspec/audits/<date>.md`)

```
# Audit <date> · commit <sha> · scope <full|diff|dimension>
<context paragraph: machine conditions, how findings were verified>
## Deterministic checks              (table: check → result)
## Metrics                           (metric, value, Δ vs previous)
## Trend                             (new / still open / resolved)
## High / ## Medium (by dimension) / ## Low
### AUD-<topic> · <dimension> · confirmed|suspected · **resolved** (<change>)
    file:line · failure scenario · impact · fix
## What is working (do not break)    (verified controls that must not regress)
## Proposed order                    (fix blocks; which need a change or an ADR)
```

`AUD-*` ids are stable across audits. High = breaks an invariant, causes real bugs, is exploitable, or loses money
or data. Reports live in `openspec/audits/`, not in `docs/`, because the docs test requires every cited path to
exist and reports cite code that later moves.

## Trend rules

- No debt metric rises between two audits without a written reason in the report.
- When a metric reaches zero, its lint rule becomes `error` (ratchet).
- The "Known debt <date>" table in `quality.md` (debt / status / next step) is the baseline; current figures live
  in the latest report.
- `wt:setup` warns in every session if the last audit is more than 14 days old.

## What to copy into your repo

The metrics script of the reference implementation described in `reference/README.md` (adapt folders and patterns),
the audit skill (`skills/audit-repo/SKILL.md`) and the `quality-auditor` agent (`agents/quality-auditor.md`), the
report skeleton, and the staleness warning in the session hook.
