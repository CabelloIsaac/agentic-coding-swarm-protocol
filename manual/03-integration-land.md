# 03 · Integration: `land`

**Rule:** the integration branch (`main`; `master` in the reference project) advances only through `pnpm land`:
serially, always green, always fast-forward. Nobody merges by hand or resolves conflicts in the main checkout.

## The steps, in order

1. **Guards, before the lock.** It must run from a linked worktree (not the main checkout); the branch exists, is
   not `main` and HEAD is not detached; **there is no `.env` in the worktree** (real spend happens only from the
   main checkout); there are no uncommitted changes (it points you to `wt:commit`).
2. **Commits.** Without `--squash`, it refuses if any `wip:` commit remains. With `--squash "<message>"`, it
   squashes everything since the merge base into one commit. Zero commits ahead of main is an error.
3. **Lock.** A `<project>-land.lock` file in git's common directory with `{branch, pid, at}`, created in exclusive
   mode. A lock with a dead pid, or with no pid and older than 45 min, is treated as abandoned. If another land
   holds it, it errors and says who holds it.
4. **Remote.** `git fetch --prune`. If `origin/main` has commits that main lacks ("two histories"), it **always
   aborts** and lists up to 10. Offline, `--no-push` continues locally.
5. **Loop (up to 3 attempts):**
   - **Rebase** onto main. On conflict: list the files, `rebase --abort`, record `conflict` and fail. The branch is
     left as it was. **land never resolves conflicts.**
   - **Reinstall dependencies** if the rebase changed the lockfile blob.
   - **Number draft ADRs** (`draft-<slug>` → `00NN-<slug>`), rewriting references across the repo, and regenerate
     the index; commit the result.
   - **Full verification** (`verify`). On failure: "main was not touched."
   - If main moved during verification, go back to the start of the loop.
   - **Advance:** in the worktree that has main checked out (the main checkout), restore framework-generated files
     and run `merge --ff-only`. The ref and the working tree move together. If no worktree has main, use
     `update-ref` with an old-value check.
6. **Publish** (inside the lock): `push origin main:main`. If it fails, main stays advanced locally, the manual
   command is printed and the exit code is 1.
7. **Cleanup:** `wt:gc`. A gc failure does not undo the land.
8. **Log:** each attempt (`landed`, `failed` with reason, `conflict` with files) is appended to
   `<project>-land-log.jsonl`. These are the workflow metrics: conflict rate, duration, attempts.
9. The lock is released in `finally`.

Final message: `✓ N commit(s) from <branch> on main (<sha>, published to origin, Ns, N attempt(s))`.

## What each piece protects against

| Piece | Failure it prevents |
| --- | --- |
| Lock with pid | two lands at once; a dead land blocking forever |
| Abort on foreign commits in the remote | two divergent histories nobody notices (it happened: 405 commits in 6 days) |
| Rebase, not merge | linear history; the conflict is seen by whoever caused it, with their context |
| Reinstall when the lockfile changes | "Cannot find module" after a rebase |
| Number ADRs at integration | number collisions between branches (one forced renaming 10 files) |
| Full verification inside the lock | integrating red; two branches green separately but red together |
| Re-verify if main moved | a verification that was valid for a base that no longer exists |
| ff-only | integration merges, non-linear history, manual "fixes" |
| Reject `.env` | two worktrees with credentials publishing or purchasing twice |
| JSONL log | measuring the workflow (p50 land time, % without conflict) and having a rollback criterion |

## Conflicts

Conflicts do not disappear; they move into the rebase. The protocol: `git rebase main` on your branch, resolve,
`pnpm verify --quick`, and rerun `pnpm land`. To reduce them:

- **Split hot files.** In the reference project, `docs/architecture.md` appeared in 74 of 143 commits because every
  branch appended rows to the same lists. It was split by area (`docs/architecture/<area>.md`) and conflicts
  dropped.
- **Generated indexes** (ADRs, commands) between markers, regenerated at integration, never edited by hand.
- **Drafts numbered at integration** (ADRs), not at creation.
- **Short branches.** The longer a branch lives, the more likely a semantic conflict that git cannot see.

## Performance and load

First land measured with the current workflow: 214 s, of which 204 s were the test suite. What slows it down or
breaks it:

- A child process hung reading stdin blocks a worker until the cap (30 min). If you see workers at 0% CPU, look
  for orphaned children by `ppid`.
- Load from several sessions: false timeouts. Rerun only the failing files and queue the lands.
- Swap at 99% and the system indexer above 20 GB: only a reboot fixes it.
- Slow tests (e2e, demo) run **first** in the suite so they do not stretch the tail (`SlowFirstSequencer`).

## Risk tiers (designed, not yet enforced in the reference project)

The `dev-land-tiers` change proposes that `land` computes, from paths and without an LLM, the tier of a branch
(the maximum over its files) and asks for human approval only at the top tier:

- **T0** automatic: tests that weaken nothing, docs, specs, PRDs, playground.
- **T1** automatic: UI, configuration data, templates.
- **T2** automatic but logged and visible: domain schemas, a new folder in core, a new external integration, the
  kernel, a new ADR.
- **T3** human approval: data and migrations; auth; spend and external effects; infra and secrets; **and the gates
  themselves** (land, verify, architecture and docs tests, test and lint config, hooks).
- **Test-weakening guard → T3:** a test deleted without an equivalent, fewer cases per directory (counted via
  AST), `.skip`/`.only`/`.todo` added, coverage threshold lowered, suppressions added in tests.
- Approval is bound to **content** (blob hashes of the T3 files): it survives a rebase and is invalidated by any
  later edit.
- Emergency exit `--skip-tier-gate "<reason>"`, reserved for the tech lead, logged and notified.
- Rollout: three days in report-only mode, then enforce.

See chapter 12 for the rest of the autonomy design.

## What to copy into your repo

The whole script, `reference/scripts/land.ts` with its helpers `reference/scripts/git.ts`,
`reference/scripts/remote.ts` and `reference/scripts/adr.ts` (specified in `reference/README.md`), with these
parameters: integration branch name, verification command, install command,
lock name, ADR numbering hook (or drop it), and the local publisher flag. Above all, copy **the social rule**:
nobody touches the integration branch except the script.
