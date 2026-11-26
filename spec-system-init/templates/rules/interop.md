# Interop — the prd harness under SDD governance

> **STOP.** This file applies only if the manifest has `interop` ≠ `none`. Covers: how the prd harness runs under v4 governance (external/inline workspace, import, adopt-workspace). Otherwise the brief/--help answer.

> Read when: the manifest has `interop: external|inline`, when running any prd pipeline skill (sdd-create-prd → sdd-fix-bugs), when importing another team's artifacts (`/spec import`), or when closing a SPEC with a workspace.

## Roles: v4 governs, the harness executes

The prd harness is an optional executor. Layers, not parallel tracks: v4 is the outer ring — contract (main.md), cross-session memory (journal/features), acceptance (R.6.2), lifecycle; the pipeline is the execution core inside the ring. What NEVER happens: the pipeline deciding acceptance (R.6.2 belongs to the ring) or memory living in the techspec (decisions with effect beyond the SPEC are promoted to features/ at close).

**Distribution:** init VENDORS the pipeline by default — the harness `templates/skills/` + `templates/agents/` → the PROJECT's `.claude/skills/` and `.claude/agents/` (self-contained repo; devs and CI on the same version) — and writes `interop` to the manifest (default with pipeline: `inline`). The vendored copy in `.claude/skills/` is the canonical executor. Global copies in `~/.claude/skills/` with the same name can shadow or duplicate it: remove stale global copies, and after upgrading remove the old PT-named folders (`cria-prd`, `cria-techspec`, `criar-tasks`, `executar-task`, `task-review`, `executar-review`, `executar-qa`, `executar-bugfix`, agent `task-reviewer`) from both `.claude/` and `~/.claude/`.

## Size decides when the pipeline comes in

Proposed by the AI at the checkpoint (signals: estimated files, features touched, number of criteria), confirmed by the user in the same round-trip:

| Size | Process | Pipeline |
|---|---|---|
| **S** (small) | minimal main.md (goal + 1-3 criteria) + journal | NONE — minutes to code |
| **M** (medium) | full main.md (1-page contract = mini-PRD) + `verify:` + phases in the SNAPSHOT | no — no separate prd/techspec |
| **L** (large) | multi-session/multi-area | full OR partial (à la carte: techspec only when architecture is the hard part; tasks only when contract + design are clear) — via harness (this doc) or standalone (`docs/rules/formats.md`) |

A one-off fix never sees the pipeline. Legitimate mid-course escalation: `specctl escalate <id> <M|L>` (logs a `[note]`).

**Size L ⇒ the pipeline path is an EXPLICIT checkpoint question** (`full | techspec only | tasks only | no pipeline`, with a justified recommendation), confirmed by the user in the same round-trip as the size and BEFORE drafting main.md — never an implicit choice embedded in the contract. With a pipeline, the same question collects the **execution mode** `autonomous | gated` (preamble item 5 below). Details and recommendation criteria: rules/lifecycle.md §1.

## 1 feature = 1 SPEC (phases, never one SPEC per phase)

PRD, techspec, tasks and QA are NOT SPECs — they are PHASES of a single SPEC; the whole pipeline arc is one deliverable. main.md is born BEFORE everything (lean summary contract, validated at the checkpoint); the journal spans every session of the arc — the memory the pipeline lacks on its own. Exception: a giant feature becomes a PROGRAM (`docs/rules/programs.md`) and its blocks become their own SPECs.

## Workspace modes (manifest `interop:`)

| Mode | Artifacts live at the ROOT of | Field in main.md |
|---|---|---|
| `none` | pipeline does not run; size L uses the native templates | `**Workspace:** —` |
| `external` | `tasks/prd-<slug>/` — the skills' own path, untouched | `**Workspace:** tasks/prd-<slug>/` |
| `inline` | the SPEC folder (`docs/active/SPEC-<id>/`) | `**Workspace:** inline` |

Never `docs/tasks/`. Chosen PER PROJECT, written to the manifest and injected by the capsule on every prompt (`workspace=<mode>`). The main.md Workspace/Size fields are filled by specctl at activation.

**`external` anti-conflict rule:** external skills write to THEIR paths — do NOT redirect their outputs. v4 yields path authority inside the workspace; in exchange it is declared, secret-scanned and auditable. The skills create `evidence/` and `tmp/` in the workspace (and ensure `tasks/**/tmp/` is gitignored). At closing, `specctl adopt-workspace <id>` COPIES a snapshot of the artifacts into the SPEC folder BEFORE `specctl close <id>` — the archive is self-contained AND the original workspace stays in place (a future /sdd-fix-bugs depends on the original path). The workspace is NEVER moved.

