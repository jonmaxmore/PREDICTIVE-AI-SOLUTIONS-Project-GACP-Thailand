-- ปลดระวางการติดตามรายต้น (PlantUnit) — ขั้น contract
--
-- สเปก R8 (อนุมัติ 2026-08-20) ยกเลิกการติดตามรายต้น: ความละเอียดจบที่ "แปลง" และ "รอบปลูก"
-- แปลง 100 ต้นถือรหัสเดียว ไม่ใช่ 100 รหัส · โค้ดที่สร้าง PlantUnit ถูกถอดออกเมื่อ 2026-08-25
-- (entitlements, trace resolver, trace-events) แต่ตารางยังอยู่และแถวเก่ายังค้าง
--
-- operator ยืนยันอีกครั้ง 2026-09-10 ว่า "เราไม่มีแล้ว ยกเลิกไปแล้ว" ⇒ ใบนี้คือขั้น contract
-- ที่ prisma/schema/cultivation.prisma เขียนรอไว้เองว่า "the contract step drops plantUnitId"
--
-- ตรวจก่อนเขียนใบนี้: ไม่มีโค้ดที่รันจริง **อ่าน** ตารางนี้เลย · ที่เหลือสองจุดเป็นรายชื่อ
-- เฉย ๆ (บัญชีคีย์ห้ามแก้ของ harvest-service และรายชื่อโมเดลของ tenant-prisma-extension)
-- ทั้งคู่ถูกลบไปพร้อมกับใบนี้
--
-- ทำไมกล้าลบทั้งตาราง ไม่ใช่แค่เลิกเขียน: ของที่ยังอยู่แต่ไม่มีใครใช้ คือของที่หลอกคนที่
-- กลับมาอ่านทีหลัง — operator รายงานเองว่า "กลับมาดู หรือกลับมาทำใหม่ ผิดตลอด"

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. รายงานสิ่งที่กำลังจะหายไป ก่อนที่มันจะหาย
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    units BIGINT; hist BIGINT; care BIGINT; cult BIGINT;
BEGIN
    SELECT count(*) INTO units FROM "plant_units";
    SELECT count(*) INTO hist  FROM "plant_unit_edit_history";
    SELECT count(*) INTO care  FROM "care_logs"        WHERE "plantUnitId" IS NOT NULL;
    SELECT count(*) INTO cult  FROM "cultivation_logs" WHERE "plantUnitId" IS NOT NULL;

    RAISE NOTICE 'retire PlantUnit — plant_units=% plant_unit_edit_history=% care_logs ที่ยังชี้=% cultivation_logs ที่ยังชี้=%',
                 units, hist, care, cult;

    -- บันทึกกิจกรรมคือหลักฐานที่ผู้ตรวจ GACP ขอดู · ถ้ามีแถวที่ผูกกับต้นไม้อยู่จริง
    -- การลบเงียบ ๆ คือการทำลายหลักฐาน ⇒ หยุดให้คนตัดสิน ไม่ใช่เดินต่อ
    IF care > 0 OR cult > 0 THEN
        RAISE EXCEPTION
            'ยกเลิกการปลดระวาง: มีบันทึกกิจกรรมที่ยังผูกกับต้นไม้รายต้นอยู่ (care_logs=%, cultivation_logs=%). '
            'ย้ายบันทึกเหล่านั้นไปผูกกับรอบปลูกก่อน แล้วจึงรันใบนี้อีกครั้ง', care, cult;
    END IF;
END
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. คอลัมน์ที่ชี้ไปหาต้นไม้ — ทิ้งพร้อม index ของมัน
--    (FK ถูกทิ้งไปพร้อมคอลัมน์เอง)
-- ──────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "care_logs_plantUnitId_idx";
DROP INDEX IF EXISTS "cultivation_logs_plantUnitId_idx";

ALTER TABLE "care_logs"        DROP COLUMN IF EXISTS "plantUnitId";
ALTER TABLE "cultivation_logs" DROP COLUMN IF EXISTS "plantUnitId";

-- ──────────────────────────────────────────────────────────────────────────
-- 3. ตัวตาราง — ลูกก่อนแม่
-- ──────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS "plant_unit_edit_history";
DROP TABLE IF EXISTS "plant_units";

-- ──────────────────────────────────────────────────────────────────────────
-- 4. ตรวจว่าไม่เหลือเศษ
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE leftovers TEXT;
BEGIN
    SELECT string_agg(x.what, ', ') INTO leftovers FROM (
        SELECT table_name AS what FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name LIKE 'plant_unit%'
        UNION ALL
        SELECT table_name || '.' || column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'plantUnitId'
    ) x;

    IF leftovers IS NOT NULL THEN
        RAISE EXCEPTION 'ยังเหลือเศษของ PlantUnit: %', leftovers;
    END IF;
    RAISE NOTICE 'retire PlantUnit OK — ไม่เหลือตารางหรือคอลัมน์ใดที่อ้างถึงการติดตามรายต้น';
END
$$;

COMMIT;
