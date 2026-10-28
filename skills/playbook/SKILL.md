---
name: playbook
description: Routes a workflow question or task to the right Swarm Protocol skill or to the one manual chapter that answers it (worktrees, verify, land, testing, ADRs, OpenSpec, reviews, audits, anti-patterns, autonomy, token efficiency, agentic architecture). Use when unsure how something is done in a repo that follows the protocol, before changing a quality gate or a rule, when about to do something that might be an anti-pattern, or when the user asks "how do we work here".
argument-hint: "[question or topic]"
---

# playbook

Answer `$ARGUMENTS` with the least reading possible. The rules that always apply fit on one page:
[rules.md](rules.md). Read it first if you have not this session.

## 1. Is it a task? Use the skill

| You are about to… | Skill |
| --- | --- |
| start work, or you are in the main checkout; clean up worktrees | `worktree` |
| fix a bug or add behavior | `tdd` |
| chase a failure whose cause is not proven, or a fix that did not work | `debug` |
| say "done", "fixed" or "passes" | `verify` |
| get a finished branch reviewed | `review` |
| record a contract, invariant or formula decision | `new-adr` |
| integrate (user-invoked) | `land` |
| run the periodic audit | `audit-repo` |
| adopt the protocol or check conformance (user-invoked) | `adopt` |

Commands come from `swarm.json` at the repo root; contract in [INTEGRATION.md](../../INTEGRATION.md).

## 2. Is it a question? Read one chapter

One chapter, two at most; each costs 1–6k tokens. Never load the whole manual.

| If the question is about… | Read |
| --- | --- |
| why a rule exists; deterministic vs preference | `${CLAUDE_SKILL_DIR}/../../manual/00-principles.md` |
| worktrees, session hooks, wip, gc/reap, single workstation, tmux | `${CLAUDE_SKILL_DIR}/../../manual/01-sessions-and-worktrees.md` |
| verify, quick vs full level, timeouts under load, CI | `${CLAUDE_SKILL_DIR}/../../manual/02-verification.md` |
| land, conflicts, lock, tiers T0–T3 | `${CLAUDE_SKILL_DIR}/../../manual/03-integration-land.md` |
| tests, temp files, coverage, flaky tests, architecture and docs tests | `${CLAUDE_SKILL_DIR}/../../manual/04-testing.md` |
| invariants, kernel, extension guides, ADRs | `${CLAUDE_SKILL_DIR}/../../manual/05-architecture-and-docs.md` |
| OpenSpec changes, specs, tasks, roadmap | `${CLAUDE_SKILL_DIR}/../../manual/06-changes-and-roadmap.md` |
| types, lint, suppressions, commits, code review | `${CLAUDE_SKILL_DIR}/../../manual/07-code-quality.md` |
| CLAUDE.md, hooks, permissions, skills, subagents, context, unattended runs | `${CLAUDE_SKILL_DIR}/../../manual/08-working-with-agents.md` |
| biweekly audit | `${CLAUDE_SKILL_DIR}/../../manual/09-periodic-audit.md` |
| spend, secrets, customer data | `${CLAUDE_SKILL_DIR}/../../manual/10-spend-secrets-data.md` |
| "is what I am about to do a bad idea?" | `${CLAUDE_SKILL_DIR}/../../manual/11-anti-patterns.md` |
| asking the human, assumptions, autonomy | `${CLAUDE_SKILL_DIR}/../../manual/12-autonomy-and-decisions.md` |
| a term you do not know | `${CLAUDE_SKILL_DIR}/../../manual/13-glossary.md` |
| per-change, daily and weekly reviews; scheduled agents | `${CLAUDE_SKILL_DIR}/../../manual/15-review-processes.md` |
| tokens, caching, effort, parallelism, use in real projects | `${CLAUDE_SKILL_DIR}/../../manual/16-efficiency-and-real-world-use.md` |
| building an LLM-agent product: tool loop, approvals, budget, write pipeline, idempotency, event logs, simulator, storage | `${CLAUDE_SKILL_DIR}/../../manual/17-agentic-system-architecture.md` |
| what the plugin expects from the repo (`swarm.json`, stack equivalents, conformance) | `${CLAUDE_SKILL_DIR}/../../INTEGRATION.md` |

Use `grep -n "<term>" <chapter>` and read the matching section when the chapter is long (16 and 17 are).

## 3. About to change a gate or a rule?

Gate files are the test and lint config, the coverage floor, the architecture and docs tests, verify, land and the
git hooks (the plugin hook warns on edits to them). Before editing one:

1. Read the chapter that owns it (02, 03 or 04) and chapter 11.
2. A change that relaxes a gate is not made to get something green. It is proposed: an OpenSpec change and an ADR,
   with the human's approval.
3. A change that tightens a gate (raising the coverage floor, a new invariant test) ships with the code that
   satisfies it.

## Answer format

The applicable rule in one or two sentences, the concrete action or the skill to use, and the source
(`chapter NN §section`). If the playbook does not cover it, say so; do not invent a rule.
