<!--
Work in progress has a limit (`roadmap.maxActive`, default 12) and a change with no task ticked for
`roadmap.staleDays` (default 14) fails `roadmap`. To keep a change that is deliberately waiting, add this line at the
top, with the real reason, and delete it when work resumes. It exempts the change from the stale check only: a parked
change still counts toward the limit; archive it or delete the folder (the roadmap entry stays as `planned`) to stop
counting it.

parked: <why it waits, and what unblocks it>
-->

## Why

<One or two sentences: why now.>

## Problem and evidence

<What happens today, with source and date. Separate facts from hypotheses.>

- Fact: … (source, date)
- Hypothesis: …

## Outcome and measure

<What changes for whom and how it is measured. Baseline today → target. Rollback criterion if applicable.>

## What Changes

- …

## Alternatives

- **Do nothing / do not build:** …
- **<Other>:** …

## Capabilities

### New Capabilities
- `<capability>`: …

### Modified Capabilities
- `<capability>`: …

## Impact

<Code, contracts, data, docs, ADRs and invariants affected. Expected risk tier (T0–T3).>
