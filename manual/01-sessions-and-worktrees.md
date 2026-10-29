# 01 · Sessions and worktrees

**Rule:** one session = one worktree = one branch. Nobody edits or commits in the main checkout; only integration
(`land`) moves it. In the reference project this was decided in four ADRs: the multi-session workflow, resource
hygiene, the memory guard and the single workstation.

## Why

Before this rule, several sessions shared one tree on the main branch. Every commit required separating hunks by
hand with a temporary git index. That took most of each session's time and tokens, and it still failed: commits
containing someone else's work, chained ADR renumbering, work lost when a session died, and a file copied into the
main tree that overwrote another session's edits made minutes earlier. With one worktree per session, a commit is
a normal commit again, and conflicts show up where they belong: in the rebase of whoever caused them.

## The session lifecycle

```
claude -w <task>           # or EnterWorktree; creates .claude/worktrees/<task> on branch worktree-<task>
   │  SessionStart hook → wt:setup: installs deps if needed, assigns ports, warns about memory and divergence
   ▼
work                       # pnpm verify --quick while iterating
   │  Stop hook → wt:wip: commit "wip: …" (a single one, amended) so nothing is lost if the session dies
   ▼
pnpm wt:commit "<message>" # absorbs the wip and makes the real commit (or a normal git commit)
   ▼
pnpm land                  # rebase → number ADRs → full verify → ff of main → push → gc
```

Two settings make `claude -w` behave: `"worktree": { "baseRef": "head" }` in the versioned
`.claude/settings.json`, so new worktrees branch from the main checkout's current `HEAD` (the local integration
branch, which `land` keeps current) instead of a remote ref that may lag behind; and a `.claude/.gitignore` with
`worktrees/` and `worktree.env`, so session folders and per-worktree ports never get committed (templates in
`templates/claude/`).

The worktree stays in place after the land. The next `land` or `wt:setup` deletes it once it is integrated, clean
and has no live session. Nothing with unintegrated work is ever deleted.

## What `wt:setup` does (`SessionStart` hook)

Its output enters the session's context, so what it prints is written as warnings for the agent:

- **In the main checkout:** reminds the agent that no work happens there, takes the land lock, runs `gc` and
  `reap`, and warns about memory, divergence from the remote and an overdue audit.
- **In a worktree:** installs dependencies if `node_modules` is older than the lockfile (skipped when memory is
  critical); assigns **deterministic ports** from the worktree name (`3200 + hash % 400 * 2`) and writes them to
  `.claude/worktree.env` as `export <PREFIX><SERVICE>_PORT=<n>` lines (dev scripts `source` it, so parallel
  sessions never fight over port 3000); warns if a `.env` exists (land will refuse); collects orphaned processes; warns if more
  than 3 dev servers are running or one exceeds 3 GB.
- **Memory warnings** when: pressure is `warn`/`critical`, swap > 75%, more than 10 integrated worktrees remain
  undeleted, or system indexing processes exceed 4 GB. It lists the top three consumers and what to do.

`setup` and `wip` errors exit with code 0: **a session hook never blocks the session.**

## What the `Stop` hook does (`wt:wip`)

If the tree is dirty, no rebase/merge is in progress, you are not in the main checkout and no `land` of this
branch is running (land integrates exactly the SHA it verified, so a commit during verify would only make it abort): `git add -A` and commit
`wip: <date> (Stop hook; pnpm wt:commit absorbs it)` with `--no-verify`. If the tip is already a `wip:` on this
branch, it uses `--amend`: there is at most **one** rolling wip commit. Nothing is lost if the session dies, and
`land` refuses to integrate a stray `wip:` (use `wt:commit` or `land --squash "<message>"`).

## Early overlap detection (`overlap`)

Worktrees stop sessions from overwriting each other's files. They do not stop two sessions from doing incompatible
work: both stay green on their own branch, and the collision appears when the second one runs `land`, after both have
spent their tokens and a full verify. The later it appears, the more work is thrown away, and with N parallel sessions
there are N·(N−1)/2 pairs that can collide.

`overlap` moves that moment to the first minutes. It is read-only and never blocks:

| Finding | How it is found | What the agent does |
| --- | --- | --- |
| ✗ **conflict** — two branches will not merge | `git merge-tree --write-tree` between the two tips (git 2.38+): no checkout, milliseconds, only for pairs that share a file | stop and coordinate; whoever lands second resolves it on its branch |
| ⚠ **shared** — two branches touch the same file, git merges it cleanly | changed files since the merge base, plus uncommitted ones (generated files excluded) | read what the other branch is changing; a clean merge can still be a semantic conflict |
| ⚠/✗ **behind** — the integration branch changed files this branch touches | merge base → integration branch, intersected with the branch's files; merge-tree predicts the rebase | rebase now, while it is small |

Where it runs:

- **Session start** (`overlap --session`, after `wt:setup`): the other live sessions and the areas they touch
  (`feature-x: src/billing (4)`), so the agent can pick its approach before it edits anything.
- **After an edit** (`overlap --notify`, a `PostToolUse` hook on Edit/Write): checks this branch at most every
  `notifyEveryMinutes` (default 5) and speaks only when the overlap **changed** since its last notice, as
  `additionalContext` the agent reads next to the tool result. A pair that keeps overlapping is not repeated on every
  edit; a new pair, a new file or a new predicted conflict is.
