-- ปลดระวาง: สลิปโอนเงิน · แพ็กเกจสมาชิก · กติกาเอกสารชุดเก่า
--
-- คำสั่ง operator 2026-09-11: "ล้างคราบสลิปด้วยเพราะเราไม่ได้ใช้แล้ว เราก็ไม่มีบริการ
-- subscription ด้วยต้องเก็บกวาด และล้างคราบด้วย"
--
--   payment_slips          ปลดระวางตามมติ operator 2026-09-06 — จ่ายผ่าน Stripe ตัดสินด้วย
--                          webhook เท่านั้น ไม่มีมนุษย์อนุมัติการจ่ายเงิน · ไม่มีประตูไหนสร้าง
--                          หรืออ่านสลิปแล้ว และตารางไม่มีแถว
--   subscriptions          แพลตฟอร์มไม่มีบริการนี้ขาย · ขาที่พาไป ACTIVE ไม่มีตัวจุดชนวนอยู่จริง
--                          มาตั้งแต่ถอดรางสลิปออก และตารางมีศูนย์แถว (ตรวจ 2026-08-23)
--   document_requirements  กติกาเอกสารชุดเก่าที่ตอบคำถามเดียวกับทะเบียน B1 แต่ตอบไม่ตรงกัน
--                          schema ของ B1 เขียนกำกับไว้เองว่า "declared dead weight awaiting
--                          removal" (requirement-rule.prisma:31)
--
-- เป็น contract step ล้วน ๆ: โค้ดที่อ้างคอลัมน์เหล่านี้ถูกลบไปก่อนหน้าในสาขาเดียวกัน
-- deploy โค้ดก่อนแล้วค่อยรันใบนี้ ตามลำดับปกติ

-- ── กันพลาด: ถ้าเครื่องไหนมีข้อมูลจริง ให้ล้มทั้งใบ ────────────────────────────
-- ดีกว่าลบเงียบ ๆ แล้วมารู้ทีหลังว่าเครื่องนั้นไม่เหมือนที่เราตรวจ
DO $$
DECLARE n BIGINT;
BEGIN
    IF to_regclass('public.payment_slips') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM payment_slips' INTO n;
        IF n > 0 THEN
            RAISE EXCEPTION 'payment_slips มี % แถว — หยุด ใบนี้ตั้งอยู่บนข้อเท็จจริงว่าตารางว่าง', n;
        END IF;
    END IF;

    IF to_regclass('public.subscriptions') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM subscriptions' INTO n;
        IF n > 0 THEN
            RAISE EXCEPTION 'subscriptions มี % แถว — หยุด ใบนี้ตั้งอยู่บนข้อเท็จจริงว่าตารางว่าง', n;
        END IF;
    END IF;

    -- ใบแจ้งหนี้/คำสั่งชำระที่ผูกกับแพ็กเกจสมาชิก ต้องไม่มีเช่นกัน มิฉะนั้นการเปลี่ยน
    -- CHECK ด้านล่างจะทำให้แถวเดิมผิดกติกาใหม่
    IF to_regclass('public.invoices') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM invoices WHERE "subscriptionId" IS NOT NULL' INTO n;
        IF n > 0 THEN
            RAISE EXCEPTION 'invoices ที่ผูกแพ็กเกจสมาชิกมี % แถว — หยุด', n;
        END IF;
    END IF;

    IF to_regclass('public.checkout_orders') IS NOT NULL THEN
        EXECUTE 'SELECT count(*) FROM checkout_orders WHERE "subscriptionId" IS NOT NULL' INTO n;
        IF n > 0 THEN
            RAISE EXCEPTION 'checkout_orders ที่ผูกแพ็กเกจสมาชิกมี % แถว — หยุด', n;
        END IF;
    END IF;
END $$;

-- ── invoices: XOR สองทาง กลายเป็นกติกาทางเดียว ─────────────────────────────
-- เดิม "ต้องมีอย่างใดอย่างหนึ่งระหว่างคำขอกับแพ็กเกจ" · เหลือเป้าเดียวแล้ว กติกาจึงเป็น
-- "ต้องผูกคำขอเสมอ" — เข้มขึ้น ไม่ใช่ผ่อนลง
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_billable_xor_chk";
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_subscriptionId_fkey";
DROP INDEX IF EXISTS "invoices_subscriptionId_idx";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "subscriptionId";
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_billable_application_chk"
        CHECK ("applicationId" IS NOT NULL);

-- ── checkout_orders: เช่นเดียวกัน ──────────────────────────────────────────
ALTER TABLE "checkout_orders" DROP CONSTRAINT IF EXISTS "checkout_orders_target_xor_check";
ALTER TABLE "checkout_orders" DROP CONSTRAINT IF EXISTS "checkout_orders_subscriptionId_fkey";
DROP INDEX IF EXISTS "checkout_orders_open_per_subscription_milestone_key";
DROP INDEX IF EXISTS "checkout_orders_subscriptionId_idx";
ALTER TABLE "checkout_orders" DROP COLUMN IF EXISTS "subscriptionId";
ALTER TABLE "checkout_orders"
    ADD CONSTRAINT "checkout_orders_target_application_check"
        CHECK ("applicationId" IS NOT NULL);

-- ── applications: คอลัมน์ที่ชี้มาที่สลิป ────────────────────────────────────
ALTER TABLE "applications" DROP COLUMN IF EXISTS "phase1SlipId";
ALTER TABLE "applications" DROP COLUMN IF EXISTS "phase2SlipId";

-- ── ตารางที่ปลดระวาง ───────────────────────────────────────────────────────
DROP TABLE IF EXISTS "payment_slips";
DROP TABLE IF EXISTS "subscriptions";
DROP TABLE IF EXISTS "document_requirements";
