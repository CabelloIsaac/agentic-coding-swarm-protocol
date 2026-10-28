# What each level writes

Read only the section for the level you are applying. Sources are relative to this plugin; destinations are in the
target repo. Merge every destination that already exists. The checks that prove each level are INTEGRATION.md §6.

## Contents

- Level 0 · manifest and agent memory
- Level 1 · one gate
- Level 2 · worktrees, integration, structure
- Level 3 · governance

## Level 0 · manifest and agent memory

1. `swarm.json` from `${CLAUDE_SKILL_DIR}/../../templates/swarm.json`, with `"level": 0`, the detected
   `integrationBranch`, and the `commands` the user confirmed in the plan (stack mapping: INTEGRATION.md §4). Leave
   out keys whose commands do not exist yet; skills fall back and say so.
2. `CLAUDE.md` from `${CLAUDE_SKILL_DIR}/../../templates/CLAUDE.md`, with the real commands (install, single-file
   test, types, lint, verify). Under 200 lines. If one exists, merge section by section.
3. `.claude/settings.json` from `${CLAUDE_SKILL_DIR}/../../templates/claude/settings.json`: `deny` for `.env*` and
   secret files, `ask` for `git push *`, `allow` for the verify commands; plus `extraKnownMarketplaces` and
   `enabledPlugins` for `swarm@agentic-coding-swarm-protocol` (chapter 16 §0). Merge; remove nothing.
4. `.gitignore`: `CLAUDE.local.md`, `.claude/settings.local.json`, `.claude/worktrees/`.
5. `docs/adr/0000-template.md` from `${CLAUDE_SKILL_DIR}/../../templates/adr/0000-template.md`, `docs/adr/README.md`
   with the `<!-- generated:adr-index -->` markers, and the adoption ADR draft from the plan.

Evidence: `git diff --stat`; `node -e "JSON.parse(require('fs').readFileSync('swarm.json','utf8'))"` and the same
for `.claude/settings.json` (or `python3 -m json.tool`); `--check 0`.

## Level 1 · one gate

1. A single verify entry point that runs exactly the CI steps. Node: start from
   `${CLAUDE_SKILL_DIR}/../../reference/scripts/verify.ts` (replace `fullSteps()` with the real CI steps and
   `quickSteps()` with their changed-files equivalents; temp prefix = project name). Other stacks: `make verify` or
   equivalent, per INTEGRATION.md §4. It must meet the guarantees in INTEGRATION.md §2.
2. Set `commands.verify` and `commands.verifyQuick` in `swarm.json`.
3. CI calls the same entry point (merge with the existing workflow; template
   `${CLAUDE_SKILL_DIR}/../../templates/github/workflows/ci.yml`). No secrets in the quality job.
4. Coverage floor: measure first, set it 1–2 points below; `.only` forbidden in CI.
5. `docs/quality.md` from `${CLAUDE_SKILL_DIR}/../../templates/docs/quality.md`.

Evidence: both gates green with their last lines pasted; `--check 1`.

## Level 2 · worktrees, integration, structure

Depends on the scenario (chapter 16 §0):

- **A (single workstation, small team):** from `${CLAUDE_SKILL_DIR}/../../reference/scripts/`: `land.ts`, `git.ts`,
  `remote.ts`, `adr.ts`, `wt.ts`, `procs.ts`, `dev-flow.config.ts`, parameterized; test temp-file hygiene from
  `${CLAUDE_SKILL_DIR}/../../reference/tests/`; the `pre-push` publisher guard from
  `${CLAUDE_SKILL_DIR}/../../templates/githooks/pre-push` with `git config core.hooksPath`.
- **B, D, E (slow CI, PR teams, several machines):** `wt.ts` and `adr.ts`, but `land` in PR mode (rebase, quick
  gate, push the branch, PR with auto-merge; the merge queue runs the full gate and numbers ADRs). Branch
  protection instead of the publisher hook.
- **C (monorepo):** as A or D, with the quick gate per affected package and a `CLAUDE.md` per package.

Then, in every scenario:

1. `commands.commit`, `commands.status`, `commands.land`, `commands.newAdr` and `hooks.sessionStart`/`hooks.stop`
   in `swarm.json`. The plugin hooks run them (INTEGRATION.md §3).
2. An invariants table (propose five to the user) and the architecture test from
   `${CLAUDE_SKILL_DIR}/../../templates/tests/architecture.test.ts`, inside verify.
3. The docs test from `${CLAUDE_SKILL_DIR}/../../templates/tests/docs.test.ts`, inside verify.
4. `AGENTS.md` from `${CLAUDE_SKILL_DIR}/../../templates/AGENTS.md` for agents without plugins (INTEGRATION.md §5),
   or a pointer to `CLAUDE.md`.

Evidence: a trivial `docs/` change landed (or its PR opened) with the output shown; `--check 2`.

## Level 3 · governance

Only after levels 0–2 have run for about two weeks.

1. OpenSpec (`openspec init`, with the user's agreement) and a roadmap with its validator inside verify
   (`${CLAUDE_SKILL_DIR}/../../reference/scripts/roadmap.ts`, templates in
   `${CLAUDE_SKILL_DIR}/../../templates/openspec/`).
2. The audit metrics script (`${CLAUDE_SKILL_DIR}/../../reference/scripts/audit.ts`) → `commands.audit`; a first
   run of the `audit-repo` skill as the baseline.
3. Scheduled reviews (`${CLAUDE_SKILL_DIR}/../../templates/review/`,
   `${CLAUDE_SKILL_DIR}/../../templates/github/workflows/weekly-review.yml`). **Ask first**: they spend money and
   send code to a model, so the user decides on budget and data policy.

Evidence: `--check 3`.
