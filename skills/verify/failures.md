# verify failures: signature → cause → action

Read this when a red step's tail does not tell you what to do. Find the row whose signature matches, apply the
action, and report the class and the evidence named in the last column.

## Contents

- Tolerated infrastructure flake (the only one)
- Load and machine state
- Environment and stale state
- Real failures, by step
- Flaky tests

## Tolerated infrastructure flake (the only one)

`verify` itself passes the tests step, with a warning, only when **all** of these hold: the output has
`Tests N passed`, no `failed`, no coverage error, and the number of errors equals the number of
`Error: [vitest-worker]: Timeout calling "onTaskUpdate"` lines. You never extend this by hand. Any other failure,
however "infra-looking", is triaged below. Report it as `Tolerated: vitest RPC timeout ×N`.

## Load and machine state

| Signature | Cause | Action | Evidence to report |
| --- | --- | --- | --- |
| `Test timed out in 20000ms`, `Hook timed out in 10000ms` in files your diff does not touch | several sessions verifying at once (load > 30, swap > 85 %) | `uptime`; `pnpm vitest run <failing files>`; if green alone, retry when load drops; `pnpm wt:reap` and `pnpm wt:gc` first | `uptime` line + rerun result |
| a step that hits the 30-minute cap; workers at 0 % CPU | a child process waiting on stdin, or an orphaned worker | find children by parent pid; fix the test that spawns without closing stdin | the stuck process and the fix |
| `ENOSPC` | temp directories piling up (once 173,000 of them) | find the `<project>-*` leftovers in `$TMPDIR`; fix the test that does not register its temp dir | count before and after |
| swap near 99 %, the system indexer above 20 GB | the machine, not the code | stop dev servers you no longer need; tell the human (only a reboot fixes it) | memory figures |

Rule of thumb: check `uptime` **before** blaming the code, and **before** blaming the machine prove the files pass
on their own.

## Environment and stale state

| Signature | Cause | Action |
| --- | --- | --- |
| `Cannot find package` / `Cannot find module` right after a rebase | the lockfile changed, or the worktree was already stale | `pnpm install`, rerun |
| type errors under `.next/types` or another generated folder | leftovers from an old dev server | delete the generated, git-ignored folder; rerun |
| a test that needs a key or the network fails in CI only | the test is badly designed | make it use mock or replay mode; never add the secret to CI |
| a Postgres (or other optional) suite listed as `skipped` | no test database on this machine | not a failure; report it as skipped |

## Real failures, by step

| Step | Typical signature | What it means | Do |
| --- | --- | --- | --- |
| lint | `lint/<group>/<rule>` errors | rule broken in changed code | fix; a suppression needs `// biome-ignore <rule>: <reason>` |
| typecheck | `TS2322`, `TS2345`… | type contract broken | fix the type, never `any`, `@ts-ignore` or `as unknown as` to silence it |
| validators | schema error naming a file | config no longer matches its schema or references something missing | fix the config or the reference |
| specs | `openspec validate` error on a MODIFIED requirement | a modified requirement dropped its scenarios | copy the whole block, scenarios included (chapter 06) |
| tests | `AssertionError` / `expected … received …` | behavior changed | if intended, update the test and say why in the commit; if not, fix the code (`tdd` skill) |
| coverage | `ERROR: Coverage for lines (85.1%) does not meet global threshold (86%)` | new code without tests | add tests; never lower the floor |
| architecture test | an import or pattern rule names your file | you crossed an invariant | change the design; an exception needs a reason in the allowlist **and** the architecture doc updated in the same change |
| docs test | `missing path`, `undocumented module`, `function does not exist` | docs fell behind the code | update the doc that the message names |
| format | `Formatter would have printed the following content`, a diff of whitespace or quotes | the code is not formatted | run the formatter (`pnpm biome format --write <files>`; `ruff format`, `gofmt -w`, `cargo fmt`) on the files it names and commit with the change; never turn the step off or loosen the config. A whole-repo reformat is its own `chore: format` land (chapter 07) |
| ratchets: `silentErrors` | `✗ silentErrors: <file> has N silent catch(es) (recorded M): <file>:<line>` | you added a `catch` that swallows the error (empty, returns a literal, or `.catch(() => undefined)`) | open the line: log with context, rethrow a typed error, or return a Result. Never raise the recorded count or add an exception in `quality-ratchets.json` (it is a review-gate path and `verify` fails on the loosening). A catch that logs is not counted |
| deps | `✗ deps: high GHSA-… <package> <range>: <title> [no allowlist entry]` | a dependency has a known high or critical vulnerability | upgrade it (its own change, full verify). If no fixed version exists or the path is unreachable, add an entry to `deps-allowlist.json` with `reason`, `owner` and a short `expires`, and say so in the PR. `allowlist entry expired` means the loan is due: upgrade or renew with a new reason. "did not run": the audit printed no JSON (offline or registry down); retry, it is never treated as clean |
| e2e / demo | acceptance criteria of a mock end-to-end run not met | the pieces no longer fit | reproduce with the demo command alone; then `debug` |

## Flaky tests

A test that sometimes passes and sometimes fails:

1. Suspect the test first: global state, test order, shared `/tmp`, real clock, fixed ports.
2. It is not retried blindly and not marked `skip`.
3. Not fixed the same day → quarantine outside the gate with a ticket and an expiry date; the audit counts them and
   that number may not rise.
4. A test that fails reproducibly is never "flaky": it is a bug, in the code or in the test.

Source: [chapter 02](../../manual/02-verification.md), [chapter 04](../../manual/04-testing.md).
