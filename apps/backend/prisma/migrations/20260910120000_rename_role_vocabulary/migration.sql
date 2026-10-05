-- คำศัพท์บทบาทรอบใหม่ — auditor → field_inspector · scheduler → dispatcher
-- และบทบาทใหม่จริงหนึ่งตัว: certificate_approver
--
-- ทำไม: operator รายงาน 2026-09-10 ว่า "ตอนนี้มันสับสนมาก" · คำว่า auditor อ่านแล้ว
-- ปนกับ document_reviewer ตลอด ทั้งที่งานคือลงพื้นที่ตรวจแปลง · ส่วน scheduler ทำงาน
-- จ่ายงานและคุมคิว ไม่ใช่แค่จัดปฏิทิน · certificate_approver ไม่ใช่การเปลี่ยนชื่อของใคร
-- แต่เป็นด่านที่สองของ ISO/IEC 17065 §7.6 (F-CERT-SOD): ผู้ตัดสินให้การรับรองต้องไม่ใช่
-- ผู้ประเมิน และต้องเป็นผู้มีอำนาจตัดสิน ไม่ใช่ผู้ตรวจคนไหนก็ได้
--
-- ทำไมต้องเป็นใบใหม่ ไม่แก้ 20260801000000: ใบนั้น apply ไปแล้วบนฐานจริง — แก้ย้อน
-- = checksum drift · ใบนี้ต่อจากใบนั้น และใช้แผนที่ตัวเดียวกัน
-- (apps/backend/shared/role-migration-map.js) ซึ่ง __tests__/unit/role-migration-map.test.js
-- ตรึงให้ตรงกันทุกแถว
--
-- ═══ สิ่งที่ใบนี้จงใจ "ไม่" ทำ — อ่านก่อน deploy ═══
-- ไม่มีการแต่งตั้งใครเป็น certificate_approver
--
-- หลัง 20260801000000 แถวที่เคยเป็น approver/final_approver ถูกยุบเป็น 'auditor' หมดแล้ว
-- ⇒ วันนี้ไม่มีข้อมูลใดบอกได้ว่าผู้ตรวจคนไหน "ควร" เป็นผู้ตัดสิน · การเดาแล้วเลื่อนขั้นให้
-- คือการมอบอำนาจอนุมัติใบรับรองโดยไม่มีใครสั่ง ⇒ ใบนี้แปลง auditor ทุกแถวเป็น
-- field_inspector อย่างเดียว ซึ่งรักษาอำนาจเดิมไว้เป๊ะ ๆ
--
-- ผลที่ตามมา และต้องยอมรับก่อน deploy: ทันทีที่ใบนี้ผ่าน **จะยังไม่มีใครอนุมัติคำขอได้เลย**
-- จนกว่าผู้ดูแลจะแต่งตั้งคนแรกผ่านหน้าจัดการผู้ใช้ (บทบาท "ผู้อนุมัติใบรับรอง")
-- ฐานข้อมูลที่ seed ใหม่ไม่ติดปัญหานี้ — prisma/seed-gacp.js สร้าง approver@gacp.go.th ให้
--
-- IDEMPOTENT: แผนที่ปิด (mapRawRole(target) === target ทุกตัว) รันซ้ำได้ไม่มีผล

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. แผนที่ — สำเนาตรงของ USER_ROLE_MIGRATION_MAP
-- ──────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _role_map (raw TEXT PRIMARY KEY, canonical TEXT NOT NULL)
    ON COMMIT DROP;

INSERT INTO _role_map (raw, canonical) VALUES
    ('admin',                'admin'),
    ('super_admin',          'admin'),
    ('platform_admin',       'platform_admin'),
    ('platform_owner',       'platform_admin'),
    ('scheduler',            'dispatcher'),
    ('reviewer',             'document_reviewer'),
    ('reviewer_auditor',     'document_reviewer'),
    ('document_reviewer',    'document_reviewer'),
    ('auditor',              'field_inspector'),
    ('inspector',            'field_inspector'),
    ('audit',                'field_inspector'),
    ('head_auditor',         'field_inspector'),
    ('approver',             'certificate_approver'),
    ('final_approver',       'certificate_approver'),
    ('dispatcher',           'dispatcher'),
    ('field_inspector',      'field_inspector'),
    ('certificate_approver', 'certificate_approver'),
    ('account_dtam',         'account_dtam'),
    ('accountant_dtam',      'account_dtam'),
    ('dtam_account',         'account_dtam'),
    ('finance_dtam',         'account_dtam'),
    ('account_platform',     'account_platform'),
    ('accountant_platform',  'account_platform'),
    ('platform_account',     'account_platform'),
    ('finance_platform',     'account_platform'),
    ('account',              'account'),
    ('accountant',           'account'),
    ('finance',              'account'),
    ('health',               'health'),
    ('applicant',            'health'),
    ('system',               'system'),
    ('webhook',              'system'),
    ('cron',                 'system'),
    ('farmer',               'health')
