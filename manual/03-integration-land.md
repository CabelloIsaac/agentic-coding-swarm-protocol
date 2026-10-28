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
   - **Review gate.** If `review.mode` covers the change (`always`, or `sensitive` with a changed path matching
     `review.sensitive`), require a passing review receipt for its patch id, or abort with "run /swarm:review (no
     receipt for this change)". Before verify, so a missing review costs seconds, not a whole verify. See "Review
     gate" below.
   - **Number draft ADRs** (`draft-<slug>` → `00NN-<slug>`), rewriting references across the repo, and regenerate
     the index; commit the result.
   - **Record the SHA** about to be verified (`verified = rev-parse HEAD`), then run the **full verification**
     (`verify`). On failure: "main was not touched."
   - **Check nothing moved:** `HEAD` must still be `verified` and the tree clean. Otherwise abort: the tip is no
     longer what was verified.
   - If main moved during verification, go back to the start of the loop.
   - **Advance to the verified SHA:** in the worktree that has main checked out (the main checkout), restore
     framework-generated files and run `merge --ff-only <verified>`. The ref and the working tree move together. If
     no worktree has main, use `update-ref refs/heads/main <verified> <old>` (an old-value check).
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
| Review receipt keyed by patch id | a sensitive change landing with no review, or with a review of an earlier version |
| Fast-forward to the verified SHA, not the branch name | a commit created while verify ran (a Stop-hook `wip:`) landing unverified |
| Stop hook idle while its branch lands | that same commit being created in the first place |
| ff-only | integration merges, non-linear history, manual "fixes" |
| Reject `.env` | two worktrees with credentials publishing or purchasing twice |
| JSONL log | measuring the workflow (p50 land time, % without conflict) and having a rollback criterion |

### Incident: fast-forwarding a name instead of the verified SHA

The first version of `land` verified the branch and then ran `merge --ff-only <branch>`. Verification takes 5–10
minutes; in that window the session's Stop hook fired, found the tree dirty and created a `wip:` commit. The
fast-forward then moved main to the new tip, so a commit nobody had verified (and with a `wip:` subject that `land`
otherwise refuses) was integrated and published. It happened twice before it was caught by a periodic audit. The fix
has two halves, and both are needed: `land` records the SHA before verifying, refuses to advance if the tip moved or
the tree changed, and fast-forwards that exact SHA; and the Stop hook does nothing while a live land lock belongs to
its branch. General lesson: **between a check and the action it licenses, pin the object by identity (a hash), never
by a name that can move.**

## Review gate

Review used to be a suggestion: the `reviewer` agent existed, and nothing required it. The two audits that fed
[the defect classes](../checklists/defect-classes.md) found about 60 problems; many were visible in the diff that
introduced them (a run opened outside its `try`, a budget check fed `0`, a dedupe marker written after the work, a
`pass` with no evaluation), and they were found up to ten days later. `land` now enforces review the way it
enforces verify.

- **Receipt.** The `review` skill ends by writing `<git-common-dir>/swarm-reviews/<patch_id>.json` with
  `{patch_id, base, head, reviewers, verdict, open_high, at}`. Local to the clone, shared by its worktrees, never
  committed.
- **Key.** `git patch-id --stable` over `git diff <integration>...HEAD`: a hash of the change, not of the commits. It
  survives `--squash` and land's own rebase; any later edit changes it, so a receipt never covers unreviewed code.
  It also changes if the integration branch edited the lines right next to your hunks; then review again.
- **When it is required.** `swarm.json` → `review.mode`: `always` (every change), `sensitive` (the default: only when
  a changed path matches `review.sensitive`: auth, payments, migrations, CI, quality gates, agent settings,
  dependencies) or `off`. Land reads the block **from the integration branch**, so a branch cannot switch off its own
  review, and `swarm.json` is itself a sensitive path.
- **What passes.** A receipt for the current patch id with `verdict: "pass"` and `open_high: 0`. A missing receipt,
  `changes_requested` or open High findings abort before verify, with the integration branch untouched.
- **Where in the loop.** After the rebase (so the patch id is the rebased change) and before the ADR-numbering commit
  (which would change the diff the reviewer saw).
- **Escape hatch.** `land --no-review "<reason>"`. The reason is mandatory and written to the land log as
  `review-bypassed`, where the daily review, which reads the land log, sees it. Use it for an emergency, a docs-only
  change in `always` mode, or a change a person reviewed outside the tooling.

The receipt carries a hash and size of the full review report stored next to it, and `check` verifies both. That
proves the report exists, is long enough to be a report, and has not changed since the receipt was written. It does
not prove the reviewer was independent or competent: the session that wants to land still writes the receipt, so
independence remains a process matter (a fresh agent, a person, a required CODEOWNERS review). What the gate buys
is that skipping review becomes a deliberate, logged act instead of a silent default, and that a review is bound to
the exact change it saw. The receipt is written by a plain shell sequence (it uses command substitution), so an
agent whose shell tool is restricted to simple commands must run it through a script file instead. For a team that integrates through pull requests, the same rule is a required review on
protected paths (`CODEOWNERS`) plus branch protection.

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
