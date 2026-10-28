# External dependencies · <project>

Every external service the project calls, pays for or depends on at runtime, build time or in CI. Package
dependencies (npm, PyPI…) are not listed here; services are. Owner: `<team handle>`. Last reviewed: `<YYYY-MM-DD>`.

A service used in code and missing from this table is hidden knowledge: the audit counts it (manual chapter 18 §d).
Secrets are named by their environment variable (as in `.env.example`), never written.

| Service | Purpose | Used by | Owner (team) | Who pays (cost center, plan) | Secrets (env vars) | Mock / replay mode | Failure mode | How to rotate | Account / console |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<Payments API>` | `<charge cards>` | `<src/billing/>` | `<@org/payments>` | `<finance, plan X, ~€N/month>` | `<PAYMENTS_API_KEY>` | `<yes: --mode mock>` | `<checkout fails closed; orders queue for 24 h>` | `<runbook § Secrets>` | `<console URL, account id>` |

## Column guide

- **Purpose:** one line a new team understands without the vendor's marketing.
- **Owner:** the team that answers for the integration and for the vendor relationship. Teams, not people.
- **Who pays:** cost center and plan. A service nobody pays for gets switched off when a card expires.
- **Secrets:** env var names only; their rotation steps live in `docs/runbook.md` § Secrets and rotation.
- **Mock / replay mode:** how tests and CI run without it. "None" means CI needs the secret, which the protocol
  forbids in the quality job.
- **Failure mode:** what users see when it is down or slow, and whether the system fails open or closed.
- **How to rotate:** a link to the runbook row, or the steps.
- **Account / console:** where the account lives, so access can be transferred on a handover.

## Retired services

| Service | Retired on | Removed from code in | Account closed? |
| --- | --- | --- | --- |
