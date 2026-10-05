'use strict';
/**
 * ใบเสนอราคาต้องออกได้จริงบน Postgres จริง — และประตูชำระเงินต้องผ่านหลังยอมรับ
 *
 * 2026-09-27: หลัง 3fc6a56a (ค่าบริการก้อนเดียว) ถอด `DTAM` ออกจาก ISSUER_TYPES
 * แต่ services/quotation-service.js ยังสร้าง `ISSUER.DTAM = ISSUER_TYPES.DTAM` (= undefined)
 * แล้วถาม `issuerType: { in: [undefined, 'PLATFORM'] }` · Prisma ปฏิเสธคำถามนั้น
 * การออกใบเสนอราคาจึงล้มทุกครั้ง และการชำระทุกใบตอบ 409 QUOTATION_NOT_ISSUED
 *
 * unit suite เขียวตลอดเพราะ prisma ถูก mock — mock รับ `undefined` ใน `in` ได้
 * ไฟล์นี้จึงรันกับฐานข้อมูลจริงเท่านั้น (describeIfTestDatabase: ข้ามเมื่อไม่มี DB
 * และบอกเหตุผลในชื่อ suite · มี DB = รันจริง ไม่ข้ามเอง)
 *
 * รันจริง: DATABASE_URL=<local migrated postgres> npx jest quotation-issuance-real-postgres -i
 */
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const quotationService = require('../../services/quotation-service');
const { issueQuotationOnSubmit } = require('../../services/quotation-issuance-on-submit');
const { assertQuotationAcceptedForPayment, GATE_CODES } = require('../../services/billing/quotation-gate');

// ค่าที่แถวก่อน W14 เขียนไว้บนดิสก์ — seed ด้วยตัวอักษรตรง ๆ เพราะนี่คือข้อเท็จจริงของข้อมูลเก่า
// ไม่ใช่ค่าที่ระบบใหม่ออกได้
const LEGACY_DTAM_ON_DISK = 'DTAM';

