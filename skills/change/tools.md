# Mapping the lifecycle onto another spec tool

The gates and the red flags do not depend on the tool. What changes is where each artifact lives and which command
does each phase. OpenSpec is the default because its validator fails on missing scenarios and its archive merges
deltas into living specs; any tool works if you can answer every row of the table.

| Concept | OpenSpec (default) | What you need elsewhere |
| --- | --- | --- |
| One change | `openspec/changes/<name>/` | one folder or branch-scoped document set per change |
| Problem, outcome, alternatives | `proposal.md` | the same sections in whatever the tool calls the brief or requirements file |
| Behavior | `specs/<capability>/spec.md` delta, Requirement + WHEN/THEN Scenario | requirements with acceptance scenarios (Given/When/Then, EARS "WHEN … THE SYSTEM SHALL …") |
| Decisions | `design.md` | a design or plan file; structural decisions still go to an ADR |
| Work | `tasks.md` checkboxes | a checklist in the repo; issues in a tracker are fine for outside-the-repo work only |
| Validate | `openspec validate <name> --strict` | a script that fails when a requirement has no scenario or a task has no check, run inside `verify` |
| Living specs | `openspec/specs/` updated by `archive` | a folder of current specs per capability, updated when the change closes |
| Archive | `openspec archive <name> -y` | move the change to a dated archive folder and update the living specs in the same commit |
| Order and priority | `openspec/roadmap.yaml` + the roadmap command | one roadmap file with derived status and a validator (`reference/scripts/roadmap.ts`) |

## Examples

These tools change quickly; check their current documentation before relying on a command name.

- **GitHub spec-kit.** A feature folder holds the spec, the plan and the tasks. Map spec → specs, plan → design,
  tasks → tasks. It has no delta merge into living specs: add the archive step yourself (copy the final
  requirements into a per-capability spec and move the feature folder to an archive).
- **Kiro-style specs** (`requirements.md`, `design.md`, `tasks.md` per feature, EARS requirements). Add the proposal
  sections (evidence, outcome, alternatives) at the top of `requirements.md`, and the archive step as above.
- **No tool: plain Markdown.** `docs/changes/<name>/` with the four files from `templates/openspec/`, a small
  validator in the gate (every `### Requirement:` followed by a `#### Scenario:`; every task line names a check),
  and `docs/changes/archive/`. This is enough for levels 2–3 of the protocol.

## What not to drop when switching tools

- Evidence with source and date, and "do nothing" among the alternatives.
- Scenarios that are testable without keys, each mapped to a task that writes its test.
- Validation inside the full gate, not run by hand.
- The archive step that updates living specs and writes their Purpose.
- The `(outside the repo)` marker with owner and tracker.
