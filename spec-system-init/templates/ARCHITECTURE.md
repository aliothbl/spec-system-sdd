# ARCHITECTURE.md — cross-cutting region→feature map

> Target budget: ≤4,800 bytes. Read level L0.5: answers "which feature does this part of the code belong to?".
> Covers ALL the code, including what has no feature yet (mark it `(no feature)`).
> Update when a SPEC moves boundaries. Fine detail lives in `docs/features/<area>.md`.

## Region → feature map

| Region (path) | Feature (TAXONOMY) | Note (1 line) |
|---|---|---|

<!-- Examples — remove when filling in:
| src/server/auth/ | api/auth | JWT + refresh; middleware in src/server/middleware/ |
| src/web/checkout/ | web/checkout | SPA; consumes api/orders |
| scripts/ | (no feature) | build utilities — no owner yet |
-->

## Cross-cutting flows

<!-- 1-3 lines per flow that crosses regions. Examples — remove when filling in:
- Purchase: web/checkout → api/orders → api/payments (async webhook)
- Deploy: infra/ci → build → registry → production
-->
