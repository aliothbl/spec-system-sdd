# Spec System SDD

Spec System SDD is a *Spec-Driven Development* kit for doing software work with AI from specifications versioned in the same repository as the code. **Danilo Pimentel** built the core of the kit, including the SPEC lifecycle protocol, the verification mechanisms and, from v4 on, the `specctl.mjs` CLI.

Each SPEC defines the expected outcome, the boundaries and the acceptance criteria. The agent plans, implements, tests, records evidence and resumes work from those files. The person in charge approves the contract, scope changes and the close.

Claude Code provides the session, the tools and the skills. The kit adds the working rules, memory across sessions, lifecycle commands and reproducible checks. `scripts/specctl.mjs` is a Node.js CLI with no npm dependencies. It prepares context, controls transitions and runs gates. The Claude session drives the implementation and picks the next step from the SPEC and the journal.

## Versions

| Branch | Contents |
| --- | --- |
| `main` | Version 4.2: English docs, bilingual CLI (PT/EN), pipeline skills renamed to `sdd-*`, `CLAUDE.md`/`AGENTS.md` generated only by `specctl entrypoints`. |
| [`v4.1`](https://github.com/danilo-pimentel/spec-system-sdd/tree/v4.1) | Version 4.1: close via `close`, bookkeeping via `log` and `check`, extra hooks and the eight pipeline skills in the package (Portuguese docs). |
| [`v4`](https://github.com/danilo-pimentel/spec-system-sdd/tree/v4) | Original version 4, with `specctl.mjs`, journal and hooks. |
| [`v3`](https://github.com/danilo-pimentel/spec-system-sdd/tree/v3) | Version 3, with `state.md`, `memory.md` and shell maintenance scripts. |

The 4.x line uses the `sdd-4.0` manifest schema. The kit's `VERSION` is `4.2.0`; the CLI reports it and writes it as `template_revision` when it creates the manifest. The 4.1 guards turn on for any manifest with `template_revision` at or above `4.1.0`.

### Language

The docs are English only. The CLI is bilingual: it reads Portuguese and English document markers (`**Size:**`/`**Porte:**`, `## Acceptance criteria`/`## Critério de aceite`, and so on). It writes new content in the manifest's `"lang"` (`pt` or `en`; absent means `pt`), and its messages follow the same setting. `init --lang pt|en` sets it. Existing Portuguese projects keep working unchanged: without `lang`, the CLI output is identical to 4.1.

### Upgrading an installed project (4.1.x → 4.2.0)

The document format does not change. The easy path: update the kit clone, replace the project's `.claude/skills/spec-system-init` with the new copy, and run `/spec-system-init`. It detects the older `template_revision`, shows the plan below and applies it after you confirm.

To do it by hand, start at the project root with the kit cloned next to it (`../spec-system-sdd`, updated with `git -C ../spec-system-sdd pull`).

1. Copy the new CLI, `/spec` command, pipeline skills and agent, and remove the old Portuguese-named skill folders. If you customized `spec.md`, compare before replacing.

   ```bash
   kit=../spec-system-sdd/spec-system-init/templates
   cp "$kit/scripts/specctl.mjs" scripts/specctl.mjs
   for s in cria-prd cria-techspec criar-tasks executar-task task-review executar-review executar-qa executar-bugfix; do
     rm -rf ".claude/skills/$s"
   done
   rm -f .claude/agents/task-reviewer.md
   mkdir -p .claude/skills .claude/agents .claude/commands
   cp -R "$kit"/skills/sdd-* .claude/skills/
   cp "$kit/agents/sdd-task-reviewer.md" .claude/agents/
   cp "$kit/commands/spec.md" .claude/commands/spec.md
   rm -rf .claude/skills/spec-system-init && cp -R ../spec-system-sdd/spec-system-init .claude/skills/spec-system-init
   ```

   ```powershell
   $kit = '../spec-system-sdd/spec-system-init/templates'
   Copy-Item -LiteralPath "$kit/scripts/specctl.mjs" -Destination scripts/specctl.mjs -Force
   'cria-prd','cria-techspec','criar-tasks','executar-task','task-review','executar-review','executar-qa','executar-bugfix' |
     ForEach-Object { Remove-Item -LiteralPath ".claude/skills/$_" -Recurse -Force -ErrorAction SilentlyContinue }
   Remove-Item -LiteralPath .claude/agents/task-reviewer.md -Force -ErrorAction SilentlyContinue
   New-Item -ItemType Directory -Force -Path .claude/skills, .claude/agents, .claude/commands | Out-Null
   Get-ChildItem -Path "$kit/skills" -Directory -Filter 'sdd-*' | Copy-Item -Destination .claude/skills -Recurse -Force
   Copy-Item -LiteralPath "$kit/agents/sdd-task-reviewer.md" -Destination .claude/agents/ -Force
   Copy-Item -LiteralPath "$kit/commands/spec.md" -Destination .claude/commands/spec.md -Force
   Remove-Item -LiteralPath .claude/skills/spec-system-init -Recurse -Force -ErrorAction SilentlyContinue
   Copy-Item -LiteralPath ../spec-system-sdd/spec-system-init -Destination .claude/skills/spec-system-init -Recurse
   ```

   If `~/.claude/skills/` (`%USERPROFILE%\.claude\skills\` on Windows) holds global copies with the same names, check with `/skills` which copy Claude loads, and update or remove the stale ones.
2. In `.claude/settings.json`, change every specctl hook command to the form `node "$CLAUDE_PROJECT_DIR/scripts/specctl.mjs" <sub>` and add `clear` to the `SessionStart` matcher (`startup|resume|clear`). Compare with `spec-system-init/templates/hooks-settings.json` and add any missing specctl entry. Leave other hooks alone.
3. Choose the language. To keep Portuguese, do nothing: the existing PT rules stay. To switch to English, copy the English rules and set `"lang": "en"` in `docs/.spec-system.json` in the next step. Existing PT documents stay valid, because the CLI reads both.

   ```bash
   cp "$kit/RULES.md" docs/RULES.md && cp "$kit"/rules/*.md docs/rules/
   ```

   ```powershell
   Copy-Item -LiteralPath "$kit/RULES.md" -Destination docs/RULES.md -Force
   Copy-Item -Path "$kit/rules/*.md" -Destination docs/rules/ -Force
   ```

4. Set `template_revision` to `4.2.0` (and `lang`, if you switched). This command works in bash and PowerShell; drop `m.lang='en';` to stay in Portuguese.

   ```sh
   node -e "const fs=require('fs'),f='docs/.spec-system.json',m=JSON.parse(fs.readFileSync(f,'utf8'));m.template_revision='4.2.0';m.lang='en';fs.writeFileSync(f,JSON.stringify(m,null,2)+'\n')"
   ```

5. Regenerate the entrypoints (the project block is preserved), the indexes, and check the result.

   ```sh
   node scripts/specctl.mjs entrypoints
   node scripts/specctl.mjs index
   node scripts/specctl.mjs lint
   ```

## Installing in Claude Code

### 1. Prepare the terminal

You need Git, Node.js 20 or later (18 still works) and access to Claude Code through your account or the provider your organization configured. `node` and `git` must work in the environment where Claude runs the hooks. On Windows, Git for Windows also provides Git Bash.

If you need to install the Claude CLI, use one of the official commands. In PowerShell, use `winget install Anthropic.ClaudeCode` or the native installer below.

```powershell
irm https://claude.ai/install.ps1 | iex
```

On macOS, Linux or WSL, use the native shell installer.

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Open a new terminal if needed and check the executables. If `claude` or `node` is not recognized, fix the `PATH` before continuing. On the first `claude` run, follow the login flow. Use `/login` in Claude Code to authenticate again. [Claude Code quickstart](https://code.claude.com/docs/en/quickstart) · [Troubleshooting installation and PATH](https://code.claude.com/docs/en/troubleshoot-install#fix-your-path)

```text
git --version
node --version
claude --version
```

### 2. Put the skill in the target project

Clone this repository next to the project that will receive the kit. While the repository is private, authenticate Git with an account that has read access. Replace `my-project` with your project's path. If you are starting from an empty folder, create it and initialize your repository there with `git init -b main`. Make an initial commit before opening the first SPEC, so the checks can record the reference commit.

In PowerShell, from the folder that contains `my-project`:

```powershell
git clone --branch main https://github.com/danilo-pimentel/spec-system-sdd.git
if ($LASTEXITCODE -ne 0) { throw 'Cloning the kit failed.' }
Set-Location -LiteralPath ./my-project -ErrorAction Stop
$skillDir = '.claude/skills/spec-system-init'
if (Test-Path -LiteralPath $skillDir) {
    throw "$skillDir already exists. Compare the installed version before replacing it."
}
New-Item -ItemType Directory -Force -Path .claude/skills | Out-Null
Copy-Item -LiteralPath ../spec-system-sdd/spec-system-init -Destination $skillDir -Recurse -ErrorAction Stop
claude
```

On macOS, Linux or WSL, from the folder that contains `my-project`:

```bash
if git clone --branch main https://github.com/danilo-pimentel/spec-system-sdd.git && cd ./my-project; then
  skill_dir=.claude/skills/spec-system-init
  if [ -e "$skill_dir" ]; then
    printf '%s\n' "$skill_dir already exists. Compare the installed version before replacing it."
  else
    mkdir -p .claude/skills &&
      cp -R ../spec-system-sdd/spec-system-init "$skill_dir" &&
      claude
  fi
fi
```

Claude Code loads the project skill from `.claude/skills/spec-system-init/SKILL.md`. Copy the whole folder so `templates/` stays next to `SKILL.md`. To make the initializer available in all your local projects, put the same folder in `~/.claude/skills/` (`%USERPROFILE%\.claude\skills\` on Windows). If there are copies with the same name, check which one Claude picked with `/skills`. [Claude Code skill scopes](https://code.claude.com/docs/en/skills#choose-where-skills-load)

### 3. Initialize the system

In the Claude Code prompt, opened at the target project's root, run the kit's initializer.

```text
/spec-system-init
```

The initializer reads the project's files and proposes the name, description, stack, language (`pt` or `en`, detected from `README.md`/`CLAUDE.md`, `en` when unclear) and the `test`, `typecheck`, `lint`, `dev` and `e2e` commands, all in one confirmation message. Review the values and confirm the plan. The commands go into the manifest and must match what actually runs at your project's root. Leave a command empty when the project does not offer it yet.

| Project state | Initializer flow |
| --- | --- |
| New project | Creates the documentation structure and installs the CLI, the hooks, `/spec`, the pipeline skills and the CI template. |
| Existing project with `docs/`, `CLAUDE.md`, `AGENTS.md` or Claude settings | Asks before merging into an existing `docs/`, keeps project-specific instructions in the project block of the generated entrypoints, and merges the hooks into the existing JSON. Review the settings diff before sharing the setup. |
| Version 3 installed | Shows the migration plan. After approval, moves state and history into `journal.md`, keeps the old files as `*.v3.bak` and proposes the new SPEC fields. |
| Version 4.1.x installed | Shows the 4.2.0 upgrade plan (see above) and applies it after confirmation. |
| Version 4.2 manifest already present | Reports the installed version and offers diagnosis or repair. |
| Existing code with little documentation | Can propose a *brownfield* bootstrap that documents the project's real areas under a SPEC. |

`standard` is the initial policy. `strict` adds the level-1 context read confirmation defined in the rules. The manifest also declares `team: solo|multi`. In `multi`, activation guides you through publishing the work claim on the base branch so the team can see it.

After reviewing `docs/TAXONOMY.md`, `docs/CONSTITUTION.md`, `docs/.spec-system.json` and the project block in `CLAUDE.md`, run at the project root:

```sh
node scripts/specctl.mjs --version
node scripts/specctl.mjs index
node scripts/specctl.mjs lint
node scripts/specctl.mjs brief
```

`init` already generates the indexes; `index` regenerates them from the project's files whenever they change. On a clean install, `lint` should report zero errors and zero warnings. `node scripts/specctl.mjs self-test` runs the CLI's internal tests. Reopen Claude Code at that root to load the settings and try `/spec status`. Use `/skills` to check the skills and `/hooks` to inspect the hook settings. [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)

If the project uses GitHub Actions, review the generated workflow in `.github/workflows/docs-gate.yml`. The PR job runs strict lint, audits the diff and the dependencies, checks `docs/active/` on PRs to `main` and verifies the indexes are current. To require it for merging, set the job as a required check in the main branch protection. The template also includes a weekly audit and an index regeneration job after pushes to `main`.

## First work cycle

Create a work branch from your project's base and open a Claude Code session at the root. On protected branches the kit only allows drafts in `future/`; activation happens on the work branch.

```sh
git switch -c feat/history-filter
claude
```

```text
/spec Add a date-range filter to the order history and prove it with tests.
```

1. **Define the delivery.** Claude proposes the taxonomy area, the size and the owner in the same checkpoint. Review the `main.md` draft in plan mode. Approving that plan validates the contract.
2. **Activate the SPEC.** The session uses `specctl new` to create the ID, record the activation and open the claim. `activate` is only used for a draft created earlier with `new --future`. Active work lives in `docs/active/SPEC-.../` on the work branch.
3. **Loop through implementation, validation and recording.** Advance by criterion or task, run the checks, fix failures and record results in the journal right away. The `SNAPSHOT` holds the phase, state and next step. The `LOG` keeps events in order, with new entries via `specctl log`. To resume in another session, name the SPEC and follow the `brief` and the journal.
4. **Validate and close.** Use `/spec close` to review the pending items from `close <id> --dry`. For size S, `check <id> <n>` records evidence for a criterion without a `verify:` command. When there is a `verify:`, `specctl verify <id>` runs it and stamps the criteria that passed. Pending acceptance items need an explicit user decision per item, with the answer recorded.
5. **Archive with evidence.** `close` runs the pending checks and the `commands.test` suite when configured, prepares `digest.md`, archives the SPEC, removes the claim and regenerates the indexes. If a check or the suite fails, the SPEC stays active. Criteria already verified keep their evidence for the next attempt. On archive, the command prints an attestation and the Git next steps for the user to decide. Commits made under the SPEC carry the `Spec: SPEC-<id>` trailer.

Other commands in the Claude prompt include `/spec status`, `/spec pause`, `/spec resume` and `/spec import <artifact>` (the Portuguese words still work as aliases). Import keeps the original in `intake/`, normalizes the material after confirmation and resumes from the pending phase against the approved local contract.

## Size and automatic skill selection

The session estimates the size from the number of files, the areas touched and the number of criteria. It presents the proposal at the checkpoint and the user confirms. The size sets the process as follows.

| Size | Process | Pipeline use |
| --- | --- | --- |
| **S — small** | Small change with a goal, one to three criteria and a journal. | Direct SDD flow, with `check` for criteria without `verify:` and the project suite at close when configured. |
| **M — medium** | A complete `main.md` acts as a mini-PRD. The journal tracks the phases and criteria have `verify:` where applicable. | Direct SDD flow, without a separate PRD or TechSpec. If the work grows, the session records the decision and can escalate the SPEC. |
| **L — large** | Work spanning several areas or sessions that needs an explicit choice before drafting `main.md`. | The session recommends **full**, **TechSpec only**, **tasks only** or **no pipeline**, depending on the work. The user confirms the path and, if there is a pipeline, the execution mode. |

For L, the full flow fits when requirements, implementation and QA need their own phases. TechSpec only makes sense when the main difficulty is architectural. Tasks only fits when contract and design are already clear. In a partial run, `main.md` can stand in for a PRD. The `sdd-create-tasks` skill requires `techspec.md` in the workspace. To use it on the tasks-only path, reuse an existing TechSpec. If the design lives only in the contract, use the SDD's native task format. The no-pipeline mode uses the SDD flow and the matching native artifacts.

- **Autonomous.** After the initial choices, the session records plans and lists in the journal and moves through the authorized phases, within Claude Code's permissions.
- **Gated.** The session waits for approval after the PRD, after the TechSpec, after the task list and before each task run. This is the default when no choice is recorded.

In both modes, changes to criteria or scope and the close need a human decision. The agent records the choice at activation or as a decision in the journal and uses the pending phase to call the matching skill. The hooks provide context and workspace. `specctl` runs commands and validates artifacts. The skills run inside the Claude session.

### Pipeline skills

The kit includes the eight skills below, authored by **Pablo Hadler**, who authorized their publication in the kit. [Pablo Hadler on GitHub (`@pmhg`)](https://github.com/pmhg) · [Pablo Hadler on LinkedIn](https://www.linkedin.com/in/pablo-hadler-650a5223/)

The kit also ships these skills' templates and references, and an `sdd-task-reviewer` subagent for per-task review.

| Skill | When the session uses it | Result |
| --- | --- | --- |
| [`/sdd-create-prd`](spec-system-init/templates/skills/sdd-create-prd/SKILL.md) | Requirements for the full pipeline. | `prd.md` with functional requirements numbered `FR-N`. |
| [`/sdd-create-techspec`](spec-system-init/templates/skills/sdd-create-techspec/SKILL.md) | Technical design in the full flow, or when the architecture justifies that phase on its own. | `techspec.md` with design, decisions, risks and test strategy. |
| [`/sdd-create-tasks`](spec-system-init/templates/skills/sdd-create-tasks/SKILL.md) | Breaking requirements and design into tested deliveries. | `tasks.md` and `NN_task.md` files. |
| [`/sdd-run-task`](spec-system-init/templates/skills/sdd-run-task/SKILL.md) | Running one identified task from the list. | Implementation, test run and the per-task review. |
| [`/sdd-review-task`](spec-system-init/templates/skills/sdd-review-task/SKILL.md) | Reviewing an executed task, usually via `sdd-task-reviewer` when available. | `NN_task_review.md` with findings and verdict. |
| [`/sdd-review-feature`](spec-system-init/templates/skills/sdd-review-feature/SKILL.md) | Reviewing the whole implementation, including the branch diff and in-scope working changes. | `review-report.md`. |
| [`/sdd-run-qa`](spec-system-init/templates/skills/sdd-run-qa/SKILL.md) | Functional, visual and accessibility validation when the plan calls for QA. | `qa-report.md`, evidence and `bugs.md` with the issues found. |
| [`/sdd-fix-bugs`](spec-system-init/templates/skills/sdd-fix-bugs/SKILL.md) | QA bugs that need fixing. | Fixes, regression tests, updated `bugs.md` and `bugfix-report.md`. |

`sdd-run-task` requires a review before marking the task done. The agent fixes and repeats the review for up to three cycles, then escalates persistent findings. In QA, a fixed bug is retested before it is marked `Verified`. The QA skill uses Playwright MCP when available. Without it, the flow records the limitation and suggests the project's E2E suite or manual verification. The TechSpec can use Context7 MCP and fall back to technical documentation on the web. The kit setup copies the skills and the subagent into the project. MCP tools are configured separately. [MCP setup in Claude Code](https://code.claude.com/docs/en/mcp)

### Where the pipeline writes artifacts

| `interop` in the manifest | Behavior |
| --- | --- |
| `inline` | Initializer default with the vendored skills. With an active SPEC, the capsule gives the `docs/active/SPEC-.../` path for every pipeline read and write. The artifacts follow the SPEC into the archive. |
| `external` | Uses the declared workspace `tasks/prd-<slug>/`. Before the close, `specctl adopt-workspace <id>` copies the artifacts into the SPEC and keeps the original workspace. |
| `none` | Uses the SDD flow without running the integrated pipeline. |

The skills apply the interop rules when they find **both** `docs/.spec-system.json` and `docs/RULES.md`. In that context, they use the manifest's commands, read the contract and the journal before asking for clarification, and send decisions and results back to the journal. Each artifact keeps its own level of progress: a finished task in `tasks.md`, the phase in the `SNAPSHOT`, acceptance in `main.md`.

## Files, hooks and checks

| Path in the installed project | Role |
| --- | --- |
| `docs/.spec-system.json` | Schema, revision, language, policy, team, interop and project commands. |
| `CLAUDE.md`, `AGENTS.md`, `docs/RULES.md` and `docs/rules/` | Entrypoints, core rules and situational guides. `specctl entrypoints` generates `CLAUDE.md` (which imports `@docs/RULES.md`) and `AGENTS.md` (which tells the agent to read it); keep project content inside their project block. |
| `docs/{future,active,archive,discard}/` | Lifecycle states. Each active SPEC has `main.md` and `journal.md`. An archived one has the `digest.md` summary. |
| `docs/features/`, `docs/TAXONOMY.md`, `docs/ARCHITECTURE.md`, `docs/CONSTITUTION.md` | Durable context per area, vocabulary, architecture map and project principles. |
| `docs/claims/`, `docs/programs/`, `docs/ROADMAP.md` | Work in progress, dependencies between SPECs and human prioritization of standalone SPECs. |
| `docs/INDEX.md`, `docs/ARCHIVE-INDEX.md`, `docs/PROGRAMS.md`, `docs/DEFERRED.md` | Indexes regenerated by `specctl index`. |
| `scripts/specctl.mjs`, `.claude/settings.json`, `.claude/commands/spec.md` | CLI, hook settings and the interactive `/spec` command. |

At start or resume, `brief` reports the active SPEC, the state of the work and what to read next. On each prompt, `capsule` delivers the date, the active SPEC and the workspace mode. The read and write hooks restrict operations as the protocol defines. The post-edit hooks check stamps and secret patterns. There are also checks at compaction and when a response ends. Hooks run as `node "$CLAUDE_PROJECT_DIR/scripts/specctl.mjs" <sub>`, so they work from any directory. These controls cover the tools and events configured in `.claude/settings.json`. `lint`, `audit` and the CI workflow check the versioned content.

```sh
node scripts/specctl.mjs lint --strict
node scripts/specctl.mjs audit
node scripts/specctl.mjs audit --deps
node scripts/specctl.mjs next
```

For other CLIs, `AGENTS.md` says to run `brief` at session start and `lint` and `audit` before the PR. Use phrases like `start a spec: <request>` or `close the spec` when `/spec` is not available. The verification mechanism stays available through the Node CLI and CI.

## Package reference

- [Install, merge, upgrade and brownfield skill](spec-system-init/SKILL.md)
- [Lifecycle, approval and close](spec-system-init/templates/rules/lifecycle.md)
- [Interop rules](spec-system-init/templates/rules/interop.md)
- [`/spec` command](spec-system-init/templates/commands/spec.md)
- [`specctl.mjs` CLI](spec-system-init/templates/scripts/specctl.mjs)
