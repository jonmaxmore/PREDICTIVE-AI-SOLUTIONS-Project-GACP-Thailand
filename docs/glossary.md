# Glossary และ naming policy

กติกา: หนึ่งแนวคิด = หนึ่งชื่อ ทุกชั้น (ไทย, อังกฤษ, code, DB, URL) · ไม่มีคำพ้อง · ไม่ย่อคำ · casing ตายตัวต่อชั้น · ไม่ใช้ชื่อจากระบบเดิม (ตารางเทียบอยู่ใน [lessons-from-v1.md](lessons-from-v1.md) เท่านั้น) · ชื่อใหม่ต้องเพิ่มที่นี่ใน PR เดียวกัน · `scripts/check-glossary.ts` ปฏิเสธคำต้องห้าม

## 1. แนวคิดหลัก

| ไทย | ชื่อเดียวในระบบ | ห้ามใช้ |
|---|---|---|
| คำขอรับรอง | `Application` | wizard, filing, request, case (ยกเว้น `CaseAssignment`) |
| ฟอร์มกรอกคำขอหลายขั้น (UI) | `ApplicationForm`, `ApplicationFormStep` | wizard, stepper |
| ผู้ขอรับรอง (นิติฐานะ) | `Applicant` (`applicantType`) | entity, workspace, farmer, tenant |
| สถานที่ปลูก/แปรรูป (กทล.1 ส่วนที่ ๒ ข้อ ๑) | `Site` | farm, plot, field, establishment |
| ที่ดินและเอกสารสิทธิ์ (ข้อ ๒) | `LandParcel` | chanote, deed |
| หน่วยรับรอง (กรม) | `CertificationBody` | organization, tenant, org |
| พืช / กัญชา | `Plant` / `cannabis` (เต็มคำ) | CAN, cnb, herb |
| ช่องเอกสารแนบ | `DocumentSlot` (`slotCode`, กลุ่ม `DocumentSlotGroup`, ขั้นของฟอร์ม `formStep`) | document type, attachment kind, upload key |
| กฎเอกสารบังคับ (มีวันมีผล) | `DocumentRequirementRule` (`requirementLevel`: `REQUIRED`, `OPTIONAL` · กลุ่มทางเลือก `alternativeGroupCode` · code ขึ้นต้น `RULE_`) | requirement rule, doc rule, mandatory flag |
| สถานะที่ผู้ยื่นแจ้งสำหรับช่องใบอนุญาต | `LicenseDeclarationStatus`: `HAVE`, `APPLIED`, `NONE` | license state, pending flag |
| หัวข้อย่อยที่เจ้าหน้าที่ติ๊กใน SOP | `SopSubItemCode` (11 หัวข้อ) | sop section, checklist item (สำหรับ SOP) |
| ฐานคิดค่าธรรมเนียม | `FeeBasis`: `PER_CULTIVATION_FORMAT`, `PER_APPLICATION` (`FeeSchedule.code` ขึ้นต้น `FEE_`) | multiplier, unit price |
| หมวดรายการตรวจ ณ แปลง | `InspectionChecklistCategory` (14 หมวด) · `InspectionChecklistItem.code` ขึ้นต้น `CHECK_` | audit section |
| อายุใบรับรอง (มีวันมีผล) | `CertificateTerm` (`validityMonths`, code ขึ้นต้น `TERM_`) | validity config, expiry days |
| วันหยุดราชการ / วันทำการ | `PublicHoliday` · `addBusinessDays()` · วันที่ปฏิทินเป็น `CalendarDate` (`YYYY-MM-DD`) | holiday table, working day |
| ชุดข้อมูลกฎทั้งหมดที่ seed | `LawData` (`seedLawData()`, `packages/db/seeds/`) | fixtures, constants, config |
| ใบอนุญาตสมุนไพรควบคุม | `ControlledHerbLicense` (`_RESEARCH`, `_EXPORT`, `_COMMERCIAL`) | ภท. เป็นชื่อแบบคำขอ ไม่ใช่ชื่อช่อง |
| แบบ กทล.1 ที่ระบบประกอบ | `Katorlor1Form`, `Katorlor1Renderer` | reg form, template |
| การตรวจเอกสารรายช่อง | `DocumentReview` (`verdict`: `ACCEPTED`, `MORE_REQUESTED`) | document check, audit |
| การขอเอกสารเพิ่ม | `RevisionRequest` | CAR, request-more |
| การมอบเคสให้ผู้ตรวจ | `CaseAssignment` | job, task, ticket, work item |
| การตรวจ ณ แปลง | `Inspection`, `InspectionChecklistItem`, `InspectionEvidence`, `InspectionReport` | audit, onsite audit, assessment |
| ใบรับรอง | `Certificate` (`CertificateVerification` = หน้า verify) | cert, license (สำหรับใบรับรอง) |
| ตารางอัตรา (มีวันมีผล) | `FeeSchedule` | price list, rates, constants |
| งวดค่าธรรมเนียม | `FeeStage`: `DOCUMENT_REVIEW`, `ONSITE_INSPECTION` | installment, phase 1/2, M1/M2 |
| ค่าธรรมเนียม (ส่วนของกรม) / ค่าบริการ (ส่วนของบริษัท) | `stateFee` / `serviceFee` | platform fee, dtam fee, markup |
| ใบเสนอราคา / การชำระเงิน / ใบเสร็จ / ใบลดหนี้ | `Quotation` / `Payment` / `Receipt` / `CreditNote` | quote, invoice, checkout (เดี่ยว), settlement, slip |
| ผู้ให้บริการรับชำระ | `PaymentGateway` (`StripeGateway`, `MockGateway`) | PSP, provider, processor |
| ระบบทำงานอัตโนมัติ (ไม่มีคน) | `Automation`, `AutomationJob` | scheduler, cron, worker, coordinator, dispatcher (สำหรับระบบ) |
| การแจ้งเตือนในระบบ | `Notification` | alert, message |
| บันทึกตรวจสอบย้อนหลัง / บันทึกการเข้าถึงเอกสาร | `AuditLog` / `DocumentAccessLog` | audit trail, history |
| สถานะคำขอ | `ApplicationStatus` | workflow state, stage, step |
| ลักษณะพื้นที่ | `areaTypes` (set): `OUTDOOR`, `INDOOR`, `GREENHOUSE`, `OTHER` | cultivation method, solar system, location type |
| การถือครองที่ดิน | `landTenure`: `OWNED`, `STATE_PERMITTED`, `RENTED`, `OWNER_PERMITTED` | ownership |
| ประเภทคำขอ | `requestType`: `NEW`, `RENEWAL`, `REPLACEMENT` | service type, RENEW |
| ขอบข่ายการรับรอง | `certificationScope`: `CULTIVATION`, `PROCESSING` | cert scope, PLANTING |
| วัตถุประสงค์ | `purposes` (set): `MEDICAL`, `EXPORT` | RESEARCH, COMMERCIAL |
| ไฟล์ที่แนบเข้าช่องเอกสาร (หนึ่งช่องรับได้หลายไฟล์ ลบแล้วคงแถวเป็นประวัติ) | `ApplicationDocument` (`fileKey`, `sha256`, `issuedOn`, `removedAt`) | attachment, upload record, file entry |
| สถานะใบอนุญาตที่ผู้ยื่นแจ้งต่อช่อง และผลตัดสินของช่อง | `LicenseStatusDeclaration` (`LicenseDeclarationStatus`: `HAVE` `APPLIED` `NONE`) · `LicenseSlotState` (`ATTACHED` `PENDING_DECISION` `NOT_FILED` `UNDECLARED`) | license flag, permit status |
| ที่เก็บไฟล์ (สลับ adapter ได้) | `FileStorage` (`LocalDiskStorage`, `S3CompatibleStorage`, `GACP_STORAGE_DRIVER`) | bucket service, uploader, blob store |
| เหตุที่ปฏิเสธไฟล์ที่อัปโหลด (ตรวจเนื้อไฟล์จริง) | `UploadRejectionCode` (`validateUpload`, `detectFileKind`) | upload error, mime error |
| ฟอร์มบันทึกร่างอัตโนมัติ | `AutosaveForm` (Server Action ต่อขั้น `saveStep1..3`, `savePurposes`, `saveLicenseDeclaration`) | draft saver, wizard form |

