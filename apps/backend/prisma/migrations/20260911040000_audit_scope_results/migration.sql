-- ผลการตรวจรายลักษณะพื้นที่ (expand)
--
-- operator 2026-09-11: "ต้องแยก คนจัดคิวก็ต้องแจ้งว่าไปตรวจแปลงแบบไหน … รีพอทก็ต้องมี 3 ใบ"
-- และมติ M4: ผ่านบางลักษณะก็ออกใบเฉพาะที่ผ่าน
--
-- ก่อนใบนี้ AuditChecklist เป็นหนึ่งแถวต่อหนึ่งคำขอ — ผู้ตรวจคนเดียว คะแนนเดียว
-- สถานะเดียว และแบบประเมินเป็นต่อชนิดพืช ไม่มีมิติลักษณะพื้นที่เลย ⇒ คำขอที่ติ๊ก
-- สามแบบได้ผลก้อนเดียว ออกใบได้อย่างเดียวคือครบสามหรือไม่ได้เลย
--
-- ช่องจริงที่ตารางนี้ปิด ไม่ใช่แค่ "แยกผล": คือการสรุปว่าผ่าน **ทั้งที่ยังไม่มีใครตัดสิน
-- บางลักษณะ** ⇒ ใบรับรองที่ครอบคลุมโรงเรือนโดยไม่มีใครไปดูโรงเรือน
--
-- ไม่มี backfill โดยตั้งใจ: งานตรวจที่ทำไปแล้วไม่มีบันทึกว่าลักษณะใดถูกตัดสินอย่างไร
-- การเดาผลย้อนหลังคือการสร้างหลักฐานที่ไม่มีใครบันทึก · งานตรวจเก่าจึงไม่มีแถว และ
-- ด่าน assertEveryAreaTypeDecided จะบังคับเฉพาะการสรุปผลครั้งใหม่
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + index IF NOT EXISTS

BEGIN;

CREATE TABLE IF NOT EXISTS "audit_scope_results" (
    "id"        TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditId"   TEXT         NOT NULL,
    "areaType"  TEXT         NOT NULL,
    "result"    TEXT         NOT NULL,
    "score"     DOUBLE PRECISION,
    "notes"     TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "decidedBy" TEXT         NOT NULL,
    CONSTRAINT "audit_scope_results_pkey" PRIMARY KEY ("id")
);

-- ไม่มี ON DELETE CASCADE ตามแบบเดียวกับ FarmAuditChecklistItem.auditId ในไฟล์เดียวกัน
-- (ค่าปริยายของฐาน) — ผลการตรวจเป็นหลักฐาน ไม่ควรหายไปเงียบ ๆ เพราะแถวแม่ถูกลบ
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'audit_scope_results_auditId_fkey'
    ) THEN
        ALTER TABLE "audit_scope_results"
            ADD CONSTRAINT "audit_scope_results_auditId_fkey"
            FOREIGN KEY ("auditId") REFERENCES "audit_checklists"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "audit_scope_results_auditId_areaType_key"
    ON "audit_scope_results" ("auditId", "areaType");
CREATE INDEX IF NOT EXISTS "audit_scope_results_auditId_idx"
    ON "audit_scope_results" ("auditId");

COMMIT;
