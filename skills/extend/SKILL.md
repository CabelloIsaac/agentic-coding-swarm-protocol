---
name: extend
description: Use when adding a new piece of a kind the system has or will have - an external integration or provider, a tool or capability, an event log or entity, a tenant setup, an LLM provider, a UI or dashboard section, an evaluator or audit check, a skill, playbook or catalog entry, a content format - when a task says "connect to <service>", "support another provider" or "new event type", or before creating a file in a registry-backed folder.
argument-hint: "<kind> <name>"
---

# extend

Say at the start: "Using extend for <kind> <name>."

**Resolve the commands first.** `{verify}` and `{verifyQuick}` from `swarm.json` as in the `verify` skill
([INTEGRATION.md](../../INTEGRATION.md)). The validators, registries and test paths named below are the repo's
own: read them from its guide and its `CLAUDE.md`.

## The gate

A new piece of a kind the repo already has follows that kind's guide in `docs/extending/`, and its definition of
done is copied into the change's tasks. A new kind with no guide gets one, written from the guide template, **in
the same change** as the first piece.

Why: each guide encodes the checks that catch that kind's mistakes (a name that does not match its registry entry,
a read tool with side effects, a mock that skips normalization, a field added without migration). Skipping the
guide makes those mistakes in the code that reviewers trust most, the code that copies a pattern (chapter 05).

## When not to use it

- Changing an existing piece without changing its kind's contract: `tdd` and, if behavior changes, `change`.
- A one-off helper inside a module: no guide; follow the module's own patterns.
- Changing the contract of a whole kind (the tool interface, the event envelope, the provider interface): that is a
  decision first (`new-adr` skill), then update the guide and every piece.

## Steps

```
- [ ] 1. Name the kind
- [ ] 2. Find its guide (or write one)
- [ ] 3. Copy the guide's definition of done into tasks.md
- [ ] 4. Walk the skeleton: register → implement → contract → test → document → architecture test
- [ ] 5. Close with verify and the report
```

1. **Name the kind.** Match the request against the guide titles and the "I want to add…" table of the docs index
   (`docs/README.md` or the repo's equivalent). The kinds and what each one is in [kinds.md](kinds.md). If the
   piece needs data from a new external system, the integration comes first, then the tool that uses it.
2. **Find the guide.** `ls docs/extending/` and `grep -ril "<kind>" docs/extending/ docs/README.md`.
   - **Found:** read it whole. It is short, and its "common mistakes" section is the point.
   - **Not found:** copy `${CLAUDE_SKILL_DIR}/../../templates/docs/extending/guide-template.md` to
     `docs/extending/<kind>.md`, fill every section from the first real piece you are building (real code, real
     paths, real test names), link it from the docs index, and add it to any guide list in `CLAUDE.md`. The docs
     test fails on an unlinked guide or on paths that do not exist.
3. **Plan.** The piece belongs to a change (`change` skill). Copy the guide's definition of done into its
   `tasks.md`, one task per box, each with its check.
4. **Walk the skeleton** in [skeleton.md](skeleton.md): register, implement, contract and validator, tests, docs,
   architecture test entry. Every step names the check that proves it; tick it only after that check ran.
5. **Close.** `{verifyQuick}` while iterating, full `{verify}` at the end (`verify` skill).

## Red flags

| Thought | Reality |
| --- | --- |
| "I will register it later; the code works." | The registry is the source of truth: a constructor that checks names fails, or worse, the piece runs unlisted and no policy applies to it. Register first. |
| "Reading the file directly is simpler than the repository port." | Only the storage layer touches storage. A direct read breaks the second backend and fails the architecture test. |
| "A quick `fetch` here; the gateway is overkill." | Every external call goes through the gateway: timeouts, credentials, mock/replay, cost and budget live there. A direct call is invisible to all of them. |
| "The mock can return the normalized shape." | Then normalization is never tested. Mocks return the raw provider shape, deterministically. |
| "It only reads, so `effect: read`." | Read tools run inside the agent loop without approval. Anything with a side effect is a write, planned and approved. |
| "One more required field; old records will be fine." | A new required field without `schema_version` and migration makes every existing log unreadable. |
| "I will document it after merging." | The docs test catches new folders, commands and guides that are not documented, inside `verify`. Docs ship with the piece. |
| "No guide exists, so I will just follow a similar file." | The next person copies yours, mistakes included. Write the guide now from the template. |
| "I will add an exception to the architecture test for this one." | An allowlist entry needs a reason and a doc update, and the list must not grow without the human agreeing. Fix the design. |

## Report

```
extend: <kind> <name> · guide docs/extending/<kind>.md (followed | written in this change)
registered: <registry file:entry> · contract: <schema/validator> · tests: <files, scenarios covered>
docs: <architecture page, README, index> · architecture test: <rule covering it | none needed: why>
definition of done: 9/9 · verify: ✓ all green (212s)
```

Depth: [chapter 05](../../manual/05-architecture-and-docs.md) (extension guides, invariants),
[chapter 17](../../manual/17-agentic-system-architecture.md) (tools, gateway, write pipeline, event logs).
