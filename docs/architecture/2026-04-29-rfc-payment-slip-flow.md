> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# RFC: Manual Slip-Upload Payment Flow (Replaces Gateway Integration)

- **Date:** 2026-04-29
- **Status:** Proposed (awaiting decisions in §11 before Phase 1 implementation)
- **Author:** Project team
- **Supersedes:** The PromptPay/Ksher webhook architecture documented in v3.1.0 changelog and `services/payment-service*.js`
- **Implements business decision:** "เราจะไม่เชื่อมต่อ payment gateway. เกษตรกรโอนเงิน → แนบสลิป → ทีมบัญชีตรวจสอบ + อนุมัติ → ผ่าน"

---

## 1. Problem statement

The current payment subsystem assumes a payment gateway (mock PromptPay / Ksher) that auto-verifies via signed webhooks. The product owner has decided to **abandon gateway integration entirely** in favour of **off-platform bank transfer + manual slip upload + ACCOUNT-team review**. This is the right call for the GACP context because:

- Thai government / DTAM workflows already operate on bank-transfer + slip-confirmation patterns; this matches operational reality.
- It removes the need for KYC, merchant signup, gateway fees, webhook hardening, signature rotation, and DLQ handling.
- It keeps financial decisions inside the team that already owns the audit trail (the ACCOUNT role).
- It removes a class of fraud surface (forged webhooks) at the cost of adding a different one (forged slips) — but the forged-slip risk is bounded by human review and is the standard accepted risk in Thai e-commerce / government.

The existing codebase carries a substantial amount of gateway-shaped infrastructure that needs to come out, and a smaller amount of manual-review infrastructure (audit photo upload, receipt issuance) that we can reuse.

## 2. New flow (canonical)

### Phase 1 (document review fee, 5,535 THB)

```
[applicant] submits application
     ↓
state: SUBMITTED → PENDING_DOC_FEE
     ↓ Application phase1Status = PENDING
[applicant] sees:
     - bank account details (DTAM destination account)
     - exact amount to transfer (5,535 THB)
     - upload-slip form
     ↓
[applicant] transfers off-platform (bank app, ATM, counter, PromptPay)
     ↓
[applicant] uploads slip image + bank ref + transfer date + amount
     ↓ POST /api/payments/slip/upload
state: PENDING_DOC_FEE → PHASE_1_SLIP_UNDER_REVIEW
     ↓ PaymentSlip created (status = PENDING_REVIEW)
     ↓ notify ACCOUNT staff
[ACCOUNT staff] sees pending-slip-review queue
     ↓ opens slip detail
     ↓ verifies amount + date + bank ref against the bank statement / app
     ↓ decides:
   ┌────────── APPROVE ──────────┐    ┌─── REJECT (with reason) ───┐
   ↓                              ↓    ↓                            ↓
Invoice.status = "paid"           PaymentSlip.status = REJECTED
PaymentSlip.status = APPROVED     state: PHASE_1_SLIP_UNDER_REVIEW
state: PHASE_1_SLIP_UNDER_REVIEW          → PENDING_DOC_FEE
       → DOC_FEE_PAID             notify applicant (with reason)
auto-issue Receipt                applicant can re-upload
notify applicant (with receipt)
     ↓
state: DOC_FEE_PAID → ASSIGNED_FOR_REVIEW
```

### Phase 2 (audit fee, 27,675 THB)

Identical flow with `phase = PHASE_2` and the corresponding states:

```
DOC_APPROVED → PENDING_AUDIT_FEE
            → PHASE_2_SLIP_UNDER_REVIEW
            → AUDIT_FEE_PAID
            → AUDIT_CONFIRMED
```

### Re-upload after rejection

`PaymentSlip.status = SUPERSEDED` on the old slip; new `PaymentSlip` row created. The audit chain is preserved: every slip ever uploaded for an invoice remains queryable, but only the most recent one drives state.

## 3. State machine changes

### Two new canonical states

| New state | Meaning | Entry transition | Exit transitions |
|---|---|---|---|
| `PHASE_1_SLIP_UNDER_REVIEW` | Phase 1 slip uploaded, awaiting ACCOUNT review | from `PENDING_DOC_FEE` on slip upload | → `DOC_FEE_PAID` on approve, → `PENDING_DOC_FEE` on reject |
| `PHASE_2_SLIP_UNDER_REVIEW` | Phase 2 slip uploaded, awaiting ACCOUNT review | from `PENDING_AUDIT_FEE` on slip upload | → `AUDIT_FEE_PAID` on approve, → `PENDING_AUDIT_FEE` on reject |

### Updated transition matrix (relevant rows only)

```diff
 ALLOWED_TRANSITIONS = {
   ...
-  PENDING_DOC_FEE: new Set(['DOC_FEE_PAID']),
+  PENDING_DOC_FEE: new Set(['PHASE_1_SLIP_UNDER_REVIEW']),
+  PHASE_1_SLIP_UNDER_REVIEW: new Set(['DOC_FEE_PAID', 'PENDING_DOC_FEE']),
   DOC_FEE_PAID: new Set(['ASSIGNED_FOR_REVIEW']),
   ...
-  PENDING_AUDIT_FEE: new Set(['AUDIT_FEE_PAID']),
+  PENDING_AUDIT_FEE: new Set(['PHASE_2_SLIP_UNDER_REVIEW']),
+  PHASE_2_SLIP_UNDER_REVIEW: new Set(['AUDIT_FEE_PAID', 'PENDING_AUDIT_FEE']),
   AUDIT_FEE_PAID: new Set(['AUDIT_CONFIRMED']),
   ...
 }
```

### Role authorization on the new transitions

| Transition | Allowed actor role |
|---|---|
| `PENDING_DOC_FEE → PHASE_1_SLIP_UNDER_REVIEW` | HEALTH (the owning applicant only — checked via ownership middleware) |
| `PHASE_1_SLIP_UNDER_REVIEW → DOC_FEE_PAID` | ACCOUNT, ADMIN |
| `PHASE_1_SLIP_UNDER_REVIEW → PENDING_DOC_FEE` | ACCOUNT, ADMIN (the reject path) |
| `PENDING_AUDIT_FEE → PHASE_2_SLIP_UNDER_REVIEW` | HEALTH (owning applicant) |
| `PHASE_2_SLIP_UNDER_REVIEW → AUDIT_FEE_PAID` | ACCOUNT, ADMIN |
| `PHASE_2_SLIP_UNDER_REVIEW → PENDING_AUDIT_FEE` | ACCOUNT, ADMIN |

