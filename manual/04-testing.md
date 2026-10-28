# 04 · Testing

**Rule:** a change is done when its tests prove it and the whole suite stays green with coverage above the floor.
Tests use no network and no credentials, never touch seed data, and clean up what they create.

## Which tests exist and where they live

| Type | Where | What it proves | Name |
| --- | --- | --- | --- |
| Unit | next to the code, `x.test.ts` | one function or module, including its edges | `*.test.ts` |
| Contract | next to the interface | every implementation of a port (storage files/Postgres, LLM mock/real) meets the same contract | `*.contract.test.ts` or a parameterized suite |
| Architecture | `core/test/architecture.test.ts` | the invariants: import graph, allowlists, append-only | fixed |
| Documentation | one `docs.test.ts` in the CLI package | docs cite things that exist, and everything new is documented | fixed |
| E2E | `apps/*/`, `scripts/dev/demo.test.ts` | the system end to end in mock mode; starts servers | `*.e2e.test.ts` |
| Tooling | `scripts/dev/*.test.ts` | `land`, `verify`, `wt`, `roadmap`, `audit`… | `*.test.ts` |

(Paths follow the reference project's layout; adapt them.) **Development tools have tests.** Breaking the workflow is
breaking the product.

## Rules that do not bend

1. **Every bug comes with the test that reproduces it**, written before the fix and red first.
2. **No network, no keys.** `mock` and `replay` modes via environment variable; CI has no secrets. If a test needs
   a credential to pass, the test is badly designed.
3. **Never on seed data.** Tests use copies in a temporary directory (`PROJECT_ROOT=<copy>`).
4. **Each test file gets its own `TMPDIR`**, and everything it creates is registered and deleted. Three layers:
   - global setup: sweeps leftovers from dead workers at startup;
   - per-file setup: its own `mkdtemp`, `process.env.TMPDIR` points to it (child processes inherit it), deleted in
     `afterAll`;
   - interceptor: `fs.mkdtempSync` patched to register every `<project>-*` directory, plus a Proxy on
     `process.env` that records assigned temp roots (`PROJECT_ROOT` and similar); swept in `afterAll` and in
     `process.on('exit')`.
   Reason: in the reference project, 173,000 temp directories and a full disk (ENOSPC) with parallel sessions.
   The per-file `TMPDIR` (`<project>-vitest-<pid>-XXXXXX`) matters for e2e tests: their child processes (the CLI)
   inherit it, while the interceptor only sees the worker process. The global setup removes the directories of
   dead worker pids and stray `<project>-*` roots older than 6 hours, so a bare `vitest` also cleans up after an
   interrupted run; `verify` adds a 60-minute sweep as a safety net. End-to-end runs whose output you want to keep
   write inside the repo (an ignored `storage/demo/`), not to `$TMPDIR`, and free their isolated root in `finally`.
5. **Slow tests first.** A sequencer moves `demo.test.ts` and `*.e2e.test.ts` to the front. A fresh worktree has no
   vitest history, so the demo (1.5–5 min) used to start last and stretch every land. Any test that starts servers
   is named `*.e2e.test.ts` to join that group.
6. **A coverage floor that only rises** (`thresholds` in `vitest.config.ts`): just below the measured value (86%
   lines, 79% branches in the reference project when this was written). If your change raises coverage, raise the floor
   in the same commit. Never lower it to make a change pass. The HTML report stays in an ignored `coverage/`
   folder and CI publishes it as an artifact.
7. **Explicit timeouts:** 20 s per test and 10 s per hook locally; 60 s with coverage. A test that needs more is a
   misclassified e2e or a bug.
8. **`x!` is fine in tests, forbidden in production** unless the invariant is visible right there.
9. **No `.only` is ever integrated** (lint flags it; the tier guard would send it to human review).
10. **A deterministic test or no test.** No `sleep` "to give it time"; inject the clock and wait on conditions.

## A pyramid, not an inverted cone

Most tests are unit and contract tests (milliseconds, no IO). E2E tests are few; they prove the pieces fit, not
cover cases. If a behavior can be tested at unit level, do not test it via e2e. A useful classification (Google's
test sizes): **small** = no network, no disk, no sleep, < 1 s; **medium** = disk and localhost allowed, < 1 min;
**large** = anything allowed, only in the e2e group.

## Flaky-test policy

A test that sometimes passes and sometimes fails is **neither retried blindly nor marked `skip`**:

1. Suspect the test first (global state, ordering, shared `/tmp`, real clock, fixed ports).
2. If it is an infrastructure failure with an exact signature (e.g. vitest's RPC timeout with every test green),
   `verify` tolerates it **only** by that signature. This is the single exception, and it is written in code.
3. If it is not fixed the same day, move it to quarantine (a `describe` tagged with the ticket) **outside the
   gate**, with an expiry date. The audit counts quarantined tests, and that number cannot rise.
4. A test that fails reproducibly is never "flaky": it is a bug, in the code or in the test.

## Architecture tests: invariants as code

Every invariant in the architecture document (`INV-01`…) has a test. Recurring mechanisms:

- **Import graph:** "only `core/src/storage` imports `fs`", "the kernel imports only kernel and `schemas/`",
  "`@anthropic-ai/sdk` only in `core/src/llm`".
- **Allowlist with reasons:** exceptions are a `file / imports / reason` table, and a test asserts the table has no
  stale entries. **The list only shrinks.**
- **Grep for forbidden patterns:** nobody reads a `.jsonl` by hand, nobody builds an event log outside the
  repository layer, nobody calls `fetch` from a tool (external calls go through a gateway interface), every web
  write calls the write pipeline, every tool with an external effect uses the idempotency wrapper.
- **Registry = code:** every registered implementation exists and every existing one is registered, with the same
  domain and effect (`read`, `write`, `publish`…); the registry constructor also rejects mismatches at startup.
- **Context isolation:** a test builds the agent's context and asserts the simulator's model never appears in it.
- **Schemas:** every event-log record requires `schema_version`, `id`, a tenant ID and `created_at`; the log
  interface exposes no update or delete; the Postgres migration has a trigger against UPDATE/DELETE/TRUNCATE (the
  architecture test reads the migration SQL; a contract suite proves it against a real database using the app's
  restricted role).
- **Playground quarantine:** no production package imports from `playground/`.

The file header says: "do not fix a failure with an exception without updating the document." If you change an
invariant, you change the ADR.

## Documentation tests

Ignoring code blocks, for `docs/**/*.md`, `CLAUDE.md`, `README.md` and the indexes:

- every relative link resolves to a file;
- every repo path in backticks exists (except globs and placeholders);
- every function cited as `name()` exists in the code (with a stop list of generic names);
- every core module, every external integration, every event-log type, every package, every CLI command, every
  extension guide and every numbered ADR appears in its index;
- invariants in **both directions**: every `INV-xx` tested appears in the invariants table, and every row of the
  table has a test (or a stated reason, in a list that only shrinks, why another mechanism enforces it);
- one numbering: prose and tests never cite an invariant id with different padding (`INV-1` or `INV-001` for
  `INV-01`). In the reference project the agent memory file listed the invariants as a plain 1–11 list while the
  table used `INV-xx`; architecture docs and more than 20 ADRs then cited `INV-5` meaning item 5 of the short list,
  which is a different invariant from `INV-05`. A periodic audit caught it. Number the short list with the same ids.

Result: documentation cannot fall behind without the suite saying so. One-directional checks only catch half of the
drift: a table row whose test was deleted looks exactly like a protected invariant.

## Tests that prove behaviour

A test proves behaviour only if breaking the behaviour turns it red. Three incidents from the reference project:

- **The wrong field.** A capability computed `pending_review` and still returned `evaluation: pass`. Its test checked
  `status` and not `evaluation`, so the bug shipped with a green suite and full line coverage. In a sample of eight
  tests, six would have survived a broken implementation; the two that would not were the dangerous ones. **Rule: a
  test must assert the field the rule is about.** If the requirement says "completed means verified", the assertion
  is on the verification field, not on whichever field was handy.
- **The cheap check: the mutation smoke.** `reference/scripts/mutation-smoke.ts` takes the source files a change
  touched, applies up to four mutations to each (flip a `true`, `>=` to `>`, `&&` to `||`, a return value to
  `undefined`), runs only their related tests, and reports the mutations that survived (`line 85: flipped true →
  false survived`). A file whose mutations all survive, or that has no related test, is "not proven". It is a smoke,
  not mutation testing (Stryker and mutmut below do that properly); it costs a few test runs per changed file, so
  verify's full tier can afford it. Start in `warn` mode, move to `fail` once the survivors it finds are fixed.
- **No concurrent callers.** 517 test files and not one called a transition twice at once, so a read-check-append race
  on an approval (two approvals of the same id) was invisible. **Pattern for every state transition:**
  `const results = await Promise.all([approve(id), approve(id)])`, then assert exactly one succeeded, the other got
  the typed conflict (or the documented no-op), and the ledger holds exactly one event and the effect ran once. It is
  red on a read-check-write implementation and green on a conditional write (chapter 17, section 16). Reservations
  held in memory need the same test with two workers (two store handles) racing for the last unit.

Add the reasoning to review: the `test-auditor` agent lists the survivors and requires the two-callers test for every
transition the diff adds.

## Test quality, not just quantity

Coverage tells you which lines ran, not whether anything useful was asserted. Agent-generated tests tend to cover a
lot and assert little. Two defenses:

- **Adversarial benches with `expect_fail`:** cases that **must** fail, to prove the gate bites (the reference
  project uses them for the output checks of its agent tasks).
- **Mutation testing on what is critical** (Stryker for TS): start with the core (policy, budget, write
  pipeline), aiming for zero surviving mutants in money or deletion rules. It is not a CI gate at first: it is one
  more audit metric.

## What to ask the agent

- "Write the test that reproduces the bug, confirm it fails, fix it, confirm it passes, and show me both outputs."
- "No `.skip`: if you cannot fix the test, tell me."
- "If the test needs network or keys, stop and explain why."
- Spec review: "check that every requirement has a tested scenario; ignore style."

## What to copy into your repo

`templates/tests/vitest.config.ts` (coverage floor, timeouts, sequencer, setups), `templates/tests/architecture.test.ts`
and `templates/tests/docs.test.ts` as models, the sequencer and temp-dir hygiene from the reference implementation
described in `reference/README.md`, and this chapter's flakiness policy in your `quality.md`
(`templates/docs/quality.md`).
