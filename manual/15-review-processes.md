# 15 · Review processes: who looks at what, and how often

**Rule:** every risk layer has its own review, with a fixed cadence, an owner (person or agent), a versioned output
and a rule for what happens to its findings. No review fixes anything on its own: it reports, prioritizes and opens
a change.

Gates (`verify`, `land`, CI) answer "is it broken?". Reviews answer "is it right?", "is it degrading?" and "what are
we missing?". Without reviews, debt, production errors and security holes grow silently while every gate stays
green.

## The calendar

| Cadence | Review | Who | What it checks | Output |
| --- | --- | --- | --- | --- |
| **Every change** | self-review with evidence | the implementing agent | meets the spec; commands and outputs | summary with evidence in the session |
| **Every non-trivial change** | independent review | `reviewer` subagent or `/code-review` | correctness, regressions, missing tests, repo rules | findings with a failure scenario |
| **Every change on a sensitive path** | security review | `/security-review` or `security-reviewer` agent | auth, secrets, injection, SSRF, personal data, external effects | findings with severity |
| **Every land** | full gate | `land` + `verify` | everything CI runs, serialized, on the current base | JSONL record of the attempt |
| **Every T3 land** (designed) | human OK | tech lead | data, auth, spend, infra, the gates themselves, weakened tests | approval bound to file hashes |
| **Daily** | integration-branch and error health | scheduled `daily-health` agent | CI on `main`, new production errors, untriaged team feedback, failed lands | short report + proposed tasks |
| **Weekly** | quality sweep of the week's diff | scheduled `weekly-quality` agent | everything landed in 7 days: likely bugs, weak tests, duplication, complexity | `openspec/audits/<date>-weekly.md` |
| **Weekly** | dependencies and security | scheduled agent or CI | `pnpm audit --prod`, versions with CVEs, secrets in tracked files | section in the weekly report |
| **Biweekly** | global five-dimension audit | `audit-repo` skill | structure, harness, docs and process, scalability, security, with metrics and trend | `openspec/audits/<date>.md` + `.metrics.json` |
| **End of wave** | audit + roadmap review | human + skill | all of the above + nearly-done changes left unarchived, P2 work that slipped in, rollback criteria | report + updated roadmap |
| **Monthly** | review of the workflow itself | human | land metrics, interventions, cost per change, hooks and skills that add nothing | playbook adjustments (with an ADR if it is a decision) |
| **Quarterly** | ADR and invariant review | `architect` + human | ADRs no longer honored or that should be superseded; invariants without a test; exception lists | new ADRs / changes |

## 1. Per change: three looks

### Self-review with evidence

Before saying "done", the implementing agent shows the command and its output (`verify --quick`, the new test red
then green, the screenshot). It is mandatory and cheap. Without evidence, it is not done.

### Independent review (`reviewer`)

After any non-trivial change (more than one logic file, or anything in the core):

- It is done by a context that **did not watch the code being written**: the `reviewer` subagent (read-only; it
  runs lint, types and tests) or `/code-review`. A second session also works.
- **Against the spec, not in general:** "compare the diff with `openspec/changes/<x>/specs`; check that every
  requirement is implemented and every scenario has a test; report only what affects correctness; **ignore
  style**". A reviewer asked to find problems always finds something; fixing everything produces needless
  abstractions and tests for impossible cases.
- Format of each finding: `file:line` · problem · concrete failure scenario · proposed fix. If everything is fine,
  one line with the commands that prove it.
- The implementer decides what to fix; anything dismissed is recorded with a reason.

### Security review

Mandatory if the diff touches: auth and sessions, secrets and configuration, external input (webhooks, forms, URLs
the system fetches), personal data, external effects (publish, send, pay), new dependencies. Run
`/security-review` on the branch, or the `security-reviewer` agent (`agents/security-reviewer.md`). High-severity
findings block the land until they are resolved or a person accepts them in writing.

