> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# Billing + Payment Flow Audit — GACP Platform

- **Reviewer:** Project team
- **Date:** 2026-04-28
- **Mode:** Read-only research

## Executive Summary

The billing system is **structurally sound at the gateway/webhook layer** (atomic Phase-1/2 transactions, HMAC-verified webhooks with replay protection, amount-tampering guard, Serializable receipt-number transaction). The complaint "หลอนๆ" is **not at the gateway boundary** — it is a **fee-decomposition mismatch between three competing sources of truth** that produces visibly inconsistent numbers and "phantom unpaid" states even after the user pays.

**Top 3 strengths:**

1. Webhook flow (`payment-service-webhook-flow.js`) is genuinely production-grade: HMAC sha256 + Stripe-style v1=, 5-min replay window, amount-tampering guard, optimistic-lock `updateMany` race-guard, atomic `$transaction` for txn+app status.
2. Phase-1/2 payment creation is `$transaction`-atomic over `Application.update + paymentTransaction.create` (`payment-service-phase-flow.js:108-146`, `:244-280`) — no half-created payment rows.
3. Receipt issuance uses `isolationLevel: 'Serializable'` to prevent duplicate `RCP-YYYY-NNNNN` numbers (`invoice-service.js:343-361`).

**Top 5 gaps:**

1. **Three different fee models silently disagree.** `fee-service.js` returns `total: stateAmount` only (5,000 / 25,000) while `payment-fees.js` claims `PHASE_1_TOTAL: 5535` (state + 10% platform + 7% VAT) and the web client `fees.ts` agrees with the latter. The PaymentTransaction is created at the *fee-service* number (5,000), but the API response in `routes/api/finance/payments.js:262-267` returns the `payment-fees.js` breakdown (5,535) — so what we tell the user differs from what we charge the gateway.
2. **Two-invoice-per-phase model vs one-transaction-per-phase model.** `application-phase-invoice-methods.js` writes a STATE invoice (`PHASE_1_STATE_FEE`) AND a PLATFORM invoice (`PHASE_1_PLATFORM_FEE`); `phase-billing-service.computePhaseSettlement` requires both to be PAID before `phasePaid=true`. But `payment-service-phase-flow.js` creates a **single** PaymentTransaction at `phase1.total` (state-only). Result: webhook marks the single txn SUCCESS → `Application.phase1Status='PAID'` is set directly, but `syncPhaseStatusesFromInvoices` re-derives from invoices and finds the platform invoice still PENDING. The `/payments/status` endpoint surfaces both views; the UI sees contradictory `phase1Status='PAID'` but `phaseBreakdown.platform.status='PENDING'`. **This IS the visible "หลอนๆ".**
3. **Three duplicate `resolveHealthId` helpers, two of them inconsistent.** `routes/api/finance/payments.js:96-112` reads ONLY `user.healthId`. `routes/api/finance/invoice-helpers.js:12-29` and `routes/api/finance/quotes.js:19-34` both prefer `canonicalId || healthId`. After migration `20260409140000_invoice_fk_to_canonical_id`, the FK target is `users.canonicalId`, so on edge cases the payments routes will 401-Unauthorized while invoice/quote routes succeed.
4. **`pricing.js:188` Phase 2 areaCount bug.** `phase2Total = includeInspection ? inspectionFee : 0;` — does not multiply by `areaCount`. `fee-service.calculatePhase2Fee` (the canonical) does multiply. Public `/api/pricing/calculate` undercharges multi-method applications.
5. **Broken finance endpoints.** `invoice-finance-ops.js:43-51, 67-75` reads/writes a `metadata` JSON column on `Invoice`, but `billing.prisma` has no such column. `POST /api/invoices/:id/hold` and `/release` will throw Prisma `P2009` / unknown-column at runtime. Also `accounting.js:30,75-83` only counts `status: 'paid'` (lowercase), so the accountant dashboard under-counts paid invoices because `invoice-service.markAsPaid` writes `'PAID_PENDING_RECEIPT'` and webhook writes `'PAID'`.

