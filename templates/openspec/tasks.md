## 0. Baseline

- [ ] 0.1 Measure the baseline for the outcome (command or query and its value, with the date)

## 1. <Group>

- [ ] 1.1 <Verifiable task> — verification: `pnpm vitest run <path>` green with case <x>
- [ ] 1.2 <Verifiable task> — verification: `<command>` returns <y>

## 2. <Group>

- [ ] 2.1 …

## 3. Documentation and wrap-up

- [ ] 3.1 ADR (`docs/adr/draft-<slug>.md`) if a contract or an invariant changes
- [ ] 3.2 Area architecture doc, README (new commands), `docs/extending/` guide if applicable
- [ ] 3.3 `CLAUDE.md` if a working rule changes
- [ ] 3.4 Full `pnpm verify` green (paste the last line)
- [ ] 3.5 Independent review (`reviewer`; `security-reviewer` if it touches sensitive paths)
- [ ] 3.6 Real-world test: <scenario>
- [ ] 3.7 Measure the outcome after <N> weeks and compare it with 0.1
