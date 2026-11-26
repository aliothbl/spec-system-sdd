---
name: sdd-run-qa
description: Validates a feature against its PRD, Tech Spec and tasks through E2E testing with Playwright MCP (or API/CLI checks when there is no UI), WCAG 2.2 accessibility checks and visual analysis. Documents bugs with evidence in bugs.md and writes qa-report.md with the verdict APPROVED or REJECTED. The QA → bugfix → QA loop is limited to 3 rounds. Use when the user asks to run QA, validate or test a feature end to end — also in Portuguese ("rodar QA", "executar QA", "validar a feature", "testar a feature"). Do not use for code review, bug fixing or task implementation.
argument-hint: "[feature-slug | SPEC-id]"
---

# QA Execution

## SDD Interop (conditional — skip entirely in standalone projects)

If BOTH `docs/.spec-system.json` AND `docs/RULES.md` exist at the project root, the project is governed by the SDD spec system. In that case, and ONLY then:

1. **Workspace**: resolve the workspace from the manifest `interop` mode and the active SPEC (`docs/rules/interop.md`): `inline` → the SPEC folder `docs/active/SPEC-<id>/`; `external` → the `**Workspace:**` path in `main.md` (`tasks/prd-<slug>/`). Every reference in this skill to `./tasks/prd-[feature-slug]/` means the ROOT of that directory. Never use `docs/tasks/` or a `tasks/` subfolder of the SPEC.
2. **Slug**: if a slug/workspace is provided by the caller or manifest, use it verbatim — never derive a new one.
3. **Requirements equivalence**: where a prerequisite requires `prd.md` and it does not exist, accept the SPEC's `main.md` as the equivalent requirements document.
4. **Interview dedupe**: before asking any clarification question, read the SPEC's `main.md` and journal; ask ONLY what is not already answered there, and record inferred answers with their source in the generated document.
5. **Approvals**: plan/list presentations are informational (record in the journal and proceed) — EXCEPT decisions that change the SPEC's acceptance criteria or scope, which ALWAYS require explicit user approval.
6. **Commands**: use the command labels from the SDD manifest (`commands: {test, typecheck, lint, dev, e2e}`) instead of any hardcoded or detected command.
7. **Memory feedback (mandatory final step)**: after this skill's last step, append a dated summary of decisions, deviations and learnings to the active SPEC's journal, and update the `**QA:**`, `**Bugs:**` and `**Evidence:**` pointers in the SPEC's `main.md`. When a `PASSED` requirement maps to an acceptance criterion (`(covers FR-n)`), NEVER tick the checkbox by hand (a hand-written `[x]` is spoofing): criterion with `| verify:` → `node scripts/specctl.mjs verify <spec-id>`; criterion without it → `node scripts/specctl.mjs check <spec-id> <n> --evidence "evidence/<file>"`. A `FAILED` requirement leaves its criterion `[ ]`. Report criteria you could not evidence instead of marking them. Journal entries go ONLY through `node scripts/specctl.mjs log <spec-id> <type> "title"` (multi-line body via `--stdin`; types: discovery | decision | attempt | blocker | note) — never edit the journal's `## LOG` directly (the guard-write hook denies it).

If the manifest is absent, ignore this section completely — the standalone behavior below is unchanged.

## Procedures

**Step 0: Resolve Project Commands (Mandatory)**
1. If the SDD manifest exists (`docs/.spec-system.json`), use its command labels (`commands: {test, typecheck, lint, dev, e2e}`) and skip detection.
2. Otherwise detect once: package manager by lockfile (`bun.lockb`→bun, `pnpm-lock.yaml`→pnpm, `yarn.lock`→yarn, `package-lock.json`→npm) and scripts from `package.json`. Non-Node stacks by marker: `pyproject.toml`→`pytest`; `go.mod`→`go test ./...`; `Cargo.toml`→`cargo test`.
3. If nothing resolves, ask the user once and reuse the answer.
4. Below, `<test>`, `<dev>` and `<e2e>` mean the resolved commands. A command that does not exist in the project is a tooling limitation — report it, never treat it as a failure of the feature.

**Step 1: Documentation Analysis (Mandatory)**
1. Read the PRD at `./tasks/prd-[feature-slug]/prd.md` and extract ALL numbered functional requirements (FR-n).
2. Read the Tech Spec at `./tasks/prd-[feature-slug]/techspec.md` and note the technical decisions to verify.
3. Read `./tasks/prd-[feature-slug]/tasks.md` and check the completion status of each task.
4. Build a verification checklist from the requirements.
5. Determine the QA round: count earlier rounds (SDD: journal entries `QA round k`; standalone: existing `qa-report*.md` files). This run is round k+1.
6. Do NOT skip this step — understanding the requirements is fundamental for QA.

