# Deterministic checks

Run in the background, one at a time if memory is tight. The commands are the pnpm defaults; use the repo's own
from `CLAUDE.md` (other stacks: [INTEGRATION.md](../../INTEGRATION.md) §4).

## Light (step 2, before or alongside the subagents)

```bash
pnpm typecheck                                  # plus each app with its own tsconfig
pnpm lint                                       # exits 0 with warnings: the count and trend come from {audit}
pnpm test:arch                                  # architecture and docs tests
pnpm <domain validators>                        # catalog, tenant or config validators the gate runs
pnpm exec openspec validate --all --no-interactive
pnpm audit --prod                               # once per audit (or {audit} --deps)
git status --short <seed data dirs> <runtime storage dirs>   # did anything dirty the seed or tracked storage?
git log --oneline --grep '^wip' <integration branch>         # stray work-in-progress commits that reached it
```

## Heavy (after the subagents finish, one at a time)

```bash
pnpm test                                       # with coverage only if memory allows
pnpm <end-to-end demo or acceptance run>        # mock modes only, never spends
```

If the last land ran the full `verify` on the audited commit and its log is available, you may cite that run
instead of repeating the heavy checks; say so in the report.

## Investigate before reporting

A red check is a symptom. Before it enters the report, find which of these it is:

- **Code**: the failure reproduces on a clean worktree of the audited commit. That is a finding.
- **Data**: the demo or a validator fails on dirty seed data or a leftover file, not on the code. Report the
  dirty data (and how it got there), not a broken feature.
- **Environment**: a missing tool, a stale build folder, stale dependencies after a rebase. Fix it locally, rerun,
  and mention it in the context paragraph.
- **Load**: see known noise below.

## Known runner noise

- A vitest RPC timeout (`Timeout calling "onTaskUpdate"`) with every test passed: load on the runner, not a
  failure. Write it as noise.
- `Test timed out` in files the changed areas do not touch, while the machine is loaded: rerun those files alone;
  green alone means load.
- `lint` exits 0 with hundreds of warnings: not a failure; the warning count per rule and its trend come from
  `{audit}`.

## Metric hygiene

Before trusting a delta from `{audit}`:

- It excludes playground, sandbox, vendored and generated folders, and copies of fixtures.
- It excludes its own source: the patterns that count `any`, `@ts-ignore` or `TODO` match themselves.
- It reports secrets by path only, never by value; known fake fixtures are listed as such.
- A rise explained by the metric itself is a finding about the metric (stable id, for example `AUD-metrics-noise`),
  and the product's real value is written next to it.
