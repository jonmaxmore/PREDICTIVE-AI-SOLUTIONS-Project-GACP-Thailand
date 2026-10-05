'use strict';
/**
 * P-GET (staging walk 2026-09-30, L3): GET /applications/:id/preview is a read
 * door. It computed the fee figures and then WROTE them back onto the
 * application row — phase1Amount, phase2Amount, cultivationScopeCount and
 * totalAreaTypes — whenever the stored value differed from the computed one.
 * Opening a page must not change money data.
 *
 * The figures are computed where they are charged: the quotation is priced at
 * issuance from the declared cultivation types (quotation-service
 * billableScopes), and checkout prices from formData or the accepted
 * quotation (stripe-checkout-service breakdownForMilestone). Nothing needs the
 * preview to persist them.
 *
 * The seeded rows carry a stored scope count of 3 and stale phase amounts.
 * Before the fix the GET rewrote such a row. The row's updatedAt and every fee
 * column must be byte-identical after the GET, and (M4, 2026-10-02) the figures
 * the GET returns must equal what the quotation will charge for that same row —
 * one undeclared row (stored count is the fallback) and one declared row.
 *
 * Run: DATABASE_URL=<local migrated postgres> TEST_DATABASE_URL=<same> npx jest --config jest.config.cjs \
 *        __tests__/integration/preview-get-writes-nothing-real-postgres.test.js -i
 */

const express = require('express');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
const quotationService = require('../../services/quotation-service');

let mockCurrentUser = null;
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = mockCurrentUser;
        next();
    },
}));

const FEE_COLUMNS = {
    id: true,
    updatedAt: true,
    phase1Amount: true,
    phase2Amount: true,
    phase1Status: true,
    phase2Status: true,
    cultivationScopeCount: true,
    totalAreaTypes: true,
};

d('GET /applications/:id/preview writes nothing, on a real Postgres (P-GET)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let app;
    let orgId;
    let user;
    let holder;
    const appIds = [];
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        const org = await prisma.organization.create({
            data: { name: 'P-GET org', slug: `pget-${suffix}`, code: `PGET_${suffix}`.toUpperCase().slice(0, 24) },
        });
        orgId = org.id;
        user = await prisma.user.create({
            data: { canonicalId: `pget-canon-${suffix}`, password: 'x', organizationId: orgId, authType: 'EMAIL_LEGACY' },
        });
        mockCurrentUser = { id: user.id, canonicalId: user.canonicalId, role: 'HEALTH_USER', canonicalRole: 'health' };
        // R2 Task 12: the preview reads by holder membership (no filer fallback), so the
        // rows are held by an entity the user is an ACTIVE OWNER of.
        holder = await prisma.entity.create({ data: { type: 'INDIVIDUAL', displayName: `P-GET ${suffix}`, organizationId: orgId } });
        await prisma.entityMembership.create({
            data: { userId: user.id, entityId: holder.id, role: 'OWNER', status: 'ACTIVE', organizationId: orgId },
        });

        const previewRouter = require('../../routes/api/preview/preview');
        app = express();
        app.use(express.json());
        app.use('/api/preview', previewRouter);
    });

    afterAll(async () => {
        for (const id of appIds) {
            await prisma.invoice.deleteMany({ where: { applicationId: id } }).catch(() => {});
            await prisma.application.deleteMany({ where: { id } }).catch(() => {});
        }
        if (holder) {
            await prisma.entityMembership.deleteMany({ where: { entityId: holder.id } }).catch(() => {});
            await prisma.entity.deleteMany({ where: { id: holder.id } }).catch(() => {});
        }
        if (user) { await prisma.user.deleteMany({ where: { id: user.id } }).catch(() => {}); }
        if (orgId) { await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {}); }
        await prisma.$disconnect();
    });

    // Two shapes of row (M4):
    //   UNDECLARED — formData names no cultivation type, the column stores 3. The
    //     quotation falls back to the stored count, so the preview must too.
    //   DECLARED — the wizard's ticks name two types; the declaration wins over the
    //     stored 3 on both doors.
    const FORM_DATA = {
        UNDECLARED: {},
        DECLARED: { farmData: { areaTypes: ['OUTDOOR', 'INDOOR'] } },
    };

    async function seed(status, shape) {
        const row = await prisma.application.create({
            data: {
                applicationNumber: `PGET-${status}-${shape}-${suffix}`,
                healthId: user.canonicalId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                entityId: holder.id,
                status,
                formData: FORM_DATA[shape],
                // Stale on purpose: no computed figure equals these, so a write would show.
                phase1Amount: 1111,
                phase2Amount: 2222,
                cultivationScopeCount: 3,
                totalAreaTypes: 3,
            },
        });
        appIds.push(row.id);
        return row;
    }

    test.each([
        ['DRAFT', 'UNDECLARED'],
        ['PENDING_DOC_FEE', 'UNDECLARED'],
        ['DRAFT', 'DECLARED'],
        ['PENDING_DOC_FEE', 'DECLARED'],
    ])(
        '%s / %s: the GET writes nothing, and its figures equal what the quotation will charge for the same row',
        async (status, shape) => {
            const row = await seed(status, shape);
            const before = await prisma.application.findUnique({ where: { id: row.id }, select: FEE_COLUMNS });

            const res = await request(app).get(`/api/preview/applications/${row.id}/preview`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            // M4: the quotation's own pricing of THIS row (the function issuance calls,
            // fed the row as stored), against the figures the preview showed.
            const stored = await prisma.application.findUnique({ where: { id: row.id } });
            const quoted = quotationService._internals.resolveBillableFees(stored);
            const payment = res.body.preview.payment;
            expect(payment.scopeCount).toBe(quoted.scopeCount);
            expect(payment.phase1Amount).toBe(quoted.phase1.total);
            expect(payment.phase2Amount).toBe(quoted.phase2.total);
            expect(payment.breakdown.totals.grandTotal).toBe(quoted.grandTotal);
            expect(payment.scopeCount).toBe(shape === 'UNDECLARED' ? 3 : 2);

            // The no-write proof.
            const after = await prisma.application.findUnique({ where: { id: row.id }, select: FEE_COLUMNS });
            expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
            expect(after).toEqual(before);
            expect(after.cultivationScopeCount).toBe(3);
            expect(after.phase1Amount).toBe(1111);
        },
    );
});
