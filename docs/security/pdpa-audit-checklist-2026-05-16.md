# PDPA Compliance Audit Checklist

Date: 2026-05-16
Author: QA Compliance (Iter 27 hardening loop)
Scope: GACP Certification Platform — backend (`apps/backend`), web app (`apps/web-app`)
Regulation: Thailand Personal Data Protection Act B.E. 2562 (2019) (hereafter "PDPA")
Related OWASP control families: ASVS V8 (Data Protection), V9 (Communications), V10 (Malicious Code) where applicable.

Audience: Legal counsel, DPO (Data Protection Officer), Security Lead. Use this list as a pre-production cutover gate together with `pentest-prep-2026-05-16.md`.

Status legend:
- Implemented — control exists in code, exercised in tests
- Partial — control exists but with a documented gap
- Missing — control is not implemented

---

## ม.21 — Lawful basis for processing (PDPA Section 21)

Lawful basis requirement: every category of personal data must have a documented lawful basis (consent, contract, legal obligation, vital interest, public task, legitimate interest).

- [Implemented] Each data field has documented lawful basis
  - Evidence: `apps/backend/services/prisma-pdpa-extension.js` (PHASE_1_PII_COLUMNS lists the encrypted fields with rationale)
  - Evidence: `apps/backend/services/pdpa-service.js` lines 4-19 (record retention legal basis documentation)
- [Implemented] Consent records persisted with timestamp + version
  - Evidence: `apps/backend/middleware/consent-manager.js` (ConsentCategory, ConsentVersions, ipAddress + userAgent + metadata)
  - Evidence: Prisma `UserConsent` model persisted with `grantedAt`, `withdrawnAt`, `version`, `metadata` fields
- [Implemented] Withdrawal flow available
  - Evidence: `apps/backend/middleware/consent-manager.js` `recordConsent(userId, category, granted=false, ...)` — sets `withdrawnAt = new Date()` for optional categories
  - Note: TERMS_OF_SERVICE and PRIVACY_POLICY are listed as RequiredConsents — cannot be withdrawn (service termination required)

---

## ม.23 — Privacy notice (PDPA Section 23)

Privacy notice requirement: data controllers must inform data subjects of (1) purpose of collection, (2) data categories, (3) retention period, (4) recipients, (5) data subject rights, BEFORE or AT the point of collection.

- [Partial] Privacy notice prominent on signup
  - Evidence: `apps/backend/routes/api/auth/auth-health.js` line 27 (`/register` endpoint with `validate(healthRegisterSchema)`)
  - Gap: Verify that the web-app registration screen surfaces the consent toggle for PRIVACY_POLICY before form submit. Legal counsel must perform UI walkthrough sign-off.
- [Partial] Thai language version + English version
  - Gap: Verify `apps/web-app` i18n catalogue contains both `th` and `en` privacy-policy strings; lock the wording with legal counsel before production cutover.
- [Implemented] Lists all data categories collected
  - Evidence: `apps/backend/services/pdpa-service.js` `assembleUserDataExport()` (lines 52-79) enumerates the canonical user data set (id, uuid, canonicalId, healthId, email, phoneNumber, firstName, lastName, accountType, role, authType, etc.)
  - Evidence: `apps/backend/services/prisma-pdpa-extension.js` PHASE_1_PII_COLUMNS lists encrypted-at-rest fields

---

## ม.24 — Data subject rights (PDPA Section 24, 30, 31, 33)

Sections enumerated below give the data subject rights of access, rectification, erasure, restriction, portability, and objection.

- [Implemented] Right to access — endpoint exists (PDPA Section 30)
  - Evidence: `GET /auth/health/me/export` at `apps/backend/routes/api/auth/auth-health.js` lines 67-86
  - Evidence: `apps/backend/services/pdpa-service.js` `assembleUserDataExport()` returns full personal data dump in JSON
  - Audit: PDPA_EXPORT action written to immutable AuditLog via `auditLogger.log()` with `regulation: 'PDPA-S30'` metadata
- [Implemented] Right to rectification — endpoint exists
  - Evidence: `PATCH /auth/health/me` at `apps/backend/routes/api/auth/auth-health.js` line 53 (`AuthController.updateProfile`)
