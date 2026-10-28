---
name: adopt
description: Adopts the Swarm Protocol in the current repository one level at a time (0 to 3), writing and maintaining swarm.json, merging the templates into what the repo already has, and proving each level with the conformance checks; --check reports conformance without changing anything. Use only when the user explicitly asks to adopt, install, upgrade or check the protocol in a repo.
disable-model-invocation: true
argument-hint: "[0|1|2|3] [--plan] | --check [level]"
---

# adopt

Say at the start: "Using adopt (<level>, <plan|apply|check>)."

Arguments: `$ARGUMENTS`. A level number (default `0`); `--plan` writes the plan and stops; `--check [level]` runs
the conformance checks up to that level (default: the `level` in `swarm.json`) and changes nothing.

**The contract lives in [INTEGRATION.md](../../INTEGRATION.md)**: the `swarm.json` manifest (§1), what each command
must guarantee (§2), stack equivalents (§4), agents without plugins (§5) and the conformance checks (§6). Read the
section a step names; do not restate it to the user.

## The gates

1. **A level is adopted only on top of conformant lower levels.** Before applying level N, run `--check` for N−1.
   Any failure → stop and report it; fix that level first.
2. **`swarm.json` is the adoption marker.** Its `level` rises only after `--check N` passes, never by hand.
3. **Merge, never overwrite.** Read every destination file before writing it (`CLAUDE.md`, `.claude/settings.json`,
   CI, `.gitignore`). Keep what the repo has; add what is missing; show the diff.
4. **Never relax an existing gate.** If the repo is stricter on something, the repo wins.
5. **Every step ends with its evidence** (command and output). A failed check stops the run.

Why: an adoption that pastes templates over a working repo breaks its CI and loses its rules; a level claimed but
not working teaches the team to ignore the protocol (chapter 16 §0).

## When not to use it

- Answering how the protocol works: `playbook` skill.
- A repo the user did not ask to change: offer `--check`, which writes nothing.

## Modes

### `--check [level]`

Run every check in INTEGRATION.md §6 for levels 0…level, in order. Write nothing. Output exactly the §6 format: one
line per check with `✓`/`✗`, its id, name and evidence, then
`result: level N conformant; level N+1 blocked by <ids>`. Also report when the project's `version` is behind the
plugin's (`${CLAUDE_SKILL_DIR}/../../.claude-plugin/plugin.json`).

### `--plan` and apply

```
- [ ] 1. Own worktree (`adopt-<level>`), never the main checkout
- [ ] 2. --check of the level below (skip for level 0)
- [ ] 3. Detect (write nothing)
- [ ] 4. Plan: scenario, commands, what is not adopted (stop here with --plan)
- [ ] 5. Apply the level (details in levels.md)
- [ ] 6. --check of this level; raise `level` in swarm.json only if it passes
- [ ] 7. One commit; integrate the repo's way; summary
```

3. **Detect.** In a table: language and package manager; lockfile; test runner and its single-file command; lint
   and type tools; integration branch (`git symbolic-ref refs/remotes/origin/HEAD`); CI files; existing
   `CLAUDE.md`, `AGENTS.md`, `.claude/`, `swarm.json`; monorepo or not; suite duration from CI; PR-based team or
   not (branch protection via `gh api repos/<owner>/<repo>/branches/<branch>/protection` if you have access). Do
   not read `.env`.
4. **Plan.** Pick the scenario A–F from chapter 16 §0 ("Real scenarios"). Map the stack to commands with
   INTEGRATION.md §4 and show the proposed `commands` block of `swarm.json`. Write
   `docs/adr/draft-adopt-agentic-coding-swarm-protocol.md` from the ADR template (context = what you detected; decision = level,
   scenario, commands; consequences; confirmation = the §6 checks; alternatives). With `--plan`: stop and ask the
   user to **confirm the commands and the scenario** in five lines or fewer.
5. **Apply.** Follow [levels.md](levels.md) for the level. Only that level.
6. **Check.** Run `--check <level>`. All green → set `"level": <level>` in `swarm.json`. Red → fix, or stop and
   report; never raise the level over a red check.
7. **Wrap up.** One commit: `feat(dev-flow): swarm protocol level <N>`. Integrate the repo's way (land at level 2+,
   otherwise its own PR flow). Summary: what was adopted, what was left out and why, the check output, and the
   baseline to measure in two weeks (chapter 16 §10). Suggest `/clear` before the next level.

## Red flags

| Thought | Reality |
| --- | --- |
| "Faster to do levels 0–2 in one go." | One level per session, each checked. A red level 0 makes level 2 meaningless. |
| "Copy `templates/CLAUDE.md` over theirs." | Merge. Their file holds rules you cannot see in the code. |
| "Paste the manual into `CLAUDE.md` so the agent knows the rules." | 35–40k tokens per turn. Under 200 lines, with pointers. |
| "Set the coverage floor at 90 %, it is good practice." | Measure first; floor 1–2 points below the measured value. |
| "Their CI is slow; skip it in verify." | verify mirrors CI. For slow suites use scenario B (quick locally, sharded queue in CI). |
| "Install the publisher pre-push for this PR team." | Scenarios D and E use branch protection instead. |
| "Enable the scheduled reviews while I am here." | They spend money and send code to a model: ask explicitly first. |
| "The check is almost green; raise the level anyway." | `level` means conformant. Fix the check or leave the level. |

## Output

```
adopt: level <N> · scenario <A–F> · <plan | applied | check only>
swarm.json: commands verify="<…>" verifyQuick="<…>" … · level <old> → <new>
check: <the §6 output, verbatim>
not adopted: <item — reason>
```

Depth: [levels.md](levels.md), [ADOPTION.md](../../ADOPTION.md), [chapter 16](../../manual/16-efficiency-and-real-world-use.md) §0.
