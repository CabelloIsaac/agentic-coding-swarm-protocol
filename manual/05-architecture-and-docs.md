# 05 · Architecture and documentation

**Rule:** code and tests are the source of truth; if docs and code disagree, fix the docs in the same change.
Structural rules are invariants with an ID, a why and a test. Decisions are immutable ADRs.

## Architecture principles that make the invariants possible

The reference project (PLINNG, a multi-tenant agent platform) states seven principles, each with the place that
enforces it. They transfer to any agent product:

| Principle | Meaning | Enforced by |
| --- | --- | --- |
| Architecture-real | prototype entities are the production entities, defined once as Zod schemas and exported as JSON Schema | `core/src/schemas/` |
| Filesystem-first, behind repositories | state starts as readable files (YAML, Markdown with frontmatter, JSONL); nobody outside the storage layer knows they are files | repository interfaces (INV-01) |
| The agent thinks; tools act | the LLM observes, decides and plans with typed tools; scoring, permitting, writing, evaluating, rolling back and measuring are deterministic code | the loop runs only read tools (INV-09) |
| Agent → tool → integration → external system | no tool calls an API directly; it goes through a gateway interface | INV-02, INV-03 |
| Everything leaves a trace | append-only event logs, referenceable evidence, run transcript, page versions | INV-06/07/08 |
| Memory ≠ state | state is event logs and published artifacts; memory is notes, written only with evidence | the memory writer |
| Safe by default | no write without policy, no publish without a human, no deletion of published content, all spend under budget | INV-10/11/15 |

**Dependency rule.** Dependencies only point down: interfaces (CLI, web apps) → runtime → tools → (gateway
interface) → integrations. The core package never depends on the integrations package: core defines the gateway
interface and the integrations package implements it structurally. Only the apps **compose** the runtime. The
catalog (tool registry, skills, playbooks) is data, not code.

## The invariants table

In `docs/architecture.md` §11 (in the reference project), a four-column table:

| ID | Rule | Why | Enforced by |
| --- | --- | --- | --- |
| INV-01 | Only `core/src/storage/` touches disk or database | swap backends without touching the domain; tests without IO | import test + allowlist with reasons |
| INV-06 | Event logs are append-only: a state change is a new event with the same `id` | auditability, reproducibility, rollback | the log interface exposes no update/delete; Postgres trigger |
| INV-16 | Done = verified: without its own evaluation an action ends `skipped`, never `pass` | "looks done" does not count | the default evaluator returns `skipped` |
| … | | | |

The ones any team can adopt as is: **append-only**, **`schema_version` on every record**, **every decision cites
evidence**, **the LLM plans and code executes**, **budget before spend**, **done = verified**, **idempotent
external effects**, **nothing destructive without a version**. The rest are domain-specific.

How to write a new invariant: one checkable sentence, the real failure it prevents (with a number or incident if
there is one), and the test in the same commit. Without a test it is not an invariant; it is an intention.

### The reference project's invariants, generalized

Each line is a rule plus the failure it prevents. Mechanisms are named as patterns; the steps are the real ones.

1. **Storage isolation.** Only the storage layer touches the filesystem, the database driver and object storage.
   Nobody else constructs a concrete event log, store or ID sequence: they ask the repository, which picks the
   backend from one environment variable. Clock, ID sequences, locks, job queue, rate limits and run artifacts
   also go through storage. Exceptions (a build script, a local preview server, the isolated simulator copy) are an
   explicit allowlist. *Swap disk for Postgres without touching the domain.*
2. **Core does not import integrations.** *Dependencies only point down; integrations are replaceable.*
3. **Tools leave only through the gateway** (`ctx.connectors`-style): no `fs`, no SDK, no `fetch`. *One exit
   point carrying modes, cost and budget.*
4. **Registry = code.** Every implemented tool is in the registry with the same domain and effect, and every entry
   marked implemented has an implementation; the registry constructor rejects mismatches. *The registry is the
   source of truth.*
5. **Single write pipeline.** Every web write (effects `write`/`write_draft`/`publish`) goes through
   `snapshot → write → evaluator → rollback`, with sibling pipelines for site config and translations. Nothing
   deletes published pages. *Uniform versioning, evaluation and rollback.*
6. **Append-only logs** (see above). *Full audit trail; a 1:1 migration to an event store.*
7. **`schema_version` on every persisted record.** *Future migrations.*
8. **Every decision cites existing evidence refs** (at least one, resolvable), checked when the decision is
   recorded and in the phase validator. *Explainability.*
9. **The LLM only runs read-only tools inside the loop**; everything else is planned and goes through
   policy/approvals. *Every write passes policy.*
