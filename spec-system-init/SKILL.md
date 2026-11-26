---
name: spec-system-init
description: Initialize, upgrade, or bootstrap the SPEC-driven documentation system v4 (journal + specctl + hooks + claims) in a workspace. Creates docs/ (RULES.md core + rules/, features/, active/, future/, archive/, discard/, claims/, programs/), scripts/specctl.mjs, Claude Code hooks, CI docs-gate, the sdd-* pipeline skills and generated CLAUDE.md/AGENTS.md. Upgrades v3 → v4 and 4.1.x → 4.2.0. Use when the user says "init doc system", "setup specs", "bootstrap docs", "upgrade specs", "migrate specs v3 to v4", "upgrade the spec system", "bootstrap brownfield", "document existing project with specs" (PT: "inicializar sistema de documentação", "atualizar sistema de documentação", "migrar specs v3 para v4"), or is starting a new project that needs disciplined spec-based documentation.
version: 4.2.0
---

# spec-system-init v4.2

Initializes, upgrades (v3 → v4, 4.1.x → 4.2.0) or bootstraps (brownfield) the SPEC-driven system in the current workspace. Manifest schema: `sdd-4.0` · kit `VERSION`: `4.2.0` (`init` writes the value of `specctl --version` as `template_revision`). Source of truth for formats: `docs/rules/formats.md` (templates in this skill).

**Language.** These docs are English only. The CLI is bilingual: it reads PT and EN document markers, writes new content in the manifest's `"lang"` (`pt` | `en`; absent = `pt`), and prints its messages in that language. `init --lang pt|en` sets it.

**Safety rules for this skill:** NEVER run a destructive step (overwrite, move, delete a file, run a script that changes state) without listing what will happen and getting explicit confirmation. Both UPGRADE modes **always show the full plan before applying any change**. Never commit — the user decides.

## Mode routing

| State detected in the workspace | Mode |
|---|---|
| No `docs/` (or `docs/` without a spec system) | **INIT** |
| `CLAUDE.md`/`AGENTS.md`/`.claude/settings.json` already exist | **INIT** with **MERGE** sub-mode (never overwrite blindly) |
| `docs/RULES.md` exists AND `docs/.spec-system.json` does NOT | **UPGRADE v3 → v4** |
| `docs/.spec-system.json` with `template_revision` < `4.2.0` | **UPGRADE 4.1.x → 4.2.0** |
| `docs/.spec-system.json` with `template_revision` ≥ `4.2.0` | Already current → report; offer repair (`entrypoints`, `lint`, hook re-merge) |
| Substantial code without documented features (after init/upgrade) | Offer **BROWNFIELD** |

In EVERY mode, also run **Environment detection** (own section below).

---

## INIT MODE

### Step 1 — Inspect current state

Detect with `ls`/Read (try-catch):
- `docs/.spec-system.json` exists? → route by `template_revision` (table above).
- `docs/RULES.md` without manifest? → switch to **UPGRADE v3 → v4**.
- `docs/` exists with other content? → **STOP**. Ask: "`docs/` already exists. Abort (A) or continue merging (M)?" Default: abort.
- `CLAUDE.md` / `AGENTS.md` at the root? → mark for MERGE (Step 7); do not overwrite.
- `.claude/settings.json` exists? → mark for hook merge (Step 6).
- `.github/workflows/docs-gate.yml` exists? → ask before overwriting.
- Git repo? Current branch? No git: warn that branch hooks, claims and R.2 depend on git and suggest `git init` (run only with confirmation).
- Node available (`node --version`)? 20+ recommended, 18 still works. No Node: warn that specctl, hooks and CI will not work and ask for a decision.

### Step 2 — Analyze the project (do NOT ask what is already documented)

**BEFORE asking anything**, read what exists to infer placeholder values. The user must not retype what is already documented.

**Inference sources (try in order, stop at the first hit):**

**Project name (`{{PROJECT_NAME}}`):**
1. `CLAUDE.md` → first heading `# CLAUDE.md — <NAME>` or `# <NAME>`
2. `README.md` / `readme.md` → first `# heading`
3. `package.json` → `"name"` (monorepo: use the root name or ask)
4. `pyproject.toml` → `[project] name` or `[tool.poetry] name`
5. `Cargo.toml` → `[package] name`
6. `go.mod` → `module <name>` (last segment after `/`)
7. `composer.json` → `"name"`
8. `Gemfile` / `*.gemspec` → their usual pattern
9. Fallback: root folder name (basename of cwd)

