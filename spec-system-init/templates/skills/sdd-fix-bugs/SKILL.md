---
name: sdd-fix-bugs
description: Reads the open bugs in bugs.md, analyzes root causes, implements fixes with regression tests, validates the full test suite, updates bugs.md and writes bugfix-report.md. Fixes by severity (Critical first). Part of the QA → bugfix → QA loop (max 3 QA rounds). Use when the user asks to fix bugs, resolve QA issues or run the bugfix workflow for a feature — also in Portuguese ("corrigir bugs", "executar bugfix", "resolver os bugs do QA"). Do not use for new feature implementation, code review or QA testing.
argument-hint: "[feature-slug | SPEC-id]"
---

# Bug Fix Execution

## SDD Interop (conditional — skip entirely in standalone projects)

If BOTH `docs/.spec-system.json` AND `docs/RULES.md` exist at the project root, the project is governed by the SDD spec system. In that case, and ONLY then:

1. **Workspace**: resolve the workspace from the manifest `interop` mode and the active SPEC (`docs/rules/interop.md`): `inline` → the SPEC folder `docs/active/SPEC-<id>/`; `external` → the `**Workspace:**` path in `main.md` (`tasks/prd-<slug>/`). Every reference in this skill to `./tasks/prd-[feature-slug]/` means the ROOT of that directory. Never use `docs/tasks/` or a `tasks/` subfolder of the SPEC.
2. **Slug**: if a slug/workspace is provided by the caller or manifest, use it verbatim — never derive a new one.
3. **Requirements equivalence**: where a prerequisite requires `prd.md` and it does not exist, accept the SPEC's `main.md` as the equivalent requirements document.
4. **Interview dedupe**: before asking any clarification question, read the SPEC's `main.md` and journal; ask ONLY what is not already answered there, and record inferred answers with their source in the generated document.
5. **Approvals**: implementation proceeds autonomously — EXCEPT when a fix changes the SPEC's acceptance criteria or contracted scope: then ALWAYS ask the user first (one question per affected criterion).
6. **Commands**: use the command labels from the SDD manifest (`commands: {test, typecheck, lint, dev, e2e}`) instead of any hardcoded or detected command.
7. **Memory feedback (mandatory final step)**: after this skill's last step, append the root causes as `discovery` entries to the active SPEC's journal (gotcha candidates for the touched features), plus decisions and learnings, and update the `**Bugfix:**` and `**Bugs:**` pointers in the SPEC's `main.md`. Journal entries go ONLY through `node scripts/specctl.mjs log <spec-id> <type> "title"` (multi-line body via `--stdin`; types: discovery | decision | attempt | blocker | note) — never edit the journal's `## LOG` directly (the guard-write hook denies it). Never tick an acceptance criterion by hand; criteria change only via `specctl check`/`verify` after a QA re-run. Commits carry the trailer `Spec: SPEC-<id>` (R.17).

If the manifest is absent, ignore this section completely — the standalone behavior below is unchanged.

## Procedures

**Step 0: Resolve Project Commands (Mandatory)**
1. If the SDD manifest exists (`docs/.spec-system.json`), use its command labels (`commands: {test, typecheck, lint, dev, e2e}`) and skip detection.
2. Otherwise detect once: package manager by lockfile (`bun.lockb`→bun, `pnpm-lock.yaml`→pnpm, `yarn.lock`→yarn, `package-lock.json`→npm) and scripts from `package.json`; if a `typecheck` script is missing in a TypeScript project, use `tsc --noEmit` via the detected package manager. Non-Node stacks by marker: `pyproject.toml`→`pytest`/`mypy`; `go.mod`→`go test ./...`/`go vet ./...`; `Cargo.toml`→`cargo test`/`cargo check`.
3. If nothing resolves, ask the user once and reuse the answer.
4. Below, `<test>`, `<typecheck>` and `<e2e>` mean the resolved commands. A command that does not exist in the project is a tooling limitation — report it, never treat it as failing tests.

**Step 1: Context Analysis (Mandatory)**
1. Read `./tasks/prd-[feature-slug]/bugs.md` and extract ALL documented bugs. Work ONLY on bugs with status `Open` or `Reopened`; skip `Fixed`, `Verified` and `Not reproducible`.
2. Read the PRD at `./tasks/prd-[feature-slug]/prd.md` to understand the affected requirements.
3. Read the Tech Spec at `./tasks/prd-[feature-slug]/techspec.md` for the relevant technical decisions.
4. Review the project rules and conventions the fixes must follow.
5. Do NOT skip this step — full context is fundamental for quality fixes.