**Single biggest "flow หลอนๆ" issue.** The dual-invoice (STATE + PLATFORM) model in `phase-billing-service` was added on top of an older single-transaction-per-phase model in `payment-service-phase-flow`. They were never reconciled. After payment, `Application.phase1Status='PAID'` (set by webhook), `PaymentTransaction.status='SUCCESS'`, but the platform invoice is still PENDING because nothing ever marks it paid. The status endpoint serves both views; the UI correctly displays "you paid" AND "you still owe the platform fee". That dissonance is what feels hallucinatory — the system isn't lying, it's reporting two incompatible models simultaneously.

## 1. Identity model and billing entity

**Files:** `apps/backend/prisma/schema/auth.prisma:21-27`, `apps/backend/prisma/schema/billing.prisma:15-16`, migrations `20260404080000_add_canonical_id`, `20260409140000_invoice_fk_to_canonical_id`.

- `User` has `healthId` (HEALTH applicants), `providerId` (PROVIDER staff), and `canonicalId` (always set; backfilled to equal healthId for HEALTH users). `Invoice.healthId` is a poorly-named column whose FK now points at `users.canonicalId`.
- **There is no provider-side billing.** Search for `Invoice.providerId` returns nothing. A PROVIDER User cannot own an invoice because the invoice's only User-pointing column is `healthId`. Technically OK (providers paid out of state fees, not invoiced) but the column name is the source of confusion.
- **Verdict on "doesn't support both health id and provider id":** The system **does** support both identities at the User level (auth.prisma is well-designed with `accountType`, `authType`, `canonicalId`). What's actually broken is that `routes/api/finance/payments.js:96-112` resolves identity differently than `invoices.js`/`quotes.js`. **This is identity drift across helpers, not a missing identity model.**

**Concrete fix:** Hoist a single `resolveBillingIdentity(req.user)` from `invoice-helpers.js` into `shared/auth/` and import from all three finance route files. ~30 LOC.

## 2. Two-phase fee model

- Phase 1: 5,000 (state) + 500 (platform 10%) + 35 (VAT 7% on platform) = **5,535** *per cultivation method*.
- Phase 2: 25,000 + 2,500 + 175 = **27,675** *per cultivation method*.
- `fee-service.buildPhaseFee` computes ALL components correctly (lines 87-127) but then returns `total: stateAmount` (line 125) — losing platform+VAT.
- `payment-service-phase-flow.createPhase1Payment:57` reads `calculatedFees.phase1.total` → gets 5,000 only → creates Ksher order for 5,000 → user pays 5,000 → webhook receives 5,000 → marks Phase 1 paid.
- Meanwhile `application-phase-invoice-methods.ensurePhaseInvoices:185-206` creates two invoices: STATE 5,000 + PLATFORM 500 (no VAT line item — VAT silently dropped at the invoice level). Total invoiced: 5,500 ≠ 5,535 ≠ 5,000 charged.

**Concrete fix:** Make `fee-service.buildPhaseFee` return `total: phaseTotal`. Update consumers. Add integration test that cross-references all three sources of truth. ~50 LOC + 1 test file.

## 3. Invoice generation

- Per phase, **two invoices** are created (STATE component + PLATFORM component). For a 3-method application: 4 invoices total (state + platform per phase).
- VAT is **never** materialized as an invoice or invoice line item. The 7% VAT is computed in `fee-service`, displayed in `payment-fees.computePhaseBreakdown.lineItems[2]`, but never written to a database row.
- "Tax invoice" vs "receipt": Both exist. Receipt issued by ACCOUNTANT role manually after payment.
- Legacy `Invoice.items` JSON field still exists alongside structured `InvoiceLineItem` rows — both written, neither used as canonical for downstream PDFs.

**Concrete fix:** Either (a) make VAT a third Invoice row (`PHASE_1_VAT` service type), or (b) make VAT a third line item on the PLATFORM invoice and mark `isTaxable=true`. (b) is less LOC. Drop the legacy JSON `items` write. ~80 LOC.

## 4. Payment Gateway integration