**Description (`{{PROJECT_DESC}}`):**
1. `CLAUDE.md` → first paragraph after the heading
2. `README.md` → first paragraph after the heading (skip badges)
3. `package.json` → `"description"`
4. `pyproject.toml` → `description`
5. `Cargo.toml` → `description`
6. Fallback: `"_(add description)_"`

**Stack (`{{STACK}}`)** — combine sources:
1. `package.json` → `"type": "module"`, main deps (react, vue, svelte, next, nuxt, astro, express, fastify, nest, hono, elysia), devDeps (typescript, vite, webpack). Build a string like "Node.js + TypeScript + React + Vite".
2. `pyproject.toml` / `requirements.txt` → Python + frameworks (fastapi, flask, django, pydantic)
3. `Cargo.toml` → Rust + frameworks (axum, actix, rocket, tokio)
4. `go.mod` → Go + libs (gin, echo, fiber)
5. `*.csproj` / `*.sln` → .NET
6. `pom.xml` / `build.gradle` → Java/Kotlin + Spring etc.
7. `Gemfile` → Ruby + Rails etc.
8. `Dockerfile` / `docker-compose.yml` → add "Docker"
9. Databases from `.env.example`, `docker-compose.yml`, deps (`mysql2`, `pg`, `mongodb`, `mssql`, `@prisma/client`, `typeorm`)
10. Fallback: most frequent file extensions

**Commands (`{{DEV_COMMANDS}}`):**
1. `package.json` → `"scripts"`: pick `install`/`ci`, `dev`/`start`, `build`, `test`, `lint`.
2. `Makefile` → common targets (`install`, `dev`, `test`, `build`, `run`)
3. `pyproject.toml` → `[tool.poetry.scripts]` or common commands
4. `README.md` → "Installation" / "Getting started" section — extract ```` ```bash/sh/shell ```` blocks
5. `CLAUDE.md` → copy a "Commands" section if present
6. Fallback: placeholder block ```` ```bash\n# (add commands)\n``` ````

**Mechanical labels:** from the detected commands, derive the 5 manifest labels `commands: { test, typecheck, lint, dev, e2e }` (empty string when absent). Detect the package manager from the lockfile (`bun.lock*`→bun, `pnpm-lock.yaml`→pnpm, `yarn.lock`→yarn, `package-lock.json`→npm) and store the FULL runnable command (e.g. `pnpm test`, `pnpm tsc --noEmit`). Hooks, CI, `verify:` and the pipeline skills read these labels.

**Language (`lang`):** detect the prose language of `README.md` and `CLAUDE.md` (Portuguese → `pt`, English → `en`). Unclear, mixed or no prose → `en`.

### Step 3 — Show detected values and ask for confirmation

Show the pre-filled values with their sources in **ONE message** and ask the user to confirm or edit:

```
Detected in the workspace:

Name: <value>                     (source: <file>)
Description: <value>              (source: <file>)
Stack: <value>                    (source: <file(s)>)
Commands (manifest labels):
   test=<...> · typecheck=<...> · lint=<...> · dev=<...> · e2e=<...>
                                  (source: <file>)
Language: <pt|en>                 (source: <file> | default)  — language the CLI writes documents and messages in
Policy: standard                  (strict available: L1 reads require confirmation again, as in v3)
Interop: <none | proposal — see Environment detection>

Reply "ok" to use these values, OR
edit any of them (e.g. "stack: Bun + React + Elysia", "language: pt").
```

"ok" → proceed. An edited field → apply it and keep the rest. Nothing detected at all → ask the classic questions one at a time, saying so.

### Step 4 — Create the structure

1. Copy `templates/scripts/specctl.mjs` → `scripts/specctl.mjs`.
2. Run `node scripts/specctl.mjs init --lang <lang>`. It creates the empty `docs/{features,active,future,archive,discard,claims,programs}/` + `.scratch/`, the manifest `docs/.spec-system.json`, the `TAXONOMY.md`, `CONSTITUTION.md` and `ROADMAP.md` stubs in the chosen language (never overwriting existing files), the generated indexes (`INDEX.md`, `ARCHIVE-INDEX.md`, `PROGRAMS.md`) and the `.gitignore` lines (`docs/active/**/tmp/`, `.scratch/`; appended only when missing — check).
3. Copy the templates:

