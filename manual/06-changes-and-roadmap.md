# 06 · Changes (OpenSpec) and roadmap

**Rule:** every behavior change is an OpenSpec change: a proposal with problem and evidence, specs with scenarios,
a design with decisions, and verifiable tasks. The roadmap is the single source of order and priority, and a
change's status is **derived**, never written.

## Lifecycle of a change

```
openspec new change <kebab>            → openspec/changes/<name>/ with .openspec.yaml
openspec instructions <artifact>       → proposal.md → specs/<cap>/spec.md → design.md → tasks.md
implement                              → tick - [x] in tasks.md as each task is verified
openspec validate                      → specs have scenarios, references resolve
openspec archive <name> -y             → merges the deltas into openspec/specs/ and moves to changes/archive/<date>-<name>/
```

In Claude Code, each step is a skill (`openspec-new-change`, `openspec-continue-change`, `openspec-apply-change`,
`openspec-verify-change`, `openspec-archive-change`) or a `/opsx:*` command. The skills follow a fixed format:
one-line purpose, **Input**, numbered **Steps** with the exact commands and "STOP and wait for the user",
**Output**, **Guardrails**. The protocol ships the whole lifecycle as one skill, `change`
(`skills/change/SKILL.md`), with one detail file per phase and the red flags from the reference project's audits.

## The artifacts

### `proposal.md`

Sections `Why`, `What Changes`, `Capabilities` (new / modified) and `Impact`. The `dev-problem-brief` design (not
yet test-enforced in the reference project) adds three mandatory sections. Adopt them from day one:

- **Problem and evidence**: with source and date; facts kept apart from hypotheses.
- **Outcome and measure**: what changes and how it is measured.
- **Alternatives**: must include "do nothing / don't build".

The last task in `tasks.md` starts with "Measure the outcome". A test can require at least 40 characters per
section for changes created after a cutoff date.

### `specs/<capability>/spec.md` (delta)

`## ADDED Requirements` or `## MODIFIED Requirements`. Each requirement: `### Requirement: <name>`, a paragraph with
SHALL / MUST / MUST NOT, and `#### Scenario:` blocks with `- **WHEN**` / `- **THEN**`. **A MODIFIED requirement
copies the whole block, including its existing scenarios**; omitting them breaks archiving later (it happened
twice). Config rule: **requirements must be testable without API keys.**

### `design.md`

`Context`, `Goals / Non-Goals`, `Decisions` (`### D1. …` with the rejected alternatives), `Risks / Trade-offs`
(`[Risk] → mitigation`), `Migration Plan`, `Open Questions`. ADRs later cite "design D1–D3".

### `tasks.md`

Groups `## N. <group>` with `- [ ] N.M <task>`. **Every task is verifiable**: a test, a command or a specific
visual check. Include Vitest tasks for logic. End with a "Documentation and close-out" group: ADR, `CLAUDE.md`,
README, full `verify`, a real-world run, a measurement at 4 weeks.

### Main spec (`openspec/specs/<cap>/spec.md`)

`# <cap> Specification`, `## Purpose` (do not leave the "TBD" that archiving inserts: the audit counted 72),
`## Requirements`.

## The roadmap (`openspec/roadmap.yaml`)

```yaml
goal: <one paragraph>
waves:
  - { id: 0, title: Engineering foundation }
  - { id: 1, title: Customer foundations }
changes:
  - { id: dev-land-tiers, title: …, block: B12, wave: 0, priority: P0, depends_on: [dev-panel] }
  - { id: queue-scale, title: …, block: B4, priority: P2, frozen: true }
  - { id: dev-test-guard, title: …, block: B12, absorbed_by: dev-land-tiers }
```

- **Every active change is in the file** (a test enforces it).
- **Status is derived:** `planned` = no folder; `active` = in `changes/`; `done` = in `changes/archive/`;
  `merged` = absorbed and gone. An active change's progress comes from the checkboxes in `tasks.md`.
- `priority`: P0 (required for the wave's goal), P1 (in the MVP, later), P2 (out). Do not start a P2 without
  changing the roadmap first.
- `frozen: true` parks a change; `absorbed_by` closes it inside another.
- `pnpm roadmap` sorts (unfrozen first, non-P2 first, then wave, priority, file order) and **fails** on: duplicate
  ids, invalid priority, P0/P1 without a wave, unknown wave, frozen P0, a dependency that does not exist or sits in
  a later wave, a nonexistent `absorbed_by`, an active change without an entry, and the work-in-progress limit
  (next section).
- YAML comments record provenance ("moved up by the tech lead on <date>, baseline: …").

## Work in progress has a limit

The reference project let changes pile up: **75 active changes, 19 of them never started** (a folder, a proposal, not
one task ticked), with a roadmap that listed them all as in flight. Nothing was wrong with any single change. The
system had no cost for opening one and no pressure to close one, so only opening happened, and the active list stopped
meaning "what we are working on". Every status report, every audit and every agent that reads the list pays for the
noise, and the real work hides in it.

A limit turns that around: when the list is full, the only way to open something is to close something. `roadmap.ts`
checks two things, and both fail `pnpm roadmap` (so verify):

- **More active changes than `roadmap.maxActive`** (default 12). The message lists the oldest ones by days since the
  last progress.
- **A stale change**: no task ticked (`- [x]`) for `roadmap.staleDays` days (default 14), measured from the last
  commit that added a tick to its `tasks.md` (a change never started is as old as its folder). Rewording a task does
  not reset the clock.

Three ways out, and the message names them: **finish** it, **archive** it, or **park** it. Parking is one line at the
top of the proposal, `parked: <reason>`: it exempts the change from the stale check and nothing else. A parked change
still counts toward the limit, on purpose; otherwise parking becomes the place changes go to be forgotten. Work that is
not started yet belongs in the roadmap as `planned` (an entry without a folder), not as a folder that will "get
started next week". Check the limit **before** proposing; `skills/change` does.

## OpenSpec configuration rules (`openspec/config.yaml`)

A `context` block injected when generating artifacts (project focus, pointer to the roadmap, sources of truth,
stack, hard rules, language policy) and per-artifact `rules`:

- **proposal:** every new change enters the roadmap with block, wave and priority.
- **tasks:** every task verifiable; Vitest tests for logic; a real-world-run task links its scenario.
- **specs:** testable without keys.

## What a workflow PRD should contain (pattern from the reference project's multi-session workflow PRD)

- A table with **real data from the repo** (hot files, collisions, lost work).
- "Critical analysis of the initial proposal": what holds up and what was wrong.
- Goals and non-goals.
- Requirements F0–F5, where F0 is "baseline and cleanup; blocks everything else".
- A **today / target** metrics table with an explicit **rollback criterion** ("if fewer than 60 % of lands are
  conflict-free after one week, or p50 exceeds 15 min, stop the rollout").
- A final "implementation status" section listing the deviations.

## What to copy into your repo

OpenSpec (or any spec-driven format) with the five proposal sections, WHEN/THEN scenarios and verifiable tasks; a
`roadmap.yaml` with derived status and a validator that fails; and the rule "do not start a P2 without changing the
roadmap". Templates in `templates/openspec/` (`proposal.md`, `spec.md`, `tasks.md`, `roadmap.yaml`); the sorter
and validator is `reference/scripts/roadmap.ts`.
