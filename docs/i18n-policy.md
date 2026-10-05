# i18n Policy — Project-Level Language Coverage Rules

**Status**: Active (codified Loop Y Iter 1 fix phase, 2026-05-18)
**Owners**: Front-end leads + Loop X auditors
**Loop X sources**: X1-A H-3 (HEALTH detail i18n), X2-A §6 (provider portal toggle gap), X4-A i18n-1 (accounting Thai-leaning), X5-A §10 (admin policy)

This document is the canonical reference for which user-facing surfaces of `GACP-Certification-Application` must ship in Thai + English (TH+EN) versus Thai-only by design. It is the policy artefact promised by Y1-AUDIT §4 "Recommended Y1 policy". Future audits that flag "missing English copy" on a Thai-only surface should be closed under this policy rather than treated as a defect.

The dictionary parity test (`apps/web-app/src/lib/i18n/__tests__/dictionary-parity.test.ts`) is the executable enforcement: namespaces present in the dictionaries MUST be 1:1 between TH and EN. Surfaces left out of the dictionaries (admin, account) therefore have no parity gate to fail, which is the mechanism that lets us keep them Thai-only without special-casing the test.

---

## Policy 1 — ACCOUNT_DTAM + ACCOUNT_PLATFORM pages are Thai-only

**Surfaces in scope** (10 files / ~340 Thai lines per Y1-AUDIT §4):

- `apps/web-app/src/app/provider/accounting/page.tsx` (slip review queue)
- `apps/web-app/src/app/provider/accounting/slip-review-modal.tsx`
- `apps/web-app/src/app/provider/accounting/ar-aging/page.tsx`
- `apps/web-app/src/app/provider/accounting/reports/ArAgingReport.tsx`
- `apps/web-app/src/app/provider/accounting/reports/client-view.tsx` (P&L / BS / GL / VAT)
- `apps/web-app/src/app/provider/accounting/manual-journal-entries/client-view.tsx`
- `apps/web-app/src/app/provider/accounting/period-close/client-view.tsx`
- `apps/web-app/src/app/provider/accounting/wht/client-view.tsx`
- `apps/web-app/src/app/provider/accounting/purchase-invoices/client-view.tsx`
- `apps/web-app/src/app/provider/receipts/page.tsx`

**Rationale** (per X4-A i18n-1):

1. **Target user population is 100% Thai-speaking**. ACCOUNT_DTAM users are DTAM (Department of Thai Traditional and Alternative Medicine) finance staff — Thai government employees. ACCOUNT_PLATFORM users are Predictive AI's internal finance team.
2. **Domain-specific Thai accounting terms have no canonical English equivalent that the target users would prefer**: สมุดรายวัน (general journal), ใบกำกับภาษี (tax invoice), ภ.ง.ด.30 / ภ.ง.ด.53 (PND.30 / PND.53 monthly withholding & VAT returns), ทบ.50 ทวิ (withholding-tax certificate), งบทดลอง (trial balance), บัญชีแยกประเภท (general ledger), งบกำไรขาดทุน (P&L). Each of these is a Thai-government-issued form identifier; translating to English would create round-trip ambiguity and is NOT what DTAM auditors expect to see.
3. **Legal accuracy**: Thai is the legally-binding language for accounting entries posted under TFRS for NPAEs and for Bank of Thailand (BOT) regulatory reporting. An English UI for accounting would create an information channel that is NOT the legal source of truth.
4. **Cost / benefit**: adding EN coverage for 10 files / 340 Thai literal lines would burn ~3 agent-days. The hypothetical foreign auditor use case is not on any product roadmap, and would require a separate localisation of the tax-form vocabulary anyway.

---

## Policy 2 — ADMIN pages are Thai-only by default

**Surfaces in scope** (13 files / ~290 Thai lines per Y1-AUDIT §4):

