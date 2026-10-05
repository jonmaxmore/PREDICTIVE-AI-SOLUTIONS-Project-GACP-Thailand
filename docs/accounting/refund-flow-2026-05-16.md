> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# Refund Flow — Platform-side (Iter 23, 2026-05-16)

This document describes the end-to-end PLATFORM refund flow introduced in
Iter 23. It builds directly on the credit-note (ใบลดหนี้) machinery
delivered by batch B20-A and binds it to a new notification fanout layer.

State-fee (DTAM) refunds are explicitly out of scope — those flow through
the กรมบัญชีกลาง refund process operated by Treasury, **not** through this
service.

## Sequence

```
┌──────────────────────────────────────────────────────────────────────┐
│  Applicant cancels application (out-of-band UI action)               │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Finance staff calls:                                                │
│    POST /api/finance/refunds/:invoiceId/initiate                     │
│    body: { reason, reasonCode }                                       │
│    role: ACCOUNT_PLATFORM or ADMIN                                    │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  refund-service.initiateRefund()  —  ONE Prisma $transaction:        │
│                                                                       │
│    1.  creditNoteService.createCreditNote(...)  →  DRAFT             │
│    2.  creditNoteService.issueCreditNote(...)   →  ISSUED            │
│    3.  creditNoteService.postCreditNote(...)    →  POSTED            │
│         ▶ writes REVERSING JournalEntry:                              │
│               Dr Revenue — Platform Fee   <subtotal>                  │
│               Dr Output VAT 7%            <vat>                       │
│                 Cr Cash / Bank                  <total>               │
│    4.  Invoice.metadata.refund = {                                    │
│           status: 'INITIATED',                                        │
│           creditNoteId, creditNoteNumber,                             │
│           reason, reasonCode, amount,                                 │
│           initiatedAt, initiatedBy,                                   │
│           legalBasis: 'ม.86/10 + ม.86/4 ป.รัษฎากร'                    │
│        }                                                              │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │   (transaction commits)
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  notificationFanoutService.send({                                     │
│     userId, type: 'REFUND_INITIATED', payload, channels })            │
│     → IN_APP (notification-service row, bell icon)                    │
│     → EMAIL  (email-transport stub, logs only until SMTP wired)       │
│     → SMS    (sms-transport stub, logs only until ThaiBulkSMS wired)  │
│  Best-effort: failures here DO NOT roll back the accounting reversal. │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  OUT-OF-BAND: Finance staff makes the actual bank transfer to the     │
│  applicant's bank account, then reconciles the outflow against the    │
│  Cr Cash/Bank line posted in step 3 above (via the existing daily-    │
│  cash report + bank-reconciliation flow).                             │
│                                                                       │
│  This system records the ACCOUNTING REVERSAL only. The cash movement  │
│  is manual and lives in the bank statement → bank-reconciliation      │
│  reconciles it against the reversing entry.                           │
└──────────────────────────────────────────────────────────────────────┘
```

## Thai legal basis

| Citation | Topic |
|----------|-------|
| **ม.86/10 ป.รัษฎากร** | A VAT-registered seller that has issued a tax invoice and subsequently reduces the taxable amount MUST issue a **ใบลดหนี้** to the buyer in the same VAT period (ภ.พ.30 month) where the change occurs. The CN must reference the ORIGINAL tax-invoice number, state the reason, and show the reduced amount + VAT separately. |
| **ม.86/4 ป.รัษฎากร**  | Sequential numbering rules + 7-year retention apply to the CN. |
| **ม.86/9 ป.รัษฎากร**  | When a refund needs to be undone AFTER the CN has POSTED (terminal state), the platform must issue a **ใบเพิ่มหนี้** to reverse the reversal. POSTED journal entries are never edited — the accounting principle is *always-reverse-via-new-document*. The `cancelRefund` endpoint surfaces a `POSTED_CN_IRREVERSIBLE` error in this case so finance routes through the DN path. |
| **ม.87/3 ป.รัษฎากร**  | 7-year retention also covers the CN evidence row (already enforced by `Invoice.retainUntil` defaulting to `now() + 7 years`). |
| **TFRS for NPAEs ch.18** (รายได้) | Revenue is REDUCED at the period the CN is recognised; the original revenue entry stays immutable; a REVERSING entry posts in this period. |

## Bank transfer is MANUAL

The system **does not** initiate any bank transfer. The Cr Cash/Bank line
posted by the reversing journal entry represents the *expected* cash
outflow — finance staff must make the actual bank transfer through the
platform's banking partner and the daily bank-reconciliation flow matches
the bank statement debit against this reversing entry.

This separation is deliberate:

* Pushing automated transfers would require a bank API integration with
  signing credentials in the secret manager — a separate ops ticket.
