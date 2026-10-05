# Deep Audit: ระบบยื่นเอกสาร / Application

วันที่: 2026-04-11

## ขอบเขต
- ตรวจ flow ระบบยื่นคำขอฝั่ง health applicant
- ตรวจ front-end, backend, schema และข้อมูลจริงใน PostgreSQL production
- เน้นจุดที่ธุรกิจระบุว่ายังไม่เปลี่ยนจริง: แยกรายจ่าย, process ที่ถูกต้อง, UX/UI, preview, template, quotation/invoice, การปิดเคส, เลขติดตาม tracking, และ branching ของ workflow

## สรุประดับผู้บริหาร
ระบบ application ยังไม่ถูกยกระดับเป็น flow เดียวจากต้นจนจบ แม้จะมีการแก้บางส่วนเรื่อง canonical workflow และ split billing แล้วก็ตาม แต่ยังเหลือรากปัญหาหลักคือมี runtime หลาย dialect ปะปนกันพร้อมกันทั้ง state, route, UI และเอกสารการเงิน

สภาพปัจจุบันไม่ใช่ “ยังไม่ polish” แต่เป็น “โครงสร้างความจริงของระบบยังไม่ถูกรวมศูนย์” จึงทำให้บางหน้าพูดว่าระบบแยกค่าบริการแล้ว แต่บาง route, บาง template, บาง page, และบางข้อมูลจริงในฐานข้อมูลยังใช้ตรรกะคนละรุ่น

## Findings หลัก

### 1. Workflow ของ Application ยังมีหลาย dialect อยู่พร้อมกัน
- schema หลักของ `Application` ใช้ `state` เป็นแกนหลัก แต่ comment ใน schema ยังสะท้อน vocabulary เก่า เช่น `PENDING_PAYMENT_1`, `REVIEWING`, `PENDING_PAYMENT_2`
- production DB ยังมี state ปะปน เช่น `REGISTERED`, `DOC_REVIEW`, `PENDING_AUDIT`, `PENDING_REVIEW`, `UNDER_REVIEW`, `REVISION_REQUESTED`, `SUBMITTED`
- production DB มี `formData.workflowState` ไม่ตรงกับ `state` จำนวน `22` รายการ

หลักฐาน:
- [application.prisma](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/prisma/schema/application.prisma):28
- [quotes.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/finance/quotes.js):274
- [quotes.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/finance/quotes.js):375

ผลกระทบ:
- หน้า tracking/detail/notification และ provider workflow มีโอกาสตีความสถานะไม่ตรงกัน
- การต่อยอด feature ใหม่จะยิ่งสร้าง alias เพิ่มแทนที่จะลด

### 2. การแยกรายจ่ายถูกทำเพียงบางชั้น แต่ยังไม่เป็นความจริงเดียวทั้งระบบ
- schema billing รองรับ `InvoiceLineItem` และ service type แบบแยก phase/component แล้ว
- backend payment/settlement รองรับ split billing ระหว่างรัฐและ platform แล้ว
- แต่ UI หลายจุดยังแสดงผลด้วย constant ตายตัวหรือข้อความรวม
- route bundle ยังคำนวณเป็น `30,000` ต่อ application และ `90,000` ต่อ triple bundle แบบรวม 5,000 + 25,000 เป็นก้อน

หลักฐาน:
- [billing.prisma](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/prisma/schema/billing.prisma):82
- [payment-fees.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/config/payment-fees.js)
- [client-view.tsx](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/web-app/src/app/health/applications/%5Bid%5D/client-view.tsx):26
- [client-view.tsx](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/web-app/src/app/health/applications/%5Bid%5D/client-view.tsx):376
- [client-view.tsx](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/web-app/src/app/health/applications/%5Bid%5D/client-view.tsx):387
- [application-bundles.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/applications/application-bundles.js):18
- [application-bundles.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/applications/application-bundles.js):23

ผลกระทบ:
- ผู้ใช้เห็นยอด/โครงสร้างรายจ่ายไม่ตรงกับ intent ธุรกิจ
- ถ้าจำนวนรูปแบบการปลูกมากกว่า 1 หน้า detail มีโอกาสโชว์ยอดผิด เพราะใช้ constant ไม่ใช่ settlement จริง

### 3. Quote → Invoice → Receipt → Tax Invoice ยังไม่เป็น lifecycle เดียว
- production DB มี invoice `40` ใบ แต่ quote มีเพียง `4` ใบ
- หลาย application มี invoice ครบ 4 ใบ แต่ไม่มี quote เลย
- จึงสรุปได้ว่า flow ปัจจุบันไม่ได้บังคับให้ quote เป็นเอกสารต้นทางทุกเคส

หลักฐานจาก production:
- invoices_total = `40`
- quotes_total = `4`
- applications หลายรายการมี invoice 4 ใบแต่ `quote_count = 0`

