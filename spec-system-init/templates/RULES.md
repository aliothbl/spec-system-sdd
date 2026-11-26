# RULES — SPEC-driven system v4 (core)

Schema: sdd-4.0 · template revision: the one in the manifest `docs/.spec-system.json` (single source). Always loaded via the `@docs/RULES.md` import in CLAUDE.md. Operational detail in `docs/rules/*.md` — read ONLY when needed (map at the end).

## Premises

1. Docs exist so the AI keeps context across sessions: dense, imperative, self-contained. Density > brevity; roll up, never cut.
2. Single exception: each SPEC's `main.md` is the human-validated CONTRACT (R.6.2).
3. Context is DELIVERED by hooks (brief/capsule), not read by ritual; a rule without a mechanism is a bug.

## Rules R.1–R.17 (with sub-rules 6.1/6.2)

| R | Rule | Detail |
|---|---|---|
| 1 | ID = `SPEC-YYYYMMDD-HHMM-slug`, real timestamp via `specctl new`; sequential/reused IDs FORBIDDEN | formats |
| 2 | `docs/active/` ALWAYS empty on `main` — CI gate (`audit --main-gate`) | ci |
| 3 | Canonical: `main.md`+`journal.md`; `digest.md` at close; size-dependent optional files declared | formats |
| 4 | Every SPEC links ≥1 feature, validated against TAXONOMY.md | formats |
| 5 | Lifecycle: NEVER delete; discard/pause preserve; sole exception: R.15 redaction | lifecycle |
| 6 | Timestamp `YYYY-MM-DD HH:MM` on EVERY update (source: injected NOW; missing = ERROR) | formats |
| 6.1 | Real-time progress in main.md (QA/verify mark criteria; never batch); every work artifact has a journal counterpart | lifecycle |
| 6.2 | Defer/postpone/accept incomplete/reduce scope ONLY with the user's explicit authorization (literal quote; `[accepted-incomplete]` marker) — never unilateral, at any time | lifecycle |
| 7 | Features updated on archive, validated by CONTENT in the PR diff | lifecycle |
| 8 | Isolation: other SPECs' journals and archive/ denied by hook; history via digest/ARCHIVE-INDEX | retrieval |
| 9 | Classify every prompt on the answer's 1st line: `[continuation: SPEC-x]` \| `[new]` \| `[free]` (PT repos: `[continuidade: SPEC-x]` \| `[nova]` \| `[livre]`) | lifecycle |
| 10 | Free reading within budgets (manifest policy `strict` re-enables L1 confirmation) | context |
| 11 | Activation creates claim `docs/claims/SPEC-<id>.md`, visible on main | team |
| 12 | Temp files in the SPEC's `tmp/` or `.scratch/`; persistent evidence in `evidence/` | formats |
| 13 | Existing TAXONOMY area = automatic link; NEW area = user confirmation | lifecycle |
| 14 | Program = single manifest `docs/programs/<slug>.md`; Blocks/order are DERIVED | programs |
| 15 | Secrets in docs/ FORBIDDEN → `<REDACTED:type>`; secret-scan; audited exception to append-only | verification |
| 16 | Budgets linted only on always-loaded layers (CLAUDE/AGENTS/RULES) + digest; over budget → move to a deeper layer. INDEX (generated) and features (living memory, unlimited count) have NO cap | context |
| 17 | Commits under an active SPEC carry the trailer `Spec: SPEC-<id>` | lifecycle |

> **R.6 · size and evidence:** Size S closes criteria with timestamp+commit via `specctl check`; `verify:`/`evidence/` are M/L tools. Detail: rules/verification.md.

## Read levels (recommended order + budget)

| L | Source | Budget | When |
|---|---|---|---|
| 0 | brief (SessionStart) + capsule (per prompt) | ~3k tok / 800 B | automatic (hook) |
| 0.5 | ARCHITECTURE.md, CONSTITUTION.md | ~1.8k tok | cross-cutting orientation |
| 1 | features/<area>.md + the SPEC's main.md | no cap (optional rollup) | continuation: auto-load |
| 2 | journal.md — SNAPSHOT (first 60 lines) before the LOG | SNAPSHOT ≤60 lines | resume/detail |
| 3 | archive/ and discard/ → digest.md / ARCHIVE-INDEX first | summary ≤500 tok | historical reasoning |

## Per-file budgets (R.16 — lint)

| File | Cap |
|---|---|
| CLAUDE.md | 6,000 B · AGENTS.md 6,200 B |
| docs/RULES.md (this) | 5,000 B |
| digest.md | 2,000 B |

`INDEX.md` (generated, scales) and `features/<area>.md` (living memory, unlimited count) have **no cap**. `specctl rollup <area>` trims the L1 auto-load when you want — optional, nothing blocks. Detail: rules/context.md.

## When to read what (docs/rules/)

- Create/edit an artifact (main, journal, digest, feature, claim, program, TAXONOMY, import) → `formats.md`; prd/techspec/tasks → `formats-pipeline.md`
- State transition: create, activate, close, discard, pause, resume, import → `lifecycle.md`
- Compaction, context pressure, budget overrun → `context.md`
- L3 history (archive/discard) → `retrieval.md`
- Verification: `verify:`, build→test→secrets gate, graders → `verification.md`
- Program/DAG across SPECs → `programs.md`
- Team: claims, collisions, worktrees, onboarding → `team.md`
- prd harness / external workspace → `interop.md`
- CI gates → `ci.md`
