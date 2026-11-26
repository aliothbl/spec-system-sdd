---
name: sdd-create-prd
description: Creates a Product Requirements Document (prd.md) from a feature request through clarification, planning and drafting, with globally numbered functional requirements (FR-n). Use when the user asks to create a PRD, define product requirements or document a new feature — also in Portuguese ("criar PRD", "cria o PRD", "escrever requisitos", "documentar a feature"). In an SDD project it writes into the resolved SPEC workspace; standalone it writes to `./tasks/prd-<slug>/`. Do not use for tech specs, task breakdowns or implementation.
argument-hint: "[feature name or description]"
---

# PRD Creation

## SDD Interop (conditional — skip entirely in standalone projects)

If BOTH `docs/.spec-system.json` AND `docs/RULES.md` exist at the project root, the project is governed by the SDD spec system. In that case, and ONLY then:

1. **Workspace**: resolve the workspace from the manifest `interop` mode and the active SPEC (`docs/rules/interop.md`): `inline` → the SPEC folder `docs/active/SPEC-<id>/`; `external` → the `**Workspace:**` path in `main.md` (`tasks/prd-<slug>/`). Every reference in this skill to `./tasks/prd-[feature-slug]/` means the ROOT of that directory. Never use `docs/tasks/` or a `tasks/` subfolder of the SPEC.
2. **Slug**: if a slug/workspace is provided by the caller or manifest, use it verbatim — never derive a new one.
3. **Requirements equivalence**: where a prerequisite requires `prd.md` and it does not exist, accept the SPEC's `main.md` as the equivalent requirements document.
4. **Interview dedupe**: before asking any clarification question, read the SPEC's `main.md` and journal; ask ONLY what is not already answered there, and record inferred answers with their source in the generated document.
5. **Approvals**: governed by the execution mode chosen at the SPEC checkpoint and recorded in the journal (`autonomous | gated`; no recorded mode → `gated`, fail-safe). In `gated`: after generating the PRD, present the FR summary and STOP for explicit user approval (AskUserQuestion) before handing off to the next phase. In `autonomous`: plan/list presentations are informational (record in the journal and proceed). In BOTH modes, decisions that change the SPEC's acceptance criteria or scope ALWAYS require explicit user approval.
6. **Commands**: use the command labels from the SDD manifest (`commands: {test, typecheck, lint, dev, e2e}`) instead of any hardcoded or detected command.
7. **Memory feedback (mandatory final step)**: after this skill's last step, append a dated summary of decisions, deviations and learnings to the active SPEC's journal, and update the `**PRD:**` pointer in the SPEC's `main.md`. Journal entries go ONLY through `node scripts/specctl.mjs log <spec-id> <type> "title"` (multi-line body via `--stdin`; types: discovery | decision | attempt | blocker | note) — never edit the journal's `## LOG` directly (the guard-write hook denies it). Never tick an acceptance criterion by hand; criteria change only via `specctl check`/`verify`.
8. **FR altitude**: an FR names the capability and the service (WHAT), never the mechanism (HOW — transport, endpoint, header name, library). Mechanism belongs to the tech spec (e.g. "Slack (OUTPUT)", not "Slack incoming-webhook") — FRs stay stable when implementation decisions evolve.

If the manifest is absent, ignore this section completely — the standalone behavior below is unchanged.

## Procedures

**Step 1: Validate Prerequisites**
1. Confirm the feature name or description has been provided by the user.
2. If a slug or workspace directory is provided by the caller (or by the SDD manifest), use it verbatim; otherwise derive the slug in kebab-case. Output directory: `./tasks/prd-[feature-slug]/`.

**Step 2: Clarify Requirements (Mandatory)**
1. Ask the user clarification questions using the AskUserQuestion tool before generating any content.
2. Cover all areas of the clarification checklist:
   - **Problem and goals**: what problem to solve, measurable goals.
   - **Users and stories**: primary users, user stories, main flows.
   - **Core functionality**: data inputs/outputs, actions.
   - **Scope and planning**: what is NOT included, dependencies.
   - **Design and experience**: UI/UX guidelines and accessibility.
3. Do NOT proceed to Step 3 until clarification answers are received.

**Step 3: Plan the PRD (Mandatory)**
1. Create a development plan including:
   - Section-by-section approach.
   - Areas requiring research (use web search for business rules when available).
   - Assumptions and dependencies.
2. Present the plan to the user for alignment.

**Step 4: Draft the PRD (Mandatory)**
1. Read the template at `assets/prd-template.md`.
2. Focus on WHAT and WHY, never on HOW (implementation belongs in the tech spec).
3. Number functional requirements globally: `FR-1`, `FR-2`, … — one sequence for the whole document, never restarted per section.
4. Keep the document under 2,000 words.
5. Do NOT deviate from the template structure.

**Step 5: Save the PRD (Mandatory)**
1. Create `./tasks/prd-[feature-slug]/` if it does not exist (in SDD inline mode it is the SPEC folder, which always exists).
2. Save the PRD to `./tasks/prd-[feature-slug]/prd.md`.

**Step 6: Report Results**
1. Provide the final file path.
2. Provide a brief summary of the PRD outcome.

## Core Principles
- Clarify before planning; plan before drafting.
- Minimize ambiguity; prefer measurable statements.
- The PRD defines outcomes and constraints, NOT implementation.
- Always consider usability and accessibility.

## Quality Checklist
- [ ] Clarification questions asked and answered.
- [ ] Detailed plan created.
- [ ] PRD generated from the template.
- [ ] Globally numbered functional requirements (FR-n) included.
- [ ] File saved to `./tasks/prd-[feature-slug]/prd.md`.
- [ ] Final path provided.

## Error Handling
- If the user provides insufficient context, ask follow-up clarification questions before proceeding.
- If the template file is missing, report the error and halt — do not generate a PRD without the template.
- If `prd.md` already exists, confirm with the user before overwriting it. An existing directory alone is not a reason to ask.
