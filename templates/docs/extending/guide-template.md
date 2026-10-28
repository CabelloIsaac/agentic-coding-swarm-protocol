# Adding a <thing>

<What a <thing> is, in one paragraph. Optional: the flow in one line, e.g. `Agent → Tool → Gateway → API`.>

## When to use this guide

- When you need <…>.
- If you only need <…>, see [<other guide>](<other>.md).

## Files

| Action | Path |
| --- | --- |
| Create | `src/<…>/<name>.ts` |
| Touch | `src/<…>/registry.ts` |
| Tests | `src/<…>/<name>.test.ts` |

## Contract and minimal template

```ts
// Real code from the repo: the minimum that compiles and passes the tests.
```

Implementation rules:

- <…>

## Automatic checks that guard it

- <Which constructor, validator or test catches which mistake.>

## Required tests

1. Happy path.
2. Invalid input (fails with an error that has context).
3. Contract violation.
4. PASS and FAIL with rollback (if it writes).
5. Policy or approval rejections (if applicable).
6. Full run in mock mode.

## Verification

```bash
pnpm vitest run src/<…>/<name>.test.ts
pnpm verify --quick
pnpm verify
```

## Definition of done

- [ ] Registered, with a description
- [ ] Required tests green
- [ ] Documented in `docs/architecture/<area>.md`
- [ ] `pnpm verify` green

## Common mistakes

- **<Mistake>:** <consequence and how to avoid it>.
