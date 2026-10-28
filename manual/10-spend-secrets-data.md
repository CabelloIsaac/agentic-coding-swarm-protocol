# 10 · Spend, secrets and data

**Rule:** real spend happens only from the main checkout, with credentials that worktrees do not have; tests and CI
run without secrets; nothing is printed or committed; seed data is read-only, and every destructive operation on
customer data is reversible and traceable.

## Spend

- With credentials in `.env`, some commands spend real money (data APIs, LLMs, publishing). For development, use
  `--mode mock` and `--llm mock`; to reproduce, `--llm replay` (recorded with `--record`).
- **Worktrees carry no `.env`**, and `land` refuses to run if it finds one: two worktrees with credentials could
  publish or buy twice. Real spend happens only from the main checkout, in its own terminal session.
- In an agent product: every paid call (LLM, third-party APIs) is checked against the budget **before** it
  happens; external effects are idempotent by action id; inside the loop the agent runs only read-only tools, and
  everything else goes through policy and approvals; a tenant can tighten approval levels, never relax them.
  Background jobs that spend outside an agent run are wrapped in a run of their own, with a per-job and a monthly
  cap: an audit of the reference project found detached jobs that spent with no run and no budget. Mechanisms and
  enforcement: chapter 17.
- **A rehearsal copy cannot spend by construction**, not by a UI flag: the job queue rewrites every job of a
  rehearsal tenant to mock mode, the worker starts that process with a rehearsal variable that makes the integration
  runtime resolve to mock and the real LLM provider throw, and the tenant listing hides rehearsal copies from
  schedulers and alerts. Checking "is this a rehearsal?" screen by screen was rejected: one forgotten screen would
  spend. Its test runs a job with a fake LLM key and `--mode live` and asserts zero cost and zero bytes changed in
  the real tenant.
- In an unattended run: `--max-turns`, `--max-budget-usd` and a spend limit on the account.
- Measure **output per token**, not tokens: cost per integrated PR or per closed task, and churn (code reverted
  within days is cost, not output).

## Secrets

- `.env` is not versioned; `.env.example` lists names, never values. The audit flags every `process.env.X` missing
  from the example.
- `deny` for `Read(./.env)` and similar in the repo settings (applies in every mode). Use the sandbox for what
  permissions do not cover (a script that opens the file, `curl` to a domain).
- The audit scans tracked files for key patterns (`sk-ant-`, `AKIA`, `xox*`, `gh*_`, private keys) and reports
  paths only.
- CI builds the image and **checks that it contains no `.env`**.
- Messaging tests always go to a test number or test account, never to customers; production and development
  profiles are separate and documented.
- Never print secrets in chat, memory or docs; a secret that shows up in a log is a secret to rotate.

## Data

- Versioned seed data is read-only; tests run on copies (`PROJECT_ROOT=<copy>` pointing at a scratch directory).
  The apps start on a seeded data copy (created on first start) and **refuse to use the repo's seed** unless an
  explicit override variable is set: before that rule, the dashboard wrote into the seed by default. Global
  knowledge (catalog, templates) is always read from the code, never from the data copy, so an old copy works with
  current code without a sync step (chapter 17).
- **Every destructive operation on customer data is reversible** (a saved version with who, when and why),
  implemented in the storage layer and invisible to the agent runtime. Nothing deletes published content.
- Append-only event logs: a state change is a new event with the same `id`; every record carries
  `schema_version`, `actor`, and `run_id` if it originates in a run.
- Real business data lives only inside the work item that uses it (`playground/<engagement>/<topic>/`), with heavy
  files kept out of git by its `.gitignore`. No real data loose in `playground/`.
- The agent never sees the internals of whatever evaluates it, only its outputs: what must not be learned is not
  exposed.

## Data policy for third parties

Before sending code or data to an external service (a second-model review, a new MCP server), you need a written
data policy: what is sent, to whom, with what retention. In the reference project, the second-model review gate
stays blocked until that policy exists. A connected MCP server adds its tools to the context even when unused:
disable the ones you do not need.

## What to copy into your repo

The `.env` rejection in `land`, the `deny` rules in `settings.json` (`templates/claude/settings.json`), the image
check in CI (`templates/github/workflows/ci.yml`), the mock/replay pattern with recording, and the rule
"destructive = versioned and traceable" in the storage layer.
