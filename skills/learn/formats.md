# learn · formats

## Contents

- Mechanisms
- Anti-pattern entry
- Protocol issue

## Mechanisms

Pick the cheapest one that fails before the incident could repeat.

| Mechanism | Use when | Example | Lives in |
| --- | --- | --- | --- |
| Test | the failure is reproducible from code or data | a test that loads every registry entry and imports its implementation | next to the code; runs in `verify` |
| Structural check | the failure is a shape: an import, a path, a missing doc, a numbering | architecture test rule; docs test rule | `architecture.test.*`, `docs.test.*` |
| Domain validator | the failure is in the project's own data files | a schema plus cross-reference check for a config family | a `validate:*` step in `verify` |
| Ratchet | the failure is a count that crept up | lint warnings, `any`, skipped tests, coverage floor: may only move one way | the audit metrics, or a test comparing with a stored baseline |
| Hook | the failure happens in the session, before code exists | warn when a gate file is edited; refuse `wip:` on land | `swarm.json` hooks, `.githooks/`, plugin hooks |
| Integration guard | the failure happens on integration | `land` refuses an unverified SHA or foreign commits | `commands.land` |
| Audit metric | the failure is slow drift that no gate sees | env vars missing from `.env.example`; changes at 90 % for weeks | `commands.audit` + `audit-repo` |
| Conformance check | the failure is a missing protocol piece | X2 report older than 30 days | INTEGRATION.md §6 (protocol repo) |
| `preference` | nothing above can detect it | "prefer small functions" | `docs/quality.md`, labelled `preference` |

## Anti-pattern entry

One row in the project's anti-patterns table, same columns as the protocol's chapter 11 plus the evidence and the
mechanism:

```markdown
| ★ **<Name, as the practice>** | <symptom as observed> | <fix as a practice> | <incident: date, commit or AUD-id> | <mechanism: path, or `preference`> |
```

`★` marks a lived incident with evidence. The name describes the practice ("Fast-forwarding a name instead of the
verified SHA"), not the outcome ("land broke").

## Protocol issue

Title: `[learn] <the root rule in under ten words>`

```markdown
## Problem
<What happens in a repo that follows the protocol as written. One paragraph, anonymized.>

## Evidence
- Incident: <date, what was observed, how often (e.g. "twice in 3 weeks")>
- Reproduction: <command or sequence>
- Impact: <time lost, unverified code integrated, money spent…>

## Root rule
<practice> causes <failure>; instead <practice>.

## Proposed mechanism
<test | hook | ratchet | check | conformance check> — what fails, where, and why it fires before a repeat.
Affected protocol files: <manual chapter, INTEGRATION.md §, skill, reference script, template>.

## Fix that worked in our project
<What we changed, generalized; a link only if public.>

## Labels
<anti-pattern | gate | integration | agents | docs> · severity <high | medium | low> · designed or enforced: <which>
```

A PR body uses the same sections plus `## Change` (files touched) and `## Checks` (the output of
`node scripts/check-links.mjs` and `claude plugin validate .`), and a `CHANGELOG.md` entry, as CONTRIBUTING.md asks.
