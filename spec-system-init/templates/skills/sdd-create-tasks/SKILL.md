---
name: sdd-create-tasks
description: Converts a PRD and Tech Spec into a sequenced list of implementation tasks, each a functional, incremental deliverable with its own tests. Outputs tasks.md plus one `NN_task.md` file per task (01_task.md, 02_task.md, …). Use when the user asks to create tasks, break down the work or plan the implementation from an existing PRD and Tech Spec — also in Portuguese ("criar tasks", "quebrar em tarefas", "gerar tarefas"). Do not use for PRD creation, tech spec creation or code implementation.
argument-hint: "[feature-slug | SPEC-id]"
---

# Task Creation

## SDD Interop (conditional — skip entirely in standalone projects)

If BOTH `docs/.spec-system.json` AND `docs/RULES.md` exist at the project root, the project is governed by the SDD spec system. In that case, and ONLY then:

1. **Workspace**: resolve the workspace from the manifest `interop` mode and the active SPEC (`docs/rules/interop.md`): `inline` → the SPEC folder `docs/active/SPEC-<id>/`; `external` → the `**Workspace:**` path in `main.md` (`tasks/prd-<slug>/`). Every reference in this skill to `./tasks/prd-[feature-slug]/` means the ROOT of that directory. Never use `docs/tasks/` or a `tasks/` subfolder of the SPEC.
2. **Slug**: if a slug/workspace is provided by the caller or manifest, use it verbatim — never derive a new one.
3. **Requirements equivalence**: where a prerequisite requires `prd.md` and it does not exist, accept the SPEC's `main.md` as the equivalent requirements document. When the SPEC's pipeline path is "tasks only", a missing `techspec.md` is expected: use `main.md` and the codebase instead.
4. **Interview dedupe**: before asking any clarification question, read the SPEC's `main.md` and journal; ask ONLY what is not already answered there, and record inferred answers with their source in the generated document.
5. **Approvals**: governed by the execution mode chosen at the SPEC checkpoint and recorded in the journal (`autonomous | gated`; no recorded mode → `gated`, fail-safe). In `gated`: after generating `tasks.md`, present the task list and STOP for explicit user approval (AskUserQuestion) before any task execution begins. In `autonomous`: plan/list presentations are informational (record in the journal and proceed). In BOTH modes, decisions that change the SPEC's acceptance criteria or scope ALWAYS require explicit user approval.
6. **Commands**: use the command labels from the SDD manifest (`commands: {test, typecheck, lint, dev, e2e}`) instead of any hardcoded or detected command.
7. **Memory feedback (mandatory final step)**: after this skill's last step, record the task breakdown in the active SPEC's journal, re-map the SNAPSHOT phases to task blocks (e.g. "Phase 4 = tasks 3.0-5.0"), and update the `**Tasks:**` pointer in the SPEC's `main.md`. Journal entries go ONLY through `node scripts/specctl.mjs log <spec-id> <type> "title"` (multi-line body via `--stdin`; types: discovery | decision | attempt | blocker | note) — never edit the journal's `## LOG` directly (the guard-write hook denies it). Never tick an acceptance criterion by hand; criteria change only via `specctl check`/`verify`.

If the manifest is absent, ignore this section completely — the standalone behavior below is unchanged.

## Procedures

**Step 1: Validate Prerequisites**
1. Confirm the feature slug has been provided.
2. Verify the PRD exists at `./tasks/prd-[feature-slug]/prd.md`. If missing, halt.
3. Verify the Tech Spec exists at `./tasks/prd-[feature-slug]/techspec.md`. If missing, halt (SDD exception: see Interop item 3).

**Step 2: Analyze the PRD and Tech Spec (Mandatory)**
1. Read the PRD completely to extract requirements.
2. Read the Tech Spec completely to extract technical decisions.
3. Identify the main components and their dependencies.

**Step 3: Generate the High-Level Task List (Mandatory)**
1. Present the high-level task list to the user for approval BEFORE generating any files.
2. Organize tasks by logical deliverable.
3. Order tasks logically: dependencies before dependents (e.g. backend before frontend, both before E2E tests).
4. Each task MUST be a functional, incremental deliverable.
5. Each task MUST have its own unit and integration tests.
6. Limit to a maximum of 15 tasks (group as needed).
7. Wait for user approval before proceeding to Step 4.

**Step 4: Generate the Task Files (Mandatory)**
1. Read the summary template at `assets/tasks-template.md`.
2. Read the individual task template at `assets/task-template.md`.
3. Create the summary file `./tasks/prd-[feature-slug]/tasks.md`.
4. Create one file per task at the workspace root, named with the two-digit zero-padded task number: task `1.0` → `01_task.md`, task `2.0` → `02_task.md`, … (never `1.0_task.md` or `1_task.md`).
5. Inside the files, use `X.0` for main tasks and `X.Y` for subtasks.
6. Reference the FR-n each task covers.
7. Do NOT repeat implementation details already in the Tech Spec — reference it instead.

**Step 5: Report Results**
1. Present all generated files to the user.
2. Await confirmation before any implementation begins (SDD: per the execution mode).

## Guidelines
- Assume the primary reader is a junior developer — be as clear as possible.
- Make each main task independently completable, with clear scope and deliverables.
- Include tests as subtasks within each main task.
- Do NOT implement anything — focus solely on listing and detailing tasks.

## Quality Checklist
- [ ] PRD and Tech Spec analyzed.
- [ ] High-level task list approved by the user.
- [ ] Task files generated from the templates, named `NN_task.md`.
- [ ] Each task has unit and integration test subtasks.
- [ ] Files saved to `./tasks/prd-[feature-slug]/`.
- [ ] Results presented to the user.

## Error Handling
- If the PRD or Tech Spec is missing, halt and direct the user to the `sdd-create-prd` or `sdd-create-techspec` skill.
- If the user rejects the high-level task list, revise based on feedback and re-present it for approval.
- If `tasks.md` or `NN_task.md` files already exist, confirm with the user before overwriting them. An existing directory alone is not a reason to ask.
