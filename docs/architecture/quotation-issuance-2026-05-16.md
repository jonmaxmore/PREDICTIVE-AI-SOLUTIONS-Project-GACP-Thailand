> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# Quotation Issuance — Tier 18 / B18-A

**Date:** 2026-05-16
**Owner:** Backend engineer (B18-A handoff)
**Companions:** B16-A (Quotation schema), B17 (issuer-aware template), B16-D (receipt numbering)

## TL;DR

On application SUBMITTED, the platform now auto-issues **two quotations
per application** — one DTAM (state fee, VAT-exempt), one PLATFORM
(platform fee + 7% VAT). Each carries its own running number stream
and renders to a single-issuer PDF.

## Flow diagram

```
applicant submits wizard
        │
        ▼
POST /api/applications/submit
        │
        ├─ writeApplicationStatus(DRAFT → SUBMITTED → PENDING_DOC_FEE)
        │
        └─ quotationService.issueQuotationsForApplication(...) [fire-and-forget]
                │
                ├─ calculateApplicationFees(formData, { scopeCount: totalAreaTypes })
                │       └─ { phase1, phase2, stateTotal, platformTotal, vatTotal }
                │
                ├─ allocateQuotationNumber('DTAM') → QT-DTAM-๒๕๖๙-๐๐๐๐๐๑
                ├─ allocateQuotationNumber('PLATFORM') → QT-PRD-2026-000001
                │
                ├─ INSERT Quotation { issuerType: DTAM,
                │                     subtotal: stateTotal,
                │                     vat: 0,
                │                     totalAmount: stateTotal,
                │                     installments: [phase1.state, phase2.state] }
                │
                └─ INSERT Quotation { issuerType: PLATFORM,
                                      subtotal: platformTotal,
                                      vat: vatTotal,
                                      totalAmount: platformTotal + vatTotal,
                                      installments: [phase1.(platform+VAT),
                                                     phase2.(platform+VAT)] }

────────────────────────────────────────────────────────────────────

applicant opens dashboard
        │
        ▼
GET /api/applications/:applicationId/quotations
        │
        └─ returns { dtam, platform }, filtered by reviewer role

────────────────────────────────────────────────────────────────────

applicant clicks "Accept" on DTAM
        │
        ▼
POST /api/applications/:applicationId/quotations/DTAM/accept
        │
        └─ quotationService.markQuotationAccepted(...)
                └─ status PENDING → ACCEPTED

(same for PLATFORM)

────────────────────────────────────────────────────────────────────

applicant pays Phase 1 (two transfers — DTAM + PLATFORM slips)
        │
        ▼
phase-billing-service spawns Invoice rows from quotation.installments
        │
        └─ quotationService.markQuotationInvoiced(...)
                └─ status ACCEPTED → INVOICED
```

## Amount sources — fee-service is the single source of truth

All money math comes from
`apps/backend/modules/billing.calculateApplicationFees(formData, { scopeCount })`.
The Quotation service NEVER hard-codes amounts.

| Field | DTAM quotation | PLATFORM quotation |
| --- | --- | --- |
| `subtotal` | `fees.stateTotal` | `fees.platformTotal` |
| `vat` | `0` (ม.77/1 (10) ป.รัษฎากร) | `fees.vatTotal` (7% on platform) |
| `totalAmount` | `subtotal` | `subtotal + vat` |
| `installments[0]` | `{ PHASE_1, phase1.stateAmount }` | `{ PHASE_1, phase1.platformAmount + phase1.vatAmount }` |
| `installments[1]` | `{ PHASE_2, phase2.stateAmount }` | `{ PHASE_2, phase2.platformAmount + phase2.vatAmount }` |

### Worked examples

Single scope (typical):
- DTAM: subtotal **30,000** / vat 0 / total **30,000**
  - installments: PHASE_1 **5,000**, PHASE_2 **25,000**
- PLATFORM: subtotal **3,000** / vat **210** / total **3,210**
  - installments: PHASE_1 **535**, PHASE_2 **2,675**

Three scopes:
- DTAM: subtotal **90,000** / vat 0 / total **90,000**
- PLATFORM: subtotal **9,000** / vat **630** / total **9,630**

## Issuer routing

Header / legal identity is resolved at PDF-render time from
`config/invoice-issuers.getInvoiceIssuer(serviceType)` — so changes
to env-driven defaults (ops correction, DTAM relocation) flow into
previously issued quotations automatically. The Quotation row only
carries the `issuerType` discriminator, not a copy of the issuer
fields.

- `issuerType = 'DTAM'`     → กรมการแพทย์แผนไทยและการแพทย์ทางเลือก, tax ID 0994000036540
- `issuerType = 'PLATFORM'` → บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด, tax ID 0105568045932

## Receipt numbering