| Skill template | Destination |
|---|---|
| `templates/RULES.md` | `docs/RULES.md` |
| `templates/rules/*.md` (10 files: formats, formats-pipeline, lifecycle, context, retrieval, verification, programs, team, interop, ci) | `docs/rules/` |
| `templates/ARCHITECTURE.md` | `docs/ARCHITECTURE.md` |
| `templates/commands/spec.md` | `.claude/commands/spec.md` |
| `templates/skills/sdd-*` (8 pipeline skills + assets) | the project's `.claude/skills/` (vendored by default — self-contained repo) |
| `templates/agents/sdd-task-reviewer.md` | `.claude/agents/sdd-task-reviewer.md` |
| `templates/ci/docs-gate.yml` | `.github/workflows/docs-gate.yml` |

Do not copy an `INDEX.md` stub: `init` already generated the indexes, and `specctl index` owns them. Keep the `TAXONOMY.md`/`CONSTITUTION.md` stubs that `init` wrote.

Dates and times ALWAYS come from the real clock (`node scripts/specctl.mjs stamp`; before specctl exists, `date +"%Y-%m-%d %H:%M"`). NEVER timestamps from training data.

### Step 5 — Write the manifest values

Update `docs/.spec-system.json` (valid JSON; fields in `docs/rules/formats.md` and `docs/rules/team.md`): `policy` confirmed in Step 3, `interop` per Environment detection, `team` (`solo` unless the user says `multi`), `product: null`, `commands` = labels from Step 2. Keep `lang`, `schema`, `template_revision` and `installed_at` as `init` wrote them. Parse to validate before writing.

### Step 6 — Install hooks (non-destructive merge)

Fragment: `templates/hooks-settings.json` (SessionStart `startup|resume|clear`→`brief`, SessionStart `compact`→`brief --compact`, UserPromptSubmit→`capsule`, PreToolUse `Read|Grep|Glob`→`guard-read`, PreToolUse `Write|Edit|MultiEdit`→`guard-write`, PostToolUse→`stamp-check`, PreCompact→`brief --compact`, Stop→`session-close`). Every command has the form `node "$CLAUDE_PROJECT_DIR/scripts/specctl.mjs" <sub>`, which keeps working when the session changes directory.

- `.claude/settings.json` does NOT exist → write the fragment as is.
- It exists → **MERGE**: Read + parse; for each event in the fragment, append the specctl entries not yet present (idempotent: skip when an entry with `specctl.mjs` and the same subcommand exists). An old specctl entry with a relative path (`node scripts/specctl.mjs <sub>`) → **replace** it with the fragment's form; never keep both. **NEVER remove, reorder or change hooks that do not mention `specctl.mjs`.** Validate the resulting JSON before writing; if parsing fails, show the fragment and ask for a manual merge without writing.

### Step 7 — Generate CLAUDE.md/AGENTS.md with `entrypoints`

`node scripts/specctl.mjs entrypoints` is the single source of `CLAUDE.md` and `AGENTS.md`. It writes the imperative block (TIER-0 hard bans + first action) at the TOP, and preserves the project block between `<!-- project:start -->` and `<!-- project:end -->` (PT repos: `<!-- projeto:início -->` / `<!-- projeto:fim -->`; both are read). The generated `CLAUDE.md` imports `@docs/RULES.md`; `AGENTS.md` tells the agent to read it. Budgets: `CLAUDE.md` ≤ 6,000 B, `AGENTS.md` ≤ 6,200 B — `entrypoints` warns when the project block pushes a file over.

**HARD RULE:** the generated imperative block ALWAYS sits at the START of the file, right after the `# <title>` line, before any other section (product, stack, architecture, conventions, commands). Never move project content above it.

