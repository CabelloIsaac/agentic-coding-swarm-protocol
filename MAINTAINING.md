# Maintaining the protocol inside a company

**Rule:** one repository, one owner, versioned releases, a pilot before every rollout, and every incident that
teaches something comes back as a PR with its evidence. A protocol that each team copies and edits stops being one
protocol within a quarter.

## 1. Single source of truth

- **This repository is the only source.** The manual, the plugin (skills, agents, hooks), the templates, the
  reference implementation and the conformance checks live here and nowhere else.
- **Downstream copies are forbidden.** No team pastes the manual into a wiki, forks the skills into
  `.claude/skills/`, or keeps a private "improved" `land`. A copy diverges silently and never receives fixes (the
  0.2.0 `land` fix that integrated an unverified SHA reached only the projects that consumed the plugin).
- **Projects consume it as a plugin plus templates.** The plugin is installed from the marketplace and declared in
  each project's `.claude/settings.json` (manual [chapter 16](manual/16-efficiency-and-real-world-use.md) §0).
  Templates are copied once at adoption and then belong to the project; `swarm.json` records which protocol version
  they came from, and `/swarm:adopt --check` reports when that is behind.
- **One plugin, sourced from the repository root.** The skills read the manual, the templates and the reference code
  through `${CLAUDE_SKILL_DIR}/../../`, and Claude Code installs a plugin by copying only its own directory. Splitting
  the plugin (for example a `core` and a `governance` plugin under `plugins/`) would ship the skills without the
  knowledge they cite, or force a second copy of ~400 KB that drifts. Decided against in 0.3.0; revisit only if the
  plugin system gains shared files between plugins.
- **A company fork is allowed only as the single source for that company**, with the same rules: one fork, one
  owner, upstream changes merged at each release, local changes proposed upstream when generic.

## 2. Ownership and review

- **A playbook owner** (one named person, with a deputy) reviews every change to this repo, decides releases and
  chairs the pilot. Listed in the company's CODEOWNERS for this repo and for the gate paths in each project
  ([templates/CODEOWNERS](templates/CODEOWNERS)).
- **Changes to gates need two approvals: the playbook owner and one engineer from a team that uses the protocol.**
  A gate is anything that decides pass/fail: `INTEGRATION.md` §2 guarantees and §6 checks, `verify` and `land`
  in `reference/`, the hooks, the CI templates, the docs and architecture test templates, and every skill's gate
  section. A change that relaxes a gate also needs an ADR-style rationale in the PR and a migration note.
- Everything else (wording, a new anti-pattern row, a stack equivalent) needs the owner's approval only.
- The owner does not write most changes. Teams do, through the loop in §5.

## 3. Versioning and releases

Semantic versioning on `.claude-plugin/plugin.json` `version`, mirrored by the `version` that projects record in
`swarm.json`.

| Bump | When | Examples |
| --- | --- | --- |
| **major** | a project that passed its checks may fail them, or must change files, to stay conformant | a §2 guarantee tightened; a check added to an existing level; a `swarm.json` key renamed or made required; a skill removed |
| **minor** | new capability that existing projects can ignore | a new skill, template, optional key, conformance track (X1–X5), manual chapter; a new check in a new, opt-in track |
| **patch** | no change to what passes or fails | wording, links, a bug fix in a reference script or hook that restores documented behavior |

A bug fix that makes a gate stricter (the `land` SHA fix) is a patch only if the documented guarantee already said
so; otherwise it is minor or major by the table above.

### Release checklist

- [ ] Every change since the last release has a `CHANGELOG.md` entry under `Unreleased`, in Keep a Changelog
      sections (Added, Changed, Fixed, Removed, Security), each saying **what a project must do**, if anything.
- [ ] A major has a `### Migration` section: the exact steps and the `--check` that proves them.
- [ ] `node scripts/check-links.mjs` and `claude plugin validate .` pass.
- [ ] The pilot (§7) ran this version for at least a week, with its `--check` output attached to the release PR.
- [ ] `version` bumped in `.claude-plugin/plugin.json`, the template `templates/swarm.json`, and the examples in
      `INTEGRATION.md`.
- [ ] `Unreleased` renamed to `[x.y.z] — <date>`; tag with `claude plugin tag .` (creates `swarm--vX.Y.Z` after
      checking that `plugin.json` and the marketplace entry agree); release notes = the changelog section.