### Backward-compatibility aliases

The legacy aliases `PAYMENT_1_PENDING`, `PAYMENT_1_PAID`, `PAYMENT_2_PENDING`, `PAYMENT_2_COMPLETED` remain mapped to the canonical states they currently map to (`PENDING_DOC_FEE`, `DOC_FEE_PAID`, etc.). The new under-review states have **no** legacy alias — any pre-existing client that doesn't know about them treats them as opaque. This is intentional: there is no prior incarnation to alias.

## 4. Schema changes

### New model: `BankAccount`

The destination bank account where applicants transfer money is **a first-class entity owned by the ACCOUNT team**, not a key-value entry buried in `SystemConfig`. The reasoning:

1. **Operational risk surface.** A wrong account number on the applicant-facing screen means money lands in the wrong place. The ACCOUNT team needs to *see* what's currently active, *audit* who changed it, *roll forward* to a new account on a scheduled date, and *disable* old accounts without dropping references from historical invoices.
2. **Multi-account future.** DTAM may want to route Phase 1 fees to one account and Phase 2 fees to another, or run an A/B period during a bank switch. A list-of-accounts model handles both; a single key-value entry doesn't.
3. **PromptPay support without code changes.** Storing `promptpayId` next to the bank fields lets the applicant-facing screen render either a copy-paste account number or a PromptPay QR depending on what the ACCOUNT team configures.
4. **Audit chain.** Every change to "where the money goes" must be loggable to the existing audit chain (ADR-012). A relational row with `createdBy` / `updatedBy` is the right primitive; a JSON blob in SystemConfig is not.

```prisma
model BankAccount {
  id              String   @id @default(uuid()) @db.Uuid
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Bank fields (Thai)
  bankCode        String   // ISO-shaped Thai bank code: SCB, KBANK, BBL, KKP, KTB, BAY, GSB, etc.
  bankName        String   // human-readable, e.g. "ธนาคารกรุงเทพ"
  accountNumber   String   // formatted "xxx-x-xxxxx-x" or contiguous digits
  accountHolder   String   // legal name of the receiving entity
  branchName      String?

  // PromptPay (optional — applicant-facing screen renders the QR if this is set)
  promptpayId     String?  // 13-digit national ID or 10-digit phone

  // Lifecycle
  isActive        Boolean  @default(true)        // applicant-visible candidate
  isDefault       Boolean  @default(false)       // exactly-one-per-(org, phase) constraint enforced in service layer
  defaultForPhase PaymentPhase?                  // null = default for both phases; PHASE_1 / PHASE_2 = phase-scoped default
  effectiveFrom   DateTime @default(now())       // applicant sees this account starting...
  effectiveUntil  DateTime?                      // ...until (nullable = open-ended)

  // Operational
  notes           String?                        // ACCOUNT-team-only memo (not shown to applicants)

  // Audit
  createdBy       String   @db.Uuid
  updatedBy       String?  @db.Uuid
  organizationId  String   @db.Uuid

  // Back-link
  slipsApprovedAgainst PaymentSlip[]             // optional — set on each slip at approval time so we know which account it landed in

  @@index([organizationId, isActive, defaultForPhase, effectiveFrom, effectiveUntil])
}
```

**Active-account resolution rule** (encoded in the service layer, not the schema):

```
getActiveBankAccountForPhase(organizationId, phase, when = now()):
  candidates = BankAccount where
    organizationId = $org
    AND isActive = true
    AND effectiveFrom <= $when
    AND (effectiveUntil IS NULL OR effectiveUntil > $when)
    AND (defaultForPhase = $phase OR defaultForPhase IS NULL)

  ordered by:
    1. defaultForPhase = $phase (phase-specific wins over generic)
    2. isDefault = true
    3. effectiveFrom desc (most recently activated wins as tiebreak)

  return candidates[0]  // the applicant sees this one
```

This means: if ACCOUNT wants to switch banks on 2026-06-01, they create the new account today with `effectiveFrom = 2026-06-01` and set the old one's `effectiveUntil = 2026-06-01`. Applicants see the right one based on when they hit the payment screen, no manual flag-flip needed at midnight.

### New model: `PaymentSlip`

```prisma
model PaymentSlip {
  id              String   @id @default(uuid()) @db.Uuid
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Linkage
  applicationId   String   @db.Uuid
  application     Application @relation(fields: [applicationId], references: [id], onDelete: Restrict)
  invoiceId       String   @db.Uuid
  invoice         Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  phase           PaymentPhase  // PHASE_1 | PHASE_2 (existing enum)

  // Slip data (provided by applicant)
  fileUploadId    String   @db.Uuid                         // FK to existing FileUpload-like store
  bankRef         String                                    // bank transaction reference / รหัสอ้างอิงโอน
  transferredAt   DateTime                                  // applicant-claimed transfer time
  amountClaimed   Int                                       // satang (× 100) — what the applicant says they sent
  payerNote       String?                                   // optional applicant note

  // Review (filled by ACCOUNT team)
  status          PaymentSlipStatus @default(PENDING_REVIEW)
  reviewedBy      String?  @db.Uuid                          // ACCOUNT user id
  reviewedAt      DateTime?
  reviewNote      String?                                    // approve note OR reject reason
  amountVerified  Int?                                       // satang — optional, what the reviewer confirmed

  // Tenancy + audit
  uploadedBy      String   @db.Uuid                         // applicant user id
  uploadedByIp    String?
  organizationId  String   @db.Uuid

  @@index([applicationId, phase, status])
  @@index([status, createdAt])  // ACCOUNT pending-queue read path
  @@index([organizationId, status])
}

enum PaymentSlipStatus {
  PENDING_REVIEW   // freshly uploaded, ACCOUNT hasn't acted yet
  APPROVED         // accepted by ACCOUNT; invoice transitions to paid
  REJECTED         // rejected by ACCOUNT; applicant can re-upload
  SUPERSEDED       // a newer slip was uploaded for the same invoice; this one is read-only history
}
```

