# Reference implementation

This is the specification of the tooling behind the playbook, written so that you — or an agent — can implement it
in any stack, **plus a working implementation of it**. The code in this folder is extracted from a production system
(PLINNG) and parametrized: every project-specific constant lives in `reference/scripts/dev-flow.config.ts`, names and messages are
generic and in English, and the comments that explain *why* (edge cases, guards, thresholds) are kept because they are
the knowledge. It mirrors scripts that have run daily for months of very intensive development in the reference
project, across hundreds of serialized lands and dozens of parallel agent sessions on one machine.

All scripts are small Node programs (Node 24+ runs TypeScript directly) with no dependencies beyond `node:*`; tests use
vitest. The one exception is `reference/scripts/roadmap.ts`, which parses YAML with the `yaml` package. Every script has its own
tests: breaking the workflow is breaking the product. The code is type-correct but was not run against your repo: adapt
the config and the example rules first.

## Files

Layout when adopted: `reference/scripts/` → `scripts/dev/` (the path `swarm.json`, the hooks, `templates/CLAUDE.md` and
`templates/claude/settings.json` all use), `reference/tests/` → `test/`, `reference/config/` → repo root (or `.githooks/`,
`.github/workflows/`). The tests import `../scripts/dev-flow.config.ts`; after the move that import becomes
`../scripts/dev/dev-flow.config.ts`. Add `verify.logDir` (default `tmp/verify`) to `.gitignore` before the first land: the
log files verify writes would otherwise appear as "uncommitted change(s) appeared" and land would abort.

| File | Spec section |
|---|---|
| `reference/scripts/dev-flow.config.ts` | Configuration surface (every constant) |
| `reference/scripts/verify.ts` | `verify` — the single gate |
| `reference/scripts/land.ts`, `reference/scripts/remote.ts` | `land` — serialized, always-green integration |
| `reference/scripts/git.ts` | `land` (lock, stale detection, fast-forward helpers) and `wt` (worktree parsing) |
| `reference/scripts/review-receipt.ts` | Review gate — receipts keyed by patch id (`write`, `check`) |
| `reference/scripts/wt.ts` | `wt` — worktree tooling |
| `reference/scripts/procs.ts` | Memory and process helpers |
| `reference/scripts/adr.ts` | `adr` — conflict-free decision records |
| `reference/scripts/roadmap.ts` | `roadmap` — derived status |
| `reference/scripts/audit.ts` | `audit` — deterministic debt metrics |
| `reference/scripts/ratchets.ts` | Quality ratchets — file size, coverage floor gap, lint budget (`check`, `--size-only`, `--tighten`, `--init`) |
| `reference/scripts/playground.ts` | Sandbox for throw-away experiments (`playground:new`) |
| `reference/scripts/test-tmp.ts`, `reference/scripts/vitest-setup.ts`, `reference/scripts/vitest-global-setup.ts`, `reference/tests/cleanup-tmp.ts`, `reference/tests/sequencer.ts` | Test infrastructure |
| `reference/scripts/gitignore.test.ts` | Test infrastructure (caches must be ignored, or `wip:` commits swallow them) |
| `reference/tests/architecture.test.ts` | Architecture test (rules table on top, mechanisms below) |
| `reference/tests/docs.test.ts` | Docs test |
| `reference/config/pre-push` | `pre-push` hook |
| `reference/config/vitest.config.ts`, `reference/config/tsconfig.base.json`, `reference/config/ci.yml` | Test infrastructure, `verify` (CI runs the same checks) |
| `reference/config/biome.reference.json` | Lint config. Named `.reference` on purpose: a nested `biome.json` breaks the host repo's lint. Copy it to your root as `biome.json`. |

## Configuration surface

Put every project-specific constant in one file (for example `dev-flow.config.ts`) and read it from all scripts.

