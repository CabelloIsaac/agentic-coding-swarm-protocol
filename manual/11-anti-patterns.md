# 11 · Anti-patterns

Each one with its symptom and its fix. Those marked ★ we lived through in the reference project, with a documented
incident.

## Workflow and branches

| Anti-pattern | Symptom | Fix |
| --- | --- | --- |
| ★ **Working tree shared between sessions** | commits containing someone else's work, overwritten files, work lost when a session dies | one worktree and one branch per session; only `land` moves the main checkout |
| ★ **Two machines that publish** | two diverging `main` branches for days (405 commits) with no warning | a single publisher (`pre-push` + local flag); `land` aborts on foreign commits; divergence warnings at startup |
| **Long-lived branch** | merge hell, semantic conflicts git cannot see, hours-long rebases | branches of hours or days; integrate several times a day; ship big work in integrable steps (flags, branch by abstraction) |
| **Manual merge into the integration branch** | non-linear history, unverified "fixes", nobody knows what happened | `land` with ff-only and a lock; never a manual `merge` |
| ★ **Hand-edited indexes and numbering** | two ADRs with the same number, renumbering 10 files | drafts numbered at integration; indexes generated between markers |
| ★ **A single hot file** | the same document touched in 74 of 143 commits | split by area; generated lists |
| **Resolving the conflict "wherever"** | someone who did not cause the conflict resolves it without context and breaks something | `land` aborts and lists; resolve on the branch that caused it, with `rebase` |
| ★ **Deleting branches or worktrees while "cleaning up"** | unintegrated work lost | nothing is deleted without a published and verified `archive/*` tag; `gc` removes only what is integrated, clean and has no live session |
| ★ **Unabsorbed wip** | `wip:` commits integrated, unreadable history | `land` refuses to integrate `wip:`; `wt:commit` absorbs them |

## Verification and tests

| Anti-pattern | Symptom | Fix |
| --- | --- | --- |
| **Local gate differs from CI** | "passes on my machine"; nobody trusts either one | one `verify` that CI calls as is |
| ★ **Calling it done on the quick gate** | `--changed` misses tests that read YAML without importing it; red code gets integrated | the quick gate to iterate, the full one to finish; `land` requires the full one |
| ★ **Reading whole logs** | the session burns context on 3,000 lines of vitest output | summary plus a 40-line tail; logs on disk |
| **Retry until it passes** | a flaky test "fixed" with 3 retries hides a concurrency bug | suspect the test first; one tolerated infra signature in code; quarantine with a date and an audit counter |
| **`.skip` to integrate** | the suite "passes" with fewer tests | lint and the tier guard send it to human review; the audit counts skips |
| ★ **Weakening tests to make them pass** | deleting a test, lowering a threshold, adding `@ts-expect-error` in tests | anti-weakening guard → human approval; AST diff of test cases; coverage that only goes up |
| **Coverage as quality** | 95 % line coverage, 30 % of mutants killed; tests that assert nothing | review assertions; adversarial `expect_fail` benches; mutation testing on critical code |
| ★ **Ownerless temp files** | 173,000 directories, full disk, ENOSPC under parallel runs | per-file `TMPDIR`, an `mkdtemp` interceptor, sweeps by dead pid and by age |
| ★ **Slow test scheduled last** | the 5-minute demo starts last and stretches every land | "slowest first" sequencer; `.e2e.test.ts` suffix |
| ★ **Hung child process** | a worker at 0 % CPU for 30 min; an `ffmpeg` waiting on stdin | timeout and retry in the wrapper; process groups killed on exit |
| **Test that needs credentials** | CI red without secrets; "add the token to CI" | mock/replay; if it needs keys, the test is badly designed |
| ★ **Blaming the code on a loaded machine** | 20 s timeouts with load 30 and swap at 90 % | `uptime` first; rerun only the failing files; queue lands; `gc` and `reap` |

## Architecture and documentation

