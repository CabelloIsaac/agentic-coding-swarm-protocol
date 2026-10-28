---
name: adopt
description: Adopts the Swarm Protocol in the current repository one level at a time (0 to 3), writing and maintaining swarm.json, merging the templates into what the repo already has, and proving each level with the conformance checks, plus the separate transferability track (X1–X5); --check reports conformance and version drift without changing anything. Use only when the user explicitly asks to adopt, install, upgrade or check the protocol in a repo.
disable-model-invocation: true
argument-hint: "[0|1|2|3|transfer] [--plan] | --check [level|transfer]"
---

# adopt

Say at the start: "Using adopt (<level>, <plan|apply|check>)."

Arguments: `$ARGUMENTS`. A level number (default `0`), or `transfer` for the transferability track; `--plan`
writes the plan and stops; `--check [level]` runs the conformance checks up to that level (default: the `level` in
`swarm.json`) and changes nothing; `--check transfer` runs the X1–X5 checks and changes nothing.

**The contract lives in [INTEGRATION.md](../../INTEGRATION.md)**: the `swarm.json` manifest (§1), what each command
must guarantee (§2), stack equivalents (§4), agents without plugins (§5) and the conformance checks (§6). Read the
section a step names; do not restate it to the user.

## The gates

1. **A level is adopted only on top of conformant lower levels.** Before applying level N, run `--check` for N−1.
   Any failure → stop and report it; fix that level first.
2. **`swarm.json` is the adoption marker.** Its `level` rises only after `--check N` passes, never by hand.
3. **Merge, never overwrite.** Copy only the level-N group of rules from `templates/CLAUDE.md`, and only the rules
   that are true for this repo today. Read every destination file before writing it (`CLAUDE.md`, `.claude/settings.json`,
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

The mechanical checks are a script, not your judgement: two agents must reach the same level.

1. Run `node ${CLAUDE_SKILL_DIR}/../../scripts/check-conformance.mjs --repo . --level N` (N = the level asked for,
   default the `level` in `swarm.json`; `--all` for levels 0-3 plus transfer). It prints one line per §6 check:
   `✓` proven, `✗` failed (with what is missing), `?` needs judgement (with what to verify), then the version line
   and `result:`. Exit 0 means every mechanical check passed; 1, that one failed; 2, no manifest.
2. Resolve only the `?` lines, each by doing exactly what its line says (run the command, time it, read the CI
   run, read the audit date). A `✓` or `✗` is final: do not re-judge it, and do not run checks the script already ran.
   `✓` lines marked "structure only" prove the file exists; confirm what they defer to in the L1.1 verify output.
3. Report the script's output verbatim, then one verdict line per `?` (`✓`/`✗` and its evidence), then
   `result: level N conformant; level N+1 blocked by <ids>`. Write nothing.

`level` in `swarm.json` may rise only when the script exits 0 **and** every `?` line is resolved as pass. A
failed script or an unresolved `?` leaves it where it is.

**Version check, every `--check`.** The script prints the line `version <v> = plugin` or `behind`/`ahead` (plugin
version from `${CLAUDE_PLUGIN_ROOT}`, else this plugin's own manifest); you act on it as below. Without the script, read the plugin's `version` from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`,
or, when that variable is unset, `${CLAUDE_SKILL_DIR}/../../.claude-plugin/plugin.json`; without the plugin, read
`.claude-plugin/plugin.json` of your checkout of the protocol repo. Compare it with `version`
in `swarm.json` as semver and add one line before `result:`:

| Project vs plugin | Line |
| --- | --- |
| equal | `✓ version <v> (plugin <v>)` |
| behind (older minor or patch) | `! version <p> behind plugin <v>: new checks or keys may apply · https://github.com/AntoniArco/agentic-coding-swarm-protocol/blob/main/CHANGELOG.md` and the CHANGELOG headings between the two versions (`${CLAUDE_SKILL_DIR}/../../CHANGELOG.md`). |
| behind by a major | as above, plus "read the migration note before raising `version`". |
| ahead of the plugin | `✗ version <p> newer than plugin <v>: claude plugin marketplace update agentic-coding-swarm-protocol`. On a newer major, stop: run no checks (INTEGRATION.md §1). |

Being behind is reported, never fixed by `--check`: raising `version` is an adoption step done with `--plan`.

### `--check transfer`

Run `node ${CLAUDE_SKILL_DIR}/../../scripts/check-conformance.mjs --repo . --transfer`. X3 and X5 are fully mechanical; X1 and X2 are
`✓` for their structure only, so for those two you still read the latest CI run, and X4 is a `?`. Write nothing; read CI state with
`gh run list --workflow <file> --limit 1 --json conclusion,createdAt` when `gh` is available, and say "not
verifiable here" (✗) when it is not. Output the same format, ending with
`result: absorbable` or `result: not absorbable; blocked by <ids>`. This track is independent of `level`: never
raise or lower `level` from it.

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
5. **Apply.** Follow [levels.md](levels.md) for the level. Only that level. For `transfer`, its own section in
   levels.md; it needs a green level 1 (a working `verify`), not a higher level.
6. **Check.** Run `--check <level>`. All green → set `"level": <level>` in `swarm.json`. Red → fix, or stop and
   report; never raise the level over a red check.
7. **Wrap up.** One commit: `feat(dev-flow): swarm protocol level <N>`. Integrate the repo's way (land at level 2+,
   otherwise its own PR flow; without `land` or a remote, see levels.md "Integrating the adoption itself": commit on a
   branch and merge with `--ff-only` after `verify`, never commit on the integration branch). Summary: what was adopted, what was left out and why, the check output, and the
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
| "Level 3, so it is easy to hand over." | Levels do not prove transferability. Only `--check transfer` does. |
| "I will fill the runbook from what I can infer." | Placeholders the team must answer stay as questions to the user; a guessed rollback is worse than none. |

## Output

```
adopt: level <N> · scenario <A–F> · <plan | applied | check only>
swarm.json: commands verify="<…>" verifyQuick="<…>" … · level <old> → <new>
check: <the §6 output, verbatim>
not adopted: <item — reason>
```

Depth: [levels.md](levels.md), [ADOPTION.md](../../ADOPTION.md), [chapter 16](../../manual/16-efficiency-and-real-world-use.md) §0.
