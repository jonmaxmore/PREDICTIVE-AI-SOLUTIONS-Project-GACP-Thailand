> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> ตัวเลขค่าธรรมเนียมและจุดยืนทางภาษีในเอกสารนี้เป็นของสูตรก่อน W14 (VAT คิดเฉพาะส่วนแพลตฟอร์ม)
> ปัจจุบัน: **ผู้ออกเอกสารรายเดียว · VAT 7% บนค่าบริการทั้งก้อน · งวด 1 = 5,885 · งวด 2 = 29,425**
> เก็บไว้อ่านเป็นบันทึกประวัติ · ความจริงปัจจุบัน: `docs/architecture/fee-model-2026-09-05.md`

# Two-Card Applicant Payment Flow

**Status**: implemented (B18-B, 2026-05-16)
**Owner directive**: ผู้สมัครต้องโอนเงินสองครั้งต่อ phase — รัฐ + แพลตฟอร์ม

## Why two cards

The applicant transfers money TWICE per phase:

| ครั้งที่ | ฝั่ง | จำนวน (PHASE_1 / PHASE_2) | บัญชีปลายทาง | issuer | VAT |
| --- | --- | --- | --- | --- | --- |
| 1 | STATE | 5,000 / 25,000 บาท | กรมบัญชีกลาง (ธ.กรุงไทย 4750134376) | DTAM | ยกเว้น |
| 2 | PLATFORM | 535 / 2,675 บาท | บริษัท Predictive AI Solution | PLATFORM | 7% (35 / 175) |

Legal rationale (see `apps/backend/config/invoice-issuers.js`):
- ป.รัษฎากร ม.77/1 (10) — รายได้แผ่นดินยกเว้น VAT
- กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน — ต้องเข้าบัญชีกรมบัญชีกลางโดยตรง
- ป.รัษฎากร ม.86/4 — ใบกำกับภาษีเต็มรูปออกได้เฉพาะผู้ประกอบการ VAT (= Predictive AI, ไม่ใช่ DTAM)
- TFRS for NPAEs ch.18 — รับรู้รายได้เฉพาะส่วน platform fee เท่านั้น

The two transfers MUST NOT be combined into one. If the applicant sends a single combined slip, the platform's GL would record DTAM's 5,000 baht as "Due to DTAM" liability — that requires a monthly remittance pipeline that does not exist. Splitting at the bank level keeps the platform out of the state-fee custody chain entirely.

## ASCII mockup (desktop, ≥ md breakpoint)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ งวดที่ 1                                          ยอดรวมงวด: ฿5,535 (โอน 2 ครั้ง) │
│ ค่าธรรมเนียมเอกสาร — โอน 2 ครั้ง (รัฐ + แพลตฟอร์ม)                                  │
│                                                                                  │
│ ┌──────────────────────────────────┐ ┌──────────────────────────────────┐       │
│ │ [รฐ] ค่าธรรมเนียมรัฐ      [รอชำระ]│ │ [PRD] ค่าบริการแพลตฟอร์ม [รอชำระ]  │       │
│ │      โอนเข้าบัญชีกรมบัญชีกลาง       │ │       โอนเข้าบัญชี Predictive AI    │       │
│ │ ─────────────────────────────────│ │ ─────────────────────────────────│       │
│ │ ยอดชำระ                          │ │ ยอดชำระ                          │       │
│ │ ฿5,000                           │ │ ฿535                             │       │
│ │ VAT: ยกเว้น (0%)                  │ │ ค่าบริการ ฿500   VAT 7% ฿35       │       │
│ │ รวม ฿5,000                        │ │ รวม ฿535                          │       │
│ │ ─────────────────────────────────│ │ ─────────────────────────────────│       │
│ │ ธนาคาร: ธ.กรุงไทย                  │ │ ธนาคาร: (PENDING ops fill)         │       │
│ │ เลขที่บัญชี: 4750134376             │ │ เลขที่บัญชี: (PENDING)              │       │
│ │ ชื่อบัญชี: กรมบัญชีกลาง — DTAM       │ │ ชื่อบัญชี: บริษัท พรีดิกทีฟ เอไอ      │       │
│ │ เลขผู้เสียภาษี: 0-9940-00036-54-0   │ │ เลขผู้เสียภาษี: 0-1055-68045-93-2   │       │
│ │ ─────────────────────────────────│ │ ─────────────────────────────────│       │
│ │ [QR 160x160]                     │ │ [QR 160x160]                     │       │
│ │ สแกนจ่ายด้วยพร้อมเพย์ — DTAM       │ │ สแกนจ่ายด้วยพร้อมเพย์ — Predictive  │       │
│ │ ─────────────────────────────────│ │ ─────────────────────────────────│       │
│ │ [ดูรายละเอียด] [อัปโหลดสลิป]       │ │ [ดูรายละเอียด] [อัปโหลดสลิป]       │       │
│ └──────────────────────────────────┘ └──────────────────────────────────┘       │
│                                                                                  │
│ ทำไมต้องโอน 2 ครั้ง? ค่าธรรมเนียมรัฐเป็นเงินรายได้แผ่นดินตามกฎหมาย...                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Mobile layout (< md, e.g. 360–767px viewport)

