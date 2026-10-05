# การแจ้งเตือน: ในแอปเป็นช่องทางเดียว (Business Notifications = In-App Only)

**สถานะ:** active
**เจ้าของ:** platform operator
**เขียนเมื่อ:** 2026-08-19
**ขอบเขต:** การแจ้งเตือนเชิงธุรกิจ (business notifications) เท่านั้น — อีเมลยืนยันตัวตน (MFA-OTP / password-reset) ถูกปลดออกทั้งชุดแล้วเช่นกัน (ดู §3)
**ที่มา:** คำสั่ง operator ที่บันทึกไว้ (2026-08-13, `apps/backend/shared/notification-view.js:16-19`: "ลบโค้ดอีเมลและ SMS ทิ้ง เหลือกล่องข้อความในแอปเป็นช่องทางเดียว") ดำเนินการจริงโดย External-Services Cleanup (2026-08-19, Tasks 1-4, design note 2026-08-19-external-services-cleanup-design)

---

## 1. สิ่งที่เปลี่ยน (what changed)

แถวการแจ้งเตือนในแอป (`Notification` row + กระดิ่งแจ้งเตือน) เป็นช่องทางเดียวที่ระบบ**ส่งจริง**สำหรับ
การแจ้งเตือนเชิงธุรกิจทุกประเภทตอนนี้ — ไม่ใช่แค่ปิดผ่าน config แต่ลบโค้ดฝั่ง dispatch ทิ้งจริง:

- **Path A** (`apps/backend/services/notification-service.js`) — `_sendEmailForNotification` /
  `_sendSmsForNotification` + จุดเรียกใช้ + `EMAIL_MAP` + เกณฑ์ส่ง SMS ระดับ HIGH/URGENT ถูกลบ
  (Task 1) รวมถึง one-off senders สามจุด (คำเชิญเข้า entity, ยืนยันส่งคำขอ, อีเมลแจ้ง SLA-breach ฝั่ง
  ปฏิบัติการ) ที่มีแถวในแอปเขียนอยู่แล้วก่อนหน้านั้นในทุกจุด
- **Path B** (`apps/backend/services/notification-fanout-service.js`) — `CHANNELS`/`ALL_CHANNELS`
  เหลือ `IN_APP` ตัวเดียว, `_dispatchEmail`/`_dispatchSms` ถูกลบ (Task 2); TEMPLATE ที่ไม่มีผู้เรียกใช้จริง
  สามรายการถูกลบตาม (Task 4): `CERTIFICATE_ISSUED`, `BREACH_NOTIFICATION_SUBJECT`, และตัวแปร
  email/SMS ของ `REVISION_REQUESTED` ในไฟล์นี้ (คนละตัวกับ `NotifyType.REVISION_REQUESTED` ในแอปที่ยังใช้งานอยู่)
- **สแตกที่ถูกรื้อทิ้งทั้งหมด** (Task 3): `services/email/` (E2), fanout email/SMS provider+transport (E3/S2),
  `services/sms/` (S1), `scripts/send-test-email.js` — พร้อมลบแถว secrets ที่เกี่ยวข้อง
  (`EMAIL_SMTP_*`, `THAIBULKSMS_*`, `SMS_*`) ออกจาก `config/secrets.js` และ `.env.example` ในคอมมิตเดียวกัน
  เพื่อไม่ให้ production boot validation ค้างรอ env ที่ไม่มีใครใช้แล้ว
- **การตั้งค่าผู้ใช้** (`notification-preferences-service.js`, Task 4) — แนวคิด "ช่องทาง email/sms"
  ถูกถอดออก เหลือ toggle ต่อประเภทการแจ้งเตือนแบบ in-app เท่านั้น (`SUPPORTED_CHANNELS = ['inApp']`)
  ค่าที่เคยบันทึกไว้ก่อนหน้านี้ในรูปแบบเก่า (มี key `email`/`sms`) จะถูก**ทน**ได้ตอนอ่าน — ไม่ทำให้พัง ไม่ทำให้ข้อมูลเสีย
  เพียงแค่ไม่ถูกอ่านค่าออกมาอีกต่อไป — และหน้า UI ตั้งค่าการแจ้งเตือน
  (`apps/web-app/src/components/feature/notification-preferences.tsx`) ตัดคอลัมน์อีเมล/SMS ออกให้ตรงกัน

## 2. Trade-off ที่ operator รับทราบแล้ว: การแจ้งเตือนด่วนไม่ไปถึงผู้ใช้ที่ออฟไลน์