- **No existing CLAUDE.md/AGENTS.md:** run `entrypoints`, then fill the generated project block with the Step 3 values (description, stack, dev commands). Project-specific content lives ONLY inside the project block — that is the only part that survives regeneration.
- **MERGE (file exists):**
  1. Read the current file.
  2. If it has a v3 block (`## AVISO IMPERATIVO PRA IA` / `Primeira ação obrigatória`): warn and ask whether to replace it with the generated block (recommended) or keep it.
  3. If it has no project markers, wrap the existing project content (minus any replaced v3 block) in `<!-- project:start -->` … `<!-- project:end -->` in place. **Without markers, `entrypoints` discards the old content.**
  4. Run `entrypoints` and confirm the project block came through unchanged (zero diff inside the markers).
  **NEVER append the imperative sections at the end** — it breaks the hard rule.

### Step 8 — Smoke test

Run `node scripts/specctl.mjs index`, then `node scripts/specctl.mjs lint`. Target on a clean init: **0 errors, 0 warnings**. Anything else → fix before reporting (never deliver a system that fails at birth). Optional: offer `node scripts/specctl.mjs self-test`.

### Step 9 — Final report

Use the **Standard report** (below), including the branch protection instruction.

---

## UPGRADE MODE 4.1.x → 4.2.0

**Detection:** `docs/.spec-system.json` exists with `template_revision` < `4.2.0`. The document format does not change: the 4.2 CLI reads every 4.1 document. From 4.0.x, setting the revision also turns on the guards gated at `template_revision ≥ 4.1.0` — say so in the plan.

### V.1 — Show the plan (mandatory, before any change)

List in ONE message what will happen, then wait for explicit confirmation. Nothing is applied before.

1. Copy the new `templates/scripts/specctl.mjs` → `scripts/specctl.mjs`.
2. Remove the old PT-named pipeline folders from `.claude/skills/` (`cria-prd`, `cria-techspec`, `criar-tasks`, `executar-task`, `task-review`, `executar-review`, `executar-qa`, `executar-bugfix`) and `.claude/agents/task-reviewer.md`; copy `templates/skills/sdd-*` and `templates/agents/sdd-task-reviewer.md`. Show local changes in the old folders before deleting. **Warn** when `~/.claude/skills/` holds global copies with the same names as the vendored skills (old or new): the user should check with `/skills` which copy loads, and remove or update stale global copies themselves — this skill never touches them.
3. Replace `.claude/commands/spec.md` with `templates/commands/spec.md` (routes `close | status | pause | resume | import`; PT words stay as aliases). Diff first if the user customized it.
4. In `.claude/settings.json`, rewrite every specctl hook command to `node "$CLAUDE_PROJECT_DIR/scripts/specctl.mjs" <sub>`, add `clear` to the SessionStart matcher (`startup|resume|clear`), and add any specctl entry from `templates/hooks-settings.json` that is missing. Never touch hooks that do not mention `specctl.mjs`.
5. Ask about language:
   - **Keep `pt`** (default for existing projects): leave `lang` as it is; the existing PT `docs/RULES.md` and `docs/rules/` stay.
   - **Switch to `en`**: set `"lang": "en"` and copy the EN `templates/RULES.md` → `docs/RULES.md` and `templates/rules/*.md` → `docs/rules/` (diff first if customized). Existing PT documents stay valid — the CLI reads both; new content is written in English.
6. Set `template_revision` to `4.2.0` in `docs/.spec-system.json`.
7. Run `node scripts/specctl.mjs entrypoints` (the project block is preserved), then `index`, then `lint`.

### V.2 — Apply (after confirmation)

Apply V.1 in order. Parse-validate JSON before every write. Finish with the Standard report (mode `upgrade-4.2`), listing removed folders, the hook entries rewritten, the chosen `lang`, any global-copy warnings and the `lint` result.

---

## UPGRADE MODE v3 → v4

**Detection:** `docs/RULES.md` exists AND `docs/.spec-system.json` does NOT.

### U.1 — Survey and SHOW THE PLAN (mandatory, before any change)

Inventory and list in ONE message: SPECs per folder (active/future/archive/discard, and which have `state.md`/`memory.md`); the 3 `.sh` scripts to remove (`generate-index.sh`, `lint-docs.sh`, `audit-docs.sh`); CUSTOM sections of `docs/RULES.md` (delta vs the canonical v3 template); CLAUDE.md to merge; hooks/CI/`/spec` to install; archive/discard SPECs without a digest (retroactive digest); active SPECs that will get a claim and the new fields (Size/Owner — propose values); R.14 fields found (`Depende de`/`Bloqueia`/`Ordem`) → proposed `programs/<slug>.md` manifests; existing `tasks/prd-*/` (see Environment detection). **Wait for explicit confirmation. Nothing is applied before.**