d('quotation issuance on a real Postgres (issuer map regression 2026-09-27)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let healthId;
    const appIds = [];

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const org = await prisma.organization.create({
            data: {
                name: 'QT issuer fix org',
                slug: `qtfix-${suffix}`,
                code: `QTFIX_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;
        healthId = `qtfix-canon-${suffix}`;
        await prisma.user.create({
            data: {
                canonicalId: healthId,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
            },
        });
    });

    afterAll(async () => {
        for (const id of appIds) {
            await prisma.quotation.deleteMany({ where: { applicationId: id } }).catch(() => {});
            await prisma.auditLog.deleteMany({ where: { resourceId: id } }).catch(() => {});
            await prisma.application.deleteMany({ where: { id } }).catch(() => {});
        }
        if (healthId) {
            await prisma.user.deleteMany({ where: { canonicalId: healthId } }).catch(() => {});
        }
        if (orgId) {
            await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        }
        await prisma.$disconnect();
    });

    async function seedApplication(label) {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const app = await prisma.application.create({
            data: {
                applicationNumber: `QTFIX-${label}-${suffix}`,
                healthId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                status: 'PENDING_DOC_FEE',
                formData: {},
            },
        });
        appIds.push(app.id);
        return app;
    }

    test('submit hook issues ONE PLATFORM quotation, and the M1 gate passes once it is accepted', async () => {
        const app = await seedApplication('NEW');

        const outcome = await issueQuotationOnSubmit({ application: app, actorId: null });
        expect(outcome).toEqual({ issued: true });

        const rows = await prisma.quotation.findMany({
            where: { applicationId: app.id, isDeleted: false },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].issuerType).toBe('PLATFORM');
        expect(rows[0].quotationNumber).toMatch(/^QT-PRD-/);
        expect(rows[0].status).toBe('PENDING');

        // Issued but not yet accepted: the gate must say NOT_ACCEPTED, never NOT_ISSUED.
        await expect(
            assertQuotationAcceptedForPayment({ applicationId: app.id, milestone: 'M1' }),
        ).rejects.toMatchObject({ code: GATE_CODES.NOT_ACCEPTED });

        const snapshot = quotationService.buildAcceptanceSnapshot(rows[0]);
        await quotationService.markQuotationAccepted(rows[0].id, { acceptedBy: null, snapshot });

        const passed = await assertQuotationAcceptedForPayment({ applicationId: app.id, milestone: 'M1' });
        expect(passed.quotation.id).toBe(rows[0].id);
        expect(passed.phase).toBe('PHASE_1');
    });

    test('a legacy pre-W14 pair is still read: no re-issue, and its unaccepted DTAM row still gates payment', async () => {
        const app = await seedApplication('LEGACY');
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const validUntil = new Date(Date.now() + 30 * 24 * 3600 * 1000);
        const legacyDtam = await prisma.quotation.create({
            data: {
                applicationId: app.id,
                issuerType: LEGACY_DTAM_ON_DISK,
                quotationNumber: `QT-DTAM-LEGACY-${suffix}`,
                subtotal: 5000,
                vat: 0,
                totalAmount: 5000,
                installments: [{ phase: 'PHASE_1', amount: 5000 }],
                status: 'PENDING',
                validUntil,
                organizationId: orgId,
            },
        });
        const legacyPlatform = await prisma.quotation.create({
            data: {
                applicationId: app.id,
                issuerType: 'PLATFORM',
                quotationNumber: `QT-PRD-LEGACY-${suffix}`,
                subtotal: 500,
                vat: 35,
                totalAmount: 535,
                installments: [{ phase: 'PHASE_1', amount: 535 }],
                status: 'ACCEPTED',
                acceptedAt: new Date(),
                validUntil,
                organizationId: orgId,
            },
        });

        // Idempotency: the pair means "already quoted" — nothing new is minted.
        const result = await quotationService.issueQuotationsForApplication(app.id);
        expect(result.company.id).toBe(legacyPlatform.id);
        const count = await prisma.quotation.count({ where: { applicationId: app.id, isDeleted: false } });
        expect(count).toBe(2);

        const found = await quotationService.findQuotationsByApplicationId(app.id);
        expect(found.dtam && found.dtam.id).toBe(legacyDtam.id);
        expect(found.platform && found.platform.id).toBe(legacyPlatform.id);

        // Both rows priced part of a pre-W14 bill, so both must be accepted.
        await expect(
            assertQuotationAcceptedForPayment({ applicationId: app.id, milestone: 'M1' }),
        ).rejects.toMatchObject({ code: GATE_CODES.NOT_ACCEPTED });
    });

    test('a live legacy DTAM row alone still counts as "already quoted": no PLATFORM row is minted beside it', async () => {
        // Pins the idempotency reader (_readLiveQuotationRows) including the legacy
        // value: "any existing non-deleted quotation means it has been quoted".
        // Dropping DTAM from that reader would mint a second, differently-priced
        // document next to a pre-W14 one — a repricing, not a repair.
        const app = await seedApplication('LEGACYONLY');
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await prisma.quotation.create({
            data: {
                applicationId: app.id,
                issuerType: LEGACY_DTAM_ON_DISK,
                quotationNumber: `QT-DTAM-LEGACY-${suffix}`,
                subtotal: 5000,
                vat: 0,
                totalAmount: 5000,
                installments: [{ phase: 'PHASE_1', amount: 5000 }],
                status: 'PENDING',
                validUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000),
                organizationId: orgId,
            },
        });

        const result = await quotationService.issueQuotationsForApplication(app.id);
        expect(result.company).toBeNull();
        const rows = await prisma.quotation.findMany({ where: { applicationId: app.id, isDeleted: false } });
        expect(rows.map((r) => r.issuerType)).toEqual([LEGACY_DTAM_ON_DISK]);
    });
});
