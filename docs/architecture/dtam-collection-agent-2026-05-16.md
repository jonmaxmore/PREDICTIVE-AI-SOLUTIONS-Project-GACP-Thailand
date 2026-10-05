> ## ⛔ เอกสารนี้เลิกใช้แล้ว (2026-09-05)
>
> โมเดล "ตัวแทนรับชำระ" ทั้งฉบับถูกยกเลิกโดยคำสั่ง operator W14 (2026-08-22):
> บริษัทเป็นผู้ออกเอกสารรายเดียว เกษตรกรซื้อบริการจากบริษัท และบริษัทเคลียร์กับกรมฯ
> **นอกระบบนี้** — ไม่มีขาที่ยกเว้น VAT และไม่มีตัวแทนรับชำระ
>
> ความจริงปัจจุบันอยู่ที่ **`docs/architecture/fee-model-2026-09-05.md`**
> เก็บไฟล์นี้ไว้อ่านเป็นประวัติเท่านั้น อย่านำตัวเลขหรือผังบัญชีในนี้ไปใช้

---
artifact: architecture-decision
date: 2026-05-16
batch: B16 (Compliance / Accounting)
status: confirmed-by-owner-pending-finance-signoff
authoritative-references:
  - apps/backend/config/invoice-issuers.js (canonical issuer config)
  - apps/backend/services/journal-entry-service.js (chart of accounts)
  - apps/backend/shared/ministry-contact.js (DTAM address source)
  - apps/backend/services/pdf/templates/invoice.html (DTAM bank account)
  - docs/handoffs/system-deep-dive-2026-05-15/TIER-12-EXECUTION-LOG.md
  - docs/audit/accounting-correctness-2026-05-16.md
legal-references:
  - พระราชบัญญัติการอำนวยความสะดวกในการพิจารณาอนุญาตของทางราชการ พ.ศ.2558
  - ประมวลรัษฎากร ม.77/1 (10) — รายได้แผ่นดินยกเว้น VAT
  - ประมวลรัษฎากร ม.86/4 — ใบกำกับภาษีเต็มรูป
  - ประมวลรัษฎากร ม.105 — ใบรับ
  - กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน
---

# DTAM Collection-Agent Accounting Relationship

## TL;DR

The GACP platform (operated by **บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด** /
Predictive AI Solution Co., Ltd., Tax ID `0105568045932`) functions as a
**collection agent** for **กรมการแพทย์แผนไทยและการแพทย์ทางเลือก** (Department
of Thai Traditional and Alternative Medicine — DTAM, Tax ID `0994000036540`)
under the Thai Public Service Act B.E. 2558.

The platform receives a single transfer per phase that covers BOTH the state
fee + platform fee + VAT, but only the platform fee portion is platform
revenue. The state fee portion is held as a liability (Due to DTAM) and
remitted to DTAM monthly.

## 1. Business model (Thai)

ผู้ยื่นคำขอรับรองมาตรฐาน GACP ชำระเงินครั้งเดียวต่อ phase เข้าบัญชีของ
แพลตฟอร์ม (บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด). ยอดที่ชำระประกอบด้วย 3 ส่วน:

| ส่วน | จำนวน (Phase 1 single scope) | จำนวน (Phase 2 single scope) | เจ้าของเงิน |
|---|---|---|---|
| ค่าธรรมเนียมรัฐ (state fee) | 5,000 บาท | 25,000 บาท | DTAM (รัฐ) |
| ค่าบริการแพลตฟอร์ม (platform fee) | 500 บาท | 2,500 บาท | แพลตฟอร์ม |
| VAT 7% บน platform fee | 35 บาท | 175 บาท | สรรพากร (ผ่านแพลตฟอร์ม) |
| **รวม** | **5,535 บาท** | **27,675 บาท** | — |

แพลตฟอร์มทำหน้าที่ **ตัวแทนรับชำระ (collection agent)** ของ DTAM ตาม
พระราชบัญญัติการอำนวยความสะดวกในการพิจารณาอนุญาตของทางราชการ พ.ศ.2558.
รายได้ของแพลตฟอร์มจริง ๆ คือเฉพาะ "platform fee" (500 / 2,500 บาท) เท่านั้น
— ไม่ใช่ state fee.