- Active gateway: **Ksher** (Thai PromptPay aggregator) in production, Mock in dev.
- Webhook security is **good**: HMAC-sha256, supports plain `<hex>`, `sha256=<hex>`, Stripe-style `t=ts,v1=hex` (with 5-min replay window), constant-time compare.
- Idempotency: `gatewayRef` has unique constraint, transaction-level guard prevents double-processing.
- Amount-tampering guard accepts both baht and satang — sensible.
- **Refunds: not implemented.** Schema supports `PaymentTransaction.status='REFUNDED'` but no service method or route. Manual DB edit only.
- **Failed payment retry:** `getPaymentUrl` reuses existing payment URL if `phase1Status='PROCESSING'` and not expired. No automatic retry.

**Concrete fix:** Add refund endpoint that wraps Ksher refund API + audit-log + state update. ~120 LOC.

## 5. PromptPay / QR / bank transfer

- **Live mode:** Ksher returns `code_url` → backend converts to QR via `qrcode` package. Frontend gets both QR image AND payment_url.
- **Bank transfer / counter service:** Listed in `payment-fees.PAYMENT_METHODS` constant but no UI surface or backend route. `BANK_ACCOUNTS.PRIMARY` constant exists but nothing serves it.
- **Reconciliation:** `PaymentReconciliation` model exists in schema. **Dead model.**
- Mock-confirm endpoint correctly disabled in production.

**Concrete fix:** Either expose bank account info via `/api/payments/bank-details` + add slip upload flow, or remove dead references. ~150 LOC for build, ~10 LOC for removal.

## 6. Phase transitions and money atomicity

- Phase-1/2 creation: atomic ($transaction). 
- Webhook: atomic ($transaction).
- **`syncPhaseStatusesFromInvoices` is the trouble spot.** Runs OUTSIDE the webhook transaction, reads invoice settlements, only ever **adds** PAID flags — never clears stale PAID flags. So if webhook sets `phase1Status='PAID'` directly, then `syncPhaseStatusesFromInvoices` runs, finds platform invoice still PENDING, computes `phasePaid=false`, but the if-condition `if (phase1Paid && ... !== 'PAID')` is false → no update. Application stays PAID. Status endpoint then returns `phase1Status='PAID'` AND `requiredInvoices.phase1[1].status='PENDING'` — visible contradiction.

**Concrete fix:** Pick a model. Option A (recommended, lower risk): collapse to ONE invoice per phase with three line items (STATE, PLATFORM, VAT). Then PaymentTransaction.amount === Invoice.totalAmount, webhook marks both invoice and application paid in single $transaction, settlements never disagree. ~150 LOC including migration.

## 7. Renewal / subscription

- The "subscription" page is a **SaaS-tier upsell** (Free / Premium 990/mo / Enterprise) for platform features. **NOT cert renewal.** Currently disabled by `BILLING_FREE_TIER_FOR_ALL` env flag.
- `GACP_RENEWAL_FEE = 30,000` exists but **no backend service or route processes a renewal.** No `Application.parentApplicationId`. No `Certificate.renewedFromId`.
- 3-year cert validity encoded in `certification.prisma` and `help-center.tsx`.

**Verdict:** Subscription and renewal are **two unrelated unfinished features** sharing the word "billing". For renewal, recommend adding `Application.serviceType='RENEWAL'` branch in `fee-service` that returns 30,000 + platform + VAT and skips Phase 2 if previous audit was within validity. ~200 LOC + new route.

## 8. Provider-side billing

- "Quote" is a **finance-staff-issued price quote** sent to applicant before invoice generation. Used for special-case pricing only.
- `ACCOUNTANT` canonical role has `INVOICE_VIEW_ALL`, `RECEIPT_ISSUE`, `ACCOUNTING_DASHBOARD_READ` permissions.
- **Provider compensation (auditor pay-per-audit) is NOT implemented.** No `AuditorPayout` model. Auditors presumed salaried, not piece-rate.

## 9. Audit trail of money

- Every payment-initiation route logs to `auditLog` (category `PAYMENT`).
- Webhook logs WEBHOOK_PROCESSED, _INVALID_SIGNATURE, _UNMATCHED, _AMOUNT_MISMATCH, _IDEMPOTENT, _PROCESSING_FAILED.
- Receipts retrievable via `/api/invoices/:id/receipt/pdf` (provider role only) — applicant cannot self-download their receipt. **Gap.**

