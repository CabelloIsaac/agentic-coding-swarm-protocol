# 07 · Code quality

**Rule:** strict TypeScript, ESM, Zod for every contract, no `any` or `@ts-ignore` in production code, every
suppression carries a reason, files over ~500 lines are split by responsibility. What lint does not stop, the
audit measures.

## Types

- Always `strict: true` and `noUncheckedIndexedAccess: true`; no package relaxes them. Also `isolatedModules`,
  `module`/`moduleResolution: NodeNext`, `target ES2023`.
- `any`, `@ts-ignore` and `@ts-expect-error` are banned in production code. External input enters as `unknown` and
  is parsed with Zod. Every contract (entity, event, configuration, API response) is a Zod schema defined in one
  place.
- Use `x!` only when the invariant is visible in the adjacent lines; otherwise check and throw an error with
  context. Free use in tests.
- Each app with its own `tsconfig` is type-checked separately (`tsc --noEmit -p apps/<app>`) in `verify` and in CI.

## Lint (Biome, linter only)

- `recommended` preset. The formatter is deliberately off to avoid rewriting the whole repo at once: a conscious
  debt, recorded in the debt table (see chapter 14).
- At **error** across the repo: `noUnusedImports`, `noUnusedVariables`, `noUnusedFunctionParameters`,
  `noFloatingPromises`, `noMisusedPromises`. Why the last two: the storage ports are asynchronous; a write without
  `await` (an event, a tenant file, an ID) would fail silently; with the rule at error it breaks lint instead. To
  repeat an async callback in order (IDs, evidence, events), use a small `mapSequential` helper, not `Promise.all`:
  against a database the execution order would be nondeterministic.
- `noNonNullAssertion` off in tests only.
- UI apps: accessibility and hook-dependency rules as `warn` (measured, not blocking).
- **Every suppression carries a reason:** `// biome-ignore lint/<group>/<rule>: <reason>`. A suppression without
  a reason is rejected in review, and the audit counts them. No `eslint-disable` (the repo does not use ESLint;
  inherited ones are deleted when the file is touched).
- Deliberate exceptions to the preset live in a **rule / where / why** table in `quality.md`. The reference
  project's table:

| Rule | Where | Why |
| --- | --- | --- |
| `noAssignInExpressions`, `useIterableCallbackReturn` | everywhere | the compact style (`??=` inline, `forEach((x) => (obj[k] = x))`) is intentional; TypeScript already catches a missing `return` in a `map` |
| `noImplicitAnyLet` | everywhere | TypeScript infers an unannotated `let` from its assignments |
| `noNonNullAssertion` | tests | with `noUncheckedIndexedAccess`, tests index known results |
| a11y, `noArrayIndexKey`, `useExhaustiveDependencies` | UI apps | `warn`, not error, until the debt is paid |
| `noImgElement` | UI apps | images are data URLs or tenant files the framework's image optimizer cannot handle |

## Size and structure

- A file over ~500 lines is a candidate for splitting **by responsibility**, not by line count. A new file should
  not start above that size.
- One responsibility per function. If you need a comment to separate phases inside a function, it is two
  functions.
- Comments explain why. No commented-out code, no debug `console.log`: product logs go to the event logs or the
  CLI output; operational logs are one JSON object per line on stdout, never with emails or prompts.
- A TODO carries enough context; if it is real work, it is a change.
- Split along responsibilities such as selection / composition / render. Large files go in the dated debt table
  with their next step ("split when the area has no work in progress"), not into a silent backlog.

## Async and side effects

- All storage access is asynchronous and goes through a repository; nothing touches `fs` or `pg` outside the
  storage layer (an invariant with a test). The storage backend is chosen by one environment variable
  (files or Postgres); the domain cannot tell which.
- External input enters as `unknown` and is parsed with Zod at the boundary; tools validate their input and output
  against their schema, and evidence produced during a call is buffered and committed only if the output is valid
  (discarded if it throws).
- External effects (publish, purchase, send) go through an idempotency wrapper keyed by the action ID (or a natural
  key such as piece + time slot when a retry creates a new action): `done` returns the stored result; `started`
  means the process died mid-effect, so the tool reconciles with the real state or ends as `needs_review`.
