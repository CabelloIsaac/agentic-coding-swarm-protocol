# review briefs

Fill the placeholders and send each brief as the agent's prompt. The agent sees nothing of your conversation, so the
brief is all it knows. Do not add your assessment of the change. `<catalog>` is the absolute path of the defect-class
catalog resolved in step 3 of the skill.

## reviewer

```
Review the branch <branch> in the worktree <absolute path>. Read-only: do not edit, commit or run anything that
writes outside the verify logs.

Diff: git diff <base-sha>...<head-sha>   (commits: git log --oneline <base-sha>..<head-sha>)
Spec: <openspec/changes/<name>/specs/… and tasks.md | ADR path | the three-line intended behavior below>
<intended behavior, if there is no written spec>

Check, against the spec:
1. Every requirement is implemented and every scenario has a test that would fail without the code.
2. Correctness: edge cases, error paths, missing await, races, external effects without idempotency, writes that
   bypass the designated write path.
3. Repo rules from CLAUDE.md: invariants and their tests, no weakened gate (.skip, .only, lowered thresholds,
   suppressions without a reason, new allowlist entries without a doc update), docs updated in the same change.
4. Test quality: assertions on behavior, no mock-of-the-mock, no network or keys, temp files cleaned up.
5. Defect classes: read <catalog> and check the diff against every class marked "diff"; also check it against the
   project's invariants table (the path CLAUDE.md names, or docs/architecture*).
Run the repo's lint, typecheck and tests yourself (commands in swarm.json or CLAUDE.md); do not reason about them.
Ignore style.

Output, per finding: [DC id if one fits] · file:line · problem · concrete failure scenario · proposed fix ·
confidence. Only findings you would bet on. If everything holds, one line with the commands you ran and their results.
```

## security-reviewer

```
Security review of the branch <branch> in the worktree <absolute path>. Read-only.

Diff: git diff <base-sha>...<head-sha>
Sensitive areas touched: <auth | secrets/config | external input | personal data | external effects |
LLM tools or prompts | CI workflows | dependencies>
Spec: <path or three-line intended behavior>

Report only issues this diff introduces that an attacker could exploit: injection, SSRF, auth or authorization
bypass, secrets in code or logs, personal data exposure, unbounded spend or effects, prompt injection reaching a
tool with side effects, unsafe dependency changes. For new dependencies, check the advisory database
(`<package manager> audit --prod` or equivalent). Check the diff against the DC-SEC-*, DC-SPEND-* and DC-IDEM-*
classes of <catalog> marked "diff".

Output, per finding: severity (high/medium/low) · DC id if one fits · file:line · exploit steps · impact · fix ·
confidence.
No best-practice gaps, no pre-existing issues, no theory without a path to exploit.
```

## test-auditor

```
Audit the strength of the tests in the branch <branch>, worktree <absolute path>. Read-only.
Diff: git diff <base-sha>...<head-sha>. Logic under test: <files>. Spec: <path or intended behavior>.
Find tests that would still pass with a broken implementation, assert nothing useful, test the mock, or leave new
branches and error paths uncovered (DC-TEST-* in <catalog>). Highest risk first, each with file:line, the mutation
that survives and the DC id if one fits.
```

## architect (only when a finding needs a design decision)

```
Problem: <one paragraph>. Context: branch <branch>, worktree <path>, diff <base>...<head>.
Constraints: <invariants, ADRs, spec>. Ruled out: <what and why>.
Return: options with trade-offs, one recommendation, a plan in verifiable steps, and whether an ADR is needed.
```
