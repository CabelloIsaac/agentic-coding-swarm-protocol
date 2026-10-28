# Quality: gates and good practices

A change is done only with every gate green. They run locally (`pnpm verify`) and in CI, identically. CI has no
secrets: if a gate needs credentials to pass, the test is badly designed.

## Gates

| Gate | Command | Fails if |
| --- | --- | --- |
| All | `pnpm verify` (`--quick` while iterating) | any of the below fails; `land` requires it |
| Lint | `pnpm lint` | there is an error (warnings are measured debt) |
| Types | `pnpm typecheck` | there is a type error |
| Tests | `pnpm test` | a test fails, including architecture and documentation tests |
| Coverage | `pnpm test:coverage` | it drops below the floor in `vitest.config.ts` |
| Specs | `openspec validate --all` | a spec or change does not validate |

## Types

- `strict` and `noUncheckedIndexedAccess` always; nobody relaxes them.
- No `any`, `@ts-ignore` or `@ts-expect-error` in production code. External data enters as `unknown` and is parsed
  with Zod.
- `x!` only with the invariant in view; otherwise check and throw with context. Free in tests.

## Lint

- Every suppression has a reason: `// biome-ignore lint/<group>/<rule>: <reason>`.
- Deliberate exceptions to the preset:

| Rule | Where | Why |
| --- | --- | --- |
| `<rule>` | `<path>` | `<reason>` |

## Tests

- Next to the code (`*.test.ts`); e2e as `*.e2e.test.ts` (they run first).
- No network or keys (mock and replay modes); never on seed data.
- Every bug comes with the test that reproduces it, red first.
- Every test file has its own `TMPDIR`; whatever it creates is deleted.
- Coverage floor just below what was measured; if you raise it, raise it in the same commit. It never goes down.
- No `sleep` to "give it time": inject the clock and wait for conditions.

## Flaky tests

1. Doubt the test first (global state, ordering, `/tmp`, real clock, fixed ports).
2. The only tolerance is an infrastructure failure with an exact signature, written into `verify`.
3. If it is not fixed the same day: quarantine with a ticket and an expiry date, outside the gate; the audit counts
   them and the number does not go up.
4. A reproducible failure is not "flaky": it is a bug.

## Size and structure

- Files over ~500 lines: split by responsibility. A new file is never born above that.
- One responsibility per function. Comments explain why. No commented-out code and no `console.log`.
- TODOs carry context; if it is real work, it is a change.

## Anti-patterns

Practices that caused a real failure here, one row each, so the next person does not repeat them. Add a row when an
incident teaches a rule (the `learn` skill writes it in this format); every row names its mechanism or says
`preference`.

| Practice | Symptom | Instead | Evidence | Mechanism |
| --- | --- | --- | --- | --- |
| `<practice, as the thing someone did>` | `<what was observed>` | `<the practice to follow>` | `<incident: date, commit or audit id>` | `<path, or preference>` |

## Reviews

The full schedule is in the playbook (chapter 15): independent review per non-trivial change, security review on
sensitive paths, daily health, weekly sweep, biweekly audit.

## Known debt <date>

| Debt | Status | Next step |
| --- | --- | --- |
| `<…>` | `<…>` | `<…>` |

Current figures are in the latest report in `openspec/audits/`. No metric goes up without a written reason; when one
reaches zero, its rule becomes an error.