| Key | Example | Used by |
|---|---|---|
| `integrationBranch` | `main` | all |
| `remote` | `origin` | `land`, `remote` |
| `installCommand` | `pnpm install --frozen-lockfile --prefer-offline` | `land`, `wt setup` |
| `lockfile` | `pnpm-lock.yaml` | `land`, `wt setup` |
| `verify.full` / `verify.quick` | lists of steps (see below) | `verify` |
| `tmpPrefix` | `<project>-` | `verify`, test setup |
| `publisherFlag` | `<project>.publisher` | `pre-push`, `land` |
| `devToolPattern` | `node\|tsx\|vitest\|next\|esbuild` | `wt reap`, `wt gc` |
| `portBase` / `portRange` | `3200` / `400` | `wt setup` |
| `adrDir` | `docs/adr` | `adr`, `land` |
| `generatedFiles` | regex of framework-generated files to restore | `land`, `wt gc` |
| `review` | `{ mode: 'sensitive', sensitive: ['**/auth/**', '**/migrations/**', '.github/**', …] }` (the `review` block of `swarm.json` on the integration branch wins) | `land`, `review-receipt` |

The implementation adds a few more keys, all documented in `reference/scripts/dev-flow.config.ts`: `projectName` and `envPrefix`,
`landMaxAttempts`, `staleLockMinutes`, `hooksDir`, `verify.optionalSuites` and `verify.ensureFiles`, `agentProcess`,
`devToolArgsPattern`, `portServices`, `heavyServer`, `memory`, `audit.*`, `playgroundDir`, `mustBeGitignored`. The
architecture and docs tests keep their own rules tables at the top of each file.

## `verify` — the single gate

**Purpose:** run exactly what CI runs, print only a summary and the tail of each failure, keep full logs on disk.

**Full tier** (`verify`): cheap steps in parallel, test steps serially.

1. lint · 2. typecheck (root and each app with its own tsconfig) · 3. domain contract validators (the `validators`
step in `verify.full`: registries, tenant configs, fixtures against their schemas) · 4. spec validation ·
5. tests with coverage at 50 % of cores (`--maxWorkers=50%`), including end-to-end runs.

CI runs these same steps plus documented extra jobs (CI ⊇ verify), never fewer.

**Quick tier** (`verify --quick`): built from the changed files, which are the union of
`git diff --name-only <integration>...HEAD`, `git diff --name-only HEAD` and `git ls-files --others --exclude-standard`.

- Always: typecheck and the structural suites (architecture test + docs test).
- Lint only the changed source files.
- Per-app typecheck only if that app changed; validators only if their folder changed.
- Last: `vitest run --changed <integration> --passWithNoTests`.
- Known limit, stated in `CLAUDE.md`: import-graph test selection misses tests that read YAML or templates without
  importing them. The quick tier never closes a task.

**Process model.**

- Each step runs as `sh -c <cmd>` with `detached: true`, so it leads its own process group.
- Per-step timeout (30 min): SIGTERM to the group, SIGKILL 3 s later.
- When `sh` exits, kill the whole group so orphaned workers and dev servers die with it.
- `SIGINT`/`SIGTERM`/`SIGHUP` kill every running group, then re-raise the signal.
- `FORCE_COLOR=0`, `NO_COLOR=1` so logs are greppable.
- Before running, delete `$TMPDIR/<prefix>*` entries older than 60 minutes.

**Output.** `✓/✗ <step> (Ns)` per step; for failures, the last 40 non-empty lines minus package-manager noise; full
logs at `storage/tmp/verify/<step>.log`; a final `✓ all green (Ns)` or `✗ N step(s) red · logs in …`; exit 0/1.
Print which optional suites (for example database contract tests) were included or skipped.

**One tolerated flake, by exact signature.** A non-zero test exit passes only if the output shows `Tests N passed`,
no `failed`, no coverage error, and the error count equals the count of
`Error: [vitest-worker]: Timeout calling "onTaskUpdate"` lines. Nothing else is ever tolerated.

## `land` — serialized, always-green integration

Flags: `--squash "<message>"`, `--no-push`, `--no-review "<reason>"`. Retries: 3.

