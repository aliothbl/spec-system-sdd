---
description: SPEC lifecycle operator (SDD v4) — open, close, pause, resume, import, status
argument-hint: [close | status | pause | resume | import <artifact> | <new SPEC request>]
---

# /spec

Arguments: `$ARGUMENTS`

Route by the FIRST word of `$ARGUMENTS` (case-insensitive):

| Route | Aliases (PT) |
|---|---|
| `close` | `fechar` |
| `status` | — |
| `pause` | `pausar` |
| `resume` | `retomar` |
| `import <artifact>` | `importar` |

- First word is a route → run that route; the remaining words are its arguments.
- **Single word that is NOT a route** (e.g. `clsoe`, `stats`, `fix`) → do NOT guess. ASK the user whether they meant a route — suggest the closest one (e.g. "did you mean `/spec close`?") — or a new SPEC about that word.
- **Several words, first is not a route** → new SPEC request (last section).
- Empty → ask whether to open a new SPEC (and what for) or run a route; suggest `status`.

## `close` — closing flow (read docs/rules/lifecycle.md §5)

Closing is ONE transactional command (`close`) preceded by the JUDGMENT steps. Never write the digest by hand or call `archive` directly.

1. Identify the branch's active SPEC (the only folder in `docs/active/`; if there are several, ask which).
2. `node scripts/specctl.mjs close <id> --dry` — lists EVERYTHING that is missing (mutates nothing). Use the list as your script.
3. **Pipeline outcomes (size L with pipeline):** if the latest `qa-report*.md` has verdict `REJECTED`, the latest `review-report*.md` is `REJECTED`, or `bugs.md` has a `Critical`/`High` bug with status `Open`/`Reopened`, SURFACE each one to the user and ask what to do (fix now / new SPEC / accept the gap with a quote). The CLI does not block on these — the user decides.
4. **R.6.2 item by item:** for EACH `[ ]` criterion the dry run listed, ask the user: implement now / move to a new SPEC / accept the gap. Acceptance writes `[accepted-incomplete: "<user's literal quote>" YYYY-MM-DD HH:MM]` on the criterion + a `decision` journal entry quoting the user. NEVER decide alone; NEVER bundle items into one question.
5. Gotcha and decision candidates → present them to the user and update `docs/features/<area>.md` for EVERY touched feature (R.7: a line under `### Completed` with the SPEC id). A gotcha cited by ≥3 SPECs → propose promoting it to CONSTITUTION.md/CLAUDE.md.
6. `[completion]` entry in the LOG (`node scripts/specctl.mjs log <id> completion "..."`) + SNAPSHOT reflecting completion.
7. If the manifest has `"interop": "external"` and the SPEC declares a `**Workspace:**`: `node scripts/specctl.mjs adopt-workspace <id>` (docs/rules/interop.md) — BEFORE close.
8. `node scripts/specctl.mjs close <id>` — runs the pending `verify:` criteria + the project suite once, generates the digest, stamps the fields, archives, and prints the attestation + the git finalization menu (ask item by item; nothing automatic). If it fails, resolve what it lists and run it again. Closing is a human decision: an APPROVED QA does NOT archive by itself.

## `status`

Run `node scripts/specctl.mjs brief` and present its output.

## `pause` — read docs/rules/lifecycle.md §7

1. Confirm the SPEC and the reason with the user.
2. Record the resume state: `node scripts/specctl.mjs log <id> note "..."` and update the SNAPSHOT (`**On resume, read:**`).
3. `node scripts/specctl.mjs pause <id> --reason "<reason>"`.

## `resume` — read docs/rules/lifecycle.md §7

1. `node scripts/specctl.mjs resume <id>`.
2. Read the journal SNAPSHOT (first 60 lines) and follow `**On resume, read:**` before any code.

## `import <artifact>` — read docs/rules/interop.md (§ Importing external artifacts)

Read the import section of docs/rules/interop.md even when the manifest has `interop: none` — it is the intake procedure (docs/rules/lifecycle.md §8 has the same steps). A received artifact is INPUT, not contract — main.md remains the local contract.

1. If there is no SPEC for it yet, create one first through the new SPEC route below.
2. Copy the ORIGINAL artifact, unchanged, into `intake/` in the SPEC folder.
3. Normalize to the template (docs/rules/formats-pipeline.md): generate `prd.md` with FR-N extracted UNDER the user's confirmation and `**Origin:** imported (team X, YYYY-MM-DD, vN)`.
4. Check the artifact against the features' active decisions and CONSTITUTION.md — list conflicts BEFORE acceptance (e.g. "PRD assumes Redis; DEC-x standardized on SQS").
5. Derive/adjust main.md from the PRD, criteria with `(covers FR-n)` — human validation (contract change).
6. Mark the phase `imported (origin)` in the SNAPSHOT and resume at the first MISSING phase: PRD only → techspec; PRD+techspec → tasks; everything → execution. Received tasks stay in `intake/` as reference (re-plan locally).

## New SPEC request

Treat the whole of `$ARGUMENTS` as the request. The `[new]` classification is already confirmed — skip R.9 inference.

1. **Single checkpoint** (one round of questions, AskUserQuestion):
   - area(s) from `docs/TAXONOMY.md` (a new area needs explicit confirmation, R.13);
   - size `S|M|L` — propose one from signals: estimated files, features touched, number of criteria;
   - owner;
   - **size L only**, in the same round: the pipeline path `full | techspec only | tasks only | no pipeline` (with a justified recommendation) and, with a pipeline, the execution mode `autonomous | gated` (docs/rules/lifecycle.md §1). Never choose these silently.
2. Enter **plan mode** with the `main.md` draft as the plan itself (format in docs/rules/formats.md; density depends on the size L path). Approving the plan IS the human validation of the contract.
3. `node scripts/specctl.mjs new <slug> --size <S|M|L> --owner @<x> --features <a,b>` (+ `--program <p>` if it belongs to a program — docs/rules/programs.md; `--workspace <w>` with interop — docs/rules/interop.md; `--future` if it will not start now). Without `--future`, `new` already activates the SPEC and records the claim.
4. Fill main.md with the approved content.
5. Size L: record the path and execution mode — `node scripts/specctl.mjs log <id> decision "Pipeline: <path>; mode: <autonomous|gated>"` — and propose the next step of the arc (`/sdd-create-prd` or `/sdd-create-techspec` if the pipeline is installed, otherwise the native templates in docs/rules/formats-pipeline.md).
