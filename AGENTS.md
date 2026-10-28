# AGENTS.md — entry point for coding agents

This repository is **Agentic Coding Swarm Protocol**, an engineering playbook **designed to be consumed by coding agents** (Claude Code, Codex, Cursor
and others) and by the engineers who run them. If you are an agent, start here and read only what your task needs:
the full manual is ~190 KB (roughly 50k tokens) and you almost never need all of it.

**Is the repository you are working in already adopted?** Yes if and only if it has a `swarm.json` at its root. Its
`level` says how far, and its `commands` say what to run: never guess `pnpm`, `make` or anything else. The
contract behind that file is [INTEGRATION.md](INTEGRATION.md).

## What are you doing?

| Your task | Read | Do not read |
|---|---|---|
| Working in a repo that already follows the playbook | [skills/playbook/rules.md](skills/playbook/rules.md) (one page) and that repo's `CLAUDE.md` | the manual |
| Answering a specific workflow question | the routing table in [skills/playbook/SKILL.md](skills/playbook/SKILL.md) → **one** chapter | the rest |
| Integrating the protocol: what a project must expose, stack equivalents, agents without hooks | [INTEGRATION.md](INTEGRATION.md) | the manual |
| Checking how far a repository complies | `/swarm:adopt --check`, or the conformance table in [INTEGRATION.md](INTEGRATION.md) §6 | — |
| Adopting the playbook in a repository | [skills/adopt/SKILL.md](skills/adopt/SKILL.md) and whatever each step cites | uncited chapters |
| Starting a session, or cleaning up worktrees | [skills/worktree/SKILL.md](skills/worktree/SKILL.md) | — |
| Fixing a bug or adding behavior | [skills/tdd/SKILL.md](skills/tdd/SKILL.md) | — |
| Saying a change is done, or a verify step is red | [skills/verify/SKILL.md](skills/verify/SKILL.md) | — |
| Proposing, implementing, verifying or archiving a behavior change | [skills/change/SKILL.md](skills/change/SKILL.md) and the detail file of the current phase | the other phases' files |
| Adding a new integration, tool, event log, UI section or other kind of piece | [skills/extend/SKILL.md](skills/extend/SKILL.md) and the repo's guide in `docs/extending/` | — |
| Integrating a finished branch | [skills/land/SKILL.md](skills/land/SKILL.md) | — |
| Recording a contract, invariant or formula decision | [skills/new-adr/SKILL.md](skills/new-adr/SKILL.md) | — |
| Getting a finished branch reviewed | [skills/review/SKILL.md](skills/review/SKILL.md), which dispatches the agents below | — |
| Reviewing a diff | [agents/reviewer.md](agents/reviewer.md), plus [agents/security-reviewer.md](agents/security-reviewer.md) on sensitive paths | — |
| Checking whether tests really prove a change | [agents/test-auditor.md](agents/test-auditor.md) | — |
| Finding the root cause of a failure | [skills/debug/SKILL.md](skills/debug/SKILL.md); it delegates to [agents/debugger.md](agents/debugger.md) and escalates to [agents/architect.md](agents/architect.md) after two failed fixes | — |
| Implementing a decided plan | [agents/builder.md](agents/builder.md) | the manual |
| Bringing docs back in sync with a change | [agents/docs-keeper.md](agents/docs-keeper.md) | — |
| Running a scheduled review | [agents/quality-auditor.md](agents/quality-auditor.md), [templates/review/](templates/review/) | — |
| Running the biweekly audit | [skills/audit-repo/SKILL.md](skills/audit-repo/SKILL.md) | — |
| Designing or reviewing a product whose core is an LLM agent | [manual/17-agentic-system-architecture.md](manual/17-agentic-system-architecture.md) | chapters 01–04 |
| Implementing `verify`, `land` or the worktree tooling | [reference/README.md](reference/README.md) | — |
| Improving this playbook | this file, [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md) and the chapter you change | — |

## Contract of this repository

- **Rules are verifiable.** Every rule states what enforces it (script, hook, test) or is marked as a preference. A
  rule without a mechanism is a gap: record it in [manual/14-proposed-improvements.md](manual/14-proposed-improvements.md).
- **Progressive disclosure.** `rules.md` (always) → the task's `SKILL.md` → one chapter → `reference/`. Do not go
  deeper without a reason.
- **Templates are adapted, never pasted.** Read the destination file before writing; merge; never weaken a gate the
  destination repo already has.
- **Designed is not enforced.** Chapter 12 (autonomy, risk tiers) is a design. Do not present it as an established
  practice.
- **No secrets, no real spend.** Nothing in this repo needs credentials. Templates run in mock mode.

## Plugin

This repository is both a marketplace (`.claude-plugin/marketplace.json`) and a plugin (`.claude-plugin/plugin.json`)
with skills (`skills/`), agents (`agents/`) and hooks (`hooks/hooks.json`). The hooks run the commands declared in the target
project's `swarm.json` and are no-ops without it ([INTEGRATION.md](INTEGRATION.md) §3). Agents that do not load
plugins (Codex, Cursor, Aider, CI) follow the manual session protocol in §5 of the same file. Installation and real-world scenarios:
[chapter 16 §0](manual/16-efficiency-and-real-world-use.md).

## Conventions

- English throughout. Skill, agent and command names in kebab-case.
- One chapter per topic. Each opens with a bold **Rule:** line and ends with "What to copy into your repo".
- Short sentences, tables for parallel items, fenced blocks for commands.
- Any change that adds a skill or an agent updates the table above and the README.
- `scripts/check-links.mjs` must pass: every relative link and every cited repo path resolves.