1. **Guards (before the lock).** Must run from a linked worktree, on a named branch that is not the integration
   branch; no `.env` in the worktree; no uncommitted changes. Without `--squash`, refuse pending `wip:` commits.
   Zero commits ahead is an error.
2. **Lock.** Create `<git-common-dir>/<project>-land.lock` exclusively (`wx`) with `{branch, pid, at}`. A lock is
   stale if its pid is dead, or if it has no pid and is older than 45 minutes. If held, report the holder and exit.
3. **Remote check.** `git fetch --prune`. If `origin/<integration>` has commits the local branch lacks, abort and
   list them: two histories must never be merged silently. Without network, `--no-push` continues locally.
4. **Loop (≤ 3 attempts).**
   1. Rebase onto the integration branch. On conflict: list `--diff-filter=U` files, `rebase --abort`, log, exit.
      `land` never resolves conflicts.
   2. If the rebase changed the lockfile blob, reinstall dependencies. Then the **review gate** (next section): if
      the review mode covers the change and there is no passing receipt for its patch id, abort with "run
      /swarm:review (no receipt for this change)". It runs here, after the rebase and before the ADR commit, so the
      patch id is the one the reviewer saw. With `--no-review "<reason>"` it is skipped and a `review-bypassed`
      entry with the reason is logged (an empty reason is refused before the lock).
   3. Number draft ADRs and regenerate the ADR index; commit if anything changed.
   4. Record `verified = git rev-parse HEAD`, then run the full `verify`. On failure: "integration branch untouched".
   5. Require `HEAD == verified` and a clean tree (generated files restored first). Otherwise abort: something wrote
      to the branch while verify ran (typically a Stop-hook `wip:` commit) and its tip is not what was verified.
   6. If the integration branch moved meanwhile, loop again.
   7. Fast-forward **to the verified SHA, never to the branch name**: in the worktree that has the integration branch
      checked out, restore generated files and run `git merge --ff-only <verified>`, so the ref and the working tree
      move together. If no worktree has it checked out, `git update-ref refs/heads/<integration> <verified> <old>` as
      a compare-and-swap.
5. **Publish** inside the lock: `git push <remote> refs/heads/<integration>:refs/heads/<integration>`. On failure,
   keep the local advance, print the manual command and exit 1.
6. **Clean up:** run `wt gc`. A gc failure does not undo the land.
7. **Log** every attempt as JSONL (`landed`, `failed` + reason, `conflict` + files, `review-bypassed` + reason) in
   `<git-common-dir>/<project>-land-log.jsonl`. These are your workflow metrics.
8. Release the lock in `finally`.

**PR mode** (for teams that integrate through pull requests): steps 1–4.4 run with the quick tier, then push the
branch and open a PR with auto-merge; the merge queue runs the full gate and numbers ADRs.

## Review gate — receipts

**Purpose:** make the per-change review a gate of `land`, bound to the exact change that was reviewed.

- **Receipt** (INTEGRATION.md §1): `{"patch_id", "base", "head", "reviewers": [], "verdict": "pass" |
  "changes_requested", "open_high", "at"}`, one JSON file per change at `<git-common-dir>/swarm-reviews/<patch_id>.json`.
  Local to the clone, shared by its worktrees, never committed.
- **Key:** `git diff --no-color --no-ext-diff <integration>...HEAD | git patch-id --stable`, first field. It hashes
  the change, not the commits: stable across `--squash` and a clean rebase, new for any further edit. If the
  integration branch edits the context lines around a hunk, the id changes and the change is reviewed again.
- **Writing:** the `review` skill writes it after triage and fixes, on the committed branch, with a documented
  git + `printf` sequence (any stack) or `review-receipt.ts write --reviewers <a,b> --verdict <v> --open-high <n>`.
  `write` refuses an empty change and a `pass` with `open_high > 0`.
