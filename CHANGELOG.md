# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-10-28

The theme of this release: every rule the protocol states now has a mechanism, the mechanisms are tested, and a
project can prove that another team could absorb it.

### Added

- **Quality ratchets.** `reference/scripts/ratchets.ts` and `templates/quality-ratchets.json` turn "only goes down"
  rules into checks: no new file over 500 lines and oversized files only shrink; the coverage floor is neither above the
  measured value nor more than `maxGap` below it ("raise the floor to X"); a lint warning budget, total and per rule
  (Biome or ESLint JSON). The full `verify` runs them after the tests and `--quick` checks file size on changed files.
  After a green verify, `land` tightens the file and commits it alone (`chore: tighten quality ratchets`) on top of the
  verified SHA, aborting if that commit touches anything else. Conformance check L1.6, optional `commands.ratchets`,
  and a guarantee row in `INTEGRATION.md` §2. Manual chapter 07 gains a "Ratchets" section.
- **Every rule names its mechanism.** Each rule in `templates/CLAUDE.md` ends with `(enforced: <path>)` or
  `(preference)` (33 rules, 14 preferences). The docs-test templates fail on a rule without a marker or an enforced
  path that does not exist. Conformance check L0.6.
- **Review as a gate (L2.7).** `checklists/defect-classes.md` lists 46 defect classes (`DC-<area>-<nn>`) distilled
  from about 60 findings of two whole-repo audits: symptom in a diff, why it hurts, how to detect it, the fix, and
  whether a diff review can catch it or it needs a whole-repo audit. `reviewer`, `security-reviewer` and
  `test-auditor` check every diff against the diff-catchable classes and cite DC ids; `reviewer` also walks the
  project's invariants table row by row; `quality-auditor` uses the whole catalog and flags findings that slipped past
  review; `builder` self-checks before claiming done. The `review` skill writes a receipt at
  `<git-common-dir>/swarm-reviews/<patch_id>.json`, keyed by `git patch-id --stable` over `<integration>...HEAD`, and
  `land` refuses a change that `review.mode` covers unless that receipt says `pass` with `open_high: 0`. The `review`
  block of `swarm.json` (`mode`: `always` | `sensitive` | `off`, plus `sensitive` globs) is read from the integration
  branch, so a branch cannot relax its own gate. `land --no-review "<reason>"` is the logged escape hatch.
  `reference/scripts/review-receipt.ts` (`write`, `check`) plus self-tests.
- **Detection latency.** Audit findings record `introduced` (from `git log -S`, `git blame` or `git log -L`, or
  "unknown"), `detected` and `catchable_at_review` against the defect catalog. The audit report gains "Detection"
  (median latency, escape rate, trend) and "Rules and mechanisms" (preference count, eroding rules) sections;
  `audit.ts --write --findings <json>` stores them in the snapshot.
- **Self-tests for the reference implementation.** `reference/self-test/` runs `land`, `wt`, `verify`, `adr`,
  `ratchets`, `review-receipt` and `audit` end to end against throw-away git repos (a bare remote, a publisher clone
  with the real `pre-push` hook, a linked worktree) with `node:test` and no dependencies: 57 tests, in a new CI
  `self-test` job on Node 24. They include a regression test for the 0.2.0 land fix (a commit or edit made while
  verify runs never reaches the integration branch; the Stop hook stays silent during a live land) and the race
  where the integration branch moves during verify (land rebases and verifies again).
  `DEV_FLOW_CONFIG=<json>` deep-merges over `dev-flow.config.ts` so the tests (and adopters) can override it.
- **Skill evals.** `evals/` holds 58 cases for `claude plugin eval`: trigger cases (4 positive, 2 negative) for the
  nine core skills and behaviour cases for `verify` (green evidence, red is not done), `review` (dispatches the
  reviewer and security-reviewer on an auth diff) and `tdd` (test written before the fix). `scripts/check-evals.mjs`
  is the free structural check CI runs; a manual `evals` workflow runs the real suite only when an `ANTHROPIC_API_KEY`
  secret exists, with a cost ceiling.