## 2. บทบาท (`UserRole`)

| ค่า | ไทย | ทำอะไร |
|---|---|---|
| `APPLICANT` | ผู้ขอรับรอง | ยื่นคำขอ แนบเอกสาร ยอมรับใบเสนอราคา ชำระ แก้ตามที่ขอเพิ่ม |
| `FINANCE_OFFICER` | เจ้าหน้าที่การเงิน | ดูยอด กระทบยอด Stripe ออกใบเสร็จซ้ำ คืนเงิน/ใบลดหนี้ (ไม่อยู่ใน process) |
| `DISPATCHER` | ผู้จัดคิวงาน | มอบ/โยกเคสให้ผู้ตรวจ ดูภาระงานและ SLA |
| `DOCUMENT_REVIEWER` | ผู้ตรวจเอกสาร | รับเคส ตรวจรายช่อง ขอเอกสารเพิ่ม รับ/ไม่รับคำขอ |
| `FIELD_INSPECTOR` | ผู้ตรวจประเมินแปลง | นัดวัน ลงพื้นที่ checklist + หลักฐาน ส่งรายงาน (Phase 2: ติดตาม T&T) |
| `CERTIFICATE_APPROVER` | ผู้อนุมัติออกใบรับรอง | อนุมัติ/ไม่อนุมัติ/ส่งตรวจซ้ำ เพิกถอน (Phase 2: อนุมัติ recall) |
| `SYSTEM_ADMIN` | ผู้ดูแลระบบ | ผู้ใช้/บทบาท กติกาเอกสาร ตารางค่าธรรมเนียม checklist วันทำการ (ห้ามแตะเงินและตัดสินคำขอ) |