- **Config:** `review.mode` is `always`, `sensitive` or `off`; `review.sensitive` is a list of globs (`**` any depth,
  `*` one segment, `?` one character; a pattern without `/` matches the basename at any depth). Read from
  `swarm.json` **on the integration branch** (`git show <integration>:swarm.json`), so a branch cannot relax its own
  gate; without it, from the config file. The template default is `sensitive`, with globs for auth and sessions,
  payments and billing, migrations and SQL, CI and git hooks, agent settings (`.claude/**`), `swarm.json`, the dev
  tooling, the test, coverage and lint configuration, the architecture and docs tests, and the lockfile.
- **Check** (`reviewGate`, also `review-receipt.ts check`): `off` → pass. `sensitive` with no changed path
  (`git diff --name-only --no-renames <integration>...HEAD`) matching → pass, not required. Otherwise, required: the
  receipt for the current patch id must exist, parse, say `pass` and have `open_high: 0`; anything else fails with
  the action to take. An empty change needs no receipt.
- **Tests** (`reference/self-test/review-receipt.test.ts`, `node --test`): patch id stable across a rebase and new
  after an edit; sensitive vs always vs off; missing and `changes_requested` receipts block; the branch's own
  `swarm.json` cannot switch the gate off; land refuses without a receipt and lands with one after rebasing; the
  `--no-review` reason is required and logged.

**PR mode:** the equivalent is a required review on protected paths (`CODEOWNERS` with the sensitive globs) plus
branch protection; the receipt is then the review approval on the pull request.

## `wt` — worktree tooling

| Subcommand | Behaviour |
|---|---|
| `setup` (SessionStart hook) | In the main checkout: remind that work happens in worktrees, run `gc` and `reap` under the land lock, print memory, divergence and stale-audit warnings. In a worktree: install deps if `node_modules` is older than the lockfile (skip under critical memory pressure), assign deterministic ports (`portBase + hash(name) % portRange * 2`) into `.claude/worktree.env`, warn about `.env`, reap orphans, warn about too many or too large dev servers. Errors exit 0: a session hook never blocks a session. |
| `wip` (Stop hook) | If the tree is dirty, not in the main checkout, no rebase/merge/cherry-pick is in progress and no live `land` holds the lock for this branch: `git add -A` and `git commit --no-verify -m "wip: <ISO>"`, amending if the tip is already this branch's `wip:`. At most one rolling wip commit. During a land of its own branch it does nothing: land integrates exactly the SHA it verified and would abort on a moved tip. |
| `commit "<msg>"` | Absorb a trailing `wip:` (`reset --soft HEAD~1`), stage everything, commit. |
| `status [--all]` | Per worktree: branch, ahead/behind, dirty count, wip count, integrated or not, last commit age, processes and RSS. `--all` adds remote branches with unintegrated work. |
| `gc [--dry-run]` | Remove worktrees that are integrated, clean (except generated files) and have no live session. Stop their processes first (SIGTERM, SIGKILL after 5 s), never an agent process. |
| `reap [--dry-run]` | Stop dev-tool processes that are orphaned or live in a worktree without a live session. Respect the branch of a running land. |
| `archive <branch>` | Create the tag `archive/<YYYY-MM-DD>-<branch>`, push it, verify with `ls-remote` that it points to the same commit, and only then delete the worktree and the local and remote branch. Refuse if diverged, dirty or locked. |

**Live session** = an agent process whose cwd is inside the worktree, or a worktree lock whose recorded pid is alive.
**A process belongs to the worktree that contains its cwd** (`lsof -d cwd -Fpn` on macOS, `/proc/<pid>/cwd` on Linux).

## Memory and process helpers

- One `ps -axo pid=,ppid=,rss=,args=` call plus cwd lookup; never throw.
- Memory pressure: macOS `sysctl kern.memorystatus_vm_pressure_level` (1/2/4 → normal/warn/critical) and
  `vm.swapusage`; Linux `MemAvailable` below 20 % is warn, below 10 % critical.
- Warn when swap > 75 %, more than 10 integrated worktrees linger, or system indexers exceed 4 GB.

## `adr` — conflict-free decision records