* Manual transfer + reconciliation matches the existing PaymentSlip
  inbound flow (manual deposit + slip upload), so finance staff use the
  same daily routine in both directions.

## Refund states

| Status | Meaning |
|--------|---------|
| `NONE` | No refund record on the invoice (default). |
| `INITIATED` | CN posted; reversing JE on the books; bank transfer pending finance action. |
| `BANK_TRANSFER_PENDING` | Reserved for a future iteration that splits the manual bank step. |
| `COMPLETED` | Bank transfer has been recorded against the reversing entry. Cannot be cancelled — must be reversed via DN. |
| `CANCELLED` | Refund was rolled back before the CN was POSTED (or by ADMIN before bank transfer). |

## Notification fanout (Iter 23)

The new `notification-fanout-service` is the single dispatch point for
multi-channel notifications. Existing callers (payment-slip-service,
application-status-writer, application-review-revision-methods) keep
calling `notification-service.createNotification` for now — they are out
of Iter 23's file boundary and will be migrated in later iterations.

The fanout service:

* Reads the recipient User row (email + phone + opt-out prefs) once.
* Renders the template via the registry (Buddhist-Era dates for Thai).
* Dispatches IN_APP via `notification-service.createNotification`
  (preserves the bell-icon contract).
* Dispatches EMAIL via `services/notification/transports/email-transport.js`
  (stub — logs to Winston until SMTP creds land in the secret manager).
* Dispatches SMS via `services/notification/transports/sms-transport.js`
  (stub — logs to Winston until ThaiBulkSMS creds land).
* Dedupes by `sha256(userId|type|applicationId|invoiceId|certNumber|period)`
  within a 60-minute window (in-memory Map; promote to Redis when multi-
  instance dedupe is required).

### Templates added in Iter 23

| NotifyType | Channels | Notes |
|------------|----------|-------|
| `REFUND_INITIATED` | IN_APP + EMAIL + SMS | Cites ม.86/10 in the email body; SMS body ≤70 chars |
| `PAYMENT_SLIP_APPROVED` | IN_APP + EMAIL + SMS | Invoice + phase number |
| `PAYMENT_SLIP_REJECTED` | IN_APP + EMAIL + SMS | Reason text echoed back; SMS prompts re-upload |
| `CERTIFICATE_ISSUED` | IN_APP + EMAIL + SMS | Cert number + download URL |
| `REVISION_REQUESTED` | IN_APP + EMAIL + SMS | Extends the existing in-app template with email body + SMS |
| `AUDIT_SCHEDULED` | IN_APP + EMAIL + SMS | Buddhist-Era date + auditor name |

## Endpoints

```
POST  /api/finance/refunds/:invoiceId/initiate    ACCOUNT_PLATFORM + ADMIN
GET   /api/finance/refunds/:invoiceId/status      ACCOUNT_PLATFORM + ADMIN + AUDITOR
POST  /api/finance/refunds/:refundId/cancel       ADMIN only (separation of duties)
```

The `:refundId` on the cancel endpoint is the **invoice id** for Iter 23
(the refund block lives on `Invoice.metadata.refund`). When a future
iteration promotes refunds to their own row with a dedicated PK, the
route signature does not change — the parameter just resolves to the
new table's PK.

## Out of scope / deferred to future iterations

* **Real SMTP transport** — currently logs only via Winston in
  `email-transport.js _dispatch`. Provision EMAIL_SMTP_HOST / USER / PASS
  in the secret manager and swap the body of `_dispatch()` for a
  nodemailer/SES/SendGrid call. The `{ messageId, sent }` return shape
  is stable; callers don't change.
* **Real SMS transport** — currently logs only via Winston in
  `sms-transport.js _dispatch`. Provision THAIBULKSMS_API_KEY +
  THAIBULKSMS_API_SECRET in the secret manager and swap the body for a
  ThaiBulkSMS REST call (or Twilio).
* **Schema column promotion** — `refundStatus` lives on
  `Invoice.metadata.refund` (JSON) for Iter 23. A future migration can
  promote it to a typed column once the cardinality stabilises.
  Forward-compatible because Prisma Json values survive into typed
  columns.
* **Redis-backed dedupe** — current dedupe Map is per-process; promote
  to Redis (SET EX 3600 NX) when multi-instance dedupe becomes a
  requirement.
* **Wider fanout adoption** — existing notification call sites (payment-
  slip-service, application-status-writer, application-review-revision-
  methods) still use `notification-service.createNotification` directly.
  They are file-boundary out for Iter 23 and will adopt the fanout layer
  in a later iteration.
* **Partial refunds** — Iter 23 supports full-invoice refunds only
  (passes `subtotal` and `vat` directly from the Invoice). Partial
  refunds require accepting an explicit `{ subtotal, vat }` from the
  caller and additional cap validation — deferred to Iter 24+.
