# 08 · Working with agents (Claude Code)

**Rule:** keep `CLAUDE.md` short and limited to what the agent cannot infer from the repo; put procedures in
skills; put zero-exception rules in hooks and `deny`; use subagents to parallelize, isolate noise or review with
fresh eyes, not to "think better"; give every task something executable that returns pass/fail.

## `CLAUDE.md`: what goes in and what stays out

It loads in every session: every line costs attention on every task. Test each line before writing it: could the
agent find this by reading the code? Would it go looking? If both answers are yes, leave it out.

In:
- how work is confirmed (exact test, type-check and lint commands, and how to run a single file);
- where the code misleads (an old pattern not to copy, a folder that looks unused but is not);
- decisions that are not in the repo (which error helper, how deployment works, what needs review);
- anything you have corrected twice;
- pointers to the long documents (architecture, quality, roadmap), not their content.

Out: descriptions of the architecture or layout (the agent reads them), all-caps emphasis (if a line is ignored,
the file is too long or the line should have been a hook), personal preferences (`CLAUDE.local.md`, git-ignored).

A structure that works (template in `templates/CLAUDE.md`): an opening sentence ("if a rule stops you from doing
something, do not work around it: propose the change and update the docs"); before touching anything (priorities,
product, architecture, guides, change workflow); parallel work; invariants with a pointer to their test; docs are
part of the change; verification (two levels and why); spend and data; style. Each section short, citing the ADR
that justifies it. Under 200 lines; `/doctor` suggests cuts.

Rules that only matter in one part of the repo: `.claude/rules/<topic>.md` with `paths:`; they load only when work
happens there (example: `templates/claude/rules/storage.md`).

## Hooks: what cannot fail

| Event | In the reference project | General use |
| --- | --- | --- |
| `SessionStart` | `wt:setup` (deps, ports, memory warnings, divergence, overdue audit) | inject context that is not in the repo |
| `Stop` | `wt:wip` (rolling commit so nothing is lost) | or `tsc --noEmit 1>&2 \|\| exit 2` so the turn does not end red |
| `PreToolUse` | (planned: log `AskUserQuestion` to the dev panel) | block edits to protected folders, validate commands |
| `PostToolUse` | — | format after `Edit\|Write` |
| `WorktreeCreate` | — | install deps when the worktree is created |
| `PreCompact` | automatic checkpoint (context policy) | save state before detail is lost |

Principles: a session hook **never blocks** (it exits 0 even on failure); `exit 2` only for zero-exception rules;
`onFailure: "block"` for security hooks (so a hook failure also blocks); keep the set small (if you reach forty,
most were preferences). `prompt`/`agent` hooks are decided by another model: they are not deterministic and cannot
enforce anything. Plugin hooks: `hooks/hooks.json`.

## Permissions

- `deny` applies in every mode, including auto: `Read(./.env)`, `Read(./secrets/**)`. It catches `cat .env`; it
  does not catch a script that opens the file. For that, use the sandbox.
- `ask` for `git push *` and anything irreversible.
- `allow` for the verification commands.
- Repo-level `allow` rules wait for each person's trust dialog; `deny` rules apply immediately.
- In auto mode, the classifier blocks the dramatic cases, but it is a model: "never" rules go in `deny` or hooks.
  A "don't push until I've reviewed" in the conversation works, but is lost on compaction.

Template: `templates/claude/settings.json`.

## Skills: team procedures

A `SKILL.md` with `name` and `description` frontmatter (the description decides when it loads: use case first,
then trigger phrases; truncated at 1,536 characters) and a body with the procedure. Rules:

- Progressive: only the description is always in context; the body loads on invocation; long material lives in
  separate referenced files. Keep `SKILL.md` under 500 lines.
- `disable-model-invocation: true` for anything with side effects (release, land, spend): only a human triggers it.
- Narrow `allowed-tools` (`Bash(git add *) Bash(git commit *)`), not broad.
- `context: fork` only if the skill has explicit instructions; a guidance skill returns nothing from a subagent.
- State clearly whether a script is **executed** or **read**.
- Evaluate before trusting: does it trigger on the right prompts? Does it beat a session without it?
- Install only from trusted sources: a skill can exfiltrate data.

Shape of a procedure skill (model: the audit skill, `skills/audit-repo/SKILL.md`): goal; guardrail (read-only,
never spends); modes by argument; where and how to run (own worktree, serialize heavy work); context to gather
without subagents; deterministic checks with the exact bash block and the known noise; parallel subagents with
their full prompt (path, constraints, changed areas, previous findings, output format); the main agent re-verifies
every high finding ("subagents get things wrong"); a report skeleton; "do not fix anything unless asked".

Shape of a discipline skill (model: `skills/verify/SKILL.md`, `skills/land/SKILL.md`): a description that says
when to use it, not how it works (an agent that reads a summary of the procedure follows the summary); the gate in
one plain sentence with its reason, enforced by a script or hook wherever possible; when not to use it; exact
commands resolved from `swarm.json`, with a branch for each failure the command can report; a table of the
thoughts that precede a shortcut and what is true instead; and an evidence block the answer must contain. Long
material (every failure message, subagent briefs, report skeletons) lives in a sibling file read on demand.

Templates: `skills/` (`playbook`, `worktree`, `tdd`, `debug`, `verify`, `review`, `new-adr`, `land`, `audit-repo`,
`adopt`).

## Subagents