10. **A tenant can tighten approval levels, never relax them**; per-channel autonomy does not relax them either:
    an auto-applied change still creates its approval, resolved by the owner or by a veto-window rule, with its
    actor and reason recorded. *Safe by default.*
11. **Publishing requires an approved approval.** *Publishing is always human.*
12. **The agent never sees the simulator model**: seeds, state and script of the simulated world live outside the
    tenant data and the context; only the simulator integration and its runner name them; the agent sees only
    rankings and metrics. *Otherwise the system grades its own homework.*
13. **UI reads through the core package**, never the filesystem. *Same source of truth as the runtime.*
14. **The catalog is valid**: skills, playbooks and activities reference only registered tools, with required
    sections and valid context entries. *Catalog and code stay coherent.*
15. **Every spend is checked against the budget first** (a per-run and per-month guard in the loop, the
    integrations and content generation). *Economic control.*
16. **Completed = verified** (see above): `pass` only with the action's own evaluation or all its declared
    acceptance criteria evaluated and passing.
17. **Idempotent external effects**: every publish, build, deploy or purchase tool declares `external_effect` in the
    registry and wraps the effect in an idempotency helper keyed by the action's idempotency key. *A retry or resume
    never publishes, deploys or buys twice.*
18. **Kernel boundary**: the harness kernel imports only kernel and shared schemas; every new file in the runtime
    or tool root is classified as kernel or domain. *The kernel can be extracted and reused for other verticals.*
19. **One LLM SDK, one place**: the vendor SDK is imported only in the LLM module; the canonical message format is
    the vendor's Messages format, aliased internally. *Changing provider or SDK version touches one folder.*
20. **Nothing destructive without a version**: only the tenant repository deletes tenant files; every change or
    delete keeps the previous version. Restoring is not an agent tool. *Every customer datum is reversible and
    explainable.*
