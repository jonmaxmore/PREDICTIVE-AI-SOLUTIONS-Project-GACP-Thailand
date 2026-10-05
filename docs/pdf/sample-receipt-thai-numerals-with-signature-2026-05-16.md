> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# Sample receipt render — Thai numerals + digital signature (B16-D, 2026-05-16)

This document shows the visible difference between the OLD ASCII-only,
unsigned receipt and the NEW Thai-numeral, auto-signed receipt after the
B16-D batch lands. Two examples — one DTAM revenue receipt, one PLATFORM
full tax invoice — are presented side-by-side so QA can verify the changes
against the actual PDF render in UAT.

The cryptographic signature (RSA-SHA256 over the rendered PDF bytes) is
written to AuditLog only in this iteration; the corresponding
`Invoice.signatureMetadata` JSON column lands with B16-A.

---

## 1. DTAM revenue receipt — Phase 1 state fee

Approver: **นาง สุดา ใจดี — หัวหน้าบัญชี DTAM** (`ACCOUNT_DTAM`)
Signed at: 16 May 2026 10:30 ICT
Key namespace: `rsa:dtam-receipt`

### Before (ASCII digits, no signature block)

```
┌────────────────────────────────────────────────────────────────────┐
│ ใบเสร็จเงินรายได้แผ่นดิน              เลขที่ใบเสร็จ : RCP-DTAM-2569-000001 │
│                                       อ้างอิงใบแจ้งหนี้ : INV-2569-000001 │
│                                       วันที่รับชำระ : 16 พ.ค. 2569         │
├────────────────────────────────────────────────────────────────────┤
│  ยอดรวม             5,000.00 บาท                                   │
│  ยอดที่รับชำระทั้งสิ้น  5,000.00 บาท                                   │
├────────────────────────────────────────────────────────────────────┤
│  จำนวนเงิน (ตัวอักษร) ห้าพันบาทถ้วน                                  │
├────────────────────────────────────────────────────────────────────┤
│                              เจ้าหน้าที่การเงิน                    │
│                              ระบบรับรองมาตรฐาน GACP สมุนไพร       │
└────────────────────────────────────────────────────────────────────┘
```

### After (Thai numerals + auto-signed approver block)

```
┌────────────────────────────────────────────────────────────────────┐
│ ใบเสร็จเงินรายได้แผ่นดิน              เลขที่ใบเสร็จ : RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑ │
│                                       อ้างอิงใบแจ้งหนี้ : INV-2569-000001 │
│                                       วันที่รับชำระ : ๑๖ พฤษภาคม          │
│                                                      พุทธศักราช ๒๕๖๙     │
│                                       ปีงบประมาณ : ๒๕๖๙                  │
├────────────────────────────────────────────────────────────────────┤
│  ยอดรวม             ๕,๐๐๐.๐๐ บาท                                   │
│  ยอดที่รับชำระทั้งสิ้น  ๕,๐๐๐.๐๐ บาท                                   │
├────────────────────────────────────────────────────────────────────┤
│  จำนวนเงิน (ตัวอักษร) ห้าพันบาทถ้วน                                  │
├────────────────────────────────────────────────────────────────────┤
│  ผู้อนุมัติ / Approver (Digitally Signed)                          │
│  ชื่อ-สกุล  : นาง สุดา ใจดี                                          │
│  ตำแหน่ง   : หัวหน้าบัญชี DTAM                                       │
│  บทบาท    : ACCOUNT_DTAM                                            │
│  ลงนามเมื่อ : ๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙                              │
├────────────────────────────────────────────────────────────────────┤
│                              เจ้าหน้าที่การเงิน                    │
│                              นาง สุดา ใจดี                          │
│                              กรมการแพทย์แผนไทยและการแพทย์ทางเลือก  │
├────────────────────────────────────────────────────────────────────┤
│ Reference Number RCP-DTAM-2569-000001 · Issued 16 พ.ค. 2569       │
└────────────────────────────────────────────────────────────────────┘
```

