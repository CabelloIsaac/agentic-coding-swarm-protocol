# land failures: message → cause → action

The messages are those printed by the reference implementation (`reference/scripts/land.ts`), with `main` as the
integration branch. Every failure leaves `main` untouched unless the row says otherwise, and every attempt is
appended to `<git-common-dir>/<project>-land-log.jsonl`. Messages name the pnpm defaults (`pnpm land`,
`pnpm wt:commit`); run the commands your `swarm.json` declares instead.

## Contents

- Guards (before the lock)
- Lock and remote
- Inside the loop
- Publish and cleanup

## Guards (before the lock)

| Message | Cause | Action |
| --- | --- | --- |
| `pnpm land runs from a session worktree, not from the main checkout` | you are in the main checkout | move the work to a worktree (`worktree` skill); never commit in the main checkout |
| `the worktree must be on its own branch (it is on …)` | on `main` or detached HEAD | `git switch -c worktree-<task>` (detached) or start a worktree |
| `there is a .env in the worktree: real spending only happens from the main checkout` | credentials copied into a worktree | do not delete it blindly; tell the human; it must not exist in a worktree |
| `N uncommitted change(s): pnpm wt:commit "<message>" and retry` | dirty tree | `pnpm wt:commit "<message>"` |
| `the branch has no new commits relative to main` | nothing to land, or already landed | check `git log main..HEAD`; report |
| `the branch has wip commits (Stop hook)` | a `wip:` commit is still on the branch | `pnpm wt:commit "<message>"`, or `pnpm land --squash "<message>"` |
| `--squash needs a message` | empty squash message | pass a real message |

## Lock and remote

| Message | Cause | Action |
| --- | --- | --- |
| `another pnpm land is running (<branch, pid>); wait for it to finish and retry` | a live land holds `<project>-land.lock` | wait, then retry. A lock with a dead pid, or with no pid and older than 45 min, is cleared automatically: if it persists, the land is alive. Never delete it or kill its process |
| `could not fetch origin (no network?): main was not touched` | no network | retry later; `--no-push` integrates locally only with the human's agreement |
| `origin/main has N commit(s) that main lacks (two histories; …)` | someone published from another clone | stop; list the commits for the human. Reconciling two histories is a human decision (single-publisher rule, chapter 01) |

## Inside the loop

| Message | Cause | Action |
| --- | --- | --- |
| `conflict while rebasing onto main (rebase aborted, the branch is as it was):` + files | overlapping edits | resolve on your branch: `git rebase main`, read the other side (`git log -p main -- <file>`), keep both intents, `pnpm verify --quick`, `pnpm land` |
| `dependency install failed after the rebase: main was not touched` | the rebase changed the lockfile and install failed | run the install yourself, read its error, fix, retry |
| `verification failed: main was not touched` | the full gate is red on the rebased branch | `verify` skill. Red only in files you did not touch, under load → rerun those files; green alone → retry the land later, lands in series |
| `main moved 3 times during verification; run pnpm land again` | busy integration branch | retry |
| `could not advance main in <path> (no work happens there: it must be clean)` | someone left changes in the main checkout | do not clean it: it may be someone's work. Tell the human which files |

A semantic clash (both branches green alone, red together) shows up as a verification failure in a test neither
branch touched. Read the test; do not just rerun.

Two ADRs with the same number after a rebase (one numbered on a branch, one on `main`): drop the numbering commit
from your branch and let `land` renumber the draft.

## Publish and cleanup

| Message | Cause | Action |
| --- | --- | --- |
| `✗ main integrated locally but NOT published: <reason>` + `Retry: git push origin main` | push rejected or network lost after the fast-forward | read the reason. A `pre-push` rejection means this clone lacks the publisher flag: tell the human, never `--no-verify`. A network error: the human may run the printed command |
| `gc: could not complete (…); pnpm wt:gc retries it` | cleanup failed | harmless; the land is done |

Source: [chapter 03](../../manual/03-integration-land.md), [reference/README.md](../../reference/README.md).