- **Transferability (manual chapter 18, conformance track X1–X5).** Five checks, separate from the levels, that turn
  "another team can absorb this project" into something a command reports: X1 fresh clone (one `commands.setup` from
  a clean clone to a green `verify`, run weekly by `templates/github/workflows/fresh-clone.yml`), X2 new-agent test
  (an agent with no prior context does the reference task on a throwaway branch with turn and budget caps, judged
  deterministically, `templates/github/workflows/new-agent-test.yml`), X3 explicit ownership (`templates/CODEOWNERS`,
  `templates/docs/runbook.md`, `templates/docs/dependencies.md`), X4 no hidden knowledge (counted by the audit),
  X5 handover checklist (`checklists/handover.md`, with a joint session where the receiving team's agent does the
  reference task live). `/swarm:adopt --check transfer` runs them. New `commands.setup` key and guarantee.
- **Skill `learn`.** Turns an incident or a review finding into a durable rule with a mechanism (test, hook, ratchet,
  check) or an explicit `preference` label, written as a change or ADR draft; drafts an issue or PR for this
  repository when the lesson is generic, and never sends it without explicit confirmation.
- **`MAINTAINING.md`.** Running the protocol inside a company: single source of truth, playbook owner, two approvals
  for gate changes, the semver table, release checklist, update commands and managed-settings pinning, the
  incident → learn → PR loop, protocol score and detection latency per team, pilot before rollout.

### Changed

- `/swarm:adopt --check` compares the project's `swarm.json` `version` with the plugin's and reports drift with a link
  to this changelog.
- `templates/swarm.json` and the `INTEGRATION.md` §1 example carry `commands.setup`, `commands.ratchets` and the
  `review` block; `version` is `0.3.0`.
- The adopted path of the reference tooling is `scripts/dev/` everywhere (`swarm.json`, hooks, `templates/CLAUDE.md`,
  settings, CODEOWNERS, review globs); `reference/README.md` said `scripts/` and now says `scripts/dev/`.
- `reference/README.md` warns that `verify.logDir` must be gitignored before the first land.
- Manual chapter 14 marks file-size gates, rule mechanisms and detection latency as shipped.

### Fixed

- `land` crashed (`ENOENT … docs/adr`) in a repository without an ADR folder; the ADR numbering and index are now
  no-ops there.
- `audit.ts` counted the playground and its own regex source in the `any`, `@ts-ignore`, TODO and big-file metrics
  (AUD-metricas-ruido); it now excludes them and counts lines the same way as the file-size ratchet.

### Decided against

- Splitting the plugin into `core` and `governance` plugins. Claude Code installs a plugin by copying only its own
  directory, and the skills read the manual, templates and reference code through `${CLAUDE_SKILL_DIR}/../../`; a
  split would ship them without that knowledge or duplicate ~400 KB. Recorded in `MAINTAINING.md` §1.

## [0.2.0] — 2026-10-28

### Fixed

- `land` integrated the branch tip at the end of the run, not the commit it verified: a Stop-hook `wip:` commit
  created during the 5–10 minutes of verify was fast-forwarded unverified (twice in the reference project).
  `reference/scripts/land.ts` now records `rev-parse HEAD` before verify, requires the same SHA and a clean tree
  afterwards (aborting otherwise), and fast-forwards that exact SHA (`merge --ff-only <sha>` /
  `update-ref <ref> <sha> <old>`). `wt wip` does nothing while a live land lock belongs to its branch
  (`landRunningFor()` in `reference/scripts/git.ts`). Documented in `INTEGRATION.md` §2, `reference/README.md`,
  manual chapter 03 (incident note) and chapter 11 (anti-pattern).
- Plugin session hooks ran a legacy fallback (`scripts/dev/wt.ts`) in repositories without `swarm.json`. In a project
  that already wires the same commands in its own `.claude/settings.json`, every SessionStart and Stop ran twice. The
  hooks now act only on `swarm.json`.
- `templates/CLAUDE.md` presented `git commit` and `wt:commit` as equivalent; a plain `git commit` on top of a `wip:`
  buries it and `land` refuses the branch.

### Added

- Skill `change`: the spec-driven change lifecycle (explore, propose, apply, verify, archive) in one skill with a
  file per phase, OpenSpec by default and a mapping to other spec tools; red flags taken from real audits (absorbed
  changes left active, meta-tasks, untouched changes, code without a change, empty spec purposes).
- Skill `extend`: adding a new kind of piece follows the project's extension guide, or writes one in the same change;
  six-step skeleton (register, implement, contract, test, document, architecture entry) and per-kind traps.
- `audit-repo` brought to the level of the reference project's audit: run setup and memory rules, deterministic
  checks with "investigate before reporting" and known runner noise, metric hygiene, hunting holes in the
  architecture test, full harness, scalability and ordered security checklists, severity recalibration, and a sixth
  dimension that measures the project against this protocol.
