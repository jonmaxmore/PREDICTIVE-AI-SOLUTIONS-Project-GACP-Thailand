# Applicant Payment History, Refund Visibility, and Certificate Detail

**Iter 23 — 2026-05-16**

This doc covers three applicant-facing surfaces added in Iter 23:

1. **Payment history** — visibility into every slip the applicant has uploaded.
2. **Refund visibility** — visibility into every credit note (refund) issued against the applicant's invoices.
3. **Certificate detail page** — dedicated route for downloading, sharing, and printing the issued GACP certificate.

The first two live on `/health/payments` (added below the existing two-card payment section). The third is a new route at `/health/certificates/[id]`.

---

## 1. Payment history — `<SlipHistorySection>`

**Location**: `apps/web-app/src/components/payments/SlipHistorySection.tsx`
**Mount point**: `/health/payments` (below `<TwoCardPaymentSection>` rows)
**Data**: `PaymentService.getSlipHistory(applicationId)`
**Empty state**: `"ยังไม่มีการอัปโหลดสลิป — เริ่มชำระเงินจากบัตรด้านบน"`

### Desktop layout (≥ lg)

```
+------------------------------------------------------------------+
| ประวัติการชำระเงิน                                    ทั้งหมด 4 รายการ |
| สลิปทั้งหมดที่ท่านอัปโหลดสำหรับคำขอนี้                                  |
+-------------------+----------------+---------+-----------+--------+
| วันที่อัปโหลด     | ใบแจ้งหนี้     | จำนวน   | เลขอ้างอิง| สถานะ |
+-------------------+----------------+---------+-----------+--------+
| 16 พ.ค. 69 14:32  | INV-2026-0001  | ฿5,000  | TRX-9921  | [รอเจ้าหน้าที่] [ดูสลิป] |
| 15 พ.ค. 69 09:10  | INV-2026-0002  | ฿535    | TRX-9920  | [อนุมัติแล้ว]   [ดูสลิป] |
| 12 พ.ค. 69 16:55  | INV-2026-0001  | ฿5,000  | TRX-9911  | [ถูกปฏิเสธ]     [ดูสลิป] |
|                   |                |         |           | เหตุผล: สลิปไม่ชัด     |
+-------------------+----------------+---------+-----------+--------+
```

### Mobile layout (< lg)

```
+------------------------------------+
| ประวัติการชำระเงิน                 |
| สลิปทั้งหมดที่ท่านอัปโหลด          |
| ทั้งหมด 4 รายการ                    |
+------------------------------------+
| 16 พ.ค. 69 14:32   [รอเจ้าหน้าที่] |
| INV-2026-0001                       |
|                                     |
| จำนวน    เลขอ้างอิง                 |
| ฿5,000   TRX-9921                   |
|                                     |
| [          ดูสลิป          ]        |
+------------------------------------+
| 12 พ.ค. 69 16:55   [ถูกปฏิเสธ]      |
| INV-2026-0001                       |
|                                     |
| จำนวน    เลขอ้างอิง                 |
| ฿5,000   TRX-9911                   |
|                                     |
| เหตุผล: สลิปไม่ชัด                  |
| [          ดูสลิป          ]        |
+------------------------------------+
```

### Status mapping

The status pills use the shared `<StatusBadge>` component from
`apps/web-app/src/components/finance/StatusBadge.tsx` (batch 22). The mapping
from `PaymentSlip['status']` to badge tone is:

| Slip status     | Tone        | Thai label             |
|-----------------|-------------|------------------------|
| PENDING_REVIEW  | verifying   | รอเจ้าหน้าที่ตรวจสอบ |
| APPROVED        | paid        | อนุมัติแล้ว           |
| REJECTED        | cancelled   | ถูกปฏิเสธ             |
| SUPERSEDED      | draft       | แทนที่แล้ว            |

### Accessibility

- Each `<StatusBadge>` carries an accessible label (no color-only signal).
- The mobile card list keeps a 44px minimum touch target for the "ดูสลิป"
  link, matching WCAG 2.5.5.
- Reject reasons are rendered as plain text (not popovers) so screen
  readers can find them on the same node as the status.

---

## 2. Refund visibility — `<RefundVisibilitySection>`

