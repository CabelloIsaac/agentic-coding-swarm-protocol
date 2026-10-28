# Contributing

Thanks for helping make agent-assisted engineering more reliable. This playbook improves through real incidents and
real adoption reports, so the best contributions come with evidence.

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
   claude plugin validate .
   ```

3. Open a pull request describing the problem, the evidence and the change. Update `CHANGELOG.md`.

## Style

English, short sentences, active voice. Tables for parallel items, fenced blocks for commands. One chapter per topic,
opening with a bold **Rule:** line and closing with "What to copy into your repo".