- `apps/web-app/src/app/admin/dashboard/page.tsx`
- `apps/web-app/src/app/admin/users/page.tsx`
- `apps/web-app/src/app/admin/audit-log/page.tsx`
- `apps/web-app/src/app/admin/applications/[id]/force-status/page.tsx`
- `apps/web-app/src/app/admin/organizations/page.tsx`
- `apps/web-app/src/app/admin/communication/page.tsx`
- `apps/web-app/src/app/admin/settings/page.tsx`
- `apps/web-app/src/app/provider/management/page.tsx` (legacy mirror)
- `apps/web-app/src/app/provider/admin/audit-log/page.tsx` (legacy mirror)
- `apps/web-app/src/components/admin/ChangeRoleModal.tsx`
- `apps/web-app/src/components/admin/UserDisableModal.tsx`
- `apps/web-app/src/components/admin/ForceStatusModal.tsx`

**Allowed English-leaning vocabulary** (does NOT violate this policy):

- HTTP status names ("HTTP 401", "404 Not Found")
- RFC / standards vocabulary ("CSRF", "JWT", "OAuth", "MFA", "TOTP")
- Backend error code identifiers as machine identifiers ("USER_NOT_FOUND", "SELF_DISABLE_FORBIDDEN")
- Stack trace / log surfaces visible only to platform operators
- ISO timestamps and database primary-key UUIDs

**Rationale** (per X5-A §10):

1. ADMIN users are DTAM IT operators and platform owners — Thai team.
2. International vendor support paths (Sentry, Datadog, Vercel) communicate to operators in HTTP / RFC vocabulary, not localised copy.
3. The 100%-Thai status was confirmed across all admin surfaces by X5-A and X5-FIX-{A,B,C,D} — none of those audits raised i18n as a defect.

---

## Policy 3 — HEALTH applicants + Provider portal (DR / SCH / AUD) require TH+EN

**Surfaces in scope** (45 files / ~870 mixed-language lines per Y1-AUDIT §2-§3):

- All `apps/web-app/src/app/health/**` routes EXCEPT the explicitly-Thai-only legal pages handled by Policy 4 below.
- All `apps/web-app/src/app/provider/**` routes EXCEPT `provider/accounting/**` (Policy 1).

**Rationale**:

- HEALTH applicants include cannabis cultivators applying for international export certification. EN coverage is a published feature on the marketing site.
- Provider portal users include DOCUMENT_REVIEWER, SCHEDULER, AUDITOR staff — some of these auditor seats are external contractors who may include subject-matter experts from international standards bodies (CODEX, WHO TRM, EU-GMP) who require an English UI.
- This policy is enforced by the dictionary parity test for every namespace under `core/auth/wizard/provider/health`.

**Mechanism**:

- The dictionary parity test (`dictionary-parity.test.ts`) asserts identical leaf-key shape between TH and EN.
- Each touched page MUST consume strings via `useLanguage()` → `t('namespace.key')`.
- A hardcoded Thai literal in a Policy-3 file is a defect; the executable banned-terms guard (`apps/web-app/scripts/check-banned-terms.cjs`) backstops the dict-parity test.

---

## Policy 4 — Login pages, Help center, Privacy / Terms of Service require TH+EN (legal surface)

**Surfaces in scope**:

- `apps/web-app/src/app/auth/**` (HEALTH login, Provider login)
- `apps/web-app/src/app/help/**` (help home, FAQ, glossary, contact)
- Any future `/privacy`, `/terms`, `/cookies` policy routes

**Rationale**: These pages are the public-facing legal surface and the first surface that a foreign-language applicant encounters. They MUST be navigable without a Thai reading ability so that an EN-only user can complete login → reach a localisable preference toggle. The toggle pattern is the contract: once logged in, Policy 3 surfaces present the user's selected language via the toggle (Y1-FIX-A pattern), but the LOGIN page itself must offer language choice without prior session.

---

## Policy 5 — Error codes always use English machine identifier + Thai user message

**Pattern**: Every error returned from the backend carries TWO orthogonal pieces of information:

