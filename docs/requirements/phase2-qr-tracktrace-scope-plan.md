# Phase 2 QR/Track-Trace Execution Plan (Scope-Aligned)

## Source references reviewed
- `C:\Users\usEr\Downloads\ENHANCED_PROMPT_Phase2_QR_TrackTrace_Professional.md`
- `C:\Users\usEr\Downloads\QR_TrackTrace_Implementation_Guide.md`
- `C:\Users\usEr\Downloads\TERMINOLOGY_MIGRATION_GUIDE.md`

## Scope alignment decision (locked)
This repository remains in **GACP cultivation scope only**:
- Included: planting, harvest batch, packaging lot, transport-to-factory traceability, public QR verification.
- Excluded for now: downstream product/SKU/sales/manufacturing, blockchain write pipeline, medical advisory features.

## Current baseline (already in repo)
- Public trace endpoints and pages already exist for lot/batch flows.
- First-cycle auto trace after audit PASS exists and is covered by scripts.
- Subsequent manual cycle trace flow exists and is covered by scripts.
- ERP regression gate scripts pass (`scripts/run-regression-gate.js`).
- Canonical route migration to `health/provider` is active.

## Gap list to implement next
1. Canonical naming completion (non-breaking)
- Replace remaining legacy naming in internal storage keys/cookies/interfaces where safe.
- Keep temporary compatibility only where strictly required, with explicit deprecation notes.

2. QR metadata hardening (v2 payload policy)
- Add stable QR metadata envelope for batch/lot responses:
  - `version`, `type`, `entityId`, `publicUrl`, `issuedAt`, `checksum`.
- Enforce uniqueness and idempotent regeneration rules.

3. Public trace response contract hardening
- Standardize public response shape for:
  - `GET /api/trace/batch/:batchId`
  - `GET /api/trace/lot/:lotId`
- Ensure sensitive fields are not leaked.
- Include certificate status and expiry consistently.

4. Provider/Admin operational improvements
- Provider queue widgets: explicit status chips, SLA labels, and reliable counts.
- Admin trace audit view: timeline of QR generation/access and state transitions.

5. Validation and policy guards
- Block invalid packaging-weight combinations.
- Block edits on first-cycle auto-generated lots.
- Enforce phase-2 receipt gate consistently before audit start.

## Delivery sequence (PR plan)
- PR-01: Canonical naming cleanup + compatibility notes.
- PR-02: QR metadata envelope + trace API contract stabilization.
- PR-03: Validation guards + audit logging completeness.
- PR-04: Provider/Admin UI polish (Mantine) + empty/error/loading state normalization.
- PR-05: Test expansion and release checklist refresh.

## Acceptance gate for Phase 2
- `node scripts/run-regression-gate.js` must pass.
- New/updated tests for QR/trace contract and naming compatibility must pass.
- No remaining public route usage of `/health` or `/provider` in active app code.