### Second opinion from another model (optional)

When Claude writes and Claude reviews, they share blind spots. On sensitive paths, a review by a different model
adds a different perspective. It requires a data policy first (which code leaves, and to whom). In the reference
project it is designed (`dev-second-opinion`) and blocked until a data policy exists.

## 2. Daily: health and errors (`daily-health`)

A scheduled, read-only agent, every working-day morning. Goal: nothing broken or new goes a day without someone
knowing. It checks:

1. **Integration-branch CI:** is the latest commit green? Is any job failing intermittently?
2. **Land log:** failed or conflicted attempts in the last 24 h, and why (the land log,
   `<git-common-dir>/<project>-land-log.jsonl`).
3. **Production errors:** new or rising errors in the error tracker (Sentry or equivalent; until you have one, the
   JSON logs and the admin health page), grouped by signature, with the suspect commit when there is one.
4. **Untriaged team feedback:** improvement reports the team files against the system itself; the agent lists what
   is still pending triage (see "The team-feedback loop" below).
5. **Worktrees and branches:** unlanded work older than 3 days (`wt:status --all`), divergence from the remote.

Output: a one-screen report (green / amber / red per section) with at most five proposed actions. It fixes nothing.
On red, it alerts (Slack or a notification).

### The team-feedback loop (what the daily review reads)

In an agent product, the people who watch its output (support, account managers, the team reviewing drafts) find
most of its quality problems. The reference project turns each of those notes into a tracked record with a closed
lifecycle, so feedback ends in a test or a decision and never in a chat thread:

1. **One record per report**, filed from a "Report an improvement" button, the CLI or a tool that exists only in
   the team's own chat (never in the customer-facing one). It names a `target` from a closed list (skill, playbook,
   activity, check, capability, prompt, persona, catalog), a category, a severity, and the **observed versus
   expected output**.
2. **Context is resolved by code, not typed by hand:** from a reference to the artifact (a draft, a decision, a run,
   a finding, an assistant message) the system recovers the run, the catalog version, the skills and playbooks
   involved, the channel and the observed output.
3. **State machine:** `open → triaged → in_change | bench_case | rejected → closed`. Every state change is a new
   event with the same id (append-only, `schema_version`, a human `actor`).
4. **Triage has exactly three exits:** a **bench case** (an anonymized candidate written in the same shape as the
   skill's examples file; business names, first names, emails, phones and links are scrubbed deterministically,
   without an LLM, because the bench is versioned in the repo; a person moves it into the skill inside a change), a
   **task in a change**, or a **rejection with a mandatory reason**.
5. **Closing is verified, not declared:** a scheduled maintenance job closes `bench_case` and `in_change` items only
   when the catalog fingerprint has changed *and* the evaluation bench passes.
6. **Metrics:** open items per target, days to close, and the share that became bench cases. The catalog validator
   flags bench candidates older than 30 days.
7. **The runtime never reads feedback to decide** (an architecture test forbids the agent runtime, capabilities and
   content generation from importing the feedback module; only that module opens its store). An unreviewed note
   must not become an unreviewed instruction to the agent: feedback changes behavior only through a reviewed change
   to the catalog or the bench.

## 3. Weekly: quality sweep (`weekly-quality`)

A scheduled, read-only agent, on Mondays. It reviews **only what landed in the last 7 days**
(`git log --since=7.days`, `git diff <sha-7-days-ago>..main`), because that is where new risk lives:

- **Likely bugs:** unhandled edge cases, swallowed errors, missing `await`, race conditions, external effects
  without idempotency, writes that bypass the designated write path.
- **Weak tests:** new tests without useful assertions, mocks that test the mock, added `.skip`/`.todo`, low branch
  coverage in touched files.
- **Structural erosion:** new entries in allowlists, new `biome-ignore`/`as unknown as`, files crossing 500 lines,
  duplication across modules.
