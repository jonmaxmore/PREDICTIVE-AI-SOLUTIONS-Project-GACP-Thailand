# Security Summary — GACP Certification Platform

This document is the living index of security-related controls, audits, and deliverables for the GACP Certification platform. New entries appended in reverse-chronological order.

---

## Iter 27 deliverables (2026-05-16)

### 1. Right to Erasure (PDPA Section 33) — Iter 27 B27-A

Erasure flow shipped this iteration.

- Service: `apps/backend/services/pdpa-service.js` — `assembleUserDataExport()` (PDPA-S30), retention logic, soft-delete preserving FK integrity for Applications/Invoices/Certificates.
- Handler: `DELETE /auth/health/me` in `apps/backend/controllers/auth-controller/auth-session-security-handlers.js` (`deleteMe`).
- Token cleanup: revokes refresh-token allowlist via `revokeAllUserTokens`, blocklists access token via `blocklistAccessToken`.
- Retention sweep: `apps/backend/jobs/pdpa-retention-job.js` daily anonymisation of users whose `retainUntil` has passed (PDPA Section 37). Wrapped in `withoutTenantScope()` so the sweep is platform-global (ADR-014).
- Test coverage: `apps/backend/__tests__/unit/delete-me-erasure.test.js` and `apps/backend/__tests__/unit/pdpa-retention-job.test.js`.

### 2. PDPA Audit Checklist

`docs/security/pdpa-audit-checklist-2026-05-16.md` — pre-cutover gate for legal counsel and DPO. Organised by PDPA Act chapter (ม.21, ม.23, ม.24, ม.27, ม.28, ม.32) with status legend Implemented / Partial / Missing and file-path citations into the source tree.

Summary status:
- Implemented: 18 items
- Partial: 2 items (privacy notice UI walkthrough; bilingual i18n verification)
- Missing: 3 items (incident response runbook; PDPC 72-hour breach notification template; data subject breach notification template)

Pre-cutover blockers: the three Missing items under ม.28 plus the Partial items under ม.23 must be cleared before public registration is enabled.

### 3. Penetration Test Preparation Doc

`docs/security/pentest-prep-2026-05-16.md` — scope-of-work pack for the external pen-test vendor engagement. Covers scope, out-of-scope, OWASP Top 10 (2021) mapping, known controls (batch 9 + batch 14 + Sprint 7 + Sprint 8), known gaps (DTAM hosting, RSA key provisioning, WHT, Phase 2 PII), expected deliverables, staging environment requirements, and engagement rules.

---

## Cross-references

Source code citations made by the Iter 27 documents above:
- Field encryption — `apps/backend/utils/field-encryption.js` (AES-256-GCM)
- Prisma PDPA extension — `apps/backend/services/prisma-pdpa-extension.js` (Phase 1 transparent encryption)
- Immutable audit log — `apps/backend/middleware/audit-logger.js` (SHA-256 hash chain, `verifyChain()`)
- Audit reader / payment trail — `apps/backend/services/audit-trail.js` (`verifyHashChain()`, `getPaymentAuditTrail()`)
- Auth middleware — `apps/backend/middleware/auth-middleware.js` (JTI enforcement, revocation lookup)
- Token revocation — `apps/backend/services/token-revocation-service.js` (refresh allowlist, access blocklist, family blocklist, MFA challenges, fail-OPEN vs fail-CLOSED policy block)
- Rate limiter — `apps/backend/middleware/rate-limiter.js` (Redis + memory fallback, batch 14 cleanup hooks)
- Consent manager — `apps/backend/middleware/consent-manager.js` (PDPA consent categories + versioning)

Related audit documents under `docs/audit/`:
- `payment-audit-evidence-2026-05-16.md`
- `payment-flow-2026-05-16.md`
- `accounting-correctness-2026-05-16.md`
- `scheduling-workflow-2026-05-16.md`
- `onsite-audit-flow-2026-05-16.md`
- `renewal-workflow-2026-05-16.md`

---

## Outstanding security work tracked

- Phase 2 PII encryption migration (`healthId`, `providerId` columns) — requires WHERE-clause migration to `healthIdHash` lookups. Multi-file change; needs dedicated sprint per prisma-pdpa-extension.js header.
- Incident response runbook (NIST SP 800-61 phases).
- PDPC 72-hour breach notification template (Thai + English).
- Data subject breach notification email template.
- RSA private key provisioning in production secret manager (gates production certificate signing).
- Pen-test engagement execution + remediation cycle + re-test.
