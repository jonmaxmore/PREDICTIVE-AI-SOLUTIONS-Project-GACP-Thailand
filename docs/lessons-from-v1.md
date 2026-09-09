# บทเรียนจากระบบรุ่นที่ 1

เอกสารประวัติ อ่านครั้งเดียวเพื่อเข้าใจว่าทำไมรุ่นที่ 2 ออกแบบอย่างที่เป็น ชื่อเดิมในเอกสารนี้ห้ามนำไปใช้ในโค้ด DB URL หรือ glossary

## 1. อาการ สาเหตุราก และสิ่งที่รุ่นที่ 2 ทำต่างออกไป

| อาการที่พิสูจน์แล้ว | สาเหตุราก | รุ่นที่ 2 |
|---|---|---|
| "ครบแต่บอกไม่ครบ" ขอเอกสารซ้ำ wizard 11 ขั้นโตแบบต่อเติม | "บังคับ" มีเจ้าของ 3 ที่ (FE config, FE checklist, backend rules) และกฎเอกสาร 3 ชุด mount ซ้อน | `document_requirement_rules` ตารางเดียวมีวันมีผล ทุกหน้าจอและด่านอ่าน lens เดียว `resolveDocumentRequirements` |
| ไฟล์ทับกัน ช่องเดียวเก็บได้ไฟล์เดียวและตัดสินได้คำเดียว (บัตร + ทะเบียนบ้านรวมช่อง) | `unique(application, slot)` และท่ออัปโหลด 2 ท่อต่อกันด้วย alias table | หนึ่งช่อง = หนึ่งเอกสารที่กรมติ๊ก ช่องภาพรองรับหลายไฟล์ ท่อเดียว ไม่มี alias |
| กทล.1 ที่พิมพ์ออกมาเว้นว่างเลขบัตร/เลขทะเบียน | ฟอร์มเขียน key คนละชื่อกับที่ template อ่าน (`idCard` vs `nationalId`) ไม่มี contract กลาง | `packages/contracts` เป็นแหล่งเดียวของทุก key template อ่าน type เดียวกับฟอร์ม |
| หน้าตรวจทาน 2 หน้า "เปิดดู" กลายเป็นดาวน์โหลด | browser-truth ปน server-truth header PDPA ใส่ทุก request | หน้าตรวจทานเดียวอ่านจาก server viewer ในหน้าเป็น subresource |
| โมเดลเงิน 3 แบบซ้อน ตัวเลขเก่า 5,535 ค้างบนปุ่ม อัตราไม่มีวันมีผล งวดที่ 2 ไม่มีใครออกใบ คำขอค้าง | เงินไม่ใช่ข้อมูล จุดเชื่อมเส้นงานกับเงินหลายจุด | โมเดลเดียว `fee_schedules` มีวันมีผล ใบเสนอราคาทั้งสองงวดออกอัตโนมัติที่จุดเชื่อมที่กำหนด |
| ชื่อผิดค้าง (`totalAreaTypes` เก็บจำนวน scope, `dtamFeeAmount` คือราคาเต็ม, 3 คำเรียกเจ้าหน้าที่, role เป็น String) ของที่ retire ยังรัน (`PlantUnit` mint 500 แถวต่อรอบ) | กลัว rename ไม่มี glossary | glossary + lint เป็นเงื่อนไข CI ไม่มีชื่อเดิม |
| 20 สถานะในคอลัมน์ String กระจายหลาย service ออกใบรับรองได้โดยไม่มีหลักฐาน (แก้ทีหลัง) | ไม่มี state machine เดียว | enum เดียว 12 สถานะ + ปลายทาง transition service เดียว evidence gate ตั้งแต่วันแรก |
| test rotate signing key จริง jest อ่าน .env จริง heap 3GB CI ปิด RLS เป็น `SELECT TRUE` | test/prod ไม่แยก ship แบบ "merged แต่ไม่ live" | env แยกชัด CI เขียวเป็นเงื่อนไข merge ไม่สร้างของที่ไม่เปิดใช้ |
| 32 สคริปต์ CI + ratchet + waiver ledger สำหรับทีมคนเดียว | เครื่องมือมากกว่างาน | Biome, Vitest, Playwright, สคริปต์ glossary 1 ตัว |

