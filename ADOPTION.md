# Adoption by levels

You do not need to adopt everything. Each level works on its own and prepares the next one. Tick the boxes in your
repo.

## Level 0 · In an hour (no new code)

- [ ] Copy `templates/CLAUDE.md` to the root and fill in the real commands (install, single-file test, types, lint).
      Under 200 lines.
- [ ] Copy `templates/claude/settings.json` to `.claude/settings.json`: `deny` for `.env` and secrets, `ask` for
      `git push`.
- [ ] Add `CLAUDE.local.md` and `.claude/settings.local.json` to `.gitignore`; copy `templates/claude/.gitignore` to
      `.claude/.gitignore` (session worktrees and the per-worktree ports file stay local).
- [ ] Install the plugin (chapter 16 §0) and declare it in the project's `.claude/settings.json`; or, without the
      plugin, copy `agents/` to `.claude/agents/` and `skills/` to `.claude/skills/`. Fastest:
      `/swarm:adopt 0`.
- [ ] Agree on per-change review: `reviewer` after every non-trivial change, `security-reviewer` on sensitive paths
      (chapter 15).
- [ ] Agree as a team: **one session = one worktree** (`claude -w <task>`) and nobody edits the main checkout.
- [ ] Create `docs/adr/` with `templates/adr/0000-template.md` and write ADR-0001 about adopting this flow.
- [ ] Print `checklists/`.

## Level 1 · In a day (one gate)

- [ ] A `verify` script (start from `reference/scripts/verify.ts`; see `reference/README.md`): lint, types,
      tests with coverage; `--quick` on changed files; summary + tail; logs on disk; process groups with timeouts.
- [ ] CI (`templates/github/workflows/ci.yml`) that calls the same commands, without secrets, plus documented extra
      jobs where they apply (CI ⊇ verify: backend parity, image without secrets, backup/restore roundtrip).
- [ ] Domain contract validators for the project's own data files, as a `verify` step.
- [ ] Coverage floor just below what is measured, in `vitest.config.ts`; `allowOnly: false` in CI.
- [ ] `docs/quality.md` from `templates/docs/quality.md`: types, suppressions with a reason, tests, flakiness.
- [ ] The `verify` skill (`skills/verify/`).
- [ ] Branch protection on GitHub: CI required.

## Level 2 · In a week (integration and structure)

- [ ] `land` (start from `reference/scripts/land.ts` + `git.ts` + `remote.ts`): lock, fetch and abort on foreign commits, rebase, reinstall if the lockfile changes, full verify,
      ff-only, push, JSONL log.
- [ ] `SessionStart` (worktree setup, notices) and `Stop` (rolling wip) hooks with `wt.ts`; `wt:commit`,
      `wt:status`, `wt:gc`, `wt:reap`, `wt:archive`.
- [ ] A `pre-push` hook that lets only the publisher push the integration branch (`templates/githooks/pre-push`).
- [ ] ADRs as drafts numbered on integration (`reference/scripts/adr.ts`) and a generated index.
- [ ] An invariants table (start with 5) and its architecture test (`templates/tests/architecture.test.ts`).
- [ ] A documentation test (`templates/tests/docs.test.ts`): links, paths, new undocumented structure.
- [ ] Temp-file hygiene in tests (`reference/tests/cleanup-tmp.ts`, `vitest-setup.ts`) and a slowest-first sequencer.

## Level 3 · In a month (governance)

- [ ] OpenSpec (or equivalent) with `templates/openspec/`: proposal with problem/measure/alternatives, scenarios,
      verifiable tasks.
- [ ] `roadmap.yaml` with derived status and a validator (`reference/scripts/roadmap.ts`).
- [ ] `docs/extending/` guides with the nine-section template (`templates/docs/extending/guide-template.md`), one
      per kind of piece that gets added often.
- [ ] Biweekly audit: `audit:repo` (`reference/scripts/audit.ts`) + the `audit-repo` skill + reports in
      `openspec/audits/` + an overdue notice in `SessionStart`.
- [ ] Scheduled reviews (chapter 15): `daily-health` every weekday morning and `weekly-quality` on Mondays, with
      `/schedule` or with `templates/github/workflows/weekly-review.yml` (prompts in `templates/review/`). Read-only,
      with turn and spend caps. Watch the first three runs before trusting them.
- [ ] `playground/` quarantined by a test.

## Level 4 · Autonomy (once there are metrics)

- [ ] Count and classify your interventions for two weeks (chapter 12).
- [ ] Question card and `Assumption:` trailers in `CLAUDE.md`.
- [ ] T0–T3 tiers in `land`, in report mode for three days, then enforced.
- [ ] Rollback criteria written with numbers.

## For high-demand teams (alongside the levels)

- [ ] Apply the profile in chapter 16, section 11: short `CLAUDE.md`, unrelated skills and MCP servers disabled,
      medium effort by default, `haiku` for mechanical subagents, a cap on simultaneous verifications.
- [ ] Measure the baseline (cost per integrated change, p50 land duration, interventions per session) before
      optimizing.
- [ ] Every unattended run with `--bare`, `--max-turns` and `--max-budget-usd`.

## What to adapt every time

| Parameter | In the reference project | In your repo |
| --- | --- | --- |
| Integration branch | `master` | probably `main` |
| Package manager | pnpm 10 | yours; change `INSTALL_CMD` and the watched lockfile |
| Verify steps | lint, tsc ×3, 2 contract validators, openspec, vitest + coverage | your CI's steps |
| Temp-file prefix | the project name | `<project>-` |
| Publisher flag | `<project>.publisher` | `<project>.publisher` |
| Ports per worktree | 3200 + hash | your apps' ranges |
| Dev processes to reap | node, tsx, vitest, next, esbuild | yours |
| Language | docs in Spanish, code in English | write down your policy |

## How to know it works

Measure before and after two weeks: % of lands without conflict, p50 land duration, attempts per land, CI failures on
the integration branch (target: zero), human interventions per session, cost per integrated change. Write down the
criterion that would make you roll back before you start.
