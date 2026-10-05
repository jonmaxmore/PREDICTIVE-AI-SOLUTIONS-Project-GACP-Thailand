/**
 * [AUTH-01-A] identity_links — verified against a REAL Postgres, not a mock.
 *
 * ตารางนี้คือขา EXPAND ของการแยก "ตัวตนที่ใช้ล็อกอิน" ออกจาก "แถว users":
 * วันนี้ users หนึ่งแถวถือได้แค่ identity เดียว เพราะ
 *   users_single_identity_ck  CHECK (NOT ("healthId" IS NOT NULL AND "providerId" IS NOT NULL))
 * (prisma/migrations/20260207120000_identity_guardrails/migration.sql:17)
 * และ login วันนี้ resolve session ผ่าน hash ของ **เลขบัตรประชาชน** ตรง ๆ
 * (services/prisma-auth-service.js:308-309) — คนเดียวจึงผูก IdP ได้ช่องทางเดียว
 * ตลอดกาล และเลขบัตรประชาชนกลายเป็นกุญแจเปิด session ไปโดยปริยาย
 *
 * ข้อพิสูจน์ที่ suite นี้ต้องการ ไม่ใช่ "โค้ดสั่งถูก" แต่คือ "ฐานข้อมูลเห็นด้วย":
 * mock ไม่มี FK ไม่มี CHECK ไม่มี UNIQUE — assertion ทุกข้อข้างล่างจึงอ่านค่ากลับ
 * ออกมาจาก Postgres จริงหลังสั่งไปแล้ว เหมือนที่
 * __tests__/integration/pdpa-retention-legal-hold.test.js ทำ (ซึ่งเป็นชุดที่ทำให้
 * เจอว่า isAnonymized/anonymizedAt ไม่เคยมีอยู่จริงในฐานข้อมูลเลย)
 *
 * ใช้ RAW PrismaClient ตั้งใจ — ไม่ใช้ client จาก services/prisma-database ที่ห่อ
 * tenant-scope + soft-delete extension ไว้ เพราะที่ต้องการคือ ground truth ไม่ใช่
 * มุมมองที่ถูกกรองแล้ว
 *
 * ต้องมี DATABASE_URL ที่ชี้ไป Postgres ที่ migrate แล้ว — ถ้าไม่มีจะ skip ตัวเอง
 * อย่างสะอาดเพื่อให้เลน unit-only ยังเขียว (CI เลน postgres wiring อยู่ที่
 * .github/workflows/ci.yml step "Run backend test gate (curated subset)" และ step
 * "Assert real-Postgres suites actually ran (not skipped)" ซึ่งจะ fail ดัง ๆ ถ้า
 * suite นี้ถูก skip)
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'prisma', 'migrations');

/** provider ที่ CHECK constraint อนุญาต — ต้องตรงกับ identity_links_provider_ck */
const ALLOWED_PROVIDERS = ['local', 'healthid', 'providerid', 'thaid'];

/**
 * ดึงคำสั่ง backfill ตัวจริงออกจากไฟล์ migration แทนที่จะ copy มาไว้ในเทสต์
 * (Law 3.6 — SSOT: ถ้าคัดลอกมา เทสต์จะพิสูจน์สำเนา ไม่ใช่ของที่ deploy จริง)
 */
function readBackfillStatement() {
    const dirs = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /_add_identity_links$/.test(e.name))
        .map((e) => e.name);
    if (dirs.length !== 1) {
        throw new Error(`expected exactly one *_add_identity_links migration, found ${dirs.length}`);
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, dirs[0], 'migration.sql'), 'utf8');
    const match = sql.match(/INSERT INTO "identity_links"[\s\S]*?ON CONFLICT[\s\S]*?;/);
    if (!match) {
        throw new Error(`backfill INSERT not found in ${dirs[0]}/migration.sql`);
    }
    return match[0];
}