**Step 2: Plan the Fixes (Mandatory)**
1. For each bug, write a planning summary:
   - Bug ID, severity (`Critical` / `High` / `Medium` / `Low`), affected requirement (FR-n), affected component.
   - Root cause analysis.
   - Files to modify.
   - Fix strategy.
   - Planned regression tests (unit, integration, E2E).
2. Use Context7 MCP to check the documentation of the languages, frameworks and libraries involved.

**Step 3: Implement the Fixes (Mandatory)**
1. After planning, start implementing without waiting for approval (QA already triaged the bugs). Exception: in SDD mode, a fix that changes contracted acceptance criteria needs approval first (Interop item 5).
2. Fix bugs in severity order: Critical, High, Medium, then Low.
3. For each bug:
   a. Locate and read the affected code.
   b. Reason about the flow causing the bug.
   c. Fix the root cause — no superficial workarounds.
   d. Run `<typecheck>` after each fix (when the stack has one).
   e. Run the existing tests to catch regressions.

**Step 4: Create Regression Tests (Mandatory)**
1. For each fixed bug, create tests that:
   - Reproduce the original scenario (the test must fail if the fix is reverted).
   - Validate the correct behavior with the fix.
   - Cover related edge cases.
2. Choose the test type by the bug's nature:
   - **Unit test**: bug in isolated function/method logic.
   - **Integration test**: bug in module communication (e.g. controller + service).
   - **E2E test**: bug visible in the UI or in a full flow.

**Step 5: Visual Validation with Playwright MCP (Mandatory for frontend bugs)**
1. For bugs affecting the UI (tool names assume an MCP server registered as `playwright`):
   a. Open the application with `browser_navigate`.
   b. Check the page state with `browser_snapshot`.
   c. Reproduce the flow that caused the bug.
   d. Capture evidence of the fix with `browser_take_screenshot`: raw captures go to `./tasks/prd-[feature-slug]/tmp/`; copy the cited evidence to `./tasks/prd-[feature-slug]/evidence/` as `BUG-NN-fixed.png` and reference that relative path in bugs.md.

**Step 6: Final Test Run (Mandatory)**
1. Run ALL project tests with `<test>`; all must pass.
2. Run type checking with `<typecheck>` (when the stack has one).
3. The work is NOT complete if any executed test fails. A missing test command is a tooling limitation to report.

**Step 7: Update bugs.md (Mandatory)**
1. For each fixed bug, update only its own entry (bugs.md is append-only per `sdd-run-qa/assets/bugs-template.md`):
   - **Status:** `Fixed`.
   - **Fix applied:** short description (+ commit hash when available).
   - **Regression tests:** list of tests created.
2. If a bug cannot be reproduced, set its status to `Not reproducible` with a short justification instead of guessing a fix.
3. Commit the fixes when the project commits per change set (trailer `Spec: SPEC-<id>` in SDD); otherwise leave the commit to the user.

**Step 8: Generate the Final Report**
1. Read `assets/bugfix-report-template.md` and fill in every section with actual results.
2. Save it to `./tasks/prd-[feature-slug]/bugfix-report.md` (re-runs: `bugfix-report-02.md`, …) and report the final path.

**Step 9: Re-validation**
1. Recommend running `sdd-run-qa` again — fixed bugs only become `Verified` through a QA re-run.
2. If the latest QA report was already round 3 (`QA round 3` in the journal, or `qa-report-03.md`), do not start another round: report the state and escalate to the user, who decides (one more round / new SPEC / accept the gap — R.6.2).

## Error Handling
- If bugs.md does not exist, halt and report to the user.
- If a bug requires significant architectural changes, document the justification before proceeding.
- If new bugs are found during the fixes, append them to bugs.md.
- If Context7 MCP is unavailable, proceed with web search and local project documentation — do not halt.
- If Playwright MCP is unavailable for frontend fix validation (Step 5), validate with an automated E2E test (`<e2e>`) or ask the user for manual verification, recording the limitation in the report.
- Write the report's prose in the language of the project's docs (SDD: the manifest `lang`, absent = `pt`).
