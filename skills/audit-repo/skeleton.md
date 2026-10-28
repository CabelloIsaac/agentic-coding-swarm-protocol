# Audit file skeleton

Write `openspec/audits/<YYYY-MM-DD>.md` with exactly these sections. Keep each finding to six lines: the sixth is
its detection data, which also goes in `openspec/audits/<YYYY-MM-DD>.findings.json` for `{audit} --findings`.

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
| ratchets | ✓ size, coverage gap, lint budget within bounds |
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

## Detection

| Measure | This audit | Previous | Trend |
| --- | --- | --- | --- |
| New findings | n | n | ↑/↓/= |
| Median latency (introduced → detected), days | d (n of m with a known commit) | d | ↑/↓/= |
| Escape rate (new findings catchable at review) | x % (k of n) | y % | ↑/↓/= |

<Below the table: the escaped findings by defect class (`DC-…` from `checklists/defect-classes.md`) and the review
that let each through; *diff* findings with no class, proposed as new classes. Latency falling and escape rate
falling is the goal: defects caught in the change, not ten days later. The figures come from the metrics file
(`{audit} --write --findings`).>

## Rules and mechanisms

`CLAUDE.md`: <n> rules · <e> `enforced:` · <p> `(preference)` (Δ vs previous) · <u> unmarked.

| Rule (abbreviated) | Marker | Eroding how (finding or metric) | Proposed mechanism |
| --- | --- | --- | --- |

<A `preference` rule that eroded gets a mechanism proposed (ratchet, test, hook). An `enforced:` rule that eroded
means its mechanism has a hole: that is a finding.>

## High

### AUD-<topic> · <dimension> · confirmed · new
`file:line` · failure scenario · impact · fix
introduced `<sha7>|unknown` · detected <YYYY-MM-DD> · catchable at review yes (DC-…)|no

## Medium

<Grouped by dimension.>

## Low

## Protocol vs project

| Id | Check | Result | Evidence |
| --- | --- | --- | --- |

Score: level 0 → n/6 · level 1 → n/6 · level 2 → n/7 · level 3 → n/5 (one per check id in INTEGRATION.md §6).
What the project does beyond the protocol · what the protocol requires and the project lacks (and the change that
covers it, if any) · defects shared with the reference implementation.

## What is working (do not break)

<Verified controls that must not regress, each with the test or script that proves it, grouped by dimension.>

## Proposed order

1. <Block> — <findings> — needs a change | an ADR | a one-commit fix
```

Ids: `AUD-<short-topic>`, stable across audits. A resolved finding stays one more audit, marked
`**resolved** (<change>)`, then drops off. Omit the protocol section when the mode excludes that dimension.
