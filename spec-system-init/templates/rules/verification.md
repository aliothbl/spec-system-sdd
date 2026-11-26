# Verification — gate, evidence and graders BY SIZE

> On-demand reference (R.6.1/R.6.2). Read before marking a criterion `[x]`, closing a phase or opening a PR. How a criterion becomes `[x]` depends on SIZE: S stamps (timestamp+commit); M/L run `verify:`.

## Size decides the form of evidence

| Size | How the criterion closes | Evidence | pass^3 | evidence/ |
|---|---|---|---|---|
| **S** | `specctl check <id> <n>` — stamps `(NOW, commit)` | timestamp + commit | no | no |
| **M/L** | `specctl verify <id>` — runs the pending criteria's `verify:` | exit 0 of the TARGET test, WRITTEN by the tool | only L + flaky | reports |

**Size S — light by design:**
- An S criterion has NO `| verify:` (lint refuses) — it closes with `specctl check <id> <n>`, which stamps timestamp + current commit. `check` REFUSES a criterion with `verify:` (mandatory route: verify).
- The manifest's `commands.test` runs **once INSIDE `close`** — not an agent step: the suite must pass to archive, but you don't run it per criterion.
- **Do NOT create a suite or script just to give an S criterion a `verify:`** — it's a one-off tweak. If it really needs a dedicated test, the size became M: escalate (`specctl escalate <id> M`).
- No `evidence/`, no `pass^3`.

**Size M/L — the criterion points at the target:**
- `verify:` points at that criterion's **TARGET test** (e.g. `<test> auth/login.spec`), **never the whole suite** — the target is what this criterion proves; the full suite runs once in `close` (manifest label `test`).
- `specctl verify <id>` runs the `verify:` of **pending** criteria (at the event — not-yet-implemented criteria aren't touched); `--all` also re-runs those already `[x]` (rarely needed). Success writes `[x] (NOW, commit, verify: exit 0)`. `close` does **NOT re-run** a criterion with evidence **written by the tool** — a hand-made stamp gets no exemption (spoofing).
- Raw verification reports → `evidence/` (persistent, referenceable from the criterion); never in the journal.

## How commands run

`verify:` commands and the close suite run through the system shell (`/bin/sh`; `cmd.exe` on Windows) from the repo root, output captured. Timeouts: **300 s per `verify:` command**, **600 s for the `commands.test` suite** in `close`. A timeout counts as a failure. Write `verify:` commands that work in the shell of every OS the team uses.

## Source of commands: the manifest

`docs/.spec-system.json` → `commands: { test, typecheck, lint, dev, e2e }`. ALWAYS run via the labels — FORBIDDEN to hardcode `npm run ...`/`bun ...` in criteria, docs or hooks. Empty label = capability missing in the project.

## Missing command ≠ failed command

- **Empty label:** the phase reports `N/A (no command)` — a REPORTED limitation; never a silent PASS, never a block.
- **Command exists and failed:** REAL PROBLEM. Stop, fix, re-run. FORBIDDEN to reclassify a failure as a limitation or skip the phase.

## Port-safe rule (MANDATORY in every test that starts a server)

A fixed port breaks in parallel/CI (`EADDRINUSE`) and hangs `verify` until a silent timeout. Test servers ALWAYS on an **ephemeral port** (`listen(0)`; the test reads the real port from `srv.address().port` — never hardcode) and ALWAYS **propagating the child process's stderr** (`stdio: ['ignore','pipe','inherit']` — otherwise the failure vanishes).

## Phased gate (fixed order; a failure stops the sequence)

**When it runs:** the full gate + report is a **close/PR** ritual (and end of phase in L). During M execution, close criteria with the target `verify:` — don't run the whole gate per criterion.

| # | Phase | Command | PASS when |
|---|---|---|---|
| 1 | Build | project build, if any (no dedicated label: declare it in the `verify:` of the criterion that depends on it) | compiles/bundles without error |
| 2 | Types | label `typecheck` | zero errors |
| 3 | Lint | label `lint` | zero errors (warnings: report) |
| 4 | Tests | label `test`; label `e2e` when the criterion covers a full flow | x/y green; coverage reported if available |
| 5 | Secrets | `node scripts/specctl.mjs lint` (secret-scan of docs/) + scan the code diff yourself | zero findings (R.15) |
| 6 | Diff review | `git diff --stat` + reading the changed files | no unintended change, swallowed error or obvious edge case |

**Secret-scan coverage (R.15):** guard-write blocks a secret BEFORE it is written to `docs/`; stamp-check (PostToolUse) scans the written file in `docs/`, `CLAUDE.md` and `AGENTS.md`; `lint` scans `docs/`. **None of them scans source code** — phase 5's code-diff scan is on you. Finding in docs → replace with `<REDACTED:type>` (the audited exception to append-only and to "never rewrite", R.5/R.15) + `[note]` of the redaction in the journal, and ROTATE the exposed secret.

## Report (M/L evidence for R.6.1)

```
VERIFICATION REPORT — SPEC-<id> — YYYY-MM-DD HH:MM — commit abc1234
Build:   PASS             Types:  PASS
Lint:    PASS (2 warns)   Tests:  PASS (41/41, 84%)
E2E:     N/A (no command)
Secrets: PASS             Diff:   6 files, reviewed
Verdict: READY | NOT READY
Pending: 1. ...
```

Persist in `evidence/` (deterministic name, e.g. `evidence/verify-phase3.md`) and point to it from the criterion or the journal. A report not persisted is NOT evidence. Size S needs no report — the `check` stamp suffices.

## Graders — non-automatable criteria

| Grader | When to use | How the criterion records it |
|---|---|---|
| **code** | deterministic: test, exit code, schema diff | `verify:` suffix with the command |
| **rule** | verifiable form: regex, schema, count | `verify:` suffix with grep/validator |
| **model** | subjective quality: text clarity, UX, tone | subagent evaluates against a written rubric → report in `evidence/`; the criterion points to the evidence — a model grader NEVER closes a criterion alone |
| **human** | contract acceptance, final judgment | `evidence: manual @user` suffix; R.6.2 (rules/lifecycle.md §5.1): only the USER accepts incomplete |

Always prefer the most deterministic grader the criterion supports; go down the table only when the one above can't capture it.

## pass@k — flaky checks (size L ONLY)

- `pass@1` = passed first time · `pass@3` = ≥1 success in 3 · `pass^3` = 3/3 consecutive.
- **`pass^3` applies only to size L with OBSERVED flakiness:** run 3× and require 3/3 (or fix the flakiness). `pass@3` is for diagnosis, not acceptance. In S/M, a flaky check is a bug to fix, not tolerate.
- Persistent intermittency is a real problem: log `[discovery]` in the journal and treat it as a bug. Don't roll the dice until it passes.
- **Criteria on STOCHASTIC/AI output** (e.g. AI drawing produces a valid graph) are the other legitimate use: capability closes with `pass@3`; a release-critical regression requires `pass^3` — the k runs recorded in `evidence/`. A flaky grader in a close gate is an anti-pattern: fix the grader, never roll the dice.
