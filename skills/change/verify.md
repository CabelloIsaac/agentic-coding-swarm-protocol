# Phase: verify

Prove that the code does what the change's specs say, that every requirement has a tested scenario and that the
design was followed. This is not the `verify` skill (the quality gate); it runs that gate as its last step.

## Steps

1. `{spec} instructions apply --change <name> --json` for the change directory and context files; read them all.
2. `{spec} validate <name> --strict`. Any error is critical.
3. Check the three dimensions below; record each issue with its severity.
4. Run the full `{verify}` (the `verify` skill) after your last edit.
5. Write the report. Critical issues block archive.

## Completeness

- **Tasks.** Count `- [x]` against `- [ ]`. Every unchecked task that is not `(outside the repo)` is critical.
- **Stale tasks.** Re-read every unchecked or "outside the repo" task against the code and the other changes. The
  reference project's audits found tasks that claimed a tool was missing when it worked, and tasks already done by
  an archived change. Each one is resolved: done (tick it with evidence), obsolete (strike it with the reason) or
  genuinely outside the repo (owner and tracker).
- **Meta-tasks.** "Verify green", "archive the change": strike them as obsolete; the gate guarantees them.
- **Requirements.** Every `### Requirement:` in the delta specs has an implementation you can point to
  (`file:line`). One you cannot find is critical.

## Correctness

- **Requirement → code.** For each requirement, the file and lines that implement it, and whether they match its
  intent (SHALL vs SHOULD, edge cases, error paths). A divergence is a warning, or critical if the spec's main
  promise is broken.
- **Scenario → test.** For each `#### Scenario:`, the test that exercises it, by file and test name. A test that
  only covers the lines without asserting the THEN does not count. A scenario without a test is a warning; the
  report lists it as a gap. The `test-auditor` agent can judge whether the tests prove anything.

## Coherence

- **Design.** Each `D<n>` in `design.md` is followed by the code, or `design.md` is updated to what was actually
  decided (with the reason). A silent contradiction is a warning.
- **ADR.** If the design names a contract, invariant, run-shape or formula decision, a draft ADR exists and is cited.
- **Docs.** The area's architecture doc, the README (commands) and the docs index reflect the change; the docs test
  is part of `{verify}`.
- **Patterns.** New code follows the repo's patterns (naming, folders, extension guides). Deviations are
  suggestions unless they break an invariant.

## Severity

| Level | Means | Examples |
| --- | --- | --- |
| Critical | must be fixed before archive | unchecked task, unimplemented requirement, validation error, red gate |
| Warning | should be fixed; archive with the human's consent | scenario without a test, divergence from a design decision |
| Suggestion | nice to fix | pattern inconsistency, naming |

When unsure, pick the lower level, and say it is uncertain. Every issue carries a `file:line` and a concrete
recommendation; "consider reviewing" is not a recommendation.

## Report

```
## Verification: <name>
| Dimension | Status |
| --- | --- |
| Completeness | 14/14 tasks (1 outside the repo) · 7/7 requirements implemented |
| Correctness | 15/15 scenarios with a named test |
| Coherence | design D1–D3 followed · ADR-draft-<slug> cited |
validate: ✓ · verify: ✓ all green (212s)
Critical: none | <list> · Warnings: <list> · Suggestions: <list>
Result: ready to archive | fix N critical issue(s) first
```
