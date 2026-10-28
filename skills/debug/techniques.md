# debug techniques

## Contents

- Environment: checks before blaming the code
- Intermittent failures
- Tracing a bad value back to its source
- Bisecting a regression
- Failures that only appear after a rebase or a land

## Environment: checks before blaming the code

Many parallel sessions on one machine produce failures that look like bugs. Check these first; each takes seconds.

| Check | Command or place | Tell |
| --- | --- | --- |
| Machine load | `uptime`; memory pressure and swap | load above ~30 or swap above 85 % with 20 s / 120 s timeouts and nothing else red |
| Stale dependencies | did the last rebase change the lockfile? `git diff ORIG_HEAD HEAD --stat -- <lockfile>` | `Cannot find package` / `Cannot find module` |
| Generated leftovers | `.next/types`, codegen output, build caches (all git-ignored) | type errors in files nobody wrote |
| Someone else's process | the session tooling's status command; processes whose cwd is another worktree | port in use; a dev server answering with old code |
| Credentials | a `.env` in the worktree | behavior differs from CI or from other worktrees |
| Disk | free space; count of `<project>-*` entries in `$TMPDIR` | `ENOSPC` |
| Hung child | workers at 0 % CPU for minutes | a child waiting on stdin (once an `ffmpeg`) |

A process belongs to the worktree that contains its cwd: never stop processes that live in another worktree or a
`claude` process.

## Intermittent failures

Suspect the test before the code. Typical causes and the probe that exposes each:

| Cause | Probe |
| --- | --- |
| shared global state between tests | run the file alone, then the whole suite; run with a different order (`--sequence.shuffle`) |
| real clock or timezone | freeze or inject the clock; run with another `TZ` |
| shared `/tmp` paths or fixed ports | grep the test for literal paths and ports; give each test its own temp dir |
| ordering of async work | look for a missing `await` or a fire-and-forget promise; floating promises are a lint error for this reason |
| load | the same file green alone and red in the full run under high load |

A failure that reproduces every time is never "flaky": it is a bug, in the code or in the test. If an intermittent
test is not fixed the same day, it is quarantined outside the gate with a ticket and an expiry date, never `skip`ped.

## Tracing a bad value back to its source

1. Note where the wrong value is observed (the assertion, the log line).
2. Find the function that returned it; check its inputs. Inputs already wrong → go one call up.
3. Repeat until inputs are right and the output is wrong: that function holds the defect.
4. At component boundaries (storage, gateway to external systems, LLM provider), log what goes in and what comes
   out once; boundaries are where contracts drift.

## Bisecting a regression

When a behavior worked on an earlier commit of `main`:

```bash
git bisect start <bad-sha> <good-sha>
git bisect run <single-test command for the failing test>
git bisect reset
```

Run this in your own worktree. The first bad commit points at the change; read its diff and its ADR or change.

## Failures that only appear after a rebase or a land

- **Semantic clash:** two branches green alone, red together, with no textual conflict. Read the failing test and
  both commits that touched the logic; the fix belongs to whoever lands second.
- **Duplicate ADR number:** one ADR numbered on a branch, another on `main`. Drop the numbering commit and let
  `land` renumber the draft.
- **Stale worktree:** days without a rebase; reinstall only triggers if this rebase changed the lockfile. Install
  and retry.

Source: [chapter 01](../../manual/01-sessions-and-worktrees.md), [chapter 02](../../manual/02-verification.md),
[chapter 04](../../manual/04-testing.md), [chapter 11](../../manual/11-anti-patterns.md).