- New ADRs are created as `docs/adr/draft-<slug>.md` and cited as `ADR-draft-<slug>`.
- At land time: assign `max + 1` (four digits) in sorted order, rename, and rewrite references in every tracked
  `.md/.ts/.tsx/.yaml/.yml/.json` file, longest slug first, including the ADR's own heading.
- Regenerate the index table between `<!-- generated:adr-index -->` and `<!-- /generated:adr-index -->`, reading
  the status from a `- Status:` line.

## `roadmap` — derived status

Input: `roadmap.yaml` with `goal`, `waves` and `changes[]` (`id`, `title`, `block`, `wave`, `priority`,
`depends_on`, `absorbed_by`, `frozen`). Status is derived: no folder = planned; in `changes/` = active (progress from
`tasks.md` checkboxes); in `changes/archive/` = done. Fail on duplicate ids, invalid priority, P0/P1 without a wave,
unknown wave, frozen P0, a dependency that is missing or in a later wave, a missing `absorbed_by` target, or an active
change without an entry.

## `audit` — deterministic debt metrics

Offline, in seconds, no spend. Measures lint warnings per rule; `any`, `as unknown as`, `@ts-ignore`,
`biome-ignore` (and those without a reason); files over 500 lines; TODO/FIXME/HACK; active, nearly-done and
never-started changes; spec validation errors; env vars missing from `.env.example`; secret patterns in tracked files
(paths only); draft ADRs; coverage floor vs. measured; days since the last audit. `--write` stores a JSON snapshot so
the next run prints deltas.

## Test infrastructure

- **Per-file temp dir.** A setup file creates `mkdtemp(<tmp>/<prefix>vitest-<pid>-)`, points `process.env.TMPDIR` at
  it (children inherit it), and restores and deletes it in `afterAll`.
- **Leak interception.** Patch `fs.mkdtempSync` to record every top-level `<prefix>*` directory, and wrap
  `process.env` in a Proxy that records temporary project roots; sweep in `afterAll` and on `process.on('exit')`.
- **Global sweep** at startup: delete `<prefix>vitest-<deadpid>-*` dirs and loose roots older than 6 hours.
- **Slow-first sequencer.** Move `*.e2e.test.ts` and the demo test to the front: fresh worktrees have no timing
  history, and the slowest file otherwise starts last and stretches every land.

## Architecture test

Turn each invariant into an import-graph or pattern test:

- "Only `src/storage` imports `fs`" (and `pg`, object-storage SDKs).
- "The kernel imports only kernel modules and schemas", with an explicit kernel/domain classification for every
  file in the boundary folders.
- "The LLM SDK is imported only in `src/llm`."
- "Domain code never calls `fetch`; it goes through the gateway."
- "Nothing imports from `playground/`."
- "Registered implementations and the registry match, in both directions."
- "Append-only logs expose no update or delete; every record schema requires `schema_version`."

Each exception list is a table of `file → imports → reason`, plus a test that fails on stale entries. Lists only
shrink. The file header says: do not fix a failure by adding an exception without updating the architecture doc.

## Docs test

Rules table on top (folders, indexes, invariant prefix and padding), generic mechanisms below. Ignoring fenced code:
relative links resolve; backticked repo paths exist; `functionName()` mentions exist in the code (with a stop-list of
generic names). Structure, checked against its index: every source module and every package or app is named in the
architecture docs; every CLI command appears in the README; every extension guide is linked from the docs index;
every ADR file is listed in the ADR index. Invariants, in both directions: every id in the table has a test (or a
stated reason in a `notTested` list that only shrinks) and every id a test cites has a row. Numbering: prose and
tests must not cite invariant ids in a different numbering (`INV-1` or `INV-001` when the table says `INV-01`).

## `pre-push` hook

Reject pushes to the integration branch unless `git config --bool <project>.publisher` is `true` on this clone.
Other branches and tags are allowed. `--no-verify` is the conscious escape hatch. Template:
[templates/githooks/pre-push](../templates/githooks/pre-push).