**`inline` rule (SINGLE path substitution):** injected by the capsule: "WORKSPACE: `docs/active/SPEC-<id>/` — replace `./tasks/prd-<slug>/` with this path in ALL steps, read AND write". The whole chain uses the SAME substituted path, so the skills' prerequisite checks stay consistent. Everything archives together; adopt-workspace is unnecessary.

Rejected by design: a parallel `docs/tasks/prd-*/` tree — it changes the skills' convention AND sits outside the SPEC lifecycle.

## The "SDD Interop" preamble in the skills

The 8 harness skills (sdd-create-prd, sdd-create-techspec, sdd-create-tasks, sdd-run-task, sdd-review-task, sdd-review-feature, sdd-run-qa, sdd-fix-bugs) carry a `## SDD Interop (conditional)` section at the top. frontend-design does not (guidelines, no workspace artifacts). DOUBLE detection: the preamble activates only if `docs/.spec-system.json` AND `docs/RULES.md` exist — an orphan manifest does not hijack the skill; without a manifest, standalone behavior byte for byte. When active, it does 7 things:

1. **Workspace** — resolves the working directory from the manifest/active SPEC; every skill reference to `./tasks/prd-[slug]/` means the resolved directory (this implements the two modes above).
2. **Verbatim slug** — a slug/workspace given by the caller or manifest is used as is; the skill never derives a second identifier for the same feature.
3. **main.md as PRD-equivalent** — the "prd.md exists" prerequisite accepts the SPEC's main.md as the requirements document (enables à la carte partial size L).
4. **Interview dedupe** — before any clarifying question, the skill reads main.md + journal and asks ONLY what is still unanswered, recording inferred answers with their source.
5. **Approvals — governed by the execution mode** from the checkpoint, recorded in the journal (`autonomous | gated`; no record → `gated`, fail-safe): in `autonomous`, plan/list presentations are informational (log to the journal and proceed); in `gated`, the skill STOPS for explicit approval at 4 points — after /sdd-create-prd (FRs), after /sdd-create-techspec (design decisions), after /sdd-create-tasks (task list) and BEFORE each /sdd-run-task. In BOTH modes, decisions that change acceptance criteria or SPEC scope ALWAYS require explicit user approval. In sdd-fix-bugs: autonomous implementation, EXCEPT a fix that changes a contracted criterion (1 question per affected criterion) — aligns "do not wait for approval" with R.6.2.
6. **Commands** — the manifest labels (`commands: {test, typecheck, lint, dev, e2e}`) take precedence over any hardcoded/detected command.
7. **Feedback (mandatory final step)** — a dated summary of decisions/deviations/learnings appended to the journal ONLY via `specctl log <id> <type> "title" --stdin` (never a direct Edit of the LOG) + artifact pointers updated in main.md. sdd-run-qa also stamps criteria covered by a verified FR ONLY via `specctl check <id> <n> --evidence "<link>"` / `specctl verify <id>` (never a hand-written `[x]`); sdd-fix-bugs records root causes as candidate gotchas for the touched features.

Graceful degradation: without specctl the preamble falls back to plain file operations for artifacts; the journal LOG and criterion stamps still require specctl — if it is missing, report and stop instead of writing them by hand.

## Phase → skill → artifact → feedback map

Artifacts at the workspace ROOT + `evidence/` (persistent) + `tmp/` (gitignored).

