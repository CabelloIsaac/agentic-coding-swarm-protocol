# 00 · Principles

This chapter explains the why behind everything else. If you read only one chapter, read this one.

## 1. Two kinds of instruction: what the agent decides and what the harness enforces

Everything you tell an agent falls into one of two kinds:

| | Non-deterministic (the agent decides) | Deterministic (the harness or the repo enforces) |
| --- | --- | --- |
| What to do | prompt, `CLAUDE.md`, skills the agent chooses | hooks, skills only you can invoke |
| What it may touch | the auto-mode classifier | `deny` rules, sandbox, managed settings |
| When it is done | "done", `/goal`, review | tests, typecheck, `Stop` hook, CI, `land` |
| How much it spends | effort level | `--max-turns`, `--max-budget-usd`, spend limit |
| Who has the last word | the agent's summary | branch protection, a human approver |

The practical rule: **almost everything should be a preference.** An agent with the code in front of it usually
judges better than a rule written in advance. Determinism is for what cannot have exceptions. Signs that a
`CLAUDE.md` line should be a hook: you wrote it in capitals, you repeated it, or the agent skips it one time in ten.
Sign of the opposite mistake: you have forty hooks and most of them are taste.

In the reference project (PLINNG, a production multi-agent platform), the deterministic layer is: the
`SessionStart` hook (prepares the worktree), the `Stop` hook (a `wip:` commit so nothing is lost), `verify` (a gate identical to CI), `land` (serial integration), the
`pre-push` hook (only one workstation publishes), the architecture tests (invariants) and the documentation test.

## 2. One session, one worktree, one branch

Several sessions on the same working tree end badly: commits with fragments of another session, files overwritten
minutes after being diffed, work lost when a session dies. The fix is not better coordination. The fix is **not
sharing the tree**: each session works in its own worktree and branch, and only integration moves the main checkout.
Chapter 01.

## 3. One quality gate, identical locally and in CI

If the local gate and the CI gate differ, people learn to trust only one of them. `verify` runs exactly what CI
runs (lint, types, contract validators, tests with coverage, end-to-end) and prints only the summary and the tail
of each failure, so an agent session does not burn context reading logs. It has two levels: `--quick` to iterate
(only what the change affects) and full to call something done. Chapter 02.

## 4. Serial integration, always green

`land` takes a lock, rebases onto the integration branch, numbers whatever needs numbering, runs full
verification and fast-forwards the branch. If the integration branch moved during verification, it rebases
again. On conflict it aborts and lists the files: whoever caused the conflict resolves it, on their branch.
Nothing red is ever integrated, and nothing is ever integrated by hand. Chapter 03.

## 5. Done = verified

"Done" without evidence does not count. Evidence is the command that ran and its output, the screenshot, the green
test. This applies to people, to agents, and to the product itself when it is an agent runtime: an action without
its own evaluation ends as `skipped`, never `pass`. A useful consequence: if the agent has something to run that
returns pass or fail, it can close the loop on its own and you do not need to watch it.

## 6. Documentation is part of the change

Code and tests are the source of truth. When docs and code disagree, fix the docs **in the same change**. So that
this does not depend on willpower, a test fails if the documentation cites files, paths or functions that do not
exist, or if a module, command, external integration or ADR appears undocumented. A new architecture decision is a new ADR.
Chapter 05.

## 7. Invariants are tests

An architecture rule that lives only in a document erodes within weeks. Each invariant has an ID (`INV-01`…), one
sentence, a why, and an "enforced by" column that points to the test. The test holds exception lists with reasons,
and those lists **can only shrink**. If an architecture test fails, change the code, or change the invariant with
an ADR. Never add an exception without a written reason.

## 8. Nothing is deleted without a copy; nothing is spent without a budget

Branches are archived with a published, verified tag before deletion. Customer data is versioned before any
destructive operation, with who, when and why, in the storage layer and invisible to the agent runtime; nothing
deletes published content. In the product, every paid call is checked against the budget before it happens. Real spend (paid APIs, LLM calls, publishing) happens only from the main checkout, with
credentials that worktrees do not have. Tests and CI run without secrets. Chapter 10.

## 9. Debt is measured, not debated

Gates fail only on errors. Lint warnings, `any`, growing files and unarchived changes pile up silently. Every two
weeks, an audit with deterministic metrics (seconds, no network) compares against the previous one. No metric goes
up without a written reason; when one reaches zero, its rule becomes an error. The coverage floor sits just below
the measured value and only goes up. Chapter 09.

## 10. Quality before speed

The tech lead's rule, verbatim: "if it makes quality worse, don't do it." A lossy shortcut (compressed diffs, a
looser completion gate, skipping full verification "because quick passed") is not adopted. A lossless shortcut (a
quick level for iteration, caching, parallelism, slow tests first) is.

## Corollaries of the ten

- **Trunk-based.** Branches live hours or days, never weeks; integration happens several times a day; the
  integration branch is always green and always deployable. Large work ships in integrable steps (feature flags,
  branch by abstraction), not on a long-lived branch.
- **Small and explicit.** A change describes a problem with evidence, a measurable outcome and the do-nothing
  alternative. A task is verifiable (a test, a command, a concrete visual check).
- **Development tools have tests too.** `land`, `verify`, `wt` and the other scripts have their own `*.test.ts`;
  breaking the workflow is breaking the product.
- **Every behavior change is enforced twice:** once in code (test, validator) and once in documentation
  (invariant, ADR, guide). If a rule blocks you, do not work around it: propose the architecture change and update
  the documentation.