ผลกระทบ:
- ธุรกิจที่ต้องการเอกสารการเงินไล่ลำดับแบบตรวจสอบย้อนหลังได้ จะไม่ได้ chain ที่สมบูรณ์
- audit trail ฝั่งการเงินไม่เป็นเส้นเดียว

### 4. `quotes.js` เป็นโค้ดคนละรุ่นกับ schema ปัจจุบัน
- route นี้ยังเขียนสถานะ application เป็น `quote_sent` และ `awaiting_payment`
- route นี้พยายามเขียน `quote.invoiceId` และ `ApplicantNotes`
- แต่ `Quote` schema ปัจจุบันไม่มี field เหล่านี้

หลักฐาน:
- [quotes.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/finance/quotes.js):269
- [quotes.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/finance/quotes.js):274
- [quotes.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/finance/quotes.js):366
- [quotes.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/finance/quotes.js):418
- [billing.prisma](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/prisma/schema/billing.prisma):106

ผลกระทบ:
- route นี้เสี่ยงเป็น dead/unsafe path
- ต่อให้ route บางส่วนยังรันได้ ก็ยังผลัก application เข้า vocabulary ที่ไม่ใช่ canonical

### 5. Preview ปัจจุบันครอบคลุมเอกสารการเงินเพียง Phase 1
- preview route เปิดเฉพาะสถานะก่อน review เท่านั้น
- `ensurePhase1FinancialDocuments()` auto-prepare เอกสารการเงินเฉพาะ phase 1
- หน้า preview แสดงสรุปยอด phase 2 แต่ section เอกสารการเงินที่เปิดให้ใช้งานจริงมีเฉพาะงวดที่ 1

หลักฐาน:
- [preview.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/preview/preview.js):62
- [preview.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/preview/preview.js):87
- [preview-financial-utils.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/preview/preview-financial-utils.js):189
- [preview/client-view.tsx](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/web-app/src/app/health/applications/preview/client-view.tsx):340
- [preview/client-view.tsx](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/web-app/src/app/health/applications/preview/client-view.tsx):393

ผลกระทบ:
- preview ยังไม่ใช่ “official full case preview”
- user เห็น phase 2 แบบ summary แต่ยังไม่ได้เห็น document lifecycle ของ phase 2 ครบ

### 6. Wizard ใหม่ยังมีส่วน mock และยังผูกกับ legacy implementation
- route `/health/applications/new` ยัง import layout/steps จาก `new-legacy`
- payment step ฝั่ง new wizard ใช้ local state + `setTimeout()` เปลี่ยน success ไม่ได้ผูก backend จริง
- มีปุ่ม “ส่งคำขอโดยยังไม่ชำระ” ที่เป็น UI state ไม่ใช่ process ที่ harden แล้ว

หลักฐาน:
- [new/layout.tsx](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/web-app/src/app/health/applications/new/layout.tsx)
- [application-step-page.tsx](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/web-app/src/app/health/applications/_components/application-step-page.tsx)
- [payment-section.tsx](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/web-app/src/app/health/applications/new/sections/payment-section.tsx):26
- [payment-section.tsx](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/web-app/src/app/health/applications/new/sections/payment-section.tsx):31

ผลกระทบ:
- ผู้ใช้สามารถเห็น success-like UI โดยไม่สะท้อนสถานะจริงใน backend
- UX ที่เห็นใน flow ใหม่อาจไม่เท่ากับ process production จริง

### 7. Tracking ยังไม่มี “tracking number ของเคส” แยกจาก application number
- tracking payload และ tracking page ใช้ `applicationNumber` เป็นตัวหลัก
- ไม่พบ `trackingNumber` ระดับ case/application ใน schema application ปัจจุบัน
- คำว่า tracking ในระบบส่วนใหญ่ไปอยู่ฝั่ง lot/batch traceability ไม่ใช่ case lifecycle

หลักฐาน:
- [application-payload-builders.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/helpers/application-payload-builders.js):193
- [tracking/client-view.tsx](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/web-app/src/app/health/applications/tracking/client-view.tsx):203
- [application.prisma](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/prisma/schema/application.prisma)

ผลกระทบ:
- ถ้าธุรกิจต้องการเลขติดตามเฉพาะเคสที่แสดงบนเอกสารทุกใบและใช้ติดตามข้ามหน้าจอ ปัจจุบันยังไม่มี primitive ชัดเจนรองรับ

### 8. Route บางส่วนอ้าง schema คนละรุ่นและน่าจะเสียจริง
- `application-bundles.js` ใช้ `userId`, `bundleType`, `totalFee`, `paymentStatus`, `bundleName`
- แต่ `ApplicationBundle` schema ปัจจุบันมี `bundleNumber`, `healthId`, `status` และ relation เท่านั้น

หลักฐาน:
- [application-bundles.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/routes/api/applications/application-bundles.js):117
- [application.prisma](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/prisma/schema/application.prisma):149