## 2. Business model (English)

When an applicant submits a GACP-certification application, they pay once
per phase into the platform's bank account. The single transfer covers
three components:

| Component | Phase 1 single scope (THB) | Phase 2 single scope (THB) | Beneficial owner |
|---|---|---|---|
| State fee | 5,000 | 25,000 | DTAM (government) |
| Platform fee | 500 | 2,500 | Platform |
| Output VAT 7% on platform fee | 35 | 175 | Revenue Dept (collected by platform) |
| **Total** | **5,535** | **27,675** | — |

The platform operates as DTAM's authorised collection agent under the Thai
Public Service Act B.E. 2558. Real platform revenue is the platform-fee
portion only.

## 3. Legal-document flow

Two distinct documents are issued per paid phase invoice.

### 3.1 Government Revenue Receipt — issued ON BEHALF OF DTAM

| Field | Value |
|---|---|
| Document type | ใบเสร็จเงินรายได้แผ่นดิน (Government Revenue Receipt) |
| Issued by (legal name) | กรมการแพทย์แผนไทยและการแพทย์ทางเลือก |
| Tax ID shown | `0994000036540` (DTAM's) |
| Address shown | 88/23 หมู่ 4 ถนนติวานนท์ ตำบลตลาดขวัญ อำเภอเมืองนนทบุรี จังหวัดนนทบุรี 11000 |
| Amount | State fee only (5,000 / 25,000 THB) |
| VAT row | **NOT PRESENT** (รายได้แผ่นดินยกเว้น VAT ตาม ม.77/1 (10)) |
| "ใบกำกับภาษี" badge | **FORBIDDEN** (DTAM not VAT-registered) |
| Numbering scheme | `RCP-DTAM-{พ.ศ.}-{seq6}` |
| Retention | 7 years (ป.รัษฎากร ม.87/3) |
| Collection-agent fine print | "เอกสารนี้ออกโดย บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด ในฐานะตัวแทนรับชำระเงินรายได้แผ่นดิน…" |
| Template | `apps/backend/services/pdf/templates/government-revenue-receipt.html` |
| Legal basis | กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน |

### 3.2 Full Tax Invoice / Receipt — issued in the platform's own name

| Field | Value |
|---|---|
| Document type | ใบกำกับภาษีเต็มรูป / ใบเสร็จรับเงิน |
| Issued by (legal name) | บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด (สำนักงานใหญ่) |
| Tax ID shown | `0105568045932` (platform's) |
| Address shown | 429/69 หมู่บ้าน พรีเมี่ยมเพลส ถนนสุคนธสวัสดิ์ แขวงลาดพร้าว เขตลาดพร้าว, กรุงเทพมหานคร 10230 |
| Amount | Platform fee + VAT (535 / 2,675 THB) |
| VAT row | **REQUIRED** (Output VAT 7%) |
| "ใบกำกับภาษี" badge | **REQUIRED** (ม.86/4 (1)) |
| Numbering scheme | `TAX-PRD-{ค.ศ.}-{seq6}` (full tax invoice) / `RCP-PRD-{ค.ศ.}-{seq6}` (receipt) |
| Retention | 7 years (ป.รัษฎากร ม.87/3) |
| "(สำนักงานใหญ่)" suffix | **REQUIRED** ม.86/4 (1) — distinguishes head office from branches |
| Template | `apps/backend/services/pdf/templates/tax-invoice.html` |
| Legal basis | ป.รัษฎากร ม.86/4 + ม.105 |

The corporate customer can use the full tax invoice to claim Output VAT
or to withhold 3% under their own ภ.ง.ด.53 obligation. The platform does
NOT pre-deduct WHT — that is the payer's duty (intentional per owner
direction 2026-05-15).

## 4. Accounting flow

### 4.1 At slip-approval / payment-capture (current state — Tier 14 journal entry)

Customer transfers the full phase amount (e.g. 5,535 THB Phase 1 single
scope). In the platform's books (per
`apps/backend/services/journal-entry-service.js`):

