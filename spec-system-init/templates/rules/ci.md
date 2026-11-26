# CI — docs-gate (guide for humans)

> **STOP.** This file applies only when setting up/debugging CI. Covers: docs-gate steps, branch protection, exit codes, troubleshooting, GitLab/Azure ports. Otherwise the brief/--help answer.

> Read when: configuring the repository/branch protection, when the docs-gate fails on a PR, or when porting the gate to GitLab/Azure.

CI is the universal enforcement floor: it reaches every dev, CLI and model — local hooks are a convenience; the gate is CI. Installed by init at `.github/workflows/docs-gate.yml` (Node 22). Every check calls the SAME code that runs locally (`scripts/specctl.mjs`) — what passes locally passes in CI.

**Protected branch name:** the workflow assumes `main` (main-gate `if: github.event.pull_request.base.ref == 'main'`). If the project uses another name (master, trunk…), change it there and in the branch protection rule.

## What runs on every PR (in this order)

| # | Step | Command | Validates |
|---|---|---|---|
| 1 | checkout | `fetch-depth: 0` | full history — without it the PR base cannot be determined |
| 2 | lint | `node scripts/specctl.mjs lint --strict` | folder structure; main.md fields/sections; folder↔status coherence (future/ included); journal (SNAPSHOT in the first 60 lines, LOG types); features (format, unique DEC-ids — NO size cap); TAXONOMY covers every feature; ROADMAP with no dead entries (warning); FR coverage when prd.md exists; budgets of the always-loaded layers (CLAUDE ≤6 KB, AGENTS ≤6.2 KB, RULES ≤5 KB, digest ≤2 KB — INDEX and features have no cap); generated INDEX, ARCHIVE-INDEX and DEFERRED are idempotent; secret-scan in docs/ (R.15) |
| 3 | diff audit | `node scripts/specctl.mjs audit --pr --base <event-base-sha>` | judges the DIFF: a SPEC that left active/ has a classified destination — archive → criteria closed/accepted + digest + R.7 by content; discard → rationale + digest; future → Paused at — and an incomplete close is BLOCKED; pipeline artifacts with no journal counterpart (warning) |
| 4 | dependencies | `node scripts/specctl.mjs audit --deps` | programs: nodes exist, no cycles, status×DAG coherence |
| 5 | main gate (PR → main only) | `node scripts/specctl.mjs audit --main-gate` | `docs/active/` empty after the merge (R.2) |
| 6 | index check | `node scripts/specctl.mjs index`, then fails if `git status --porcelain -- docs/INDEX.md docs/ARCHIVE-INDEX.md docs/PROGRAMS.md docs/DEFERRED.md` prints anything | the 4 committed indexes (INDEX, ARCHIVE-INDEX, PROGRAMS, DEFERRED) = exact regeneration (nobody hand-edited them, none is missing). `git status --porcelain` is used instead of `git diff --exit-code`, which misses untracked (never committed) index files |

**No push job on main.** Indexes are regenerated and committed inside the PR (step 6 enforces it), so `main` is always current at merge. A bot that pushes regenerated indexes directly to `main` is rejected by branch protection — do not add one; if you ever need it, have it open a PR instead.
**Weekly schedule:** full `audit` — staleness >30d (by content, never mtime), orphan claims, decisions >180d, ghost SPECs.

## Branch protection (mandatory — without it the gate is decorative)

GitHub → Settings → Branches → Add branch protection rule for `main` (or your protected branch):

1. Require a pull request before merging
2. Require status checks to pass before merging → select the `docs-gate` checks
3. (Recommended) Require branches to be up to date before merging

## Exit codes

| Code | Meaning |
|---|---|
| 0 | passed — warnings may exist (shown in the log under `WARNINGS (do not block archive/close/CI):`, not blocking) |
| 1 | error/block — the job fails; the message lists the pending items and the way out |
| 2 | reserved for local HOOKS (PreToolUse deny) — never happens in CI; if it does, it is a specctl bug, report it |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `audit --pr` fails with undeterminable base | shallow clone | confirm `fetch-depth: 0` on checkout. The audit fails CLOSED by design — it never passes on empty |
| index check prints files | an index was hand-edited, is stale, or was never committed (untracked) | run `node scripts/specctl.mjs index` locally and commit all 4 files; never edit the generated ones |
| main gate failed | PR to main contains a SPEC in `docs/active/` | close (`/spec close` → `specctl close <id>`), discard or pause the SPEC before merging |
| audit `archive BLOCKED` | incomplete close | resolve what the message lists: `[ ]` criteria without `[accepted-incomplete: ...]`, missing digest.md, no `[completion]` in the LOG, `Final commit: —`, feature without the SPEC-id under Completed |
| secret-scan ERROR | secret in docs/ | replace with `<REDACTED:type>` + a `[note]` of the redaction in the journal (audited exception to append-only, R.15) and ROTATE the exposed secret |
| lint: folder↔status coherence | main.md status does not match the folder (e.g. `done` outside archive/) | use specctl transitions (`pause/resume/close/discard`), never a manual `mv` |
| `audit --deps`: cycle/missing node | invalid program manifest | edit `docs/programs/<slug>.md` in a dedicated PR (single writer) |

## Compatibility note: hooks × CI (cost per tool call)

Local hooks (guard-read, guard-write, stamp-check) run `node scripts/specctl.mjs ...` on EVERY Read/Write/Edit of the session — Node startup dominates the cost (tens of ms per call). Fine on local disk; noticeable on network FS or cold containers. If it weighs, disabling hooks selectively is legitimate: **CI remains the floor — nothing wrong merges, it is just caught later**. CLIs without hook support (non-Claude Code) work with AGENTS.md (text) + this gate; the experience is uneven by construction, the gate is not.

## GitLab / Azure (minimum equivalents — lint + diff audit + deps)

GitLab (`.gitlab-ci.yml`):

```yaml
docs-gate:
  image: node:22
  variables: { GIT_DEPTH: "0" }
  rules: [{ if: '$CI_PIPELINE_SOURCE == "merge_request_event"' }]
  script: ["node scripts/specctl.mjs lint --strict", "node scripts/specctl.mjs audit --pr --base $CI_MERGE_REQUEST_DIFF_BASE_SHA", "node scripts/specctl.mjs audit --deps"]
```

Azure Pipelines (`azure-pipelines.yml`):

```yaml
steps:
  - checkout: self
    fetchDepth: 0
  - script: node scripts/specctl.mjs lint --strict && node scripts/specctl.mjs audit --pr --base $(git merge-base origin/$(System.PullRequest.TargetBranchName) HEAD) && node scripts/specctl.mjs audit --deps
    displayName: docs-gate
```

Main gate, index check and the weekly schedule port by analogy with the GitHub YAML — same specctl commands, only the wrapper changes.