- **Docs and decisions:** contract changes without an ADR, guides that do not reflect what is new.
- **Dependencies and security:** `pnpm audit --prod`, new dependencies, secret patterns.

Method: parallel subagents per touched area (a small-scale audit), and the main agent **verifies every
high-severity finding in the code** before writing it down. Output: `openspec/audits/<date>-weekly.md` with `AUD-*`
findings (same ids as the biweekly audit, so there is a single trend) and a "proposed order".

## 4. Biweekly: global audit

See chapter 09. Five dimensions, deterministic metrics with deltas, verified findings, "what is good (do not
break)" and a proposed order. `wt:setup` warns if the last audit is older than 14 days. Always before closing a
wave.

## 5. Monthly and quarterly: review the process and the decisions

- **The workflow (monthly, human):** land p50, % conflict-free, interventions per session and their type, cost per
  landed change, hooks that fire for no reason, skills nobody uses, `CLAUDE.md` rules that get ignored. Whatever no
  longer adds value is deleted (that is an improvement too).
- **ADRs and invariants (quarterly, `architect` + human):** accepted ADRs the code no longer honors, decisions that
  should be superseded, invariants without a test, exception lists that have not shrunk.

## How to schedule the agents

Three options, from least to most infrastructure:

| Option | When | How |
| --- | --- | --- |
| `/loop` in an open session | something to watch for hours (CI on a branch) | `/loop 15m check CI on this branch and…`; do not leave it running in a long conversation |
| Scheduled cloud task (`/schedule`) | daily and weekly reviews, with the laptop closed | cron routine, prompt from `templates/review/`, read-only, against the published repo |
| `claude -p` in cron or CI | when you want it on your own infrastructure | `claude --bare -p "$(cat templates/review/weekly-quality.md)" --allowedTools "Read,Grep,Glob,Bash(git *),Bash(pnpm audit:repo *)" --permission-mode dontAsk --max-turns 60` |

Rules for every scheduled review agent:

1. **Read-only.** Tools restricted in its definition; never `Edit`, never a push to the integration branch. Protect
   the branch with a rule the agent cannot bypass.
2. **Never spends.** No `.env`, mock modes only; no calls to paid APIs.
3. **Caps:** `--max-turns` and a budget. A review that never finishes is a bug in the review.
4. **Versioned output** (report in `openspec/audits/`) and an alert on red. A person or the next land integrates the
   report; the scheduled agent never integrates.
5. **Stable ids** (`AUD-*`) and comparison with the previous run: new / still open / resolved.
6. **Verify before asserting:** every high-severity finding is checked in the code; "suspected" and "confirmed" are
   kept distinct.
7. **Does not fix.** It proposes an order and, at most, a draft change for the first batch.
8. **Review its first runs** before you trust it unwatched.

## What to do with the findings

| Severity | Definition | Action | Deadline |
| --- | --- | --- | --- |
| High | breaks an invariant, real bug, exploitable, loses money or data | change or immediate fix; blocks the next land in that area | days |
| Medium | degrades quality or scalability, growing debt | enters the roadmap with priority | the current wave |
| Low | style, ordering, naming | recorded; fixed when someone passes by | none |

A review that reports the same thing three times in a row with nobody acting on it is either a review you do not
need or a misplaced priority: decide which one in the monthly review.

## Templates

- Agents: `agents/reviewer.md`, `agents/security-reviewer.md`, `agents/test-auditor.md`, `agents/quality-auditor.md`;
  `agents/debugger.md` and `agents/architect.md` when a review finds a failure whose cause is unclear.
- Prompts for the scheduled reviews: `templates/review/daily-health.md`, `templates/review/weekly-quality.md`.
- Scheduled review in CI: `templates/github/workflows/weekly-review.yml`.
- Biweekly audit skill: `skills/audit-repo/SKILL.md`.
- Checklist: `checklists/README.md` (section "Review calendar").