Audit-log row (sample payload):

```json
{
  "action": "RECEIPT_AUTO_SIGNED",
  "category": "PAYMENT",
  "severity": "INFO",
  "actorId": "u-suda-dtam",
  "actorRole": "ACCOUNT_DTAM",
  "resourceType": "INVOICE",
  "resourceId": "inv-7f12...",
  "metadata": {
    "slipId": "slip-3a91...",
    "invoiceId": "inv-7f12...",
    "invoiceNumber": "INV-2569-000001",
    "receiptNumber": "RCP-DTAM-2569-000001",
    "signerId": "u-suda-dtam",
    "signerRole": "ACCOUNT_DTAM",
    "signerName": "นาง สุดา ใจดี",
    "signedAt": "2026-05-16T03:30:00.000Z",
    "pdfHash": "a3f8...",
    "signatureAlgorithm": "RSA-SHA256",
    "keyNamespace": "rsa:dtam-receipt",
    "issuerSide": "DTAM"
  }
}
```

---

## 2. PLATFORM full tax invoice — Phase 1 platform fee

Approver: **นาย สมชาย วิเชียร — หัวหน้าบัญชี Platform** (`ACCOUNT_PLATFORM`)
Signed at: 16 May 2026 10:31 ICT
Key namespace: `rsa:platform-receipt`

### Before (ASCII digits, no signature block)

```
┌────────────────────────────────────────────────────────────────────┐
│ ใบกำกับภาษี                            เลขที่ : TAX-PRD-2026-000001 │
│                                        วันที่ออก : 16 พ.ค. 2569      │
├────────────────────────────────────────────────────────────────────┤
│  ค่าธรรมเนียมรัฐ (VAT Exempt)              5,000.00 บาท              │
│  ค่าบริการแพลตฟอร์ม (Before VAT)            500.00 บาท              │
│  ภาษีมูลค่าเพิ่ม 7% (VAT)                  35.00 บาท                │
│  ยอดที่ต้องชำระทั้งสิ้น                    5,535.00 บาท              │
├────────────────────────────────────────────────────────────────────┤
│                              เจ้าหน้าที่การเงิน                    │
│                              ระบบรับรองมาตรฐาน GACP สมุนไพร       │
└────────────────────────────────────────────────────────────────────┘
```

### After (Thai numerals + auto-signed approver block)

```
┌────────────────────────────────────────────────────────────────────┐
│ ใบกำกับภาษี                            เลขที่ : TAX-PRD-๒๐๒๖-๐๐๐๐๐๑ │
│                                        วันที่ออก : ๑๖ พฤษภาคม        │
│                                                  พุทธศักราช ๒๕๖๙     │
│                                        ปี ค.ศ. : ๒๕๖๙               │
├────────────────────────────────────────────────────────────────────┤
│  ผู้ซื้อ / Buyer                                                   │
│    ชื่อ        : บริษัท สมุนไพรไทย จำกัด                            │
│    เลขประจำตัวผู้เสียภาษี : ๐-๑-๐๕๕๖-๘๐๔๕-๒                          │
├────────────────────────────────────────────────────────────────────┤
│  ค่าธรรมเนียมรัฐ (VAT Exempt)              ๕,๐๐๐.๐๐ บาท              │
│  ค่าบริการแพลตฟอร์ม (Before VAT)            ๕๐๐.๐๐ บาท              │
│  ภาษีมูลค่าเพิ่ม 7% (VAT)                  ๓๕.๐๐ บาท                │
│  ยอดที่ต้องชำระทั้งสิ้น                    ๕,๕๓๕.๐๐ บาท              │
├────────────────────────────────────────────────────────────────────┤
│  ผู้อนุมัติ / Approver (Digitally Signed)                          │
│  ชื่อ-สกุล  : นาย สมชาย วิเชียร                                      │
│  ตำแหน่ง   : หัวหน้าบัญชี Platform                                  │
│  บทบาท    : ACCOUNT_PLATFORM                                       │
│  ลงนามเมื่อ : ๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙                              │
├────────────────────────────────────────────────────────────────────┤
│                              เจ้าหน้าที่การเงิน                    │
│                              นาย สมชาย วิเชียร                       │
│                              Predictive AI Solution Co., Ltd.       │
├────────────────────────────────────────────────────────────────────┤
│ Reference Number TAX-PRD-2026-000001 · Issued 16 พ.ค. 2569 ·       │
│ ระบบ e-Tax Invoice                                                  │
└────────────────────────────────────────────────────────────────────┘
```