```
┌────────────────────────────────────┐
│ งวดที่ 1     ยอดรวมงวด: ฿5,535       │
│ ค่าธรรมเนียมเอกสาร — โอน 2 ครั้ง...     │
│ ┌────────────────────────────────┐ │
│ │ ค่าธรรมเนียมรัฐ       [รอชำระ]  │ │
│ │ ฿5,000 …                       │ │
│ │ QR 160x160                     │ │
│ │ [อัปโหลดสลิป]                   │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ ค่าบริการแพลตฟอร์ม   [รอชำระ]   │ │
│ │ ฿535 …                         │ │
│ │ QR 160x160                     │ │
│ │ [อัปโหลดสลิป]                   │ │
│ └────────────────────────────────┘ │
│ ทำไมต้องโอน 2 ครั้ง? …               │
└────────────────────────────────────┘
```

Cards stack vertically, each full-width. QR shrinks to 160×160 px so the bank-account list stays readable on a 360px screen. The "อัปโหลดสลิป" button is full-width on mobile.

## Component anatomy

```
TwoCardPaymentSection (groups by phase, shows combined total + rationale)
├── PaymentInvoiceCard component=STATE
│   ├── header (icon "รฐ", title, status pill)
│   ├── amount block (฿5,000, VAT exempt)
│   ├── bank info block (bankName, accountNumber, accountHolder, taxId)
│   ├── PromptPay QR (DTAM-side, generated client-side from issuer.promptpayId)
│   ├── collection-agent footnote
│   └── footer (ดูรายละเอียด, อัปโหลดสลิป)
└── PaymentInvoiceCard component=PLATFORM
    ├── header (icon "PRD", title, status pill)
    ├── amount block (฿535 = ฿500 + ฿35 VAT)
    ├── bank info block (Predictive AI)
    ├── PromptPay QR (PLATFORM-side, 0105568045932)
    └── footer (ดูรายละเอียด, อัปโหลดสลิป)
```

## Data sources

1. **Invoice list** — `GET /api/invoices/my` returns two invoices per phase
   (STATE + PLATFORM). The frontend `PaymentService.getMyPayments()` maps
   `serviceType` → `{ phase, component }` so the page can group them.
2. **Issuer + bank channel** — `GET /api/finance/issuers/by-service-type/:type`
   (new endpoint, B18-B). Returns bank name, account number, account holder,
   tax ID, PromptPay payload. Sourced from `apps/backend/config/invoice-issuers.js`
   so it is in lock-step with what the receipt PDFs render.
3. **PromptPay QR** — generated client-side via
   `apps/web-app/src/lib/utils/promptpay-qr.ts` (`buildPromptPayPayload`).
   Each card calls it with its own issuer's PromptPay ID and its own
   invoice amount, so the two QRs scan to two different recipients with
   two different amounts.

## What happens when the applicant only uploads ONE slip

Per backend `ensurePhaseInvoices` (B16-C), the phase advance gate requires
BOTH invoices to be in PAID state. Today's behaviour:

- Upload slip for STATE only → STATE invoice transitions to `PAID_PENDING_RECEIPT`
  after reviewer approval. The PLATFORM invoice stays `PENDING`. The phase
  remains blocked — the applicant cannot progress to PHASE_2 review.
- Upload slip for PLATFORM only → symmetric. PLATFORM invoice paid,
  STATE invoice still blocking.
- Both slips uploaded + approved → both invoices `PAID_PENDING_RECEIPT` →
  phase advances → workflow moves on to next stage.

The two-card UI surfaces this by keeping each card's "อัปโหลดสลิป" button
independent: paying one does NOT auto-complete the other. The phase
header still shows the combined total so the applicant sees the grand
sum, but each card carries its own status pill.

## Frontend file inventory

- `apps/web-app/src/components/payments/PaymentInvoiceCard.tsx` — single card
- `apps/web-app/src/components/payments/TwoCardPaymentSection.tsx` — grouping
- `apps/web-app/src/components/payments/__tests__/TwoCardPaymentSection.test.tsx` — smoke test
- `apps/web-app/src/app/health/payments/client-view.tsx` — wires the section in for `PHASE_1` and `PHASE_2`. The legacy table renderer is retained for `UNKNOWN` and `SUBSCRIPTION` rows (single-payee flows).
- `apps/web-app/src/lib/services/payment-service.ts` — adds `getIssuerByServiceType` + `InvoiceIssuerView` type.

## Backend file inventory

- `apps/backend/routes/api/finance/issuers.js` — new read-only endpoint.
- `apps/backend/routes/api/index.js` — mounts `/api/finance/issuers`.
- `apps/backend/config/invoice-issuers.js` — already the source of truth (no edits).
- `apps/backend/utils/promptpay-qr.js` — already there (no edits).

## Acceptance check

- [x] Two cards rendered per phase (STATE + PLATFORM)
- [x] Each card has its own bank coords from `invoice-issuers.js`
- [x] Each card has its own PromptPay QR baked with its own amount
- [x] Mobile stacks cards vertically
- [x] Combined total appears in section header
- [x] Slip upload button per card (independent)
- [x] "ทำไมต้องโอน 2 ครั้ง?" rationale visible
- [x] Smoke test verifies 2 cards, total, and rationale
- [x] Legacy table preserved for `UNKNOWN`/`SUBSCRIPTION` rows