### U.2 — v4 infrastructure (after confirmation)

INIT Steps 2–7 (the analysis reuses the v3 CLAUDE.md; confirmation in ONE message; specctl + structure + manifest + hooks + docs-gate + `/spec` + `.gitignore` gets `.scratch/`). In the CLAUDE.md merge, the v3 imperative block is replaced by the generated one (top-position hard rule).

### U.3 — Merge state + memory → journal (per SPEC)

For EVERY `SPEC-*` folder with `state.md`/`memory.md` (in active/, future/, archive/, discard/):
1. Create `journal.md` in the format of `docs/rules/formats.md` §3:
   - **SNAPSHOT** ← `memory.md` (Where I am/Next step/etc. from the TL;DR; **when the TL;DRs conflict, memory.md wins over state.md**); `### Phases` ← phase table from state.md; Hypotheses/Key answers/Failed attempts/Files touched/Where I stopped ← matching memory.md sections.
   - **LOG** ← chronological log from state.md, entries copied VERBATIM in original order (append-only preserved; normalize headings to `## YYYY-MM-DD HH:MM — [type] Title` only when the type is unambiguous; when in doubt, keep and annotate).
2. Rename the originals IN THE SAME FOLDER: `state.md` → `state.md.v3.bak`, `memory.md` → `memory.md.v3.bak`. **NEVER delete** (R.5).
3. Ambiguous/unreadable merge → minimal journal with `[note] v3→v4 migration: review *.v3.bak` and list it in the report.

### U.4 — Split RULES

Replace the v3 `docs/RULES.md` with the v4 core + `docs/rules/*` (templates). The project's CUSTOM content (rules/sections not in the canonical v3 template) → `docs/rules/local-overrides.md` with an origin note and date. Keep the original as `docs/RULES.md.v3.bak`.

### U.5 — Remove the 3 .sh scripts

Remove `scripts/generate-index.sh`, `scripts/lint-docs.sh`, `scripts/audit-docs.sh` (already confirmed in U.1 — harness code, not project content; replaced by specctl). Do NOT touch `.sh` scripts unrelated to the harness.

### U.6 — Retroactive digest

For each SPEC in archive/ and discard/ without `digest.md`: generate one from main+state+memory (≤ 2,000 bytes, `docs/rules/formats.md` §4), with the first line after the title marked **`[digest-auto: review]`**. List them all in the report for human review.

### U.7 — Claims for active SPECs

For each SPEC in `docs/active/`: create `docs/claims/SPEC-<id>.md` (`docs/rules/formats.md` §6; claim workflow in `docs/rules/team.md`) and write the new fields confirmed in U.1 into main.md (`**Size:**`, `**Owner:**`; `**Features:**` if missing). Confirmed R.14 fields become `docs/programs/<slug>.md` (`docs/rules/formats.md` §7, one line per node; `Blocks`/order are NEVER written — they are derived).

### U.8 — Finish the upgrade

1. `node scripts/specctl.mjs index` (regenerates INDEX + ARCHIVE-INDEX + PROGRAMS).
2. Initial secret scan: `node scripts/specctl.mjs lint` covers docs/ — report R.15 findings.
3. **N-1 compatibility window:** lint accepts SPECs still in v3 format (those with `state.md.v3.bak`) with a **warning**, not an error — say so, and set the goal of zero warnings.
4. Standard report (migrated count / `[digest-auto]` / pending items + branch protection).

---

## BROWNFIELD MODE

For a project with substantial code and empty docs. Prerequisite: v4 installed (INIT or UPGRADE). Everything runs under a **formal SPEC** — the bootstrap is work like any other.