- CI ⊇ verify: conformance check L1.3 now requires CI to run `commands.verify` (or exactly its steps) plus extra jobs
  each documented with why it is not in local verify, and forbids `continue-on-error` in the gate path. The CI
  template ships optional, commented jobs for backend parity (contract suites against a service database, migrations
  from zero, cross-backend fingerprints), an image built without secrets, and a backup/restore roundtrip. Manual
  chapter 02 explains the principle.
- Bidirectional docs test (`templates/tests/docs.test.ts`, `reference/tests/docs.test.ts`), config-driven at the
  top: every invariant id in the table has a test (or a stated reason) and every tested id is in the table; the ADR
  index lists every ADR file; the docs index links every extension guide; every package or app is documented; every
  CLI command appears in the README; prose must not cite invariant ids in a different numbering (`INV-1` for
  `INV-01`). Conformance check L2.5 updated; `templates/CLAUDE.md` lists invariants by their table ids.
- Domain contract validators as a first-class category of the gate: a sentence in `INTEGRATION.md` §2, a column in
  the §4 stack table, and a `validators` step in `reference/scripts/dev-flow.config.ts` (`verify.full` and quick).
- Session details: `templates/claude/.gitignore` (worktrees and the per-worktree ports file), documentation of
  `worktree.baseRef: "head"`, of `.claude/worktree.env` and of the `pre-push` `--no-verify` escape hatch in manual
  chapter 01 and the adoption guide.

## [0.1.0] — 2026-10-28

### Added

- `INTEGRATION.md`: the contract a project exposes (`swarm.json` manifest, command guarantees, plugin hooks,
  stack equivalents for TypeScript, Python, Go, Rust and JVM, the session protocol for agents without hooks,
  conformance checks per level, worked examples), with `templates/swarm.json` and `templates/AGENTS.md`.
- Stack-independent plugin hooks (`hooks/swarm-hook.sh`) driven by `swarm.json`, reading JSON with jq, node or
  python3.
- Every skill shares one structure: a trigger-only description, the gate in one sentence with its reason, when not
  to use it, exact commands resolved from `swarm.json`, a branch per failure, a red-flags table built from the
  manual's anti-patterns, and a mandatory evidence block.
- Skills `worktree` (start, check and clean up session worktrees; nothing deleted without an archive), `tdd` (test
  first, seen red for the right reason, proven to bite), `debug` (root cause before any fix; `debugger` agent for
  long investigations; `architect` after two failed fixes) and `review` (dispatches `reviewer`, `security-reviewer`
  and `test-auditor` with ready briefs, then verifies and triages every finding).
- Sibling reference files loaded on demand: `skills/verify/failures.md`, `skills/land/failures.md`,
  `skills/debug/techniques.md`, `skills/review/brief.md`, `skills/audit-repo/dimension-briefs.md`,
  `skills/audit-repo/skeleton.md`, `skills/adopt/levels.md`.
- `adopt --check [level]`: runs the conformance checks of `INTEGRATION.md` and changes nothing; `adopt` writes and
  maintains `swarm.json` and never raises a level over a failing check.
- Manual: 18 chapters covering principles, worktrees, verification, integration, testing, architecture and docs,
  spec-driven changes, code quality, working with agents, periodic audits, spend and secrets, anti-patterns,
  autonomy, glossary, roadmap, review processes, efficiency in real-world environments, and agentic-system architecture patterns.
- Reference implementation in `reference/`: the generalized `verify`, `land`, worktree, ADR, roadmap and audit
  tooling, architecture and docs tests, and test temp-dir hygiene, extracted from a production system.
- Claude Code plugin and marketplace: skills `playbook`, `adopt`, `verify`, `land`, `new-adr`,
  `audit-repo`; agents `builder`, `reviewer`, `security-reviewer`, `quality-auditor`, `architect`, `debugger`,
  `test-auditor`, `docs-keeper`; worktree hooks and a quality-gate edit warning.
- Templates: `CLAUDE.md`, Claude Code settings, path-scoped rules, ADR, OpenSpec artifacts and roadmap, CI and
  weekly review workflows, `pre-push` hook, architecture and docs tests, Vitest config, quality guide, extension
  guide, playground README, daily and weekly review prompts.
- Adoption guide by level, checklists, sources.