| Dr/Cr | Account code | Account | Amount (THB) |
|---|---|---|---|
| Dr | 1110-001 | เงินสด/เงินฝากธนาคาร — บัญชีหลัก | 5,535.00 |
| Cr | 2151-001 | เจ้าหนี้ — กรมการแพทย์แผนไทยฯ (PAYABLE_TO_DTAM) | 5,000.00 |
| Cr | 4110-001 | รายได้ค่าบริการแพลตฟอร์ม | 500.00 |
| Cr | 2131-001 | ภาษีขายตั้งพัก (Output VAT 7%) | 35.00 |

**Status**: `journal-entry-service.js` already routes the state portion
to `2151-001 PAYABLE_TO_DTAM` (liability), never to a revenue account.
Anti-regression test `STATE invoice does NOT create a Revenue—State
line` locks this in. The platform's books never recognise state-fee
revenue — collection-agent model is fully implemented in journal entries.

### 4.2 At monthly remittance to DTAM (implemented — `buildRemittanceEntryLines`)

Monthly (or at agreed frequency), the platform transfers the accumulated
state-fee balance to DTAM's revenue account
(`buildRemittanceEntryLines` in `journal-entry-service.js`):

| Dr/Cr | Account code | Account | Amount (THB) |
|---|---|---|---|
| Dr | 2151-001 | เจ้าหนี้ — กรมการแพทย์แผนไทยฯ | Σ state-fee receipts in period |
| Cr | 1110-001 | เงินสด/เงินฝากธนาคาร — บัญชีหลัก | Σ state-fee receipts in period |

Bank-account destination (per `apps/backend/services/pdf/templates/invoice.html:338-341`):

- ธนาคาร: กรุงไทย สาขามหาวิทยาลัยธรรมศาสตร์ รังสิต
- เลขที่บัญชี: 4750134376
- ชื่อบัญชี: เงินบำรุงศูนย์พัฒนายาไทยและสมุนไพร
- Tax ID ปลายทาง: `0994000036540` (DTAM)

### 4.3 At monthly VAT remittance (ภ.พ.30 to Revenue Department)

Output VAT collected during the month is remitted to the Revenue Department
via ภ.พ.30 on the 15th of the following month:

| Dr/Cr | Account code | Account | Amount (THB) |
|---|---|---|---|
| Dr | 2131-001 | ภาษีขายตั้งพัก (Output VAT 7%) | Σ VAT collected in period |
| Cr | 1112-001 | เงินฝากธนาคาร — บัญชีหลัก | Σ VAT remitted |

## 5. Reference data (post-B16 baked-in defaults)

```
DTAM_LEGAL_NAME_TH=กรมการแพทย์แผนไทยและการแพทย์ทางเลือก
DTAM_LEGAL_NAME_EN=Department of Thai Traditional and Alternative Medicine
DTAM_TAX_ID=0994000036540
DTAM_ADDRESS_LINE1=88/23 หมู่ 4 ถนนติวานนท์ ตำบลตลาดขวัญ อำเภอเมืองนนทบุรี
DTAM_ADDRESS_LINE2=จังหวัดนนทบุรี 11000

PLATFORM_COMPANY_NAME_TH=บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด (สำนักงานใหญ่)
PLATFORM_TAX_ID=0105568045932
PLATFORM_REGISTRATION_NO=0105568045932
PLATFORM_ADDRESS_LINE1=429/69 หมู่บ้าน พรีเมี่ยมเพลส ถนนสุคนธสวัสดิ์ แขวงลาดพร้าว เขตลาดพร้าว
PLATFORM_ADDRESS_LINE2=กรุงเทพมหานคร 10230
```

### Provenance of DTAM data (where each value was found)