1. **Open the SPEC:** on its own branch (R.2), `node scripts/specctl.mjs new bootstrap-docs --size M --owner @<user>` (L for a very large repo; `new` already activates and creates the claim). Phases in the SNAPSHOT: scan → split → generation → review.
2. **Scan (read-only):** map directories, entrypoints, modules, routes, jobs, deps and the code's natural boundaries.
3. **Confirmed split (R.13 in batch):** propose in ONE message **three alternative area splits** — **A** lean (~4–6 areas), **B** medium (~7–12), **C** granular (13+) — each with area name, one-line definition and main paths. The user picks/edits → write `docs/TAXONOMY.md` (the choice IS the R.13 confirmation of the areas).
4. **Subagents — one per area, in parallel:** each reads ONLY its area's paths and writes `docs/features/<area>.md` in the format of `docs/rules/formats.md` §5, with the line `**Origin:** bootstrap — SPEC-<id> (YYYY-MM-DD HH:MM)`: Keywords, Main files, Summary, Current state (from the REAL code), Active architectural decisions (inferred from code, marked as inferred), evident Gotchas; "Specs for this feature" = —. Features have no size ceiling; keep them to what the code shows. Nothing invented.
5. **ARCHITECTURE.md:** generate the cross-cutting region→feature map (the view no single feature has).
6. **Close:** `specctl index` → `lint` → SPEC criteria (TAXONOMY confirmed; one feature per area; ARCHITECTURE generated; lint 0 errors) → `node scripts/specctl.mjs close <id> --dry`, then `node scripts/specctl.mjs close <id>` (generates the digest and archives; never call `archive` directly) → PR with docs-gate.

---

## Environment detection — prd pipeline + ECC

Run during INIT Step 1 and the plan step of both UPGRADE modes. The kit is self-contained: **never modify the other harness and never reference ECC in generated docs.**

- **prd pipeline — VENDORED BY DEFAULT:** the kit ships the pipeline in `templates/skills/sdd-*` (8 skills + assets) and `templates/agents/sdd-task-reviewer.md`; init copies them into the PROJECT's `.claude/skills/` and `.claude/agents/` — self-contained repo, whole team on the same version. Global copies in `~/.claude/skills/`, when present, are an equivalent executor and a re-sync source — never a dependency (global × vendored divergence = warning in the report). Default `interop` with the vendored pipeline: `inline`. Alternatives on request: `external` (skills write to `tasks/prd-<slug>/`; `adopt-workspace` at close) · `none` (no pipeline; native templates from `docs/rules/formats-pipeline.md`). Details: `docs/rules/interop.md`.
  - In UPGRADE with existing `tasks/prd-*/`: offer a `**Workspace:**` link in the matching SPECs or conversion into new SPECs.
- **ECC** (`~/.claude/rules/ecc/`, ECC agents): only **report** coexistence. ECC rules belong to the user/machine; the kit neither depends on nor mentions them.

---

## Standard report (all modes)

```
[spec-system-init 4.2.0 · mode: <init|upgrade-4.2|upgrade-v3|brownfield> · NOW=YYYY-MM-DD HH:MM]

Created:      <paths>
Modified:     <paths — CLAUDE.md/AGENTS.md/settings.json/.gitignore merges>
Preserved:    <*.v3.bak> · Removed: <the 3 .sh — v3 upgrade | old PT skill folders — 4.2 upgrade>
Manifest:     sdd-4.0 · template_revision=<...> · lang=<pt|en> · policy=<...> · interop=<...> · team=<...> · commands={test,typecheck,lint,dev,e2e}
Smoke:        node scripts/specctl.mjs lint → <N errors / N warnings> (init target: 0/0)
Pending:      <[digest-auto: review] ×N · v3 SPECs in compat window ×N · R.15 findings · global skill copies · ...>
```

**Next steps (always include):**
1. **Branch protection on `main`** requiring the `docs-gate` workflow checks (lint --strict, audit --pr, audit --deps, main-gate, index-check) — without it R.2/R.7 have no teeth. GitHub → Settings → Branches → Require status checks.
2. Review `docs/TAXONOMY.md` and `docs/CONSTITUTION.md` (stubs) and the project block in `CLAUDE.md`.
3. First work item: `/spec <request>` (opens the checkpoint → plan mode → `specctl new`, which already activates the SPEC).
4. v3 upgrade: review `[digest-auto: review]` and clear the compat-window warnings.
5. Brownfield is available if there is code without documented features.

---

## Anti-patterns (for this skill)