- Every web write goes through a single write pipeline: snapshot → write → evaluator → rollback. Nothing deletes
  published pages: there is no delete tool for them, and the registry schema forbids a production-delete effect.
- Nothing destructive without a saved version and a record of who, when and why, kept in the storage layer and
  invisible to the agent runtime (restoring is not an agent tool).
- Every spend is checked against the budget first; every decision cites existing evidence refs; every new event
  carries `actor` and, inside a run, `run_id` (chapter 05 lists the full invariant set).
- Untrusted text that reaches the product (generated HTML, memory notes, webhook bodies) passes a safe renderer or a
  strict parser; filesystem paths derived from data go through one `confine()`-style helper against traversal.

## Commit style

- Lowercase conventional prefixes: `feat(scope):`, `fix(scope):`, `docs(scope):`, `test:`, `chore:`,
  `refactor:`. The summary states **what changes and why**, in one long sentence if needed. Example from the
  reference project: "fix(reviews): reviews older than a year no longer ask for a reply — max_age_days 365 (one
  account had 760 multi-year-old reviews hiding this week's)". That "why, with a number" is worth more than a body.
- One commit = one intent. `wt:commit` absorbs the `wip:` commit so the real commit is clean.
- Planned trailers: `Assumption: <what I decided without asking> — <why>` (chapter 12) and the agent attribution.
- Never secrets; `.env` is not versioned; the audit scans tracked files for key patterns.

## Code review

- The reviewer **runs** lint, types and tests; it does not reason about them.
- Report only findings with a concrete failure scenario (`file:line`, problem, why it fails, fix). If everything is
  fine, one line with the commands that prove it. No filler.
- Review against the spec, not in general: "check that every requirement is implemented and every edge case has a
  test; **ignore style**". A reviewer asked to find problems always finds something; if you fix everything, you end
  up with extra layers of abstraction.
- The reviewer has not seen how the code was written (a `reviewer` subagent with a clean context, or
  `/code-review`).
- A second-model review (a model from another vendor, run by `land` on sensitive paths) is planned; it is blocked
  until a data policy exists. Decide the policy
  before enabling the gate.

## What the audit measures because lint does not stop it

Warnings per rule, `any`, `as unknown as`, `@ts-ignore`, `biome-ignore` (and those without a reason), files over 500
lines, TODOs, environment variables missing from `.env.example`, secret patterns, draft ADRs, measured coverage vs
the floor. **None of them rises without a written reason; when one reaches zero, its rule becomes an error.** The
ones with a ratchet (file size, coverage gap, lint warnings; next section) cannot rise at all.

`quality.md` keeps a dated **known-debt table** (debt / status / next step) as the starting snapshot; the current
figures live in the latest audit report. The reference project's first snapshot: four files of 500–770 lines,
412 `noNonNullAssertion` warnings in production code, 8 inherited `eslint-disable` comments, coverage 88.3 % lines
and 81.5 % branches. Each row says when it gets paid ("lower them when touching each file; at 0, make the rule an
error"). The coverage HTML report is a CI artifact.

## Ratchets

**Rule:** a quality rule that no mechanism enforces erodes. Every number the team agreed should only improve lives
in `quality-ratchets.json`, `verify` fails when it gets worse, and `land` moves it to the new best value.

Why: between two audits of the reference project, ten days apart and with every gate green, lint warnings rose by
90, files over 500 lines went from 9 to 15, the coverage floor sat 2.7 points below what was measured for 19 days,
and a field the invariants require stayed optional in new schemas. Each of those rules was written down. None had a
check, so each depended on someone noticing, and the audit noticed ten days late.

**The file** (template: `templates/quality-ratchets.json`; script: `reference/scripts/ratchets.ts`, no
dependencies):

| Ratchet | Shape | Fails when | Tightened by `land` |
| --- | --- | --- | --- |
| `fileSize` | `{ max: 500, include, exclude, exceptions: { "<path>": <lines> } }` | a file in scope is over `max` and is not an exception; an exception grew past its recorded size | exceptions shrink to the current size; an exception at or under `max`, or deleted, is removed |
| `coverage` | `{ summary, floor: { lines, statements, functions, branches }, maxGap: 1 }` | measured is below the floor; measured is more than `maxGap` above it ("raise the floor to X") | each floor rises to measured − `maxGap`/2, rounded down to one decimal |
| `lintWarnings` | `{ command, budget, perRule? }` | the warnings counted from the linter's JSON (Biome or ESLint shape) exceed `budget` or a rule's budget | `budget` and each `perRule` entry fall to the current count |

- **Only tighten.** `--tighten` never adds an exception, lowers a floor or raises a budget. Loosening is a hand
  edit of a gate file, which the quality-gate hook flags and review must justify.
- **Start from today's state.** Copy the template, adapt `include` and the lint command (Biome needs
  `--max-diagnostics=10000`, or it truncates the list), and run `node scripts/dev/ratchets.ts --init` before the
  first commit: every oversized file becomes an exception at its current size, the floor goes just under what is
  measured and the budget equals today's warnings. Once the file is committed, `--init` refuses.
