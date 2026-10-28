---
name: debug
description: Finds and proves the root cause of a failure before any fix is attempted, and escalates to the architect agent after two failed fixes. Use when a test, a verify step, a land or a running feature fails and the cause is not already proven, when a fix did not work, when a failure only happens sometimes or only under load, or when tempted to retry, add a sleep, widen a timeout or skip a test.
argument-hint: "[symptom]"
---

# debug

Say at the start: "Using debug on <symptom>."

## The gate

No fix before a root-cause statement backed by evidence: a command that reproduces the failure, and the file, line
or condition that causes it. **Two failed fixes for the same failure end the attempt**: stop and escalate
(step 6). Keep a visible counter in your notes ("fix attempt 1/2").

Why: guess-and-retry looks like progress and costs the most. Each failed attempt stays in the conversation and gets
re-read, which makes the third guess worse, not better (chapter 08). And in a repo with many parallel sessions, a
large share of "bugs" are the machine or stale state, which no code fix will cure (chapter 02).

## When not to use it

- The cause is already proven (the assertion names it, a reviewer pointed at the line): go straight to `tdd`.
- The failure is a known environment signature (stale dependencies, generated leftovers): the table in the
  `verify` skill fixes it in one step.

## Steps

1. **Rule out the environment** (two minutes, every time). `uptime` and memory; did a rebase change the lockfile;
   are there generated leftovers; is another session's dev server holding the port; is there a `.env` making this
   worktree behave differently; does the failure involve files your diff does not touch. Checks and their tells:
   [techniques.md](techniques.md) § Environment.

2. **Reproduce.** Find the smallest command that fails every time and write it down (a single test with `-t`, a
   CLI call in mock mode). It does not reproduce → it is intermittent: suspect the test first (global state, order,
   shared `/tmp`, real clock, fixed ports) and see [techniques.md](techniques.md) § Intermittent.

3. **Read and trace.** Read the whole error and stack. Find where the wrong value is **observed**, then walk
   backwards to where it is **produced**. Look at what changed: `git log --oneline main..HEAD`,
   `git diff main...HEAD -- <area>`. A regression already on `main`: `git bisect run <single-test command>`.

4. **Compare.** Find a similar path in the repo that works and list every difference, however small.

5. **One hypothesis at a time.** Write it as "X fails because Y; if so, Z is observable". Test it with the smallest
   probe (an assertion, a log line, one input), not with a fix. Wrong → discard it and form the next one; do not
   stack changes.

   A long investigation that would flood your context (many files, a full suite, logs) can go to the `debugger`
   agent instead: it returns the root cause, the causal chain and a red reproduction test, not the fix. Brief it with
   the symptom, the reproduction and what you ruled out.

6. **Fix or escalate.**
   - Hypothesis confirmed → `tdd` skill: a test that reproduces it, red, one fix at the root, green, then `verify`.
   - Fix attempt 2 failed → stop. Write a brief and hand it to the `architect` agent (read-only, expensive, made for
     "debugging that already failed twice"), or ask the human with the decision card. The brief carries: the
     symptom, the reproduction command, what is ruled out and how, the hypotheses tried and the evidence against
     each, the relevant files. Give it the code and the evidence, **not your conclusion**, or it will confirm it.
   - If you are the main session and the conversation already holds the failed attempts, suggest `/clear` and a
     fresh start from the brief.

## Red flags

| Thought | Reality |
| --- | --- |
| "Let me just try changing this." | That is a guess. Go back to step 3. |
| "It passed on rerun, so it is flaky." | Intermittent has a cause: order, state, clock, load. Find it. |
| "Probably the machine." | Prove it: `uptime` and the files green on their own. Otherwise it is the code. |
| "A retry, a sleep or a longer timeout will stabilize it." | That hides a race. Wait on the condition, inject the clock. |
| "I will fix these three things at once." | Then you will not know which one mattered. One change per hypothesis. |
| "The test is wrong." | Maybe. Show why the expectation is wrong before changing it. |
| "One more attempt and it will work." | After two, escalate. The third guess is the most expensive. |
| "Skip the test for now and move on." | That weakens the gate. Quarantine follows chapter 04, with a ticket and an expiry. |

## Report

```
debug: <symptom>
Repro:      <exact command> → <failing output line>
Ruled out:  load (uptime 4.1) · deps (lockfile unchanged) · …
Root cause: <file:line> — <why, one sentence>
Evidence:   <probe and its output>
Fix:        tdd → RED/GREEN lines · verify ✓ | escalated to architect (brief attached)
```

Depth: [techniques.md](techniques.md), [chapter 04](../../manual/04-testing.md) (flaky policy),
[chapter 11](../../manual/11-anti-patterns.md) (verification and machine anti-patterns).