Audit-log row (sample payload):

```json
{
  "action": "RECEIPT_AUTO_SIGNED",
  "category": "PAYMENT",
  "severity": "INFO",
  "actorId": "u-somchai-pf",
  "actorRole": "ACCOUNT_PLATFORM",
  "resourceType": "INVOICE",
  "resourceId": "inv-8b34...",
  "metadata": {
    "slipId": "slip-d2c8...",
    "invoiceId": "inv-8b34...",
    "invoiceNumber": "INV-2569-000002",
    "receiptNumber": "TAX-PRD-2026-000001",
    "signerId": "u-somchai-pf",
    "signerRole": "ACCOUNT_PLATFORM",
    "signerName": "นาย สมชาย วิเชียร",
    "signedAt": "2026-05-16T03:31:00.000Z",
    "pdfHash": "b07c...",
    "signatureAlgorithm": "RSA-SHA256",
    "keyNamespace": "rsa:platform-receipt",
    "issuerSide": "PLATFORM"
  }
}
```

---

## 3. Convention summary

| Field                    | DB / API form      | Visible PDF form                    |
|--------------------------|--------------------|-------------------------------------|
| Receipt / DOC number     | ASCII (`RCP-…-1`)  | Thai numerals (`RCP-…-๐๐๐๐๐๑`)     |
| Issue date               | ISO 8601           | `๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙`        |
| Year header              | BE int / CE int    | Thai numerals                       |
| Subtotal / VAT / Total   | float              | Thai numerals + commas + ๒-dec      |
| Payer tax ID (juristic)  | 13 ASCII digits    | `๐-๑-๐๕๕๖-๘๐๔๕-๒` (1-1-4-4-1)       |
| Approver name / role     | ASCII identifiers  | Thai script + role label            |
| Footer reference number  | ASCII              | ASCII (deliberate — for grep)       |

## 4. Cryptographic chain

1. `payment-slip-service.approveSlip(…)` — accountant approves a slip.
2. `receipt-auto-sign-service.signReceiptOnApproval(…)` is invoked fire-and-forget.
3. `invoice-template-service.generateReceiptPdf(invoice, { approver })` renders
   the PDF, embedding the approver block.
4. SHA-256(PDF bytes) → 64-char hex hash.
5. `signature-service.signWithLocalKey(hash, 'rsa:{dtam|platform}-receipt')`
   returns the RSA-SHA256 base64 signature.
6. AuditLog row `RECEIPT_AUTO_SIGNED` is written with payload above.
7. (B16-A future) `Invoice.signatureMetadata` JSON column receives the same
   payload — duplication is intentional: AuditLog is hash-chained and
   immutable, the column is mutable but join-friendly for reconciliation.

## 5. Re-verification

Auditors can re-verify the signature offline:

```sh
# Fetch the PDF
curl -o receipt.pdf https://…/receipts/RCP-DTAM-2569-000001.pdf

# Re-compute the hash
sha256sum receipt.pdf
# → a3f8…   (must match metadata.pdfHash)

# Verify the RSA signature with the published public key
openssl dgst -sha256 -verify dtam-receipt-public.pem \
  -signature <(echo -n "$SIG_BASE64" | base64 -d) receipt.pdf
# → "Verified OK"
```
