> STOP. This file applies only to size L with a pipeline. Covers: prd/techspec/tasks/NN_task/qa/review/bugfix templates. Otherwise the core formats.md answers.

# Pipeline templates (rules/formats-pipeline.md)

Optional size L artifacts, at the ROOT of the SPEC folder (or of the declared workspace — rules/interop.md), declared by pointer in `main.md` right after the header fields. Pointer = `**<Key>:** <path> (YYYY-MM-DD HH:MM)`; the path (before ` (`) resolves against the SPEC folder or the repo root; pointer with no file = lint warning. Keys the CLI checks: `PRD`, `TechSpec`, `Tasks`, `QA`, `Review`, `Bugfix`, `Bugs`, `Evidence`.

```markdown
**PRD:** prd.md (YYYY-MM-DD HH:MM)
**TechSpec:** techspec.md (YYYY-MM-DD HH:MM)
**Tasks:** tasks.md (YYYY-MM-DD HH:MM)
**QA:** qa-report.md (YYYY-MM-DD HH:MM)
**Review:** review-report.md (YYYY-MM-DD HH:MM)
**Bugfix:** bugfix-report.md (YYYY-MM-DD HH:MM)
**Bugs:** bugs.md (YYYY-MM-DD HH:MM)
**Evidence:** evidence/ (YYYY-MM-DD HH:MM)
```

Same names/shapes as the prd harness (`tasks/prd-<slug>/`) — projects switch between standalone and harness without rework.

**FR-N convention (global):** functional requirements numbered `FR-1..FR-n`, GLOBAL and sequential across the whole `prd.md` (never restarts per section; `RF-N` is still accepted). Every FR is covered by ≥1 main.md criterion via `(covers FR-n)` — lint validates when `prd.md` exists. **FR altitude:** the FR names the capability and the service (WHAT), never the mechanism (HOW — transport, endpoint, header, lib); mechanism belongs in the techspec (e.g. "Slack (OUTPUT)", not "Slack incoming-webhook") — the FR stays stable when the implementation decision evolves.

## Minimum procedure per artifact

(Distilled from the harness; when maximum rigor matters, use the harness via interop.)

