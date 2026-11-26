# Team — claims, shared features, locks, worktrees, onboarding, multi-repo

> **STOP.** This file applies only with **`"team": "multi"` in the manifest** (`docs/.spec-system.json`) or in a multi-repo setting. The regime is DECLARED, never inferred: `solo` (default) skips this rule; `multi` makes it mandatory — `activate` prints the claim publishing choreography and `audit` warns about an unpublished claim. Going multi = editing 1 manifest line.

> Read when: `team: multi` in the manifest, when activating a SPEC (claims), when consolidating features, when onboarding someone, or when coordinating multiple repos.

## Claims — in-flight work visible in main (R.11)

`docs/active/` is empty in main (R.2); in-flight work is announced by `docs/claims/SPEC-<id>.md` — 1 file per SPEC = zero merge conflicts. Format (written by specctl):

```
# Claim — SPEC-20260702-1500-checkout-discounts

**SPEC:** SPEC-20260702-1500-checkout-discounts
**Title:** Checkout discounts
**Owner:** @maria
**Branch:** feature/checkout-discounts
**Base:** main
**Features:** checkout, billing
**Activated at:** 2026-07-02 15:00
```

- **Cycle:** `specctl activate` creates the claim; `pause`/`close`/`discard` remove it; `resume` recreates it. Invariant: claim exists ⇔ SPEC active. `**Base:**` = origin branch (used by the close finishing menu).
- **Publishing (team: multi):** the claim is born on the branch and must run AHEAD of the work — publish it to the base via a **trivial PR** (diff only in `docs/claims/` — immediate merge/auto-merge when policy allows). `specctl activate` prints the exact commands; the choreography is:
  ```
  git checkout -b claim/SPEC-<id> <base>
  git checkout <feature-branch> -- docs/claims/SPEC-<id>.md
  git commit -m "docs: claim SPEC-<id> (R.11)" && git push -u origin claim/SPEC-<id>
  # PR to <base> (auto-merge), then go back: git checkout <feature-branch>
  ```
  `audit` warns about a local claim not yet on the base. Fallback without automation: a draft PR of the branch at activation (visibility via open PRs). In `team: solo` none of this applies — the claim reaches the base with the work merge.
- **Before creating a SPEC:** check `docs/claims/` — the session brief already lists claims colliding with the touched features. Collision → warn the user and coordinate with the claim Owner BEFORE creating a duplicate SPEC ("SPEC-x by @maria already touches `auth` — coordinate or proceed?").
- **Hygiene (audit):** claim with no matching active SPEC = orphan (warning); activation without claim = warning.

## features/<area>.md in a team

- **Line-oriented:** in shared sections (Specs for this feature, Decisions, Rejected alternatives, Gotchas), each entry is ONE line starting with a SPEC-id or DEC-id. The id timestamp orders; a merge conflict becomes a trivial adjacent insertion. Never reorder existing lines.
- **Decisions:** `DEC-YYYYMMDD-HHMM-slug` with status `active | obsolete → DEC-x | superseded by SPEC-y`. Obsoleting = changing the line's status field; never rewrite or delete.
- **Gotchas:** recurrence suffix `(cited by: SPEC-a, SPEC-b)`. A SPEC that trips on the same gotcha ADDS its id; ≥3 SPECs → promotion candidate at close (see `docs/rules/lifecycle.md`).
- **Current state (prose):** never edit concurrently. A closing SPEC APPENDS `### State delta (SPEC-<id>, date)` at the end of the section. Consolidating deltas into the canonical prose is **single writer**: a dedicated session with an owner (CODEOWNERS per feature is the natural candidate); consolidate when 3-5 deltas pile up — a legitimate maintenance-SPEC task.
- **Size:** a living feature has no cap (unlimited features, not linted). If the L1 auto-load gets too heavy, the optional `rollup` moves the oldest content to `<area>.history.md` — move, never delete (R.5).

## Light session lock

1 SPEC = at most 1 WRITE session at a time.

- A write session creates `tmp/session.lock` in the SPEC folder with a timestamped session id (e.g. `session-20260702-1530`). `tmp/` is gitignored — the lock never enters the repo.
- Found an existing lock → do NOT write to the journal; ask the user (the other session may have died; they decide whether to override).
- A read-only session needs no lock and is FORBIDDEN from touching the journal.
- End of the write session: remove the lock.

## Worktrees

**1 worktree = 1 branch = 1 active SPEC.** `docs/active/` diverges between worktrees by design (each worktree sees only its own SPEC). Never two active SPECs in the same worktree (with >1 folder in active/, specctl requires an explicit choice); never the same SPEC being written in two worktrees (the lock above covers it).

## Onboarding

**Track (in this order, from overview to detail):**

1. `docs/ARCHITECTURE.md` — cross-cutting region→feature map
2. `docs/CONSTITUTION.md` — project principles
3. `docs/INDEX.md` — feature→files routing
4. `docs/features/<area>.md` for the areas you will work on
5. `docs/ARCHIVE-INDEX.md` filtered by area
6. `digest.md` of the relevant archived SPECs

Cost: global orientation for a few thousand tokens, no code archaeology.

**Guided tours — `docs/tours/<persona>-<focus>.md`** (e.g. `new-dev-checkout.md`, `reviewer-auth.md`). Plain Markdown, no extension/tool dependency. Each step follows **SMIG**:

- **Situation** — where you are in the flow and why this step exists
- **Mechanism** — how the code does it (with a `file:line` anchor)
- **Implication** — what it imposes on the rest of the system
- **Gotcha** — what bites whoever touches it

`file:line` anchors are VERIFIED when writing and re-verified on every tour edit. Broken anchor = stale step: fix or remove, never let it rot. Tours have a narrative arc (start→end of a real flow), not a loose list of files.

## Multi-repo

Structural rule: **execution docs live with the code** — the PR diff gate, the SPEC branch and the AI session are local to the repo; a docs-only repo breaks atomic code+docs validation. Each repo runs its own full v4 install. **Feature present on both sides** (e.g. checkout): each repo documents ITS side (`checkout-api` in back, `checkout-ui` in front). NEVER one feature file shared across repos — far from both codebases, it rots.

**Product layer — not implemented by specctl (manual convention only).** specctl has no cross-repo support: the manifest key `"product": { "home": "<repo/path>", "repo_id": "<id>" }` is preserved but read by nothing, the brief shows no federated headline, there is no federated BOARD/INDEX, and prefixed program nodes (`back:SPEC-…`) are ignored (rules/programs.md). If you need coordination, keep it by hand in a designated home repo (e.g. back; a dedicated meta-repo only when repos/teams grow): product ARCHITECTURE (which repo owns what, flows between them), product CONSTITUTION (shared principles), and a hand-written list linking each repo's SPEC-ids — never the SPECs' living memory.

| Scenario | Structure |
|---|---|
| 1 repo | pure v4, no product layer |
| 2-5 repos, occasional cross-repo | designated home repo (manual) |
| Many repos/teams, frequent cross-repo | dedicated meta-repo (small, manual) |
| Every feature crosses everything | the repo split is the problem → consider a monorepo (TAXONOMY namespaces cover it natively) |

Multi-repo onboarding: start at the product ARCHITECTURE, then go down to the repo track.