## 10. Failure modes

- **Pay phase 2 then audit FAIL:** No automatic refund. Manual DB edit + accountant generates credit note (which doesn't exist as a feature). **Major gap.**
- **Cancel mid-flow:** No `POST /api/applications/:id/cancel` with refund logic.
- **Cert revoked post-issue:** `revokeCertificate` exists but does not interact with billing. Money stays.
- **`auditResult=FAIL` set by mistake:** No undo mechanism.

## Prioritized Roadmap

### Phase A — STOP THE BLEEDING (2-3 days, ~150 LOC)

1. **Unify `resolveHealthId`** into `shared/auth/billing-identity.js`. Eliminates 401 inconsistency. ~50 LOC delta.
2. **Fix `fee-service.buildPhaseFee` to return `total: phaseTotal`** (state+platform+VAT). Eliminates the 5,000-vs-5,535-vs-5,500 mismatch. ~30 LOC + 1 test.
3. **Fix `pricing.js:188`** to multiply Phase 2 by `areaCount`. One-liner.
4. **Fix `accounting.js`** to use the same `canonicalPaidStatuses()` set as `invoice-service`. ~20 LOC.
5. **Remove or fix `holdInvoice`/`releaseHold`** writing to nonexistent `metadata` column. ~50 LOC.

### Phase B — FIX THE FLOW (1-2 weeks, ~400 LOC)

6. **Collapse dual-invoice model to single-invoice-per-phase with three line items.** Drop `PHASE_1_PLATFORM_FEE`/`PHASE_2_PLATFORM_FEE` Invoice rows. Migration: merge existing platform invoices into state-invoice line items. ~250 LOC including migration.
7. **Make `syncPhaseStatusesFromInvoices` bidirectional** — clear stale PAID flags. Or remove entirely once (6) lands. ~30 LOC.
8. **Add applicant-side receipt download** at `GET /api/invoices/:id/receipt/pdf` with `authenticateHealth`. ~40 LOC.

### Phase C — FILL THE GAPS (4-6 weeks, ~800 LOC)

9. **Refund flow:** `POST /api/payments/:txnId/refund` with role=ACCOUNTANT. ~250 LOC.
10. **Cancel mid-flow:** `POST /api/applications/:id/cancel` with refund-policy decision tree. ~200 LOC + policy doc.
11. **Renewal workflow:** `Application.serviceType='RENEWAL'` branch with 30,000 single-phase fee. ~250 LOC.
12. **Bank-slip upload + reconciliation revival** OR removal of dead `BANK_ACCOUNTS`/`PaymentReconciliation`.

## Explicit non-recommendations

- **Do NOT rewrite the Ksher integration.** Most solid part of the system.
- **Do NOT add a third-party billing engine (Stripe Tax, Chargebee, etc.).** Thai government VAT model is bespoke.
- **Do NOT introduce a separate `BillingAccount` model to "support both health id and provider id".** User table already supports both; bug is in three drift'd helper functions.
- **Do NOT move webhook processing to a background queue.** Synchronous-with-optimistic-lock is correct at this scale.
- **Do NOT try to fix renewal and subscription in the same PR.** Conflating them is what got us here.

## Total LOC + files touched estimate

- **Phase A:** ~150 LOC across 5 files
- **Phase B:** ~400 LOC across 4 files + 1 migration
- **Phase C:** ~800 LOC across ~10 files + 2-3 migrations
- **Grand total:** ~1,350 LOC, ~20 files. **Effort: 6-9 dev-weeks.**

## Health-id vs provider-id verdict

**Looks broken, not actually broken.** The User model and FK migration are correct. The bug is identity-helper drift across three finance route files (one ignores canonicalId). Fix is ~50 LOC of dedup, NOT a data-model change.

## Surprises

- "Subscription" page is a SaaS-tier upsell, not cert renewal — completely unrelated to certification billing.
- `Invoice.metadata` is written by `holdInvoice`/`releaseHold` but doesn't exist in schema — endpoints are dead at runtime.
- `PaymentReconciliation` model exists with no code references.
- No applicant-side receipt-PDF download.
