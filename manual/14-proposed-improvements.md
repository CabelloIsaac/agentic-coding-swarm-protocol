# 14 · Roadmap: what this playbook recommends that even the reference project does not do yet

The reference project (PLINNG, a production multi-agent platform) is the baseline for this playbook, but it is
not finished. This chapter lists the practices
the playbook recommends that the reference project has not yet adopted, checked against its repository (at the commit this playbook was cut
from) and against the external sources (`SOURCES.md`). Ordered by value versus effort. Each would be its own OpenSpec
change in the reference project. Items marked **shipped** now have a mechanism in this repository (template,
reference script and docs test), so an adopter gets them directly; the reference project still has to adopt them.
If you are adopting the playbook from scratch, you can start with several of these directly.

## High priority (low effort, high value)

1. **`deny` rules for secrets in `.claude/settings.json`.** The reference project has no `permissions` block in its
   repo settings. Without one, the rule "never read
   `.env`" lives only in `CLAUDE.md`, which is a preference, not an enforcement. Add
   `deny: ["Read(./.env)", "Read(./.env.*)", "Read(**/secrets/**)"]` and `ask: ["Bash(git push *)"]`. See
   `templates/claude/settings.json`.
2. **Protect the gate itself with a hook.** A `PreToolUse` hook on `Edit|Write` that, inside a worktree, warns (does
   not block) when someone touches `vitest.config.ts`, `biome.json`, `architecture.test.ts`, `docs.test.ts` or
   `scripts/dev/land.ts`. It is the cheap precursor of T3 until risk tiers (`dev-land-tiers`) exist.
3. **Forbid `.only` in CI.** Vitest sets `allowOnly: false` when `CI` is defined; make it explicit in
   `vitest.config.ts` so a forgotten `.only` fails in CI and in `verify`.
4. **Count `.skip`/`.todo` in `audit:repo`.** The reference project does not measure them today. Track them as a ratchet metric like the others.
5. **Version the team's agents.** If `builder`, `reviewer` and `architect` live only in one person's
   `~/.claude/agents/`, nobody else has them. Move them into the repo's `.claude/agents/` (templates in `agents/`).
6. **Path-scoped `.claude/rules/`.** Parts of `CLAUDE.md` only apply to one area (storage, integrations, apps). With
   `paths:` they load only there, and the root `CLAUDE.md` gets shorter. See `templates/claude/rules/storage.md`.

## Medium priority

7. **Optional typecheck in the `Stop` hook.** `tsc --noEmit 1>&2 || exit 2` in code worktrees prevents a turn from
   ending with type errors. Measure the cost (≈ 18 s per turn) before enabling it for everyone; alternative: run it
   only when the diff touches `.ts` files.
8. **Mutation testing on the critical core.** Stryker over the critical core (authorization policy, spend budget, write
   paths, idempotent external effects), as an
   audit metric (not as a gate). 86% coverage does not tell you how many assertions are useful; agent-generated
   tests tend to cover a lot and assert little.
9. **A written flaky-test policy** in `quality.md`: quarantine with a ticket and an expiry date, counted in the
   audit (chapter 04). In the reference project the only written rule today is the single tolerated infrastructure
   signature (the lost-RPC message of the test runner under load).
10. **File size as a soft gate.** **Shipped in 0.3.0** as the `fileSize` ratchet (chapter 07, Ratchets): new
    files over 500 lines fail `verify`, existing ones are exceptions that only shrink, and `land` tightens them.
    The same file ratchets the coverage gap (a floor more than one point under measured fails) and the lint warning
    budget. The reference project only measured them, and between two audits all three drifted with every gate
    green.
11. **Formatter.** In the reference project the formatter is off so it does not rewrite the whole codebase at once; turn it on for a growing list of
    folders, or format only changed files in a `PostToolUse` hook.
12. **ADR headings.** Numbered ADRs can keep a stale `# ADR-draft —` title; the numbering script already rewrites
    the title for new ADRs; backfill the old ones and add a test that enforces it for all ADRs.
13. **Spec purpose.** Archived specs left with "TBD - created by archiving change" (72 of them in the reference
    project): add a test that forbids it for new specs and a task to fill in the existing ones.

## Scaling to other teams

14. **Extract the workflow kit into its own package** (`dev-flow`): `verify`, `land`, `wt`, `adr`, `audit`,
    parameterized by a `dev-flow.config.ts` (integration branch, verify commands, temp-file prefix, process
    patterns, publisher flag). Today they are project scripts with hard-coded constants.
15. **GitHub branch protection** that requires the CI job and forbids direct pushes except from the publisher. In the
    reference project the only defense today is the local `pre-push` hook, which `--no-verify` bypasses.
16. **A team Claude Code plugin** with this playbook's skills, agents and hooks, installable with one command; use
    managed settings for whatever must be company policy (secret `deny` rules). This repository is that plugin.
17. **Visible flow metrics.** The land log (`<git-common-dir>/<project>-land-log.jsonl`) already records every
    attempt: build a panel with land p50, % conflict-free, retries and cost per landed change.
18. **A data policy for second opinions** from other models: deciding it unblocks cross-model review on sensitive
    paths. Until it exists, cross-model review stays blocked.

## Added from the 2026-10 audits (rules that eroded without a mechanism)

19. **Every rule names its mechanism.** **Shipped in 0.3.0:** each rule in `templates/CLAUDE.md` ends with
    `(enforced: <path>)` or `(preference)`, the docs test checks the markers and that every enforced path exists,
    and the audit counts the preferences and names the rules it finds eroding.
20. **Detection latency.** **Shipped in 0.3.0:** every audit finding records the commit that introduced it, the
    audit that detected it and whether a per-change review with `checklists/defect-classes.md` would have caught
    it; the audit report tracks the median latency and the escape rate (the `audit-repo` skill and
    `reference/scripts/audit.ts --findings`).

## What we do not recommend (yet)

- Auto-merge without a human at T3; decision routers or confidence thresholds without volume; `prompt`/`agent`
  hooks as an enforcement mechanism (they are not deterministic); mutation testing as a CI gate from day one.