- **PRD:** read main.md + journal FIRST and ask ONLY what is still unanswered (dedupe); clarify with the user before drafting; PRD = WHAT/WHY, <2,000 words, ZERO design solution; FRs at capability altitude (never mechanism — see FR-N convention); refine main.md criteria with `(covers FR-n)` — contract change = human validation.
- **TechSpec:** research FIRST (the codebase's own patterns + lib docs); techspec = HOW, does NOT repeat the PRD; decisions with effect beyond the SPEC → `[decision]` in the journal (promoted to features at close).
- **Tasks:** propose the HIGH-LEVEL list and get approval BEFORE generating the `NN_task.md` files; max 15 tasks; each task = incremental functional deliverable WITH its own test suite.
- **QA/evidence:** raw evidence in `tmp/`; cited evidence → `evidence/` with a deterministic name; passed QA stamps the covered main.md criteria via `specctl check`/`verify` with evidence (R.6.1).
- **At close (human decision, no CLI gate):** a `qa-report.md` with verdict `REJECTED`, a feature review `REJECTED`, or a `bugs.md` entry with severity `Critical`/`High` and status `Open`/`Reopened` does NOT block archive in the CLI. `/spec close` MUST surface them to the user, who decides (fix now / new SPEC / accept the gap with a quote — R.6.2).

## 1. `prd.md` template

```markdown
# PRD — [Feature]

**Origin:** local | imported (team X, YYYY-MM-DD, vN)

## Overview
[What problem it solves, for whom, why it is valuable.]

## Goals
[Specific, measurable goals: what success looks like, key metrics, business goals.]

## User Stories
[As a [user type], I want [action] so that [benefit]. Primary and secondary personas; main flows and edge cases.]

## Core Features
[For each feature: what it does, why it matters, how it works at a high level.
Functional requirements numbered FR-1..FR-n — GLOBAL numbering across the document.]

## User Experience
[Personas and needs; main flows and interactions; UI/UX; accessibility.]

## High-Level Technical Constraints
[ONLY constraints — design solutions belong in the techspec: external integrations, compliance/regulatory/security, performance/scalability targets, data sensitivity/privacy, non-negotiable technology/protocol.]

## Out of Scope
[What this feature will NOT include: explicit exclusions, future considerations, limits.]
```

## 2. `techspec.md` template

````markdown
# TechSpec — [Feature]

## Executive Summary
[Technical view of the solution: main architectural decisions + strategy, 1-2 paragraphs.]

## System Architecture

### Component Overview
[Components and responsibilities — list EVERY new or modified component; relationships; data flow.]

## Implementation Design

### Main Interfaces
[Main service interfaces, ≤20 lines per example:]
```
type ServiceName interface {
    MethodName(ctx, input) (output, error)
}
```

### Data Models
[Domain entities; request/response types; database schemas, if applicable.]

### API Endpoints
[Method and path (e.g. `POST /api/v0/resource`); description; req/resp formats.]

## Integration Points
[Only if there is external integration: services/APIs, authentication, error handling.]

## Testing Approach

### Unit Tests
[Components to test; mocks (external services only); critical scenarios.]

### Integration Tests
[If needed: components tested together; test data.]

### E2E Tests
[If needed: frontend together with backend, using Playwright.]

## Development Sequencing

### Build Order
[1. First component (why); 2. dependencies; 3. subsequent; 4. integration and tests.]

### Technical Dependencies
[Blockers: required infrastructure, external services.]

## Monitoring and Observability
[Metrics to expose, main logs and levels, integration with existing dashboards.]

## Technical Considerations

### Key Decisions
[Choice + rationale; trade-offs; rejected alternatives and why.]

### Known Risks
[Potential challenges; mitigation; areas needing research.]

### Standard Skills Compliance
[If the project has .claude/skills/, list the ones that apply to this techspec.]

### Relevant and Dependent Files
[Relevant and dependent files.]
````

## 3. `tasks.md` template

```markdown
# Implementation Task Summary for [Feature]

## Tasks

- [ ] 1.0 Task Title
- [ ] 2.0 Task Title
```

## 4. `NN_task.md` template

File name: two-digit zero-padded task number — `01_task.md`, `02_task.md`, …; its review is `01_task_review.md`.

```markdown
# Task X.0: [Task Title]

<critical>Read prd.md and techspec.md in this folder (SPEC root); without that reading the task is invalid</critical>

## Overview
[Short task description.]

<skills>
### Standard Skills Compliance
[If the project has .claude/skills/, list the ones that apply to this task.]
</skills>

<requirements>
[Mandatory requirements — reference the FR-n covered.]
</requirements>

## Subtasks
- [ ] X.1 [Subtask description]
- [ ] X.2 [Subtask description]

## Implementation Details
[Reference techspec.md — do not repeat the implementation.]

## Success Criteria
- [Measurable results; quality requirements.]

## Task Tests
- [ ] Unit tests
- [ ] Integration tests
- [ ] E2E tests (if applicable)

<critical>ALWAYS CREATE AND RUN THE TASK TESTS BEFORE CONSIDERING IT DONE</critical>

## Relevant Files
- [Files relevant to this task.]
```

**Task checkboxes in R.6 format:** on completion, EVERY checkbox in `tasks.md` and `NN_task.md` (tasks, subtasks, tests) is ticked as `- [x] X.1 Description (YYYY-MM-DD HH:MM, commit `hash`)`. `[x]` without timestamp = lint ERROR. Non-overlapping progress altitudes: a task closes in `tasks.md`, a phase in the SNAPSHOT, a criterion in `main.md` (only via `check`/`verify`).

## 5. QA / review / bugfix

| Artifact | What |
|---|---|
| `bugs.md` | QA bugs: severity (`Critical`/`High`/`Medium`/`Low`), evidence, status (`Open`/`Fixed`/`Verified`/`Reopened`/`Not reproducible`) — append-only contract in rules/interop.md |
| `qa-report.md` · `review-report.md` · `bugfix-report.md` | pipeline reports (from skills `sdd-run-qa` / `sdd-review-feature` / `sdd-fix-bugs`). QA per FR: `PASSED`/`FAILED`, report verdict `APPROVED`/`REJECTED`; feature review `APPROVED`/`APPROVED WITH OBSERVATIONS`/`REJECTED` |
| `NN_task_review.md` | per-task review (`sdd-review-task`): `APPROVED`/`APPROVED WITH OBSERVATIONS`/`CHANGES REQUESTED` |
| `evidence/` | PERSISTENT evidence cited in a report/criterion (deterministic name) |
| `intake/` | ORIGINAL imported artifacts, verbatim (never rewritten; re-imports versioned: `intake/prd-v2.md`) |
| `tmp/` | temporary — gitignored (R.12); raw evidence starts here |

Every pipeline artifact MUST have a journal counterpart (`[note]/[decision]/[discovery]` via `specctl log` — R.6.1); `specctl audit` warns about an artifact with no counterpart.
