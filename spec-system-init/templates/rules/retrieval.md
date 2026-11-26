# Retrieval — history access (Level 3)

> **STOP.** This file only applies when investigating non-active SPECs (archive/discard, a non-active SPEC's journal, `*.history.md`). Covers: what the guard allows, the canonical route, and the DISPATCH→EVALUATE→REFINE→LOOP protocol. Otherwise, the brief/`--help` answer.

> On-demand reference (R.8). Read when the task needs history: docs/archive/**, docs/discard/**, a non-active SPEC's journal or features/*.history.md.

## What the guard-read hook allows

PreToolUse `guard-read` covers Read, Grep and Glob — **including tool calls made by subagents** (hooks fire for them too). A subagent gets NO extra access; delegating does not bypass the guard.

| Target | Read | Grep/Glob with `path` there |
|---|---|---|
| `main.md` / `digest.md` of ANY SPEC (archive, discard, future, active) | allowed | as the folder rows below |
| Other files in `docs/archive/SPEC-*/` (journal, prd, evidence, …) | `[guard-read] BLOCKED` unless allowlisted | BLOCKED unless allowlisted; `path: docs/archive` itself always BLOCKED |
| `journal.md`/`state.md`/`memory.md` of a SPEC not in `active/` | BLOCKED unless allowlisted | BLOCKED inside that SPEC folder unless allowlisted |
| Other files of a `future/`/`discard/` SPEC | allowed | BLOCKED inside that SPEC folder unless allowlisted |
| Active SPEC files, features (incl. `*.history.md`), INDEX, ARCHIVE-INDEX, ARCHITECTURE | allowed | allowed |
| `scripts/specctl.mjs` | BLOCKED (use `--help` / `close <id> --dry`) | — |

- Grep/Glob **without** `path` (whole repo) is not blocked; reading the files it lists still goes through the guard.
- **Allowlist (audited exception):** add a line with the SPEC id (or id prefix) to `docs/active/<active-SPEC>/.allow-read`. It unlocks every file of that SPEC for Read/Grep/Glob. Needs an active SPEC. Use rarely and log a `[note]` in the journal with the reason.
- Manifest `policy: strict`: Reads outside the free roots (RULES, rules/, indexes, TAXONOMY, ARCHITECTURE, CONSTITUTION, claims, programs, manifest) and the active SPEC ask the user (R.10); `main.md`/`digest.md` stay free.
- **Bash `cat`/`grep`/`head` on these paths is not intercepted by any hook — it is still FORBIDDEN by R.8.** The rule binds even where the tool doesn't enforce it.

Golden rule: context cost scales with the TASK's scope, never with the project's age. History enters the main window only as a distilled summary.

## Canonical route (cheap to expensive)

1. `docs/ARCHIVE-INDEX.md` — filter by keyword/feature (id, status, features, keywords, 1-line summary).
2. `digest.md` of the candidates (≤2,000 bytes each) — answers most history questions.
3. `main.md` of the SPEC (free) — the contract and its marked criteria.
4. `journal.md` / other files — ONLY if 1–3 don't suffice, via `.allow-read` + `[note]`.

For many candidates, a subagent can run steps 1–3 and return only the distilled summary (keeps the main window clean) — under the same guard, with the same allowlist.

## Protocol: DISPATCH → EVALUATE → REFINE → LOOP (max 3 cycles)

1. **DISPATCH** — broad search: task keywords in ARCHIVE-INDEX + related features. Don't over-specify the first query.
2. **EVALUATE** — score each source 0 to 1: ≥0.8 answers directly; 0.5–0.7 related decision/pattern; <0.2 exclude confidently (won't become relevant). Record explicit GAPS ("found WHAT changed; missing WHY").
3. **REFINE** — adopt the project's real vocabulary revealed in cycle 1 (e.g. the code says "throttle", not "rate limit"); drop the irrelevant; target the gaps.
4. **LOOP** — repeat with the refined query. STOP when there are ≥3 sources scoring ≥0.7 and no critical gap: **3 right files > 10 mediocre ones**. After 3 cycles, return the best set + remaining gaps stated.

## Summary format (≤500 tokens — mandatory)

- **Answer:** 1–3 sentences straight to the question.
- **Sources:** SPEC-id/file per claim.
- **Decisions/gotchas:** relevant DEC-ids and gotchas, 1 line each.
- **Gaps:** what was NOT found — state it, don't invent.

FORBIDDEN to paste raw journal/main content into the summary.

## Minimal example

```
Question: why did we drop the Redis cache?
Cycle 1 — DISPATCH: ARCHIVE-INDEX, keywords "redis|cache" → SPEC-20250412-0910-cache-redis (discarded, feature infra/queue).
Cycle 2 — digest: "network latency cancelled the gain; see DEC-20250413-1120-sqs-memory". Gap: benchmark numbers → journal, [attempt] entry of 2025-04-13 (needs .allow-read).
Summary (5 lines): answer + DEC-id + pointer to the journal + gap "write benchmark was never measured".
```

## When not to bother

Questions about the active SPEC or a feature's current state live in Levels 0–2 (SNAPSHOT, main.md, features/<area>.md): read directly. L3 is for archaeology, not the present.