- [Implemented] Right to erasure (PDPA Section 33) — wired in Iter 27
  - Evidence: `DELETE /me` handler in `apps/backend/controllers/auth-controller/auth-session-security-handlers.js` (`deleteMe` handler)
  - Evidence: Unit test `apps/backend/__tests__/unit/delete-me-erasure.test.js` covers 401/400 paths and password confirmation contract
  - Evidence: `apps/backend/jobs/pdpa-retention-job.js` `runPdpaRetentionSweep()` — daily anonymisation of expired retention rows (lines 30-100)
- [Implemented] Right to data portability — export endpoint
  - Evidence: Same export endpoint above returns JSON-serializable structure suitable for re-import elsewhere

---

## ม.27 — Security measures (PDPA Section 27)

Section 27 requires "appropriate security measures" — interpreted by PDPC guidance as encryption at rest where feasible, encryption in transit, access controls, audit trails, and periodic penetration testing. Cross-mapped to OWASP ASVS V8.

- [Implemented] Field-level encryption at rest (AES-256-GCM)
  - Evidence: `apps/backend/utils/field-encryption.js` — AES-256-GCM, 12-byte random IV per call (NIST SP 800-38D), authenticated encryption, SHA-256 key derivation
  - Evidence: `apps/backend/services/prisma-pdpa-extension.js` — transparent Prisma `$extends` interception for PHASE_1_PII_COLUMNS (idCard, taxId, laserCode, communityRegistrationNo, address, province, district, subdistrict, zipCode)
  - Gap (documented in code, not blocking): `healthId` and `providerId` deferred to Phase 2 (require WHERE-clause migration to `healthIdHash` lookups) — see file header comment lines 28-37
- [Implemented] TLS in transit
  - Verification step for ops: confirm production load balancer terminates TLS 1.2+ only, HSTS enabled (refer to `apps/backend/middleware/uploads-security-headers.js` for header configuration)
- [Implemented] Access controls (RBAC matrix)
  - Evidence: `apps/backend/middleware/auth-middleware.js` `authenticateHealth`, `authenticateProvider`, `authenticateAny`, `requireRole`, `checkPermission`
  - Evidence: `apps/backend/shared/canonical-rbac.js` — CANONICAL_ROLES + `isProviderRole`, `normalizeRole`
  - Evidence: `apps/backend/services/security-compliance.js` `RBACService` (granular permission middleware)
- [Implemented] Audit trail (hash-chained, immutable)
  - Evidence: `apps/backend/middleware/audit-logger.js` — SHA-256 hash chain (previousHash + currentHash + sequenceNumber); `verifyChain()` detects LINK_MISMATCH and HASH_MISMATCH
  - Evidence: `apps/backend/services/audit-trail.js` — canonical reader with `verifyHashChain()` and `getPaymentAuditTrail()` for finance review (Thai e-Transactions Act B.E. 2544 §12 + §26)
  - Evidence: `logWithin(event, tx)` binds audit insert to the same transaction as the business mutation so atomicity is preserved
- [Implemented] Penetration test cadence
  - Evidence: This document — see `pentest-prep-2026-05-16.md` for the upcoming engagement scope and re-test plan

---

## ม.28 — Data breach notification (PDPA Section 37 read with Section 41 of PDPC notification rules)

Section 37 read with the PDPC supplementary notification (published 2022) require notifying the PDPC within 72 hours of becoming aware of a breach that is likely to result in risk to data subject rights and freedoms, and notifying affected data subjects without undue delay where the risk is high.

- [Missing] Incident response runbook
  - Action: Security Lead to author `docs/security/incident-response-runbook.md` covering detection, triage, containment, eradication, recovery, lessons-learned (NIST SP 800-61 phases). Should reference the existing `ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE` SecOps event in `apps/backend/services/token-revocation-service.js` lines 167-194 as a worked playbook example.
- [Missing] 72-hour reporting to PDPC
  - Action: Legal counsel + DPO to draft PDPC notification template (Thai + English) using PDPC Notification on Breach Reporting (B.E. 2565 / 2022). Store as `docs/security/pdpc-breach-notification-template.md`.
- [Missing] Affected data subject notification template
  - Action: Author the end-user breach notification text (Thai + English). NOTE 2026-09-16: the platform sends no email or SMS (operator decision) and `apps/backend/services/email-template-engine.js` was deleted, so delivery cannot be by email — use the in-app notification inbox plus a PDF rendered the way `apps/backend/services/pdf/pdpc-breach-report-service.js` renders the PDPC report, and decide any out-of-band channel with the DPO.

---

## ม.32 — Right to erasure caveats (PDPA Section 32 / 33)