Quotation numbers are allocated via the canonical
`receipt-numbering-service`. They share the underlying
`ReceiptSequence` table (per-prefix-per-year counter) so each prefix
has its own monotonic stream.

| Prefix | Issuer | Year basis | Numerals | Example |
| --- | --- | --- | --- | --- |
| `QT-DTAM` | DTAM | Buddhist Era | Thai | `QT-DTAM-๒๕๖๙-๐๐๐๐๐๑` |
| `QT-PRD` | PLATFORM | Common Era | Arabic | `QT-PRD-2026-000001` |

Allocation is upsert-in-Serializable-transaction; concurrent allocators
serialise on the unique (prefix, year) row.

## Installment semantics

`installments` is a JSONB array of `{ phase, amount }`:

```json
[
  { "phase": "PHASE_1", "amount": 5000 },
  { "phase": "PHASE_2", "amount": 25000 }
]
```

When the applicant clears each phase gate
(phase-billing-service / payment-service-phase-flow), one Invoice
row is spawned per installment carrying the same money triple. The
parent Quotation flips ACCEPTED → INVOICED on the first spawn (idempotent).

## Idempotency

Both quotations share a composite uniqueness intent:
`(applicationId, issuerType, isDeleted=false)`. The service does a
findMany probe before any create — if both DTAM + PLATFORM rows
already exist, returns them; if exactly one exists (rare partial-failure
recovery path), creates only the missing side. Computed amounts are
deterministic so a recovery create never drifts from the pre-existing
row.

The submit-route hook is fire-and-forget (rejected promises only log
a warning) because `application-status-writer.js` is on the no-touch
list and can't bring the issuance into its own `$transaction`. The
small window where status flips before quotations are written is
tolerable because the operation is idempotent: a retry by the
applicant (refresh) or by phase-billing-service (defensive read)
produces the same two rows.

## Endpoints

| Method | Path | Auth | Role-gating |
| --- | --- | --- | --- |
| `GET` | `/api/applications/:applicationId/quotations` | any | applicant owns, accountants see only their side, admin/reviewer/auditor see both |
| `GET` | `/api/applications/:applicationId/quotations/:issuerType/pdf` | any | same as above, additionally side-restricted |
| `POST` | `/api/applications/:applicationId/quotations/:issuerType/accept` | applicant only | applicant must own the application |

## Statutory anchors

- **ป.รัษฎากร ม.86/4** — ผู้ประกอบการ VAT ออกใบกำกับภาษีเต็มรูป (PLATFORM)
- **ป.รัษฎากร ม.77/1 (10)** — รายได้แผ่นดินยกเว้น VAT (DTAM)
- **กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน** — ต้องนำส่งกระทรวงการคลังโดยตรง
- **TFRS for NPAEs ch.18 (รายได้)** — รับรู้รายได้ที่กิจการได้รับ (PLATFORM books cash-basis)
- **พ.ร.บ.การอำนวยความสะดวกฯ พ.ศ.2558** — เอกชนทำหน้าที่รับชำระเงินรายได้แผ่นดินในนามรัฐได้ (collection-agent model)

## Open questions for Product

1. **Acceptance UI cardinality** — applicant accepts the DTAM and PLATFORM
   quotations independently or together? Today both `accept` endpoints
   exist; UI may want a single "Accept both" button that fires two
   POSTs in parallel.
2. **Revision handling** — when an applicant submits a revision
   (REVISION_REQUESTED → ASSIGNED_FOR_REVIEW), should we re-issue
   quotations? Current behavior: NO (initial-submit-only hook).
   Rationale: scope count doesn't change on revision, so amounts are
   identical; re-issuing would create spurious paper.
3. **Quotation cancellation** — schema has REJECTED / EXPIRED states
   but no service method for them yet. Defer until Ops asks for it
   (expected use: cancel after a long PENDING_DOC_FEE with no payment).
4. **PDF cardinality** — `generateQuotationPdf` currently emits one PDF
   per `(application, phase, issuerSide)`. The applicant-facing
   document for a typical 2-phase application is therefore 4 PDFs
   (DTAM-phase1, DTAM-phase2, PRD-phase1, PRD-phase2). Decide if we
   want a combined "both phases on one PDF per issuer" view (likely
   yes, owner-confirmed two documents per application, not four).

## File index

New files:
- `apps/backend/services/quotation-service.js`
- `apps/backend/routes/api/applications/quotations.js`
- `apps/backend/__tests__/unit/quotation-service.test.js`
- `docs/architecture/quotation-issuance-2026-05-16.md` (this doc)

Modified files:
- `apps/backend/routes/api/applications/applications.js` — fire-and-forget
  `quotationService.issueQuotationsForApplication(...)` after
  `writeApplicationStatus` on the DRAFT/REGISTERED → SUBMITTED path
- `apps/backend/routes/api/index.js` — mount the quotation sub-router under
  `/api/applications/:applicationId/quotations`