ก่อนหน้านี้อีเมล/SMS ทำหน้าที่เป็น "ช่องทางสำรอง" ที่ดันการแจ้งเตือนออกไปหาผู้ใช้แม้เขาจะไม่ได้เปิดแอปอยู่
— สำคัญที่สุดสำหรับสองกลุ่ม:

- **APPLICATION_EXPIRED-class** — คำขอที่ใกล้หมดอายุ/ถูกยกเลิกอัตโนมัติ
- **SLA-breach classes** — งานที่ค้างเกินกำหนดฝั่งเจ้าหน้าที่ (`PAYMENT_SLIP_SLA_BREACH`, `WORK_ACTIVITY_BREACH` ฯลฯ)

หลังการเปลี่ยนแปลงนี้ ผู้ใช้ที่ไม่ได้เปิดแอป/เว็บอยู่จะ**ไม่ได้รับการแจ้งเตือนกลุ่มนี้จนกว่าจะเข้าระบบเอง**
— ไม่มีอีเมล ไม่มี SMS ดันออกไปอีกแล้ว การสูญเสียความสามารถนี้เป็นสิ่งที่**operator รับทราบและยอมรับแล้ว**
ตามคำสั่งที่ระบุใน §ที่มา ด้านบน ไม่ใช่ผลข้างเคียงที่หลุดจากการตรวจสอบ

**ทางแก้ที่ติดตามไว้ (follow-up, ยังไม่ได้สร้าง):** Web Push notification — เพื่อคืนความสามารถ
"ดันแจ้งเตือนออกไปนอกแอป" โดยไม่ต้องพึ่งอีเมล/SMS หรือ SMTP/THAIBULKSMS provider เดิม ยังไม่มี
task/spec สำหรับงานนี้ ณ วันที่เขียนเอกสารนี้

## 3. อีเมลยืนยันตัวตน (MFA-OTP / password-reset) — ปลดออกแล้วทั้งชุด

`apps/backend/services/email-service.js` (E1) **ถูกลบออกจาก tree แล้ว** (ไม่มีไฟล์นี้อีก, ไม่มี
`nodemailer` เป็น dependency) — ทั้งสองเส้นทางที่เคยส่งอีเมลจริงถูกปลดตามลำดับนี้:

- **Phase 3** (merge `00bb27b8`, 2026-09-15) — เลิกใช้อีเมล MFA-OTP ทั้งชุด ปัจจัยที่สองเหลือ **TOTP
  ตัวเดียว** (`apps/backend/shared/second-factor.js` `hasUsableSecondFactor`); แถวผู้ใช้เดิมที่ยังตั้ง
  `twoFactorMethod = 'EMAIL'` (ก่อน migration `20260915180000_retire_email_second_factor`) ถือว่า
  *ไม่ได้ลงทะเบียน* — ไม่ล็อกผู้ใช้ออก แต่ไม่มีทางท้าทายด้วย EMAIL อีก
- **Phase 4** (merge `b4d7bc06`, 2026-09-16) — ไม่มีระบบลืมรหัสผ่านด้วยตัวเองอีกต่อไป ไม่ว่าทางอีเมลหรือ
  SMS
- **ไม่มีการกู้บัญชี** (มติ operator 2026-09-17 "เราไม่มีการกู้บัญชี", ยืนยันซ้ำ 2026-09-26: รีเซ็ตรหัสผ่าน
  และ 2FA จะไปใช้ของหมอพร้อม) — ถอด token รีเซ็ตที่เจ้าหน้าที่ออกให้ทั้งเส้นด้วย: ไม่มี
  `POST /api/provider/directory/:id/force-password-reset`, ไม่มี `POST /api/auth/health/reset-password/:token`,
  ไม่มี `resetPasswordWithToken` · ผู้ใช้ที่ล็อกอินอยู่ยังเปลี่ยนรหัสผ่านเองได้ (รหัสเดิม + รหัสใหม่)
- **ผู้ดูแลตั้งรหัสผ่านให้บัญชีอื่นไม่ได้** (มติ operator 2026-09-26 "ปิด + เพิ่มเปลี่ยนรหัสของตัวเองให้เจ้าหน้าที่") —
  `PUT/PATCH /api/provider/directory/:id` ตอบ 400 `DIRECTORY_PASSWORD_WRITE_FORBIDDEN` เมื่อมี `password` และแตะได้เฉพาะ
  บัญชีเจ้าหน้าที่ · เจ้าหน้าที่เปลี่ยนรหัสของตัวเองที่ `POST /api/auth/provider/change-password` (รหัสเดิม + รหัสใหม่)