`SYSTEM` เป็น actor kind ใน transition/audit ไม่ใช่บทบาท · หนึ่งคนถือหลายบทบาทได้ผ่าน `staff_role_assignments` ไม่มีบทบาทผสม

## 3. สถานะคำขอ (`ApplicationStatus`)

`DRAFT` → `AWAITING_DOCUMENT_REVIEW_FEE` → `SUBMITTED` → `UNDER_DOCUMENT_REVIEW` ⇄ `REVISION_REQUESTED` → `DOCUMENTS_ACCEPTED` → `AWAITING_INSPECTION_FEE` → `AWAITING_INSPECTION` → `INSPECTION_SCHEDULED` → `UNDER_INSPECTION` → `AWAITING_APPROVAL` → `CERTIFIED`

ปลายทาง: `REJECTED`, `NOT_CERTIFIED`, `WITHDRAWN`, `REVOKED`, `EXPIRED`

## 4. ช่องเอกสาร (`slotCode`)

ตัวตน: `NATIONAL_ID_COPY`, `HOUSE_REGISTRATION_COPY` · คุณสมบัติ: `COMMUNITY_ENTERPRISE_REGISTRATION`, `COMMUNITY_MEMBER_LIST`, `COMMUNITY_ASSIGNMENT_LETTER`, `PRODUCER_SUPERVISION_LETTER`, `JURISTIC_REGISTRATION`, `JURISTIC_DIRECTOR_LIST`, `JURISTIC_AUTHORITY_LETTER` · มอบอำนาจ: `POWER_OF_ATTORNEY`, `POA_GRANTOR_ID_COPY` · ที่ดิน/สถานที่: `LAND_RIGHTS_DOCUMENT`, `LANDLORD_CONSENT_LETTER`, `SITE_MAP_WITH_COORDINATES`, `BUILDING_PLAN_AND_PHOTOS`, `FIELD_AND_SURROUNDINGS_PHOTOS`, `PRODUCTION_SITE_PHOTOS` · แผนงาน: `PRODUCTION_AND_UTILISATION_PLAN`, `SECURITY_MEASURES_PLAN`, `RESIDUE_UTILISATION_PLAN`, `SOP_MANUAL` · ใบอนุญาต: `CONTROLLED_HERB_LICENSE_RESEARCH`, `CONTROLLED_HERB_LICENSE_EXPORT`, `CONTROLLED_HERB_LICENSE_COMMERCIAL` · ต่ออายุ: `PREVIOUS_CERTIFICATE_ORIGINAL`, `RENEWAL_CULTIVATION_PLAN`, `RENEWAL_UTILISATION_PLAN`, `OPERATION_SUMMARY_REPORT` · ใบแทน: `POLICE_REPORT`, `DAMAGED_CERTIFICATE` · ไม่บังคับ: `WATER_TEST_RESULT`, `SOIL_TEST_RESULT`, `LAB_CERTIFICATE`, `ADDITIONAL_DOCUMENTS` · ระบบสร้าง: `KATORLOR1_GENERATED`