- [ ] Announcement to the teams: what changed, whether they must act, the update command (§4).

### Changelog discipline

- One entry per user-visible change, written for the person who has to act on it, not for the author.
- Link the evidence: the incident, the audit id or the issue from the `learn` skill.
- Nothing merges to `main` without its changelog line. The release is then a rename, not an archaeology session.

## 4. How teams receive updates

Each developer, or a scheduled job on shared machines:

```bash
claude plugin marketplace update agentic-coding-swarm-protocol
claude plugin update swarm@agentic-coding-swarm-protocol
```

Then, in each project, `/swarm:adopt --check` shows whether the project's `swarm.json` is behind and links the
changelog; raising `version` there is a normal adoption step (`/swarm:adopt <level> --plan`).

**Org-wide pinning with managed settings.** IT or the platform team ships a managed settings file (the
`managed-settings.json` that Claude Code reads with the highest precedence) that adds the marketplace, pinned to a
release tag, and forces the plugin on:

```json
{
  "extraKnownMarketplaces": {
    "agentic-coding-swarm-protocol": {
      "source": { "source": "github", "repo": "AntoniArco/agentic-coding-swarm-protocol", "ref": "swarm--v0.3.0" }
    }
  },
  "enabledPlugins": { "swarm@agentic-coding-swarm-protocol": true }
}
```

Moving the pin is the rollout (§7): the pilot team's machines get the new tag first, everyone else after the pilot
passes. Check the current Claude Code settings documentation for the managed-settings location on each OS and for
marketplace restrictions (allow-listing only this marketplace).

## 5. The incident → learn → PR loop

1. An incident in a project is fixed there first (`debug`, `tdd`, `verify`).
2. The team runs the `learn` skill: a rule with a mechanism (or an explicit `preference` label) in the project, as a
   change or an ADR draft.
3. If the lesson is generic, `learn` drafts an issue or PR for this repo; the team reviews and sends it.
4. The playbook owner triages weekly: accepted lessons become an anti-pattern row (manual chapter 11), a gate, a
   check or a template change, released by §3. Rejected ones get a reason in the issue.
5. The next release reaches every project; `--check` tells each team whether it must act.

The measure of the loop: time from a lesson's issue to its release, and how often the same incident recurs in
another team after release (target: never).

## 6. Measuring across teams

Every project already produces the inputs: its audit report (manual [chapter 09](manual/09-periodic-audit.md)) with
the "Protocol vs project" section, and `/swarm:adopt --check` output. The owner collects them monthly in one table:

| Team · project | Protocol version | Level | Protocol score | T-checks | Detection latency (median days) | Lands without conflict | Integration-branch CI failures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `<team · repo>` | `0.3.0` | 2 | 21/21 | 4/5 | 3 | 96 % | 0 |

- **Protocol score:** passed checks over applicable checks for levels 0 to the project's level, from the audit's
  protocol section (`level 0 → 5/5 · level 1 → 5/5 …`), plus X1–X5 as a separate column.
- **Detection latency:** for each High or Medium audit finding, the days between the commit that introduced it
  (`git log -S` or the blamed commit named in the finding) and the gate, review or audit that first reported it.
  Report the median per project. Falling latency means the gates are moving detection earlier; rising latency means
  findings are being caught by audits that a gate should catch, which is a `learn` candidate.
- Compare teams to find what to spread, not to rank people: a team with low latency has a mechanism others lack.
  Trends per team matter more than absolute values.

## 7. Pilot before rollout

No release reaches every team at once.

1. **Pilot:** one volunteer team and one real repo run the release candidate (pinned by tag) for at least one week,
   two for a major. Measure the baseline before (manual chapter 16 §10).
2. **Pass criteria, written before the pilot starts:** `--check` green at the team's level, no rise in integration
   failures or land duration beyond an agreed margin, no gate bypassed (`--no-verify`, skipped tests) to cope.
3. **Rollback criterion, also written first:** what result returns everyone to the previous tag.
4. **Expand** by moving the managed-settings pin, team by team for a major, all at once for a minor or patch that
   passed the pilot.
5. Pilot findings go through §5 like any incident, before the release is tagged.
