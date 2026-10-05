-- คำศัพท์บทบาท — โมเดลสามฝั่ง (operator 2026-09-10 รอบที่สองของวัน)
--
--   ผู้รับบริการ   health (คำของหมอพร้อม — ห้ามเปลี่ยน)
--   กรม            document_reviewer · dispatcher · field_inspector ·
--                  certificate_approver · finance_officer_dtam · system_admin_dtam
--   บริษัท         finance_officer_platform · system_admin_platform
--
-- ต่างจากใบ 20260910120000 เมื่อเช้าตรงเจตนา: ใบนั้นเปลี่ยนคำแล้ว**คงคำเก่าไว้เป็น alias**
-- ให้แปลได้ต่อ · ใบนี้ **ตัดขาด** ตามคำสั่ง operator ("เลิกใช้ของเก่า รวมถึงการพูดถึงของเก่า
-- เพราะเราจะใช้ของใหม่ทั้งหมด" และ "ลบคำเก่าออกไปเลยก็ได้ เพราะกันการสับสนเวลาเราไปทำ
-- บนเซิร์ฟเวอร์โปรดักชันในอนาคต")
--
-- ⇒ หลังใบนี้ `normalizeRole('admin')` คืน null โดยเจตนา · ใครถือ token ที่มีคำเก่าจะถูก
-- ปฏิเสธและต้องล็อกอินใหม่ · ทำได้เพราะทั้งสามฐาน (dev · staging · demo) ถูกล้างและ
-- seed ใหม่ในวันเดียวกัน จึงมีแต่บัญชี seed ไม่มีผู้ใช้จริงให้กระทบ
--
-- ที่นี่คือที่เดียวที่คำเก่ายังปรากฏได้ เพราะไฟล์ migration คือบันทึกประวัติที่แก้ย้อนไม่ได้
-- ไม่ใช่คำศัพท์ที่ยังใช้งาน
--
-- ── สองการยุบที่ไม่ใช่แค่เปลี่ยนชื่อ ─────────────────────────────────────────
-- `account` (คำเปล่า) → finance_officer_platform · โค้ดเดิมเขียนเจตนาไว้เองว่าให้ย้าย
--   ข้างนี้ ("the migration script flips existing ACCOUNT users to ACCOUNT_PLATFORM
--   by default") · วัดแล้ววันนี้: dev 1 แถว · staging 1 · demo 1 ทั้งหมดเป็นบัญชี seed
-- `admin` → system_admin_dtam · ไม่ใช่ system_admin_platform — เพราะ ROLE_AFFILIATION
--   ของเดิมจัด admin ไว้ฝั่ง CERTIFICATION_BODY อยู่แล้ว และ platform_admin เป็นตัวเดียว
--   ที่ข้ามองค์กรได้ · การจับ admin ไปรวมกับ platform_admin จะเป็นการ**ขยายอำนาจ** ไม่ใช่
--   การเปลี่ยนคำ
--
-- IDEMPOTENT: แผนที่ปิด (map(target) = target ทุกตัว) รันซ้ำได้ไม่มีผล

BEGIN;

CREATE TEMP TABLE _role_map (raw TEXT PRIMARY KEY, canonical TEXT NOT NULL)
    ON COMMIT DROP;

INSERT INTO _role_map (raw, canonical) VALUES
    -- ผู้รับบริการ
    -- `health` ไม่เปลี่ยน — อ้างอิงหมอพร้อม (Health ID) ที่กระทรวงบังคับให้เชื่อมต่อ
    ('health',                   'health'),
    ('applicant',                'health'),
    ('farmer',                   'health'),
    -- กรม — สายงานตรวจ (คำเหล่านี้เพิ่งถูกตั้งเมื่อเช้า ไม่เปลี่ยนอีก)
    ('document_reviewer',        'document_reviewer'),
    ('reviewer',                 'document_reviewer'),
    ('reviewer_auditor',         'document_reviewer'),
    ('dispatcher',               'dispatcher'),
    ('scheduler',                'dispatcher'),
    ('field_inspector',          'field_inspector'),
    ('auditor',                  'field_inspector'),
    ('inspector',                'field_inspector'),
    ('audit',                    'field_inspector'),
    ('head_auditor',             'field_inspector'),
    ('certificate_approver',     'certificate_approver'),
    ('approver',                 'certificate_approver'),
    ('final_approver',           'certificate_approver'),
    -- กรม — การเงิน
    ('finance_officer_dtam',     'finance_officer_dtam'),
    ('account_dtam',             'finance_officer_dtam'),
    ('accountant_dtam',          'finance_officer_dtam'),
    ('dtam_account',             'finance_officer_dtam'),
    ('finance_dtam',             'finance_officer_dtam'),
    -- กรม — ผู้ดูแล
    ('system_admin_dtam',        'system_admin_dtam'),
    ('admin',                    'system_admin_dtam'),
    ('super_admin',              'system_admin_dtam'),
    -- บริษัท — การเงิน
    ('finance_officer_platform', 'finance_officer_platform'),
    ('account_platform',         'finance_officer_platform'),
    ('accountant_platform',      'finance_officer_platform'),
    ('platform_account',         'finance_officer_platform'),
    ('finance_platform',         'finance_officer_platform'),
    ('account',                  'finance_officer_platform'),
    ('accountant',               'finance_officer_platform'),
    ('finance',                  'finance_officer_platform'),
    -- บริษัท — ผู้ดูแล
    ('system_admin_platform',    'system_admin_platform'),
    ('platform_admin',           'system_admin_platform'),
    ('platform_owner',           'system_admin_platform'),
    -- ไม่ใช่คน
    ('system',                   'system'),
    ('webhook',                  'system'),
    ('cron',                     'system')
ON CONFLICT (raw) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- ด่านก่อนแตะข้อมูล — เจอค่าที่แปลไม่ออก ให้ยกเลิกทั้งทรานแซกชัน ไม่เดา
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    offenders TEXT;
    offender_rows BIGINT;
BEGIN
    SELECT string_agg(x.detail, ', ' ORDER BY x.detail), COALESCE(SUM(x.n), 0)
      INTO offenders, offender_rows
    FROM (
        SELECT format('%L (%s rows)', u."role", COUNT(*)) AS detail, COUNT(*) AS n
        FROM "users" u
        LEFT JOIN _role_map m ON m.raw = lower(btrim(COALESCE(u."role", '')))
        WHERE m.raw IS NULL
        GROUP BY u."role"
    ) x;

    IF offender_rows > 0 THEN
        RAISE EXCEPTION
            'role vocabulary (three sides) ABORTED: % row(s) hold an unmappable role: %.',
            offender_rows, offenders;
    END IF;
END
$$;

-- users.role — ไม่แตะ updatedAt เพราะนี่คือการเปลี่ยนคำที่ใช้เรียก ไม่ใช่การแก้สิทธิ์ของใคร
UPDATE "users" u
SET "role" = m.canonical
FROM _role_map m
WHERE m.raw = lower(btrim(COALESCE(u."role", '')))
  AND u."role" IS DISTINCT FROM m.canonical;

-- ──────────────────────────────────────────────────────────────────────────
-- role_groups — เปลี่ยนคำในแถวเดิม ไม่สร้างแถวใหม่
-- สมาชิกผูกกับ id (user_group_memberships.groupId) ไม่ใช่ code ⇒ เปลี่ยนคำแล้วสมาชิกตามไปเอง
-- (ถ้าสร้างแถวใหม่ กลุ่มใหม่จะว่าง และการค้นด้วยคำใหม่จะคืน [] เงียบ ๆ)
-- ──────────────────────────────────────────────────────────────────────────
UPDATE "role_groups" SET "code" = 'finance_officer_dtam',
       "titleTH" = 'การเงินและบัญชี (กรม)', "titleEN" = 'Finance Officer (DTAM)'
 WHERE "code" = 'account_dtam';

UPDATE "role_groups" SET "code" = 'finance_officer_platform',
       "titleTH" = 'การเงินและบัญชี (บริษัท)', "titleEN" = 'Finance Officer (Platform)'
 WHERE "code" = 'account_platform';

UPDATE "role_groups" SET "code" = 'system_admin_dtam',
       "titleTH" = 'ผู้ดูแลระบบ (กรม)', "titleEN" = 'System Administrator (DTAM)'
 WHERE "code" = 'admin';

UPDATE "role_groups" SET "code" = 'system_admin_platform',
       "titleTH" = 'ผู้ดูแลระบบ (บริษัท)', "titleEN" = 'System Administrator (Platform)'
 WHERE "code" = 'platform_admin';

-- คำเปล่า `account` ไม่มีที่ยืนในโมเดลสามฝั่ง — ถ้ามีแถวและยังไม่มีใครถือ ให้ลบทิ้ง
DELETE FROM "user_group_memberships"
 WHERE "groupId" IN (SELECT "id" FROM "role_groups" WHERE "code" = 'account')
   AND NOT EXISTS (SELECT 1 FROM "users" WHERE "role" = 'account');
DELETE FROM "role_groups" WHERE "code" = 'account';

-- ──────────────────────────────────────────────────────────────────────────
-- คอลัมน์อื่นที่ถือคำว่าบทบาท (รายชื่อมาจากการถาม information_schema ของฐานจริง
-- ไม่ใช่การ grep หา schema — บทเรียนจากใบ 20260910120000 ที่เขียนชื่อตารางผิดรอบแรก)
-- ──────────────────────────────────────────────────────────────────────────
UPDATE "assignment_ledger_entries" l
SET "role" = m.canonical
FROM _role_map m
WHERE m.raw = lower(btrim(COALESCE(l."role", '')))
  AND l."role" IS DISTINCT FROM m.canonical;

UPDATE "work_activities" w
SET "candidateGroup" = m.canonical
FROM _role_map m
WHERE m.raw = lower(btrim(COALESCE(w."candidateGroup", '')))
  AND w."candidateGroup" IS DISTINCT FROM m.canonical;

UPDATE "stage_activity_configs" c
SET "candidateGroup" = m.canonical
FROM _role_map m
WHERE m.raw = lower(btrim(COALESCE(c."candidateGroup", '')))
  AND c."candidateGroup" IS DISTINCT FROM m.canonical;

-- entity_memberships.role และ application_comments.role จงใจไม่แตะ ด้วยเหตุผลเดิม
-- (คนละคำศัพท์ / เป็นบันทึกว่าตอนนั้นผู้เขียนถูกเรียกว่าอะไร)

-- ──────────────────────────────────────────────────────────────────────────
-- ตรวจผล — ไม่ผ่าน = ไม่ COMMIT
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    bad_rows BIGINT;
    bad_sample TEXT;
    dist TEXT;
BEGIN
    SELECT COUNT(*), string_agg(DISTINCT format('%L', "role"), ', ')
      INTO bad_rows, bad_sample
    FROM "users"
    WHERE "role" IS NULL
       OR "role" <> lower(btrim("role"))
       OR "role" NOT IN (
            'health', 'document_reviewer', 'dispatcher', 'field_inspector',
            'certificate_approver', 'finance_officer_dtam', 'system_admin_dtam',
            'finance_officer_platform', 'system_admin_platform', 'system'
          );
    IF bad_rows > 0 THEN
        RAISE EXCEPTION 'VERIFICATION FAILED: % users.role row(s) are not canonical: %',
            bad_rows, bad_sample;
    END IF;

    SELECT COUNT(*) INTO bad_rows
    FROM "users" u JOIN _role_map m ON m.raw = u."role"
    WHERE m.canonical <> u."role";
    IF bad_rows > 0 THEN
        RAISE EXCEPTION
            'VERIFICATION FAILED: % row(s) are not a FIXED POINT of the map '
            '(the migration is not idempotent — do not commit)', bad_rows;
    END IF;

    SELECT COUNT(*) INTO bad_rows FROM "role_groups"
     WHERE "code" NOT IN (
        'health', 'document_reviewer', 'dispatcher', 'field_inspector',
        'certificate_approver', 'finance_officer_dtam', 'system_admin_dtam',
        'finance_officer_platform', 'system_admin_platform');
    IF bad_rows > 0 THEN
        RAISE EXCEPTION 'VERIFICATION FAILED: % role_groups row(s) hold a retired code', bad_rows;
    END IF;

    SELECT string_agg(format('%s=%s', r, n), ' ' ORDER BY r) INTO dist
    FROM (SELECT "role" AS r, COUNT(*) AS n FROM "users" GROUP BY "role") d;
    RAISE NOTICE 'role vocabulary (three sides) OK — distribution: %', dist;
END
$$;

COMMIT;