### `Application` model additions

```prisma
model Application {
  ...
  phase1SlipId    String?  @db.Uuid  // most-recent Phase 1 slip (history kept via PaymentSlip table)
  phase2SlipId    String?  @db.Uuid  // most-recent Phase 2 slip
  phase1Slip      PaymentSlip? @relation("Phase1Slip", fields: [phase1SlipId], references: [id])
  phase2Slip      PaymentSlip? @relation("Phase2Slip", fields: [phase2SlipId], references: [id])
}
```

### `Invoice` model adjustments

```prisma
model Invoice {
  ...
  // Restrict paymentMethod values — drop "QR_CASH" (gateway-implying)
  // Keep: BANK_TRANSFER, PROMPTPAY (still meaningful — the applicant CAN use PromptPay app to send)
  // Add: clarify that paymentMethod records HOW the applicant transferred, not the gateway used
  paymentMethod   String?  // BANK_TRANSFER | PROMPTPAY | OTHER

  // New back-link
  slips           PaymentSlip[]
}
```

### `PaymentTransaction` model — deprecate, do not drop

The `PaymentTransaction` table is **frozen for historical audit only**:

- No new rows are written by the new flow.
- Existing rows remain queryable (the legacy gateway/webhook fields stay in the schema).
- A migration adds `@deprecated` comments to the gateway-specific fields.
- A future ADR can drop the table when retention rules permit; this is **not** in scope here.

