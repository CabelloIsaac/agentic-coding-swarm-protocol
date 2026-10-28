# <Project> — repository rules

Read by agents and people. If a rule stops you from doing something, do not work around it: propose the
architecture change (change + ADR) and update the documentation. Under 200 lines: long material goes in `docs/` or
in skills.

Every rule ends with the mechanism that enforces it, `(enforced: <path>, …)` naming a test, hook, script, config or
CI job that exists, or with `(preference)` when only review and habit hold it. The docs test checks the markers and
the paths. A rule without a mechanism erodes: make it enforced, or call it a preference.

## Before touching anything

- Priorities: `openspec/roadmap.yaml` (`pnpm roadmap`). Do not start work outside it without changing it first. (preference)
- Architecture and invariants: `docs/architecture.md` (§ invariants). Quality: `docs/quality.md`. Index:
  `docs/README.md`. (enforced: test/docs.test.ts)
- To add a new piece, follow its guide in `docs/extending/`. (preference)
- Behavior changes: an OpenSpec change (proposal → specs → design → tasks → implement → validate → archive). (preference)

## Parallel work (ADR-0001)

- One session = one worktree = one branch: `claude -w <task>`. Never edit or commit in the main checkout.
  (enforced: scripts/dev/land.ts, .githooks/pre-push)
- Commit with `pnpm wt:commit "<message>"`: it absorbs the `wip:` commit left by the `Stop` hook. A plain
  `git commit` on top of a `wip:` buries it, and `land` then refuses the branch. (enforced: scripts/dev/land.ts)
- Integrate with `pnpm land`. On conflict, resolve it yourself on your branch with `git rebase main` and repeat.
  (enforced: .githooks/pre-push)
- Worktrees have no `.env`: real spend happens only from the main checkout. (enforced: scripts/dev/land.ts)
- At most <N> sessions verifying at once; stop the dev server when you are done looking at it. (preference)

## Invariants that do not break (tests in `test/architecture.test.ts`)

Cite them by their table id, never by position (the docs test rejects any other numbering).

- INV-01 <Only `src/storage` accesses storage.> (enforced: test/architecture.test.ts)
- INV-02 <Event logs are append-only and every record carries `schema_version`.> (enforced: test/architecture.test.ts)
- INV-03 <Every external effect is idempotent.> (enforced: test/architecture.test.ts)
- INV-04 <Completed = verified: without an evaluation, `skipped`.> (enforced: test/architecture.test.ts)
- INV-05 <Every spend is checked against the budget before it happens.> (enforced: test/architecture.test.ts)

## Documentation is part of the change

- The docs may only cite files and functions that exist, and new structure is documented in the same change.
  (enforced: test/docs.test.ts)
- A new architecture decision = `docs/adr/draft-<slug>.md`; land assigns its number. (enforced: scripts/dev/adr.ts)
- Every rule in this file names its mechanism or says it is a preference. (enforced: test/docs.test.ts)

## Verification

- While iterating: `pnpm verify --quick`. A single file: `pnpm vitest run <path>`. (preference)
- Before treating anything as done, and what `land` requires: `pnpm verify` (the same as CI). The quick level is
  not enough: `--changed` does not see tests that read YAML or templates without importing them.
  (enforced: scripts/dev/land.ts, .github/workflows/ci.yml)
- Debt only goes down: no new file over 500 lines, no oversized file grows, the coverage floor follows what is
  measured, the lint warning budget never rises. `land` tightens the numbers. (enforced: scripts/dev/ratchets.ts, quality-ratchets.json)
- Always show the command and its output. (preference)
- After a non-trivial change, independent review with the `reviewer` agent; on sensitive paths, `security-reviewer`.
  (preference)

## Spend and data

- Develop with `--mode mock` / `--llm mock`; reproduce with `--llm replay`. (preference)
- Never print or commit secrets. (enforced: .claude/settings.json)
- Seed data is read-only: test on copies. (preference)

## Decisions and questions

- Within accepted scope, do not ask "should I continue?". (preference)
- If you ask: Context, Challenge, Concern, Recommendation, Impact, Reversible, Evidence. (preference)
- Declare what you decide without asking in the commit: `Assumption: <what> — <why>`. (preference)

## Style

- Strict TypeScript, ESM, Zod for every contract. No `any` or `@ts-ignore`; `x!` only with the invariant in view.
  (enforced: tsconfig.json, biome.json)
- Suppressions with a reason: `// biome-ignore lint/<group>/<rule>: <reason>`. (enforced: biome.json)
- Files over ~500 lines are split by responsibility, not by line count. (enforced: scripts/dev/ratchets.ts, quality-ratchets.json)
- Comments explain why. Tests next to the code (`*.test.ts`); e2e as `*.e2e.test.ts`. (preference)
- Code in English; docs and UI in <language>. (preference)