| Phase (SNAPSHOT) | Skill | Artifact | Immediate feedback (done by the SESSION) |
|---|---|---|---|
| Contract | — (checkpoint + plan mode) | lean `main.md` (seed, not quasi-PRD) | human validation = contract v1 |
| 1. Requirements | /sdd-create-prd | `prd.md` (FR-N) | `**PRD:**` pointer in the header; criteria ↔ `(covers FR-n)` — contract change → human validation (2nd and last gate); answers → SNAPSHOT "Key user answers"; `[note]` in LOG |
| 2. Design | /sdd-create-techspec | `techspec.md` | `[decision]` in LOG (DEC-id candidates for the feature at close); `**TechSpec:**` pointer |
| 3. Breakdown | /sdd-create-tasks | `tasks.md` + `NN_task.md` (`01_task.md`…) | `**Tasks:**` pointer; SNAPSHOT re-maps phases→blocks ("Phase 4 = tasks 3.0-5.0") |
| 4..N. Execution | /sdd-run-task (+ sdd-review-task, agent `sdd-task-reviewer`) | code + `tasks.md` ticked (R.6 format) + `NN_task_review.md` | `[attempt]/[discovery]` in LOG; SNAPSHOT per milestone; `Spec:` trailer (R.17); R.6.1 |
| Review | /sdd-review-feature | `review-report.md` | techspec deviation → `[decision]` / candidate rejected alternative; `**Review:**` pointer |
| QA | /sdd-run-qa | `qa-report.md` + `bugs.md` + `evidence/FR-XX-*.png` | FR `PASSED` → stamp `(covers FR-n)` criteria via `check`/`verify` with evidence link; `FAILED` → bugs.md, criterion stays `[ ]`; `**QA:**`/`**Bugs:**` pointers |
| Bugfix | /sdd-fix-bugs | fixes + updated `bugs.md` + `bugfix-report.md` | root cause → `[discovery]` + candidate gotcha; `**Bugfix:**` pointer |
| Closing | `/spec close` (v4, never a skill) | `digest.md` | surface REJECTED reports and open `Critical`/`High` bugs for a user decision → R.6.2 item by item → gotchas → `specctl adopt-workspace <id>` (external; run it BEFORE close) → `specctl close <id>` (verify + digest + archive) |

**Three progress altitudes, zero overlap:** a task closes in `tasks.md`; a phase in the SNAPSHOT; a criterion in `main.md`.

**bugs.md contract** (the skill's assets/bugs-template.md): append-only — never overwrite/delete entries; continuous `BUG-NN` IDs across runs; Severity ∈ `Critical | High | Medium | Low`; Status ∈ `Open | Fixed | Verified | Reopened | Not reproducible`; re-QA re-tests every `Fixed` → `Verified` or `Reopened`; each bug points to `Affected requirement: FR-XX` and evidence in `evidence/`; `Fix applied`/`Regression tests` are filled by sdd-fix-bugs.

**Who updates what:** pointers and phases = the SESSION, right after each skill (R.6.1 — real time, never batched at close); Workspace/Size = specctl at activation; criteria↔FR = session proposes, user validates; criterion stamps = `specctl check`/`verify` only (post-QA with evidence). **QA APPROVED does not close** — closing is always a human decision, and `close` is the only closing path (`archive` is internal).

## Importing external artifacts — `/spec import`

Golden rule: **a received artifact is INPUT, not contract** — main.md remains the local contract (local R.6.2 authority; the origin team's acceptance, if needed, becomes a `| evidence: manual @user` criterion).

1. **Ingest with provenance:** original kept as received in `intake/` (never rewritten) + `prd.md` normalized to the template with `**Origin:** imported (team X, date, vN)` and FR-N extracted under user confirmation. Once normalized, the skills consume it unchanged.
2. **Normal checkpoint** (TAXONOMY feature + size).
3. **main.md derived FROM the PRD**, criteria `(covers FR-n)`, human validation; phase marked `imported (team X)` in the SNAPSHOT.
4. **Conflict check against living memory:** the import is checked against the features' active decisions and the CONSTITUTION BEFORE acceptance ("PRD assumes Redis; DEC-x standardized on SQS — conflict to raise with team X") — cross-team contradictions caught before code.
5. **Cycle resumes at the first MISSING phase:** PRD only → techspec; PRD+techspec → tasks; everything → execution. Received tasks stay as reference in `intake/` and are NOT normalized — re-plan locally with /sdd-create-tasks using them as input (the local team knows the code).

A new artifact version arrives → `/spec import` again: diff vN×vN+1 → `[decision]` in the journal → affected criteria revised with human validation.

## The line not to cross

**One governance owner, never two.** Either v4 orchestrates (with or without the harness executing the core), or the project uses only the harness — never two owners of memory/acceptance. Known frictions of the mixed mode (accepted, with backstop):

- autonomous fix touching a contracted criterion → TIER-0 re-injected per prompt + close gate (open criteria hold);
- session neglecting feedback → Stop hook + audit warning "pipeline artifacts with no journal counterpart";
- inline: model forgetting the substitution mid-chain → the capsule re-injects the workspace on every prompt.