This satisfies the audit-trail requirement (we don't lose the history of any in-flight gateway-era payment).

### Migration plan

```
20260430xxxxxx_add_bank_account_and_payment_slip_tables/
  - CREATE TABLE BankAccount
  - CREATE TABLE PaymentSlip
  - CREATE TYPE PaymentSlipStatus
  - ADD COLUMN Application.phase1SlipId, Application.phase2SlipId (nullable)
  - ALTER Invoice.paymentMethod CHECK constraint adjusted
  - Old PaymentTransaction.gateway, gatewayRef, webhookReceivedAt, webhookData
    columns receive a comment: "DEPRECATED post-2026-04-29 slip-flow migration"

20260430yyyyyy_workflow_states_for_slip_review/
  - No DDL — pure code-side change in workflow-transition-service.js
  - Validate: no application is currently in a state that would be orphaned
    by the new transition matrix (run check-prisma-migration-consistency
    + a one-off seed assertion script in CI before merge)

20260430zzzzzz_seed_default_bank_account/
  - INSERT one initial BankAccount per organization, marked default for
    both phases (defaultForPhase = NULL, isDefault = true)
  - Sourced from a one-off CSV provided by the ACCOUNT team — NOT from
    the (currently empty) PAYMENT_GATEWAY env block
  - createdBy = a SYSTEM-MIGRATION user id reserved for seed operations
  - This migration is idempotent: re-running won't duplicate rows because
    of a unique index on (organizationId, accountNumber, bankCode)
```

## 5. API surface changes

### New endpoints — bank account management

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/payments/bank-accounts/active` | HEALTH (owning applicant), ACCOUNT, ADMIN | Returns the *single* bank account the applicant should transfer to **right now** for a given `?phase=PHASE_1\|PHASE_2`. Resolves via `getActiveBankAccountForPhase()`. Returns `{ bankCode, bankName, accountNumber, accountHolder, branchName, promptpayId? }`. PDPA-safe — no internal IDs or audit fields. |
| GET | `/api/payments/bank-accounts` | ACCOUNT, ADMIN | Full list (active + inactive + scheduled-future + past). Pagination + filter by `isActive`, `defaultForPhase`. Returns full record including `notes`, `createdBy`, etc. |
| GET | `/api/payments/bank-accounts/:id` | ACCOUNT, ADMIN | Single account with full audit metadata. |
| POST | `/api/payments/bank-accounts` | ACCOUNT, ADMIN | Create a new bank account. Body: full BankAccount fields. Validation: `accountNumber` matches Thai bank format per `bankCode`; `effectiveFrom <= effectiveUntil` if both set. Returns 201 with the new id. |
| PATCH | `/api/payments/bank-accounts/:id` | ACCOUNT, ADMIN | Partial update of any non-immutable field. `accountNumber`, `bankCode`, `accountHolder` are immutable post-create (use disable + create-new instead — preserves historical truth). |
| POST | `/api/payments/bank-accounts/:id/set-default` | ACCOUNT, ADMIN | Body: `{ defaultForPhase?: PHASE_1 \| PHASE_2 \| null }`. Atomically clears the prior default for the same scope and sets this one. Audit-logged. |
| POST | `/api/payments/bank-accounts/:id/disable` | ACCOUNT, ADMIN | Sets `isActive = false` and `effectiveUntil = now()`. Refuses if this is the only active default for an in-use phase (must promote a replacement first). |

### New endpoints — slip review

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/payments/slip/upload` | HEALTH (owning applicant) | Multipart upload: file + invoiceId + bankRef + transferredAt + amountClaimed. Creates `PaymentSlip` (status=PENDING_REVIEW), transitions Application state to PHASE_X_SLIP_UNDER_REVIEW, supersedes any prior slip on the same invoice. Returns slip id + status. |
| GET | `/api/payments/slip/pending` | ACCOUNT, ADMIN | Pagination of slips with status=PENDING_REVIEW. Includes applicant name (masked per PDPA), invoice number, amount, phase, uploaded-at. Sorted by `createdAt asc` (FIFO). |
| GET | `/api/payments/slip/:id` | ACCOUNT, ADMIN, or owning HEALTH user | Slip detail: metadata + signed file URL (60-min TTL). |
| GET | `/api/payments/slip/:id/file` | ACCOUNT, ADMIN, or owning HEALTH user | Returns the slip image bytes (or 302 to signed URL). Audit-logged. |
| POST | `/api/payments/slip/:id/approve` | ACCOUNT, ADMIN | Body: `{ amountVerified?: int, note?: string }`. Idempotent if already APPROVED. Transitions slip → APPROVED, invoice → paid, application → DOC_FEE_PAID/AUDIT_FEE_PAID, auto-issues receipt, notifies applicant. |
| POST | `/api/payments/slip/:id/reject` | ACCOUNT, ADMIN | Body: `{ reason: string (required, ≥10 chars) }`. Transitions slip → REJECTED, application → back to PENDING_DOC_FEE/PENDING_AUDIT_FEE, notifies applicant. |
| GET | `/api/payments/slip/by-application/:applicationId` | HEALTH (owner), ACCOUNT, ADMIN | All slips for an application across phases (status history). Supports the "what happened to my upload" applicant view. |

### Endpoints to remove

| Method | Path | Reason |
|---|---|---|
| POST | `/api/webhooks/payment` | No more gateway → no more webhook |
| POST | `/api/webhooks/payment/:provider` | Same |
| POST | `/api/payments/create` | Already deprecated; routes to phase1/phase2 (which keep their invoice-creation responsibility) |
| GET | `/api/payments/url/:applicationId` | No payment URL when there's no gateway |
| POST | `/api/invoices/:invoiceId/pay/promptpay` | Replaced by slip upload |
| POST | `/api/invoices/:invoiceId/pay/mock-confirm` | Mock gateway — gone |

### Endpoints kept (modified internals only)

| Method | Path | What changes |
|---|---|---|
| POST | `/api/payments/phase1/:applicationId` | Still creates Phase 1 invoice; no longer returns `paymentUrl` (returns `bankAccount` info instead). |
| POST | `/api/payments/phase2/:applicationId` | Same for Phase 2. |
| GET | `/api/payments/status/:applicationId` | Same, but now reflects slip-review states. |
| GET | `/api/payments` | Same listing; new optional filter `slipStatus=PENDING_REVIEW`. |
| POST | `/api/invoices/:invoiceId/receipt` | Kept — but auto-invoked at slip approval time (manual call still allowed for re-issuing). |
| GET | `/api/invoices/receipts/{pending,issued,exceptions}` | Kept; "exceptions" tab semantics shift from "webhook discrepancy" to "slip rejected ≥ 7 days ago without re-upload". |

## 6. Frontend changes

### Health portal — payment screen (`apps/web-app/src/app/health/applications/.../payment-section.tsx`)

Replace the entire PromptPay-QR + "ยืนยันการชำระเงิน" mock with:

```
┌─────────────────────────────────────────────────────────────┐
│ ขั้นตอนที่ 5 — ชำระค่าธรรมเนียม (Phase 1)                      │
├─────────────────────────────────────────────────────────────┤
│ ยอดที่ต้องชำระ        5,535 บาท                                │
│  ├ ค่าธรรมเนียมรัฐ      5,000 บาท                              │
│  ├ ค่าบริการแพลตฟอร์ม    500 บาท                              │
│  └ VAT 7%               35 บาท                              │
├─────────────────────────────────────────────────────────────┤
│ บัญชีปลายทาง                                                  │
│  ธนาคาร: <BANK_NAME>                                        │
│  เลขที่บัญชี: <ACCOUNT_NUMBER>                                │
│  ชื่อบัญชี: <ACCOUNT_HOLDER_NAME>                             │
│  [คัดลอกเลขบัญชี]  [PromptPay QR]                              │
├─────────────────────────────────────────────────────────────┤
│ อัปโหลดสลิปการโอนเงิน                                          │
│  [ ลากไฟล์มาวางที่นี่ หรือคลิกเลือก ]                            │
│   (รองรับ JPG, PNG, PDF — ไม่เกิน 5 MB)                        │
│                                                              │
│  รหัสอ้างอิงการโอน *  [_______________________]              │
│  วันเวลาที่โอน *      [📅 _________] [🕐 _____]               │
│  ยอดที่โอน (บาท) *    [_________]                            │
│  หมายเหตุ            [_______________________]              │
│                                                              │
│                            [ยกเลิก]  [ส่งสลิปให้ตรวจสอบ]      │
└─────────────────────────────────────────────────────────────┘
```

After upload, the page transitions to a status view:

```
┌─────────────────────────────────────────────────────────────┐
│ ⏳ รอเจ้าหน้าที่ตรวจสอบ                                          │
├─────────────────────────────────────────────────────────────┤
│ คุณส่งสลิปแล้วเมื่อ <timestamp>                                │
│ ทีมงานบัญชีจะตรวจสอบภายใน 1–3 วันทำการ                          │
│ คุณจะได้รับอีเมล + แจ้งเตือนในระบบเมื่อมีการอนุมัติ                │
│                                                              │
│ [ดูสลิปที่ส่ง]    [ส่งสลิปใหม่ (กรณีต้องการเปลี่ยน)]            │
└─────────────────────────────────────────────────────────────┘
```

If rejected:

```
┌─────────────────────────────────────────────────────────────┐
│ ❌ สลิปถูกปฏิเสธ                                                │
├─────────────────────────────────────────────────────────────┤
│ เหตุผล: <reviewNote from ACCOUNT>                            │
│                                                              │
│ กรุณาตรวจสอบและส่งสลิปใหม่อีกครั้ง                              │
│                                                              │
│              [ส่งสลิปใหม่]                                     │
└─────────────────────────────────────────────────────────────┘
```

If approved:

```
┌─────────────────────────────────────────────────────────────┐
│ ✅ ชำระเงินสำเร็จ                                                │
├─────────────────────────────────────────────────────────────┤
│ ขอบคุณที่ชำระค่าธรรมเนียม Phase 1 (5,535 บาท)                   │
│ คำขอของคุณกำลังเข้าสู่ขั้นตอนการตรวจเอกสาร                      │
│                                                              │
│ [ดาวน์โหลดใบเสร็จ]      [ไปยัง Dashboard]                    │
└─────────────────────────────────────────────────────────────┘
```

The same component handles Phase 2 with different copy and amount.

### Provider/ACCOUNT portal — bank account management (`apps/web-app/src/app/provider/accounting/bank-accounts/`)

A new page that the ACCOUNT team owns end-to-end. Lives under the accounting nav as a sub-tab:

```
แดชบอร์ดบัญชี | สลิปรอตรวจ (12) | บัญชีรับเงิน | รอออกใบเสร็จ | ใบเสร็จที่ออกแล้ว | รายงาน
```

Page layout — list view:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ บัญชีรับเงิน                                              [+ เพิ่มบัญชีใหม่] │
├────────────────────────────────────────────────────────────────────────────┤
│ ตัวกรอง: [▼ สถานะ: ใช้งานอยู่]  [▼ ใช้สำหรับ: ทุก Phase]                    │
├────────────────────────────────────────────────────────────────────────────┤
│ ⭐ default • ใช้งาน                                                          │
│ ────────────────────────────                                                │
│ ธ.กรุงเทพ                              123-4-56789-0                       │
│ บัญชี: กรมพัฒนาการแพทย์แผนไทยฯ                                              │
│ สาขา: กระทรวงสาธารณสุข                                                       │
│ PromptPay: 0-1234-56789-01-2  [QR ✓]                                       │
│ ใช้สำหรับ: ทุก Phase    เริ่มใช้: 2026-01-01     ถึง: ไม่กำหนด                │
│                                                                              │
│ บันทึกภายใน: หลัก (active เริ่มต้น)                                          │
│ แก้ไขล่าสุดโดย น.ส. ก. บัญชี — 2026-03-15  [ ดูประวัติ ▷]                    │
│                                                              [แก้ไข]  [ปิด] │
├────────────────────────────────────────────────────────────────────────────┤
│   ใช้งาน                                                                     │
│ ────────                                                                    │
│ ธ.ไทยพาณิชย์                            456-7-89012-3                       │
│ บัญชี: กรมพัฒนาการแพทย์แผนไทยฯ                                              │
│ ใช้สำหรับ: เฉพาะ Phase 2  เริ่มใช้: 2026-05-01    ถึง: ไม่กำหนด               │
│                                                              [ตั้งเป็นค่าเริ่มต้น] [แก้ไข]  [ปิด] │
├────────────────────────────────────────────────────────────────────────────┤
│   ปิดใช้งาน (ดูเป็นประวัติ)                                                  │
│ ────────────────────────                                                    │
│ ธ.กรุงไทย                                987-6-54321-0                      │
│ ปิดใช้งานเมื่อ: 2026-03-31     เหตุผล: เปลี่ยนบัญชีใหม่ — ปิดแล้ว              │
└────────────────────────────────────────────────────────────────────────────┘
```

**Create / edit modal** (same component, fields locked on edit if immutable per §5):

```
┌─────────────────────────────────────────────────────────────────┐
│ เพิ่มบัญชีรับเงิน                                                   │
├─────────────────────────────────────────────────────────────────┤
│ ธนาคาร *           [▼ เลือก]                                     │
│ เลขที่บัญชี *       [_____________________]                       │
│ ชื่อบัญชี *         [_____________________]                       │
│ สาขา               [_____________________]                       │
│ PromptPay ID       [_____________________]                       │
│   (เบอร์โทร 10 หลัก หรือเลขบัตร 13 หลัก)                            │
│                                                                  │
│ ใช้สำหรับ          [▼ ทุก Phase ▼ เฉพาะ Phase 1 ▼ เฉพาะ Phase 2]│
│ เริ่มใช้           [📅 _________]                                 │
│ ถึง                [📅 _________]   □ ไม่กำหนด                    │
│                                                                  │
│ ☑ ตั้งเป็นบัญชีหลักสำหรับขอบเขตที่เลือก                             │
│                                                                  │
│ บันทึกภายใน  [_______________________________________________]  │
│              [_______________________________________________]  │
│              (ผู้สมัครจะไม่เห็น — ใช้สำหรับทีมบัญชีเท่านั้น)          │
├─────────────────────────────────────────────────────────────────┤
│                                       [ยกเลิก]   [บันทึก]         │
└─────────────────────────────────────────────────────────────────┘
```

**Pre-action validation surfaces inline** so the ACCOUNT team can't accidentally:
- Disable the only active default for a phase that has open invoices.
- Create overlapping defaults for the same phase + same time window.
- Set `effectiveFrom > effectiveUntil`.
- Use a clearly-malformed Thai bank account number.

**History view** (modal, click "ดูประวัติ" on any row): shows ordered audit-log of every change ever made to that BankAccount row — who, when, what fields changed, before/after values. Sourced from the existing `auditLogger` infrastructure.

### Provider/ACCOUNT portal — slip review (`apps/web-app/src/app/provider/accounting/`)

Add a new top-level tab to the existing accounting page:

```
แดชบอร์ดบัญชี | สลิปรอตรวจ (12) | บัญชีรับเงิน | รอออกใบเสร็จ | ใบเสร็จที่ออกแล้ว | รายงาน
```

The "สลิปรอตรวจ" tab renders a queue:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ # │ ส่งเมื่อ           │ ผู้ขอ           │ คำขอ #       │ ระยะ  │ ยอดอ้าง │ ดู  │
├───┼───────────────────┼────────────────┼─────────────┼──────┼────────┼──────┤
│ 1 │ 2026-04-29 10:42  │ น.ส. สม*** ***  │ GACP-2026-….│ 1    │ 5,535  │ ▷    │
│ 2 │ 2026-04-29 09:15  │ นาย สมช***      │ GACP-2026-….│ 2    │ 27,675 │ ▷    │
│...│                   │                │             │      │        │      │
└─────────────────────────────────────────────────────────────────────────────┘
   หน้า 1 / 3   [ก่อนหน้า] [ถัดไป]   เรียงตาม: เก่าสุดก่อน (FIFO)
```

Click row → modal:

```
┌────────────────────────────────────────────────────────────────────┐
│  สลิปการโอนเงิน — Phase 1 — GACP-2026-0123                          │
├────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────┐    │  ผู้ขอ:          นาย สมชาย ใจดี      │
│  │                        │    │  เลขประจำตัว:    1-2345-***-12-3  │
│  │   [Slip image preview] │    │  ใบแจ้งหนี้ #:  INV-202604-0123    │
│  │   400 × 600            │    │  ยอดเรียกเก็บ:   5,535.00 บาท      │
│  │                        │    │                                    │
│  └────────────────────────┘    │  รหัสอ้างอิงโอน: 1234567890123     │
│  [ขยายเต็มจอ] [ดาวน์โหลด]     │  วันเวลาโอน:   2026-04-29 10:30   │
│                                │  ยอดที่ผู้ขอแจ้ง: 5,535.00 บาท     │
│                                │  หมายเหตุผู้ขอ: -                  │
├────────────────────────────────────────────────────────────────────┤
│  สิ่งที่ต้องตรวจสอบก่อนอนุมัติ:                                        │
│  □ ยอดในสลิปตรงกับใบแจ้งหนี้                                          │
│  □ บัญชีปลายทางตรงกับบัญชีของ DTAM                                    │
│  □ วันเวลาโอนอยู่ในช่วงที่สมเหตุสมผล                                    │
│  □ รหัสอ้างอิงตรงกับ statement ของธนาคาร                              │
├────────────────────────────────────────────────────────────────────┤
│  ยอดที่ตรวจสอบจากธนาคาร (ถ้าต่างจากที่ผู้ขอแจ้ง)                       │
│  [_____________________] บาท                                       │
│                                                                    │
│  หมายเหตุ                                                            │
│  [_______________________________________________________]          │
│  [_______________________________________________________]          │
├────────────────────────────────────────────────────────────────────┤
│            [ปฏิเสธ + ระบุเหตุผล]              [อนุมัติการชำระ]         │
└────────────────────────────────────────────────────────────────────┘
```

**Reject** opens a sub-dialog asking for `reason` (required, ≥10 chars). Submit calls `POST /api/payments/slip/:id/reject`.

**Approve** confirms once and calls `POST /api/payments/slip/:id/approve`. The receipt is auto-issued and the modal closes; the queue refreshes.

### Admin portal — pending count widget

The admin dashboard gains a small widget showing **N สลิปรอตรวจ** with a deep link to `/provider/accounting?tab=slip-review`, so admins can spot reviewer-queue backlog at a glance.

## 7. Notifications

### New notification event types

| Event | Recipient | Channel | Title (TH) |
|---|---|---|---|
| `PAYMENT_SLIP_UPLOADED` | All ACCOUNT users in the org | In-app + email | "📥 มีสลิปรอตรวจสอบ — GACP-XXXX-XXXX" |
| `PAYMENT_SLIP_APPROVED` | Owning applicant | In-app + email | "✅ ชำระเงิน Phase X สำเร็จ — ใบรับรองดำเนินการต่อ" |
| `PAYMENT_SLIP_REJECTED` | Owning applicant | In-app + email | "❌ สลิปไม่ผ่านการตรวจสอบ — กรุณาส่งสลิปใหม่" |
| `PAYMENT_SLIP_QUEUE_OVERDUE` | ACCOUNT lead + ADMIN | In-app + email | "⚠️ สลิป N รายการรอตรวจเกิน 3 วันทำการ" |

### Existing notifications removed

- `PAYMENT_PHASE1_SUCCESS` / `PAYMENT_PHASE2_SUCCESS` (webhook-triggered) — replaced by `PAYMENT_SLIP_APPROVED`
- `PAYMENT_FAILED` — replaced by `PAYMENT_SLIP_REJECTED`

## 8. SLA + observability

### Recommended SLAs

- **Slip-review queue depth alert:** if `slipCountWithStatus(PENDING_REVIEW)` > 20 in any organization, page the ACCOUNT lead. Implementation: extend the existing `jobs/sla-monitor.js` hourly cron with a new check.
- **Per-slip review SLA:** target 1 working day, soft warning at 3 working days. Surface as a column in the queue ("รอ N วัน") and in the admin widget.
- **Approve→deposit reconciliation:** out of scope for this RFC — the bank-statement reconciliation is a manual operational concern that the ACCOUNT team performs outside the platform.

### New audit log events

Reuse the existing `auditLogger.log()` infrastructure with `AuditCategory.PAYMENT`:

- `PAYMENT_SLIP_UPLOADED` (actor = applicant)
- `PAYMENT_SLIP_APPROVED` (actor = ACCOUNT staff)
- `PAYMENT_SLIP_REJECTED` (actor = ACCOUNT staff, includes reason)

These events feed into the existing audit-chain hash verification (ADR-012).

## 9. What gets removed

### Backend (completely)

- `apps/backend/services/payment-service-webhook-flow.js` (entire file)
- `apps/backend/services/payment-webhook-service.js` (entire file)
- `apps/backend/services/payment/ksher-service.js` (entire file)
- `apps/backend/services/payment/payment-gateway-resolver.js` (entire file)
- `apps/backend/routes/api/system/webhooks.js` (entire file — only consumer was payment)
- `apps/backend/routes/mock-payment.js` (entire file)
- The webhook portion of `apps/backend/services/payment-service.js` (verifyWebhookSignature, handleWebhook)
- The `pay/promptpay` and `pay/mock-confirm` routes in `routes/api/finance/invoice-payment-handlers.js`

### Backend (modified, kept)

- `payment-service.js` keeps Phase 1/2 invoice creation, status check, but loses gateway URL generation + webhook logic.
- `payment-constants.js` / `modules/billing/internal/payment-constants.js` keeps `PAYMENT_STATUS`, `PAYMENT_METHODS` (with `QR_CASH` dropped); drops `CONFIG.gateway` block.

### Frontend

- The PromptPay QR mockup + "ยืนยันการชำระเงิน" button in `payment-section.tsx`.
- Any `getPaymentUrl()` / "redirect to gateway" code paths in `lib/services/payment-service.ts`.

### Env vars + compose

- `PAYMENT_GATEWAY`, `PAYMENT_PUBLIC_KEY`, `PAYMENT_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET` removed from:
  - `.env.local.example`
  - `.env.production.example`
  - `docker-compose.production.yml`, `.staging.yml`, `.bluegreen.yml`, `.local-prod.yml`
- The `gateway:` block in `payment-constants.js` becomes obsolete and is dropped.

### Documentation

- The "Payment / Webhook / Async Reliability" EPIC-06 (T-017, T-018) in `docs/audit/audit-reports/master-audit-implementation-action-plan.md` becomes substantially smaller — webhook hardening tasks no longer apply. Update that plan in the same PR that lands the code change.
- `docs/architecture/2026-04-28-billing-flow-review.md` gets a follow-up entry pointing at this RFC.

## 10. Phased implementation plan

Each phase = one PR. Each PR self-contained, revertable.

### Phase 0 — RFC (this document)
- Lands in `docs/architecture/`
- Opens decisions in §11 for the user
- **No code changes**

### Phase 1 — Schema + state machine + RBAC
- Add `BankAccount` model
- Add `PaymentSlip` model + `PaymentSlipStatus` enum
- Add `phase1SlipId`, `phase2SlipId` to `Application`
- Migrations: `..._add_bank_account_and_payment_slip_tables`, `..._workflow_states_for_slip_review`, `..._seed_default_bank_account`
- Update `workflow-transition-service.js` with the two new states + transitions + role authorization
- Add 5 new permissions + role bindings to `apps/backend/shared/canonical-rbac.js`
- Update `check-prisma-migration-consistency` CI baseline if needed
- **Risk:** Medium — schema migration touches production DB. Run on shadow DB + restored backup first.
- **Estimated size:** ~350 LOC + 3 migrations

### Phase 2 — Backend services + routes
- New `services/bank-account-service.js` (or `modules/billing/internal/bank-account-service.js` per Phase A6 layout) with `getActiveBankAccountForPhase()` resolution rule
- New `services/payment-slip-service.js` (same layout)
- New routes under `/api/payments/bank-accounts/*` (7 endpoints)
- New routes under `/api/payments/slip/*` (7 endpoints)
- Modify existing `payments.js` to drop gateway URL + return active bank account in `phase{1,2}` create responses
- Add new audit-log event types for both bank-account and slip lifecycle
- Unit tests for: bank account active-resolution, default-promotion atomicity, slip upload, supersede, approve, reject, ownership, role enforcement
- Integration test: full happy path (upload → approve → state advance) + reject path + supersede path + bank-account scheduled rollover
- **Risk:** Medium — touches state machine but doesn't yet remove gateway code (gateway code still co-exists, just unused).
- **Estimated size:** ~900 LOC + tests

### Phase 3 — Frontend health portal
- Replace `payment-section.tsx` PromptPay block with bank-account display + slip-upload form
- Add slip-status views (pending review, approved, rejected, re-upload)
- Update `lib/services/payment-service.ts` types
- Reuse the existing file-upload component pattern from `components/document/`
- **Risk:** Low — UI work, isolated.
- **Estimated size:** ~400 LOC

### Phase 4 — Frontend ACCOUNT UIs
- Add "บัญชีรับเงิน" tab + page (`app/provider/accounting/bank-accounts/`) — list, create/edit modal, set-default action, disable, history view
- Add "สลิปรอตรวจ" tab to `app/provider/accounting/page.tsx`
- New review modal component (slip detail + approve/reject actions)
- Pending-count widget for admin dashboard
- **Risk:** Low — UI work, isolated.
- **Estimated size:** ~800 LOC

### Phase 5 — Notifications + receipt auto-issue + SLA
- Add new notification templates (TH + EN) in `services/notification/templates/`
- Wire `notifyPaymentSlipUploaded`, `*Approved`, `*Rejected`
- Auto-issue receipt at slip-approval time
- Extend `jobs/sla-monitor.js` with queue-depth + per-slip-age checks
- **Risk:** Low.
- **Estimated size:** ~300 LOC

### Phase 6 — Removal of gateway code (sunset)
- Delete the files listed in §9 "Backend (completely)"
- Drop env vars from compose + .env.examples
- Drop the `gateway` block from `payment-constants.js`
- Mark `PaymentTransaction` table fields as `@deprecated` (data retention only)
- **Risk:** Low — by this point the new flow has been live for 1–2 weeks and the gateway code is unreachable.
- **Estimated size:** ~−1,500 LOC (net deletion)

### Phase 7 (optional, later) — Drop `PaymentTransaction`
- After 18 months retention has passed (the audit retention rule), a follow-up ADR can drop the table.
- Not in scope here.

### Permissions matrix (canonical)

This RFC adds five new permissions to the canonical RBAC table in `apps/backend/shared/canonical-rbac.js`:

| Permission | Action |
|---|---|
| `BANK_ACCOUNT_READ_ALL` | List all bank accounts (incl. disabled + scheduled) |
| `BANK_ACCOUNT_MANAGE` | Create / update / disable / set-default bank accounts |
| `PAYMENT_SLIP_READ_ALL` | See pending slip queue + every slip across the org |
| `PAYMENT_SLIP_REVIEW` | Approve or reject pending slips |
| `PAYMENT_SLIP_READ_OWN` | (HEALTH) See only the slips attached to one's own applications |

Role binding:

| Role | Permissions added |
|---|---|
| `ACCOUNT` | `BANK_ACCOUNT_READ_ALL`, `BANK_ACCOUNT_MANAGE`, `PAYMENT_SLIP_READ_ALL`, `PAYMENT_SLIP_REVIEW` |
| `ADMIN` | (already has all permissions; no change needed) |
| `HEALTH` | `PAYMENT_SLIP_READ_OWN` |
| `DOCUMENT_REVIEWER`, `AUDITOR`, `SCHEDULER` | (no payment permissions — they don't touch slips or bank info) |

This means the entire ACCOUNT-team UI (bank account management + slip review queue + approve / reject) is gated by canonical permissions, not by any ad-hoc role-string check. A future ADR-014 multi-tenancy refinement that further restricts cross-org access happens transparently because both `BankAccount` and `PaymentSlip` carry `organizationId`.

## 11. Decisions needed before Phase 1

These are choices where I have a **proposed default** but the answer affects code I'd write — please confirm or redirect.

| # | Decision | Proposed default | Why this default |
|---|---|---|---|
| 1 | **Bank account model** — key-value entry in `SystemConfig` or a first-class `BankAccount` table with full ACCOUNT-team management UI? | **First-class `BankAccount` table** (see §4 + §6) — supports multiple accounts, scheduled effective dates, audit trail, PromptPay, phase-scoped routing | The applicant-facing screen displays the wrong number = money in the wrong place. ACCOUNT team needs a real management surface, not a config blob |
| 2 | **Slip file formats accepted** | JPG, PNG, PDF; ≤ 5 MB | Standard bank-statement export formats; covers screenshot use case |
| 3 | **Bank ref required at upload time?** | Yes, non-empty string, ≥ 5 chars | Prevents low-effort uploads that ACCOUNT will need to chase |
| 4 | **Slip amount validation** | Soft check: warn if `amountClaimed` differs from `invoice.totalAmount` by > 5 baht; do not block submission | Rounding tolerance; ACCOUNT still validates manually |
| 5 | **Re-upload after rejection** | Allowed; previous slip becomes `SUPERSEDED`; full history preserved | Matches the audit-trail philosophy elsewhere |
| 6 | **Approval workflow** | Single ACCOUNT approver; ADMIN can override via the same approve route | Avoids two-step bottleneck; review is already manual |
| 7 | **SLA for review** | Soft target 1 working day, alert at 3 working days, no auto-action | Surfaces backlog without making the queue self-destruct |
| 8 | **Auto-issue receipt at approval** | Yes — bypass the existing manual "issue receipt" step for slip-approved invoices | The manual review IS the verification; a separate "issue receipt" click is redundant |
| 9 | **Phase 2 flow** | Identical to Phase 1, just with `phase=PHASE_2` and the matching state names | No reason to diverge |
| 10 | **Existing in-flight gateway payments** | Out of scope; production currently has no real gateway payments (mock mode only). Any application currently in `PENDING_DOC_FEE` simply switches to the slip flow on next applicant action. Existing `DOC_FEE_PAID` records stay paid. | If real gateway data existed, this would need a backfill pass — but none does (verified via mock-mode confirmation in `payment-constants.js`) |
| 11 | **Slip file storage** | Reuse the existing document-upload path (`apps/backend/uploads/...`) with a new subdir `slips/`. No MinIO migration in this RFC. | Minimum-blast-radius; the existing storage already powers other uploads |
| 12 | **PDPA / data-retention for slips** | Same retention rules as Invoice (7 years per `Invoice.retainUntil` field). Apply to PaymentSlip too. | One rule for the whole financial trail |
| 13 | **Reviewer comments visibility** | `reviewNote` shown to applicant on reject; **not shown** on approve (applicants don't need internal accountant notes when approved) | Privacy + simplicity |

## 12. Out of scope (intentionally)

- **Bank reconciliation tooling.** Cross-checking deposits against approved slips is a manual ACCOUNT-team task on the bank's website / portal. We don't build a reconciliation UI in this RFC.
- **OCR on slip images.** No automatic amount-extraction from the slip. Reviewer reads it.
- **Refunds.** Out-of-platform process. The platform records `REJECTED` slips and the applicant follows up via DTAM operational channels.
- **Multi-currency.** THB only; same as today.
- **Subscription billing flow** (BILLING_FREE_TIER_FOR_ALL sunset). The subscription path is separate from the application-fee path. The flag and the missing `client-view.tsx:113` checkout TODO remain a separate decision.
- **Mobile app.** Per ADR-015, the mobile app is shelved; this RFC does not consider mobile slip upload.

## 13. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Schema migration applied to production breaks existing payment records | Low | High | Test on restored backup; confirm no Application has `phase1Status` in a state the new transition matrix can't represent; the new states only appear on application records that go through the new flow |
| ACCOUNT team backlog grows unbounded after launch | Medium | Medium | SLA monitor + queue widget; document capacity planning |
| Forged slip approved | Low | Medium | Manual review IS the control; reviewer checklist in the modal; audit log captures reviewer; per-org organizationId scoping prevents cross-tenant approvals |
| Re-upload abuse (applicant uploads dozens of slips) | Low | Low | Rate-limit `/api/payments/slip/upload` per user (10/hour) |
| Slip image leaks via insecure URL | Low | High | Signed URLs with 60-min TTL; no direct filesystem path exposed; Audit-log file-fetch events |
| Reviewer accidentally approves wrong slip | Low | High | Confirm-once dialog; idempotent route accepts double-click; full audit trail enables forensic review |
| Existing `PaymentTransaction` rows confuse new code | Low | Low | New code never reads the deprecated columns; tests pin the contract |

## 14. Test plan

### Phase 1 (schema + state machine)
- Migration applies cleanly on a restored production backup (shadow DB)
- `npm run check:prisma-migration-consistency` passes
- New transitions allowed; old transitions denied
- Backward-compat aliases still resolve

### Phase 2 (service + routes)
- Happy path: upload → ACCOUNT approves → state advances → receipt issued → applicant notified
- Reject path: upload → ACCOUNT rejects → state reverts → applicant notified → re-upload works
- Supersede: re-upload before review → old slip marked SUPERSEDED, only newest enters review queue
- Ownership: HEALTH user can't approve their own slip; HEALTH user can't see another applicant's slips
- Idempotency: double-approve returns 200 with no double-state-change; double-reject returns 200 with no second notification

### Phase 3 (health UI)
- Wizard step 5 shows bank info + upload form on first visit
- After upload, status view rendering is correct in all three states (pending, approved, rejected)
- File picker enforces 5 MB and allowed mime types client-side
- Re-upload UI works after rejection

### Phase 4 (ACCOUNT UI)
- Pending queue lists slips in FIFO order
- Modal opens, image preview displays, action buttons enabled only with required inputs
- Approve closes modal + refreshes queue + decrements counter widget
- Reject without reason is blocked
- Role gate: HEALTH user lands on this page → 403

### Phase 5 (notifications + SLA)
- New notification types deliver in TH + EN
- Receipt auto-issued at approval; receipt PDF downloadable from applicant detail
- SLA monitor cron flags overdue items in test fixture

### Phase 6 (removal)
- Deleted endpoints return 404 (not 500); CI lint passes
- No stale env-var references in compose / docs

## 15. Open questions for follow-up RFCs

- **Cross-org accounting.** A larger DTAM operations role might need to see slip queues across organizations. Out of scope here; would be ADR-014 Phase 4 territory.
- **Bulk operations.** "Approve all from same payer" — if backlog grows, ACCOUNT might want this. Defer until backlog actually appears.
- **Slip OCR-assist.** Could pre-fill `bankRef` and `amountClaimed` from the image. Defer until reviewer demand is real.
- **Webhook for partner DTAM systems.** If DTAM operations want to integrate the slip-approval event into a partner system later, an outbound webhook is a small additional surface. Out of scope here.

---

**Awaiting decisions on §11 to start Phase 1.** The default answers are sensible enough that, if the user replies with "go with all defaults", Phase 1 can begin immediately.
