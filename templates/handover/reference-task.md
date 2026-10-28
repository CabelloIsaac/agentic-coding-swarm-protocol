# Reference task · <project>

<!-- acceptance: <command that exits 0 only when the task is done, e.g. pnpm vitest run src/orders/orders.test.ts> -->

The task an agent with no prior context, and only this repository, must be able to complete. It runs weekly in CI
(`.github/workflows/new-agent-test.yml`) and live in every handover session. Owner: `<team handle>`.

Copy to `docs/handover/reference-task.md`. Change it only through a change, like any other test. The HTML comment
on the first lines is the acceptance command the workflow runs after the agent finishes; keep it on one line.

## Choosing the task

- **Typical:** what a new team member does in the first week (a field end to end, a new instance of the most common
  extension kind, a new validation rule), not a toy.
- **Small:** under 30 agent turns and a diff of a few files. A task that needs hours tests stamina, not the docs.
- **Touches the gate:** it needs a test, a docs update and, ideally, a registry or contract entry, so the agent must
  find the extension guide and the docs test.
- **No secrets, no spend:** it runs in mock or replay mode.
- **Its solution is not in the repo.** Keep the expected diff outside (a private gist, the handover folder of the
  owning team) so the agent cannot copy it.

## Task

<Two to five sentences, written for someone who has never seen the repo. Say what the user-visible result is, not
how to build it. Do not name files the docs should lead to: finding them is part of the test.>

Example: "Orders can carry an optional gift message of up to 200 characters. It is accepted by the create-order
command, stored, returned by the order query and shown in the order summary. Invalid messages are rejected with the
same error format as other validation errors."

## Done when

- [ ] The acceptance command above exits 0.
- [ ] `commands.verify` from `swarm.json` exits 0.
- [ ] The docs that describe the touched area mention the change (the docs test passes).
- [ ] Everything is committed on the working branch; nothing is pushed.

## Report the agent must write (`handover-report.md` at the repo root)

1. **What I did:** the files changed, one line each.
2. **How I found my way:** the files I read to learn how to do it, in order.
3. **What was missing or wrong:** docs that did not exist, were ambiguous, or contradicted the code; commands that
   did not work as documented.
4. **What I would have asked a person:** every question, even the ones I answered by guessing, each with the
   guess I made.

Each item in 3 and 4 becomes a docs fix (or a `learn` entry) before the next run.