## 2. ตารางเทียบชื่อเดิม → ชื่อใหม่ (ใช้เพื่อเข้าใจ ไม่ใช้ในโค้ด)

| เดิม | ใหม่ |
|---|---|
| FARMER, `/health/*` | `APPLICANT`, `/applicant/*` |
| provider/reviewer, "auditor" (ตรวจเอกสาร) | `DOCUMENT_REVIEWER` |
| provider/audits onsite, auditor (ตรวจแปลง) | `FIELD_INSPECTOR` |
| provider/scheduler (queue/workload/reassign), coordinator | `DISPATCHER` |
| provider/accounting, receipts, ACCOUNT_DTAM, ACCOUNT_PLATFORM | `PLATFORM_OPERATOR_FINANCE_OFFICER` (บริษัท) / `CERTIFICATION_BODY_FINANCE_OFFICER` (กรม) — ชื่อกลาง `FINANCE_OFFICER` ที่ใช้ใน M0–M2 เลิกใช้ 2026-09-09 (ADR 0004) |
| admin certificates / force-status | `CERTIFICATE_APPROVER` |
| admin, superuser, operator (ในโค้ด) | `PLATFORM_OPERATOR_ADMIN` (บริษัท) / `CERTIFICATION_BODY_ADMIN` (กรม) — ชื่อกลาง `SYSTEM_ADMIN` ที่ใช้ใน M0–M2 เลิกใช้ 2026-09-09 (ADR 0004) |
| Entity, workspace | `Applicant` |
| Organization, tenant | `CertificationBody` |
| Farm, Plot, establishment | `Site`, `LandParcel` |
| PlantUnit (รายต้น) | ยกเลิกถาวร (ความละเอียดจบที่รอบปลูก/แปลง และล็อต) |
| wizard, steps 1-11, documents-step, submit-step, preview | `ApplicationForm` 6 ขั้น + หน้าตรวจทานเดียว |
| requirement_rules, SLOT_ALIAS_GROUPS, document-slots.js | `document_requirement_rules`, `document_slots` (ไม่มี alias) |
| ID_HOUSE_REG | `NATIONAL_ID_COPY` + `HOUSE_REGISTRATION_COPY` |
| COMMUNITY_REG_MEMBERS | `COMMUNITY_ENTERPRISE_REGISTRATION` + `COMMUNITY_MEMBER_LIST` |
| JURISTIC_REG_6M, JURISTIC_AUTHORITY | `JURISTIC_REGISTRATION` + `JURISTIC_DIRECTOR_LIST`, `JURISTIC_AUTHORITY_LETTER` |
| LAND_RIGHTS, LANDLORD_CONSENT, SITE_MAP_COORDS, BUILDING_PLAN_PHOTOS, FIELD_SURROUND_PHOTOS, SITE_PHOTOS | `LAND_RIGHTS_DOCUMENT`, `LANDLORD_CONSENT_LETTER`, `SITE_MAP_WITH_COORDINATES`, `BUILDING_PLAN_AND_PHOTOS`, `FIELD_AND_SURROUNDINGS_PHOTOS`, `PRODUCTION_SITE_PHOTOS` |
| PRODUCTION_UTIL_PLAN, SECURITY_RESIDUE_PLAN | `PRODUCTION_AND_UTILISATION_PLAN`, `SECURITY_MEASURES_PLAN` + `RESIDUE_UTILISATION_PLAN` |
| CONTROLLED_HERB_LICENSE, M1_PT11, license_bt11 | `CONTROLLED_HERB_LICENSE_RESEARCH` / `_EXPORT` / `_COMMERCIAL` |
| REG_FORM (อัปโหลดแบบคำขอเอง) | `KATORLOR1_GENERATED` (ระบบสร้างเสมอ) |
| cultivationMethods, solarSystem, locationType, areaType (เดี่ยว) | `areaTypes` (set) |
| landOwnership RENT/CONSENT/STATE | `landTenure` `RENTED` / `OWNER_PERMITTED` / `STATE_PERMITTED` / `OWNED` |
| certScope PLANTING | `certificationScope` `CULTIVATION` |
| serviceType RENEW, applicantType COMMUNITY_ENT | `requestType` `RENEWAL`, `applicantType` `COMMUNITY_ENTERPRISE` |
| dtamFeeAmount / dtamPayableAmount, platformFeeNet/Vat/Gross | `stateFee`, `serviceFee` (สตางค์), VAT คิดบนทั้งก้อน |
| Quote + Quotation (สองชุด), Invoice, PaymentSlip, CheckoutOrder, BankAccount, DtamRemittanceBatch, journal entries | `Quotation`, `Payment`, `Receipt`, `CreditNote` เท่านั้น (บัญชีเบื้องหลังนอกระบบ) |
| M1/M2, PHASE_1/PHASE_2 | `FeeStage` `DOCUMENT_REVIEW` / `ONSITE_INSPECTION` |
| PENDING_DOC_FEE, DOC_FEE_PAID, DOCUMENT_REVIEW, REVISION_REQUESTED, PENDING_AUDIT_FEE, AUDIT_SCHEDULED, ONSITE_AUDIT, AUDIT_PASSED | `AWAITING_DOCUMENT_REVIEW_FEE`, `SUBMITTED`, `UNDER_DOCUMENT_REVIEW`, `REVISION_REQUESTED`, `AWAITING_INSPECTION_FEE`, `INSPECTION_SCHEDULED`, `UNDER_INSPECTION`, `AWAITING_APPROVAL` |
| CAR (corrective action request), request-more | `RevisionRequest` |
| AuditChecklist, FarmAuditPhoto, audit-onsite | `Inspection`, `InspectionChecklistItem`, `InspectionEvidence` |
| scheduler, cron jobs, worker, bull/ioredis | `Automation` (pg-boss) |
| email/SMS/OTP providers | ไม่มี (การแจ้งเตือนในระบบเท่านั้น) |

