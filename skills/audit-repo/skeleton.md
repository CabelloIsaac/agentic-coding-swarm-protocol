# Audit file skeleton

Write `openspec/audits/<YYYY-MM-DD>.md` with exactly these sections. Keep each finding to five lines.

```markdown
# Audit <YYYY-MM-DD> · commit <sha7> · scope <full|diff|dimension>

<One paragraph: commits since the previous audit (<sha>), machine conditions (memory, parallel sessions), what was
run, how findings were verified (which highs you re-checked in the code), what was out of scope.>

## Deterministic checks

| Check | Result |
| --- | --- |
| lint | ✓ 0 errors · 431 warnings |
| typecheck | ✓ |
| structural tests | ✓ 40/40 |
| domain validators | ✓ |
| spec validation | ✗ 2 errors (AUD-specs-scenarios) |
| tests | ✓ (RPC timeout with all tests green: runner noise) |
| end-to-end demo | ✓ 14/14 criteria |
| seed and tracked storage clean | ✓ |
| dependency audit | ✗ 1 critical (AUD-sec-deps) |
| memory | normal, swap 0 |

## Metrics

| Metric | Value | Δ vs <previous date> | Reason if it rose |
| --- | --- | --- | --- |

<Below the table: one bullet per metric that rose, with its reason or its finding id. Metrics inflated by the
measurement itself (playground, the audit script's own patterns) say so and give the product's real value.>

## Trend

- New: AUD-… (highs, mediums, lows)
- Severity raised: AUD-… (from low to high: why)
- Still open, worse: AUD-… (what grew)
- Still open, unchanged: AUD-…
- Partly resolved: AUD-… (what remains)
- Resolved: AUD-… (<commit or change>)
- Reopened: AUD-…

## High

### AUD-<topic> · <dimension> · confirmed · new
`file:line` · failure scenario · impact · fix

## Medium

<Grouped by dimension.>

## Low

## Protocol vs project

| Id | Check | Result | Evidence |
| --- | --- | --- | --- |

Score: level 0 → n/5 · level 1 → n/5 · level 2 → n/6 · level 3 → n/5.
What the project does beyond the protocol · what the protocol requires and the project lacks (and the change that
covers it, if any) · defects shared with the reference implementation.

## What is working (do not break)

<Verified controls that must not regress, each with the test or script that proves it, grouped by dimension.>

## Proposed order

1. <Block> — <findings> — needs a change | an ADR | a one-commit fix
```

Ids: `AUD-<short-topic>`, stable across audits. A resolved finding stays one more audit, marked
`**resolved** (<change>)`, then drops off. Omit the protocol section when the mode excludes that dimension.