- **On demand:** `node scripts/dev/overlap.ts` (`--all` for every pair, `--json`, `--strict` to exit 1 on a
  predicted conflict).

What it does not see: a dependency between different files (A changes a function's signature in one file, B adds a
call to it in another). That needs the stack's import graph; until then, `verify --quick` after a rebase is what
catches it. It also sees only the worktrees of this clone: sessions on other machines are invisible until they publish.

## Resource hygiene

Each worktree is ~800 MB of `node_modules` and, with dev servers and vitest, several GB of RAM. Rules:

- **A process belongs to the worktree that contains its `cwd`** (read with `lsof -d cwd` on macOS,
  `/proc/<pid>/cwd` on Linux). That is how you know what to kill and what to leave alone.
- `wt:gc [--dry-run]` deletes worktrees that are **integrated, clean and have no live session** (live session = a
  `claude` process with its cwd inside, or a worktree lock with a live pid). It stops their processes first
  (SIGTERM, SIGKILL after 5 s), never a `claude` process.
- `wt:reap [--dry-run]` kills dev tools (`node|tsx|vitest|next|esbuild`) that are orphaned or sit in worktrees
  without a session. It respects the branch held by a land lock with a live pid.
- `wt:status [--all]` shows each worktree: branch, ahead/behind, dirty, wip, integrated, age, processes and RSS.
  `--all` adds remote branches with unintegrated work.
- Every destructive command has `--dry-run`.
- **Machine limits:** at most 3–4 sessions verifying at once; stop the dev server when you are done looking at it;
  `next dev --turbopack` (webpack reached 5–9 GB).

## Single workstation

In the reference project, two machines produced two divergent `master` branches for six days (405 unpublished
commits) and nothing raised an alarm. Decision:

- **Only one machine commits and publishes.** The others are screens (SSH/mosh over VPN, `/remote-control`).
- `land` runs `fetch` first and **aborts if `origin/main` has foreign commits**; after the fast-forward, it
  publishes. `--no-push` integrates offline.
- A versioned `pre-push` hook rejects pushes to `main` unless the clone has `git config <project>.publisher true`
  (local, set by a human). `git push --no-verify` is the documented, deliberate escape hatch for a human who knows
  why (the hook's message says so); agents never use it.
- **Nothing is deleted without an archive:** `wt:archive <branch>` creates and publishes the tag
  `archive/<date>-<branch>`, verifies with `ls-remote` that it points to the same commit, and only then deletes the
  worktree, the local branch and the remote branch.
- GitHub is the published copy: it runs CI and stores the tags.

## Sessions in tmux

All agent sessions run in tmux on the single integration workstation: one tmux session per repo and one window per
worktree. Rules: always launch through a small tmux wrapper, never the bare agent binary; one conversation lives in
one place (never `--resume` the same one in two terminals); before closing or moving someone else's session, check
its state (`busy`/`shell` = work in progress, only with permission); processes that must outlive the session get
their own window; the machine never sleeps.

## Ignored files the worktree needs

A worktree is a clean checkout: it has no `.env` and no `node_modules`. Two mechanisms:

- Claude Code copies into each worktree whatever you list in `.worktreeinclude` (same syntax as `.gitignore`).
  Small files only: it copies, it does not link. **The reference project deliberately does not use it for
  `.env`**: real spend happens only from the main checkout.
- Dependencies are installed by `wt:setup` (or by a `WorktreeCreate` hook if you prefer installing at creation).

## Subagents and worktrees

A subagent that edits files can declare `isolation: worktree` in its definition: it works in a temporary worktree
from the default branch and is cleaned up automatically if nothing changed. Useful for `builder`; unnecessary for
`reviewer` and `architect`, which are read-only.

## Common mistakes

- **Editing in the main checkout** "just for a moment." Permission classification blocks it in an isolated
  session; if you do it by hand, another branch's `land` finds a dirty tree and fails.
- **Stale worktree (days without a rebase).** Dependency reinstall only triggers if **this** rebase changes the
  lockfile; if it was already out of date, `verify` fails with "Cannot find package" → run `pnpm install` and retry.
- **Leftovers from an old dev server** (`.next/types`) break typecheck after a rebase → delete the generated folder
  (it is git-ignored).
- **Semantic clashes git cannot see** (two branches change the same logic without touching the same lines): read
  the failing test; do not just rerun. `overlap` flags the shared files early; it cannot prove the logic agrees.
- **Ignoring an overlap notice** because "git will merge it": a clean textual merge of two changes to the same
  function is exactly where the semantic clash hides.
- **Two ADRs with the same number** (one numbered on the branch, another on main): drop the numbering commit and
  let `land` renumber the draft.

## What to copy into your repo

`reference/scripts/wt.ts` (setup, wip, commit, gc, reap, status, archive) and `reference/scripts/overlap.ts` (early
overlap detection, wired as `hooks.postEdit` and after `wt:setup`) with `reference/scripts/procs.ts` (process
ownership by `cwd`, group kills) and `reference/scripts/remote.ts` (divergence check); the `pre-push` hook in
`templates/githooks/pre-push`; and the `SessionStart`/`Stop` hook wiring in `templates/claude/settings.json`. Keep
the two non-negotiables: a session hook always exits 0, and nothing is deleted without a published archive tag.
