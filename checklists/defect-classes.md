# Defect classes

A catalog of defect classes distilled from about 60 findings of two whole-repo audits of the reference project (ten
days apart). Many of those findings were **visible in a single diff** and could have been stopped by the review of
the change that introduced them. They were found up to ten days later instead. This catalog turns each recurring
finding into a class: a name, its shape in a diff, how to detect it, and the fix.

**How to use it:**
- **Per-change review** (`reviewer`, `security-reviewer`, `test-auditor`, the `review` skill): check the diff
  against every class whose *Catch* is **diff**. Cite the id in each finding (`DC-RUN-01 · path:line · …`).
- **Builder self-check:** before claiming done, walk the diff-catchable classes for the areas you touched.
- **Periodic audit** (`quality-auditor`, the `audit-repo` skill): use the whole catalog, including the classes
  marked **repo**, which need the whole tree, history or metrics to see.
- **Growing it:** when an audit finds something a diff review should have caught, add a class here (or raise the
  *Seen* count of an existing one) in the same change that fixes the finding.

Columns: **Dimension** is one of the five audit dimensions (structure, harness, process, scalability, security).
**Catch** is `diff` (visible in the change itself, plus its direct callers) or `repo` (needs a whole-repo audit).
**Seen** is how many findings of the source audits fall in the class. Grep patterns are TypeScript-flavored; translate
the names to your stack.

## Contents

