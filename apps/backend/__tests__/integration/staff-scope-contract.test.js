/**
 * ขอบเขตของพนักงานแต่ละบทบาท — สัญญาที่เครื่องบังคับ บนฐานข้อมูลจริง
 *
 * โซ่ "มอบหมาย → เห็น" มีสัญญาของตัวเองแล้ว (staff-chain-assign-then-see) เพราะมันเคยพัง
 * จริง · แต่บทบาทที่เหลือ — ผู้จัดตาราง ผู้ตรวจแปลง ฝ่ายการเงิน — ยังยืนอยู่บนการเดินด้วยมือ
 * กับเทสหน่วยที่ป้อน object ให้ตัวกรองโดยตรง ซึ่งพิสูจน์ *รูปร่างของกฎ* ไม่ใช่ *สิ่งที่คนคนนั้น
 * เห็นจริงเมื่อคิวรีวิ่งบนฐานข้อมูล*
 *
 * ความต่างนั้นสำคัญ: ตัวกรองที่ถูกต้องแต่ประกอบเข้ากับ where ผิดชั้น ให้ผลต่างกันโดยสิ้นเชิง
 * และเป็นชนิดของความผิดพลาดที่เทสหน่วยมองไม่เห็น (เจอมาแล้วกับ reviewerId)
 *
 * ไฟล์นี้จึงสร้างคำขอจริงหลายใบในหลายสถานะ ในสององค์กร แล้วถามว่าแต่ละบทบาท **เห็นอะไรจริง**
 *
 * กฎที่ปักไว้ ถามจากแหล่งเดียวกับที่โค้ดใช้ (`applicationVisibilityFilter`) ไม่ใช่พิมพ์รายชื่อ
 * สถานะซ้ำลงในเทส — รายชื่อที่พิมพ์ซ้ำจะกลายเป็นสำเนาที่สองที่เพี้ยนวันแรกที่กติกาเปลี่ยน
 */