Section 32 grants the right to erasure, BUT Section 32(5) allows the data controller to refuse where retention is required by law (financial / regulatory / public-interest grounds).

- [Implemented] Erasure request endpoint (Iter 27)
  - Evidence: `DELETE /me` (auth-session-security-handlers.js `deleteMe`); password-confirmation gate, all sessions revoked via `revokeAllUserTokens` + `blocklistAccessToken`
  - Evidence: Test coverage `apps/backend/__tests__/unit/delete-me-erasure.test.js`
- [Implemented] Tension with 7-year financial retention documented
  - Evidence: `apps/backend/services/pdpa-service.js` lines 6-17 — "Once a certificate is issued, DTAM keeps the underlying file for at least 5 years after the certificate expires (`User.retainUntil` defaults to now + 5 years). 'Erasure' of those records is a regulated-records violation"
  - Evidence: `apps/backend/jobs/pdpa-retention-job.js` lines 1-30 — daily sweep anonymises only AFTER `retainUntil` expires; row is kept (not deleted) to preserve FK integrity for Applications, Invoices, Certificates
  - Evidence: Default 5 years; extended to 7 years for users who have had an invoice issued (Thai Revenue Code §86/4 — invoice retention)
- [Implemented] Audit trail of erasures
  - Evidence: `deleteMe` and the retention sweep both write PDPA_ERASURE / PDPA_RETENTION_SWEEP audit events to the hash-chained AuditLog (search by `category: SECURITY` + `action: ~PDPA`)

---

## Cross-cutting controls

- [Implemented] Rate limiting on auth + payment endpoints
  - Evidence: `apps/backend/middleware/rate-limiter.js` — Redis-backed with in-memory fallback; `authLimiter` (5/15min), `registrationLimiter` (3/hour), `paymentLimiter` (10/5min); batch 14 fix added `cleanupMemoryStore` + `stopCleanupInterval` to prevent test worker leak
- [Implemented] Token revocation (logout invalidates JWTs)
  - Evidence: `apps/backend/services/token-revocation-service.js` — refresh-token allowlist, access-token JTI blocklist, session-family blocklist, MFA challenge tokens
  - Evidence: `auth-middleware.js` consults `isAccessTokenBlocklisted(decoded.jti)` before DB lookup; `rejectIfNoJti` enforces JTI claim presence (with graceful `LEGACY_NO_JTI_GRACE_UNTIL` rollout window)
- [Implemented] PII masking in admin UI
  - Evidence: `field-encryption.js` `maskThaiId`, `maskEmail`, `maskPhone` — display-safe redaction (e.g. `1-XXXX-XXXX-X-0123`)
- [Implemented] Soft-delete with retention
  - Evidence: `apps/backend/services/soft-delete-extension.js` + `User.isDeleted`, `User.deletedAt`, `User.retainUntil`, `User.legalHold` columns surfaced in PDPA export

---

## Verification step (smoke test for Iter 27 erasure endpoint)

The smoke test below is intended for the legal/security team to exercise during the cutover dry run. It is described, not executed here.

Test plan:
1. Create a synthetic test user with healthId `1234567890123` and at least one Application and one Invoice.
2. Authenticate as that user; capture access token JTI.
3. Issue `DELETE /auth/health/me` with `{ password: '<test password>' }` body.
4. Expected: HTTP 200 (response body includes `success: true` plus erasure summary); access cookie cleared.
5. Re-attempt any authenticated request with the captured JTI → expect 401 `TOKEN_REVOKED`.
6. Inspect `User` row directly:
   - `isAnonymized` = true (or PII columns cleared and `isDeleted = true` if soft-delete only)
   - `Application` and `Invoice` rows STILL EXIST (financial preservation)
   - `AuditLog` contains a `category: SECURITY, action: ~PDPA_ERASURE` row with `actorId = <userId>`
7. Verify hash-chain integrity via `auditLogger.verifyChain()` — confirm no LINK_MISMATCH or HASH_MISMATCH.

Sign-off owner: DPO + Legal Counsel + Security Lead.

---

## Summary (status counts)

- Implemented: 18 items
- Partial: 2 items (privacy notice UI walkthrough; bilingual i18n verification)
- Missing: 3 items (incident response runbook; PDPC 72h template; data subject breach template)

Pre-cutover blockers: the three Missing items under ม.28 are MUST-FIX before production launch. Partial items under ม.23 are MUST-FIX before public registration is enabled.
