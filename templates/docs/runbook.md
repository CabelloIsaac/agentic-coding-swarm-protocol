# Operations runbook · <project>

How to run this project in production without asking anyone. Owner: `<team handle>` (see `.github/CODEOWNERS`).
Last reviewed: `<YYYY-MM-DD>` by `<team>`. A section that says "ask <person>" is a bug: fix it here.

Every command below must work from a clean clone with the documented access. Secrets are named, never written.

## Environments

| Environment | URL | Deployed from | Who can deploy | Config source |
| --- | --- | --- | --- | --- |
| production | `<https://…>` | `<main, tag v*>` | `<team / CI only>` | `<secret manager path>` |
| staging | `<https://…>` | `<main>` | `<team>` | `<…>` |

## Deploy

1. Preconditions: `<integration branch green, migrations reviewed, change archived>`.
2. Command or pipeline: `<command | workflow name and how to trigger it>`.
3. How to confirm it worked: `<health URL, dashboard, smoke command>` and what "healthy" looks like.
4. Expected duration: `<minutes>`. If it takes longer than `<N>` minutes: `<what to check>`.

## Rollback

1. When: `<error rate above X, failed smoke test, data corruption suspicion>`.
2. Command: `<redeploy previous tag | revert + deploy | feature flag off>`.
3. Database migrations: `<are they backward compatible? how to roll back a migration, or why it is forward-only>`.
4. Confirm: `<same checks as deploy>`. Then open an incident note (see Known failure modes).

## Secrets and rotation

One row per secret. Values live in `<secret manager>`, never in the repo; names match `.env.example`.

| Secret (env var) | Used by | Stored in | Rotation steps | Rotate every | Last rotated |
| --- | --- | --- | --- | --- | --- |
| `<SERVICE_API_KEY>` | `<module>` | `<path>` | `<1. create new key in console 2. update store 3. redeploy 4. revoke old>` | `<90 days / on handover>` | `<date>` |

Rotate every secret on a team handover (checklists/handover.md in the protocol).

## Alerts

| Alert | Fires when | Meaning | First action | Escalate to |
| --- | --- | --- | --- | --- |
| `<name>` | `<condition and threshold>` | `<what is broken for users>` | `<command or dashboard>` | `<team, after N minutes>` |

## On-call

- Rotation: `<tool and schedule link>`; hours covered: `<…>`.
- Response targets: `<severity → response time>`.
- Where incidents are written down: `<path or tool>`. Each incident ends with the `learn` skill: a rule with a
  mechanism, or an explicit preference.

## Scheduled jobs

Every job that runs without a human: CI `schedule:` triggers, cron entries, cloud schedulers, `/schedule` routines,
queue workers with timers. The audit counts jobs missing from this table.

| Job | Where it is defined | Schedule | What it does | Spends money? | If it fails |
| --- | --- | --- | --- | --- | --- |
| `<fresh-clone>` | `.github/workflows/fresh-clone.yml` | `<Mon 05:00 UTC>` | clean clone, setup, verify | no | `<fix setup or docs>` |

## Known failure modes

| Symptom | Cause | Fix | Prevented by |
| --- | --- | --- | --- |
| `<what you see>` | `<root cause>` | `<steps>` | `<test, alert or check that catches it now; "nothing yet" is allowed but listed in the audit>` |

## Access

Who needs which access to operate the project, and how to request it: `<cloud console, secret manager, CI admin,
domain registrar, third-party dashboards>`.