ON CONFLICT (raw) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. ด่านก่อนแตะข้อมูล — เจอค่าที่แปลไม่ออก ให้ยกเลิกทั้งทรานแซกชัน ไม่เดา
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    offenders TEXT;
    offender_rows BIGINT;
BEGIN
    SELECT string_agg(x.detail, ', ' ORDER BY x.detail), COALESCE(SUM(x.n), 0)
      INTO offenders, offender_rows
    FROM (
        SELECT format('%L (%s rows)', u."role", COUNT(*)) AS detail,
               COUNT(*) AS n
        FROM "users" u
        LEFT JOIN _role_map m ON m.raw = lower(btrim(COALESCE(u."role", '')))
        WHERE m.raw IS NULL
        GROUP BY u."role"
    ) x;

    IF offender_rows > 0 THEN
        RAISE EXCEPTION
            'role vocabulary rename ABORTED: % row(s) hold an unmappable role: %. '
            'Resolve each explicitly (QUARANTINE_VALUES in shared/role-migration-map.js) then re-run.',
            offender_rows, offenders;
    END IF;
END
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. users.role — แตะเฉพาะแถวที่เปลี่ยนจริง · ไม่แตะ updatedAt เพราะนี่คือการ
--    เปลี่ยนคำที่ใช้เรียก ไม่ใช่การแก้สิทธิ์ของใคร (เหมือนใบ 20260801000000)
-- ──────────────────────────────────────────────────────────────────────────
UPDATE "users" u
SET "role" = m.canonical
FROM _role_map m
WHERE m.raw = lower(btrim(COALESCE(u."role", '')))
  AND u."role" IS DISTINCT FROM m.canonical;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. role_groups.code — **เปลี่ยนคำในแถวเดิม ไม่ใช่สร้างแถวใหม่**
--
--    listGroupMemberUserIds() แปลง code -> role_groups.id · สมาชิกผูกกับ id
--    (user_group_memberships.groupId) ไม่ใช่ code ⇒ การเปลี่ยนคำในแถวเดิมทำให้
--    สมาชิกทุกคนตามไปเอง · ถ้าสร้างแถวใหม่แทน กลุ่มใหม่จะว่าง และการค้นด้วยคำใหม่
--    จะคืน [] เงียบ ๆ โดยไม่มี exception — อาการเดียวกับที่ใบ 20260801 เตือนไว้
-- ──────────────────────────────────────────────────────────────────────────
UPDATE "role_groups" SET "code" = 'field_inspector',
       "titleTH" = 'ผู้ตรวจประเมินแปลง', "titleEN" = 'Field Inspector'
 WHERE "code" = 'auditor';

UPDATE "role_groups" SET "code" = 'dispatcher',
       "titleTH" = 'ผู้จัดสรรงานและคิวตรวจ', "titleEN" = 'Dispatcher'
 WHERE "code" = 'scheduler';

