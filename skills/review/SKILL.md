---
name: review
description: Gets an independent review of a finished branch by dispatching the read-only reviewer agent, plus the security-reviewer agent when the diff touches sensitive paths, then verifies and triages every finding. Use after any non-trivial change (more than one logic file, or anything in the core) and before land, when the user asks for a review or a second look, or when a diff touches auth, sessions, secrets, external input, personal data, external effects, LLM tools or prompts, CI workflows or dependencies.
argument-hint: "[base-ref, default main]"
allowed-tools: Bash(git diff *) Bash(git log *) Bash(git merge-base *) Bash(git rev-parse *) Bash(git status *)
---

# review

Say at the start: "Using review on <branch>."

## The gate

A non-trivial change does not land without a review from a context that **did not watch it being written**, made
**against its spec**, not "in general". A high-severity security finding blocks the land until it is fixed or a
person accepts it in writing.

Why: an author reviewing their own work shares its blind spots, and most agent-written changes are reviewed by
nobody else (chapter 11). A reviewer asked to "find problems" always finds something, so scope it to correctness and
ignore style; fixing everything produces needless abstractions (chapter 15).

## When not to use it

- One-line edits, docs-only or comment-only diffs: skip it and say why in one line.
- Work in progress: review the finished branch, after your own `verify` evidence exists.
- A periodic sweep of everything landed this week: that is the `quality-auditor` agent or the `audit-repo` skill.

## Steps

1. **Scope the diff.**
   - `base=$(git merge-base main HEAD)`; `git diff --stat $base...HEAD`; `git log --oneline $base..HEAD`.
   - Trivial (see above) → stop and report "review skipped: <reason>".
   - Sensitive if any changed path or hunk touches: auth and sessions; secrets and configuration; external input
     (webhooks, forms, URLs the system fetches, uploaded files); personal data; external effects (publish, send,
     pay); LLM tools or prompts; CI workflows; new or upgraded dependencies.

2. **Find the spec.** The change folder (`openspec/changes/<name>/`, its `specs/` and `tasks.md`), the ADR, or the
   issue. No written spec → state the intended behavior in three lines; that is what the reviewer checks against.

3. **Dispatch.** `reviewer` always; `security-reviewer` too if the diff is sensitive; `test-auditor` too if the same
   agent wrote the code and its tests, or the diff touches money, data or deletion logic. Send them in **one
   message** so they run in parallel. Use the briefs in [brief.md](brief.md). They contain the base and head SHAs, the
   spec, the worktree path and the output format, and **not** your opinion of the change: a reviewer handed your
   conclusion tends to return it. (Plugin agents may be listed as `swarm:reviewer` and `swarm:security-reviewer`.)
   Without the agents, the built-in `/code-review` and `/security-review` commands are acceptable substitutes.

4. **Verify every finding yourself.** Open the cited `file:line`, check the failure scenario; reviewers get things
   wrong. Then classify:

   | Finding | Do |
   | --- | --- |
   | Correctness bug with a concrete failure scenario | fix now through the `tdd` skill (test first) |
   | Missing test for a spec scenario | add it |
   | Security, high severity | fix, or get a person's written acceptance; it blocks the land |
   | Repo rule broken (invariant, gate weakened, docs missing) | fix |
   | Valid but out of scope | record it (change, ticket, or the commit body) |
   | Wrong, or style only | dismiss, with a one-line reason |

5. **Close.** After fixes, run the `verify` skill again. Ask for a second review only if the fixes were themselves
   non-trivial. List dismissed findings with their reasons in the commit body.

## Red flags

| Thought | Reality |
| --- | --- |
| "It is a small change; review is overkill." | "Small" diffs in core or on sensitive paths are where reviews pay off. Use the trivial rule above, not a feeling. |
| "I will tell the reviewer what I did and why it is right." | Give it the diff and the spec; your summary anchors it. |
| "The reviewer found nothing, so it is correct." | Check it ran lint, types and tests and listed the commands. |
| "The reviewer said so, I will apply it." | Verify the finding in the code first; false positives are common. |
| "I will fix every finding to be safe." | Style and impossible cases add code and risk. Fix correctness; dismiss with a reason. |
| "That security issue can wait for a follow-up." | High severity blocks the land unless a person accepts it in writing. |
| "I will review it myself in this session." | You watched it being written. Use a fresh context. |

## Report

```
review: <branch> · base <sha7> · head <sha7> · spec <path | inline>
reviewer:          4 findings · 2 fixed (tdd) · 1 recorded (out of scope) · 1 dismissed (<reason>)
security-reviewer: n/a (no sensitive paths) | 1 high · fixed · verify ✓
test-auditor:      n/a | 2 weak tests strengthened
verify after fixes: ✓ all green (209s)
```

Depth: [brief.md](brief.md), [chapter 15](../../manual/15-review-processes.md) (who reviews what),
[chapter 07](../../manual/07-code-quality.md) (code review rules).
