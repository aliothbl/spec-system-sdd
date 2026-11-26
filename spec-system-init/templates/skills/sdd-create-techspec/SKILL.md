---
name: sdd-create-techspec
description: Creates a Technical Specification (techspec.md) from an existing PRD, translating product requirements into architectural decisions and implementation guidance. Performs deep project analysis and uses Context7 MCP and web search (when available) for research. Use when the user asks to create a tech spec, define the architecture or plan the implementation of a feature that has a PRD — also in Portuguese ("criar techspec", "cria a tech spec", "especificação técnica", "definir arquitetura"). Do not use for PRD creation, task breakdowns or direct code implementation.
argument-hint: "[feature-slug | SPEC-id]"
---

# Tech Spec Creation

## SDD Interop (conditional — skip entirely in standalone projects)

If BOTH `docs/.spec-system.json` AND `docs/RULES.md` exist at the project root, the project is governed by the SDD spec system. In that case, and ONLY then:

1. **Workspace**: resolve the workspace from the manifest `interop` mode and the active SPEC (`docs/rules/interop.md`): `inline` → the SPEC folder `docs/active/SPEC-<id>/`; `external` → the `**Workspace:**` path in `main.md` (`tasks/prd-<slug>/`). Every reference in this skill to `./tasks/prd-[feature-slug]/` means the ROOT of that directory. Never use `docs/tasks/` or a `tasks/` subfolder of the SPEC.
2. **Slug**: if a slug/workspace is provided by the caller or manifest, use it verbatim — never derive a new one.
3. **Requirements equivalence**: where a prerequisite requires `prd.md` and it does not exist, accept the SPEC's `main.md` as the equivalent requirements document.
4. **Interview dedupe**: before asking any clarification question, read the SPEC's `main.md` and journal; ask ONLY what is not already answered there, and record inferred answers with their source in the generated document.
5. **Approvals**: governed by the execution mode chosen at the SPEC checkpoint and recorded in the journal (`autonomous | gated`; no recorded mode → `gated`, fail-safe). In `gated`: after generating the tech spec, present the key design decisions and STOP for explicit user approval (AskUserQuestion) before handing off to the next phase. In `autonomous`: plan/list presentations are informational (record in the journal and proceed). In BOTH modes, decisions that change the SPEC's acceptance criteria or scope ALWAYS require explicit user approval.
6. **Commands**: use the command labels from the SDD manifest (`commands: {test, typecheck, lint, dev, e2e}`) instead of any hardcoded or detected command.
7. **Memory feedback (mandatory final step)**: after this skill's last step, append the key technical decisions (with trade-offs) as dated `decision` entries to the active SPEC's journal, and update the `**TechSpec:**` pointer in the SPEC's `main.md`. Journal entries go ONLY through `node scripts/specctl.mjs log <spec-id> <type> "title"` (multi-line body via `--stdin`; types: discovery | decision | attempt | blocker | note) — never edit the journal's `## LOG` directly (the guard-write hook denies it). Never tick an acceptance criterion by hand; criteria change only via `specctl check`/`verify`.

If the manifest is absent, ignore this section completely — the standalone behavior below is unchanged.

## Procedures

**Step 1: Validate Prerequisites**
1. Confirm the feature slug has been provided.
2. Verify the PRD exists at `./tasks/prd-[feature-slug]/prd.md`. If missing, halt and report.

**Step 2: Analyze the PRD (Mandatory)**
1. Read the PRD completely — do NOT skip this step.
2. Identify technical content, constraints and success metrics.
3. Extract the core requirements that need architectural consideration.

**Step 3: Deep Project Analysis (Mandatory)**
1. Explore the codebase to discover files, modules, interfaces and integration points.
2. Map symbols, dependencies and critical paths.
3. Analyze callers/callees, configs, middleware, persistence, concurrency, error handling, tests and infra.
4. Explore solution strategies, patterns, risks and alternatives.

**Step 4: Research (Mandatory)**
1. Use Context7 MCP to resolve technical questions about frameworks and libraries.
2. When web search is available, use it to gather business rules and general information the codebase cannot answer.
3. Complete the research BEFORE asking clarification questions.

**Step 5: Technical Clarifications (Mandatory)**
1. Explore the project BEFORE asking questions.
2. Ask focused clarification questions with the AskUserQuestion tool, covering:
   - Domain positioning.
   - Data flow.
   - External dependencies.
   - Key interfaces.
   - Test scenarios.
3. Do NOT proceed until answers are received.

**Step 6: Standards Compliance Mapping (Mandatory)**
1. Identify the project conventions (CLAUDE.md, CONSTITUTION.md, linter/formatter config) and applicable skills: project skills in `.claude/skills/` and relevant user-level skills (e.g. `frontend-design` for UI features, if installed).
2. Highlight deviations with justification and compliant alternatives.

**Step 7: Generate the Tech Spec (Mandatory)**
1. Read the template at `assets/techspec-template.md`.
2. Provide: architecture overview, component design, interfaces, data models, endpoints, integration points, impact analysis, test strategy, observability.
3. Focus on HOW, not WHAT (the PRD owns what/why).
4. Do not repeat the PRD's functional requirements; reference them by FR-n.
5. The spec is a specification, NOT detailed implementation code.
6. Keep it under ~2,000 words.
7. Do NOT deviate from the template structure.
8. Prefer existing libraries over custom development.

**Step 8: Save the Tech Spec (Mandatory)**
1. Save to `./tasks/prd-[feature-slug]/techspec.md`.
2. Confirm the write and the path.

## Core Principles
- The tech spec focuses on HOW, not WHAT (the PRD owns what/why).
- Prefer simple, evolutionary architecture with clear interfaces.
- Address testability and observability upfront.
- Prefer existing libraries over custom solutions.

## Quality Checklist
- [ ] PRD reviewed.
- [ ] Deep repository analysis completed.
- [ ] Key technical clarifications answered.
- [ ] Tech spec generated from the template.
- [ ] Project conventions and skills checked for compliance.
- [ ] File written to `./tasks/prd-[feature-slug]/techspec.md`.
- [ ] Final output path provided and confirmed.

## Error Handling
- If the PRD does not exist at the expected path, halt and ask the user to create it first with the `sdd-create-prd` skill (`/sdd-create-prd`).
- If Context7 MCP is unavailable, fall back to web search for technical documentation; if neither is available, rely on local documentation and the codebase, and note the limitation in the tech spec.
- If `techspec.md` already exists, confirm with the user before overwriting it. An existing directory alone is not a reason to ask.