**Location**: `apps/web-app/src/components/payments/RefundVisibilitySection.tsx`
**Mount point**: `/health/payments` (immediately below `<SlipHistorySection>`)
**Data**: `PaymentService.getCreditNotes(applicationId)` (fans out per-invoice)
**Visibility rule**: section returns `null` when the applicant has zero credit notes — no empty state shown.

### Color palette

The section uses rose / burgundy from `finance-tokens.json::documentTypes.CREDIT_NOTE`:

- accent: `#9F1239` (rose-700) — for headings, total amount, primary button
- accentSoft: `#FFF1F2` (rose-50) — section background
- accentBorder: `#FDA4AF` (rose-300) — outer border

This matches the credit-note PDF template colors so the applicant sees
the same visual signal in the email PDF and on this dashboard panel.

### Desktop layout

```
+----------------------------------------------------------------+
| การคืนเงิน                                  ยอดที่คืน: ฿2,500    |
| ใบลดหนี้ (Credit Note) ที่ออกให้กับใบแจ้งหนี้ของท่าน               |
+----------------------------------------------------------------+
| CN-2026-000123          [คืนเงินแล้ว]                            |
| อ้างอิงใบแจ้งหนี้: INV-2026-0001                                  |
| เหตุผล: เปลี่ยนแปลงรอบการตรวจ - คืนค่าใช้จ่ายส่วนเกิน             |
| วันที่: 14 พ.ค. 69                                ยอดคืนเงิน      |
|                                                  ฿2,500          |
|                                                  รวม VAT ฿163.55 |
+----------------------------------------------------------------+
| มีคำถามเกี่ยวกับการคืนเงิน?            [ ติดต่อทีมการเงิน ]      |
+----------------------------------------------------------------+
```

### Refund status mapping

| CreditNote status | Tone        | Thai label       |
|-------------------|-------------|------------------|
| POSTED            | info        | คืนเงินแล้ว     |
| ISSUED            | verifying   | ออกเอกสารแล้ว    |
| DRAFT             | draft       | แบบร่าง          |
| CANCELLED         | cancelled   | ยกเลิก           |

### Contact CTA

The "ติดต่อทีมการเงิน" button is a `mailto:` link to `finance@dtam.go.th`
(overridable via `financeContactEmail` prop) with a pre-filled Thai
subject + greeting. This avoids forcing applicants through a separate
support form for what is essentially a clarification email.

---

## 3. Certificate detail page

**Route**: `/health/certificates/[id]`
**Files**:
- `apps/web-app/src/app/health/certificates/[id]/page.tsx` (Server Component shell)
- `apps/web-app/src/app/health/certificates/[id]/client-view.tsx` (Client island)
- `apps/web-app/src/lib/services/certificate-service.ts` (new API client)

**Goal**: replace the inline QR dialog on `/health/certificates` with a
dedicated, shareable, printable page. The applicant lands here from the
"ดูใบรับรอง" button on the cert list.

### Layout (desktop, lg+)

```
+--------------------------------------------------------------+
| สถานะใบรับรอง                                                  |
| ยินดีด้วย! ใบรับรอง GACP ของท่านพร้อมแล้ว    [ใช้งานได้]      |
| ใบรับรองมีผลตั้งแต่ 14 พฤษภาคม 2569 ถึง 14 พฤษภาคม 2570        |
+--------------------------------------------------------------+
| ข้อมูลใบรับรอง                       |  ตรวจสอบใบรับรองสาธารณะ |
|                                       |                          |
| เลขที่ใบรับรอง: GACP-PRD-2026-0001234 |   +---------------+      |
| สถานะ: ใช้งานได้ (ACTIVE)             |   |               |      |
| วันที่ออก: 14 พฤษภาคม 2569            |   |   QR (240px)  |      |
| วันที่หมดอายุ: 14 พฤษภาคม 2570        |   |               |      |
| ชื่อแปลง: ฟาร์มสมุนไพรบ้านดอนเมือง    |   +---------------+      |
| พืชหลัก: ขมิ้นชัน                      |                          |
| ที่ตั้ง: 19 ม.4 ต.บางกระดี อ.ปทุมธานี  |  สแกน QR หรือเปิดลิงก์    |
|                                       |  เพื่อยืนยันความถูกต้อง |
| [  ดาวน์โหลดใบรับรอง (PDF)  ]         |                          |
| [        แชร์ใบรับรอง        ]         |  ลิงก์ตรวจสอบ            |
|                                       |  gacp.dtam.go.th/verify/  |
|                                       |  GACP-PRD-2026-0001234   |
+--------------------------------------------------------------+
| ← กลับไปยังรายการใบรับรอง          พิมพ์ใบรับรอง               |
+--------------------------------------------------------------+
```

