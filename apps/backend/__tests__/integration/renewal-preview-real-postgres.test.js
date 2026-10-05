'use strict';
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


/**
 * fix/fee-line-descriptions round 5 (review): the preview of a RENEWAL is one charge — the
 * renewal service — with no instalment 1, priced invoice → quotation → engine
 * (services/billing/renewal-amount.js previewPhaseAmounts, which the route calls), and its
 * next action never asks for instalment 1 (PAY_PHASE_1). A renewal is created at
 * PENDING_AUDIT_FEE, which the preview does not serve, so it is seen here at CAR_PENDING:
 * unpaid → the renewal charge is still owed; paid → the receipt / scheduling step.
 * Real route, real Postgres.
 */
const { calculateRenewalFee } = require('../../modules/billing');

d('GET /applications/:id/preview prices a renewal as a renewal, on a real Postgres', () => {
    let prisma;
    let app;
    let orgId;
    let user;
    let entityId;
    const appIds = [];
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        const org = await prisma.organization.create({
            data: { name: 'R5 renewal preview org', slug: `r5ren-${suffix}`, code: `R5REN_${suffix}`.toUpperCase().slice(0, 24) },
        });
        orgId = org.id;
        user = await prisma.user.create({
            data: { canonicalId: `r5ren-canon-${suffix}`, password: 'x', organizationId: orgId, authType: 'EMAIL_LEGACY' },
        });
        // R2: a health user reads a filing through the holder it belongs to (no filer fallback).
        const entity = await prisma.entity.create({
            data: { type: 'INDIVIDUAL', displayName: 'ทดสอบ การต่ออายุ', organizationId: orgId },
        });
        entityId = entity.id;
        await prisma.entityMembership.create({
            data: { userId: user.id, entityId, role: 'OWNER', status: 'ACTIVE', organizationId: orgId },
        });
        mockCurrentUser = { id: user.id, canonicalId: user.canonicalId, role: 'HEALTH_USER', canonicalRole: 'health' };
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
        if (entityId) {
            await prisma.entityMembership.deleteMany({ where: { entityId } }).catch(() => {});
            await prisma.entity.deleteMany({ where: { id: entityId } }).catch(() => {});
        }
        if (user) { await prisma.user.deleteMany({ where: { id: user.id } }).catch(() => {}); }
        if (orgId) { await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {}); }
        await prisma.$disconnect();
    });

    async function seedRenewal(tag) {
        const row = await prisma.application.create({
            data: {
                applicationNumber: `R5REN-${tag}-${suffix}`,
                healthId: user.canonicalId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                entityId,
                // PENDING_AUDIT_FEE is not a previewable status (previewable-statuses.js); the
                // stage a renewal reaches the preview in is CAR_PENDING.
                status: 'CAR_PENDING',
                formData: { renewalOf: 'cert-old-1', farmData: { areaTypes: ['OUTDOOR', 'INDOOR'] } },
                cultivationScopeCount: 1,
            },
        });
        appIds.push(row.id);
        return row;
    }

    test('no invoice, no quotation: one renewal charge at the engine price for its 2 declared types', async () => {
        const row = await seedRenewal('ENGINE');
        const res = await request(app).get(`/api/preview/applications/${row.id}/preview`);
        expect(res.status).toBe(200);
        const p = res.body.preview.payment;
        const expected = calculateRenewalFee({}, { scopeCount: 2 }).phaseTotal;
        expect(p.isRenewal).toBe(true);
        expect(p.phase1Amount).toBeNull();
        expect(p.breakdown.phase1).toBeNull();
        expect(p.phase2Amount).toBe(expected);
        expect(p.breakdown.phase2.phaseTotal).toBe(expected);
        expect(p.breakdown.totals.grandTotal).toBe(expected);
        expect(p.totalEstimated).toBe(expected);
        expect(res.body.preview.nextRequiredAction).not.toBe('PAY_PHASE_1');
    });

    test('with its checkout invoice: the billed figure wins', async () => {
        const row = await seedRenewal('INVOICE');
        await prisma.invoice.create({
            data: {
                invoiceNumber: `INV-R5REN-${suffix}`,
                applicationId: row.id,
                healthId: user.canonicalId,
                organizationId: orgId,
                serviceType: 'CERTIFICATION_CHECKOUT_M2',
                subtotal: 60000,
                vat: 4200,
                totalAmount: 64200,
                dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
                status: 'paid',
                paidAt: new Date(),
            },
        });
        const res = await request(app).get(`/api/preview/applications/${row.id}/preview`);
        expect(res.status).toBe(200);
        const p = res.body.preview.payment;
        expect(p.phase2Amount).toBe(64200);
        expect(p.breakdown.phase2.serviceFeeAmount).toBe(60000);
        expect(p.breakdown.phase2.vatAmount).toBe(4200);
        expect(p.phase1Amount).toBeNull();
        expect(p.breakdown.phase2.isPhasePaid).toBe(true);
        expect(['WAIT_RECEIPT_PHASE_2', 'WAIT_AUDIT_SCHEDULE']).toContain(res.body.preview.nextRequiredAction);
    });
});
