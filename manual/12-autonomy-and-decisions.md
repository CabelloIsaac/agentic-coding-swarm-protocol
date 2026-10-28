# 12 · Autonomy and human decisions

> **Status in the reference project (PLINNG):** designed in the changes `dev-panel`, `dev-land-tiers` and `dev-problem-brief`
> (wave 0, P0), **not yet enforced** at the time of writing. It is presented as the recommended next step, not as
> established practice.

**Goal:** reduce human supervision without losing control where it matters. "The risk is not a lack of autonomy;
it is a lack of control where it matters."

## Measure before you design

Over two intensive weeks of development: 74 sessions and 356 interventions by the tech lead, classified by hand (±4 points):

| Type | % |
| --- | --- |
| Nudges ("go on", "what now?") | 29 |
| Flow and status ("where is it?", "land it") | 25 |
| Permission | 12 |
| Spec gap | 12 |
| New task | 7 |
| Taste | 6 |
| Error | 6 |
| Convention | 3 |

There were only 30 formal questions (`AskUserQuestion`). Conclusion: a question inbox covers 15–20% of the
interventions; 55–60% is workflow friction; there is not enough volume for a decision router or confidence
thresholds. Before you build autonomy, **count your interventions and classify them.**

## Four rules

### 1. Do not stop inside accepted scope

Within what has already been accepted, the agent does not ask "shall I continue?". Tasks with an end condition use
`/goal`. Questions are asked **by rule** (spend, product autonomy, irreversible actions, contracts), never because
"I'm not sure".

### 2. If you ask, fill in the whole card

The last message before the question carries:

```
Context:         what I was doing and where
Challenge:       what is blocking
Concern:         what can go wrong
Recommendation:  what I would do and why
Impact:          low | medium | high
Reversible:      yes | no
Evidence:        file:line, commands, outputs
```

If any of the first five is missing, the card is marked `incomplete`. Deterministic fields (change, roadmap entry,
progress, touched components and their tier, branch, tmux pane) are added without an LLM. Each section ≤ 1,500
characters, the whole message ≤ 8,000, secrets redacted. Design: a `PreToolUse` hook on `AskUserQuestion` records
the question, posts it to Slack and waits for an answer; after 30 minutes it falls back to the terminal (fails
open).

### 3. Decide and record it (`Assumption:`)

Product, scope or user-visible behavior decisions that the agent makes on its own are declared as commit trailers:

```
Assumption: the reminder is sent at 09:00 in the user's local time — it matches the other scheduled jobs
```

`land` records one event per trailer; a land that touches product code (in the reference project: `core/`, `apps/` or the integrations package `connectors/`)
without any trailer is recorded as `assumed: none` (measured, not blocked). The human reviews each one with OK or Revisit; a "Revisit" is
shown to the next session working on that change until a commit cites its id.

### 4. Human OK only where the risk demands it (tiers T0–T3)

See chapter 03. The tier is computed from paths, without an LLM; human OK is required only at T3 (data, auth, spend
and external effects, infra and secrets, **the gates themselves**, and any weakening of tests). The approval is
bound to the file hashes. Report-only for three days, then enforce.

**Honest limitation:** the agent runs as the same OS user as the panel; a hostile agent could forge the record. v1
defends against mistakes, not against a hostile agent; the real boundary is an isolated runner.

## Proposals start from a problem (`dev-problem-brief`)

Every proposal carries a Problem with evidence (source, date, facts kept separate from hypotheses), an Outcome and
how it is measured, and Alternatives that include "do nothing". The last task is "Measure the outcome". A test
enforces this for new changes.

## What we do not build (yet)

No LangGraph, no decision routers, no confidence thresholds until there is volume to justify them. A shared
company-wide platform comes after the single-team version works and has metrics.

## Rollback criteria

Every workflow change ships with a numeric rollback criterion: "if fewer than 60% of lands are conflict-free after
one week, or p50 exceeds 15 minutes, stop the rollout". If you do not know when you would remove it, you do not
know whether it works.