- **One rule for the first floor.** Measure, then set the floor to measured minus half of `maxGap` (with the
  default `maxGap: 1`, half a point below). That is the value `--tighten` computes, so the first tighten changes
  nothing. "1 to 2 points below" contradicts `maxGap: 1` and is not a rule.
- **Lint budget in other stacks.** The budget counts the linter's diagnostics with the tool in "report, don't fail"
  mode: ruff `--exit-zero --output-format json`, eslint `-f json`, biome `--reporter=json` (with
  `--max-diagnostics=10000`). A linter without a warning severity (ruff has none) keeps `budget: 0`: every
  diagnostic is an error. `--init` and the counter in `ratchets.ts` are Node-shaped; a Python team ported the
  ratchets in about 190 lines and its verify in about 110. Keep `quality-ratchets.json` byte-compatible so the
  ports stay interchangeable.
- **Where the coverage floor lives.** Two options, pick one source. (a) In `quality-ratchets.json`, and the test
  runner reads it (`thresholds: JSON.parse(readFileSync('quality-ratchets.json', 'utf8')).coverage.floor`); `land`
  raises it automatically. (b) In `vitest.config.ts` as today: replace `floor` with `"floorFrom": "vitest.config.ts"`
  and the ratchet reads the thresholds from there. The gap check still fails with "raise the floor to X", but
  nothing rewrites the config: you raise it in the same change. Option (a) is the one that cannot drift.
- **In `verify`.** The full tier runs the ratchets as the last serial step, after the tests, because the coverage
  check reads the summary the test step writes (`json-summary` reporter). The quick tier checks only `fileSize`,
  only on the changed files, in milliseconds.
- **In `land`.** After a green verify, `land` runs `--tighten` and, if the file changed, commits it on its own
  ("chore: tighten quality ratchets") on top of the verified SHA, the same pattern as the ADR numbering commit.
  **Only that file may change:** `land` checks that the commit touches nothing else and aborts otherwise. That
  commit is the one exception to "integrate exactly what was verified", and it is safe because its values are the
  measurements of the verified tree. A failure to measure (a missing linter) never blocks a verified land: the
  file is restored and the next land retries.
- **Other stacks.** The same three numbers exist everywhere: file length, a coverage report (`coverage.py json`,
  `go tool cover`, `llvm-cov`, JaCoCo) and a linter with a JSON reporter. Port the script or keep the file format
  and write the check in your stack.

Each rule in `CLAUDE.md` says how it is held: `(enforced: <path>)` or `(preference)`, checked by the docs test (see
`templates/CLAUDE.md`). Ratchets turn the "only goes down" preferences of this chapter into `enforced:` rules; the
audit counts the preferences that remain and names the ones it finds eroding.

## What to copy into your repo

The strict `tsconfig` and the Biome configuration of the reference implementation described in
`reference/README.md` (adapt the paths), the exception table with reasons, and the suppression-with-reason rule;
both tables are in `templates/docs/quality.md`. Then `templates/quality-ratchets.json` with
`reference/scripts/ratchets.ts`, initialized from your repo's current state.
