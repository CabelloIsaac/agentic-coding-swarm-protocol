# Adoption by levels

You do not need to adopt everything. Each level works on its own and prepares the next one. Tick the boxes in your
repo.
The authoritative list of what each level writes and which checks it must pass is the table at the top of
[skills/adopt/levels.md](skills/adopt/levels.md); these checklists follow it.

## Level 0 · In an hour (no new code)

- [ ] Copy `templates/CLAUDE.md` to the root and fill in the real commands (install, single-file test, types, lint).
      Under 200 lines. Keep only rules that are true for this repo today, and only the level-0 group of rules (the
      level-1 and level-2 groups come with their levels). Every rule ends with `(enforced: <path>)`, naming the
      test, hook, script or CI job that holds it, or with `(preference)`: be honest, a preference is fine as long as
      it is called one (the docs test checks the markers from level 2).
- [ ] Copy `templates/claude/settings.json` to `.claude/settings.json` (plugin users; it declares the plugin and has
      no session hooks) or `templates/claude/settings.no-plugin.json` (no plugin; it wires the session hooks):
      `deny` for `.env` and secrets, `ask` for `git push`.
- [ ] Add `CLAUDE.local.md`, `.claude/settings.local.json` and `.claude/worktrees/` to the root `.gitignore` (the one
      place that ignores worktrees); copy `templates/claude/.gitignore` to `.claude/.gitignore` (only the
      per-worktree ports file).
- [ ] Install the plugin (chapter 16 §0) and declare it in the project's `.claude/settings.json` (already in the
      template); or, without the plugin, copy `agents/` to `.claude/agents/` and `skills/` to `.claude/skills/`.
      Fastest: `/swarm:adopt 0`.
- [ ] Agree on per-change review: `reviewer` after every non-trivial change, `security-reviewer` on sensitive paths
      (chapter 15).
- [ ] Agree as a team: **one session = one worktree** (`claude -w <task>`) and nobody edits the main checkout.
- [ ] Create `docs/adr/` with `templates/adr/0000-template.md` and `templates/adr/README.md` (the index with its
      generated markers) and write ADR-0001 about adopting this flow.
- [ ] Print `checklists/`.

## Level 1 · In a day (one gate)

- [ ] A `verify` script (start from `reference/scripts/verify.ts`; see `reference/README.md`): lint, types,
      tests with coverage; `--quick` on changed files; summary + tail; logs on disk; process groups with timeouts.
- [ ] CI (`templates/github/workflows/ci.yml`) that calls the same commands, without secrets, plus documented extra
      jobs where they apply (CI ⊇ verify: backend parity, image without secrets, backup/restore roundtrip).
- [ ] Domain contract validators for the project's own data files, as a `verify` step.
- [ ] Coverage floor at measured minus half of `maxGap` (what `ratchets.ts --tighten` writes), in
      `vitest.config.ts`; `allowOnly: false` in CI.
- [ ] Ratchets: `templates/quality-ratchets.json` at the root, initialized with `ratchets.ts --init`
      (`reference/scripts/ratchets.ts`): no new file over 500 lines and oversized ones only shrink, the coverage
      floor at most one point under measured, a lint warning budget. `verify` checks them after the tests (`--quick`:
      file size of the changed files). Tightening by `land` arrives with level 2 (chapter 07, Ratchets).
- [ ] The level-1 group of `CLAUDE.md` rules (gates, secrets scan, ratchets) and the secret-scan job of `ci.yml`.
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
- [ ] Review gate: the `review` block in `swarm.json` with the project's core paths added to `sensitive` (or
      `mode: always` for a library), and a first receipt from the `review` skill; `land` tightens the ratchets.
- [ ] Findings ledger and closure gate: `reference/scripts/findings.ts` as `scripts/dev/findings.ts`,
      `commands.findings` and the `findings` block in `swarm.json` (SLA 2 / 14 / 60 days, `closureEvery` 3), and the
      findings gates of `land` (SLA and closure quota). Seed `docs/audits/findings.jsonl` from the last audit: one
      `findings add` per open finding, keeping its real `--opened` date (the example in
      `templates/docs/audits/findings.jsonl` shows the format; do not keep its lines), then **set an owner on every
      open HIGH** (`findings assign <id> --owner <name>`): conformance L2.8 fails without it. From then on land refuses an
      overdue HIGH and a streak of lands that close nothing; `Closes: <id>` in a commit message is how work closes
      a finding. Expect the first lands to be refused: that is the point.
- [ ] The level-2 group of `CLAUDE.md` rules, and `AGENTS.md`.
- [ ] An invariants table (start with 5) and its architecture test (`templates/tests/architecture.test.ts`).
- [ ] A documentation test (`templates/tests/docs.test.ts`): links, paths, new undocumented structure, and the
      rule markers of `CLAUDE.md` (every `enforced:` path exists).
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

## Transferability track (alongside the levels; required before a handover)

So that another team can absorb the project (chapter 18). Independent of the levels: start once level 1 is green.
Check with `/swarm:adopt --check transfer`; all five must pass before the project is called "absorbable". (Not to be
confused with the T0–T3 land tiers of level 4.)

- [ ] **X1 · fresh clone:** one `commands.setup` in `swarm.json` takes a clean clone to a green `verify`;
      `templates/github/workflows/fresh-clone.yml` runs it weekly with no caches.
- [ ] **X2 · new-agent test:** `docs/handover/reference-task.md` from `templates/handover/reference-task.md`;
      `templates/github/workflows/new-agent-test.yml` weekly with turn and budget caps (ask first: it spends and
      sends code to a model); a passing report under 30 days old.
- [ ] **X3 · ownership:** `.github/CODEOWNERS` from `templates/CODEOWNERS`; `docs/runbook.md` from
      `templates/docs/runbook.md`; `docs/dependencies.md` from `templates/docs/dependencies.md`.
- [ ] **X4 · no hidden knowledge:** the audit counts env vars, external services, scheduled jobs and active work that
      live outside their documented place; the count is zero.
- [ ] **X5 · handover checklist:** `checklists/handover.md` copied to `docs/handover/checklist.md`.
- [ ] Incidents end with the `learn` skill: a rule with a mechanism, not a note in someone's memory.

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
