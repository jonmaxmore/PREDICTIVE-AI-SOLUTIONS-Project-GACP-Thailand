-- ผลวิเคราะห์ (COA) ระดับ "รุ่นเก็บเกี่ยว" — มติ operator 2026-09-05, T9
--
-- ADDITIVE ONLY: ตารางใหม่หนึ่งตาราง ไม่แตะคอลัมน์ใดของตารางที่มีอยู่ จึง apply กับ
-- deployment ที่รันอยู่ได้ และถอยกลับได้ด้วยการ DROP ตารางนี้
-- เขียนด้วยมือ (ไม่ใช้ `prisma migrate dev`) เพราะฐาน demo ใช้ร่วมกับ production
-- การ reset ที่นั่นกู้คืนไม่ได้
--
-- ADD CONSTRAINT ห่อด้วย DO block เหมือน 20260901310000: Postgres ไม่มี
-- ADD CONSTRAINT IF NOT EXISTS และหัวไฟล์แบบนี้เชิญชวนให้ apply ด้วยมือ
-- ซึ่งการ apply ซ้ำต้องไม่พังกลางคัน

CREATE TABLE IF NOT EXISTS "batch_lab_results" (
    "id"                  TEXT NOT NULL,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    "harvestBatchId"      TEXT NOT NULL,

    -- ไฟล์ COA คือแหล่งความจริงเดียว ไม่มีคอลัมน์เก็บค่า THC/CBD/ความชื้น โดยตั้งใจ
    -- (operator: "เราจะไม่ได้พิมพ์บอกค่าเท่าไหร่ เราจะอัพโหลดผลแลป")
    "fileUrl"             TEXT NOT NULL,
    "fileName"            TEXT,
    "fileHash"            TEXT,
    "fileSize"            INTEGER,
    "mimeType"            TEXT,

    "labName"             TEXT NOT NULL,
    "reportNumber"        TEXT,
    "reportedAt"          TIMESTAMP(3),
    "verificationCode"    TEXT,

    "verificationStatus"  TEXT NOT NULL DEFAULT 'FARMER_UPLOADED',
    "verifiedAt"          TIMESTAMP(3),
    "verifiedBy"          TEXT,

    "uploadedBy"          TEXT,
    "uploadedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted"           BOOLEAN NOT NULL DEFAULT false,
    "organizationId"      TEXT NOT NULL,

    CONSTRAINT "batch_lab_results_pkey" PRIMARY KEY ("id"),

    -- คำศัพท์ปิด อยู่ในฐานข้อมูลด้วย ไม่ใช่แค่ใน JS (แบบเดียวกับ executive decision R1)
    CONSTRAINT "batch_lab_results_verification_status_check"
        CHECK ("verificationStatus" IN ('FARMER_UPLOADED', 'OFFICER_VERIFIED')),

    -- ไฟล์ที่ไม่มี URL ไม่ใช่เอกสาร และแล็บที่ไม่มีชื่อบอกไม่ได้ว่าใครตรวจ
    CONSTRAINT "batch_lab_results_file_url_check" CHECK (length(btrim("fileUrl")) > 0),
    CONSTRAINT "batch_lab_results_lab_name_check"  CHECK (length(btrim("labName")) > 0),

    -- OFFICER_VERIFIED ต้องบอกได้ว่าใครตรวจและเมื่อไร ไม่งั้นป้าย "ตรวจแล้ว" ไม่มีความหมาย
    CONSTRAINT "batch_lab_results_verified_by_whom_check"
        CHECK ("verificationStatus" <> 'OFFICER_VERIFIED'
               OR ("verifiedBy" IS NOT NULL AND "verifiedAt" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "batch_lab_results_batch_idx"  ON "batch_lab_results" ("harvestBatchId");
CREATE INDEX IF NOT EXISTS "batch_lab_results_org_idx"    ON "batch_lab_results" ("organizationId");
CREATE INDEX IF NOT EXISTS "batch_lab_results_status_idx" ON "batch_lab_results" ("verificationStatus");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'batch_lab_results_harvestBatchId_fkey'
          AND conrelid = '"batch_lab_results"'::regclass
    ) THEN
        ALTER TABLE "batch_lab_results"
            ADD CONSTRAINT "batch_lab_results_harvestBatchId_fkey"
            FOREIGN KEY ("harvestBatchId") REFERENCES "harvest_batches"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'batch_lab_results_organization_id_fkey'
          AND conrelid = '"batch_lab_results"'::regclass
    ) THEN
        ALTER TABLE "batch_lab_results"
            ADD CONSTRAINT "batch_lab_results_organization_id_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;
