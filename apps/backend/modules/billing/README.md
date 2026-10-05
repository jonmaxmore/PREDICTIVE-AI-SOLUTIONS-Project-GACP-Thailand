# `modules/billing/` — Phase A6 §A6-1 placeholder

**Status:** scaffold only — no services moved yet.

## Charter

Owns:
- Fee calculation (per-phase, per-area, per-purpose)
- Quote / invoice / receipt / tax-invoice document lifecycle
- Payment intent + webhook handling
- Refund / cancel / renewal flows (Phase C)
- Phase 1 / Phase 2 split logic + canonical phase{1,2}Amount writers

Allowed dependencies (read direction only):
- `modules/application/` (public API) — to read application state for billing calculations
- `modules/identity/` — to enforce billing-RBAC
- `modules/audit/` — to emit audit events for invoice issuance / payment

NOT allowed:
- Direct `require('../application/internal/...')` — must go through the
  application module's public API
- Direct DB access for non-billing tables (must go through the owning
  module's API)

## Future structure (planned, not yet populated)

```
modules/billing/
├── index.js                ← exports: calculatePhase1Fee, issueInvoice, …
├── routes/
│   ├── pricing.js
│   ├── invoices.js
│   ├── receipts.js
│   └── webhooks.js
├── internal/
│   ├── fee-service.js
│   ├── phase-billing-service.js
│   ├── invoice-finance-ops.js
│   ├── payment-service-*.js
│   └── split-payment-calculator.js
└── README.md (this file)
```

## Migration tracking

Move scheduled in dedicated PR (Phase A6 step 2). Until then, billing
code lives at `apps/backend/services/` and `apps/backend/routes/api/`.
