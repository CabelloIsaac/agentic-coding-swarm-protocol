# Handover checklist

When a project changes team. Copy to `docs/handover/checklist.md` in the project and keep it there (conformance
check X5). The outgoing team delivers; the receiving team verifies each item itself and ticks it. Background: manual
[chapter 18](../manual/18-transferability-and-handover.md).

Project: `<name>` · From: `<team>` · To: `<team>` · Planned date: `<YYYY-MM-DD>`

## 1. Before the session (outgoing team)

- [ ] `/swarm:adopt --check transfer` green, output pasted below. Any red T-check is fixed first, not explained.
- [ ] Fresh-clone workflow green in the last 7 days (X1).
- [ ] New-agent test report under 30 days old with verdict `pass`, and every gap it listed fixed (X2).
- [ ] `.github/CODEOWNERS` lists the receiving team's handles (merged, not pending), and Code Owners review is
      required (X3).
- [ ] `docs/runbook.md` reviewed this month: deploy, rollback, every secret with rotation steps, alerts, on-call,
      scheduled jobs, known failure modes. No "ask <person>" left (X3).
- [ ] `docs/dependencies.md` complete: every external service with owner, payer, secrets, failure mode, rotation
      (X3).
- [ ] Latest audit under 14 days old with a hidden-knowledge count of zero, or each item with an owner and a date
      (X4).
- [ ] Every active piece of work is a change with its `tasks.md` current; abandoned ones archived or closed with a
      reason. No unintegrated branch older than a week without a change.
- [ ] Open debt listed: the audit's open `AUD-*` findings and the proposed order.

## 2. Access and money

- [ ] Repository admin, CI, cloud console, secret manager, monitoring, on-call tool, domain and DNS, every
      third-party console in `docs/dependencies.md`: granted to the receiving team, verified by them logging in.
- [ ] Billing for every paid service moved to the receiving team's cost center, or the owner of the bill named.
- [ ] Scheduled agents and routines (`/schedule`, CI review workflows) moved to the receiving team's accounts and
      budgets; their API keys reissued.
- [ ] Alerts and on-call rotation point at the receiving team from the handover date.

## 3. The joint session (both teams, one to two hours)

- [ ] The receiving team's agent, in a fresh session with no prior context, does the reference task
      (`docs/handover/reference-task.md`) live, on a throwaway branch, until the acceptance command and `verify` pass.
- [ ] The outgoing team watches and answers **only** what the docs cannot. Each answer is written down.
- [ ] A receiving-team engineer deploys to staging and rolls back, following only `docs/runbook.md`.
- [ ] Walk through the ADR index, the invariants table and the three riskiest areas named in the audit.

## 4. After the session (receiving team leads)

- [ ] Every question asked in the session is now answered in the repo (docs fix, runbook row, ADR, `learn` entry),
      in a change merged by the receiving team.
- [ ] Every secret rotated by the receiving team (runbook § Secrets and rotation); old credentials revoked.
- [ ] Outgoing team members removed from CODEOWNERS and from access they no longer need.
- [ ] A handover ADR: date, both teams, the T-check output, open debt accepted, and what was learned.
- [ ] Next new-agent test run green under the new owners.

## Sign-off

| Role | Team | Name | Date |
| --- | --- | --- | --- |
| Outgoing owner | | | |
| Receiving owner | | | |

T-check output:

```text
<paste /swarm:adopt --check transfer>
```
