---
artifact: financial-document-design-spec
version: 1.0
date: 2026-05-15
status: active (Tier 12)
audience: Frontend developers, UX designers, Finance, Compliance, DTAM
authoritative-references:
  - ประมวลรัษฎากร ม.86/4 (ใบกำกับภาษีเต็มรูป)
  - ประมวลรัษฎากร ม.105 (ใบรับ / receipt)
  - กฎกระทรวงการคลังเรื่องการรับเงินรายได้แผ่นดิน
  - พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ.2562 (PDPA)
---

# Financial Document Design Specification

## 1. Scope

ระบบ GACP ออกเอกสารทางการเงิน **2 ประเภทต่อ Phase** ดังนี้:

| ประเภท | ผู้ออก | กฎหมายอ้างอิง | ตัวอย่างยอด (Phase 1, 1 scope) |
|---|---|---|---|
| **ใบเสร็จเงินรายได้แผ่นดิน** | DTAM (กรมการแพทย์แผนไทยฯ) | กฎกระทรวงการคลัง | 5,000 บาท (NO VAT) |
| **ใบกำกับภาษีเต็มรูป / ใบเสร็จรับเงิน** | บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด (สำนักงานใหญ่) | ป.รัษฎากร ม.86/4 + ม.105 | 535 บาท (500 + VAT 35) |

**ห้ามรวม 2 ประเภทใน 1 เอกสาร** — เพราะรัฐและบริษัทเป็นนิติบุคคลคนละราย, รายได้รัฐยกเว้น VAT, บริษัทคิด VAT 7%

## 2. ใบเสร็จเงินรายได้แผ่นดิน (DTAM)

### 2.1 Required Fields (มาตรฐานกฎกระทรวงการคลัง)

| Field | Source | หมายเหตุ |
|---|---|---|
| ชื่อหน่วยงานราชการผู้รับเงิน | `issuer.legalNameTH` | "กรมการแพทย์แผนไทยและการแพทย์ทางเลือก" |
| ที่อยู่หน่วยงาน | `issuer.addressLine1` + `addressLine2` | รออข้อมูลจาก Finance/DTAM |
| เลขที่ใบเสร็จ | `invoice.receiptNumber` | running number ต่อปี พ.ศ. |
| วันที่ออก | `invoice.receiptIssuedAt` | รูปแบบ พ.ศ. (`๒๕๖๙`) |
| ผู้ชำระเงิน (ชื่อ) | `payer.displayName` | ตามประเภทใน §4 |
| รายการ | `items[]` | "ค่าธรรมเนียมรัฐ ขั้นที่ 1 (ตรวจเอกสาร)" |
| จำนวนเงิน | `totals.totalAmount` | บาท + อักษรไทย |
| ผู้รับเงิน (ลายเซ็น) | manual | เจ้าหน้าที่การเงินกรมฯ |

### 2.2 NOT allowed in DTAM receipt

- ❌ คำว่า "ใบกำกับภาษี" (เพราะรัฐไม่อยู่ในระบบ VAT)
- ❌ คอลัมน์ VAT
- ❌ "รวมภาษีมูลค่าเพิ่ม" / "before VAT" / "after VAT"
- ❌ ตัวเลข VAT 7%

### 2.3 Visual identity

- **Header**: ตราครุฑ + ชื่อกระทรวงสาธารณสุข + ชื่อกรมฯ
- **Color**: ใช้สีเขียวกรมฯ `#1a5c38` หรือสีรัฐมาตรฐาน
- **Typography**: Thai Sarabun New / Sarabun (Thai Government Standard Font)
- **Layout**: A4 portrait, margin 25mm

## 3. ใบกำกับภาษีเต็มรูป / ใบเสร็จรับเงิน (Platform)

### 3.1 Required Fields (ม.86/4 แห่ง ป.รัษฎากร)

ตาม **ม.86/4 (1)-(8)** ใบกำกับภาษีเต็มรูปต้องประกอบด้วย:

