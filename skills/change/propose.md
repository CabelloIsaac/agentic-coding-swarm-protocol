# Phase: propose

Four artifacts, in dependency order: `proposal.md` → `specs/<capability>/spec.md` → `design.md` → `tasks.md`.
Templates: `templates/openspec/` in the protocol repo (`proposal.md`, `spec.md`, `tasks.md`, `roadmap.yaml`).

## Create or continue

0. **WIP limit first.** `{roadmap}` must pass before a new change is created: no more than `roadmap.maxActive`
   active changes and none stale. If it fails, close or park something instead of opening another.
1. Name: kebab-case, verb first (`add-invoice-rounding`, `fix-retry-duplicates`). If a change with that name or the
   same intent is already active, continue it instead of creating another.
2. `{spec} new change <name>`, then `{spec} status --change <name> --json`: it lists each artifact as `done`,
   `ready` (dependencies satisfied) or `blocked`.
3. For each `ready` artifact: `{spec} instructions <artifact> --change <name> --json`. Use its `template` as the
   structure and write to its `outputPath`. Its `context` and `rules` are **constraints for you**, not content:
   never copy them into the file. Read the completed dependencies first.
4. Stepwise (the default when the scope is still moving): write one artifact, show it, stop for the human.
   Fast-forward (when the human asked for it or the scope is settled): write every artifact up to the ones `apply`
   requires, rechecking `status` after each.
5. After each artifact: `{spec} validate <name> --strict`. Fix before writing the next one.
6. Add the roadmap entry (id, title, block, wave, priority, `depends_on`) in the same commit as the folder.

## proposal.md

| Section | Passes when |
| --- | --- |
| Why / Problem and evidence | the problem with real data, source and date; facts apart from hypotheses |
| What changes | the observable behavior, in bullets; breaking changes marked |
| Capabilities | new and modified capabilities, by name: **each one gets a spec file** |
| Outcome and measure | what will be different and how it is measured, with a baseline |
| Alternatives | each with why it lost, **including "do nothing"** |
| Impact | code areas, contracts, data, operations, docs; ADR needed or not |

At least a few real sentences per section. A proposal that cannot state its evidence is not ready: go back to
explore.

## `specs/<capability>/spec.md` (delta)

```markdown
## ADDED Requirements

### Requirement: Invoice totals are rounded half-even
The system SHALL round every invoice total to two decimals using half-even rounding.

#### Scenario: Tie rounds to even
- **WHEN** a total is 10.005
- **THEN** the stored total is 10.00
```

- Sections: `ADDED`, `MODIFIED`, `REMOVED`, `RENAMED` (`- FROM: … / - TO: …`).
- SHALL / MUST / MUST NOT; one behavior per requirement; every requirement has at least one scenario.
- **A MODIFIED requirement copies the whole existing block, scenarios included**, then edits it. Archiving replaces
  the block: whatever you leave out is deleted from the main spec.
- Testable without network or keys: a scenario that needs a live API is a manual check task, not a spec scenario.
- Keep requirements short; split one over ~500 characters.

## design.md

`Context` · `Goals / Non-goals` · `Decisions` (`### D1. …`, each with the rejected alternatives) · `Risks /
Trade-offs` (`[risk] → mitigation`) · `Migration plan` · `Open questions`. A decision that changes a contract,
an invariant, the shape of a run or a formula needs a draft ADR (`new-adr` skill) that cites "design D1–Dn".

## tasks.md

```markdown
## 1. Rounding
- [ ] 1.1 Half-even helper with tests for ties, negatives and zero (`pnpm vitest run src/billing/round.test.ts`)
- [ ] 1.2 Invoice totals use the helper; scenario "Tie rounds to even" has a test

## 2. Documentation and close-out
- [ ] 2.1 Billing area architecture doc and README updated
- [ ] 2.2 (outside the repo) Measure the outcome at 4 weeks: disputed invoices vs baseline — owner: finance lead, tracked in <tracker>
```

- Groups `## N. <group>`, tasks `- [ ] N.M <task>`, small enough for one session each.
- **Every task names its check**: a test, a command or a specific visual check. A task without a check cannot be
  ticked honestly.
- **No meta-tasks.** "Verify green", "archive the change", "run land" are guaranteed by the gate and the process;
  as tasks they only stay open and make finished work look unfinished.
- Each spec scenario maps to a task that writes its test.
- The last group is documentation and close-out; the last task starts with "Measure the outcome".
- Work that happens outside the code (a pilot customer, a partner's confirmation, a measurement after release) is
  marked `(outside the repo)` with an owner and where it is tracked, from the start.

## Exit

`{spec} status --change <name>` shows every artifact `done`, `{spec} validate <name> --strict` passes and the
roadmap command accepts the entry. Report the artifacts written and stop if the human wants to review before apply.
