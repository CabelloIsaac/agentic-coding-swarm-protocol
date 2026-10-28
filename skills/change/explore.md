# Phase: explore

Think before proposing. Exploring is reading, asking and comparing; it is **never** writing application code. You may
write change artifacts if the human asks you to capture something; that is recording thinking, not implementing.

## When

- The request is vague ("add real-time collaboration", "the auth flow is a mess").
- Two or more approaches are plausible and the choice changes the specs.
- You are mid-implementation and a task turned out larger or different than the design says.

Skip it when the problem, the approach and the acceptance criteria are already clear: go to propose.

## What to do

1. **See what exists.** `{spec} list --json` (active changes and their progress) and the main specs of the
   capabilities involved (`openspec/specs/<capability>/spec.md`). If a related change is active, read its
   `proposal.md`, `design.md` and `tasks.md` before anything else: the answer may be "continue that one".
2. **Ground it in the code.** Map the modules, entry points and data the change would touch; find the patterns
   already in use and the hidden complexity (event logs, approvals, background jobs, external integrations).
3. **Separate facts from hypotheses.** Every fact carries its source and date (a log line, a metric, a ticket, a
   commit). Hypotheses are labelled as such; they become the open questions of the design.
4. **Compare options.** A table with the real constraints as rows and the options as columns. Always include "do
   nothing" and say what happens then. Diagrams in ASCII when a flow or a state machine is involved.
5. **Surface risks and unknowns.** What could go wrong, what you cannot know without a spike, which decisions would
   need an ADR (contract, invariant, run shape, formula).

## Capturing what you learn

Offer; do not capture on your own. The human decides.

| Insight | Goes to |
| --- | --- |
| New or changed requirement | `specs/<capability>/spec.md` of the change |
| Design decision | `design.md` (`### D<n>.` with the rejected alternatives) |
| Scope changed | `proposal.md` |
| New work | `tasks.md` |
| Assumption invalidated | the artifact that relied on it |
| Structural decision | a draft ADR (`new-adr` skill) |

## Exit

Write this, in chat or in the change's `proposal.md` if one exists:

```
Problem: <one paragraph, with the evidence and its source>
Approach: <the option chosen and why the others lost, including "do nothing">
Open questions: <each with who can answer it>
Next: propose <name> | continue <existing change> | spike <question> | drop it
```

Exploring may end in "do not build it". That is a valid result: say so and record it in the roadmap comment if an
entry existed.
