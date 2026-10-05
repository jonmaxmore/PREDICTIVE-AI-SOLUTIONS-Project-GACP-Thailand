-- ขอบข่ายการรับรองเป็นเนื้อหาของใบ ไม่ใช่มุมมองสดของคำขอ (expand)
--
-- ISO/IEC 17065:2012 §7.7.1(d) ให้ใบรับรองระบุ "the scope of certification" และ
-- §7.10.3(d) ให้การเพิ่ม/ลดขอบข่ายทำโดย "issuance of revised formal certification
-- documentation … to extend or reduce the scope of certification"
-- ⇒ ขอบข่ายต้องเป็นของใบ และต้องแก้ได้โดยไม่ต้องออกใบที่สอง
--
-- ก่อนใบนี้ `certified-scope.js` อ่านลักษณะพื้นที่จาก `cert.application` สด ๆ แปลว่า
-- ขอบข่ายที่ **ตัดสินไปแล้ว** เปลี่ยนได้ทุกครั้งที่ข้อมูลคำขอเปลี่ยน ซึ่งไม่ใช่สิ่งที่
-- ใบรับรองเป็น · และมันอ่านด้วย findFirst ใบล่าสุดใบเดียว ⇒ ฟาร์มที่ถือสองใบจะถูก
-- ปิดกั้นจากขอบข่ายของใบเก่าที่ยังไม่หมดอายุ
--
-- EXPAND เท่านั้น: ตารางใหม่ + backfill · ไม่ลบไม่แก้คอลัมน์ใด · โค้ดอ่านตารางนี้ก่อน
-- และถ้าใบไหนยังไม่มีแถว จะตกไปอ่านจากคำขอเหมือนเดิม ⇒ deploy แล้วไม่มีใบใดกลายเป็น
-- "ไร้ขอบข่าย" แม้ backfill จะจับได้ไม่ครบ · สาขานั้นลบในใบ contract หลัง drain
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + INSERT … ON CONFLICT DO NOTHING

BEGIN;

CREATE TABLE IF NOT EXISTS "certificate_scopes" (
    "id"            TEXT         NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "certificateId" TEXT         NOT NULL,
    "areaType"      TEXT         NOT NULL,
    "grantedDate"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status"        TEXT         NOT NULL DEFAULT 'active',
    "auditId"       TEXT,
    CONSTRAINT "certificate_scopes_pkey" PRIMARY KEY ("id")
);

-- ON DELETE CASCADE โดยตั้งใจ และต่างจาก certificates.farmId ที่เป็น RESTRICT:
-- แถวขอบข่ายไม่ใช่บันทึกอิสระ มันเป็นส่วนหนึ่งของใบ · ใบหายไปแล้วขอบข่ายลอยอยู่
-- คือแถวที่ไม่มีใครอ่านและไม่มีใครลบ
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'certificate_scopes_certificateId_fkey'
    ) THEN
        ALTER TABLE "certificate_scopes"
            ADD CONSTRAINT "certificate_scopes_certificateId_fkey"
            FOREIGN KEY ("certificateId") REFERENCES "certificates"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "certificate_scopes_certificateId_areaType_key"
    ON "certificate_scopes" ("certificateId", "areaType");
CREATE INDEX IF NOT EXISTS "certificate_scopes_certificateId_idx"
    ON "certificate_scopes" ("certificateId");
CREATE INDEX IF NOT EXISTS "certificate_scopes_areaType_idx"
    ON "certificate_scopes" ("areaType");

-- ── backfill ────────────────────────────────────────────────────────────────
--
-- หนึ่งแถวต่อหนึ่งลักษณะที่คำขอต้นทางของใบติ๊กไว้ · `grantedDate` = วันที่ออกใบ
-- เพราะขอบข่ายชุดแรกได้มาพร้อมใบ · `auditId` = NULL เพราะใบยุคก่อนไม่ได้บันทึกว่า
-- งานตรวจใดพิสูจน์ลักษณะใด — NULL คือ "ไม่ทราบ" ไม่ใช่ "ไม่มี"
--
-- รับเฉพาะสามคำในทะเบียน (operator 2026-09-11) · คำอื่นที่เคยหลุดเข้ามาไม่ถูก backfill
-- และใบนั้นจะตกไปใช้สาขา expand ในโค้ด ซึ่งอ่านจากคำขอเหมือนเดิม — ไม่มีใครเสียสิทธิ
INSERT INTO "certificate_scopes" ("id", "certificateId", "areaType", "grantedDate", "status", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::TEXT,
    c."id",
    UPPER(TRIM(tick.value)),
    c."issuedDate",
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "certificates" c
JOIN "applications" a ON a."id" = c."applicationId"
CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
        WHEN jsonb_typeof(a."formData"::jsonb -> 'farmData' -> 'areaTypes') = 'array'
            THEN a."formData"::jsonb -> 'farmData' -> 'areaTypes'
        WHEN jsonb_typeof(a."formData"::jsonb -> 'cultivationMethods') = 'array'
            THEN a."formData"::jsonb -> 'cultivationMethods'
        ELSE '[]'::jsonb
    END
) AS tick(value)
WHERE UPPER(TRIM(tick.value)) IN ('OUTDOOR', 'GREENHOUSE', 'INDOOR')
ON CONFLICT ("certificateId", "areaType") DO NOTHING;

-- รายงานผลไว้ในบันทึกของการรัน — ใบที่ backfill ไม่ถึงต้องนับได้ ไม่ใช่หายเงียบ
DO $$
DECLARE
    total_certs   INTEGER;
    certs_covered INTEGER;
    scope_rows    INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_certs FROM "certificates";
    SELECT COUNT(DISTINCT "certificateId") INTO certs_covered FROM "certificate_scopes";
    SELECT COUNT(*) INTO scope_rows FROM "certificate_scopes";
    RAISE NOTICE 'certificate_scopes: % ใบทั้งหมด · backfill ถึง % ใบ · % แถว (ใบที่เหลือตกไปใช้สาขา expand ในโค้ด)',
        total_certs, certs_covered, scope_rows;
END $$;

COMMIT;