ผลกระทบ:
- route นี้มีความเสี่ยงสูงว่าใช้ไม่ได้จริง หรือใช้ได้ไม่ครบตามที่ไฟล์บอก
- เป็นตัวอย่างของ repo drift ระหว่าง business intent, route layer และ schema

### 9. Template มาตรฐานยังไม่ unified เป็นชุดเดียว
- backend PDF invoice/tax invoice ใช้ template HTML + dynamic split line items
- frontend document component บางตัวมี copy/template ของตัวเอง
- receipt document component ยังผูกกับ phase label แบบ static และ demo value แบบตรงไปตรงมา

หลักฐาน:
- [invoice-template-service.js](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/backend/services/pdf/invoice-template-service.js)
- [quotation-document.tsx](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/web-app/src/features/permit-form/components/documents/quotation-document.tsx)
- [receipt-document.tsx](C:/Users/USER/Documents/GitHub/GACP-Certification-Application/apps/web-app/src/features/permit-form/components/documents/receipt-document.tsx)

ผลกระทบ:
- template semantics กระจายหลายที่
- เสี่ยงให้เอกสารที่ user preview บนเว็บ กับ PDF ที่ออกจริงไม่ตรงกัน

## ข้อมูลจริงจากฐานข้อมูล Production

### Distribution ของ Application.state
- `APPROVED` 15
- `REGISTERED` 10
- `DRAFT` 3
- `DOC_REVIEW` 2
- `PENDING_AUDIT` 1
- `PENDING_REVIEW` 1
- `REJECTED` 1
- `REVISION_REQUESTED` 1
- `SUBMITTED` 1
- `UNDER_REVIEW` 1

### Data Drift
- `state` กับ `status` ตรงกันทุก record ที่ตรวจ
- `formData.workflowState` ไม่ตรงกับ `state` จำนวน `22` records

### Billing Reality
- invoice ทั้งหมด `40`
- quote ทั้งหมด `4`
- invoice service type ที่พบจริง:
  - `PHASE_1_STATE_FEE`
  - `PHASE_1_PLATFORM_FEE`
  - `PHASE_2_STATE_FEE`
  - `PHASE_2_PLATFORM_FEE`

ข้อสรุป:
- ฝั่ง invoice split ถูกใช้จริง
- แต่ quote chain ยังไม่ถูกใช้จริงทั้งระบบ

## Root Cause
ต้นตอไม่ใช่ bug เดี่ยว แต่เป็นการที่ระบบ application โตมาหลายรุ่นพร้อมกัน:
- มี schema ใหม่ แต่ route/handler บางส่วนยังเป็นของรุ่นเก่า
- มี canonical workflow ใหม่ แต่ UI/route บางส่วนยังผลักสถานะเก่า
- มี split billing ใหม่ แต่หลายหน้าจอยังใช้ constant หรือยอดรวมแบบเดิม
- มี preview/payment/tracking/detail แยกกันคนละ contract
- มี `new` route ที่ยังขับด้วย `new-legacy` implementation

## สรุปเชิงสถาปัตยกรรม
ระบบนี้ควรถูกมองว่า “ต้องทำ application domain consolidation” ไม่ใช่แค่ “แก้ label หรือแยกยอดบนหน้า UI”

ถ้าแก้เฉพาะผิวหน้า จะเกิดปัญหาเดิมซ้ำ:
- หน้า A แยกค่าบริการ แต่หน้า B ยังรวม
- route A สร้าง quote ก่อน invoice แต่ route B สร้าง invoice ตรง
- หน้า detail แสดงยอดคงที่ แต่ payment จริงคิดตามจำนวนรูปแบบ
- tracking ใช้เลขคำขอแทนเลขติดตามเคส

## สิ่งที่ควรเป็น Target State
1. `Application.state` เป็น workflow truth เดียว
2. `formData.workflowState` เป็น projection หรือ mirror ที่ sync 100%
3. financial lifecycle เป็น `Quotation -> Invoice -> Receipt -> Tax Invoice` ทุก phase ที่เกี่ยวข้อง
4. split billing แสดงเหมือนกันทุก surface: preview, detail, payment, PDF, admin/provider
5. applicant flow ใช้ entrypoint เดียว ไม่ขับด้วย legacy components แบบเงียบ ๆ
6. tracking ใช้ case tracking primitive ที่กำหนดชัดเจน
7. template เอกสารเป็น canonical document system เดียว ไม่กระจายหลาย contract

## ความพร้อมก่อนลงมือแก้
พร้อมสำหรับการเขียน remediation batch แต่ไม่ควรเริ่มจากปรับ UI ก่อน ควรเริ่มจาก:
1. freeze canonical domain model ของ application + billing + tracking
2. ตัดหรือ quarantine route ที่เป็นคนละรุ่นกับ schema
3. unify data contract ของ preview/detail/payment/tracking
4. แล้วค่อย refactor UI และ template ตาม contract ใหม่
