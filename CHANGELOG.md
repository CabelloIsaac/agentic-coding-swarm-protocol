# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
