/**
 * โซ่การทำงานของพนักงาน: มอบหมายแล้วต้องเห็น — บนฐานข้อมูลจริง
 *
 * 2026-09-05 การเดินด้วยมือจับบั๊กได้ว่า **งานถูกมอบหมายให้คนที่มองไม่เห็นมัน**: ผู้จัดตาราง
 * มอบหมายผู้ตรวจแปลงให้ตรวจเอกสาร (รายชื่อตั้งใจรวมไว้) ประตูตอบ 200 เขียน `reviewerId` จริง
 * แต่คนนั้นเปิดรายการของตัวเองแล้วได้ศูนย์ · แก้แล้วและพิสูจน์สดแล้ว
 *
 * ปัญหาที่เหลือคือ **การพิสูจน์นั้นเป็นการเดินมือของคนคนเดียว ครั้งเดียว** — ครั้งหน้าที่ใคร
 * แก้ตัวกรองการมองเห็น หรือแก้ประตูมอบหมาย ไม่มีอะไรจับได้จนกว่าจะมีคนเดินอีกรอบ
 *
 * ไฟล์นี้ทำให้การเดินนั้นเป็นของเครื่อง: ยิงผ่านชั้นเดียวกับที่เบราว์เซอร์เรียก (ตัวกรองจริง +
 * ประตูมอบหมายจริง) บนฐาน Postgres จริง · เทสหน่วยจับบั๊กนี้ไม่ได้เพราะมันอยู่ **ระหว่าง**
 * สองส่วนที่ต่างก็ถูกต้องในตัวเอง — ประตูเขียนสิ่งที่มันบอกว่าเขียน และตัวกรองอ่านสิ่งที่มันบอกว่าอ่าน
 *
 * ข้ามอย่างสุภาพเมื่อไม่มีฐานข้อมูล (describeIfTestDatabase) แต่ **ไม่ผ่านแบบเงียบ ๆ** —
 * ชื่อ suite บอกเหตุผลที่ข้ามเอง
 */