- **ผู้ดูแลล้าง 2FA ของบัญชีอื่นไม่ได้** (มติ operator 2026-09-26 "ถอดทั้งสองประตู" — การกู้ 2FA ไปที่หมอพร้อม) —
  ถอด `POST /api/admin/users/:id/force-reset-mfa` และ `POST /api/provider/directory/:id/disable-2fa` · เจ้าของบัญชีปิด 2FA
  ของตัวเองได้ที่ `DELETE /api/mfa/disable` ด้วยรหัสจากแอปของตัวเอง · กรอกรหัสผ่านปัจจุบันผิด 5 ครั้งตอนเปลี่ยนรหัส
  ล็อกบัญชี 15 นาที (ตัวนับเดียวกับการล็อกอิน)
- **ตั้ง 2FA ใหม่ทับของเดิมต้องมีรหัสปัจจุบัน** — `POST /api/mfa/setup` บนบัญชีที่เปิด 2FA อยู่ต้องแนบรหัส TOTP ปัจจุบัน
  (ไม่มี/ผิด → 401 `MFA_CODE_REQUIRED`) และ 2FA เดิมยังใช้งานจนกว่า `verify-setup` ยืนยันรหัสจาก secret ใหม่ ·
  `verify-setup` ผ่าน limiter เดียวกับ `/disable`, ต้องมาจาก session ที่เริ่ม (403 `MFA_REENROL_SESSION_MISMATCH`),
  ผิด 5 ครั้งลบรายการค้าง (400 `MFA_REENROL_RESTART`) · ย้ายสำเร็จ = session อื่นทั้งหมดออกจากระบบ (session นี้อยู่ต่อ) ·
  รายการค้างถูกลบเมื่อปิด 2FA เปลี่ยนรหัสผ่าน ออกจากระบบ หรือเพิกถอนทุก session

ยืนยันด้วยเทสที่ผ่านบน main: `apps/backend/__tests__/unit/second-factor-is-totp-only.test.js`,
`apps/backend/__tests__/unit/no-self-service-password-reset.test.js`.

## 4. สถานะ production auth horizon

Production auth = **ThaID (BORA) + หมอพร้อม เท่านั้น** — password login (national-ID + รหัสผ่าน) เป็น
วิธีการชั่วคราวจนกว่าเส้นทางนี้ LIVE ครบ; ไม่มีการล็อกอินหรือกู้บัญชีด้วยอีเมลในทุกช่องทางแล้ว
(2FA และ password-reset ปิดไปตาม §3 ด้านบน) อีเมลยังเก็บไว้เป็นข้อมูล/ช่องทางติดต่อ (User.email,
contact fields) — ไม่ถูกใช้เป็นช่องทางยืนยันตัวตนอีก

## 5. รายละเอียดทางเทคนิคเพิ่มเติม

สำหรับหลักฐานเชิงลึก (grep เปล่าผู้เรียก, RED/GREEN ของแต่ละ task, รายการไฟล์ที่ลบ) ดู
evidence directory ที่ commit เข้ามาในรีโปจริง (`design notes*-report.md` ถูก
`.gitignore` กันไว้ — ไม่มีใน tree ที่ checkout ได้ ใช้ evidence ด้านล่างแทน):

- Spec: design note 2026-08-19-external-services-cleanup-design
- Task 1 (Path A in-app only): commit `daee7198`
- Task 2 (fanout dispatcher in-app only + PDPA erasure carrier): commit `11d74b20`,
  evidence `evidence/external-services-cleanup-task2/`
- Task 3 (E2/E3/S1/S2 stacks retired, secrets catalog + env scrubbed): commit `18987d69`,
  evidence `evidence/external-services-cleanup-t3/`
- Task 4 (preferences drop email/sms, dead templates removed): commits `489b8860` + `da7da995`,
  evidence `evidence/external-services-cleanup-t4/`
- Final-fix-1 (this document's correction + actionUrl carrier + copy/comment truth):
  evidence `evidence/external-services-cleanup-final-fix-1/`
- Phase 3 (retire email 2FA + SMTP email service, TOTP-only): merge `00bb27b8` (2026-09-15)
- Phase 4 (retire self-service forgot-password by email/SMS): merge `b4d7bc06` (2026-09-16)
