---
name: sdd-run-task
description: Implements one task from tasks.md — reads the PRD/Tech Spec context, loads the relevant skills, implements with tests, runs the review loop (agent `sdd-task-reviewer`, max 3 cycles) and marks the task done in tasks.md. Also applies the fixes requested by a REJECTED feature review. Use when the user asks to implement, execute or start a task or task number — also in Portuguese ("executar task", "executa a task 3", "implementar tarefa", "próxima task"). Do not use for creating tasks, running QA, feature code review or bug fixing.
argument-hint: "[task number] [feature-slug | SPEC-id]"
---

# Task Execution

## SDD Interop (conditional — skip entirely in standalone projects)

If BOTH `docs/.spec-system.json` AND `docs/RULES.md` exist at the project root, the project is governed by the SDD spec system. In that case, and ONLY then:

1. **Workspace**: resolve the workspace from the manifest `interop` mode and the active SPEC (`docs/rules/interop.md`): `inline` → the SPEC folder `docs/active/SPEC-<id>/`; `external` → the `**Workspace:**` path in `main.md` (`tasks/prd-<slug>/`). Every reference in this skill to `./tasks/prd-[feature-slug]/` means the ROOT of that directory. Never use `docs/tasks/` or a `tasks/` subfolder of the SPEC.
2. **Slug**: if a slug/workspace is provided by the caller or manifest, use it verbatim — never derive a new one.
3. **Requirements equivalence**: where a prerequisite requires `prd.md` and it does not exist, accept the SPEC's `main.md` as the equivalent requirements document.
4. **Interview dedupe**: before asking any clarification question, read the SPEC's `main.md` and journal; ask ONLY what is not already answered there, and record inferred answers with their source in the generated document.
5. **Approvals**: governed by the execution mode chosen at the SPEC checkpoint and recorded in the journal (`autonomous | gated`; no recorded mode → `gated`, fail-safe). In `gated`: BEFORE starting each task, present a short summary (task number, FRs covered, planned files) and STOP for explicit user approval (AskUserQuestion). In `autonomous`: plan/list presentations are informational (record in the journal and proceed). In BOTH modes, decisions that change the SPEC's acceptance criteria or scope ALWAYS require explicit user approval.
6. **Commands**: use the command labels from the SDD manifest (`commands: {test, typecheck, lint, dev, e2e}`) instead of any hardcoded or detected command.
7. **Memory feedback (mandatory final step)**: after this skill's last step, append a dated summary of decisions, deviations and learnings (`attempt`/`discovery`/`decision`) to the active SPEC's journal, and update the SNAPSHOT at milestones. Journal entries go ONLY through `node scripts/specctl.mjs log <spec-id> <type> "title"` (multi-line body via `--stdin`; types: discovery | decision | attempt | blocker | note) — never edit the journal's `## LOG` directly (the guard-write hook denies it). Never tick an acceptance criterion in `main.md` by hand; criteria change only via `specctl check`/`verify`. Commits carry the trailer `Spec: SPEC-<id>` (R.17).

If the manifest is absent, ignore this section completely — the standalone behavior below is unchanged.

## Procedures

**Step 1: Pre-Task Configuration (Mandatory)**
1. Read the task file `./tasks/prd-[feature-slug]/NN_task.md`, where `NN` is the two-digit zero-padded task number (task 3 → `03_task.md`).
2. Read the PRD at `./tasks/prd-[feature-slug]/prd.md` for context.
3. Read the Tech Spec at `./tasks/prd-[feature-slug]/techspec.md` for technical requirements.
4. Identify dependencies on previous tasks and verify they are complete in `tasks.md`.
5. Do NOT skip any of these reads.