const crypto = require('crypto');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('โซ่พนักงาน: ผู้จัดตารางมอบหมาย แล้วผู้รับต้องเห็นงานนั้น (real Postgres)', () => {
    let prisma;
    let withVisibility;
    const created = { applications: [], users: [], orgs: [] };
    const uid = () => crypto.randomUUID();
    /** สิบสามหลักที่ไม่ซ้ำกัน สำหรับคอลัมน์ตัวตนที่ฐานข้อมูลบังคับให้มี */
    const digits13 = (seed) => seed.replace(/\D/g, '').padEnd(13, '7').slice(0, 13);

    beforeAll(async () => {
        ({ prisma } = require('../../services/prisma-database'));
        ({ withVisibility } = require('../../shared/application-visibility'));
    });

    afterAll(async () => {
        for (const id of created.applications) { await prisma.application.deleteMany({ where: { id } }); }
        for (const id of created.users) { await prisma.user.deleteMany({ where: { id } }); }
        for (const id of created.orgs) { await prisma.organization.deleteMany({ where: { id } }); }
    });

    /** ฟาร์มเดียว องค์กรเดียว คำขอหนึ่งใบที่รอการมอบหมาย และผู้ตรวจแปลงหนึ่งคน */
    async function fixture() {
        const orgId = uid();
        await prisma.organization.create({
            data: {
                id: orgId,
                name: `org-${orgId.slice(0, 8)}`,
                slug: `org-${orgId.slice(0, 8)}`,
                code: `ORG_${orgId.slice(0, 8).toUpperCase()}`,
            },
        });
        created.orgs.push(orgId);

        const auditorId = uid();
        await prisma.user.create({
            data: {
                id: auditorId, canonicalId: `can-${auditorId}`,
                email: `auditor-${auditorId.slice(0, 8)}@example.test`,
                password: 'x', firstName: 'ผู้ตรวจ', lastName: 'แปลง',
                role: 'auditor', organizationId: orgId,
                // users_auth_type_identity_ck: PROVIDER_ID ⇒ providerId set, healthId null
                authType: 'PROVIDER_ID', providerId: digits13(auditorId),
            },
        });
        created.users.push(auditorId);

        const applicantId = uid();
        const applicantCanonicalId = `can-${applicantId}`;
        // สะดุดตรงนี้ และมันสำคัญพอจะเขียนไว้: คอลัมน์ `applications.healthId` **ไม่ได้**
        // ชี้ไปที่ `users.healthId` — FK จริงคือ REFERENCES users("canonicalId")
        // ⇒ ค่าที่ต้องใส่คือ canonicalId ของผู้ยื่น ไม่ใช่เลขบัตรของเขา
        const applicantHealthId = digits13(applicantId);
        await prisma.user.create({
            data: {
                id: applicantId, canonicalId: applicantCanonicalId,
                email: `farmer-${applicantId.slice(0, 8)}@example.test`,
                password: 'x', firstName: 'เกษตรกร', lastName: 'ทดสอบ',
                role: 'health', organizationId: orgId,
                // …and HEALTH_ID ⇒ healthId set, providerId null
                authType: 'HEALTH_ID', healthId: applicantHealthId,
            },
        });
        created.users.push(applicantId);

        const appId = uid();
        await prisma.application.create({
            data: {
                id: appId,
                applicationNumber: `APP-STAFF-${appId.slice(0, 8)}`,
                healthId: applicantCanonicalId,   // FK → users.canonicalId (ดูหมายเหตุด้านบน)
                status: 'DOC_FEE_PAID',       // สถานะที่ผู้จัดตารางหยิบไปมอบหมายได้
                serviceType: 'CERTIFICATION',
                areaType: 'OUTDOOR',
                organizationId: orgId,
                formData: { plantId: 'cannabis' },
            },
        });
        created.applications.push(appId);

        return { orgId, auditorId, applicantId, appId };
    }

    /** ผู้ใช้คนนี้เห็นคำขอใบไหนบ้าง — ผ่านตัวกรองจริงที่ทุกประตู provider ใช้ */
    async function visibleTo(user, orgId) {
        return prisma.application.findMany({
            where: withVisibility({ organizationId: orgId, isDeleted: false }, user),
            select: { id: true, status: true },
        });
    }

    test('ก่อนมอบหมาย ผู้ตรวจแปลงไม่เห็นคำขอนั้น', async () => {
        const { auditorId, appId, orgId } = await fixture();
        const seen = await visibleTo({ id: auditorId, canonicalRole: 'auditor' }, orgId);
        expect(seen.map((a) => a.id)).not.toContain(appId);
    });

    test('หลังผู้จัดตารางมอบหมายให้ตรวจเอกสาร คนนั้นเห็นคำขอในรายการของตัวเอง', async () => {
        const { auditorId, appId, orgId } = await fixture();

        // เขียนเฉพาะ `reviewerId` — ซึ่งเป็นสิ่งเดียวที่การมองเห็นขึ้นอยู่กับมัน
        //
        // ไม่เขียน `status` ด้วยโดยตั้งใจ: โปรเจกต์นี้มีกฎ lint ของตัวเองที่ห้ามเขียนสถานะ
        // ตรง ๆ (ต้องผ่าน writeApplicationStatus) และกฎนั้นถูก — การเลียนแบบประตูด้วยมือ
        // ในเทสคือการเปิดทางให้ fixture เพี้ยนจากของจริง · การเปลี่ยนสถานะเป็นเรื่องของ
        // ตัวเขียนสถานะ และมีเทสของมันเอง · suite นี้ว่าด้วย **การมองเห็น** อย่างเดียว
        //
        // ธง sameReviewerAuditor ไม่ถูกตั้ง เพราะยังไม่มีใครเป็นผู้ตรวจแปลงของคำขอนี้ —
        // นี่คือรูปร่างที่ทำให้บั๊กเกิด
        await prisma.application.update({
            where: { id: appId },
            data: { reviewerId: auditorId },
        });

        const seen = await visibleTo({ id: auditorId, canonicalRole: 'auditor' }, orgId);
        expect(seen.map((a) => a.id)).toContain(appId);
    });

    test('ยังไม่เห็นงานที่มอบหมายให้คนอื่น', async () => {
        const { auditorId, appId, orgId } = await fixture();
        // ต้องเป็นคนที่มีตัวตนจริง — ฐานข้อมูลปฏิเสธการมอบหมายให้ id ที่ไม่มีอยู่
        // (applications_reviewerId_fkey) ซึ่งเป็นด่านที่ดีในตัวมันเอง
        const otherId = uid();
        await prisma.user.create({
            data: {
                id: otherId, canonicalId: `can-${otherId}`,
                email: `other-${otherId.slice(0, 8)}@example.test`,
                password: 'x', firstName: 'ผู้ตรวจ', lastName: 'อีกคน',
                role: 'document_reviewer', organizationId: orgId,
                authType: 'PROVIDER_ID', providerId: digits13(otherId),
            },
        });
        created.users.push(otherId);

        await prisma.application.update({
            where: { id: appId },
            data: { reviewerId: otherId },
        });
        const seen = await visibleTo({ id: auditorId, canonicalRole: 'auditor' }, orgId);
        expect(seen.map((a) => a.id)).not.toContain(appId);
    });

    test('ผู้ตรวจเอกสารก็เห็นงานที่มอบหมายให้ตัวเองเช่นกัน — กฎเดียวกันทั้งสองบทบาท', async () => {
        const { appId, orgId } = await fixture();
        const reviewerId = uid();
        await prisma.user.create({
            data: {
                id: reviewerId, canonicalId: `can-${reviewerId}`,
                email: `rev-${reviewerId.slice(0, 8)}@example.test`,
                password: 'x', firstName: 'ผู้ตรวจ', lastName: 'เอกสาร',
                role: 'document_reviewer', organizationId: orgId,
                authType: 'PROVIDER_ID', providerId: digits13(reviewerId),
            },
        });
        created.users.push(reviewerId);

        await prisma.application.update({
            where: { id: appId }, data: { reviewerId },
        });
        const seen = await visibleTo({ id: reviewerId, canonicalRole: 'document_reviewer' }, orgId);
        expect(seen.map((a) => a.id)).toContain(appId);
    });
});