When they pay off: independent work in parallel; long output you do not want in your context (a wide search, a
full suite); a reviewer that has not seen how the code was written; fewer tools than the main session (a reviewer
that reads but cannot edit, **enforced** by the harness). When they do not: a 1–2 step task, anything that needs the
conversation's context, or hoping for "a better answer" (it is the same model).

Eight team agents (templates in `agents/`). Each has least-privilege tools, a fixed procedure, explicit stop
conditions and a compact return format so the main context stays small:

| Agent | Model | Tools | For | Returns |
| --- | --- | --- | --- | --- |
| `builder` | sonnet | all but web (run it in a worktree; `isolation: worktree` when several run in parallel) | scoped implementation with the plan already decided; test-first for bugs; full `verify` before "done"; never touches a gate | ≤ 15 lines: status, files, tests (red → green), verify line, assumptions |
| `reviewer` | opus | Read, Grep, Glob, Bash | independent diff review after non-trivial changes; runs lint/types/tests; spec, invariants, test strength, docs | verdict, gate lines, High/Medium findings with confidence ≥ 80 and a trigger |
| `security-reviewer` | opus | Read, Grep, Glob, Bash | diffs touching auth, secrets, external input, personal data, external effects, LLM tools, CI or dependencies | exploitable findings (confidence ≥ 8/10) with exploit steps, impact and fix; hard exclusion list |
| `test-auditor` | sonnet | Read, Grep, Glob, Bash | tests written by the same agent as the code; money, data or deletion logic | surviving mutants and test smells, highest risk first |
| `debugger` | opus | all but web search; edits only the repro test | a failure whose cause is not obvious, before a second fix | root cause, causal chain, hypotheses tried, a red reproduction test |
| `docs-keeper` | sonnet | Read, Grep, Glob, Bash, Edit, Write (docs only) | docs test or link check failing; new or renamed structure | minimal edits, checks before → after |
| `architect` | opus | Read, Grep, Glob, Bash, Web | hard problems, debugging that failed twice, contract or invariant changes | options table, ONE recommendation, invariant check, plan in verifiable steps, ADR draft |
| `quality-auditor` | opus | Read, Grep, Glob, Bash, Write (report only; `maxTurns: 80`) | scheduled sweep of everything integrated in a period | report in `openspec/audits/` with stable `AUD-*` ids and deltas |

When each one acts: chapter 15.

Rules: keep the description short (it loads in every session; more than 15,000 tokens across all of them triggers a
warning); the body is the system prompt; repeat the critical rules in the delegation prompt (the subagent does not
see your conversation); `haiku` for simple work; ask for short summaries; check `/usage` to see which subagent earns
its cost.

## Context and sessions

- **One task, one session.** When the task changes, `/clear` (`/checkpoint` first if anything is unfinished).
- Threshold policy (read from the status line, not estimated): up to 50 %, normal; 50–70 %, avoid large outputs
  (symbols before whole files, `head` and filters, wide searches to an Explore subagent); 70–85 %, checkpoint and
  close subtasks; ≥ 85 %, checkpoint and `/compact <what to keep>` if the task continues, or `/clear` and reload the
  checkpoint if it changes.
- Compact manually, with instructions, at a natural breakpoint; in the reference project auto-compaction triggers at
  400k tokens.
- Two checkpoint layers: automatic on `PreCompact` (branch, commit, status, last 5 requests, no LLM) and semantic,
  on demand with a `/checkpoint` skill that saves and reloads (goal, status, decisions with reasons, files, verification, open items, next step). Persistent memory
  holds durable learnings; task state goes to the checkpoint.
- After two failed corrections, `/clear` and write a better prompt instead of trying a third time. Press `Esc` as
  soon as it drifts; `/rewind` lets you try the bold option first.
- Navigation: LSP for definitions and references before reading whole files; Grep for known identifiers; Read
  directly for config and short docs.

## Prompts and "done"

- Be specific: file, symptom, what "fixed" means. Hand over what you already have (`@file`, a screenshot,
  `cat error.log | claude -p`). If you want the complete version, say so ("be ambitious: empty and error states,
  save flow, keyboard").
- Before building, interview: "ask me questions until you can write the spec, then write it to SPEC.md"; start a
  new session to build from it.
- Give it something that returns pass/fail and ask for **evidence**: the command and its output. "All tests pass"
  without output means nothing. Put it in the prompt (`keep going until they pass`), as a goal (`/goal`), as a
  `Stop` hook, or with someone who did not write the code (`/code-review`, `reviewer`).
- `/verify` at the end so it starts the app and looks at it: it catches what tests and types miss.

## Unattended runs

Before leaving a run alone, answer five questions: does it know what "done" is? (goal, spec, a red test); can it
check its own work? (suite, `Stop` hook, review); what can it touch? (permissions, sandbox, worktree, one branch);
what stops it? (`--max-turns`, `--max-budget-usd`); where does it end and who signs off? (PR, summary, a human
approves anything irreversible). Scripted: `claude --bare -p … --allowedTools … --permission-mode dontAsk
--max-turns 20`; try three before launching a hundred. Protect the integration branch with a rule the run cannot
bypass.

## What is no longer needed

Aggressive context management (1M context and auto-compaction; `/clear` between tasks still applies), all caps and
IMPORTANT, subagents "to protect the context", delegating "for a better answer", `think hard` (the control is the
effort level; `ultrathink` for a single turn), "keep going, don't be lazy" (give it a check instead), describing
the architecture in `CLAUDE.md`.