| (ม.) | Field | Source | หมายเหตุ |
|---|---|---|---|
| (1) | คำว่า **"ใบกำกับภาษี"** | static | ต้องชัดเจน ห้ามใช้คำอื่น |
| (1) | **"(สำนักงานใหญ่)"** หรือ **"(สาขาที่...)"** | `issuer.legalNameTH` suffix | บังคับ — DTAM ตรวจ VAT registration |
| (2) | ชื่อ + ที่อยู่ของผู้ขาย (Platform) | `issuer.legalNameTH` + address | "บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด (สำนักงานใหญ่)" |
| (2) | เลขประจำตัวผู้เสียภาษีอากร 13 หลัก | `issuer.taxId` | `0105568045932` |
| (3) | ชื่อ + ที่อยู่ของผู้ซื้อ | `payer.displayName` | |
| (3) | เลขประจำตัวผู้เสียภาษีของผู้ซื้อ (เฉพาะนิติบุคคล) | `payer.taxId` | บังคับ เฉพาะ JURISTIC |
| (4) | เลขที่ + ลำดับใบกำกับภาษี | `invoice.invoiceNumber` | running number |
| (5) | วันที่ออก | `invoice.createdAt` | พ.ศ. |
| (6) | ชื่อ ชนิด ประเภท ปริมาณ มูลค่า ของสินค้า/บริการ | `items[]` | |
| (7) | จำนวนภาษีมูลค่าเพิ่ม | `totals.vat` | แยกจากราคาสินค้า/บริการ |
| (8) | "ข้อความอื่นที่อธิบดีกำหนด" — เช่น "เอกสารฉบับนี้เป็น..." | static | |

### 3.2 Additional fields (good practice)

- **เลขทะเบียนนิติบุคคล** ของ Platform — ใช้เลขเดียวกับ taxId (`0105568045932`) แต่ระบุชื่อ field ทั้งสองให้ผู้ตรวจ audit เข้าใจ
- **QR code** ของ payment reference สำหรับ verification
- **e-Tax Invoice marker** (`TAX INVOICE / e-Tax`) — แสดงว่าเป็น electronic invoice ที่จะส่งสรรพากร

### 3.3 NOT allowed in Platform tax invoice

- ❌ DTAM tax ID หรือชื่อหน่วยงานราชการ (เพราะคนละ legal entity)
- ❌ ออกในนาม DTAM แล้วคิด VAT (ผิดกฎหมาย — รัฐยกเว้น VAT)
- ❌ ใส่เลขประจำตัวประชาชน 13 หลัก ของผู้ซื้อบุคคลธรรมดา (ผิด PDPA)
- ❌ "Withholding Tax 3%" คอลัมน์ — ไม่ใช่หน้าที่ของ Platform (ผู้จ่ายจัดการเอง)

## 4. Payer Display Rules (PDPA + กฎหมายภาษี)

| `payer.entityType` | displayName | taxId (visible?) | หมายเหตุ |
|---|---|---|---|
| `JURISTIC` (นิติบุคคล) | `companyName` | ✅ **บังคับแสดง** | ตาม ม.86/4 (3) |
| `INDIVIDUAL` (บุคคลธรรมดา) | `firstName + lastName` | ❌ **ห้ามแสดง** | PDPA + ม.86/4 ไม่บังคับ |
| `COMMUNITY_ENTERPRISE` (วิสาหกิจชุมชน) | `companyName` ถ้ามี ไม่งั้น personal name | ❌ ไม่มี | จดทะเบียนแยก |
| `UNKNOWN` | `"ไม่ระบุ"` placeholder | — | สำหรับ QA spot ใน UAT |

## 5. Numbering Scheme

### 5.1 ใบเสร็จเงินรายได้แผ่นดิน (DTAM)
**รูปแบบ:** `RCP-DTAM-{พศ}-{seq}` เช่น `RCP-DTAM-2569-000123`
- พ.ศ. 4 หลัก
- Running number per fiscal year (เริ่มใหม่ 1 ต.ค.)
- Padded 6 digits

### 5.2 ใบกำกับภาษี (Platform)
**รูปแบบ:** `TAX-PRD-{ปีค.ศ.}-{seq}` เช่น `TAX-PRD-2026-000123`
- ค.ศ. 4 หลัก (สรรพากรใช้)
- Running number per calendar year (เริ่มใหม่ 1 ม.ค.)
- Padded 6 digits

### 5.3 ใบเสร็จรับเงิน Platform (ม.105)
**รูปแบบ:** `RCP-PRD-{ปีค.ศ.}-{seq}` เช่น `RCP-PRD-2026-000123`
- เลขแยกจาก tax invoice (ม.86/4 และ ม.105 อนุญาตให้ใบเดียวกัน แต่เลขต้องเดียวกันถ้ารวม)

## 6. Retention Policy (ตามกฎหมายภาษี)

| Document | Retention | Source |
|---|---|---|
| ใบกำกับภาษี (TAX_INVOICE) | **7 ปี** จากวันที่ออก | ป.รัษฎากร ม.87/3 |
| ใบเสร็จเงินรายได้แผ่นดิน | **10 ปี** | ระเบียบราชการ |
| ใบเสร็จรับเงิน | **5 ปี** | ป.รัษฎากร ม.105 |

