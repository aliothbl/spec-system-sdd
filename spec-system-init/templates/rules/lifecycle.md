# SPEC lifecycle (rules/lifecycle.md)

> Read on EVERY state transition: create, activate, execute (checkpoint), resume, close, discard, pause, import. The hot path below covers the common case; go deeper only for rare cases. Status: `draft | active | paused | done | discarded`. Folder↔status coherence (lint): `active/`→active · `future/`→draft or paused · `archive/`→done · `discard/`→discarded. **NEVER delete or rename a SPEC** — sole exception: secret remediation (R.15, see rules/verification.md).

## Hot path (the whole cycle in ~20 lines)

The common SPEC cycle, with the EXACT commands. Detail and rare cases: sections below.

**Open** — on a feature branch (`main` only accepts `--future`). `new` already activates: it creates the folder in `active/`, the journal, the `[activation]` entry and the claim. Do not run `activate` afterwards.
```
node scripts/specctl.mjs new <slug> --size S|M|L --owner @you --features area
```
Draft for later: `new <slug> --future` (in `future/`); when you start on it, `activate <id>` on the feature branch. `activate` is only for `future/` drafts.

**Work** — at the moment of the event, never in batch:
- Size **S** criterion delivered → `node scripts/specctl.mjs check <id> <n>` (stamps timestamp+commit; refuses a criterion with `verify:`).
- Size **M/L** criterion with `verify:` → `node scripts/specctl.mjs verify <id>` (runs the pending criteria's tests, writes `[x]` with evidence). Do not add `--all`: it re-runs criteria already `[x]`.
- Decision/discovery/attempt/blocker → `node scripts/specctl.mjs log <id> <type> "title"` (appends to the LOG; the tool attaches commit+diffstat).
- Milestone/phase change → overwrite the SNAPSHOT (direct Edit).

**Close** — human decision; R.6.2 item by item (§5.1):
```
node scripts/specctl.mjs close <id> --dry   # lists what is missing; mutates nothing
node scripts/specctl.mjs close <id>          # stage → validate EVERYTHING → move to archive/
```
`digest` runs AUTOMATICALLY inside `close` — **never count bytes by hand**. `check`/`verify` reaching n/n already point to `close --dry`. Never call `archive` directly: `close` is the path. (Features have no size management; `rollup` is manual/optional.)

### Git finalization — the MODEL asks and runs (specctl NEVER merges/pushes/deletes on its own)

`close` archives the SPEC and prints the finalization menu (current branch + detected `base` — the branch the work came from, recorded in the claim at activation). These actions are outward-facing/irreversible: **ask before each one, item by item**, then run git. Do NOT automate.

1. **Commit** (`git add -A && git commit` with the trailer `Spec: SPEC-<id>`); then ask the integration route: **(a) direct merge into base** (`git checkout <base> && git merge --no-ff <branch>`) **OR (b) push + PR** (`git push -u origin <branch>` and open the PR to `<base>` — docs-gate runs on the PR). The user chooses; when in doubt, PR.
2. **Back to base?** — ask whether to run `git checkout <base> && git pull` to get the current repo state.
3. **Delete the work branch?** — ask before `git branch -d <branch>` (and `git push origin --delete <branch>` if remote). Only after the merge/PR is resolved.

Hard invariant: **all work lives on its own branch** — an active SPEC is forbidden on a protected branch (manifest `protected_branches`, default `main/master/develop/homolog/hmg`); `new`/`activate`/`resume` and guard-write block it. Adjust the list per project in the manifest (e.g. `trunk`).

## Rare cases

Situational detail below. Come here only for: discovering the next work, pause/resume, discard, escalating or deescalating size (`escalate` one-way · `deescalate --quote`), importing an artifact, or recovery reconciliation (edge).

---

## 0. Discovery — what to pick next (`docs/active/` empty)

With no active SPEC and a "go on"/"next" request: the **SessionStart brief** (already injects the summary) → `node scripts/specctl.mjs next` for detail. Three sources, in this priority, WITHOUT crawling folders:

1. **Programs** (order = dependencies): **▶ ready** nodes (all deps `done`) — see `rules/programs.md` and `docs/PROGRAMS.md` (generated). Order is computed, not chosen.
2. **Roadmap** (order = human prioritization): `docs/ROADMAP.md` — **single-writer** list (dedicated PR) of future SPECs WITHOUT a program, in the desired order. `next` shows the top not-yet-started item. Program SPECs do NOT go here (their order comes from the graph). Stub created at init; NOT generated.
3. **Unprioritized backlog**: `future/` drafts without a program and off the roadmap. The system **lists** them but **NEVER invents order** — prioritizing is a human decision. The AI proposes the most relevant one and ASKS, or you add it to ROADMAP.

Principle: v4 **computes** order where it is structural (program dependencies), **makes visible** the rest, and **never fabricates priority** between independent items.

## 1. Creation

1. Prompt classified `[new]` (R.9) or `/spec <request>` (classification already confirmed).
2. **SINGLE checkpoint** (1 round-trip, via AskUserQuestion): TAXONOMY feature(s) (existing area = auto-link; NEW area = mandatory user confirmation — R.13) + Size + Owner.
3. **Size — the process-intensity dial**, proposed by the AI (signals: estimated file count, features touched, number of criteria) and confirmed in the same round-trip:
   - **S (small):** bugfix/tweak → minimal `main.md` (goal + 1-3 criteria) + `journal.md`. ZERO pipeline; minutes to code.
   - **M (medium):** small feature → full `main.md` (the 1-page contract is the mini-PRD) + `verify:` on criteria + phase checklist in the SNAPSHOT. No separate prd/techspec.
   - **L (large):** multi-session/multi-area → full OR partial pipeline (à la carte: only `techspec.md` when architecture is the hard part; only `tasks.md` when contract+design are clear), standalone (templates in `rules/formats-pipeline.md`) or via external harness (rules/interop.md).
   - **Size L ⇒ the pipeline PATH is an EXPLICIT question, never a silent default.** In the SAME checkpoint round-trip, present `full | techspec only | tasks only | no pipeline` with a justified recommendation (product feature with UI/QA → full; architecture is the hard part → techspec only; contract+design clear → tasks only); the user confirms BEFORE `main.md` is drafted — main's density depends on the path (full → seed main, fine requirements go to prd.md; partial/none → rich main, it IS the requirements document). **With a pipeline, the SAME question collects the execution mode:** `autonomous` (phases proceed, logged in the journal) | `gated` (explicit approval after /sdd-create-prd, after /sdd-create-techspec, after /sdd-create-tasks and BEFORE each /sdd-run-task). No mode recorded in the journal → `gated` (fail-safe); changeable mid-way via `[decision]`. Record the choices in the journal's `[activation]` (or `[decision]`) entry; embedding them in main.md without asking = checkpoint violation.
   - Legitimate mid-way escalation: `specctl escalate <id> M|L` + `[decision] size upgrade S→M` (or M→L). A one-off fix NEVER sees a pipeline.
4. **Plan mode with the `main.md` draft as the plan itself** — approving the plan IS the human validation of the contract.
5. `specctl new <slug> [--future] [--size S|M|L] [--owner @x] [--features a,b] [--program p] [--workspace w]` — creates the folder (active/ or future/) with a REAL timestamp ID and fields filled. `--future` = born `draft` in future/ with only `main.md`. On a **protected branch** only `--future` is allowed (R.2): an active SPEC needs a feature branch — create/switch branch before an active `new`. `new`/`activate` record the **base** (origin branch) in the claim, for `close`'s finalization menu.

## 2. Activation (future/ drafts only)

`specctl activate <id> [--branch b]`: moves future/→active/; `Status: active`; fills `**Activated:**`; **creates `docs/claims/SPEC-<id>.md`** (committed to MAIN — in-flight visibility, R.11); `[activation]` LOG entry with the initial plan and relevant files. Before activating, check claim collisions (the brief lists them): same feature in another owner's claim → talk before duplicating work.

## 3. Execution — persist per CHECKPOINT/milestone, not "end of session"

"End of session" is undecidable under auto-compact. Persist per checkpoint:

- Each `[MILESTONE]`/phase change → **overwrite the SNAPSHOT** (Last updated, Where I am, Next step, Phases table).
- **At the event, never in batch:** decision→`[decision]`, fact+source→`[discovery]`, attempt+result→`[attempt]`, blocker→`[blocker]`/`[unblock]`.
- **R.6.1:** a validated criterion is marked in `main.md` in the SAME session/batch (via `specctl verify` when it has `verify:` — only it writes `[x]` with evidence). No commit yet → `commit —`, fill before close. Partial → do NOT mark; partial evidence goes to the journal.
- **R.17:** every commit under an active SPEC carries the trailer `Spec: SPEC-<id>`.
- **Feedback loop:** every work artifact produced in the SPEC (review, QA, bugfix — from ANY tool) MUST have a journal counterpart (`[note]/[decision]/[discovery]`), and gotcha/decision candidates accumulate for close. `specctl audit` warns on artifacts without a counterpart.
- Before `/compact`, flush SNAPSHOT/journal yourself (rules/context.md) — the PreCompact hook output does not reach the model. Stop blocks (once) a session that edited code without touching the journal.

## 3.1 Contract that changes course (amend) — changing ≠ deferring

R.6.2 covers *reducing/postponing*; this covers *changing*: a requirement turned into something else mid-execution.

- A `[ ]` criterion and the Scope MAY be CHANGED — but it is a **contract change**: requires explicit human validation (same as plan mode) + `[decision]` in the journal with **before → after** and the user's quote.
- An `[x]` criterion is IMMUTABLE (stamped evidence is not rewritten). If the requirement changed after delivery: new criterion for the new behavior; the old one stays as history.
- A change that doubles the work = signal to `escalate` (or for a new SPEC — ask).

## 3.2 Blocker revealing a missing dependency

(1) `specctl log <id> blocker "..."`; (2) create the dependency as a future SPEC (`new <slug> --future`); (3) if the relation is structural, record it in the program (`docs/programs/<slug>.md` — dedicated PR); (4) decide with the user: `pause` this SPEC until the dependency lands, or continue in parallel on what does not depend on it. `[unblock]` when resolved.

## 3.3 Emergency (production hotfix)

The fast path IS size S: `new` + code + `check` + `close` fit in minutes. If urgency didn't even allow that (direct push without a SPEC): **regularize afterwards** — create the retroactive SPEC at the first calm moment, with `[note] regularization: hotfix applied in <commit> before the SPEC` in the journal and criteria reflecting what was done. A bypass without regularization is invisible debt — audit flags commits without the trailer (R.17).

## 4. Resume — SNAPSHOT × git reconciliation

On resume (`[continuation]`, `resume`, or post-compact): compare the SNAPSHOT's `**Last updated:**` with the branch's `git log -1`. If the repo moved AFTER the journal → the SNAPSHOT is SUSPECT: rebuild state from the LOG + git diff and log `[note] recovery` describing what was reconciled. Staleness is always by CONTENT, never by mtime.

### A process convention agreed in session MUST become a repo rule

If the user approves a new process convention (how to slice work, a section format, a close policy...), it **MUST be proposed as a rule/CONSTITUTION edit in the repo IN THE SAME session** — agent memory is NOT normative (not auditable, doesn't survive an agent/machine change, and the tool is blind to it). Before proposing a new concept, check whether the harness already covers it (e.g. "slices of an epic" = program, see rules/programs.md) — redundant concepts create ambiguity and tooling blindness. RULES.md premise 3: a rule without a mechanism is a bug.

### Harness artifacts are NOT SPEC work

`scripts/specctl.mjs`, `docs/rules/*`, the generated templates (`CLAUDE.md`/`AGENTS.md`) and `.github/workflows/docs-gate.yml` are **vendored tooling, pinned at `template_revision`** — "what the installed version is", not "what changed". A diff in them **is not SPEC work**: classify `[free]`, commit as `chore(spec-system)`, outside the lifecycle (no contract, no criteria to "complete"). A continuation agent finding a harness diff **must not investigate it as unfinished work** — it is a tool bump. Harness updates land as **one atomic commit** (ideally branch → PR), **never as loose edits on `main`/protected**. The harness evolves in the kit's `spec-system-init/templates/` and reaches projects by upgrade; the project only consumes the version.

## 5. Close — HUMAN decision (QA approval does NOT archive by itself)

**The flow is ONE command:** `close <id> --dry` lists what is missing → you resolve it → `close <id>` validates EVERYTHING and applies. `archive` is close's internal engine — never call it directly.

**Before close — the JUDGMENT steps (human/model; close does not decide for you):**

1. **R.6.2 item by item** — full text in §5.1.
2. **Gotcha/decision candidates IN BATCH:** present what the journal accumulated; approved → `features/<area>.md`. Repeated gotcha: append to `(cited by: ...)`, never duplicate. Cited by **≥3 SPECs** → PROPOSE promotion to `CONSTITUTION.md`/`CLAUDE.md` with confirmation; note `(promoted: ..., YYYY-MM-DD)`.
3. **R.7 — touched features:** line under `### Completed` (with SPEC-id), `### State delta` if there was a real architectural change, new DEC-s, obsolete the superseded ones. close validates by CONTENT (SPEC-id under Completed outside a code fence).
4. **LOG:** `[completion]` entry via `specctl log <id> completion "..."` (summary, criteria, commit) + SNAPSHOT reflecting completion.
5. If `interop: external` + `Workspace:`: `specctl adopt-workspace <id>` (snapshots the external artifacts into the SPEC folder).

**close does the rest AUTOMATICALLY — do not do it by hand:** runs pending `verify:`; runs the project suite once (manifest label `test` — failure ABORTS without moving anything; empty label = N/A reported); generates `digest.md` (never count bytes); stamps `Status: done`/`**Completed:**`/`**Final commit:**`; moves to archive/, removes the claim, regenerates indexes; prints the attestation + git finalization menu (see above).

### 5.1 R.6.2 — SPEC scope is a CONTRACT; only the user can accept incomplete

This is the single full statement of R.6.2; everywhere else references it.

**Master rule (applies at ANY time, not only at close):** every form of "leave it for later" — **defer, postpone, accept incomplete, move to a future SPEC/slice, reduce scope** — requires the user's **EXPLICIT AUTHORIZATION**, recorded as a **literal quote**. The AI NEVER defers on its own: it ASKS and records the quote (the marker is the receipt). **No user quote, no deferral — the item stays in scope, `[ ]`.**

**Autonomous operation (no human in the loop):** if the triggering prompt EXPLICITLY delegates decisions (e.g. "consider it confirmed with the most reasonable choice and log it"), that delegation IS the authorization — record the prompt's literal excerpt as the quote. Without explicit delegation, R.6.2 applies in full: the item stays `[ ]` and the SPEC stays open awaiting the user.

**FORBIDDEN (forms of the same violation):**
- Archiving with unmarked criteria without the user's **explicit** approval for each unmet item.
- Marking a partial criterion `[x]` with a note like "_partial_" / "_gap documented_" / "_used X instead of Y_" / "_recommended for future SPEC_". Criteria are **binary**: `[x]` or `[ ]`.
- Listing gaps as feature "gotchas" as if expected behavior, before the user approves.
- Presenting a close as complete when there are `[ ]` criteria.
- Rationalizing reduced scope in any wording ("accept for manual validation", "good enough for the MVP", "conscious pragmatic decision").

**MANDATORY at close:**

1. **List explicitly** to the user **each unmarked criterion** + technical reason.
2. For each, **ask** (AskUserQuestion or plain text): **(a) Implement now** — AI goes back and completes it · **(b) Move to a new SPEC** — AI proposes its scope; user confirms · **(c) Accept as a permanent gap** — user confirms explicitly; AI documents it in gotchas WITH a reference to the user's OK.
3. **Wait for an answer on EACH item before archiving.**
4. (a) on any item → SPEC stays in `active/` until really implemented.
5. (b) or (c) → marker `[accepted-incomplete: "<user's literal quote>" YYYY-MM-DD HH:MM]` on the criterion itself + `[decision]` journal entry quoting the user. The marker is the ONLY lintable way to archive with `[ ]`: without it, `close` and docs-gate BLOCK.

**Why:** `main.md` is the **human-validated contract** (rules/formats.md §1). If the AI can silently shrink delivery, the contract becomes aspirational, not binding. `specctl verify` bridges criterion→executable test: `[x]` comes from machine evidence (exit 0 + commit), not from prose.

**Immediate remedy:** if the AI already committed this violation (archived with pending criteria it deferred itself), it **MUST**, when told: (1) reopen — `node scripts/specctl.mjs reopen <id> --reason "..."` (archive→active, recreates the claim, logs an auditable `[note]`; NEVER move folders by hand), (2) implement the items, (3) close again with criteria truly marked.

**Deferred visibility:** every `[accepted-incomplete]` in the repo appears in **`docs/DEFERRED.md`** (GENERATED by `index` — archived SPECs included, without opening the archive) and the brief shows the count. Picking an item up = new SPEC citing the origin; wrongful close = `reopen`.

## 5.2 Post-merge rollback (feature reverted in git)

`git revert` of archived work does NOT reopen the SPEC (the work WAS delivered; the revert is a new event):

1. Reverting = **new SPEC** `[new]` citing the origin ("reverts SPEC-x — reason").
2. In `features/<area>.md`: `### State delta (SPEC-new, ts)` recording the revert; fallen DEC-s → mark `obsolete → <reason/SPEC-new>`; the original SPEC's Completed line STAYS (true history).
3. The original SPEC's archive and digest stay INTACT (R.5) — `reopen` is only for a wrongful close (§5.1), not for reverts.

## 5.3 Close interrupted mid-way (recovery)

`close` validates everything BEFORE mutating, and the move to archive/ is the last act — an interruption leaves at most a pre-move state (fields stamped, digest generated). **Re-running `close <id>` is safe** (idempotent: SPEC already in archive/ = no-op; new pending item = lists and stops). If the move was partial (rare: crash mid-rename), `specctl lint` flags the folder↔status mismatch — move the folder to the destination its Status indicates and run `specctl index`.

## 6. Discard

`specctl discard <id> --reason "..."` requires, BEFORE moving:

1. `main.md`: `Status: discarded` + `## Discard rationale` section (timestamp; why it no longer makes sense; what was learned; permanent or temporary) — the command writes it from `--reason`.
2. **Promoted lessons:** gotchas/decisions that outlive the SPEC → features BEFORE the move (discard preserves learning — that is why discard/ exists).
3. `digest.md` GENERATED AUTOMATICALLY by the command (parity with close — never count bytes); extra lessons → refine later via `specctl digest <id> --stdin`.
4. LOG: `[completion]` with the reason (the command logs it).
5. R.7 does NOT apply (nothing goes under Completed). A feature created alongside that produced no code → removed in the same PR.

Moves to discard/; removes the claim. NEVER delete the folder.

## 7. Pause and resume

- `specctl pause <id> --reason "..."`: active/→future/; `Status: paused`; `**Paused at:** YYYY-MM-DD HH:MM — reason`; removes the claim; PRESERVES `main.md` + `journal.md`.
- `specctl resume <id>`: future/→active/; adds `**Resumed at:** YYYY-MM-DD HH:MM`; recreates the claim; the first new LOG entry cites the pause for context; apply the §4 reconciliation.
- In `future/`: never-activated SPEC = only `main.md` (`draft`); paused SPEC = `main.md` + `journal.md` (`paused`). Lint validates both.

## 8. Import — `/spec import <artifact>`

Golden rule: **a received artifact is INPUT, not contract.** The local contract is `main.md` (R.6.2 authority stays local; acceptance by the origin team, if needed, becomes a criterion `| evidence: manual @person`).

1. **Ingest with provenance:** the original goes VERBATIM into `intake/` (never rewritten).
2. **Normalization UNDER CONFIRMATION:** generate `prd.md` from the native template (`rules/formats-pipeline.md`) with `**Origin:** imported (team X, YYYY-MM-DD, vN)` and extracted FR-N — the user confirms the extraction before it counts.
3. Normal checkpoint (§1): feature + size + owner.
4. `main.md` derived FROM `prd.md`: criteria with `(covers FR-n)`, human validation in plan mode. In the SNAPSHOT, the phase delivered externally gets status `imported (team X)`.
5. **Conflict check vs living memory:** confront the import with the features' active DEC-s and with CONSTITUTION BEFORE accepting. Conflict → report ("PRD assumes Redis; DEC-x standardized on SQS — take to team X") and log `[decision]` with the outcome.
6. **Resume at the first MISSING phase:** PRD only → techspec; PRD+techspec → tasks; all → execution. Received tasks stay as reference in `intake/`, NOT normalized — re-plan locally using them as input (the local team knows the code).
7. **Re-import (new version vN+1):** new versioned file in `intake/` (e.g. `intake/prd-v2.md`); diff vN×vN+1 → `[decision]` in the journal; affected criteria reviewed WITH human validation.