- **Overwriting** existing `docs/`, `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json` or `docs-gate.yml` without confirmation
- Applying ANY upgrade step without the plan listed and confirmed
- Using training-data timestamps instead of the real clock (`specctl stamp` / `date`)
- **Asking for info already in existing files** — always infer from `package.json`, `README.md`, `CLAUDE.md`, etc. first
- Asking blank questions or spreading them over several messages — show everything pre-filled in ONE message
- Committing the created files (leave it to the user)
- Creating example SPECs or features — folders stay empty (exception: BROWNFIELD creates REAL features under a formal SPEC)
- **Placing the generated imperative block anywhere but the START** of `CLAUDE.md`/`AGENTS.md`; in merge mode, **appending it at the end** breaks the hard rule (Step 7)
- Running `entrypoints` over an existing CLAUDE.md/AGENTS.md before wrapping its content in project markers
- Deleting v3 `state.md`/`memory.md`/`RULES.md` in the upgrade — rename to `*.v3.bak` (R.5)
- Hand-editing `INDEX.md`/`ARCHIVE-INDEX.md`/`PROGRAMS.md` (generated by `specctl index`)
- Merging hooks in a way that removes or changes non-specctl hooks
- Modifying GLOBAL skills (`~/.claude/skills/`) or anything from ECC — the pipeline evolves in this skill's `templates/skills/` (canonical source) and reaches projects by vendoring/upgrade
- Skipping the `index` + `lint` smoke test, or delivering an init with errors/warnings

## What changed

- **4.2.0** — The CLI is bilingual: it reads PT and EN markers and writes in the manifest's `lang` (`pt` | `en`; absent = `pt`, output identical to 4.1), with messages in the same language; `init --lang pt|en`; EN flag aliases `--size`/`--reason`/`--quote`. Docs are English only. Pipeline skills renamed to `sdd-*`, agent to `sdd-task-reviewer`; `/spec` routes `close | status | pause | resume | import` (PT aliases kept). `templates/CLAUDE.md`/`AGENTS.md` removed: `specctl entrypoints` is their single source, and the generated `CLAUDE.md` imports `@docs/RULES.md`. New UPGRADE 4.1.x → 4.2.0 mode. Manifest schema stays `sdd-4.0`.
- **4.1.2** — Bug fixes, format unchanged: `new` without `--future` activates; `activate` only activates `future/` drafts; `close`/`verify` skip `[accepted-incomplete]` criteria; `Write` cannot rewrite old LOG entries; temp-file guard only at the root and in `docs/`; unknown flags are errors; `reopen` resets completion fields, drops the digest and requires a new `[completion]`. Hooks use `$CLAUDE_PROJECT_DIR`, and SessionStart covers `clear`. Pipeline skills write to the journal only via `specctl log`.
- **4.1.0** — One writer per gated region: the tool. Transactional `close` (`--dry` lists pending items); `log` and `check` do the bookkeeping; digest generated automatically at close/discard (≤ 2,000 B); features and INDEX have no ceiling. Size S-lite (criteria closed by `check`), `escalate`/`deescalate`. New guards gated at `template_revision ≥ 4.1.0`. `formats.md` split into core + `formats-pipeline.md`. `"team": "solo"|"multi"` in the manifest.
- **4.0** (from v3) — `state.md` + `memory.md` merged into `journal.md`; the 3 `.sh` scripts replaced by `scripts/specctl.mjs` (single file, zero deps); hooks deliver context; `docs/claims/` and `docs/programs/`; size S/M/L; RULES.md core ≤ 5 KB + `docs/rules/`; generated entrypoints and indexes; `specctl next`; R.15 secrets, R.16 budgets, R.17 `Spec:` commit trailer; interop with the prd pipeline.

## Templates location

Next to this SKILL.md: `templates/RULES.md`, `templates/rules/*` (10 files: formats, formats-pipeline, lifecycle, context, retrieval, verification, programs, team, interop, ci), `templates/TAXONOMY.md`, `templates/ARCHITECTURE.md`, `templates/CONSTITUTION.md` (reference copies; `init` writes the TAXONOMY/CONSTITUTION stubs), `templates/commands/spec.md`, `templates/skills/*` (vendored prd pipeline: sdd-create-prd, sdd-create-techspec, sdd-create-tasks, sdd-run-task, sdd-review-task, sdd-review-feature, sdd-run-qa, sdd-fix-bugs — with assets), `templates/agents/sdd-task-reviewer.md`, `templates/hooks-settings.json`, `templates/ci/docs-gate.yml`, `templates/scripts/specctl.mjs`.
