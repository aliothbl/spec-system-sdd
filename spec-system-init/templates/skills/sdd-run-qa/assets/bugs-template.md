# Bugs — [Feature Name]

> **File contract:** entries are APPEND-ONLY — never overwrite or delete existing bugs; only add new ones and update the **Status** field. Continuous IDs (BUG-01, BUG-02, … — always continue from the highest existing ID, across QA runs). On a QA re-run, every bug with status `Fixed` MUST be re-tested and set to `Verified` or `Reopened`.

## BUG-NN

- **Affected requirement:** FR-n
- **Severity:** Critical | High | Medium | Low
- **Status:** Open | Fixed | Verified | Reopened | Not reproducible
- **Description:** [what is wrong, in 1-2 sentences]
- **Reproduction steps:**
  1. [step]
  2. [step]
- **Expected:** [expected behavior]
- **Observed:** [observed behavior]
- **Evidence:** evidence/BUG-NN-[label].png
- **Fix applied:** — _(filled by sdd-fix-bugs: short description + commit)_
- **Regression tests:** — _(filled by sdd-fix-bugs: list of tests created)_
