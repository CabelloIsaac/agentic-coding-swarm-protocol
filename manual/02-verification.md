# 02 · Verification: one gate, two levels

**Rule:** `pnpm verify` runs the same steps as CI and is the only definition of "green". Run `pnpm verify --quick`
while iterating; run the full `pnpm verify` before calling anything done. The full run is what `land` requires.

## Why a single gate

When the local gate and the CI gate differ, the team learns to trust only one. When the gate prints whole logs, an
agent session burns context reading them. When there is no quick level, nobody runs it until the end and errors
pile up. `verify` solves all three: **the same steps as CI, a summary plus the tail of each failure, two levels.**

## Full level (`pnpm verify`)

In this order; cheap steps in parallel, tests serially:

| Step | Command | What it protects |
| --- | --- | --- |
| lint | `biome lint` | lint errors (warnings do not block, but they are measured debt) |
| typecheck | `tsc --noEmit` (root and each app with its own tsconfig) | zero type errors |
| contract validators | your project's validators (in the reference project, `catalog:validate` for the tool registry, skills and playbooks, and `workspace:validate` for every tenant's config) | config YAML/JSON matches its schema and references only things that exist |
| specs | `openspec validate --all` | a modified spec without scenarios would break archiving later |
| tests + coverage + e2e | `vitest run --coverage --maxWorkers=50%` | tests, coverage floor, end-to-end demo (a full mock run that must meet the product's acceptance criteria) |

Tests use half the cores because, with several sessions on the machine, vitest with every worker loses its own
RPC. CI uses a single worker because of runner memory.

## Quick level (`pnpm verify --quick`)

It is built from **what changed**: the union of `git diff main...HEAD`, `git diff HEAD` and untracked files.

- Always: typecheck and the **structural rules** (`test:arch`: architecture and documentation tests).
- Lint only the changed files.
- Typecheck an app only if something under it changed; run a validator only if its folder changed.
- Finally: `vitest run --changed main --passWithNoTests` (tests affected through the import graph).

**Known limit, and why quick is not enough:** `--changed` follows the import graph and **cannot see tests that read
YAML or templates without importing them**. That is why the quick level never marks anything as done.

## How each step runs

- Each step runs in `sh -c` with `detached: true`: **it leads its own process group**. On completion, timeout or
  signal, the whole group is killed, so no vitest worker or dev server survives.
- 30 min timeout per step; SIGTERM, then SIGKILL 3 s later.
- `SIGINT`/`SIGTERM`/`SIGHUP` kill every group and re-raise the signal on verify itself.
- `FORCE_COLOR=0`, `NO_COLOR=1`: logs are read with `grep`.
- Sweeps `$TMPDIR/<prefix>-*` older than 60 min before starting (in the reference project, about 173,000 leftovers
  once filled the disk).

## Output

```
✓ lint (4s)   ✓ typecheck (18s)   ✗ tests + coverage + demo (212s)
  … last 40 non-empty log lines, with pnpm noise stripped …
✗ 1 step(s) red · logs in storage/tmp/verify/
```

Full logs live in `storage/tmp/verify/<step>.log`. It also prints whether the Postgres suites are **included or
skipped** (depending on whether a test database exists): skipped suites are visible, not hidden.

## Tolerated flakiness: exactly one, tightly bounded

The only failure `verify` forgives is vitest's internal RPC timeout under machine load, and only when **all** of
these hold: there is `Tests N passed`, there is no `failed`, there is no coverage error, and the number of errors
equals the number of `Timeout calling "onTaskUpdate"` lines. Then it prints a warning and passes.

General pattern: **you may tolerate a known infrastructure failure identified by its exact signature, never a test
failure.** Everything else falls under the flaky-test policy (chapter 04).

## Under machine load

With 3–4 sessions verifying at once (load > 30, swap > 85%), 20 s/120 s timeouts appear with nothing broken.
Protocol:

1. Check `uptime` and memory before blaming the code.
2. Rerun **only** the files that failed: `pnpm vitest run <files>`.
3. If they pass alone, retry `land` once the lock is free; chain lands from several branches **in sequence**,
   never in parallel.
4. Before all of that: `pnpm wt:gc` and `pnpm wt:reap`.

## CI is the mirror

`.github/workflows/ci.yml` runs the same steps as the full `verify`, without secrets and in mock mode, plus: a
Docker image that is built and checked to **contain no `.env`**; a job with Postgres and object storage that
migrates a clean database, runs the contract suites and checks that an end-to-end demo run on files and on Postgres
produces the same record count and hash per event log. It cancels earlier runs on the same branch.

**If a gate needs credentials to pass, the test is badly designed.**

## What to copy into your repo

- A single `verify` script with the CI steps, `--quick` driven by changed files, process groups with timeouts,
  summary plus tail, logs on disk.
- CI that calls the same commands (it does not reimplement the list).
- An allowlist of **one** infrastructure failure with an exact signature, and nothing else.
- One line in `CLAUDE.md` with both commands and why quick is not enough.

Reference: `reference/scripts/verify.ts` (specified in `reference/README.md`) and
`templates/github/workflows/ci.yml`.
