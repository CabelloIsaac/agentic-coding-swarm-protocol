# Minimum rules for development agents

One page. If this is all you read, you will work well. Commands come from `swarm.json` at the repo root (`verify`,
`verifyQuick`, `commit`, `land`…); the names below are the pnpm fallbacks.

1. **One session, one worktree, one branch.** Never edit or commit in the main checkout. (`worktree` skill)
2. **Before you say "done":** full `verify` green after your last edit, with the command and its final line shown.
   The quick level is for iterating, never for closing. (`verify` skill)
3. **A bug is fixed with its test:** written first, seen red for the right reason, then green. (`tdd` skill)
4. **No fix without a proven root cause; two failed fixes → stop and escalate** to the `architect` agent or the
   human. (`debug` skill)
5. **Never weaken a gate to make something pass:** no `.skip`, no `.only`, no lowered thresholds, no suppressions
   without a reason, no allowlist entries without updating the documentation.
6. **Integrate only with `land`.** On conflict: `git rebase <integration branch>` on your branch, resolve, repeat.
   Never `merge`, `push`, `--force` or `--no-verify` by hand on the integration branch. (`land` skill)
7. **Documentation ships in the same change.** New contract, invariant or formula: a draft ADR. (`new-adr` skill)
   A new piece of a known kind follows its guide in `docs/extending/`; a new kind gets its guide. (`extend` skill)
8. **No secrets and no real spend** from a worktree; tests run without network or keys.
9. **What a command knows, ask the command** (types, lint, tests, metrics); do not reason about it.
10. **Cheap context:** symbols and line ranges before whole files; trim output to the tail; independent calls in
    parallel; one task per session; never `git stash` (the stack is shared across worktrees).
11. **Within scope, do not ask "should I continue?".** A product decision taken alone goes in the commit:
    `Assumption: <what> — <why>`. If you must ask (spend, irreversible, contract, out of scope), fill the card:
    Context · Challenge · Concern · Recommendation · Impact · Reversible · Evidence.
12. **After a non-trivial change, an independent review** by the `reviewer` agent; on sensitive paths also
    `security-reviewer`. (`review` skill)
13. **If a rule stops you, do not work around it:** propose the change (OpenSpec change + ADR).
14. **No behavior change without a spec-driven change**, and no archive with failing validation or unchecked tasks
    not marked "outside the repo". (`change` skill)