Invoice schema (Tier 9): `retainUntil DateTime @default(dbgenerated("NOW() + INTERVAL '7 years'"))` ตรงกับ Platform tax invoice (7 ปี)

## 7. Security & Anti-fraud

- **HTML escape ทุก template variable** — XSS prevention (มีอยู่แล้วใน `pdf-generator.service.js` `escapeHtml`)
- **Watermark "COPY"** ถ้าออกใบที่ 2 (สำเนา)
- **QR code** ของ payment reference สำหรับ verification
- **Cryptographic signature** ใน metadata ของ PDF (deferred to e-Tax integration)

## 8. PDF Technical Specs

- **Format**: A4 (210mm × 297mm) portrait
- **Margins**: 25mm top/right/bottom/left (tax invoice), 20mm (state receipt)
- **Font**: Sarabun (Thai government standard) — bundled or via Google Fonts
- **Color profile**: sRGB (web-safe, print-compatible)
- **PDF version**: 1.7 minimum (e-Tax compatible)
- **File naming**: `{documentNumber}.pdf` (e.g. `TAX-PRD-2026-000123.pdf`)

## 9. Accessibility

- **Tagged PDF** (Puppeteer หรือ html-to-pdf with tag support) — ไม่บังคับสำหรับ Thai law แต่ best practice
- **Text-selectable** — สำหรับการ search + copy ใน Adobe Reader
- **Print contrast** — ratio 4.5:1 minimum สำหรับเนื้อหา

## 10. Field Mapping — Builder → Template

`invoice-document-builder.js` (Tier 11) returns structured data ที่ map ไปยัง template variables:

| Template `{{VAR}}` | Builder path |
|---|---|
| `{{ISSUER_NAME_TH}}` | `doc.issuer.legalNameTH` |
| `{{ISSUER_NAME_EN}}` | `doc.issuer.legalNameEN` |
| `{{ISSUER_TAX_ID}}` | `doc.issuer.taxId` |
| `{{ISSUER_BRANCH}}` | "(สำนักงานใหญ่)" หรือ extract จาก legalNameTH |
| `{{ISSUER_ADDRESS_LINE1}}` | `doc.issuer.addressLine1` |
| `{{ISSUER_ADDRESS_LINE2}}` | `doc.issuer.addressLine2` |
| `{{PAYER_NAME}}` | `doc.payer.displayName` |
| `{{PAYER_TAX_ID}}` | `doc.payer.taxId` หรือ `'-'` |
| `{{DOC_NUMBER}}` | `doc.invoice.invoiceNumber` |
| `{{ISSUE_DATE}}` | `doc.invoice.issuedAt` (formatted) |
| `{{TOTAL_AMOUNT_TEXT}}` | `numberToThaiText(doc.totals.totalAmount)` |
| `{{VAT_AMOUNT}}` | `doc.totals.vatText` |
| `{{TOTAL_AMOUNT}}` | `doc.totals.totalAmountText` |
| `{{LEGAL_NOTE}}` | `doc.compliance.legalNote` |

## 11. Anti-patterns (DO NOT do)

| Anti-pattern | ผลที่ตามมา | ทางออก |
|---|---|---|
| Hardcoded tax ID ใน HTML | ผิด เมื่อ legal entity เปลี่ยน + audit fail | ใช้ template variable + config |
| ออกใบกำกับภาษีในนาม DTAM | ผิดกฎหมาย — รัฐยกเว้น VAT | แยก template DTAM (receipt) vs Platform (tax invoice) |
| ใส่เลขประจำตัวประชาชนผู้ซื้อบุคคลธรรมดา | ผิด PDPA | ทำตาม §4 — INDIVIDUAL ไม่แสดง taxId |
| รวม Phase 1 + Phase 2 ใน 1 ใบ | ผิด workflow (จ่ายคนละเวลา + ใบเสร็จคนละช่วง) | แยกใบต่อ Phase |
| ใช้ค.ศ. ในใบรัฐ (DTAM) | ผิดมาตรฐานราชการ | ใช้พ.ศ. ใน DTAM receipt |
| ใช้พ.ศ. ในใบกำกับภาษี | สรรพากรอาจไม่รับ | ใช้ค.ศ. ใน Platform tax invoice |

## 12. Change Log

| Version | Date | Changes |
|---|---|---|
| 1.0 | 2026-05-15 (Tier 12) | Initial spec — DTAM vs Platform separation, ม.86/4 checklist, PDPA payer rules, numbering scheme, retention policy |