**Step 2: Load Required Skills**
1. Identify the technologies involved in the task (frameworks and libraries detected in the project).
2. Load the matching skills (the project's `.claude/skills/` first, then applicable user-level skills).
3. If the task involves UI (components, pages, styling) and the `frontend-design` skill is installed, load it and follow its guidelines; otherwise follow the project's own UI conventions (existing components, design system, styles).
4. Use Context7 MCP to check the documentation of the languages, frameworks and libraries involved.

**Step 3: Task Analysis (Mandatory)**
1. Analyze the task: main objectives, how it fits the project, alignment with project rules and standards, possible approaches.
2. Write a task summary: task ID and name, PRD context, Tech Spec requirements, dependencies, main objectives, risks/challenges.

**Step 4: Approach Plan (Mandatory)**
1. Define a numbered step-by-step approach.
2. Do NOT skip any step.

**Step 5: Implementation (Mandatory)**
1. Begin implementation right after planning (SDD `gated` mode: after the approval of Interop item 5).
2. Follow the project standards in CLAUDE.md, CONSTITUTION.md and the project rules.
3. Implement solutions without workarounds.
4. Create and run all task tests before considering the task finished.
5. Temporary/scratch artifacts (logs, dumps, screenshots, generated test outputs) go to `./tasks/prd-[feature-slug]/tmp/` — never elsewhere in the repository.

**Step 6: Review Loop (Mandatory, max 3 cycles)**
1. Count the cycles already run for this task before starting, so the limit survives a resume: SDD → the journal entries `task NN review cycle k`; standalone → the `**Review cycle:**` field of an existing `NN_task_review.md`.
2. Run the review: launch the `sdd-task-reviewer` agent with the Agent tool, passing the SPEC id (or workspace path), the task number and the cycle number explicitly. If the agent is not installed, apply the `sdd-review-task` skill directly in this session with the same inputs.
3. Record each cycle as soon as its verdict is known (SDD): `node scripts/specctl.mjs log <spec-id> note "task NN review cycle k: <verdict>"`.
4. `CHANGES REQUESTED` → fix the findings and start the next cycle.
5. After cycle 3, if the verdict is still `CHANGES REQUESTED`: stop, record the persistent findings as a `blocker` entry (`node scripts/specctl.mjs log <spec-id> blocker "task NN: review findings persist after 3 cycles" --stdin`, findings in the body) and escalate to the user. Do not mark the task done.

**Step 7: Mark the Task Done (Mandatory)**
1. Mark the task done ONLY when the review verdict is `APPROVED` or `APPROVED WITH OBSERVATIONS`. With `CHANGES REQUESTED`, do NOT mark it (and revert the mark if it was already set).
2. Commit: if the project commits per task (CLAUDE.md, CONSTITUTION.md, the task file or the user says so), commit the task's changes now with the trailer `Spec: SPEC-<id>` (SDD). Otherwise leave the commit to the user and say so.
3. Tick the task in `tasks.md` in the R.6 format: ``- [x] NN … (YYYY-MM-DD HH:MM, commit `hash`)`` (e.g. ``- [x] 3.0 Order API (2026-11-25 14:30, commit `a1b2c3d`)``) — the task commit's short hash, or the current `HEAD` short hash when the commit is left to the user. A `[x]` without timestamp is a lint error.
4. Tick the completed subtask and test checkboxes in `NN_task.md` in the same format.

## Feature Review Fix Mode

When invoked after a `REJECTED` feature review (`review-report*.md` from `sdd-review-feature`):
1. Treat the report's Critical/High findings as the scope; read the files and lines it cites.
2. Fix them, run the full test suite and typecheck, and commit per Step 7.2.
3. Hand back to `sdd-review-feature` for the next cycle. The cycle count and the 3-cycle limit belong to `sdd-review-feature`.

## Error Handling
- If the task file does not exist, halt and report to the user.
- If dependencies are not complete, warn the user and ask whether to proceed.
- If Context7 MCP is unavailable, proceed with web search and local project documentation — do not halt.
- If tests fail, fix the issues before marking the task done.
- If the review identifies critical issues, address them before marking the task done.
