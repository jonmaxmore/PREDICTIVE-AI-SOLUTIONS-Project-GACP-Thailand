'use strict';
/**
 * autosave-lost-reply fix round 3 (M1): the ordered draft save holds ONE pooled connection
 * for its locked transaction. A renewal or replacement claim makes the law resolver read the
 * previous certificate. If that read runs on the global client INSIDE the transaction it
 * needs a second connection; with every connection held by such saves it waits for the pool
 * and the renewal comes back unverified (or the request dies). The certificate is resolved
 * BEFORE the transaction opens, so a save works on a pool of ONE connection.
 *
 * The pool is pinned to one connection with a short timeout for this file only.
 *
 * Run: DATABASE_URL=<local migrated postgres> TEST_DATABASE_URL=<same> npx jest --config jest.config.cjs \
 *        __tests__/integration/draft-renewal-save-on-one-connection-real-postgres.test.js -i
 */
process.env.PRISMA_POOL_SIZE = '1';
process.env.PRISMA_POOL_TIMEOUT = '3';

const express = require('express');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const mockHealthIdentity = { current: null };
jest.mock('../../middleware/auth-middleware', () => {
    const asHealthUser = (req, _res, next) => {
        req.user = { ...mockHealthIdentity.current.reqUser };
        return next();
    };
    return { authenticateHealth: asHealthUser, authenticateAny: asHealthUser, authenticateProvider: asHealthUser };
});
jest.mock('../../services/application-service', () => {
    const actual = jest.requireActual('../../services/application-service');
    actual.resolveHealthIdentity = async () => mockHealthIdentity.current.identity;
    return actual;
});

d('a renewal draft save with a save clock works on a pool of one connection (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    const fx = {};
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(async () => {
        raw = new PrismaClient(); // its own pool: seeding is not what is being measured
        await raw.$connect();
        const org = await raw.organization.create({ data: { name: 'one-conn org', slug: `one-conn-${s}`, code: `ONEC_${s}`.toUpperCase().slice(0, 24) } });
        const canonicalId = `one-conn-canon-${s}`;
        const user = await raw.user.create({ data: { canonicalId, password: 'x', organizationId: org.id, authType: 'EMAIL_LEGACY' } });
        const entity = await raw.entity.create({ data: { type: 'INDIVIDUAL', displayName: 'ทดสอบ ต่ออายุ', organizationId: org.id } });
        // R2 Task 8 (spec 2026-09-30 §3.2): a draft write needs the caller's ACTIVE,
        // non-VIEWER membership on the draft's holder (holderScope(req).editIds); a renewal
        // also needs SUBMIT_APPLICATION on the certificate's holder (operator ruling 2026-10-03).
        await raw.entityMembership.create({
            data: { userId: user.id, entityId: entity.id, role: 'OWNER', status: 'ACTIVE', organizationId: org.id },
        });
        const farm = await raw.farm.create({
            data: {
                ownerId: user.id, organizationId: org.id, farmName: `สวนต่ออายุ ${s}`, farmType: 'CULTIVATION', address: '1 หมู่ 1',
                subDistrict: 'ต', district: 'อ', province: 'จ', postalCode: '50000', totalArea: 10, cultivationArea: 8,
                cultivationMethod: 'OUTDOOR', status: 'ACTIVE',
            },
        });
        const issuedFor = await raw.application.create({
            data: {
                applicationNumber: `ONEC-OLD-${s}`, healthId: canonicalId, entityId: entity.id, submitterId: user.id,
                areaType: 'OUTDOOR', organizationId: org.id, status: 'CERTIFIED', formData: { plantId: 'cannabis' },
            },
        });
        const certificateNumber = `GACP-ONEC-${s}`.slice(0, 40);
        await raw.certificate.create({
            data: {
                organizationId: org.id, farmId: farm.id, applicationId: issuedFor.id, userId: user.id,
                verificationCode: `VC-${s}`, qrData: 'x', farmName: 'สวนต่ออายุ', applicantName: 'ทดสอบ ต่ออายุ', cropType: 'cannabis',
                farmSize: 10, province: 'จ', district: 'อ', subDistrict: 'ต', standardId: 'THAI_GACP', standardName: 'GACP',
                issuedBy: 'DTAM', certificateNumber, status: 'active', issuedDate: new Date('2026-01-01'),
                expiryDate: new Date(Date.now() + 60 * 24 * 3600 * 1000),
            },
        });
        const draft = await raw.application.create({
            data: {
                applicationNumber: `ONEC-NEW-${s}`, healthId: canonicalId, entityId: entity.id, submitterId: user.id,
                areaType: 'OUTDOOR', organizationId: org.id, status: 'DRAFT', formData: { steps: {} },
            },
        });
        Object.assign(fx, { orgId: org.id, userId: user.id, canonicalId, entityId: entity.id, farmId: farm.id, certificateNumber, draftId: draft.id });
        mockHealthIdentity.current = {
            reqUser: { id: user.id, role: 'health', canonicalRole: 'health' },
            identity: { userId: user.id, healthId: canonicalId },
        };
        const router = require('../../routes/api/applications/applications');
        const { runWithTenantContext } = require('../../services/tenant-context');
        app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            runWithTenantContext({ organizationId: fx.orgId }, () => next());
        });
        app.use('/api/applications', router);
    });

    afterAll(async () => {
        await raw.certificate.deleteMany({ where: { userId: fx.userId } }).catch(() => {});
        await raw.application.deleteMany({ where: { healthId: fx.canonicalId } }).catch(() => {});
        await raw.farm.deleteMany({ where: { id: fx.farmId } }).catch(() => {});
        await raw.entityMembership.deleteMany({ where: { entityId: fx.entityId } }).catch(() => {});
        await raw.entity.deleteMany({ where: { id: fx.entityId } }).catch(() => {});
        await raw.user.deleteMany({ where: { id: fx.userId } }).catch(() => {});
        await raw.organization.deleteMany({ where: { id: fx.orgId } }).catch(() => {});
        await raw.$disconnect();
    });

    test('the previous certificate is verified and the renewal granted, within the pool timeout', async () => {
        const started = Date.now();
        const res = await request(app).post('/api/applications/draft').send({
            applicationId: fx.draftId,
            plantId: 'cannabis',
            step: 1,
            formData: { requestType: 'RENEWAL', previousCertificateNumber: fx.certificateNumber, plantId: 'cannabis' },
            saveSession: 'sess-one', saveSeq: 1,
        });
        const took = Date.now() - started;
        expect(res.status).toBe(200);
        expect(res.body.data.lawNotice).toBeNull();
        expect(res.body.data.requestType).toBe('RENEWAL');
        expect(took).toBeLessThan(2500);
        const row = await raw.application.findUnique({ where: { id: fx.draftId } });
        expect(row.formData.requestType).toBe('RENEWAL');
        expect(row.formData.renewalOfCertificateNumber).toBe(fx.certificateNumber);
    }, 30000);
});
