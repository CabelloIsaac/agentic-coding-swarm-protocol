# Phase: apply

Implement the tasks one by one, each with its test, ticking each box only after its check ran.

## Start

1. Announce: "Using change: <name>". Infer the change from the conversation; if only one is active, use it; if it is
   ambiguous, ask.
2. `{spec} instructions apply --change <name> --json`. It returns the context files, the progress and a state:
   - `blocked` (an artifact is missing): go back to propose for that artifact.
   - `all_done`: go to verify.
   - otherwise: continue.
3. Read every context file it lists (proposal, specs, design, tasks). Do not implement from the task titles alone.

## The loop, per task

```
- [ ] Read the task and the requirement or decision it serves
- [ ] Write the test first and watch it fail (tdd skill)
- [ ] Minimal code to pass it, inside the task's scope
- [ ] Run the task's own check (the test, command or visual check it names)
- [ ] Tick it: - [ ] → - [x], in the same commit as the code
```

- `{verifyQuick}` after each meaningful edit; `{commit}` after each task group.
- New pieces (an integration, a tool, an event log, a UI section…) follow the repo's extension guide: `extend`
  skill.
- Scope creep: work the change did not plan becomes a new task in `tasks.md` (with its check) or a separate change,
  never silent extra code.

## Pause and ask when

- A task is ambiguous, or two readings lead to different behavior.
- The implementation shows the design is wrong: update `design.md` or the specs first (the phases are not locked),
  validate, then continue.
- A blocker you cannot remove within scope (missing access, a dependency on another change, a spend decision).

Pause with: progress (N/M), the issue, two or three options and your recommendation.

## Tasks you cannot finish here

- **Outside the repo** (needs a customer, a partner, a measurement in production): leave it unchecked and prefix it
  `(outside the repo)` with owner and tracker. It does not block archive.
- **Obsolete** (the need disappeared, another change did it): strike it with the reason and the commit or change
  that made it obsolete: `- [x] ~~3.2 …~~ obsolete: done by <change> (<sha>)`. Never just delete it.
- **Absorbed into another change**: move the task there, note the move in both `tasks.md` files and in the
  roadmap (`absorbed_by`).

## Exit

Every task is `[x]` with its check run, struck with a reason, or marked outside the repo. Show:

```
change: <name> · tasks 14/14 (1 outside the repo) · this session: 1.1–2.3
next: verify phase
```
