---
name: learn
description: Turns an incident or mistake from a session into a durable rule with a mechanism (test, hook, ratchet or check) in the current project, and drafts a protocol issue when the lesson is generic. Use after an incident is fixed, when the user says "this must not happen again", "remember this", "add a rule", or asks to record a lesson, a post-mortem or a new anti-pattern.
argument-hint: "[what happened]"
---

# learn

Say at the start: "Using learn on <incident in a few words>."

## The gate

**No lesson without a mechanism, or an explicit `preference` label.** A mechanism is something that fails or warns
without anyone remembering the lesson: a test, a hook, a ratchet (a metric that may only move one way), a check in
`verify`, the audit or the conformance checks. A rule with no mechanism is written as `preference` and says so. And
no lesson without evidence: the incident, the command or commit that shows it, and the fix.

Why: a lesson stored as prose in a chat, a memory file or a long `CLAUDE.md` is forgotten by the next session and
never reaches the next team. Rules that are designed but not enforced decay (CONTRIBUTING.md ground rules 1 and 4);
the ones that hold are the ones a gate checks (chapter 11, chapter 18 §d).

## When not to use it

- The failure is not understood yet: `debug` skill first. A lesson about a guessed cause is a wrong rule.
- The fix is not done: finish it (`tdd`, `verify`). This skill records; it does not repair.
- A one-off with no plausible repeat (a typo, a mis-click): say so in one line and stop.
- Task-specific state for the next session: that is a checkpoint or `tasks.md`, not a rule.

## Steps

1. **Collect the input.** Ask only for what is missing, in one message:
   - **What happened:** the symptom, as observed, with the date.
   - **Evidence:** the reproduction command and output, commits, log lines, the audit id (`AUD-*`) or incident link.
   - **The fix:** the commit or change that resolved it, and why it works.
2. **Find the root rule.** One sentence: "<practice> causes <failure>; instead <practice>". Check it is not already a
   rule: grep the project's anti-patterns, `docs/quality.md`, `CLAUDE.md`, ADRs, and the protocol's
   [chapter 11](../../manual/11-anti-patterns.md). Existing rule that did not fire → the lesson is "the mechanism is
   missing or broken", not a new rule.
3. **Choose the mechanism.** Use the table in [formats.md](formats.md) § Mechanisms: the cheapest one that fails
   *before* the incident could repeat. Prefer, in order: a test or check in `verify`, a ratchet, a hook, an audit
   metric, a conformance check. None fits → label it `preference` and say why it cannot be enforced.
4. **Write it in the current project, the project's way.** Read `swarm.json` and `CLAUDE.md` to find its flow.
   - The anti-pattern entry, in the project's anti-patterns list (or `docs/quality.md` § Anti-patterns if there is
     none), with the row format in [formats.md](formats.md) § Anti-pattern entry.
   - The mechanism as a **change** when it alters behavior or the gate (`change` skill: proposal with the incident
     as the problem and the mechanism as the measure), or as an **ADR draft** when it changes a contract, an
     invariant or a gate (`new-adr` skill). A pure test that only adds coverage can go straight in with the entry.
   - If the rule also belongs in `CLAUDE.md`, end it with the project's marker: `(enforced: <path>)` naming the
     mechanism, or `(preference)`.
   - Never weaken an existing gate to "fix" the lesson.
5. **Decide whether it is generic.** It is generic when it would happen in another repo following the protocol: it
   is about the workflow, the gate, agents or tooling, not about this project's domain. Project-specific → stop at
   step 4.
6. **Generic → draft for the protocol repo.** Write an issue (or PR body, if the user wants to send the change)
   for https://github.com/AntoniArco/agentic-coding-swarm-protocol with [formats.md](formats.md) § Protocol issue.
   Anonymize: no customer data, secrets, private code or internal names (CONTRIBUTING.md ground rule 5). **Show the
   full draft to the user and stop.** Send it only after an explicit "yes, send it", with
   `gh issue create --repo AntoniArco/agentic-coding-swarm-protocol --title "<title>" --body-file <file>`, and
   report the URL. No confirmation → leave the draft in a temp dir outside the repo (the agent's scratchpad if it
   has one) and give its path.
7. **Verify** what you wrote in the project: `verifyQuick` from `swarm.json` (and show the new test failing on the
   old behavior when the mechanism is a test, as in `tdd`).

## Red flags

| Thought | Reality |
| --- | --- |
| "I will add a line to `CLAUDE.md`: always do X." | Prose is not a mechanism. Add the check, or label it `preference`. |
| "I will save it to my memory." | Memory is per person and per machine. The next team never sees it. |
| "The lesson is: be more careful." | Not a rule. What would have failed automatically? |
| "Five lessons from this incident." | One root rule per incident. The rest are symptoms of it. |
| "It is generic, I will open the issue now." | Never send without explicit confirmation. Show the draft. |
| "The test can come in a follow-up." | Then the entry ships with `preference` until it does, and says so. |
| "The rule is obvious; no evidence needed." | Evidence over opinion: the incident, the command, the fix. |
| "I will relax the check that fired wrongly." | A false positive is a lesson too: fix the check, do not weaken it. |

## Evidence

```
learn: <incident, one line> · <date>
Root rule:   <practice> causes <failure>; instead <practice>
Evidence:    <command/commit/AUD-id> → <observed line>
Fix:         <commit or change>
Mechanism:   <test | hook | ratchet | check | preference> · <path> · fails on the old behavior: <RED line | n/a>
Written as:  <change openspec/changes/<x> | ADR-draft-<slug> | direct> · entry in <file>
Generic:     no | yes → draft at <scratchpad path> · sent: no (awaiting confirmation) | <issue URL>
verifyQuick: <last line>
```

Depth: [formats.md](formats.md), [chapter 11](../../manual/11-anti-patterns.md),
[MAINTAINING.md](../../MAINTAINING.md) (incident → learn → PR loop).