1. A machine-readable English code (`INVALID_REVIEWER_SIDE`, `SELF_DISABLE_FORBIDDEN`, `USER_NOT_FOUND`) used for branching, logging, and Sentry breadcrumbs. The English identifier MUST be stable across releases.
2. A user-facing Thai message rendered in the UI, mapped from the English code via a small per-component `ERROR_MAP` constant (or the shared `apps/web-app/src/lib/i18n/error-code-map.ts` helper when 2+ components share codes).

**Why Thai for the message even when the rest of the page is bilingual**: error toasts are read by the user who is currently logged in; their session locale controls the rest of the UI; the error map should follow the page's locale. For Policy 1 + Policy 2 (Thai-only) pages the map ships Thai strings ONLY because there is no EN surface to which to defer. For Policy 3 + Policy 4 pages the map MAY ship TH+EN (current pattern only ships TH because all the admin modals predate the toggle introduced in Y1-FIX-A — extending to bilingual is a future cleanup, not a Y1 deliverable).

**Reference implementation**: `apps/web-app/src/app/provider/accounting/slip-review-modal.tsx::SLIP_REVIEW_ERROR_MAP` + `resolveSlipReviewError` (X4-FIX-C). Y1-FIX-D extends the same pattern to the ADMIN modals (ForceMfaResetModal was one of four until it was removed 2026-09-26 — operator: no one clears another account's 2FA) via the shared `apps/web-app/src/lib/i18n/error-code-map.ts` helper.

**Examples**:

```typescript
INVALID_REVIEWER_SIDE → "บัญชีของคุณตรวจสลิปฝั่งนี้ไม่ได้ — ส่งต่อให้ทีมบัญชีอีกฝั่ง"
SELF_DISABLE_FORBIDDEN → "ระบบไม่อนุญาตให้ผู้ดูแลระบบระงับบัญชีของตนเอง"
ROLE_ADMIN_CANNOT_BE_LAST → "ไม่สามารถลดบทบาทของผู้ดูแลระบบคนสุดท้ายได้"
MFA_USER_NOT_FOUND → "ไม่พบบัญชีผู้ใช้ที่ระบุ — อาจถูกลบหรือยังไม่เคยลงทะเบียน"
USER_HAS_PENDING_APPLICATIONS → "ผู้ใช้นี้มีคำขอที่กำลังดำเนินการอยู่ — ปิดงานก่อนจะระงับบัญชี"
INVALID_STATE_TRANSITION → "การเปลี่ยนสถานะนี้ไม่อนุญาตจาก state ปัจจุบัน"
APPLICATION_LOCKED → "คำขอนี้ถูกล็อกชั่วคราว — รีเฟรชหน้าจอแล้วลองอีกครั้ง"
```

---

## Override procedure

If a future stakeholder requests EN coverage for a Thai-only surface (Policy 1 or 2):

1. **Extend the dictionary parity test scope** to include the affected namespace. This is the executable gate that turns the policy reversal into a fail-closed mechanism — the build will fail until TH and EN are 1:1.
2. **Add `health.account.*` or `admin.*` namespaces** to both `apps/web-app/src/lib/i18n/dictionaries/sections/{th,en}-{account,admin}.ts` (NEW files).
3. **Wire `useLanguage()` into every page covered** by the new namespace, replacing hardcoded literals with `t()` calls.
4. **Update this document** to record the policy reversal.

The cost estimate per X4-A i18n-1: ~3 agent-days for accounting alone, ~2 agent-days for admin. Do NOT take this on without an explicit product sign-off.

---

## References

- Y1-AUDIT §4 "ACCOUNT + ADMIN i18n policy question" (codified the recommendation)
- X4-A i18n-1 finding (LOW severity, acceptable by design)
- X5-A §10 (100% Thai across admin surfaces — acceptable)
- X4-A UX-D8 / X4-FIX-C `SLIP_REVIEW_ERROR_MAP` (reference implementation for Policy 5)
- Dictionary parity test: `apps/web-app/src/lib/i18n/__tests__/dictionary-parity.test.ts`
- Banned-terms guard: `apps/web-app/scripts/check-banned-terms.cjs`
