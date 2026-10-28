# Audit file skeleton

Write `openspec/audits/<YYYY-MM-DD>.md` with exactly these sections. Keep each finding to five lines.

```markdown
# Audit <YYYY-MM-DD> · commit <sha7> · scope <full|diff|dimension>

<One paragraph: machine conditions (load, parallel sessions), what was run, how findings were verified, what was
out of scope.>

## Deterministic checks

| Check | Result |
| --- | --- |
| lint | ✓ 0 errors · 431 warnings |
| typecheck | ✓ |
| structural tests | ✓ |
| spec validation | ✗ 2 errors (AUD-specs-scenarios) |
| dependency audit | ✓ 0 high |

## Metrics

| Metric | Value | Δ vs <previous date> | Reason if it rose |
| --- | --- | --- | --- |

## Trend

New: AUD-… · Still open: AUD-… · Resolved: AUD-… (<commit or change>)

## High

### AUD-<topic> · <dimension> · confirmed
`file:line` · failure scenario · impact · fix

## Medium

## Low

## What is working (do not break)

<Verified controls that must not regress, each with the test or script that proves it.>

## Proposed order

1. <Block> — <findings> — needs a change | an ADR | a one-commit fix
```

Ids: `AUD-<short-topic>`, stable across audits. A resolved finding stays one more audit, marked
`**resolved** (<change>)`, then drops off.
