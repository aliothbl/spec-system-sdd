---
name: sdd-review-task
description: Reviews one completed task (`NN_task.md`) against the project's own conventions, type checks and test suite, classifies findings by severity and writes `NN_task_review.md` with the verdict APPROVED, APPROVED WITH OBSERVATIONS or CHANGES REQUESTED. Called by sdd-run-task (through the `sdd-task-reviewer` agent) after each task; use it directly when the user asks to review a specific task — also in Portuguese ("revisar task", "review da task 3", "revisar tarefa"). Do not use for full branch/feature review, QA or bug fixing.
argument-hint: "[task number] [feature-slug | SPEC-id]"
---

# Task Review

## SDD Interop (conditional — skip entirely in standalone projects)

If BOTH `docs/.spec-system.json` AND `docs/RULES.md` exist at the project root, the project is governed by the SDD spec system. In that case, and ONLY then:

1. **Workspace**: resolve the workspace from the manifest `interop` mode and the active SPEC (`docs/rules/interop.md`): `inline` → the SPEC folder `docs/active/SPEC-<id>/`; `external` → the `**Workspace:**` path in `main.md` (`tasks/prd-<slug>/`). `tasks.md` and `NN_task.md` live at the ROOT of that directory. Never search `docs/tasks/` or a `tasks/` subfolder of the SPEC.
2. **Slug**: if a SPEC id/workspace and task number are provided by the caller, use them verbatim — never guess by recency.
3. **Requirements equivalence**: where a prerequisite requires `prd.md` and it does not exist, accept the SPEC's `main.md` as the equivalent requirements document.
4. **Interview dedupe**: before asking any clarification question, read the SPEC's `main.md` and journal; ask ONLY what is not already answered there.
5. **Approvals**: findings are recorded and reported — decisions that change the SPEC's acceptance criteria or scope ALWAYS require explicit user approval.
6. **Commands**: use the command labels from the SDD manifest (`commands: {test, typecheck, lint, dev, e2e}`) instead of any hardcoded or detected command.
7. **Memory feedback (mandatory final step)**: after this skill's last step, append Critical/High findings as dated `note` entries to the active SPEC's journal (gotcha candidates for the touched features). Journal entries go ONLY through `node scripts/specctl.mjs log <spec-id> <type> "title"` (multi-line body via `--stdin`; types: discovery | decision | attempt | blocker | note) — never edit the journal's `## LOG` directly (the guard-write hook denies it). Never tick an acceptance criterion by hand. The review cycle entry (`task NN review cycle k: <verdict>`) is logged by the caller (sdd-run-task); when run directly by the user, log it yourself.

If the manifest is absent, ignore this section completely — the standalone behavior below is unchanged.

## Procedures

**Step 0: Resolve Project Commands (Mandatory)**
1. If the SDD manifest exists (`docs/.spec-system.json`), use its command labels (`commands: {test, typecheck, lint, dev, e2e}`) and skip detection.
2. Otherwise detect once: package manager by lockfile (`bun.lockb`→bun, `pnpm-lock.yaml`→pnpm, `yarn.lock`→yarn, `package-lock.json`→npm) and scripts from `package.json`; if a `typecheck` script is missing in a TypeScript project, use `tsc --noEmit` via the detected package manager. Non-Node stacks by marker: `pyproject.toml`→`pytest`/`mypy`; `go.mod`→`go test ./...`/`go vet ./...`; `Cargo.toml`→`cargo test`/`cargo check`.
3. If nothing resolves, ask the user once and reuse the answer.
4. Below, `<test>`, `<typecheck>` and `<lint>` mean the resolved commands. CRITICAL: a command that does not exist in the project is a tooling limitation — report it as such; NEVER treat the absence of a command as failing tests or as a critical issue of the reviewed code.

**Step 1: Identify the Task**
1. Task files live at `./tasks/prd-[feature-slug]/` (SDD: the workspace root). Files are named with the two-digit zero-padded task number: task 3 → `03_task.md`.
2. If a task number is provided, open that `NN_task.md`.
3. If none is provided, take the highest-numbered task ticked in `tasks.md` without an up-to-date `NN_task_review.md`, and confirm it with the user.
4. Read and understand the task requirements completely.

**Step 2: Identify Changed Files**
1. Use `git diff`, `git diff --staged` and `git log` to identify the files changed for this task.
2. Read the full context of each modified file, not just the diff.

**Step 3: Resolve the Applicable Standards**
1. The project's conventions take precedence: CLAUDE.md / AGENTS.md, `docs/CONSTITUTION.md` (or `CONSTITUTION.md`), linter and formatter config (e.g. `eslint.config.*`, `.eslintrc*`, `biome.json`, `.prettierrc*`, `[tool.ruff]` in `pyproject.toml`, `.golangci.yml`, `rustfmt.toml`, `.editorconfig`) and the established style of the touched modules. Run `<lint>` when it exists.
2. Use `references/code-standards.md` ONLY as a fallback, for aspects the project defines nothing about. Never flag code that follows a project convention just because it conflicts with the fallback list.
3. Also check compliance with the applicable skills.

**Step 4: Conduct the Review and Classify Findings**
1. Review every changed file against the standards resolved in Step 3, the task requirements and the tech spec.
2. Classify each finding:
   - **Critical**: bugs, security issues, broken functionality, unsafe/dynamic types where the stack offers typing (e.g. `any` in TypeScript), missing error handling.
   - **High**: violations of project conventions, missing tests, misleading naming.
   - **Medium**: maintainability issues worth fixing (duplication, unclear structure).
   - **Low**: style suggestions, optional optimizations.
   - **Positive**: well-done work worth recognizing.

**Step 5: Validate Tests and Types**
1. Run `<typecheck>` (when the stack has one).
2. Run `<test>` and confirm all tests pass. Failures are Critical findings.

**Step 6: Write the Review Artifact**
1. Read the template at `assets/review-artifact-template.md`.
2. Write `NN_task_review.md` in the SAME directory as `NN_task.md` (overwrite the previous cycle's file), with `**Review cycle:**` set to the cycle number given by the caller (1 if none).
3. Apply the verdict criteria:
   - **APPROVED**: no Critical or High findings.
   - **APPROVED WITH OBSERVATIONS**: no Critical findings; only Medium/Low, or an isolated non-blocking High.
   - **CHANGES REQUESTED**: any Critical finding, or several High findings.
4. Return the verdict and the file path to the caller.

## Guidelines
- Be thorough but fair: review every changed file, and acknowledge good work.
- Be specific: reference the exact file and line for every finding.
- Provide solutions: suggest fixes with code examples, not just problems.
- Write the artifact's prose in the language of the project's docs (SDD: the manifest `lang`, absent = `pt`; otherwise the language of the existing docs). Code stays as written in the codebase.
- Do not edit code: the review reports, sdd-run-task fixes.

## Error Handling
- If no task file is found, report to the user and ask for the task number.
- If git shows no changes for the task, report that there is nothing to review.
- If typecheck or tests fail, include the failures in the artifact as Critical findings.