## 3. มติของ operator ที่ยกมาใช้ต่อ (พร้อมวันที่)

- 2026-08-13: ค่าคงที่ทางธุรกิจในโค้ด = ของปลอม ต้องเป็นข้อมูลมีวันมีผล
- 2026-08-17: org model แบบ C (คงสองมิติ Applicant/CertificationBody) ไม่มี external service ใช้การแจ้งเตือนในระบบเท่านั้น
- 2026-08-19: production auth = ThaID + หมอพร้อม เท่านั้น
- 2026-08-20: T&T R1-R9 (เมนูปลูกล็อกจนมีใบ QR หลังใบ COA ผูกรุ่นเก็บเกี่ยว ไม่มีรายต้น)
- 2026-08-22: W14 บริษัทเป็นผู้ออกเอกสารเงินรายเดียว
- 2026-08-25: ตั้งชื่อให้ถูก ไม่เก็บชื่อ legacy คลีนของที่ผิดได้ไม่ต้องถาม
- 2026-09-01: ยื่นตามกรมเป๊ะ 7 ข้อ (กทล.1 เป็น spec, wizard 6 ขั้น, หน้าตรวจทานเดียว, officer ตรวจรายช่อง, กัญชาก่อน, PDPA file posture)
- 2026-09-05: VAT เต็มทั้งก้อน ไม่มียกเว้น บริษัทเป็น principal ทางบัญชี
- 2026-09-08: เริ่มรุ่นที่ 2 ตั้งแต่กระดุมเม็ดแรก บทบาท 7 แบบ Stripe Supabase เงินสองงวดอัตโนมัติ T&T เป็น Phase 2 ทันทีหลัง System 1 ขึ้นใช้จริง