const crypto = require('crypto');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('ขอบเขตข้อมูลของพนักงานแต่ละบทบาท (real Postgres)', () => {
    let prisma;
    let withVisibility;
    let applicationVisibilityFilter;
    const created = { orgs: [], users: [], apps: [] };
    const uid = () => crypto.randomUUID();
    const digits13 = (seed) => seed.replace(/\D/g, '').padEnd(13, '7').slice(0, 13);

    /** สถานะที่ครอบคลุมทั้งเส้นชีวิตของคำขอ — คนละช่วงเป็นของคนละบทบาท */
    const STATUSES = [
        'DRAFT', 'SUBMITTED', 'PENDING_DOC_FEE',
        'DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW', 'DOC_APPROVED',
        'PENDING_AUDIT_FEE', 'AUDIT_FEE_PAID', 'AUDIT_CONFIRMED', 'CERTIFIED',
    ];

    let orgA;
    let orgB;
    let appsByStatus;   // สถานะ → id (ในองค์กร A)
    let otherOrgAppId;  // คำขอขององค์กร B

    async function makeOrg() {
        const id = uid();
        await prisma.organization.create({
            data: { id, name: `org-${id.slice(0, 8)}`, slug: `org-${id.slice(0, 8)}`, code: `ORG_${id.slice(0, 8).toUpperCase()}` },
        });
        created.orgs.push(id);
        return id;
    }

    async function makeApplicant(orgId) {
        const id = uid();
        const canonicalId = `can-${id}`;
        await prisma.user.create({
            data: {
                id, canonicalId, email: `a-${id.slice(0, 8)}@example.test`, password: 'x',
                firstName: 'ผู้ยื่น', lastName: 'ทดสอบ', role: 'health', organizationId: orgId,
                authType: 'HEALTH_ID', healthId: digits13(id),
            },
        });
        created.users.push(id);
        return canonicalId;
    }

    async function makeApp(orgId, applicantCanonicalId, status) {
        const id = uid();
        await prisma.application.create({
            data: {
                id,
                applicationNumber: `APP-SCOPE-${id.slice(0, 8)}`,
                healthId: applicantCanonicalId,
                status,
                serviceType: 'CERTIFICATION',
                areaType: 'OUTDOOR',
                organizationId: orgId,
                formData: { plantId: 'cannabis' },
            },
        });
        created.apps.push(id);
        return id;
    }

    /** คำขอที่บทบาทนี้เห็นจริง เมื่อคิวรีวิ่งบนฐานข้อมูล */
    async function visibleTo(user, orgId) {
        const rows = await prisma.application.findMany({
            where: withVisibility({ organizationId: orgId, isDeleted: false }, user),
            select: { id: true, status: true },
        });
        return rows;
    }

    beforeAll(async () => {
        ({ prisma } = require('../../services/prisma-database'));
        ({ withVisibility, applicationVisibilityFilter } = require('../../shared/application-visibility'));

        orgA = await makeOrg();
        orgB = await makeOrg();

        const applicantA = await makeApplicant(orgA);
        appsByStatus = {};
        for (const s of STATUSES) { appsByStatus[s] = await makeApp(orgA, applicantA, s); }

        const applicantB = await makeApplicant(orgB);
        otherOrgAppId = await makeApp(orgB, applicantB, 'DOC_FEE_PAID');
    });

    afterAll(async () => {
        for (const id of created.apps) { await prisma.application.deleteMany({ where: { id } }); }
        for (const id of created.users) { await prisma.user.deleteMany({ where: { id } }); }
        for (const id of created.orgs) { await prisma.organization.deleteMany({ where: { id } }); }
    });

    describe.each([
        ['ผู้จัดตาราง', 'scheduler'],
        ['การเงิน (กรมฯ)', 'account_dtam'],
        ['การเงิน (บริษัท)', 'account_platform'],
    ])('%s — เห็นเฉพาะช่วงชีวิตของงานตัวเอง', (_label, role) => {
        test('เห็นทุกสถานะที่กติกาบอกว่าเป็นของบทบาทนี้ และไม่เห็นสถานะอื่นเลย', async () => {
            const user = { id: uid(), canonicalRole: role };
            // ถามกฎจากแหล่งเดียวกับที่โค้ดใช้ ไม่พิมพ์รายชื่อสถานะซ้ำในเทส
            const allowed = new Set(applicationVisibilityFilter(user).status.in);
            expect(allowed.size).toBeGreaterThan(0);

            const seen = await visibleTo(user, orgA);
            const seenStatuses = new Set(seen.map((a) => a.status));

            for (const s of STATUSES) {
                if (allowed.has(s)) { expect(seenStatuses).toContain(s); }
                else { expect(seenStatuses).not.toContain(s); }
            }
        });

        test('ไม่เห็นคำขอขององค์กรอื่น', async () => {
            const user = { id: uid(), canonicalRole: role };
            const seen = await visibleTo(user, orgA);
            expect(seen.map((a) => a.id)).not.toContain(otherOrgAppId);
        });
    });

    describe('ผู้ตรวจแปลง — เห็นเฉพาะงานของตัวเอง ไม่ใช่ทั้งสายพาน', () => {
        test('ไม่มีอะไรถูกมอบหมาย = ไม่เห็นอะไรเลย แม้จะมีคำขอทุกสถานะอยู่ตรงหน้า', async () => {
            const seen = await visibleTo({ id: uid(), canonicalRole: 'auditor' }, orgA);
            expect(seen).toHaveLength(0);
        });

        test('มอบหมายให้แล้วเห็นเฉพาะใบนั้น ไม่ใช่ใบอื่นในสถานะเดียวกัน', async () => {
            const auditorId = uid();
            await prisma.user.create({
                data: {
                    id: auditorId, canonicalId: `can-${auditorId}`,
                    email: `au-${auditorId.slice(0, 8)}@example.test`, password: 'x',
                    firstName: 'ผู้ตรวจ', lastName: 'แปลง', role: 'auditor', organizationId: orgA,
                    authType: 'PROVIDER_ID', providerId: digits13(auditorId),
                },
            });
            created.users.push(auditorId);
            await prisma.application.update({
                where: { id: appsByStatus.AUDIT_CONFIRMED }, data: { auditorId },
            });

            const seen = await visibleTo({ id: auditorId, canonicalRole: 'auditor' }, orgA);
            expect(seen.map((a) => a.id)).toEqual([appsByStatus.AUDIT_CONFIRMED]);
        });
    });

    describe('บทบาทที่ไม่มีขอบเขตฝั่งนี้', () => {
        test('เกษตรกรอ่านคำขอผ่านประตูฝั่งพนักงานไม่ได้เลย — เขามีประตูของตัวเอง', async () => {
            const seen = await visibleTo({ id: uid(), canonicalRole: 'health' }, orgA);
            expect(seen).toHaveLength(0);
        });

        test('บทบาทที่ระบบไม่รู้จัก ไม่ได้อะไรเลย (fail closed) ไม่ใช่ได้ทุกอย่าง', async () => {
            const seen = await visibleTo({ id: uid(), canonicalRole: 'ตำแหน่งที่ไม่มีจริง' }, orgA);
            expect(seen).toHaveLength(0);
        });

        test('คำขอที่ไม่มีผู้ใช้เลย ก็ไม่ได้อะไร', async () => {
            const seen = await visibleTo(null, orgA);
            expect(seen).toHaveLength(0);
        });
    });
});
