# Context — budgets, compaction and pressure

> On-demand reference (R.16). Read when a budget overflows, before compacting, or when you notice context pressure. Do not repeat the core: docs/RULES.md is already loaded via the `@docs/RULES.md` import in CLAUDE.md.

## Per-layer budgets (linted — R.16)

| Layer | Cap | Enforcement |
|---|---|---|
| CLAUDE.md | 6,000 bytes | lint (error) |
| AGENTS.md | 6,200 bytes (carries "No hooks?" that CLAUDE.md doesn't need) | lint (error) |
| docs/RULES.md (core) | 5,000 bytes | lint (error) |
| digest.md (archive and discard) | 2,000 bytes | lint (error) |
| journal SNAPSHOT | first 60 lines of the file | lint (error) |
| Per-prompt capsule | 800 bytes | by construction (specctl capsule) |
| L3 history summary | ≤500 tokens | protocol in docs/rules/retrieval.md |
| docs/INDEX.md | **no cap** | generated (scales with features×SPECs); per-entry discipline (1 line/SPEC) |
| docs/features/<area>.md | **no cap** | living memory per area, unlimited count; `rollup` is manual/optional |

**Nature of the caps.** CLAUDE/AGENTS/RULES are **always loaded once per session** (cached; cheap to re-read per turn) — the cap there is an **ATTENTION budget, not a token-cost one**: the layer must stay high-signal for TIER-0 to be respected (bloat → skim → bans lose force). The **capsule (800 B)** is the ONLY per-prompt layer (multiplied per turn) — the most sensitive. The **digest** is capped by definition (summary of finished work; uncapped it becomes a copy of the archive). Rule: only what deserves the model's attention on EVERY turn goes into capped layers; situational detail goes to `rules/*` (read on demand).

**Uncapped (on purpose).** `INDEX.md` is a **generated** enumeration — it grows with the system; capping it would be a category error (deadlock: generated files are not edited). `features/<area>.md` is **living memory per area** with unlimited areas — capping would limit how much the product can accumulate. There the discipline is **content**, not bytes (INDEX: 1 line per SPEC; feature: current state + live decisions on top). If an area's L1 auto-load feels too heavy, `specctl rollup <area>` moves old blocks (intact) to `<area>.history.md` — **optional, your call, nothing blocks**.

## Budget overflow: move, NEVER delete

Deleting rich context is FORBIDDEN. MANDATORY: move it to the deeper layer:

- `features/<area>.md` has no cap, but if the L1 auto-load weighs too much (your call) → optional `rollup` of the oldest blocks to `features/<area>.history.md` (intact blocks, with SPEC-id/DEC-id; the live file keeps current state + active decisions).
- SPEC closing → `digest.md` holds the essentials; main+journal stay intact in `docs/archive/` (retrievable via docs/rules/retrieval.md).
- SNAPSHOT bloating → detail goes down to the LOG (append-only); the SNAPSHOT keeps only the current state.

## Unit of persistence: checkpoint, not "end of session"

End of session is undecidable under auto-compact. Persist per milestone: on finishing a phase, logging `[MILESTONE]`, making a relevant decision — and ALWAYS before compacting — rewrite the SNAPSHOT and append to the LOG.

**The flush is YOUR job, before `/compact`.** The PreCompact hook runs, but its output does NOT reach the model in Claude Code — nothing forces or reminds the flush at compaction time. If the journal doesn't reflect the real state, write it FIRST, then compact. Auto-compact gives no warning: the `[context]` hint (below) is your signal to plan the flush at the next phase boundary. Compacting without a flush = losing the session.

After compaction, the SessionStart `compact` hook re-injects `brief --compact` (bans + SNAPSHOT + NOW); CLAUDE.md and its `@docs/RULES.md` import are reloaded by Claude Code.

## When to compact (decide at phase transitions)

| Transition | Compact? | Why |
|---|---|---|
| Research → plan | YES | research is bulky; the plan is the distillate |
| Plan → implementation | YES | plan is already in main/journal; free the window for code |
| Implementation → tests | MAYBE | keep if tests reference freshly written code |
| Debugging → next phase | YES | debug traces pollute the next work |
| MIDDLE of implementation | NO | losing names, paths and partial state is expensive |
| After a failed approach | YES | log `[attempt]` in the LOG and clear the dead end |

## What survives × what is lost

| Survives | Lost |
|---|---|
| Everything on disk: journal, main, features, code, git | Unrecorded reasoning and analysis |
| Re-injected brief (SessionStart `compact`: bans + SNAPSHOT + NOW) | Contents of files already read |
| CLAUDE.md (+ imported RULES.md) / AGENTS.md | User's verbal answers not copied to the journal |
| — | Tool-call history |

Consequence: key user answers, decisions and state MUST be in the journal BEFORE `/compact` — afterwards is too late.

## /compact with a directed summary

Never compact "dry". Direct what to keep:

```
/compact Focus: SPEC-20260702-1030-parser, phase 3 (validation). Keep: PEG grammar decision, paths src/parser/*. Drop: phase 1 regex exploration.
```

## Context-pressure signals

- Re-asking what the user already answered; re-reading files already read.
- Forgetting R.9 classification, the declared workspace or TIER-0 bans.
- Slower, generic or incoherent answers.
- **Automatic signal:** guard-write injects `[context] ~Nk tokens (X% of window)` when REAL context crosses the threshold (default 160k; 250k on 1M windows; window: env > manifest `context_window` > transcript detection; repeats every +60k; env `COMPACT_CONTEXT_THRESHOLD`/`COMPACT_CONTEXT_INTERVAL` override, threshold `0` disables). On seeing it: continue to the phase boundary, flush, and compact with direction — never cut mid-implementation.

Action: flush SNAPSHOT/journal → directed `/compact` → the post-compact brief re-anchors the session.
