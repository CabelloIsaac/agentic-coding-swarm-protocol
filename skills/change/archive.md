# Phase: archive

Validate, merge the delta specs into the main specs, move the change to the archive and leave the roadmap
consistent. Archive in your worktree; the result lands like any other commit.

## Preconditions (all of them)

```
- [ ] {spec} validate <name> --strict passes
- [ ] Every task is [x], struck with a reason, or marked (outside the repo) with owner and tracker
- [ ] The verify phase report has no critical issue (warnings accepted by the human, if any)
- [ ] Full {verify} green after the last edit
```

If one fails, stop and go back to the phase that owns it. Never archive "to clean up the list" with open work.

## Steps

1. **Preview the merge.** For each `specs/<capability>/spec.md` in the change, compare it with
   `openspec/specs/<capability>/spec.md`: which requirements are added, modified, removed or renamed. A MODIFIED
   block that lacks scenarios present in the main spec will delete them: fix the delta first.
2. **Archive.** `{spec} archive <name> -y`. It merges the deltas into `openspec/specs/` and moves the folder to
   `openspec/changes/archive/<YYYY-MM-DD>-<name>/`. If the target folder already exists, stop and ask.
3. **Write the Purpose.** Every main spec the archive created starts with a placeholder Purpose ("TBD"). Replace
   it with one or two sentences: what the capability is for and who relies on it. Then
   `grep -rln "TBD" openspec/specs/` must not list the specs you touched.
4. **Validate everything.** `{spec} validate --all` (non-interactive). The archive can break another active
   change whose MODIFIED block was written against the old main spec: fix that delta now.
5. **Roadmap.** Status is derived (`planned` = no folder, `active` = in `changes/`, `done` = in the archive), so do
   not write a status. Check instead:
   - the entry exists and its id matches the archived folder name;
   - changes marked `absorbed_by: <name>` are archived too, with a note in their proposal naming the absorber and
     their open tasks moved here or struck;
   - `{roadmap}` passes (it fails on unknown dependencies, active changes without an entry, frozen P0s).
6. **Record what stays open.** List every `(outside the repo)` task in the report, and make sure each one exists in
   the tracker it names. An archived change with untracked open work is how follow-ups disappear.
7. `{commit} "archive <name>: <one line on what shipped>"`, then `{land}` (user-invoked).

## Syncing without archiving

When a long-running change must publish its specs early (another change depends on them), merge by hand and keep
the change active. Rules:

- ADDED: add the requirement; if it already exists, update it to match.
- MODIFIED: apply the change and keep every scenario the delta does not mention.
- REMOVED: delete the whole requirement block.
- RENAMED: rename `FROM` to `TO`; keep the body.
- A new capability gets a main spec with a real Purpose and a Requirements section.
- Running the sync twice must give the same result.

## Archiving several changes at once

Group by capability first. When two changes have deltas for the same capability, read the code to decide which
ones are actually implemented: if both are, apply them oldest first; if only one is, archive that one and leave
the other active. Archive one at a time and validate after each. Report the order and why.

## Report

```
archive: <name> → openspec/changes/archive/<date>-<name>/
specs: <capability>: +2 requirements, ~1 modified · Purpose written for <new capability>
validate --all: ✓ · roadmap: ✓ (<id> now done; <absorbed id> archived as absorbed)
open outside the repo: 2.2 measure at 4 weeks (owner, tracker)
```
