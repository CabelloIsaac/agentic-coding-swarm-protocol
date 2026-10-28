# Prompt: weekly quality sweep (`weekly-quality`)

Suggested schedule: Mondays at 7:00. Uses the `quality-auditor` agent (`agents/`).
Tools: `Read, Grep, Glob, Bash(git *), Bash(pnpm audit:repo *), Bash(pnpm audit *), Bash(pnpm vitest run *)`.
Mode: `--permission-mode dontAsk --max-turns 80`. No `.env`. Read-only except for the report.

Example with the CLI:

```bash
claude --bare -p "$(cat templates/review/weekly-quality.md)" \
  --append-system-prompt "$(cat .claude/agents/quality-auditor.md)" \
  --allowedTools "Read,Grep,Glob,Bash(git *),Bash(pnpm audit:repo *),Bash(pnpm audit *),Write(openspec/audits/*)" \
  --permission-mode dontAsk --max-turns 80
```

---

Run the weekly quality sweep of what was integrated into `main` in the last 7 days, following your
`quality-auditor` instructions.

- Base: the last `main` commit older than 7 days (`git rev-list -1 --before=7.days main`).
- Compare with the previous weekly report and with the latest biweekly audit in `openspec/audits/`.
- Prioritize: what can lose money or data, what breaks an invariant, what weakens tests.
- Check every high finding in the code before writing it down.
- Write the report to `openspec/audits/<YYYY-MM-DD>-weekly.md` using the format in your instructions.
- End with a 5-line summary: status, the three most severe findings with their ids, the trend against the previous
  week, and whether you recommend opening a change now.

Fix nothing. Do not commit on `main`.