21. **The log is immutable in the database too**: a trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` (even for the
    schema owner) and the app role lacks those grants; the "current state" view is derived and rebuildable.
    *An app bug cannot rewrite an event.*
22. **One outbound channel module per messaging channel**: it checks style and channel limits, then budget, then
    sends as an idempotent effect; no other file calls the provider. *One voice; a webhook retry does not repeat a
    message.*
23. **Nothing executes from a conversation**: the chat loop has only read tools; "propose change" and "register
    request" tools only take notes and, after a style check, become approvals (allowlisted, local and reversible
    changes; level never `auto`) or team requests.
24. **Every conversational turn checks a monthly per-tenant cap before calling the LLM** and records a turn event
    without the conversation text. *Unbounded spend, or user text stored beyond need.*
25. **Team feedback about the system is team memory, not agent input**: append-only, with `schema_version` and a
    human actor, in a module the runtime may not import. *An unreviewed report would otherwise steer the agent.*
26. **Every new event carries an `actor`** (`agent | user | system`, an ID and the surface: CLI, dashboard, chat,
    scheduler, API) and a `run_id` if it originates in a run; changes to the tenant's core knowledge are written
    through the repository so each one leaves a history event (content-addressed, immutable previous version).
    *Any record can answer who, when, from where and why.*

## Kernel and domain: a boundary with a list that only shrinks

`core/src` is split into a generic harness and the domain. Kernel: storage, LLM, clock, evidence, the findings
engine (per-asset detectors are domain), IDs, ordered async helpers, version, a JSON-lines logger that never logs
emails or prompts, an opt-in error reporter that scrubs emails, bodies and cookies, the tool registry and types,
the agent loop, policy, approvals and executor. Domain: everything else, including the vertical workflow (run
orchestration, context builder, prompts, plan writer, report, rollback). Shared schemas are a contract both may
import. The kernel imports only kernel and schemas. Current exceptions are a **file / imports / reason** table (in
the reference project, six entries such as "executor imports the page module to detect stale actions") and a test
checks there are no stale entries. It is a **ratchet**: the debt is visible, measured, and can only go down.

## Execution-safety patterns for agent products

These are the mechanisms behind the invariants above, as the reference project implements them.

- **Policy = most restrictive wins.** Effective level = max(registry level, tenant setting) over
  `auto < propose < require_approval`, with the tenant setting chosen by an autonomy key derived from the tool's
  domain and effect (publishing, site changes, content, social, local presence, research).
- **Approvals.** `pending → approved | rejected | expired`. A demo auto-approve converts only `propose`;
  `require_approval` is never auto-approved. Pending for more than 14 days → `expired`, and its action → `rejected`.
  Every approval records who approved and through which surface (CLI, dashboard, chat).
- **Executor.** Each planned action records the target's `before_version`; at execution, if the version no longer
  matches, the action fails as `stale`. A tool that needs a customer connection the tenant lacks is not invoked:
  the action stays approved with `blocked_reason: needs_connection` and runs once the connection exists.
- **Acceptance criteria.** The agent declares, per action, check IDs from a fixed catalog that is shown to it and
  validated in the plan (unknown or inapplicable → error with one retry). After execution, a failing check marks
  the action `failed` and restores `before_version`.
- **Idempotency wrapper.** The executor passes the action ID as idempotency key; the wrapper records `started` and
  `done` with the result. `done` → return the stored result; `started` (the process died mid-effect) → reconcile
  with the real state if the tool can, otherwise fail as `needs_review`. A user-triggered retry that creates a new
  action uses a natural key (for example piece + time slot) and checkpoints what already exists outside.
- **Write pipeline.** Read the page → snapshot the previous version → produce → validate frontmatter → reject a
  no-op → write → diff → evaluate → on `fail`, restore (or delete if the page was new) and mark `rolled_back`
  → record evidence. The evaluator checks only the **added text**. Always blocking: factuality (prices, numbers,
  phones, years, certifications or testimonials not present in the tenant's fact sources), brand compliance,
  rendering, valid HTML. Also blocking: any check that **passed before and fails now**, and on new pages any
  failure except SEO hints. Pre-existing defects do not block an improvement. Translations are compared with
  their original (same multiset of numbers, emails and URLs; same headings and link targets).
- **State machines.** Every transition is a new event with the same `id`; an unlisted transition throws. Example:
  action `planned → executing | awaiting_approval | rejected | failed`, `executing → completed | failed |
  rolled_back`. A failed run reopens only through an explicit resume.
- **Agent loop.** Tools = the activity's available read tools plus three phase tools
  (`submit_observations → submit_decisions → submit_plan`); append-only history; budget estimated before every
  turn; one retry per phase on a validation error, then `failed`; out-of-order phase → error; tool results
  truncated (20,000 characters); 20 iterations max; `refusal` or `max_tokens` → `failed`. Phase validators check
  that evidence refs exist, decisions stay within `max_actions` and the shown backlog, and every planned input
  matches the tool's schema. **If nothing is actionable, the LLM is not called.**
- **Checkpoints and resume.** After each completed step and each action, a checkpoint records the last step,
  attempt and created IDs. Resume reopens the same run (`attempt + 1`) and continues from the first unfinished step
  **without calling the agent again**; finished actions are not repeated; executing ones rely on idempotency.
- **Run artifacts.** Each run stores context manifest (what was included or trimmed), full transcript, validated
  plan, per-turn provider/model/tokens/cost, a step timeline and costs, plus `catalog_version`, `harness_version`
  (package version + commit) and model, so any difference between two runs can be attributed.
- **Resource locks and job queue.** Locks per resource (exclusive create, renewable lease, dead-pid takeover); the
  queue deduplicates live jobs per `(tenant, kind, resource)`, caps global concurrency (3) and one job per resource,
  runs each job in a child process with a heartbeat, and a reaper fails `running` jobs whose pid is gone. A
  scheduler only enqueues due occurrences with an `occurrence_key`, so enqueuing twice returns the existing job.
- **Security controls as code.** Path confinement on every repo path; no delete tool for published pages and the
  registry schema forbids production deletes; webhooks verify the provider HMAC in constant time, deduplicate by
  event ID and only store (no processing in the request); memory writes go through a sanitizing writer and a
  strict parser; generated HTML uses safe Markdown, an `href` allowlist and escaped JSON-LD; secrets only in
  `.env`, injected into integrations; backups restore into an empty root and verify hashes and every log.

## How documentation is organized

- `docs/README.md`: the index, with two intent tables: "I need… → document" and "I want to add… → guide". Plus the
  OpenSpec cheat sheet, the six-step flow for any change and the list of verification commands.
- `docs/architecture.md`: cross-cutting concerns (principles, packages, invariants, kernel, flow of a run, safe
  execution, data, security). **Split by area** into `docs/architecture/<area>.md` (modules and event logs of each
  product area) because it was the most conflict-prone file in the repo (74 of 143 commits).
- One architecture page for all external integrations.
- `docs/quality.md`: gates, type rules, lint, tests, size, audit, a dated table of known debt.
- `docs/scaling.md`: which contracts do not change when scaling; "if an infrastructure change forces you to touch
  a tool, the agent or a schema, you are breaking a boundary."
- `docs/extending/<thing>.md`: one guide per extension type (see below).
- `docs/adr/`: decisions (see below).
- `README.md`: commands. The docs test requires **every CLI command** to appear there.

## The six-step flow for any change

1. Write the OpenSpec change (and an ADR if the decision is structural).
2. Implement following the matching extension guide, respecting the invariants.
3. Add tests for the behavior and, if structure changes, architecture tests.
4. Verify locally (`verify --quick` while iterating, `verify` to close).
5. Update the documentation (area architecture, README, index, ADR).
6. Archive the change and integrate.

## Extension guides (`docs/extending/`)

One for each kind of thing that can be added. The reference project has twelve:

| Guide | Covers |
| --- | --- |
| External integration | the only piece that talks to an external system; modes (mock/replay/live), cache, cost, retries |
| Tool (capability) | a named operation with input/output schemas, effect and the evidence it leaves; registry entry |
| Activity, skill, playbook | the global catalog (data, never copied into a tenant): units of work, procedures, playbooks |
| Tenant | adding a customer needs **no code**; if it does, a generic capability is missing |
| Evaluator or audit check | pure check logic shared by the audit and the write-pipeline evaluator |
| Findings detector | audits one asset and returns candidate findings; the engine reconciles new, verified, regressed, resolved |
| Entity, schema or event log | the most stable contract; always with a change, `schema_version` and migration |
| LLM provider or model | implementations of one provider interface (real, mock, replay) with the same protocol |
| UI section | reads through the core package, looks like the product, not an internal tool |
| Content format | new formats, layouts and quality rules, through the same pipeline with evaluation |
| Pilot scenario | a guided real-customer test that closes a change's "test with a pilot customer" task |
| Simulator event or judge | events that happen to the simulated business, and judges that check the event logs |

All follow the same structure, which is the template in `templates/docs/extending/guide-template.md`:

1. Title and a one-paragraph definition of the thing (optionally a flow diagram).
2. **When to use this guide** (and when to use another).
3. **Files**: table Action (Create/Touch/Tests) → Path.
4. **Contract / minimal template**: real code from the repo and implementation rules.
5. **Automated checks that guard it**: which builder, validator or test catches mistakes.
6. **Required tests**: numbered list (happy path, invalid input, contract violation, PASS and FAIL with rollback,
   rejections, mock execution).
7. **Verification**: exact commands.
8. **Definition of done**: a `- [ ]` checklist.
9. **Common mistakes**: each in bold with its consequence.

The docs index links every guide; the test checks it.

## ADRs: short, immutable decisions

- An ADR is **short** (1–2 pages), **one per decision**, in Markdown, **immutable once accepted**: it is superseded
  by another (`Superseded by ADR-XXXX`), never edited.
- **When you need one:** when a decision changes a contract (domain schemas, tool interfaces, external
  integrations, LLM provider, repositories), an invariant, the shape of a run or a formula. "If a change needs an
  ADR and does not have one, it is not ready." Examples from the reference project: a canonical LLM message format
  so the SDK lives in one folder; resumable execution with checkpoints and idempotent effects; asynchronous storage
  ports so files and Postgres share one interface (which is why floating promises are a lint error, chapter 07).
- **Template** (`templates/adr/0000-template.md`): one-line title; Status; Date; References (PRD, specs, code,
  archived change with its decisions D1…Dn); Context (the problem, with numbers or incidents); Decision (concrete,
  checkable sentences); Consequences (the good **and the bad**; which invariants or tests protect it); Alternatives
  considered. MADR adds a useful field: **Confirmation**, how you check the decision is being honored (an
  architecture test, a validator).
- **Number at integration, not at creation.** An ADR starts as `docs/adr/draft-<slug>.md` and is cited as
  `ADR-draft-<slug>`. `land` assigns the next number and rewrites references across the repo (`.md`, `.ts`,
  `.yaml`, `.json`). Reason: two branches creating "ADR-0042" at the same time (one collision forced renaming 10
  files).
- **The index is generated** between `<!-- generated:adr-index -->` and `<!-- /generated:adr-index -->`; never
  edit it by hand. Status is read from the `- Status:` line.
- Known debt in the reference project: several numbered ADRs still carry `# ADR-draft —` in the title; the audit
  counts them.

## Comments and naming

- Comments explain the **why**, not the what. No commented-out code and no debug `console.log` (product logs go to
  the event logs or the CLI output).
- A TODO carries enough context for someone else to pick it up; if it is real work, open a change.
- Pick one language policy and write it down. The reference project keeps code, IDs and tool names in English, and
  documentation, product copy and UI in the team's language. What matters is that the policy is written and there
  is only one.

## What to copy into your repo

The invariants table with its four columns (start with 5), the architecture test
(`templates/tests/architecture.test.ts`), the documentation test (`templates/tests/docs.test.ts`; adapt the folder
lists), the ADR template with draft-based numbering (`templates/adr/0000-template.md`; numbering is specified in
`reference/README.md`), and the extension guide template (`templates/docs/extending/guide-template.md`).
