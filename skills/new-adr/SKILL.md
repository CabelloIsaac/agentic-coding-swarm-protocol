---
name: new-adr
description: Writes a draft architecture decision record (docs/adr/draft-<slug>.md), numbered later by land, after checking that the decision really needs one. Use when a change alters a contract (domain schema, tool or port interface, repository, external integration, LLM provider), an invariant, the shape of a run or a formula, when superseding an earlier ADR, or when the user asks to record a decision. Not for implementation details.
argument-hint: "<kebab-case-slug>"
---

# new-adr

Say at the start: "Using new-adr for <slug>."

## The gate

A change that alters a contract, an invariant, the shape of a run or a formula is not ready without an ADR. An
accepted ADR is never edited: a new ADR supersedes it. Drafts are never numbered by hand: `land` numbers them.

Why: decisions without a record get re-argued six weeks later; edited ADRs hide what was decided when; and two
branches numbering "ADR-0042" at once once forced a rename across ten files (chapter 05).

## When not to use it

- An implementation detail inside one module (a helper, a loop, a rename): no ADR; say so and stop.
- A behavior change without a structural decision: it needs an OpenSpec change, not an ADR.
- Recording a preference ("we like small functions"): that goes in `docs/quality.md` or `CLAUDE.md`.

## Steps

1. **Check that it is needed.** Answer in one line each: which contract, invariant, run shape or formula changes?
   If all four are "none", stop and say so.
2. **Find related decisions.** `grep -ril "<topic>" docs/adr/`. If yours supersedes one, note its number. Do not
   touch the old file beyond its `- Status:` line (`Superseded by ADR-draft-<slug>`).
3. **Create the draft.** Slug: `$ARGUMENTS`, or derive a short kebab-case one from the decision. Read
   `commands.newAdr` in `swarm.json` at the repo root (contract: [INTEGRATION.md](../../INTEGRATION.md)): if it is
   a command, run it with the slug; if it is a path pattern, create that path. When the file or the key is missing,
   fall back to `docs/adr/draft-<slug>.md` and say so: `cp docs/adr/0000-template.md docs/adr/draft-<slug>.md`, or,
   if the repo has no template, start from `${CLAUDE_SKILL_DIR}/../../templates/adr/0000-template.md`.
4. **Fill it in.** One to two pages. Each section has a test:

   | Section | Passes when |
   | --- | --- |
   | Title | one line naming the problem and the solution |
   | Status, Date, References | `Proposed`; today; the change (`openspec/changes/<x>`, design D1…Dn), code paths, incidents |
   | Context | the problem with real data: numbers, dates, commits, incidents; what happens if nothing is decided |
   | Decision | concrete, checkable sentences (**D1.** … **Dn.**); a reviewer could say whether code complies |
   | Consequences | the good **and the bad**; which invariant or test protects it. "No downsides" means you have not looked |
   | Confirmation | how compliance is checked: architecture test, validator, audit metric |
   | Alternatives considered | each with why it lost, including "do nothing" |

5. **Cite it** in code and docs as `ADR-draft-<slug>`. `land` rewrites every reference when it assigns the number.
6. **If it creates or changes an invariant:** add the row to the invariants table (ID, rule, why, enforced by) and
   the architecture test in the **same** change. Without a test it is an intention, not an invariant.
7. Leave `docs/adr/README.md` alone: its index is generated between markers.

## Decision sentences: weak and checkable

| Weak | Checkable |
| --- | --- |
| "We will handle storage cleanly." | "**D1.** Only `src/storage/` imports `fs`, `pg` or object-storage SDKs; the architecture test enforces it." |
| "Retries should be safe." | "**D2.** Every capability with `external_effect: true` runs through the idempotency wrapper keyed by run and step." |

## Red flags

| Thought | Reality |
| --- | --- |
| "I will just update the old ADR." | Accepted ADRs are immutable. Write a new one that supersedes it. |
| "It is ADR 0043, I will name it that." | Numbering at creation collides across branches. Use `draft-<slug>`. |
| "I will add my row to the ADR index." | It is generated; a hand edit conflicts with every other branch. |
| "Consequences: none." | There is always a cost. Name it. |
| "The decision is obvious; skip the alternatives." | Then "do nothing" takes one line. Write it. |
| "I will add the invariant test in a follow-up." | The row and the test ship together, or the invariant does not exist. |

## Report

```
ADR: docs/adr/draft-<slug>.md · Proposed · supersedes <ADR-NNNN | none>
Decision: <D1 in one line>
Cited from: <files> · Invariant: <INV-xx added + test path | none>
```

Depth: [chapter 05](../../manual/05-architecture-and-docs.md) (ADRs, invariants table).