| Id | Class | Dimension | Catch |
|---|---|---|---|
| [DC-RUN-01](#dc-run-01) | Run or lock opened outside its try/finally | harness | diff |
| [DC-RUN-02](#dc-run-02) | Two-step completion with a crash window | harness | diff |
| [DC-RUN-03](#dc-run-03) | Long job whose intermediate state nothing recovers | harness | diff |
| [DC-RUN-04](#dc-run-04) | Reaper that fails work instead of retrying or reconciling | harness | repo |
| [DC-RUN-05](#dc-run-05) | Child process or job without a timeout | harness | diff |
| [DC-VER-01](#dc-ver-01) | "Pass" without an evaluation | harness | diff |
| [DC-VER-02](#dc-ver-02) | Error swallowed into a canned success | harness | diff |
| [DC-SPEND-01](#dc-spend-01) | Spend outside a run or without a budget check | harness | diff |
| [DC-SPEND-02](#dc-spend-02) | Budget check fed a constant | harness | diff |
| [DC-SPEND-03](#dc-spend-03) | Retry that pays again | harness | diff |
| [DC-IDEM-01](#dc-idem-01) | Idempotency key that changes on retry | harness | diff |
| [DC-IDEM-02](#dc-idem-02) | Dedupe record written after the work | harness | diff |
| [DC-IDEM-03](#dc-idem-03) | Read-modify-write without a cross-process lock | harness | diff |
| [DC-SCALE-01](#dc-scale-01) | Binaries stored in a JSON or key-value store | scalability | diff |
| [DC-SCALE-02](#dc-scale-02) | O(n) history read on a hot path | scalability | diff |
| [DC-SCALE-03](#dc-scale-03) | In-process state that breaks with two instances | scalability | diff |
| [DC-SCALE-04](#dc-scale-04) | One queue lane shared by external customers and internal work | scalability | diff |
| [DC-SCALE-05](#dc-scale-05) | Whole file or payload buffered in memory | scalability | diff |
| [DC-SCALE-06](#dc-scale-06) | Unbounded growth: no retention, no LIMIT | scalability | repo |
| [DC-SEC-01](#dc-sec-01) | Replayable signed message: id outside the signature, no expiry | security | diff |
| [DC-SEC-02](#dc-sec-02) | Whole request body read before the size check | security | diff |
| [DC-SEC-03](#dc-sec-03) | Privilege granted on an unproven claim | security | diff |
| [DC-SEC-04](#dc-sec-04) | Untrusted text reaching an LLM with tools, without a data delimiter | security | diff |
| [DC-SEC-05](#dc-sec-05) | LLM-chosen tool with an external effect outside policy | security | diff |
| [DC-SEC-06](#dc-sec-06) | Outbound fetch to a host the input controls | security | diff |
| [DC-SEC-07](#dc-sec-07) | Secrets or personal data in argv, inherited env or fixtures | security | diff |
| [DC-SEC-08](#dc-sec-08) | Credential scope that leaks across environments or tenants | security | diff |
| [DC-SEC-09](#dc-sec-09) | Least-privilege role that drifts behind the schema | security | diff |
| [DC-SEC-10](#dc-sec-10) | Anonymous endpoint that leaks or does expensive work | security | diff |
| [DC-SEC-11](#dc-sec-11) | Vulnerable dependency on a reachable path | security | repo |
| [DC-DATA-01](#dc-data-01) | Optional `actor` or audit fields on a new schema | structure | diff |
| [DC-DATA-02](#dc-data-02) | Identity dropped on the way to the write | structure | diff |
| [DC-DATA-03](#dc-data-03) | Wall clock in domain code | structure | diff |
| [DC-DATA-04](#dc-data-04) | Tool that writes to seed data or commits runtime state | structure | diff |
| [DC-ARCH-01](#dc-arch-01) | `npx` or a network download at runtime | structure | diff |
| [DC-ARCH-02](#dc-arch-02) | Lower layer that spawns or imports an upper one; a process per request | structure | diff |
| [DC-ARCH-03](#dc-arch-03) | A second implementation of a guarded path | structure | diff |
| [DC-ARCH-04](#dc-arch-04) | Code the architecture test does not see | structure | repo |
| [DC-TEST-01](#dc-test-01) | Test that does not fail when the change is reverted | process | diff |
| [DC-TEST-02](#dc-test-02) | New module or write path without a direct test | process | diff |
| [DC-TEST-03](#dc-test-03) | Gate step that can be skipped silently | process | diff |
| [DC-GATE-01](#dc-gate-01) | Action licensed by a name instead of the checked identity | process | diff |
| [DC-GATE-02](#dc-gate-02) | Validator or check that no gate runs | process | repo |
| [DC-GATE-03](#dc-gate-03) | Generator that rewrites only part of what it owns | process | diff |
| [DC-GATE-04](#dc-gate-04) | Spec delta that drops existing scenarios | process | diff |
| [DC-GATE-05](#dc-gate-05) | Docs, ids or ratchets drifting from the code | process | repo |

---

## Run lifecycle

### DC-RUN-01
**Run or lock opened outside its try/finally** · harness · diff · Seen 5
- **Symptom:** `acquireLock(…)` or `runs.start(…)` followed by context building, artifact loading or other calls,
  with the `try {` opening several lines later; or a `catch` that calls `finish(…)` without its own protection.
- **Hurts:** any throw in the gap leaves a run `running` forever and a lock held until it expires (minutes to an
  hour). Nothing closes a run that has no job or lock attached.
- **Detect:** `grep -nE "acquireLock|runs\.start|startRun|\.lock\(" <diff files>` and read the next statement. Ask:
  if any line between the open and the `try` throws, who closes it?
- **Fix:** open the `try` on the line after the acquire; release and finish in `finally`; make `finish` defensive
  (its own try, never masking the original error).

### DC-RUN-02
**Two-step completion with a crash window** · harness · diff · Seen 2
- **Symptom:** a job marked `done` before its run or effects are closed; a status written before the event that
  justifies it; a run opened before the job is recorded.
- **Hurts:** a crash between the two steps leaves a `done` job with a `running` run, and nothing revisits it.
- **Detect:** look for consecutive state writes to two stores (`store.finish` then `closeEffects`, `jobs.done` then
  `runs.finish`). Ask: if the process dies between them, which sweep repairs it?
- **Fix:** order the writes so the outer state is written last, or make a sweep reconcile the pair.

### DC-RUN-03
**Long job whose intermediate state nothing recovers** · harness · diff · Seen 3
- **Symptom:** a new multi-stage job (`scripting → voicing → rendering`, `queued → uploading`) whose stages are
  persisted, with no reaper or sweep that knows the new states.
- **Hurts:** when the job times out or the host dies, the entity stays in a middle state forever, holds quota or a
  slot, and the party waiting for it (often a paying customer) is never told.
- **Detect:** every new status enum value that is not terminal. Ask: who moves it to a terminal state if the
  process dies right now? Grep the reaper and the cleanup hooks for the new entity type.
- **Fix:** register the entity with the job reaper's cleanup; add a sweep for entries older than the job timeout;
  send the outcome to the waiting party through an outbox written with the state change, never as a best-effort
  call at the end whose `catch` only logs.

### DC-RUN-04
**Reaper that fails work instead of retrying or reconciling** · harness · repo · Seen 2
- **Symptom:** an abandoned-work sweep that moves `running → failed` without re-enqueueing idempotent kinds, without
  releasing unique occurrence keys, or without checking whether the external effect already happened.
- **Hurts:** every deploy or out-of-memory kill loses work until a person clicks retry; an effect that was published
  is marked failed, and the retry collides with it.
- **Detect:** read the reaper end to end. Ask: for each job kind, what happens to an in-flight one at a restart?
- **Fix:** retry with backoff for idempotent kinds; consult the effect store first (`done` → completed); release
  occurrence keys.

### DC-RUN-05
**Child process or job without a timeout** · harness · diff · Seen 2
- **Symptom:** `spawn`/`execFile`/a job runner without `timeout`; a heartbeat that beats while the child lives,
  whatever it does.
- **Hurts:** one hung child (a slow external API, a synchronous media tool) blocks its lane for every tenant until
  someone restarts the worker.
- **Detect:** `grep -nE "spawn\(|execFile(Sync)?\(|exec\(" <diff files>`; check for a timeout and a kill. Check the
  heartbeat is tied to progress.
- **Fix:** a timeout per job kind, kill the process group, finish as failed; heartbeat on progress, not on liveness.

## Verification honesty

### DC-VER-01
**"Pass" without an evaluation** · harness · diff · Seen 2
- **Symptom:** a capability or check that returns `pass` (or `completed`, `ok: true`) as a literal, with no
  comparison against observed state; or returns `pass` while the external system says `pending_review`.
- **Hurts:** the action is recorded as done and verified while nothing was checked. Downstream metrics, autonomy
  decisions and reports trust a lie.
- **Detect:** `grep -nE "status: ['\"]pass['\"]|return ['\"]pass['\"]|verdict: ['\"]pass" <diff files>` and read
  what precedes it. Ask: what observed value would make this return `fail`?
- **Fix:** `skipped` (or `unverified`) when there is no evaluation; `pass` only from a comparison with acceptance
  criteria.

### DC-VER-02
**Error swallowed into a canned success** · harness · diff · Seen 2
- **Symptom:** `catch { return fallbackReply }`, `catch { log(e) }` then continue, a fallback that hides that side
  effects already happened (approvals created, messages queued).
- **Hurts:** the user sees a normal answer, the system has half-applied state, and no alert fires.
- **Detect:** every new `catch`. Ask: what has already been written when this throws, and who learns about it?
- **Fix:** fail the run with the error; if a user-facing fallback is needed, record the failure first and make the
  fallback honest.

## Spend

### DC-SPEND-01
**Spend outside a run or without a budget check** · harness · diff · Seen 3
- **Symptom:** a CLI command, webhook handler or background path that calls a paid API (LLM, data provider,
  generation) with a context that has no run id and no budget guard; a guard that only checks it exists.
- **Hurts:** the spend is invisible to the monthly total, so the cap never limits it; a loop or a burst drains the
  account.
- **Detect:** for each new caller of a paid connector or model, find the run and the `budget.check` before the call.
  `grep -nE "new BudgetGuard|reserveSpend|budget\.check" <diff files>`.
- **Fix:** wrap the path in the standard run helper (`withJobRun` or equivalent), which opens a run and a budget
  guard fed from the real monthly spend.

### DC-SPEND-02
**Budget check fed a constant** · harness · diff · Seen 4
- **Symptom:** `new BudgetGuard(cap, monthly, 0)`, `check(0)`, a spent-this-month argument that is a literal.
- **Hurts:** the invariant holds in name only: every call passes the check.
- **Detect:** `grep -nE "BudgetGuard\([^)]*,\s*0\)|check\(0\)" <diff files>`.
- **Fix:** read the real spend (a ledger sum, or a running total kept in a key-value store); add an architecture rule
  that forbids a literal `0` outside tests.

### DC-SPEND-03
**Retry that pays again** · harness · diff · Seen 1
- **Symptom:** a retried job regenerates every paid artifact (script, voice, image) instead of resuming from the
  stored ones.
- **Hurts:** each retry multiplies the unit cost; with automatic retries, up to N × the price.
- **Detect:** for each paid step in a retryable job, ask: on attempt two, is the stored result reused?
- **Fix:** persist each paid output with a stable key and check it before paying; count attempts against a budget.

## Idempotency and concurrency

### DC-IDEM-01
**Idempotency key that changes on retry** · harness · diff · Seen 1
- **Symptom:** a key built from a timestamp, a random id, an attempt counter or a run id that is new per attempt.
- **Hurts:** the retry is a new effect: a message sent twice, a charge doubled, a post published twice.
- **Detect:** read every key passed to the idempotency wrapper. `grep -nE "Date\.now|randomUUID|attempt" ` near it.
  Ask: does attempt two compute the same key as attempt one?
- **Fix:** derive the key from the business identity (event id, action id, `event_id:n`).

### DC-IDEM-02
**Dedupe record written after the work** · harness · diff · Seen 3
- **Symptom:** "already processed?" is checked at the start, but the processed marker is written at the end, after
  the expensive or external work.
- **Hurts:** any throw in between makes the retry redo the work (another model turn, another charge); two workers
  can both pass the check.
- **Detect:** find the dedupe read and the dedupe write; if work sits between them, flag it.
- **Fix:** reserve the id first with an atomic `putIfAbsent` (or an insert with a unique index), then work, then
  mark done.

### DC-IDEM-03
**Read-modify-write without a cross-process lock** · harness · diff · Seen 5
- **Symptom:** `const x = await get(k); …; await put(k, f(x))`, or a state transition that reads the last event and
  appends the next one, with no lock, no compare-and-swap and no unique constraint.
- **Hurts:** two processes interleave; one update is lost, or an action reaches an impossible state after its
  external effect already happened.
- **Detect:** every `get` followed by `put`/`append` on the same key. Ask: what if another process does the same
  between the two lines? An in-memory mutex does not count.
- **Variant:** a new CLI command, route or job applies the same mutation as existing paths but skips the resource
  lock they take; the race lives exactly where nobody looks.
- **Fix:** the store's atomic update (advisory lock, `UPDATE … WHERE version = $n`, unique index), or the resource
  lock the rest of the code uses, taken **inside** the mutating function so no caller can forget it.

## Scalability

### DC-SCALE-01
**Binaries stored in a JSON or key-value store** · scalability · diff · Seen 3
- **Symptom:** base64 fields (`data_b64`, `audio_b64`) persisted in a JSON column, a cache entry or a key-value
  value; a call cache that stores raw inputs including uploads.
- **Hurts:** rows of tens or hundreds of MB, a hard size limit that fails the publish, a database that only grows.
- **Detect:** `grep -nE "b64|base64|Buffer\.from\(.*base64" <diff files>`; then follow where that value is stored or
  cached.
- **Fix:** a blob store (object storage) with the key in the record; mark binary inputs as sensitive so caches
  redact them; no cache for effect calls.

### DC-SCALE-02
**O(n) history read on a hot path** · scalability · diff · Seen 5
- **Symptom:** `.all()`, `query()` with a JavaScript filter, or `keys()` plus one `get` per key, on a path that runs
  per message, per page load or per request.
- **Hurts:** latency and cost grow with history; a page that loads N such reads per visit degrades for the oldest,
  best customers first.
- **Detect:** `grep -nE "\.all\(\)|\.keys\(\)|query\(\)" <diff files>` and identify the caller's frequency.
- **Fix:** an index or a query by key and time window; a running aggregate (monthly spend, counters) maintained on
  write.

### DC-SCALE-03
**In-process state that breaks with two instances** · scalability · diff · Seen 5
- **Symptom:** a module-level `Map`, `Set`, counter, semaphore or "in flight" flag used for limits, dedupe or slot
  reservation; a file-based limiter when the configured backend is a database.
- **Hurts:** with two replicas each instance has its own view: limits double, slots are never released, paid work
  runs twice.
- **Detect:** `grep -nE "^(const|let) \w+ = new (Map|Set)|^let \w+ = 0" <diff files>` at module scope. Ask: what if
  a second instance runs?
- **Fix:** the shared store's atomic primitives (rate limiter, lease, `putIfAbsent` with a holder id and expiry).

### DC-SCALE-04
**One queue lane shared by external customers and internal work** · scalability · diff · Seen 3
- **Symptom:** a new job kind enqueued on an existing lane (`reports`, `maintenance`) with concurrency 1; a claim
  ordered by global sequence; a burst enqueue of one job per tenant.
- **Hurts:** one partner's twenty jobs, or one slow tenant, delay everyone else's routine work.
- **Detect:** every new `enqueue(` call: which lane, what concurrency, who else uses it, how fairness is decided.
- **Fix:** a dedicated lane for externally triggered work, a per-tenant or per-partner cap, round-robin claim.

### DC-SCALE-05
**Whole file or payload buffered in memory** · scalability · diff · Seen 3
- **Symptom:** `readFileSync(archive)`, `await res.arrayBuffer()` of a download, hashing a whole file in one call,
  an object-store get that returns a `Buffer`.
- **Hurts:** memory grows with the largest file; a few concurrent downloads kill the instance.
- **Detect:** `grep -nE "readFileSync|arrayBuffer\(\)|\.text\(\)|Buffer\.concat" <diff files>` on paths that handle
  media, backups or user files.
- **Fix:** streams, multipart uploads, presigned URLs for downloads.

### DC-SCALE-06
**Unbounded growth: no retention, no LIMIT** · scalability · repo · Seen 4
- **Symptom:** tables or key areas (jobs, call cache, webhook inbox, outbox) that only grow; list endpoints without
  `LIMIT`; drains that read every entry including acknowledged ones.
- **Hurts:** slow degradation nobody notices in a diff: each read gets a little slower every day.
- **Detect:** per store, ask who deletes or archives. `grep -nE "SELECT .* FROM" ` without `LIMIT` on list paths.
- **Fix:** a retention job per area, `LIMIT` and pagination, partial indexes on the live subset.

## Security

### DC-SEC-01
**Replayable signed message: id outside the signature, no expiry** · security · diff · Seen 3
- **Symptom:** a webhook HMAC that covers only the body while the event id or timestamp comes from a separate
  header and drives dedupe; a signed button, link or payload without `exp` or a one-time nonce.
- **Hurts:** a captured signed body is replayed with a new id and processed as a new event; a signed token works
  forever, harmless only while some unrelated check holds.
- **Detect:** in each receiver, list what the signature covers and what the code trusts. Every new
  `createHmac`/`sign(`: what limits reuse?
- **Fix:** sign `timestamp.id.body` (or use the provider's signed id), reject outside a time window, dedupe on an id
  inside the signed body; an expiry and a single-use record for anything that changes state.

### DC-SEC-02
**Whole request body read before the size check** · security · diff · Seen 2
- **Symptom:** `await req.text()`, `req.json()` or `req.formData()` and only then `file.size` or a length check.
- **Hurts:** any anonymous caller can make the server buffer arbitrary bytes; the check runs too late.
- **Detect:** `grep -nE "req(uest)?\.(text|json|formData|arrayBuffer)\(\)" <diff files>`; what precedes it?
- **Fix:** check `content-length` and read through a capped stream (`readLimited` or equivalent) before parsing.

### DC-SEC-03
**Privilege granted on an unproven claim** · security · diff · Seen 1
- **Symptom:** an owner, admin or member role granted because the request typed an email, holds a cookie anyone can
  get, or passed a step "the gate does not verify" (often admitted in a comment).
- **Hurts:** account takeover: an outsider becomes the owner and locks the real one out.
- **Detect:** every new role, membership or privileged cookie. Ask: what proof did the caller give that they are who
  they claim?
- **Fix:** grant only after redeeming a one-time link sent to the claimed address (or an equivalent proof).

### DC-SEC-04
**Untrusted text reaching an LLM with tools, without a data delimiter** · security · diff · Seen 2
- **Symptom:** reviews, fetched pages, messages, uploaded files or webhook bodies concatenated into a prompt as
  plain text, in a loop that can call tools.
- **Hurts:** prompt injection: the text steers the model's tool calls or the content that autonomy approves.
- **Detect:** every new prompt template input. Ask: where does this string come from, and which tools can the model
  call in this loop?
- **Fix:** wrap external text in an explicit delimiter, with a system-prompt rule that it is data, never
  instructions; keep tools in that loop read-only.

### DC-SEC-05
**LLM-chosen tool with an external effect outside policy** · security · diff · Seen 1
- **Symptom:** a tool the model can call directly that sends, publishes, pays, deletes or writes outside the
  sandbox, without being planned and passed through the policy and approval layer.
- **Hurts:** the model, or text injected into it, triggers real effects with no approval and no run.
- **Detect:** every new tool definition: is its effect `read`? If not, where is the policy check?
- **Fix:** the tool proposes an action; the policy layer approves and executes it inside a run, with the idempotency
  wrapper. An exception needs an ADR.

### DC-SEC-06
**Outbound fetch to a host the input controls** · security · diff · Seen 2
- **Symptom:** a fetch of a user-supplied URL guarded by a string blocklist of private IPs; `redirect: 'follow'`; a
  download URL taken from input and sent with an `Authorization` header.
- **Hurts:** SSRF to internal and metadata addresses (`127.1`, hex IPs, DNS rebinding, redirects); credentials sent
  to an attacker's host.
- **Detect:** `grep -nE "fetch\(|redirect:" <diff files>` where the URL is not a constant.
- **Fix:** resolve DNS and reject private ranges on every hop (`redirect: 'manual'`); an allowlist of hosts for
  credentialed downloads.

### DC-SEC-07
**Secrets or personal data in argv, inherited env or fixtures** · security · diff · Seen 3
- **Symptom:** `--email=…` or tokens passed as CLI arguments; children spawned with the whole `process.env`; a real
  phone number or email in a test, a log example or a spec.
- **Hurts:** visible in `ps` and job logs; children inherit credentials they do not need; personal data versioned
  forever.
- **Detect:** `grep -nE "--(email|token|key)=|env: process\.env" <diff files>`; any phone or email literal in tests.
- **Fix:** pass sensitive values through stdin or a scoped env; a minimal child env; fictitious test data.

### DC-SEC-08
**Credential scope that leaks across environments or tenants** · security · diff · Seen 1
- **Symptom:** a test-mode key that can read live data of the same account; a query filtered by account but not by
  environment or tenant.
- **Hurts:** a key handed out for testing exposes production data.
- **Detect:** for each new read behind an API key, list the filters: tenant, environment, scope.
- **Fix:** carry the key's environment into every query; test keys read only test data.

### DC-SEC-09
**Least-privilege role that drifts behind the schema** · security · diff · Seen 1
- **Symptom:** a migration that adds a table without adding it to the application role's grants.
- **Hurts:** the restricted role stops working, so the app is run with the owner role, which voids the append-only
  and least-privilege guarantees.
- **Detect:** every new `CREATE TABLE`: is the table in the grants list?
- **Fix:** grants in the same migration, and a test that runs a smoke query with the application role.

### DC-SEC-10
**Anonymous endpoint that leaks or does expensive work** · security · diff · Seen 2
- **Symptom:** a public health or debug route that returns build ids, configuration flags or error strings, or that
  queries the database and object store on every anonymous request.
- **Hurts:** reconnaissance for attackers and a cheap amplification lever.
- **Detect:** every new route excluded from the auth middleware: what does it return and what does it touch?
- **Fix:** a constant liveness answer in public; details behind auth; cache any dependency checks.

### DC-SEC-11
**Vulnerable dependency on a reachable path** · security · repo · Seen 2
- **Symptom:** advisories in the package audit; framework features exposed by default (an image optimizer route
  excluded from auth); security headers missing app-wide.
- **Hurts:** a known exploit against an endpoint nobody remembers is public.
- **Detect:** the package manager's audit (`pnpm audit --prod`) on a schedule; the middleware's exclusions; the
  app's header config.
- **Fix:** upgrade, disable unused framework features, global security headers (CSP, `frame-ancestors`, HSTS).

## Data provenance

### DC-DATA-01
**Optional `actor` or audit fields on a new schema** · structure · diff · Seen 4
- **Symptom:** `actor: … .optional()`, `run_id` optional on a record born in a run, a base event schema without the
  audit fields, a new record type without `schema_version`.
- **Hurts:** the rule "every event says who" is enforced by nobody; a year later nobody can tell who changed what.
- **Detect:** in new or changed schemas, `grep -nE "actor.*optional|run_id.*optional" `; check `schema_version`.
- **Fix:** required fields on every new log schema; a legacy list that only shrinks; a test over all registered
  schemas.

### DC-DATA-02
**Identity dropped on the way to the write** · structure · diff · Seen 4
- **Symptom:** a write through a repository handle without its metadata (`repo` instead of `ctx.repo`); a CLI
  invoked with a fixed `--via dashboard` and no member id; a function that marks something delivered or revoked
  without a `by` argument.
- **Hurts:** records with `actor: unknown`; the history of who did what is wrong where it matters.
- **Detect:** each new write: where does its actor come from? Each new process boundary: is the identity passed?
- **Fix:** handles bound to the actor (`withMeta({ actor, run_id })`); identity carried across process boundaries
  as an explicit argument.

### DC-DATA-03
**Wall clock in domain code** · structure · diff · Seen 3
- **Symptom:** `Date.now()`, `new Date()` or `performance.now()` in domain code that otherwise uses an injected
  clock; a record timestamped with real time and compared with the simulated clock.
- **Hurts:** simulations, replays and tests diverge: events expire never or immediately; time-dependent tests flake.
- **Detect:** `grep -nE "Date\.now\(\)|new Date\(\)" <diff files>` outside the clock module, logging and tooling.
- **Fix:** the injected clock everywhere in the domain; a lint or architecture rule with a shrinking allowlist.

### DC-DATA-04
**Tool that writes to seed data or commits runtime state** · structure · diff · Seen 2
- **Symptom:** a command whose default data root is the repository (writes into versioned seed data); a runtime
  file under a folder that is not ignored.
- **Hurts:** test or local runs mutate the seed; runtime state lands in the history through the next commit.
- **Detect:** new paths written by the code: are they under an ignored root? `git check-ignore <path>`.
- **Fix:** refuse to write to the seed root without an explicit override; ignore every runtime folder.

## Structure

### DC-ARCH-01
**`npx` or a network download at runtime** · structure · diff · Seen 1
- **Symptom:** `npx --yes pkg@version`, `curl | sh`, `pip install` or a model download inside product code.
- **Hurts:** code outside the lockfile and its integrity hashes runs in production; an outbound call bypasses the
  gateway; it breaks offline and is invisible to tests.
- **Detect:** `grep -nE "npx |npm exec|curl |pip install|go run .*@" <diff files>` outside dev tooling.
- **Fix:** an installed dependency; an architecture rule that confines `child_process` to known modules.

### DC-ARCH-02
**Lower layer that spawns or imports an upper one; a process per request** · structure · diff · Seen 5
- **Symptom:** the core library spawns the CLI app, imports from an app, or builds an app path as a string; the
  kernel imports domain code.
  Also: a route or server action that spawns the full CLI for each user action.
- **Hurts:** cycles and boundaries the architecture test cannot see; hundreds of MB and a cold start per click,
  with no per-instance cap, so the host swaps under load.
- **Detect:** new imports and `spawn` targets that point upwards in the documented layer diagram;
  `grep -nE "spawn\(|runCli" ` in app and route files.
- **Fix:** call the library directly, or enqueue a job the app's worker runs; if a process is unavoidable, cap
  concurrent children per instance.

### DC-ARCH-03
**A second implementation of a guarded path** · structure · diff · Seen 2
- **Symptom:** a new emitter for a channel that already has one (each repeating style → budget → idempotency by
  hand); a new provider factory called outside its single owner.
- **Hurts:** each copy drifts; one forgets the budget or the idempotency key; import cycles grow between them.
- **Detect:** new calls to provider factories or gateways that are not in the module that owns the channel.
- **Fix:** one outbound module per channel; an architecture rule that only it may call the factory.

### DC-ARCH-04
**Code the architecture test does not see** · structure · repo · Seen 3
- **Symptom:** rules that scan only one folder (`capabilities/` but not the rest of core), regexes that miss dynamic
  `import()`, `createRequire` or `child_process`; tooling folders that are not scanned at all.
- **Hurts:** invariants pass by construction while the code breaks them.
- **Detect:** for each invariant, list the folders and import forms its test covers; diff that with the tree.
- **Fix:** widen the scan, match every import form, and add a test that fails on a planted violation.

## Tests

### DC-TEST-01
**Test that does not fail when the change is reverted** · process · diff · Seen 2
- **Symptom:** assertions only on `toBeDefined`, truthiness or `not.toThrow`; the expected value computed with the
  implementation's own formula; a mock asserting what the mock returns; a bug fix without a regression test.
- **Hurts:** coverage rises, nothing is checked; the bug comes back green.
- **Detect:** for each new test, revert the production hunk in your head (or for real in a scratch worktree): does
  it fail? Name the mutant that survives.
- **Fix:** assert the observable result for the scenario; one red-then-green regression test per bug.

### DC-TEST-02
**New module or write path without a direct test** · process · diff · Seen 2
- **Symptom:** a new source file, especially one that writes (an action handler, a crawler, a calendar mutation),
  with no test file and no test that imports it.
- **Hurts:** the riskiest code is covered only incidentally, if at all.
- **Detect:** new files in the diff without a sibling `*.test.*` and with no importer under the test tree.
- **Fix:** a direct test for each scenario of the spec, including the error path.

### DC-TEST-03
**Gate step that can be skipped silently** · process · diff · Seen 1
- **Symptom:** `continue-on-error: true` in CI, a test suite that skips itself when a tool is missing, `.skip` or
  `.only` added, a coverage threshold lowered, `|| true` after a gate command.
- **Hurts:** the gate stays green while a part of it no longer runs.
- **Detect:** `grep -nE "continue-on-error|\|\| true|\.skip\(|\.only\(|\.todo\(|skipIf" <diff files>`.
- **Fix:** fail when a required tool is missing; count skips as a ratchet; never lower thresholds.

## Gates and process

### DC-GATE-01
**Action licensed by a name instead of the checked identity** · process · diff · Seen 1
- **Symptom:** verify a branch, then `merge --ff-only <branch>`; check a file, then read it again by path; approve a
  version, then apply "latest".
- **Hurts:** time-of-check to time-of-use: whatever moved in between (a `wip:` commit made while verify ran) is
  acted on unverified.
- **Detect:** any check followed by an action on a ref, path or "latest" pointer. Ask: is the object acted on the
  same, by hash, as the object checked?
- **Fix:** record the identity (SHA, content hash, version id) at check time and act on that identity only; abort
  if the name moved.

### DC-GATE-02
**Validator or check that no gate runs** · process · repo · Seen 2
- **Symptom:** a validator that exists as a command but is in neither `verify` nor CI; a test that checks existence
  of documented paths but not completeness.
- **Hurts:** artifacts break silently until an unrelated command (an archive, a deploy) refuses them.
- **Detect:** list every validate, check and lint command in the project; diff with the steps of `verify`.
- **Fix:** add it to the full gate (and to the quick tier when its folder changes).

### DC-GATE-03
**Generator that rewrites only part of what it owns** · process · diff · Seen 1
- **Symptom:** a renumbering or rename tool that rewrites references with one pattern while the files use another
  (the heading keeps `draft`, the index shows stale rows).
- **Hurts:** generated state is half updated; every later run perpetuates it.
- **Detect:** for each regex in a generator, check it against a real file of each kind it touches; look for a test
  with a realistic fixture.
- **Fix:** a test fixture with every form the generator must rewrite, and an assertion on the whole output.

### DC-GATE-04
**Spec delta that drops existing scenarios** · process · diff · Seen 1
- **Symptom:** a MODIFIED requirement block in a spec delta that does not repeat every current scenario.
- **Hurts:** archiving the change deletes behavior from the living spec, or the archive refuses it later when
  nobody remembers why.
- **Detect:** for each MODIFIED block, compare its scenarios with the current spec's.
- **Fix:** copy every existing scenario into the delta; run the spec validator in the gate.

### DC-GATE-05
**Docs, ids or ratchets drifting from the code** · process · repo · Seen 8
- **Symptom:** two invariant numberings in prose; a debt table dated weeks ago; a coverage floor far below the
  measured value; metrics that count sandbox code; features and dependencies without their change or ADR; an ADR
  still "Proposed" after its change was archived; changes absorbed or finished but still active.
- **Hurts:** the documents agents read first lie, so agents act on stale rules; ratchets stop ratcheting.
- **Detect:** the audit metrics with deltas; a docs test in both directions; `git log` against the change list.
- **Fix:** make each drift a test (numbering regex, floor within one point of measured, roadmap validator), and
  delete what no longer applies.