d('[AUTH-01-A] identity_links against a real Postgres', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    /** @type {string[]} */
    let seededUserIds = [];

    /**
     * users_auth_type_identity_ck (migration
     * 20260207133000_auth_type_identity_guardrails/migration.sql:54) บังคับว่า
     * authType='HEALTH_ID' ต้องมี healthId — EMAIL_LEGACY ไม่บังคับ identity field
     * ใด ๆ จึงเป็นค่าที่ใช้ตั้ง fixture ได้โดยไม่ต้องใส่เลขบัตรประชาชนปลอมลงฐาน
     * (และนั่นคือประเด็นของ suite นี้พอดี: ผูก identity ได้โดยไม่ต้องมี CID)
     */
    async function seedUser(tag) {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const created = await prisma.user.create({
            data: {
                canonicalId: `idlink-canon-${tag}-${suffix}`,
                password: 'x', // unused — never authenticated in this test
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
                firstName: 'IdentityLink',
                lastName: tag,
            },
        });
        seededUserIds.push(created.id);
        return created;
    }

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const org = await prisma.organization.create({
            data: {
                name: 'Identity Links Test Org',
                slug: `identity-links-${suffix}`,
                code: `IDLINK_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;
    });

    afterEach(async () => {
        if (seededUserIds.length) {
            // ON DELETE CASCADE เก็บ identity_links ให้เอง — ซึ่งเป็นสิ่งที่เทสต์ที่ 4
            // พิสูจน์ ไม่ใช่สิ่งที่เทสต์นี้สมมุติ
            await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } }).catch(() => {});
            seededUserIds = [];
        }
    });

    afterAll(async () => {
        if (!prisma) {
            // beforeAll ล้มก่อนสร้าง client — ปล่อยให้ error ของ beforeAll เป็น
            // ข้อความเดียวที่ผู้อ่านเห็น อย่าให้ teardown เขียนทับด้วย TypeError
            return;
        }
        if (orgId) {
            await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        }
        await prisma.$disconnect();
    });

    test('(1) backfill: หลังรันคำสั่งใน migration ทุก user มี link provider=local ที่ subject = users.id พอดีหนึ่งใบ', async () => {
        // CI สร้างฐานเปล่าแล้ว migrate deploy ทันที ตอน migration รันจึงยังไม่มี user
        // สักคน — ถ้าเทสต์นี้แค่ "นับ link ที่ backfill ทิ้งไว้" มันจะผ่านแบบว่าง
        // (0 = 0) ตลอดกาล จึงหยิบ **คำสั่งตัวจริงจากไฟล์ migration** มารันซ้ำกับ user
        // ที่เพิ่ง seed แทน — ทั้งพิสูจน์ semantics ของ backfill และพิสูจน์ว่ามัน
        // idempotent (ON CONFLICT DO NOTHING) ไปพร้อมกัน
        const backfill = readBackfillStatement();
        expect(backfill).toContain('ON CONFLICT ("provider","subject") DO NOTHING');
        // subject ของ local ต้องเป็น users.id — ไม่ใช่ email (nullable + เปลี่ยนได้)
        // และไม่ใช่ canonicalId (STAGE A re-key จะเขียนทับ; auth.prisma:46-55)
        expect(backfill).not.toMatch(/u\."email"/);
        expect(backfill).not.toMatch(/u\."canonicalId"/);

        const a = await seedUser('backfill-a');
        const b = await seedUser('backfill-b');
        const c = await seedUser('backfill-c');

        await prisma.$executeRawUnsafe(backfill);

        const totalUsers = await prisma.user.count();
        const totalLocalLinks = await prisma.identityLink.count({ where: { provider: 'local' } });
        expect(totalLocalLinks).toBe(totalUsers);
        expect(totalUsers).toBeGreaterThanOrEqual(3);

        for (const user of [a, b, c]) {
            const links = await prisma.identityLink.findMany({ where: { userId: user.id } });
            expect(links).toHaveLength(1);
            expect(links[0].provider).toBe('local');
            expect(links[0].subject).toBe(user.id);
            expect(links[0].isActive).toBe(true);
            expect(links[0].linkedAt).toBeInstanceOf(Date);
            expect(links[0].lastLoginAt).toBeNull();
        }

        // รันซ้ำ = ต้องไม่เกิดแถวใหม่และต้องไม่ระเบิด (deploy ซ้ำ / replay ปลอดภัย)
        await prisma.$executeRawUnsafe(backfill);
        expect(await prisma.identityLink.count({ where: { provider: 'local' } })).toBe(totalLocalLinks);
    });

    test('(2) UNIQUE (provider,subject) กัน identity เดียวถูกผูกสองครั้ง — ฐานข้อมูลปฏิเสธเอง', async () => {
        const first = await seedUser('unique-first');
        const second = await seedUser('unique-second');
        const subject = `shared-subject-${Date.now()}`;

        await prisma.identityLink.create({
            data: { id: `idlink-u1-${Date.now()}`, userId: first.id, provider: 'healthid', subject },
        });

        // ผูก subject เดิมให้ "คนละ user" คือเคสที่อันตรายที่สุด (account takeover)
        await expect(prisma.identityLink.create({
            data: { id: `idlink-u2-${Date.now()}`, userId: second.id, provider: 'healthid', subject },
        })).rejects.toMatchObject({ code: 'P2002' });

        // P2002 ไม่บอกว่า "ใคร" ห้าม จึงต้องตรึงชื่อ constraint แยกต่างหาก — แต่
        // ตรึงจากข้อความ error ไม่ได้: บน SQLSTATE 23505 Prisma เอา DETAIL ของ
        // Postgres มาเป็น message ("Key (provider, subject)=(…) already exists")
        // ทิ้งบรรทัดหลักที่มีชื่อ constraint ไป ต่างจาก 23514 (CHECK) ที่ message
        // หลักมีชื่ออยู่ — ซึ่งเป็นเหตุผลที่เทสต์ (3) ข้างล่างตรึงจาก error ได้
        // (ยืนยันจาก CI run 30869301075: expected /identity_links_provider_subject_key/
        // ได้ "Raw query failed. Code: `23505`. Message: `Key (provider, subject)=… already exists.`")
        //
        // จึงแยกเป็นสองข้อ ซึ่งรวมกันแล้ว**แน่นกว่า**ของเดิม: (ก) DB ปฏิเสธจริงด้วย
        // 23505 บนคู่คอลัมน์ที่ถูกต้อง (ข) ชื่อ index อ่านจาก catalog ตรง ๆ พร้อม
        // ยืนยันว่ามัน UNIQUE และครอบ (provider, subject) จริง — ชื่อสำคัญเพราะถ้า
        // เพี้ยนจากที่ Prisma generate เอง `migrate diff` จะเห็น drift
        await expect(prisma.$executeRawUnsafe(
            `INSERT INTO "identity_links" ("id","userId","provider","subject") VALUES ($1,$2,'healthid',$3)`,
            `idlink-u3-${Date.now()}`, second.id, subject,
        )).rejects.toThrow(/23505[\s\S]*\(provider, subject\)/);

        const indexRows = await prisma.$queryRawUnsafe(`
            SELECT i.relname::text AS name,
                   ix.indisunique   AS is_unique,
                   pg_get_indexdef(ix.indexrelid)::text AS def
            FROM pg_index ix
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_class t ON t.oid = ix.indrelid
            WHERE t.relname = 'identity_links'
              AND i.relname = 'identity_links_provider_subject_key'
        `);
        expect(indexRows).toHaveLength(1);
        expect(indexRows[0].is_unique).toBe(true);
        // รูปแบบจริงบน PG 15/16:
        //   CREATE UNIQUE INDEX identity_links_provider_subject_key
        //     ON public.identity_links USING btree (provider, subject)
        expect(indexRows[0].def).toMatch(/\(\s*provider\s*,\s*subject\s*\)/);

        // provider คนละตัวแต่ subject เดียวกัน = คนละ identity → ต้องผูกได้
        const other = await prisma.identityLink.create({
            data: { id: `idlink-u4-${Date.now()}`, userId: second.id, provider: 'thaid', subject },
        });
        expect(other.provider).toBe('thaid');
    });

    test('(3) CHECK identity_links_provider_ck ปฏิเสธ provider นอกรายการ และรับครบทั้งสี่ค่า', async () => {
        const user = await seedUser('check');

        for (const bad of ['bogus', 'mock', 'LOCAL', '']) {
            await expect(prisma.$executeRawUnsafe(
                `INSERT INTO "identity_links" ("id","userId","provider","subject") VALUES ($1,$2,$3,$4)`,
                `idlink-bad-${Date.now()}-${Math.random()}`, user.id, bad, `bad-${bad}`,
            )).rejects.toThrow(/identity_links_provider_ck/);
        }

        // 'mock' ถูกปฏิเสธโดยตั้งใจ: config/auth-providers.js:23 มี mock อยู่ใน
        // PROVIDER_KEYS ก็จริง แต่ mock IdP เป็นของ non-production ล้วนและไม่มีสิทธิ์
        // ทิ้ง identity ค้างไว้ในฐานข้อมูลจริง — vocabulary ของตารางนี้จึงแคบกว่า
        // registry ของ config โดยเจตนา

        for (const provider of ALLOWED_PROVIDERS) {
            const link = await prisma.identityLink.create({
                data: {
                    id: `idlink-ok-${provider}-${Date.now()}`,
                    userId: user.id,
                    provider,
                    subject: `ok-subject-${provider}-${Date.now()}`,
                },
            });
            expect(link.provider).toBe(provider);
        }
    });

    test('(4) ON DELETE CASCADE — ลบ user แล้ว link หายตามจริง ไม่เหลือ orphan', async () => {
        const user = await seedUser('cascade');
        await prisma.identityLink.createMany({
            data: ALLOWED_PROVIDERS.map((provider) => ({
                id: `idlink-cas-${provider}-${Date.now()}`,
                userId: user.id,
                provider,
                subject: `cascade-${provider}-${Date.now()}`,
            })),
        });
        expect(await prisma.identityLink.count({ where: { userId: user.id } })).toBe(4);

        await prisma.user.delete({ where: { id: user.id } });
        seededUserIds = seededUserIds.filter((id) => id !== user.id);

        expect(await prisma.identityLink.count({ where: { userId: user.id } })).toBe(0);
    });

    test('(5) user คนเดียวถือได้หลาย provider พร้อมกัน โดย users_single_identity_ck ไม่ถูกแตะและไม่ถูกละเมิด', async () => {
        // นี่คือหัวใจของ EXPAND: ข้อจำกัด one-identity-per-row อยู่บนคอลัมน์ของ
        // users ไม่ใช่บนความสัมพันธ์ — ย้ายความสัมพันธ์ออกมาเป็นตารางลูกจึงปลด
        // ข้อจำกัดได้โดยไม่ต้องแก้ constraint เดิมแม้แต่ตัวอักษรเดียว (Law 3.10)
        const user = await seedUser('multi');

        for (const provider of ALLOWED_PROVIDERS) {
            await prisma.identityLink.create({
                data: {
                    id: `idlink-multi-${provider}-${Date.now()}`,
                    userId: user.id,
                    provider,
                    subject: `multi-${provider}-${Date.now()}`,
                },
            });
        }

        const withLinks = await prisma.user.findUnique({
            where: { id: user.id },
            include: { identityLinks: true },
        });
        expect(withLinks.identityLinks).toHaveLength(4);
        expect(withLinks.identityLinks.map((l) => l.provider).sort())
            .toEqual([...ALLOWED_PROVIDERS].sort());

        // แถว users ไม่ถูกแตะเลย — ไม่มี CID ไหนถูกเขียนลงไปเพื่อให้ผูกได้
        expect(withLinks.healthId).toBeNull();
        expect(withLinks.providerId).toBeNull();

        // และ constraint เดิมยังอยู่ครบ ยัง VALIDATE ผ่านกับแถวนี้
        const constraints = await prisma.$queryRawUnsafe(
            `SELECT conname, pg_get_constraintdef(oid) AS def
               FROM pg_constraint
              WHERE conname IN ('users_single_identity_ck','users_auth_type_identity_ck')
              ORDER BY conname`,
        );
        expect(constraints).toHaveLength(2);
        expect(constraints[0].def).toContain('"authType"');
        expect(constraints[1].def).toContain('"healthId" IS NOT NULL');
    });

    test('(6) [A4] resolve user ผ่าน identity_links ได้โดยไม่ต้องมี CID hash สักคอลัมน์', async () => {
        // CID ลดชั้นเป็น "ข้อมูลการรับรอง" ไม่ใช่กุญแจ session — เทสต์นี้พิสูจน์ว่า
        // เส้นทางใหม่ resolve ได้จริงกับ user ที่ไม่มี idCardHash/healthIdHash/
        // providerIdHash เลยสักตัว เส้นเดิม (prisma-auth-service.js:308-315) ยังไม่ถูก
        // แตะใน PR นี้ — รายการที่จะถอดอยู่ใน evidence/AUTH-01/A/contract-cid-demotion.md
        const user = await seedUser('resolve');
        expect(user.idCardHash).toBeNull();
        expect(user.healthIdHash).toBeNull();
        expect(user.providerIdHash).toBeNull();

        await prisma.$executeRawUnsafe(readBackfillStatement());

        const link = await prisma.identityLink.findUnique({
            where: { provider_subject: { provider: 'local', subject: user.id } },
            include: { user: true },
        });
        expect(link).not.toBeNull();
        expect(link.userId).toBe(user.id);
        expect(link.user.id).toBe(user.id);
        expect(link.isActive).toBe(true);

        // ── negative control ────────────────────────────────────────────────
        // ถอดแถว identity_links ของคนนี้ออก แล้วยิง lookup **ตัวเดิมทุกตัวอักษร**
        // ซ้ำ: ถ้ายังหาเจอ แปลว่าที่ resolve สำเร็จข้างบนไม่ได้มาจากแถวนั้น
        // (เวอร์ชันก่อนหน้าเช็ก user.findFirst ด้วย OR ของสาม *Hash ซึ่ง assert ไป
        // แล้วที่ :312-314 ว่าเป็น NULL ทั้งหมด — ผ่านเสมอไม่ว่ากลไกจะพังหรือไม่
        // N-1 จาก audit PR #744)
        const removed = await prisma.identityLink.deleteMany({
            where: { userId: user.id, provider: 'local' },
        });
        expect(removed.count).toBe(1);

        const afterUnlink = await prisma.identityLink.findUnique({
            where: { provider_subject: { provider: 'local', subject: user.id } },
            include: { user: true },
        });
        expect(afterUnlink).toBeNull();

        // และสิ่งที่หายไปคือ "เส้นทาง resolve" ไม่ใช่ตัว user — แถว users ยังอยู่ครบ
        // โดยไม่มี CID hash สักคอลัมน์ ซึ่งแปลว่าไม่มีเส้นเดิมไหนพาไปถึงเขาได้อีก
        const userStillExists = await prisma.user.findUnique({ where: { id: user.id } });
        expect(userStillExists).not.toBeNull();
        expect(userStillExists.idCardHash).toBeNull();
        expect(userStillExists.healthIdHash).toBeNull();
        expect(userStillExists.providerIdHash).toBeNull();
    });
});