### Layout (mobile, < lg)

```
+--------------------------------+
| สถานะใบรับรอง                  |
| ยินดีด้วย!                     |
| ใบรับรอง GACP ของท่านพร้อมแล้ว |
| [ใช้งานได้]                    |
+--------------------------------+
| ข้อมูลใบรับรอง                |
| เลขที่ใบรับรอง                 |
| GACP-PRD-2026-0001234          |
| ...                            |
|                                |
| [ดาวน์โหลดใบรับรอง (PDF)]      |
| [แชร์ใบรับรอง]                 |
+--------------------------------+
| ตรวจสอบใบรับรองสาธารณะ         |
|                                |
|    +-------------------+       |
|    |                   |       |
|    |    QR (220px)     |       |
|    |                   |       |
|    +-------------------+       |
|                                |
| สแกน QR หรือเปิดลิงก์เพื่อ      |
| ยืนยันความถูกต้อง              |
|                                |
| ลิงก์ตรวจสอบ                   |
| gacp.dtam.go.th/verify/        |
| GACP-PRD-2026-0001234          |
+--------------------------------+
| ← กลับไปยังรายการใบรับรอง      |
| พิมพ์ใบรับรอง                  |
+--------------------------------+
```

### Behaviour

1. **Download (primary CTA)** — calls `CertificateService.downloadCertificatePdf(id, certNumber)`,
   which streams the PDF via `/api/certificates/:id/download` and triggers
   a browser save-as with the cert number as the filename.
2. **Share** — copies the public verify URL to clipboard (with a
   non-secure-context fallback for older browsers). The button label
   updates to "คัดลอกลิงก์แล้ว" for 2.4s on success.
3. **Print** — calls `window.print()`. The bottom footer is hidden via
   `print:hidden` Tailwind utilities so the printed page only shows the
   success card + metadata + QR.
4. **QR generation** — done client-side via the `qrcode` package, using
   the verify URL as the payload (not the backend-supplied blob, which
   may be stale if the verify-base env var changed).
5. **BE-year dates** — issue/expiry dates are converted from CE → BE by
   adding 543 to the year, matching the Thai-government convention used
   throughout the rest of the app.

### Error states

- **Unauthorized** (401) — redirects to `/auth/health/login` via the
  `AuthService.getUser()` guard at the top of the client view.
- **Cert not found / no access** (404/403) — renders a rose error card
  with a "กลับไปยังรายการใบรับรอง" link.
- **Download failure** — surfaces "ไม่สามารถดาวน์โหลดใบรับรองได้ กรุณา
  ลองอีกครั้ง" inline below the action buttons.

---

## API client extensions (Iter 23)

### `payment-service.ts`

```ts
PaymentService.getSlipHistory(applicationId: string): Promise<PaymentSlip[]>
PaymentService.getCreditNotes(applicationId: string): Promise<CreditNoteRecord[]>
```

Both are read-only; both delegate to existing backend routes
(`/payments/slip/by-application/:id` and `/finance/credit-notes?originalInvoiceId=…`).
No backend changes were introduced in Iter 23.

### `certificate-service.ts` (new)

```ts
CertificateService.getCertificateById(id: string)
CertificateService.getCertificatePdfUrl(id: string): string
CertificateService.getCertificateVerifyUrl(certNumber: string): string
CertificateService.downloadCertificatePdf(id, certNumber): Promise<boolean>
```

Verify base URL is read from `NEXT_PUBLIC_GACP_VERIFY_BASE` (or
`NEXT_PUBLIC_PUBLIC_VERIFY_BASE`) with `window.location.origin` and
`https://gacp.dtam.go.th` as fallbacks.

---

## Out of scope (TODO)

- **Notification badge** — top-nav bell + dropdown remained untouched
  per the Iter-23 scope boundary; that work belongs in a separate
  layout-touching batch.
- **Backend changes** — no Prisma / route changes; the existing
  `/payments/slip/by-application/:id` and `/finance/credit-notes`
  endpoints already match the data needed.
- **PDF templates** — owned by B23-C, not touched.
