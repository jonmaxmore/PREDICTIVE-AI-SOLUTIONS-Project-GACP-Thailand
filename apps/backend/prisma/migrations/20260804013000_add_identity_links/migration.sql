-- AUTH-01-A EXPAND — identity_links: ย้าย "ตัวตนที่ใช้ล็อกอิน" ออกจากคอลัมน์ของ users
-- (evidence/AUTH-01/plan.md; contract การถอดอยู่ที่
--  evidence/AUTH-01/A/contract-cid-demotion.md)
--
-- ปัญหาที่ตารางนี้แก้ ไม่ใช่ "ยังไม่มีที่เก็บ subject ของ IdP" แต่คือรูปทรงของ
-- users เองบังคับให้คนหนึ่งคนมีตัวตนได้ช่องทางเดียวตลอดชีพ:
--
--   users_single_identity_ck      CHECK (NOT ("healthId" IS NOT NULL
--                                             AND "providerId" IS NOT NULL))
--     — prisma/migrations/20260207120000_identity_guardrails/migration.sql:17
--   users_auth_type_identity_ck   ผูก authType กับคอลัมน์ identity ที่ต้องมี/ต้องว่าง
--     — prisma/migrations/20260207133000_auth_type_identity_guardrails/migration.sql:54
--
-- สอง constraint นั้นถูกต้องสำหรับสิ่งที่มันคุ้ม (แถว users หนึ่งแถวถือเลขบัตร
-- ประชาชนได้ชุดเดียว) และ migration นี้ **ไม่แตะทั้งคู่แม้แต่ตัวอักษรเดียว**
-- (Law 3.10 EXPAND-only) — ความสัมพันธ์ user↔IdP ถูกย้ายออกมาเป็นตารางลูกแทน
-- ข้อจำกัด one-identity-per-row จึงหมดผลกับความสัมพันธ์โดยไม่ต้องแก้ constraint
-- เดิม และเส้น login เดิม (services/prisma-auth-service.js:308-315) ยังทำงานเหมือน
-- เดิมทุกประการหลัง migration นี้ — CONTRACT ค่อยถอดใน PR แยกหลัง drain probe ผ่าน
--
-- CHECK ไม่ใช่ PG enum: เหตุผลเดียวกับ User.role (prisma/schema/auth.prisma:117-120)
-- — PG enum ถอดค่าออกไม่ได้ถ้าไม่ swap type ทั้งชนิด ทำให้การเลิกรองรับ provider
-- สักตัวในอนาคตกลายเป็น migration ที่ rewrite ทั้งตาราง ส่วน CHECK แก้ด้วย
-- ALTER ... DROP/ADD CONSTRAINT ธรรมดา
--
-- vocabulary ของ provider ที่นี่ (local|healthid|providerid|thaid) **แคบกว่า**
-- PROVIDER_KEYS ใน config/auth-providers.js:23 โดยเจตนา: 'mock' อยู่ใน registry
-- ของ config เพราะเป็น adapter สำหรับ non-production เท่านั้น (บังคับที่
-- config/auth-providers.js:115-117) และไม่มีสิทธิ์ทิ้ง identity ค้างไว้ในฐาน
-- ข้อมูลจริง — ฐานข้อมูลจึงปฏิเสธมันตั้งแต่ชั้น CHECK
--
-- ═══ subject ═══
-- `subject` คือค่า **opaque** ที่ IdP คืนมา — ห้าม parse ห้ามตีความ ห้ามแยกส่วน
-- ห้ามเทียบกับคอลัมน์อื่น และ **ห้ามเก็บเลขบัตรประชาชน (CID) หรือ pid แบบ
-- plaintext ลงคอลัมน์นี้เด็ดขาด** คอลัมน์นี้ไม่ได้ถูกปฏิบัติเป็น PII ระดับเลขบัตร
-- (ไม่มี encryption-at-rest, ไม่มี masking ตอน log แบบ maskThaiId) การหย่อน CID
-- ลงมาคือการทำให้ข้อมูลชั้นสูงสุดรั่วออกมาอยู่ในชั้นที่ไม่มีใครเฝ้า
--
-- ต่อเนื่องกัน: MOPH `provider_id` (เลขใบประกอบวิชาชีพ) กับ users."providerId"
-- (เลขบัตรประชาชนของเจ้าหน้าที่) เป็นคนละของกัน **ห้าม map เข้าหากันเด็ดขาด**
-- (คำสั่ง operator) — ข้อห้ามนี้มี grep-pin คอยจับอยู่ที่
-- __tests__/unit/identity-provider-naming-collision.test.js แต่ **pin นั้นไม่ใช่
-- การบังคับที่ครบถ้วน**: มันเห็นเฉพาะการอ่าน provider_id กับการเขียน providerId*
-- ที่อยู่ในไฟล์เดียวกันและห่างกันไม่เกิน 15 บรรทัด — dataflow ข้ามไฟล์ / ข้ามฟังก์ชัน
-- ลอดผ่านได้ (พิสูจน์ไว้ที่ evidence/AUTH-01/A/red-a3-escapes.txt หัวข้อ MUT-3)
-- ด่านที่เหลือจึงเป็น code review บน PR ที่ปลดธง D-MANUAL-HASHCID และ auditor
--
-- ═══ ยังไม่มีโค้ดใดเขียน row ของ provider จริง ═══
-- migration นี้เขียนเฉพาะ provider='local' (backfill ข้างล่าง) เท่านั้น
-- เส้น account-linking ของ IdP จริงยังติดธง **D-MANUAL-HASHCID** ที่ operator ยัง
-- ไม่ปลด (evidence/AUTH-01/plan.md:3) — โค้ดแอปห้ามสร้าง/แก้ row ของ
-- healthid|providerid|thaid จนกว่าธงจะปลด
--
-- ⚠️ **ข้อห้ามนี้ไม่มีเครื่องมืออัตโนมัติบังคับ** (แก้ 2026-08-04 หลัง audit รอบ 3):
-- เคยมีเทสต์สองตัวใน grep-pin ข้างบนคอยจับ แต่ **ถอดออกแล้ว** เพราะมันจับผิดโค้ดที่
-- ถูกต้อง — ไฟล์ที่ **อ่าน** identity_links แล้วบังเอิญมี prisma.user.update ที่ไม่
-- เกี่ยวข้องอยู่ในไฟล์เดียวกันจะแดง ทั้งที่การอ่านคือเหตุผลทั้งหมดที่สร้างตารางนี้
-- (evidence/AUTH-01/A/audit-round3-verdict.md)
-- ⇒ **ตัวบังคับวันนี้คือคำสั่ง operator + code review ของคนบน PR ที่ปลดธง เท่านั้น**
-- CI ไม่ได้ตรวจข้อนี้เลย · งานที่จะปิดช่องนี้จริงคือ AST-based check (BACKLOG)
--
-- ═══ backfill provider='local' ═══
-- ทุก user ที่มีอยู่ได้ link 'local' หนึ่งใบ โดย subject = users."id"
--   * ไม่ใช่ email  — nullable และผู้ใช้เปลี่ยนได้ (auth.prisma:16) ถ้าใช้เป็น
--     subject วันที่ผู้ใช้เปลี่ยนอีเมลคือวันที่ session เดิมชี้ไปคนละคน
--   * ไม่ใช่ canonicalId — Detokenize STAGE A re-key จะ **เขียนทับ** ค่านี้
--     (canonicalId := COALESCE(healthIdHmac, providerIdHmac, id); auth.prisma:46-55)
--     subject ที่ถูกเขียนทับได้ ไม่ใช่ subject
--   users."id" เป็นค่าเดียวในตารางที่ immutable และไม่ใช่ PII
--
-- gen_random_uuid() เป็น built-in ตั้งแต่ PostgreSQL 13 (ไม่ต้อง pgcrypto) —
-- CI ใช้ postgres:15 (.github/workflows/ci.yml:404) ตรวจจริงบน 16.13 แล้ว
-- ON CONFLICT DO NOTHING ทำให้ replay/deploy ซ้ำปลอดภัยและไม่มี dup
--
-- Lock: CREATE TABLE ใหม่ไม่แตะ "users" เลย; INSERT..SELECT อ่าน "users" ด้วย
-- ACCESS SHARE (ไม่บล็อก read/write ปกติ) และเขียนลงตารางที่เพิ่งสร้างซึ่งยังไม่มี
-- ใครอ่าน — ไม่มี ACCESS EXCLUSIVE บนตารางที่ร้อนที่สุดของแพลตฟอร์ม
--
-- Rollback (manual):
--   DROP TABLE IF EXISTS "identity_links";
--   -- ไม่มีอะไรใน "users" ต้องคืนค่า: migration นี้ไม่เขียนแถวเดิมสักแถว

