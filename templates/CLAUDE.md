# <Project> — repository rules

Read by agents and people. If a rule stops you from doing something, do not work around it: propose the
architecture change (change + ADR) and update the documentation. Under 200 lines: long material goes in `docs/` or
in skills.

## Before touching anything

- Priorities: `openspec/roadmap.yaml` (`pnpm roadmap`). Do not start work outside it without changing it first.
- Architecture and invariants: `docs/architecture.md` (§ invariants). Quality: `docs/quality.md`. Index: `docs/README.md`.
- To add a new piece, follow its guide in `docs/extending/`.
- Behavior changes: an OpenSpec change (proposal → specs → design → tasks → implement → validate → archive).

## Parallel work (ADR-0001)

- One session = one worktree = one branch: `claude -w <task>`. Never edit or commit in the main checkout.
- Commit with `pnpm wt:commit "<message>"`: it absorbs the `wip:` commit left by the `Stop` hook. A plain
  `git commit` on top of a `wip:` buries it, and `land` then refuses the branch.
- Integrate with `pnpm land`. On conflict, resolve it yourself on your branch with `git rebase main` and repeat.
- Worktrees have no `.env`: real spend happens only from the main checkout.
- At most <N> sessions verifying at once; stop the dev server when you are done looking at it.

## Invariants that do not break (tests in `<path>/architecture.test.ts`)

Cite them by their table id, never by position (the docs test rejects any other numbering).

- INV-01 <Only `src/storage` accesses storage.>
- INV-02 <Event logs are append-only and every record carries `schema_version`.>
- INV-03 <Every external effect is idempotent.>
- INV-04 <Completed = verified: without an evaluation, `skipped`.>
- INV-05 <Every spend is checked against the budget before it happens.>

## Documentation is part of the change

`<path>/docs.test.ts` fails if the docs cite files or functions that do not exist, or if new structure appears
undocumented. A new architecture decision = `docs/adr/draft-<slug>.md` (land assigns its number).

## Verification

- While iterating: `pnpm verify --quick`. A single file: `pnpm vitest run <path>`.
- Before treating anything as done, and what `land` requires: `pnpm verify` (the same as CI). The quick level is
  not enough: `--changed` does not see tests that read YAML or templates without importing them.
- Always show the command and its output.
- After a non-trivial change, independent review with the `reviewer` agent; on sensitive paths, `security-reviewer`.

## Spend and data

- Develop with `--mode mock` / `--llm mock`; reproduce with `--llm replay`.
- Never print or commit secrets.
- Seed data is read-only: test on copies.

## Decisions and questions

- Within accepted scope, do not ask "should I continue?".
- If you ask: Context, Challenge, Concern, Recommendation, Impact, Reversible, Evidence.
- Declare what you decide without asking in the commit: `Assumption: <what> — <why>`.

## Style

- Strict TypeScript, ESM, Zod for every contract. No `any` or `@ts-ignore`; `x!` only with the invariant in view.
- Suppressions with a reason: `// biome-ignore lint/<group>/<rule>: <reason>`.
- Files over ~500 lines are split by responsibility. The coverage floor only goes up.
- Comments explain why. Tests next to the code (`*.test.ts`); e2e as `*.e2e.test.ts`.
- Code in English; docs and UI in <language>.
