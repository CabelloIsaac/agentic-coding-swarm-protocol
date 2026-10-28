---
name: change
description: Runs a spec-driven change through its lifecycle (explore, propose, apply, verify, archive) with the OpenSpec CLI or the repo's own spec tool. Use before implementing a new feature or any behavior change, when the user asks to explore, propose, spec, plan, continue, implement, verify or archive a change, when tasks.md has open tasks, or when code is about to change behavior with no change behind it. Not for typos, docs-only edits or refactors that keep behavior.
argument-hint: "[explore|propose|apply|verify|archive] [change-name]"
---

# change

Say at the start: "Using change (<phase>, <name>)."

Arguments: `$ARGUMENTS`. A phase and a kebab-case change name. Without a phase, infer it from the change's state
(table below); without a name, run `{spec} list --json` and ask which one, unless exactly one is active.

**Resolve the commands first.** `{spec}` is the spec tool the repo's `CLAUDE.md` names; default `npx openspec`.
`{roadmap}` is the repo's roadmap command (default `pnpm roadmap`; skip it if the repo has no roadmap). `{verify}`,
`{verifyQuick}`, `{commit}` and `{land}` come from `swarm.json` as in the `verify` and `land` skills
([INTEGRATION.md](../../INTEGRATION.md)). Another spec tool (spec-kit, Kiro-style specs, a plain folder of
Markdown): map each phase with [tools.md](tools.md) and keep the gates.

## The gates

1. **No behavior change without a change.** Code that alters what users, callers or operators can observe has an
   active change behind it whose specs describe that behavior.
2. **No archive while `{spec} validate <name> --strict` fails, or while any task is unchecked** unless it is marked
   `(outside the repo)` with an owner and where it is tracked.

Why: in the reference project, ten days without these gates produced 19 changes at 90 % never archived, 19 with
no task done, about 50 feature commits that named no change, and 78 of 87 main specs with an empty Purpose. Two
changes failed validation for days because nothing ran it (chapter 06, chapter 09).

## When not to use it

- A typo, a docs-only edit, a dependency bump or a refactor that keeps behavior: no change; `verify` still closes it.
- A bug that breaks behavior an existing spec already describes: `tdd` skill; the spec stays as it is.
- A decision about a contract, an invariant, the shape of a run or a formula: the change **and** a draft ADR
  (`new-adr` skill), cited from `design.md`.
- A new kind of piece (integration, tool, event log, UI section…): the change plus the `extend` skill for the guide.

## Phases

| Phase | When | Core commands | Leaves the phase when | Detail |
| --- | --- | --- | --- | --- |
| explore | the problem or the approach is unclear | `{spec} list --json`; read code and artifacts | problem, approach and open questions written down | [explore.md](explore.md) |
| propose | the folder is missing or an artifact is not `done` | `{spec} new change <name>`; `{spec} status --change <name> --json`; `{spec} instructions <artifact> --change <name> --json` | proposal, specs, design and tasks are `done` and validate | [propose.md](propose.md) |
| apply | tasks are unchecked | `{spec} instructions apply --change <name> --json` | every task checked with its check run, or marked outside the repo | [apply.md](apply.md) |
| verify | all tasks are checked or marked | `{spec} validate <name> --strict`; `{verify}` | no critical issue; every requirement has a tested scenario | [verify.md](verify.md) |
| archive | verify is clean | `{spec} archive <name> -y`; `{spec} validate --all`; `{roadmap}` | change in the archive, main specs with a Purpose, roadmap consistent | [archive.md](archive.md) |

Read only the detail file of the phase you are in. Phases are not locked: when applying reveals a design flaw,
update `design.md` or the specs first, then carry on.

## Steps

1. **Locate.** `{spec} list --json`, then `{spec} status --change <name> --json`. Name the phase from the table.
2. **Check the roadmap.** The change must have a roadmap entry (block, wave, priority). If it has none, add it in the
   same commit as the folder; never start a low-priority or frozen change without changing the roadmap first.
   **Check the WIP limit before proposing:** run `{roadmap}`; if it reports more active changes than
   `roadmap.maxActive` or stale ones, finish, archive or park something first. A new change opens only after one
   closes.
3. **Run the phase** from its detail file. Each phase ends with its exit condition, not with a feeling of being
   done.
4. **Commit per task group** with `{commit}`; integrate with `{land}` only after the verify phase is clean.

## Red flags

Each row is a failure the reference project's audits recorded.

| Thought | Reality |
| --- | --- |
| "Its work moved into another change; the folder can stay." | Two absorbed changes stayed active for weeks and skewed every count. Archive it with a note naming the absorber; move its open tasks there. |
| "I will add a task 'verify green' / 'archive the change'." | Meta-tasks stay unchecked forever and make a finished change look 90 % done. `land` already enforces verify. Tasks name product work and its check. |
| "I will open the change now and start it later." | 6, then 19 changes sat at zero tasks done for weeks, inflating the active list. Work not started yet is a roadmap entry without a folder (status `planned`). |
| "It is small; it does not need a change." | About 50 feature commits named no change, and their behavior is now in no spec. Small changes get small changes. |
| "Archiving filled Purpose with TBD; fine." | 78 of 87 specs ended up with an empty Purpose. Write it while you still know why the capability exists. |
| "That pending task is someone else's." | Stale tasks lied for weeks ("the CLI is not installed" when it ran through `npx`; a task closed by an already archived change). Re-check every unchecked task: done, obsolete with a reason, or outside the repo. |
| "MODIFIED only needs the scenario I changed." | Omitting the existing scenarios broke validation for two changes; archiving would have deleted them. Copy the whole requirement block. |
| "I will validate at the end." | Validation outside the gate found 3 errors nobody had seen. Run `{spec} validate <name> --strict` after every artifact edit. |

## Report

```
change: <name> · phase <phase> · artifacts 4/4 · tasks 12/14 (2 outside the repo: 5.3 owner, 6.2 owner)
validate: npx openspec validate <name> --strict → ✓ | ✗ <first error>
coverage: 7 requirements · 15 scenarios · 15 with a named test | gaps: <requirement › scenario>
roadmap: <id> · wave <n> · <priority> · status derived: active | done
next: <the next command or task>
```

Depth: [chapter 06](../../manual/06-changes-and-roadmap.md) (artifacts, roadmap, configuration rules),
[chapter 05](../../manual/05-architecture-and-docs.md) (the six-step flow for any change).