-- บทบาทใหม่จริง — ไม่มีแถวเดิมให้เปลี่ยนคำ
INSERT INTO "role_groups" ("id", "code", "titleTH", "titleEN", "updatedAt") VALUES
    ('rg_certificate_approver', 'certificate_approver', 'ผู้อนุมัติใบรับรอง', 'Certificate Approver', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. assignment_ledger_entries.role — คอลัมน์นี้ถูก "ค้นด้วย" ไม่ใช่แค่เก็บไว้ดู
--    (routes/api/provider/ledger.js:114 ส่งค่าที่ normalize แล้วเข้า getFairnessReport)
--    ถ้าไม่แปลง รายงานความเป็นธรรมของการจ่ายงานจะว่างเปล่าโดยไม่มี error
--
--    ชื่อตารางจริงคือ assignment_ledger_entries ไม่ใช่ชื่อโมเดลใน schema
--    (work-distribution-ledger.prisma) — ฉบับแรกของใบนี้เขียนตามชื่อไฟล์ schema แล้ว
--    ล้มทันทีบนฐานสะอาด · รายชื่อคอลัมน์ทั้งหมดที่ถือคำว่า role มาจากการถาม
--    information_schema ของฐานจริง ไม่ใช่การ grep หา schema
-- ──────────────────────────────────────────────────────────────────────────
UPDATE "assignment_ledger_entries" l
SET "role" = m.canonical
FROM _role_map m
WHERE m.raw = lower(btrim(COALESCE(l."role", '')))
  AND l."role" IS DISTINCT FROM m.canonical;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. work_activities.candidateGroup + stage_activity_configs.candidateGroup
--    "role code ที่ใครถือบทบาทนี้หยิบงานได้" — ไม่ใช่ข้อความประกอบ แต่เป็นคีย์ที่ถูก
--    ค้นด้วยค่าที่ normalize แล้ว (work-activity-service.js:599 `where.candidateGroup =
--    canonicalRole` และ :552 `candidateGroup: { in: groups }`)
--
--    ถ้าไม่แปลง: งานที่รออยู่ในคิวจะไม่มีใครหยิบได้อีกเลย — userInGroup() เทียบ
--    candidateGroup เดิม ('auditor') กับกลุ่มของผู้ใช้ที่ตอนนี้เป็น 'field_inspector'
--    แล้วปฏิเสธการรับงานทุกใบ โดยหน้าจอขึ้นแค่ "คิวว่าง"
-- ──────────────────────────────────────────────────────────────────────────
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

-- คอลัมน์ที่ถือคำว่า "บทบาท" ทั้งฐาน มีเจ็ดคอลัมน์ (ถาม information_schema มา)
-- ห้าคอลัมน์ข้างบนถูกแปลง · สองคอลัมน์ที่เหลือจงใจไม่แตะ:
--
--   entity_memberships.role — คนละคำศัพท์กันคนละชุด (OWNER/VIEWER ของ workspace
--                             ไม่ใช่บทบาทเจ้าหน้าที่) แปลงแล้วจะพัง ไม่ใช่แค่ไม่จำเป็น
--   application_comments.role จงใจไม่แตะ — เป็นบันทึกว่า "ตอนนั้นผู้เขียน
-- ถูกเรียกว่าอะไร" ไม่มี query ใดกรองด้วยคอลัมน์นี้ (ตรวจแล้ว: เขียนอย่างเดียวที่
-- application-workflow-handlers.js:250) · จะแปลงหรือไม่เป็นการตัดสินใจของ operator

-- ──────────────────────────────────────────────────────────────────────────
-- 7. ตรวจผล — ไม่ผ่าน = ไม่ COMMIT
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    bad_rows   BIGINT;
    bad_sample TEXT;
    approvers  BIGINT;
    dist       TEXT;
BEGIN
    SELECT COUNT(*), string_agg(DISTINCT format('%L', "role"), ', ')
      INTO bad_rows, bad_sample
    FROM "users"
    WHERE "role" IS NULL
       OR "role" <> lower(btrim("role"))
       OR "role" NOT IN (
            'account', 'account_dtam', 'account_platform', 'admin',
            'certificate_approver', 'dispatcher', 'document_reviewer',
            'field_inspector', 'health', 'platform_admin', 'system'
          );

    IF bad_rows > 0 THEN
        RAISE EXCEPTION
            'VERIFICATION FAILED: % users.role row(s) are not canonical: %',
            bad_rows, bad_sample;
    END IF;

    SELECT COUNT(*) INTO bad_rows
    FROM "users" u
    JOIN _role_map m ON m.raw = u."role"
    WHERE m.canonical <> u."role";

    IF bad_rows > 0 THEN
        RAISE EXCEPTION
            'VERIFICATION FAILED: % row(s) are not a FIXED POINT of the map '
            '(the migration is not idempotent — do not commit)', bad_rows;
    END IF;

    -- ไม่ใช่เงื่อนไขล้มเหลว แต่ต้องดังพอให้ ops เห็นก่อนปิดหน้าต่าง deploy
    SELECT COUNT(*) INTO approvers FROM "users" WHERE "role" = 'certificate_approver';
    IF approvers = 0 THEN
        RAISE WARNING
            'ไม่มีผู้ใดถือบทบาท certificate_approver — คำขอจะเดินถึง AUDIT_PASSED แล้วหยุด '
            'เพราะไม่มีใครมีอำนาจตัดสินให้การรับรอง (ISO/IEC 17065 §7.6) '
            'ผู้ดูแลต้องแต่งตั้งอย่างน้อยหนึ่งคนผ่านหน้าจัดการผู้ใช้';
    END IF;

    SELECT string_agg(format('%s=%s', r, n), ' ' ORDER BY r) INTO dist
    FROM (SELECT "role" AS r, COUNT(*) AS n FROM "users" GROUP BY "role") d;

    RAISE NOTICE 'role vocabulary rename OK — distribution: %', dist;
END
$$;

COMMIT;
