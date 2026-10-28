# Checklists

Short on purpose. One per key moment.

## Starting a task

- [ ] The task is on the roadmap (or I change the roadmap first).
- [ ] There is an OpenSpec change if behavior changes; I know what "done" means (scenario, test, command).
- [ ] New session in its own worktree: `claude -w <task>` (or your tmux wrapper). Never in the main checkout.
- [ ] I read the `wt:setup` notices (memory, divergence, overdue audit).
- [ ] Specific prompt: files, symptom, what "fixed" means, preferences between options.

## While working

- [ ] `pnpm verify --quick` after each block; a single file with `pnpm vitest run <path>`.
- [ ] Bug → the red test first.
- [ ] No `.skip`, no lowered thresholds, no exceptions without a reason.
- [ ] Context > 70%: `/checkpoint`; switching tasks: `/clear`.
- [ ] Two failed corrections: `/clear` and a better prompt.

## Spending tokens wisely (chapter 16)

- [ ] I read symbols and line ranges, not whole files; output trimmed with `tail`/`head`/filters.
- [ ] Independent calls in parallel in the same turn.
- [ ] High effort only where a mistake is expensive; subagents only to parallelize, isolate noise or review.
- [ ] Session idle for more than an hour with a large context: `/clear` + `/checkpoint load` rather than carrying on.
- [ ] Whatever a command can answer, I ask the command.

## Committing

- [ ] `pnpm wt:commit "<type(scope): what changes and why>"`.
- [ ] An `Assumption: <what> — <why>` trailer for each decision made without asking.
- [ ] No secrets and no real data outside their place.

## Before integrating

- [ ] Full `pnpm verify` green (I paste the last line).
- [ ] Independent review (`reviewer`) if the change is not trivial; `security-reviewer` if it touches auth, secrets,
      external input, personal data, external effects or dependencies.
- [ ] Docs updated: the area's architecture doc, README if there is a new command, the guide if how to extend changes.
- [ ] Draft ADR if a contract, an invariant or a formula changes.
- [ ] Change tasks ticked; if it is complete, `openspec archive`.

## Integrating

- [ ] `pnpm land`. Conflict → `git rebase main` on my branch, resolve, `verify --quick`, repeat.
- [ ] Timeouts under load → `uptime`, rerun only those files, retry when the lock is free.
- [ ] Foreign commits on the remote → stop and warn. Never `--no-verify`, `merge` or `push` by hand.

## Asking the human a question

- [ ] Is it outside the accepted scope, or is it spend, autonomy, irreversible or a contract? If not, I decide and
      declare it.
- [ ] Full card: Context · Challenge · Concern · Recommendation · Impact (low/medium/high) · Reversible (yes/no) ·
      Evidence (`file:line`).

## Reviewing someone else's code (or an agent's)

- [ ] I start from the diff and the spec, not from the author's summary.
- [ ] I run lint, types and tests; I cite the command and the result.
- [ ] Only findings with a failure scenario (`file:line`, input → wrong result, fix).
- [ ] I look for weakened tests, suppressions without a reason, new exceptions, missing docs and ADRs.
- [ ] I ignore style. If everything is fine, one line with the evidence.

## Review schedule (chapter 15)

- [ ] Daily: integration branch health, failed lands, production errors, untriaged feedback.
- [ ] Weekly: quality sweep of what was integrated in 7 days + dependencies and security.
- [ ] Biweekly: global audit across five dimensions (`audit-repo`).
- [ ] End of a wave: audit + roadmap.
- [ ] Monthly: flow metrics; delete hooks, skills and rules that add nothing.
- [ ] Quarterly: ADRs and invariants still in force.

## New piece of the system (adapter, plugin, entity…)

- [ ] I follow its `docs/extending/` guide from start to finish.
- [ ] The guide's required tests, including mock mode.
- [ ] Registered where it belongs; documented in its area.
- [ ] If it creates a folder in `src/`, a record type or a command: the docs test will ask me for it.

## New ADR

- [ ] Does it change a contract, an invariant, the shape of a flow or a formula? If not, it is not needed.
- [ ] `docs/adr/draft-<slug>.md` from the template; cited as `ADR-draft-<slug>`.
- [ ] Context with data; checkable decisions; good and bad consequences; confirmation; alternatives.
- [ ] If it touches an invariant: row in the table and test in the same change.
- [ ] The ADR it supersedes: only its Status line.

## Closing the session

- [ ] Work integrated, or committed with its status in the change (`tasks.md`) or a `/checkpoint`.
- [ ] Dev servers stopped.
- [ ] Nothing that must survive runs inside the session (if something does, in its own tmux window).
- [ ] Lasting lessons go to memory or `CLAUDE.md`; task-specific ones go to the checkpoint.
