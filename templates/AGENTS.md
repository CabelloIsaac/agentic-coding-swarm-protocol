# AGENTS.md

Rules for every coding agent in this repository (Codex, Cursor, Aider, CI runners, Claude Code). The full rules are
in [CLAUDE.md](CLAUDE.md); the commands are in `swarm.json`. This repository follows the
[Agentic Coding Swarm Protocol](https://github.com/AntoniArco/agentic-coding-swarm-protocol).

## Session protocol

Agents with Claude Code hooks get steps 1 and 3 automatically. Everyone else does them by hand.

1. **Start in your own worktree and branch.** Never edit or commit in the main checkout.
   `git worktree add ../<repo>-<task> -b <task>`, then run `hooks.sessionStart` from `swarm.json`.
2. **Iterate** with `commands.verifyQuick`. It never closes a task. Every few commits, run `commands.overlap` (if
   present): another session touching your files is cheaper to find now than at land.
3. **Before you stop, every time, commit.** There is no automatic `wip:` commit without hooks. Record each decision
   taken without asking as a trailer: `Assumption: <what> — <why>`.
4. **Finish** with `commands.verify` (the same as CI) and show its output. Ask for an independent review of the
   diff. Then integrate with `commands.land` (or open a PR). On conflict, rebase your branch and repeat.

## Never

- Weaken a quality gate (coverage floor, lint rules, architecture or docs tests, CI) to make a change pass.
- Read or print secrets, or run commands that spend real money outside the main checkout.
- Push to `<integration branch>` directly or force-push.
