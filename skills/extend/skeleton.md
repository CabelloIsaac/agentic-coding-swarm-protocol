# The common skeleton of an extension

Every extension guide in the reference project, whatever the kind, walks the same six steps. Use this list when
the repo's guide is thin, and to check that a new guide you write covers every step.

## 1. Register

```
- [ ] The piece has an entry in its registry (tool registry, integration list, event-log table, catalog, nav
      sections), with the same name, domain and effect as the code
- [ ] The registry is the only place that decides what exists: anything implemented is registered, anything
      registered as implemented exists
- [ ] Permissions are declared there (approval level, effect, external effect), and a tenant can only tighten them
```

Check: the registry constructor or validator fails on a mismatch (name, domain, effect), and the catalog validator
fails on references to unknown pieces.

## 2. Implement

```
- [ ] Data only through the repository ports (no filesystem, database or object-storage client outside storage)
- [ ] External systems only through the gateway (no direct HTTP client, SDK or child process elsewhere)
- [ ] Credentials injected by the runtime, never read from the environment inside the piece
- [ ] Time from the injected clock, never the wall clock, so simulations and tests are deterministic
- [ ] Spend checked against the budget before it happens, recorded after
- [ ] Writes to published content through the write pipeline (snapshot → write → evaluate → rollback on fail)
- [ ] External effects (publish, deploy, buy, send) wrapped for idempotency with a key that is stable on retry
- [ ] A mock that is deterministic (seeded, no Math.random) and returns the raw provider shape
- [ ] Errors mapped to the repo's error types with context (auth, rate limited, upstream, invalid input, not found)
```

Check: the architecture test (storage, network, SDK and process boundaries) and the guide's own rules.

## 3. Contract and validator

```
- [ ] Input and output schemas (Zod or the repo's equivalent), with descriptions and limits where a model fills them
- [ ] Input validated before any call; output validated before it is used; evidence from an invalid output discarded
- [ ] Event records carry schema_version, actor and, inside a run, run_id; state changes are new events with the same id
- [ ] References (ids, evidence refs) resolve to records that exist, checked at write time
- [ ] Incompatible schema change: bumped schema_version, reader accepts both versions, migration script with backup
```

Check: the schema tests, the domain validators in the gate (catalog, tenant, spec validation).

## 4. Test

Minimum set, adapted per kind (the guide lists the exact ones):

1. Happy path, in mock or replay mode, with concrete values.
2. Invalid input fails with context and without calling anything external.
3. Contract violation: bad output is rejected and leaves nothing behind.
4. If it writes: PASS keeps the new version; FAIL rolls back and the content is unchanged.
5. If it needs approval or is destructive: the rejection paths.
6. Deterministic mock: the same input twice gives the same output.
7. Cost: estimate before, actual after; a paid operation never estimates zero.
8. A full run in mock mode that uses the piece end to end.
9. No keys: health and listing commands still exit 0.

Tests never use real keys or the seed data in place; they work on a temporary copy.

## 5. Document

```
- [ ] The area's architecture page (modules, event logs, integrations catalog) describes the piece
- [ ] New CLI commands are in the README; new environment variables in .env.example, commented
- [ ] New guide (if any) linked from the docs index and any guide list in CLAUDE.md
- [ ] Product or requirements tables that enumerate this kind are updated (the test that counts them, too)
- [ ] A draft ADR if the piece changes a contract, an invariant, the shape of a run or a formula
```

Check: the docs test (cited paths exist, new structure is documented, guides are linked).

## 6. Architecture test entry

```
- [ ] The boundaries the piece must respect are covered by an existing rule, or a new rule ships with it
- [ ] A new folder in the kernel or at a domain root is classified (kernel or domain)
- [ ] No new allowlist entry; if unavoidable, it has a reason and the documentation says why
```

Check: the architecture test runs inside `verify`. A rule written in prose and not in the test is an intention.

## Writing a new guide

Start from the template and keep its sections: definition (one paragraph, optional flow line), when to use it (and
when to use another guide), files (Action → Path), contract and minimal template (real code from the repo),
automatic checks that guard it, required tests, verification commands, definition of done, common mistakes (each
with its consequence). Write it from the first real piece, not in the abstract, and add a "common mistake" for
every problem review or the gate found while building it.
