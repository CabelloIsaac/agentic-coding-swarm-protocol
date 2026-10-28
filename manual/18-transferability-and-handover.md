# 18 · Transferability and handover

**Rule:** a project is finished only when another team can absorb it. That is checked, not hoped for: a clean clone
reaches a green gate with one documented command, an agent with no prior context completes a reference task using
only the repository, ownership and operations are written down, no active knowledge lives outside the repo, and a
handover follows a checklist. Projects declare themselves "absorbable" only when checks X1–X5 pass
([INTEGRATION.md](../INTEGRATION.md) §6).

## Why

Every other chapter makes a project better for the team that builds it. None of that survives a reorganization on
its own. The usual failure is not bad code: it is the deploy step that only one person knows, the API key on a
laptop, the cron job set up by hand in a console, the decision taken in a call. The receiving team finds out one
incident at a time.

Transferability used to be a side effect of the protocol (ADRs, the docs test, a single gate). Side effects decay
without a check. The five pillars below turn it into a standard with a pass/fail answer, separate from levels 0–3:
a level-3 project can still be impossible to hand over, and a level-1 project can be perfectly absorbable.

## (a) Fresh-clone test

From a clean clone, **one documented command** (`commands.setup` in `swarm.json`) installs dependencies, creates
local configuration from `.env.example` with non-secret defaults, seeds local data, and leaves the repo in a state
where `verify` passes. The README lists the only prerequisites (runtime, package manager), and nothing else may be
needed.

