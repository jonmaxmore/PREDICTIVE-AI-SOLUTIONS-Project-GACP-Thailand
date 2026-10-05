# Step 2 — Data Model & Accounting Architecture Redesign (DRAFT v2 for review)

- **Date:** 2026-08-02 (v2 — revised same day under the Stripe master directive)
- **Status:** DESIGN DRAFT — nothing here is applied. The Prisma blocks below are proposals; the migration ships in Wave 1 only after this document is approved.
- **Inputs:** `legacy-payment-audit.md` (Step 1), the **Stripe master directive** (canonical 7-step workflow, Stripe-only automated flow, zero-slip purge), the dormant collection-agent accounting engine in `journal-entry-service.js`.
- **D1 is RESOLVED by the master directive:** settlement is **Stripe-only** (Payment Intents — PromptPay QR / credit card). The manual slip pipeline is 100% deprecated and is **purged in Wave 2**. v1 of this draft carried a dual-channel `MANUAL_SLIP` design; it is superseded.
- **Open decisions still gating parts of this design:** D2 (mid-flight applications — now sharper: in-flight slip-based payments must drain or migrate before the purge), D3 (refund semantics under pass-through — Stripe refunds API becomes the vehicle), D4 (renewal checkout), D5 (`PLATFORM_BANK_ACCOUNT` confirmation — now the Stripe payout destination).
- **Operating entity:** บริษัท พรีดิกทีฟ เอไอ โซลูชั่น จำกัด (Predictive AI Solutions Co., Ltd.). Stripe statement descriptor: **`PREDICTIVE AI - GACP`** (20 chars — within Stripe's 22-char limit).

## 0. The canonical 7-step workflow (LOCKED)

The directive's 7-step sequence is the core-app pillar. Mapping onto the state machine:

| Step | Thai | State-machine anchor | Gate |
|---|---|---|---|
| 1 | ยื่นคำขอ + 💳 Milestone 1 checkout | `SUBMITTED → PENDING_M1_PAYMENT` | Stripe Payment Intent created |
| 2 | เจ้าหน้าที่กระจายงาน งวดที่ 1 | `PENDING_M1_PAYMENT → M1_PAID → ASSIGNED_FOR_REVIEW` | **unlocked ONLY by verified `payment_intent.succeeded` webhook** |
| 3 | เจ้าหน้าที่ตรวจเอกสาร | `ASSIGNED_FOR_REVIEW → (review loop)` | — |
| 4 | เอกสารผ่าน + 💳 Milestone 2 trigger | `DOC_APPROVED → PENDING_M2_PAYMENT` | notification + direct checkout link |
| 5 | เจ้าหน้าที่กระจายงาน งวดที่ 2 | `PENDING_M2_PAYMENT → M2_PAID → (scheduling)` | **unlocked ONLY by verified webhook** |
| 6 | ลงตรวจสอบพื้นที่ฟาร์มจริง | audit states (`AUDIT_CONFIRMED → AUDIT_PASSED`) | — |
| 7 | ออกใบรับรอง GACP | `APPROVED → CERTIFIED` | — |

Exact state names are Wave-3 vocabulary work; what is LOCKED here is the **shape**: two payment gates, each exited exclusively by the cryptographically-verified webhook (SYSTEM actor in `ALLOWED_TRANSITIONS` — no human role holds the `PENDING_M*_PAYMENT → M*_PAID` edge, which the existing per-role edge grants enforce mechanically). Every settlement auto-triggers split-invoicing (§5). The `PHASE_*_SLIP_UNDER_REVIEW` states die with the slip pipeline — the two 3-state gates become two 2-state gates.

## 1. Design principles

1. **One checkout = one order = one invoice = one (eventual) charge.** The four-invoices-per-application shape dies; the itemized breakdown moves into line items and denormalized totals on the order.
2. **Reuse what the audit proved sound.** `modules/billing` already computes the exact decomposition; `InvoiceLineItem` is the natural line-item home; per-issuer receipt numbering + RSA signing become the split-document engine; the dormant collection-agent journal doctrine is revived, not rebuilt.
3. **Repo conventions hold.** Money is `Decimal(15,2)` THB (PSP charge amounts stay satang-`Int` on `PaymentTransaction` for gateway fidelity); state machines are `String` columns backed by a frozen JS SSOT **plus a Postgres `CHECK` constraint** — see §3.3 for why not a Prisma enum.
4. **Expand-migrate-contract.** Everything below is EXPAND: new tables and columns beside the old. No two-step column is dropped until Wave 4.

## 2. New models (Prisma draft)

### 2.1 `CheckoutOrder` — the single payment event

```prisma
// One row per lump-sum checkout. THE aggregate the applicant pays against:
// carries the itemized breakdown (denormalized from the line items for O(1)
// reads), the single PromptPay QR payload, the settlement channel, and the
// pass-through liability status. TENANT_SCOPED.
model CheckoutOrder {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // What is being paid for. XOR — exactly one target, same pattern as
  // Invoice.applicationId/subscriptionId today.
  applicationId  String?
  application    Application?  @relation(fields: [applicationId], references: [id])
  subscriptionId String?       // D4 gates whether renewals ride this rail
  subscription   Subscription? @relation(fields: [subscriptionId], references: [id])

  // ── Itemized breakdown (THB, Decimal(15,2)) ──
  // Sourced from modules/billing whole-application totals:
  //   stateTotal → dtamFeeAmount, platformTotal → platformFeeNet,
  //   vatTotal → platformFeeVat, grandTotal → totalPayableAmount.
  // CHECK constraints in the migration enforce the arithmetic:
  //   platform_fee_gross = platform_fee_net + platform_fee_vat
  //   total_payable_amount = dtam_fee_amount + platform_fee_gross
  dtamFeeAmount      Decimal @db.Decimal(15, 2) @map("dtam_fee_amount")      // pass-through, VAT-exempt (ม.77/1(10))
  platformFeeNet     Decimal @db.Decimal(15, 2) @map("platform_fee_net")     // excl. VAT
  platformFeeVat     Decimal @db.Decimal(15, 2) @map("platform_fee_vat")     // 7% ของ platform_fee_net
  platformFeeGross   Decimal @db.Decimal(15, 2) @map("platform_fee_gross")   // net + VAT
  totalPayableAmount Decimal @db.Decimal(15, 2) @map("total_payable_amount") // the single QR amount

  // ── Checkout lifecycle (String + CHECK + frozen JS SSOT, §3.3) ──
  // PENDING_PAYMENT → SETTLED | EXPIRED | CANCELLED.
  // Stripe-only (master directive): there is NO slip-review interlude —
  // the only path to SETTLED is the verified payment_intent.succeeded
  // webhook. Human roles cannot write this transition.
  status String @default("PENDING_PAYMENT")

  // Milestone this checkout collects (the two gates of the canonical
  // 7-step workflow). 'M1' | 'M2'.
  milestone String

  // ── Stripe binding ──
  // One PaymentIntent per order, created with idempotency key
  // `checkout:{orderId}` so re-entry never double-charges. Amount is
  // total_payable_amount in SATANG (Stripe THB minor units), currency 'thb',
  // payment_method_types ['promptpay','card'], statement descriptor
  // 'PREDICTIVE AI - GACP'.
  stripePaymentIntentId String?  @unique @map("stripe_payment_intent_id")
  expiresAt             DateTime?
  settledAt             DateTime?

  // The ONE invoice this order mints (replaces the per-phase pair×2).
  invoiceId String?  @unique
  invoice   Invoice? @relation(fields: [invoiceId], references: [id])

  // The charge record — revived PaymentTransaction (gateway='STRIPE',
  // gatewayRef=PaymentIntent id, satang amount, webhook columns live again).
  paymentTransactionId String?             @unique
  paymentTransaction   PaymentTransaction? @relation(fields: [paymentTransactionId], references: [id])

  // ── DTAM pass-through liability (§2.2) ──
  // PENDING → BATCHED → REMITTED → RECONCILED. Set to PENDING at settlement
  // (that is when the liability comes into existence), advanced by the
  // remittance batch it joins. NULL before settlement.
  dtamRemittanceStatus String? @map("dtam_remittance_status")
  remittanceBatchId    String?
  remittanceBatch      DtamRemittanceBatch? @relation(fields: [remittanceBatchId], references: [id])

  // Tenancy (ADR-014)
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  // Idempotency: one open order per target. Partial unique index in the
  // migration (WHERE status IN ('PENDING_PAYMENT','SLIP_UNDER_REVIEW')).
  @@index([applicationId])
  @@index([status])
  @@index([dtamRemittanceStatus])
  @@index([organizationId])
  @@map("checkout_orders")
}
```

### 2.2 `DtamRemittanceBatch` — the pass-through clearing vehicle

```prisma
// A batch of settled checkouts whose DTAM fees are remitted to the department
// in one bank transfer. Net-new schema — the audit confirmed the orphan
// PaymentReconciliation model is not a usable base (Float money, never
// written). Lifecycle: OPEN → REMITTED → RECONCILED.
model DtamRemittanceBatch {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  batchNumber String @unique // RMT-<yearBE>-<seq> via document-numbering

  status String @default("OPEN") // 'OPEN' | 'REMITTED' | 'RECONCILED'

  // Sum of member orders' dtamFeeAmount — CHECK >= 0; asserted equal to the
  // member sum at REMITTED transition (service-level, inside the tx).
  totalAmount Decimal @db.Decimal(15, 2)

  remittedAt    DateTime?
  bankReference String?   // the actual transfer reference to กรมฯ
  reconciledAt  DateTime?
  // bank-reconciliation-service is the chassis for the RECONCILED leg: the
  // batch is RECONCILED when its bankReference matches a statement line.

  journalEntryId String? // the Dr 2151-001 / Cr 1110-001 clearing entry (§4)

  orders CheckoutOrder[]

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([status])
  @@index([organizationId])
  @@map("dtam_remittance_batches")
}
```

Per-order liability semantics: `CheckoutOrder.dtamRemittanceStatus` is `PENDING` from settlement, `BATCHED` when attached to an OPEN batch, then follows the batch to `REMITTED`/`RECONCILED`. The `ACCOUNT_DTAM` role's job shifts from slip review to **remittance oversight** (creating batches, recording the transfer, confirming reconciliation) — the SoD role split survives with a new purpose.

### 2.3 Touched existing models (EXPAND only)

| Model | Change |
|---|---|
| `Invoice` | Gains nothing structural — the checkout invoice is a normal Invoice whose `serviceType` uses one new value (`CERTIFICATION_CHECKOUT`) and whose line items carry the breakdown. Old vocabulary untouched until Wave 4. |
| `InvoiceLineItem` | New `code` vocabulary: `DTAM_FEE` (`isTaxable=false`), `PLATFORM_FEE` (`isTaxable=true`), `PLATFORM_VAT`. `phase` stays nullable and unused for checkout invoices; dropped in Wave 4. |
| `PaymentTransaction` | Revived for the gateway channel: `phase` nullable-ized (Wave 4 drops it), satang `amount`, `gatewayRef`, `idempotencyKey` and webhook columns as-is. One row per charge attempt. |
| `PaymentSlip` | **No new columns — the model is on death row.** The slip pipeline is purged in Wave 2 (master directive); the table itself drops in Wave 4 after mid-flight rows resolve (D2). Historical rows are read-only evidence until then. |
| `StripeWebhookEvent` (NEW) | Raw-event dedup store: `id` (Stripe `event.id`, `@unique` — the idempotency lock), `type`, `payload Json`, `receivedAt`, `processedAt`, `error`. Unlike the dropped `PaymentAudit` this HAS a reader: the webhook handler inserts-first and skips on unique-violation, which is what makes redelivered events no-ops. |
| `Application` | Gains nothing. `phase1*/phase2*` families stay frozen until Wave 4; the workflow-state collapse (Wave 3) governs `status`. |

## 3. Vocabulary & enforcement

### 3.1 Checkout status SSOT

`shared/checkout-status.js` (new): frozen `CHECKOUT_STATUSES`, `ALLOWED_CHECKOUT_TRANSITIONS`, boot-time totality assertion — same machinery as `workflow-transition-service`, ratcheted by the existing `no-legacy-status-vocabulary` ESLint rule.

### 3.2 `DtamRemittanceStatus`

Frozen JS SSOT `DTAM_REMITTANCE_STATUSES = Object.freeze(['PENDING','BATCHED','REMITTED','RECONCILED'])` + the same transition-guard shape.

### 3.3 Why `String + CHECK`, not a Prisma enum

The directive asks for a `DtamRemittanceStatus` enum. The repo has **zero Prisma enums** — every state machine is a String backed by a frozen JS vocabulary, boot-time totality assertions, and the AST ratchet; all of that machinery keys on strings. Recommendation: keep the pattern but add what it lacked — a **Postgres `CHECK` constraint** per state column (`CHECK (dtam_remittance_status IN (...))` etc.), giving DB-level enforcement equal to an enum without introducing a second pattern or Postgres-enum migration friction (`ALTER TYPE ... ADD VALUE` cannot run in a transaction). If the enum form is preferred anyway, the models above change mechanically — flagged as review decision **R1**.

## 4. Accounting engine wiring (revive, don't rebuild)

The dormant collection-agent doctrine in `journal-entry-service.js` maps 1:1 onto the target. Account codes already exist:

| Account | Code |
|---|---|
| Cash/Bank · main | `1110-001` |
| Output VAT 7% | `2131-001` |
| Payable to DTAM | `2151-001` (rename drops the "(legacy)" suffix) |
| Platform service revenue | `4110-001` |

**On settlement** (the verified `payment_intent.succeeded` webhook — the ONLY settlement path), inside the settlement transaction, via the existing `buildPaymentEntryLines` components path:

```
Dr 1110-001 Cash/PG            total_payable_amount
  Cr 2151-001 Payable-to-DTAM      dtam_fee_amount
  Cr 4110-001 Platform revenue     platform_fee_net
  Cr 2131-001 Output VAT           platform_fee_vat
```

The live `recordPaymentEntry` STATE short-circuit (`STATE_FEE_NOT_IN_SCOPE` — the "two transfers, never combined" doctrine) retires **for checkout-channel settlements only**; mid-flight two-step settlements keep the old path until D2 resolves.

**On remittance** (`DtamRemittanceBatch` → REMITTED), via the existing `buildRemittanceEntryLines` / `recordRemittanceToDtam` (currently zero callers — this is its first caller):

```
Dr 2151-001 Payable-to-DTAM    batch.totalAmount
  Cr 1110-001 Cash                 batch.totalAmount
```

Both entries go through the standard journal machinery (period-close guard, `UNBALANCED_ENTRY` check, hash-chained audit).

## 5. Split-document payload contracts

Generated at settlement, per checkout, using the existing per-issuer numbering (`receipt-numbering-service`) and per-entity RSA signing (`receipt-auto-sign-service`). Two documents, two legal identities:

```ts
// Document 1 — ใบกำกับภาษี/ใบเสร็จรับเงิน (platform revenue, VAT-registered seller)
interface PlatformTaxInvoicePayload {
  documentType: 'TAX_INVOICE_RECEIPT';
  issuer: 'PLATFORM';                       // Predictive AI Solution Co., Ltd. identity block
  documentNumber: string;                   // per-issuer PLATFORM sequence (ม.86/4 sequential)
  issuedAt: string;                         // ISO, VAT period anchor (ภ.พ.30)
  buyer: { name: string; taxId?: string; address?: string };  // applicant
  lines: [{ code: 'PLATFORM_FEE'; description: string; amount: string /* platform_fee_net */ }];
  vat: { rate: 0.07; amount: string };      // platform_fee_vat
  total: string;                            // platform_fee_gross
  checkoutOrderId: string;
  signature: RsaSignatureBlock;             // PLATFORM key
}

// Document 2 — ใบรับเงินแทน (pass-through disbursal receipt, VAT-exempt ม.77/1(10))
interface DtamDisbursalReceiptPayload {
  documentType: 'DTAM_DISBURSAL_RECEIPT';
  issuer: 'DTAM';                           // department identity block
  documentNumber: string;                   // per-issuer DTAM sequence
  issuedAt: string;
  payer: { name: string; taxId?: string };
  lines: [{ code: 'DTAM_FEE'; description: string /* ค่าธรรมเนียมราชการ */; amount: string }];
  vat: null;                                // VAT-exempt — stated explicitly on the document
  total: string;                            // dtam_fee_amount
  collectedAsAgentFor: 'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก';
  checkoutOrderId: string;
  remittanceStatusRef?: string;             // batch number once BATCHED+
  signature: RsaSignatureBlock;             // DTAM-side key
}
```

Storage: one row each in a new `CheckoutDocument` table (id, checkoutOrderId, documentType, documentNumber, payload Json, pdfPath, signedAt) — or reuse of the Invoice receipt columns for Document 1 — flagged as review decision **R2** (recommendation: the new table; the Invoice receipt column family assumes one receipt per invoice and Document 2 has no invoice).

## 5.5 Stripe gateway architecture (PCI-DSS posture)

**Payment Intent lifecycle.** Checkout creation calls `paymentIntents.create` with: `amount` = `total_payable_amount` in satang, `currency: 'thb'`, `payment_method_types: ['promptpay', 'card']`, `statement_descriptor: 'PREDICTIVE AI - GACP'`, `metadata: { checkoutOrderId, applicationId, milestone, organizationId }`, and idempotency key `checkout:{orderId}` — a retried create returns the same intent, never a second charge. The frontend confirms the intent with Stripe Elements (PromptPay renders Stripe's QR; card uses the card element) using the **publishable key only**.

**Webhook endpoint** (`POST /api/payments/stripe/webhook` — the green-field build the audit anticipated):
1. Mounted with `express.raw({ type: 'application/json' })` **before** any JSON body-parser — signature verification requires the exact raw bytes.
2. `stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)` — constructEvent enforces both the HMAC and Stripe's replay-protection timestamp tolerance; an invalid signature is a 400 with no side effects.
3. Insert into `StripeWebhookEvent` first; a unique-violation on `event.id` means a redelivery → return 200 immediately (idempotent no-op).
4. For `payment_intent.succeeded`: load the order by `metadata.checkoutOrderId`, **verify `amount_received` equals the order's `total_payable_amount` in satang** (a mismatch is an alert, not a settlement), then inside ONE transaction: order → `SETTLED`, journal entry (§4), split documents (§5), `dtamRemittanceStatus = 'PENDING'`, and the workflow transition (`M1_PAID` / `M2_PAID`) through `writeApplicationStatus` as SYSTEM actor.
5. `payment_intent.payment_failed` / `payment_intent.canceled` → order stays `PENDING_PAYMENT` (retryable) or moves to `CANCELLED`; recorded on the `PaymentTransaction`.
6. Handler returns 200 only after the transaction commits; a thrown error → 500 → Stripe retries → the dedup row (inserted but `processedAt` null) is re-processed, which the transaction makes safe.

**ROUNDING RULE (กติกาปัดเศษ — pinned by `money-equation-property.test.js`).** ทุก component ปัดของตัวเองแล้วค่อยบวก — ห้ามปัดผลรวม และห้ามคิด VAT จากค่าที่ยังไม่ปัด:

```
platform = Math.round(state × PLATFORM_RATE)      // ปัดรายชิ้น (half-up, บาทเต็ม)
vat      = Math.round(platform × VAT_RATE)        // คิดจาก platform ที่ปัดแล้ว
total    = state + platform + vat                 // ผลบวกของชิ้นที่ปัดแล้ว
```

SSOT ของกติกานี้คือ `buildPhaseFee` (`modules/billing/internal/fee-service.js`) — สมการ `total = dtam + net + vat` ที่ DB CHECK ของ Wave 1 บังคับจึงจริงโดยโครงสร้าง property test สุ่ม 1,000 เคสยืนยันทุก build

**Secret management (zero-trust):**

| Variable | Where | Rule |
|---|---|---|
| `STRIPE_SECRET_KEY` (`sk_…`/`rk_…`) | backend `.env` only | never in code, never logged, never in any frontend bundle — enforced by the existing Secret Scanning gate + a new AST rule forbidding `sk_` literals |
| `STRIPE_WEBHOOK_SECRET` (`whsec_…`) | backend `.env` only | absence = webhook route refuses to boot (fail-closed, same pattern as `PROVIDER_JWT_SECRET`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_…`) | frontend env | the only Stripe credential the client ever sees |

All three get documented `.env.example` entries with consequences (the #714 gate will force this mechanically).

## 5.6 Wave 2 slip-purge scope (zero-tolerance)

Purged when the Stripe path is live and mid-flight rows have resolved (D2):

- `services/payment-slip-service.js` (the whole PENDING→PAID slip machinery incl. the FOR-UPDATE write-skew guard that existed only because a phase settled across sibling invoices), `services/dtam-accountants.js` slip fan-out, `jobs/slip-sla-monitor.js`
- `routes/api/finance/payment-slips.js` (upload / pending / approve / reject / file), the slip rate-limiters, and the side-walled review queue surfaces in the provider accounting dashboard (web)
- Web: slip upload modals, `SlipHistorySection`, the two-card section already slated (`TwoCardPaymentSection`), slip-queue summary cards
- Flutter: the slip-upload flow inside the live `payment_screen.dart` + `payment_service.dart` (replaced by the Stripe checkout webview/Elements flow)
- Storage: the slip file bucket + its signed-URL path (`GET /:id/file`), retention per PDPA schedule for historical evidence
- `PaymentSlip` model → contract-dropped in Wave 4 with the other two-step columns
- The `ACCOUNT_DTAM`/`ACCOUNT_PLATFORM` slip-review permission edges retire; the roles keep the remittance-oversight and reporting surfaces

## 6. What this deliberately does NOT decide

- **D2** — whether mid-flight `PENDING_AUDIT_FEE` rows migrate or drain on legacy vocabulary. The EXPAND design coexists with both answers.
- **D3** — refunds under pass-through. `CheckoutOrder` deliberately has no refund columns; the dormant credit-note engine is the likely vehicle post-decision.
- **D4** — `subscriptionId` is present on `CheckoutOrder`; once decided, renewals ride the same Stripe checkout (they cannot stay on slips — the pipeline is being purged).
- **Wave 3 state collapse vocabulary** — exact names (`PENDING_PAYMENT` vs keeping `PENDING_DOC_FEE` as an alias window) belong to the Wave 3 design, not here.

## 7. Review checklist

- [ ] R1: String+CHECK vs Prisma enum for the new state columns (recommendation: String+CHECK)
- [ ] R2: `CheckoutDocument` table vs Invoice receipt columns for Document 1 (recommendation: new table)
- [ ] Confirm the breakdown column names match the reporting/e-Tax side's expectations (`dtam_fee_amount`, `platform_fee_net`, `platform_fee_vat`, `platform_fee_gross`, `total_payable_amount`)
- [ ] Confirm `ACCOUNT_DTAM` role re-purpose (slip review → remittance oversight)
- [ ] D5: the Stripe account's payout destination must be the confirmed corporate account before Wave 2 reaches any real environment (`PENDING_FINANCE_CONFIRMATION` today)
- [ ] Confirm the legal-entity Thai spelling for documents ("โซลูชั่น" per the directive vs "โซลูชัน" in the current seed/config — one of the two must become canonical before split-documents render it)
- [ ] Stripe account provisioning: live keys, webhook endpoint registration (`payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`), PromptPay capability enabled for the THB account, statement descriptor `PREDICTIVE AI - GACP` set at account level
- [ ] D2 becomes urgent under the zero-slip mandate: choose drain-then-purge (slip pipeline stays only until in-flight rows settle) vs migrate (convert open per-phase invoices into checkout orders)
