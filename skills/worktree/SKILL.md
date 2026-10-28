---
name: worktree
description: Starts, checks and cleans up per-session git worktrees under the rule one session = one worktree = one branch. Use at the start of any task that will edit files, whenever you find yourself in the main checkout, when the session-start notice warns about memory, divergence or a .env, when asked about session or worktree status, stale worktrees or orphaned dev servers, and before deleting any branch or worktree.
argument-hint: "[start <task> | status | clean]"
allowed-tools: Bash(git rev-parse *) Bash(git branch *) Bash(git status *) Bash(git worktree list *) Bash(git check-ignore *) Bash(pnpm wt:status *) Bash(pnpm wt:gc --dry-run) Bash(pnpm wt:reap --dry-run) Bash(uptime)
---

# worktree

Say at the start: "Using worktree (<start|status|clean>)."

**Resolve the commands first.** Read `swarm.json` at the repo root: `{status}`, `{commit}` and `{verifyQuick}` are its
`commands.*` keys; fall back to `pnpm wt:status`, `pnpm wt:commit` and `pnpm verify --quick` only when the file or a
key is missing. Contract: [INTEGRATION.md](../../INTEGRATION.md). The cleanup commands (`pnpm wt:gc`,
`pnpm wt:reap`, `pnpm wt:archive`) belong to the reference tooling of level 2; if the repo does not have them, use
the plain-git path at the end.

## The gates

1. **Nobody edits or commits in the main checkout.** Only `land` moves it.
2. **Nothing is deleted without a published archive.** A worktree or branch with unintegrated work is removed only
   by `wt:archive`, which publishes an `archive/<date>-<branch>` tag and checks it on the remote first. `wt:gc`
   removes only worktrees that are integrated, clean and have no live session.
3. **A process belongs to the worktree that contains its cwd.** Never stop a process in another live worktree, and
   never a `claude` process.

Why: a shared working tree produced commits with other sessions' work, overwritten files and lost work; "cleaning
up" deleted unintegrated branches; orphaned dev servers drove swap to 99 % (chapters 01 and 11).

## Where am I?

```bash
git rev-parse --show-toplevel
git rev-parse --git-dir --git-common-dir   # the same path twice → you are in the main checkout
git branch --show-current                  # empty → detached HEAD
```

## start

1. In the main checkout or on `main`: do not edit. Enter a worktree with the `EnterWorktree` tool, or ask the human
   to start the session with `claude -w <task>` (kebab-case task name; branch `worktree-<task>`).
2. Read the session-start notice (the `SessionStart` hook prints it) and act on each warning:

   | Warning | Do |
   | --- | --- |
   | memory pressure warn or critical, swap high | do not start another verify; stop dev servers you no longer need; tell the human |
   | `.env` in the worktree | tell the human; real spend happens only from the main checkout and `land` will refuse |
   | divergence from the remote | tell the human; do not pull or merge (single-publisher rule) |
   | last audit older than 14 days | mention it once; the `audit-repo` skill runs it |
   | too many dev servers or one above 3 GB | stop yours when you are done looking at it |

3. **Baseline.** Run `{verifyQuick}` before your first edit. Red already → report what was red before you started;
   do not fix unrelated failures silently.
4. Use the ports in `.claude/worktree.env` for dev servers, so parallel sessions do not collide.
5. Commit with `{commit} "<message>"`. The `Stop` hook keeps at most one rolling `wip:` commit so nothing is lost;
   `{commit}` absorbs it.
6. Finish with the `land` skill. The worktree stays after a land; the next `land` or session start collects it.

## status

`{status}` (add `--all` for remote branches with unintegrated work). Report per worktree: branch, ahead/behind,
dirty, wip, integrated, age, processes and memory. Flag branches older than three days without a land: long-lived
branches are where semantic conflicts grow.

## clean

Only when the human asks, or when the session notice says integrated worktrees or orphaned processes are piling up.

1. Dry run first, always: `pnpm wt:gc --dry-run` and `pnpm wt:reap --dry-run`. Show the lists.
2. Then `pnpm wt:gc` and `pnpm wt:reap`.
3. Unintegrated work the human wants gone: `pnpm wt:archive <branch>`, only on their explicit request. It refuses
   if the branch diverged, is dirty or is locked; do not work around a refusal, report it.

## Without the reference tooling

Plain git keeps the same rules:

```bash
git check-ignore -q .claude/worktrees || echo "add .claude/worktrees/ to .gitignore first"
git worktree add .claude/worktrees/<task> -b worktree-<task> main
```

Install dependencies inside the new worktree; it has no `node_modules` and no `.env`, and that is deliberate.
Remove a worktree only after its branch is merged (`git branch --merged main`), with `git worktree remove <path>`;
never `--force` on a dirty one.

## Red flags

| Thought | Reality |
| --- | --- |
| "It is a one-line fix; I will do it in the main checkout." | Another session's land will find a dirty tree and fail. Use a worktree. |
| "These old worktrees are clutter; delete them." | Some hold unintegrated work. `gc` for integrated ones, `archive` for the rest, on request. |
| "That dev server is eating memory; kill it." | Check its cwd. If it is in another live worktree, it is not yours. |
| "I will `git stash` to switch context." | The stash stack is shared by every worktree; another session can pop your entry. Commit instead. |
| "My branch is a week old but still fine." | Rebase now and land in small steps; long branches breed conflicts git cannot see. |
| "The baseline is red, I will fix it while I am here." | Report it. Unrelated fixes belong in their own worktree and branch. |

## Report

```
worktree: <path> · branch <name> · ahead 3 / behind 0 · clean
baseline: <verifyQuick command> → ✓ | ✗ (pre-existing: <step>)
warnings: <none | what the session notice said and what you did>
```

Depth: [chapter 01](../../manual/01-sessions-and-worktrees.md) (lifecycle, hygiene, single workstation).