## 5. Casing ต่อชั้น

| ชั้น | กติกา | ตัวอย่าง |
|---|---|---|
| ตัวแปร ฟังก์ชัน property JSON field | `camelCase` | `applicantType`, `resolveDocumentRequirements()` |
| Type, class, React component | `PascalCase` | `DocumentSlot`, `ApplicationFormStep` |
| ค่าในชุดปิด (role, status, slot code, error code) | `UPPER_SNAKE_CASE` ค่า = ชื่อ ประกาศเป็น `as const` + `z.enum` + Postgres enum | `MORE_REQUESTED` |
| ค่าคงที่เชิงเทคนิค | `UPPER_SNAKE_CASE` (business value อยู่ใน DB ไม่ใช่ที่นี่) | `MAX_UPLOAD_BYTES` |
| ไฟล์และโฟลเดอร์ | `kebab-case` | `application-form-step.tsx` |
| ตาราง คอลัมน์ Postgres | `snake_case` ตารางพหูพจน์ FK `<singular>_id` (Prisma `@@map`/`@map`) | `document_reviews.application_id` |
| Route handler path | `kebab-case` พหูพจน์ | `/api/applications/{id}/document-requirements` |
| Env var | `GACP_` + `UPPER_SNAKE_CASE` | `GACP_DATABASE_URL` |
| UI route | `kebab-case` ตามบทบาท | `/applicant/...`, `/document-reviewer/...` |
| Git | `type/short-kebab` และ Conventional Commits | `feat/application-form-step-3` |
| เงิน เวลา | เงินเป็นสตางค์จำนวนเต็ม (`amountSatang`) เวลา UTC ISO 8601 ใน DB/API พ.ศ. และเลขไทยเฉพาะ formatter | `netAmountSatang: 1177000` |
| ข้อความไทย | อยู่ใน catalog `messages/th.ts` และคอลัมน์ `*_th` เท่านั้น ไม่อยู่ใน identifier | |

## 6. คำต้องห้ามใน identifier / path / schema

`wizard` `stepper` `farmer` `entity` `tenant` `organization` `auditor` `superuser` `chanote` `invoice` `slip` `scheduler` `cron` `coordinator` `worker` `CAN` · บรรทัดที่จำเป็นต้องมีคำเหล่านี้ (เช่น ชื่อ API ของ Stripe) ใส่คอมเมนต์ `glossary-allow` ท้ายบรรทัดพร้อมเหตุผล

## 7. ข้อความไทยบนหน้าจอ

ใช้ "คุณ" (ท่าน เฉพาะข้อความกฎหมาย/PDPA) · ไม่มี em dash ในประโยคไทย · เว้นวรรคก่อน ๆ และรอยต่อไทย/ละติน · สะกด "อัปโหลด" · ไม่โชว์ raw enum · ทุกการปฏิเสธบอกสาเหตุและขั้นต่อไป · วันที่ พ.ศ. ผ่าน formatter เท่านั้น · ห้าม `tracking-*`, `uppercase`, `font-black` กับข้อความไทย