CI proves it weekly on a clean runner with **no caches**: clone, setup, verify, and a check that neither step
modified tracked files. Template: [templates/github/workflows/fresh-clone.yml](../templates/github/workflows/fresh-clone.yml).
Caches are excluded on purpose: a cache is exactly where a missing step hides ("it works because the old
`node_modules` still had it").

Typical failures it catches: a postinstall step someone runs by hand, a seed script that assumes a database already
exists, a test that reads a file from a previous run, a dependency installed globally on every developer machine.

## (b) New-agent test

An agent with **no prior context and only the repository** completes a small reference task on a throwaway branch
and passes the gate. The task is described in `docs/handover/reference-task.md`
(template: [templates/handover/reference-task.md](../templates/handover/reference-task.md)): something a new team
member would do in their first week, such as adding a field end to end or a new instance of the most common
extension kind, with an acceptance command.

It runs on a schedule in CI with turn and budget caps
([templates/github/workflows/new-agent-test.yml](../templates/github/workflows/new-agent-test.yml)). The agent works
on a temporary branch inside the runner, with a read-only token and no persisted credentials; the workflow, not the
agent, then runs `verify` and the acceptance command. **The output is a report, never a merge**: the verdict, the
diff, and the agent's own list of what it could not find, what was ambiguous and what it would have asked a person.

The judge does not trust what the agent could edit: it reads the acceptance command and `commands.verify` from the
base commit, and the verdict fails if the agent's diff touches `swarm.json`, `docs/handover/`, `.github/` or
`quality-ratchets.json`. Otherwise an agent, or instructions injected through repo content, could set both commands to
`true` and obtain a pass.

**Residual risk.** The agent needs `verify` during its run, so it executes project commands with the API key in the
environment of that step; any project script can read it. The workflow keeps the key on the `claude` step only and
gives the judge none, but it cannot remove the exposure. Use a dedicated key with a spend cap set in the Anthropic
console and rotate it monthly. The same applies to the weekly review workflow (chapter 15).

If it fails, the project depends on knowledge that is in nobody's files.

### Why this is the most realistic absorption test

- **It is what will actually happen.** A team that absorbs a project today starts by pointing an agent at it. If
  that agent cannot find how to run, extend and verify the code, the people driving it will not either; they will
  just take longer to notice.
- **It has no tacit knowledge to lean on.** A human reviewer of a handover document fills gaps from experience and
  never notices them. The agent cannot, so every gap shows up as a failure or a question in the report.
- **It is repeatable and cheap.** A person can do a handover review once. The agent does it every week for a few
  dollars, so drift (a renamed command, a guide that stopped matching the code) is caught within days, not at the
  next reorganization.
- **It tests the docs the way they are used.** The docs test (chapter 05) proves that cited paths exist; this proves
  that the docs are sufficient to do real work.

Keep the task stable and small (under 30 agent turns). Change it only through a change, like any other test, and
keep its expected solution out of the repo so the agent cannot copy it.

## (c) Explicit ownership

Three files, all reviewed like code:

| File | Template | Answers |
| --- | --- | --- |
| `.github/CODEOWNERS` | [templates/CODEOWNERS](../templates/CODEOWNERS) | Who reviews each path. Teams, not individuals; no path without an owner. The gates (verify, CI, architecture and docs tests) owned by the playbook owner as well. |
| `docs/runbook.md` | [templates/docs/runbook.md](../templates/docs/runbook.md) | How to deploy, roll back, rotate each secret, read each alert, who is on call, the known failure modes and their fixes, and every scheduled job. |
| `docs/dependencies.md` | [templates/docs/dependencies.md](../templates/docs/dependencies.md) | Every external service: purpose, owner, who pays, which secrets, what happens when it fails, how to rotate its credentials. |

A runbook section that says "ask Ana" fails the check. A dependency without a payer is the one that gets switched
off when the card expires.

## (d) No hidden knowledge

Every piece of knowledge that changes how the project behaves has exactly one place in the repo:

| Knowledge | Its place | Checked by |
| --- | --- | --- |
| Active work | a change (chapter 06) | audit: branches with unintegrated work and no change |
| Decisions | an ADR (chapter 05) | review; audit: contracts changed without an ADR |
| Environment variables | `.env.example`, with a comment per variable | audit: variables read in code and missing from `.env.example` (chapter 09) |
| External services | `docs/dependencies.md` | audit: hosts and SDKs used in code and missing from the inventory |
| Scheduled jobs | `docs/runbook.md` § Scheduled jobs | audit: CI `schedule:` triggers, cron files and scheduled routines missing from the runbook |
| How to work here | `CLAUDE.md` / `AGENTS.md`, extension guides | the docs test (chapter 05) and the new-agent test |

The audit (chapter 09) reports these as a "hidden knowledge" count. X4 passes when the count is zero, or every item
has an owner and a date in the audit's proposed order. Chat threads, personal notes and session memory are not
places: a lesson that matters goes into the repo through the `learn` skill.

## (e) Handover checklist

When a project changes team, the outgoing team delivers and the receiving team verifies, item by item, with
[checklists/handover.md](../checklists/handover.md): access and secrets transferred and rotated, the X-checks green,
open work and known debt walked through, and **a joint session in which the receiving team's agent does the
reference task live**, with the outgoing team watching and answering only what the docs do not. Every question asked
in that session becomes a docs fix before the handover is signed off.

The handover ends with a date, both team names and the X-check output in an ADR, so the next team knows when and
how the project arrived.

## How it fits with the rest

| Pillar | Built on |
| --- | --- |
| Fresh clone | the single gate (chapter 02), CI ⊇ verify, no secrets in CI (chapter 10) |
| New-agent test | `AGENTS.md` (INTEGRATION.md §5), extension guides, scheduled reviews and their caps (chapters 15, 16 §8) |
| Ownership | the playbook owner ([MAINTAINING.md](../MAINTAINING.md)), spend and secrets (chapter 10) |
| No hidden knowledge | changes (06), ADRs and the docs test (05), the audit (09) |
| Handover | all of the above, plus the `learn` skill for what the session reveals |

## What to copy into your repo

- `commands.setup` in `swarm.json`, and `templates/github/workflows/fresh-clone.yml` as `.github/workflows/`.
- `docs/handover/reference-task.md` from `templates/handover/reference-task.md`, and
  `templates/github/workflows/new-agent-test.yml` once the company data policy allows sending code to a model.
- `templates/CODEOWNERS` as `.github/CODEOWNERS`; `templates/docs/runbook.md` and `templates/docs/dependencies.md`
  as `docs/runbook.md` and `docs/dependencies.md`.
- The hidden-knowledge counts in your audit metrics.
- `checklists/handover.md` as `docs/handover/checklist.md`.
- Then run `/swarm:adopt --check transfer`.
