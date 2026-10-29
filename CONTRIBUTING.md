# Contributing

Thanks for helping make agent-assisted engineering more reliable. This playbook improves through real incidents and
real adoption reports, so the best contributions come with evidence.

How the protocol is governed (owner, review of gate changes, versioning, releases, rollout across a company) is in
[MAINTAINING.md](MAINTAINING.md). The fastest way to turn an incident into a contribution is the `learn` skill
(`/swarm:learn`): it drafts the issue or PR body in the format below, and sends nothing without your confirmation.

## What we welcome

- **New anti-patterns** with the symptom, the incident behind it and the fix that worked.
- **Adoption reports**: which level you adopted, in which scenario, what broke, and what the metrics did.
- **Corrections** to rules that no longer match current tooling (Claude Code, Codex and others move fast).
- **New templates** for other stacks (Python, Go, Java) that keep the same mechanisms.

## Ground rules

1. **Every rule needs a reason and a mechanism.** State why it exists and what enforces it (hook, test, script), or
   mark it explicitly as a preference.
2. **Evidence over opinion.** Numbers, incidents and links beat adjectives. Anonymize anything from private code.
3. **Keep the context budget.** `skills/playbook/rules.md` stays one page. Skill and agent descriptions stay short:
   they are loaded on every turn.
4. **Designed ≠ enforced.** Say which one a practice is.
5. **No secrets, no customer data, no proprietary code.**

## How to submit

1. Fork and branch (`docs/<topic>` or `feat/<skill>`).
2. Run the checks:

   ```bash
   node scripts/check-links.mjs
   node scripts/check-version.mjs
   node scripts/check-evals.mjs
   node --test 'scripts/*.test.mjs'
   claude plugin validate .
   node --test 'reference/self-test/*.test.ts'
   ```

   CI runs the same six on every push and pull request.

3. Open a pull request describing the problem, the evidence and the change. Update `CHANGELOG.md`.

## Self-tests of the reference implementation

The scripts in `reference/scripts/` pass their own gate. `reference/self-test/` runs them as real subprocesses
against throw-away repositories (a bare remote, a main clone marked as publisher with the versioned `pre-push`
hook, and a linked worktree on a feature branch), so `land`, `wt`, `verify` and `adr` are tested the way hooks and
people run them.

- **Requirements:** Node 24 or later (it runs TypeScript directly) and git. No `npm install`: the tests use only
  `node:test` and other built-ins.
- **Run:** `node --test 'reference/self-test/*.test.ts'` (quote the glob; Node expands it). One file:
  `node --test reference/self-test/land.test.ts`.
- **Isolation:** `reference/self-test/helpers.ts` ignores your global git config and identity, and every fixture
  lives in its own temp folder, deleted after the test.
- **Configuration:** the scripts read `DEV_FLOW_CONFIG=<path to a JSON file>` and merge it over the defaults in
  `reference/scripts/dev-flow.config.ts` (objects key by key; arrays and scalars replaced; `RegExp` keys keep their
  defaults). `MYPROJECT_LAND_VERIFY="<command>"` replaces the verification inside `land`.
- **When you change a script:** add or update its test in the same pull request. A fix to `land` comes with a test
  that fails without it, like the `AUD-land-sha-no-fijado` regression in `land.test.ts`.
- **Conformance checker:** `node --test 'scripts/*.test.mjs'` runs `scripts/check-conformance.mjs` (the mechanical half of
  `/swarm:adopt --check`) against throw-away repositories built from `templates/`; change a §6 check and its test together.
  The same glob runs `scripts/check-version.mjs` (every place that states the version agrees with `plugin.json`).
- **Type-check** (optional, needs `typescript` and `@types/node`): `npx tsc --noEmit --allowImportingTsExtensions
  --module nodenext --target es2023 --strict --noUncheckedIndexedAccess --skipLibCheck --types node <files>`.

## Skill evals

`evals/` holds the plugin's eval suite in the format of `claude plugin eval`
([docs](https://code.claude.com/docs/en/plugin-evals)).

- `evals/trigger/<skill>/`: one case per prompt for the core skills. Positive cases assert that the skill fires
  (`tool_used: Skill`); negative ones assert that it does not (`min: 0`, `max: 0`). `land` is user-invoked only
  (`disable-model-invocation`), so its positive cases type `/swarm:land` and its negative ones check that natural
  phrasing never fires it.
- `evals/behavior/`: what a skill does once it fires, on a fixture repo built by `fixture.sh`: verify answers with
  the evidence block (green and red), review dispatches the reviewer and the security-reviewer, tdd writes the test
  before the fix.

Every run is a real model call billed to whoever runs it. There is no free local mode.

- **Free check:** `node scripts/check-evals.mjs` checks that every case loads and that each core skill keeps 3
  positive and 2 negative prompts.
- **Iterate on one case:** `claude plugin eval . --case '<name>' --runs 1 --ablation none`.
- **Trigger suite:** `claude plugin eval . --tag trigger --ablation none --runs 3 --max-cost-usd 10`.
- **Behavior suite:** it needs its fixtures and tool grants: `claude plugin eval . --tag behavior --ablation none
  --scaffold --allow-tools Write Edit "Bash(node verify.mjs*)" "Bash(node --test*)" "Bash(git *)" "Bash(tail *)"
  "Bash(uptime)"`. Only pass `--scaffold` for suites you have read.
- **CI:** the `evals` workflow runs only by hand (`workflow_dispatch`) and only when the repository has an
  `ANTHROPIC_API_KEY` secret. It takes a tag, the runs per case, a cost ceiling and the model.
- **When you change a skill's description:** add a prompt that should fire it and one that should not, and run that
  skill's tag before and after.

## Style

English, short sentences, active voice. Tables for parallel items, fenced blocks for commands. One chapter per topic,
opening with a bold **Rule:** line and closing with "What to copy into your repo".