| Anti-pattern | Symptom | Fix |
| --- | --- | --- |
| **Invariant that lives only in a document** | erodes within weeks, unnoticed | ID + why + test; allowlists with reasons that only shrink |
| **Exception added to pass the architecture test** | the allowlist grows without reasons | "do not fix a failure with an exception without updating the docs"; a test for stale entries |
| **Docs that cite what no longer exists** | dead paths and functions; nobody trusts the docs | a documentation test (links, paths, functions, new undocumented structure) |
| **Architecture in `CLAUDE.md`** | 600 lines the agent ignores | `CLAUDE.md` < 200 lines with pointers; the agent reads the repo |
| **Edited ADR** | nobody knows what was decided when | immutable; superseded by a new one |
| **Decision without an ADR** | "why did we do this?" six weeks later | if it changes a contract, an invariant or a formula, it needs an ADR or it is not ready |
| ★ **Modified spec without scenarios** | `archive` breaks weeks later | MODIFIED copies the whole block; `openspec validate` in `verify` |
| **Hand-written roadmap status** | archived items still "active"; nobody updates it | status derived from folder existence; a validator that fails |
| **Spike that leaks into the system** | `core` imports from an experiment; the experiment holds real data | `playground/` quarantined by a test; entering the system takes a change |

## Agents

| Anti-pattern | Symptom | Fix |
| --- | --- | --- |
| **All-caps rule** | the agent still skips it one time in ten | if it allows no exceptions, a hook or `deny`; if it does, a plain sentence |
| **Hooks for preferences** | forty hooks firing when they should not | keep the enforced set small; preferences go in `CLAUDE.md` |
| **"Done" without evidence** | bugs that show up the next day | ask for the command and its output; a `Stop` hook with a type-check; an independent reviewer |
| **Loop without a cap** | spend without progress that looks like diligence | `--max-turns`, a budget, verification before re-planning |
| **"Almost right" first draft integrated** | hidden debugging later; edge cases in production | budget verification as part of the work; spec and constraints in the prompt |
| **Integrating without human review** | 79 % of agent PRs are reviewed by whoever generated them; none by a second person | review against the spec from another context; risk tiers: T3 requires a human OK |
| **Trusting what cannot be verified** | security code nobody reviews | automated review and scanning; treat agent PRs as higher risk |
| **Measuring lines or tokens** | the biggest spender looks the most productive | cost per useful outcome; churn; incidents per change |
| **Subagent to think better** | same model, more tokens, same answer | subagents to parallelize, isolate noise or review with fresh eyes |
| **Third correction in the same session** | the conversation already holds two failed attempts that get re-read | `/clear` and a better prompt |
| **One session, five tasks** | every turn pays for the previous four; worse answers | one task, one session; `/clear` between tasks |
| **Asking "shall I continue?" within scope** | the tech lead receives 356 nudges in 11 days (29 % of them "keep going") | do not stop within accepted scope; ask by rule, with a complete brief; `/goal` |
| ★ **Undeclared assumptions** | the agent makes product decisions nobody knows about | an `Assumption:` trailer in the commit; measured and reviewed, not blocked |
| **2,000-line skill** | loads everything on every use; the agent gets lost | progressive: description, body < 500 lines, separate files |
| **Unaudited third-party skill** | data exfiltration | install only from trusted sources; review dependencies, resources and outbound connections |
| **Delegating without a brief** | the subagent comes back with your hypothesis confirmed | goal, what is ruled out, files to read, narrow scope; give it the code, not your conclusion |

## Machine resources

| Anti-pattern | Symptom | Fix |
| --- | --- | --- |
| ★ **Worktrees nobody deletes** | 23 worktrees × 800 MB; the OS indexer at 23 GB | `gc` on every land and every session; a warning past 10 integrated |
| ★ **Orphaned dev servers** | several `next dev` processes at 5–9 GB; swap at 99 % | "a process belongs to the worktree of its cwd"; `reap`; turbopack; stop it once you are done looking |
| ★ **N sessions verifying at once** | false timeouts, lost vitest RPC | 3–4 at most; half the workers; lands in series |
| **Installing under critical memory pressure** | the install makes the collapse worse | `setup` skips it when memory is critical and warns |
| **Two terminal clients of different sizes** | constant redraws, a slow Claude Code | `tmux attach -d`; a native terminal with mosh |