**Step 2: Environment Preparation (Mandatory)**
1. Create the artifact directories if missing: `./tasks/prd-[feature-slug]/tmp/` (raw outputs — screenshots as captured, dumps, traces) and `./tasks/prd-[feature-slug]/evidence/` (persistent evidence cited by reports — versioned).
2. `.gitignore`: in standalone and SDD `external` mode, make sure `tasks/**/tmp/` is ignored (add it if missing). In SDD `inline` mode do not touch `.gitignore` — `docs/active/**/tmp/` is already ignored.
3. Determine from the Tech Spec whether the feature has a web UI. If it does NOT: skip the browser steps (rest of Step 2, Steps 3-5) and validate each requirement via integration/API tests, direct HTTP calls or CLI execution (resolved project commands), saving command outputs to `evidence/` in place of screenshots; accessibility does not apply.
4. Resolve the base URL — never assume a port: Playwright config (`baseURL`), `.env` (`PORT`), the framework default, or ask the user.
5. Verify the application responds at the base URL. If not: resolve `<dev>`, offer to start it in the background, poll the URL until ready (60s timeout) and retry; if it still fails, halt and report the command attempted and the error.
6. Open the application with `browser_navigate` and confirm it loaded with `browser_snapshot`.

**Step 3: E2E Tests with Playwright MCP (Mandatory)**
1. Read `references/playwright-tools.md` for the tool reference (the names assume an MCP server registered as `playwright`).
2. For each functional requirement:
   a. Navigate to the feature.
   b. Execute the expected flow.
   c. Verify the result.
   d. Capture screenshots into the SPEC's `tmp/` (pass an explicit `filename` under `./tasks/prd-[feature-slug]/tmp/`, or move the file there — never leave it in the MCP's default output dir or the repo root). When a screenshot supports a verdict or a bug, copy it to `evidence/` as `FR-n-[label].png` and cite that relative path in the report.
   e. Mark it `PASSED` or `FAILED`.
3. Always call `browser_snapshot` before interacting, to understand the current page state.
4. Check the browser console for JavaScript errors with `browser_console_messages`.
5. Verify API calls with `browser_network_requests`.

**Step 4: Accessibility Verification (Mandatory)**
1. For each screen/component verify:
   - Keyboard navigation works (Tab, Enter, Escape).
   - Interactive elements have descriptive labels.
   - Images have appropriate alt text.
   - Color contrast is adequate (via `browser_take_screenshot` + explicit visual analysis — the accessibility tree does not expose colors; if visual analysis is not possible, mark it "limited verification").
   - Form inputs have associated labels.
   - Error messages are clear and accessible.
2. Use `browser_press_key` to test keyboard navigation and `browser_snapshot` to check labels and semantic structure.
3. Follow WCAG 2.2.

**Step 5: Visual Verification (Mandatory)**
1. Capture the main screens with `browser_take_screenshot` into `tmp/`; promote the ones cited in the report to `evidence/` with descriptive names.
2. Check layouts in different states (empty, with data, error).
3. Document visual inconsistencies.
4. Check responsiveness if applicable.

**Step 6: Bug Documentation**
1. Read `assets/bugs-template.md` and document each bug exactly as it prescribes: ID `BUG-NN`, affected requirement `FR-n`, description, reproduction steps, expected vs. observed, evidence path in `evidence/`, severity (`Critical` / `High` / `Medium` / `Low`), status `Open`.
2. Save bugs to `./tasks/prd-[feature-slug]/bugs.md`. If it already exists (re-run after fixes):
   a. Read ALL existing bugs before writing anything.
   b. Re-run the scenario of every bug with status `Fixed` and set it to `Verified` (fix confirmed) or `Reopened` (still failing).
   c. Number new bugs from the highest existing ID.
   d. NEVER overwrite or delete existing entries — only append new bugs and update status fields.
3. If a blocking bug is found, document it and report immediately.

**Step 7: Generate the QA Report (Mandatory)**
1. Read `assets/qa-report-template.md` and fill in every section with actual results.
2. Verdict `APPROVED` only when ALL requirements are `PASSED`; otherwise `REJECTED`.
3. Save the report to `./tasks/prd-[feature-slug]/qa-report.md` (later rounds: `qa-report-02.md`, …) and report the final path.

**Step 8: QA Loop (max 3 rounds)**
1. Record the round (SDD): `node scripts/specctl.mjs log <spec-id> note "QA round k: <verdict>"`.
2. `REJECTED` with rounds left → recommend `sdd-fix-bugs`, then a new QA round.
3. Round 3 still `REJECTED` → stop the loop: record the open bugs as a `blocker` entry (`node scripts/specctl.mjs log <spec-id> blocker "QA: REJECTED after 3 rounds" --stdin`) and escalate to the user (fix further / new SPEC / accept the gap — R.6.2).
4. QA `APPROVED` does not close the SPEC — closing is the user's decision (`/spec close`).

## Error Handling
- If the application is not running, resolve `<dev>` and follow Step 2.5 before asking the user to intervene.
- If Playwright MCP is unavailable, report it and suggest running the project's E2E suite via `<e2e>` (or manual verification), recording the limitation in the report.
- If a blocking bug prevents testing later features, document it and continue with the testable areas.
- Write the report's prose in the language of the project's docs (SDD: the manifest `lang`, absent = `pt`).