| Field | Confirming source(s) |
|---|---|
| Tax ID `0994000036540` | `apps/backend/services/pdf/templates/invoice.html:341` (DTAM bank account); `TIER-12-EXECUTION-LOG.md:18` "0994000036540 คือ tax ID ของ DTAM"; `apps/web-app/src/features/permit-form/components/documents/invoice-document.tsx:112`; `apps/web-app/src/features/permit-form/components/documents/quotation-document.tsx:99`; `apps/web-app/src/app/provider/accounting/invoice-detail-modal.tsx:228` |
| Address (Nonthaburi 11000) | `apps/backend/shared/ministry-contact.js:23` (verified against dtam.moph.go.th 2026-04-28); `apps/web-app/src/lib/ministry-contact.ts:21`; `apps/web-app/src/config/document-config.ts:24`; `apps/web-app/src/components/document/gacpthai-document-layout.tsx:54` |
| Legal name TH/EN | `apps/backend/shared/ministry-contact.js:21-22` and replicated across all frontend/PDF templates |

## 6. Open questions for Finance / Legal sign-off

The following items require Finance / Legal confirmation before public
production cutover. Each is currently bridged with a reasonable default
or explicit deferral.

| # | Question | Current state | Risk if unresolved at production |
|---|---|---|---|
| 1 | Is `0994000036540` the correct tax ID DTAM wants printed on the receipt? | Baked into config + multiple existing templates already. | Wrong issuer ID on government revenue receipt — receipt may be rejected by DTAM's accounting. |
| 2 | Is `88/23 หมู่ 4 ถนนติวานนท์ …` the correct registered postal address? | Sourced from official DTAM site footer. | Address mismatch on receipt vs DTAM's accounting system — minor. |
| 3 | Is the collection-agent fine-print language acceptable to DTAM's legal team? | Drafted as `collectionAgentNoteTH` / `collectionAgentNoteEN` in `invoice-issuers.js`. | Legal exposure if DTAM disputes the agency relationship. |
| 4 | Has DTAM signed an MOU / collection-agent contract with the platform? | Status unknown — TODO(Legal). | Without a written agency agreement, the platform's holding of state fees might be construed as deposit-taking. |
| 5 | What's the remittance cadence and channel? | Likely monthly bank transfer to KTB 4750134376 — TODO(Finance/Ops). | Cash-flow ambiguity; reconciliation gap if cadence is contested. |
| 6 | Should state-fee balance in 2191-001 earn interest? | TBD by contract. | Tax issue if interest is generated and not declared. |
| 7 | What happens to refunds (failed application, cancellation before review)? | Refund pipeline TBD — TODO(Product/Finance). | UX gap; possible double-counting if refund hits liability vs revenue. |
| 8 | Receipt-template fine print integration (collection-agent notation) | Notation strings defined in `invoice-issuers.js` (`collectionAgentNoteTH/EN`); not yet rendered in `government-revenue-receipt.html` template. | DTAM receipt does not yet disclose the collection-agent relationship to the applicant. **B16-C territory.** |

## 7. Implementation status (this batch B16)

- [x] `apps/backend/config/invoice-issuers.js` — DTAM defaults baked in
      (taxId, addressLine1, addressLine2) + collection-agent marker
      fields (collectedByPlatform, collectionAgentNoteTH/EN)
- [x] Header comment in `invoice-issuers.js` documents the
      collection-agent relationship with full Thai + English + legal
      citations
- [x] Unit tests updated — 20 tests pass (`invoice-issuers.test.js`)
- [x] Anchor tests still pass — `payment-phase-flow-canonical-totals.test.js`
      (8 tests), full `invoice-*` suite (80 tests)
- [x] This architecture doc

NOT TOUCHED (other batch territory — see batch boundaries):
- Prisma schema (B16-A)
- `journal-entry-service.js` (B16-B — already correctly routes
  state portion to PAYABLE_TO_DTAM 2151-001 since Tier 14)
- PDF templates fine-print integration of `collectionAgentNoteTH/EN`
  (B16-C)
- `payment-slip-service.js` / `audit-trail.js` / `application-status-writer.js`

## 8. Change log

| Date | Author / batch | Change |
|---|---|---|
| 2026-05-16 | B16 (Compliance) | Initial document. Bake DTAM defaults into invoice-issuers.js. |
