# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
