---
name: tdd
description: Drives a code change test-first, red then green, and keeps the failing and passing output as evidence. Use before writing production code for any bug fix, new behavior or behavior change, when a reviewer or user reports a defect, and when a test must prove a fix. Not for documentation, configuration-only edits or throwaway playground spikes.
argument-hint: "[bug or behavior to cover]"
allowed-tools: Bash(pnpm vitest run *) Bash(pnpm verify *) Bash(git diff *) Bash(git apply *) Bash(git status *)
---

# tdd

Say at the start: "Using tdd for <behavior>."

## The gate

Every bug fix starts with a test that reproduces the bug and that you have **watched fail for the right reason**.
New behavior starts with a test that fails because the behavior does not exist yet. Production code comes second.

Why: a test you never saw fail may not test anything. Agent-written tests tend to cover many lines and assert little
(chapter 04), and a fix without its reproduction comes back.

## When not to use it

- Documentation, pure configuration, generated code, a spike under `playground/`: no test-first, but `verify` still
  closes the work.
- You do not yet know what is wrong: use the `debug` skill to find the root cause, then come back here to write
  the reproduction.

## Commands by stack

| To | Vitest | pytest | go test | cargo test |
| --- | --- | --- | --- | --- |
| Run one test | `pnpm vitest run <file> -t "<name>"` | `pytest <file>::<test>` | `go test ./<pkg> -run '^<Test>$'` | `cargo test <name>` |
| Run one file | `pnpm vitest run <file>` | `pytest <file>` | `go test ./<pkg>` | `cargo test --test <file>` (integration) or `cargo test <module>::` |
| Coverage | `pnpm test:coverage` | `pytest --cov` | `go test -cover ./...` | `cargo llvm-cov` |

The repo's own single-test command (`CLAUDE.md`) wins over this table. The `allowed-tools` line above lists the
Vitest and `verify` commands; add the one for your stack in the project's settings.

## Steps

```
- [ ] 1. Place the test
- [ ] 2. RED: write it, run it, see it fail for the right reason
- [ ] 3. GREEN: minimal code, test passes
- [ ] 4. Prove it bites (bug fixes)
- [ ] 5. Refactor while green
- [ ] 6. Close with verify
```

1. **Place the test** at the smallest level that can show the behavior: unit test next to the code (`x.test.ts`),
   contract suite for a port, `*.e2e.test.ts` only if servers must start. Small beats large: no network, no disk,
   no sleep, under a second whenever possible.

2. **RED.** One test, one behavior, a name that states it. Run only that test with the repo's single-test command
   (see its `CLAUDE.md`; the table below has the common stacks, and the examples use Vitest). Read the failure. It must be the assertion you expect
   (`expected 10.01, received 10`), **not** an import error, a typo, a missing fixture or a timeout. If it fails for
   another reason, fix the test and rerun. If it **passes** right away, the test does not reach the bug or the bug
   is elsewhere: go back to `debug`.

3. **GREEN.** Write the least code that makes it pass. No extra features, no opportunistic refactor. Rerun the
   test, then the quick gate (`commands.verifyQuick` in `swarm.json`; fallback `pnpm verify --quick`) so nothing
   nearby broke.

4. **Prove it bites** (bug fixes). Take the fix out and confirm the test goes red again:

   ```bash
   git diff -- <source files> > "$TMPDIR/fix.patch"
   git apply -R "$TMPDIR/fix.patch"   # fix removed
   pnpm vitest run <file> -t "<test name>"   # must fail
   git apply "$TMPDIR/fix.patch"      # fix restored
   pnpm vitest run <file> -t "<test name>"   # must pass
   ```

   Do not use `git stash` for this: in a repo with several worktrees the stash stack is shared, and another session
   can pop your entry.

5. **Refactor** names and duplication with the test green after every step.

6. **Close** with the `verify` skill (full level). If your change raised coverage, raise the floor in the test
   config (`vitest.config.ts` in the default stack) in the same commit.

## Test rules that do not bend

- No network and no keys: mock or replay mode. A test that needs a credential is badly designed.
- Never on seed data: copy it into a temp root (`PROJECT_ROOT=<copy>`).
- Everything the test creates lives in its own temp dir and is deleted.
- Deterministic: inject the clock, wait on conditions, never `sleep` "to give it time".
- Timeouts: 20 s per test, 10 s per hook. Needing more means a misclassified e2e or a bug.
- Assert on behavior, not on a mock you configured to return the expected value.
- No `.only`, `.skip` or `.todo` reaches the integration branch.

## Red flags

| Thought | Reality |
| --- | --- |
| "Too simple to need a test." | Simple bugs come back too. The test takes a minute. |
| "I will write the test after the fix." | Then you never see it fail and cannot know it tests the bug. |
| "It passed on the first run. Great." | A new test that passes immediately proves nothing. Find out why. |
| "I checked it by hand." | Manual checks do not run in `verify`. Encode it. |
| "I will snapshot the current output." | If the current output is the bug, you just locked it in. |
| "It needs the real API to be meaningful." | Use the replay mode, or record once with `--record`. |
| "Add a sleep so it stops flaking." | Wait on the condition; inject the clock. |
| "I already wrote the code; I will keep it and add tests." | Write the test, revert your code with the patch trick, watch it fail, restore. |

## Report

```
tdd: <behavior>
RED:   pnpm vitest run src/billing/invoice.test.ts -t "rounds totals" → ✗ expected 10.01, received 10
GREEN: same command → ✓ 1 passed
Bites: fix removed → ✗ · restored → ✓
Close: pnpm verify → ✓ all green (205s)
```

Depth: [chapter 04](../../manual/04-testing.md) (test types, temp dirs, flaky policy, test quality).