BEGIN;

CREATE TABLE IF NOT EXISTS "identity_links" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  -- opaque — ห้าม parse / ห้ามเก็บ CID หรือ pid plaintext (ดูหัวไฟล์)
  "subject" TEXT NOT NULL,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,

  CONSTRAINT "identity_links_pkey" PRIMARY KEY ("id"),

  -- ฐานข้อมูลปฏิเสธ provider ที่ vocabulary ไม่รับ — ไม่ใช่ PG enum โดยเจตนา
  CONSTRAINT "identity_links_provider_ck" CHECK (
    "provider" IN ('local', 'healthid', 'providerid', 'thaid')
  )
);

-- identity หนึ่งใบผูกได้กับ user เดียว — กันเคสร้ายที่สุด (subject เดียวกันถูกผูก
-- กับสอง user = เข้าเป็นคนอื่นได้) ตั้งชื่อตามที่ Prisma @@unique([provider, subject])
-- สร้างเอง เพื่อให้ migrate diff ไม่เห็น drift
CREATE UNIQUE INDEX IF NOT EXISTS "identity_links_provider_subject_key"
  ON "identity_links"("provider", "subject");

-- read path หลัก: "user คนนี้ผูกช่องทางอะไรไว้บ้าง"
CREATE INDEX IF NOT EXISTS "identity_links_userId_idx"
  ON "identity_links"("userId");

-- CASCADE ทั้งสองขา: link ไม่ใช่ audit trail — มันคือความสัมพันธ์ที่ไม่มี
-- ความหมายเมื่อ user หายไป (ต่างจาก user_consents ที่เป็นหลักฐาน PDPA จึง
-- RESTRICT) การปล่อยให้เหลือ orphan แปลว่า subject นั้นยังถูกจองอยู่ใต้ UNIQUE
-- และผูกใหม่ไม่ได้ตลอดกาล
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'identity_links_userId_fkey'
  ) THEN
    ALTER TABLE "identity_links"
      ADD CONSTRAINT "identity_links_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: ทุก user ที่มีอยู่ ได้ตัวตน 'local' หนึ่งใบ subject = users."id"
INSERT INTO "identity_links" ("id","userId","provider","subject","linkedAt","isActive")
SELECT gen_random_uuid()::text, u."id", 'local', u."id", now(), true
FROM "users" u
ON CONFLICT ("provider","subject") DO NOTHING;

COMMIT;
