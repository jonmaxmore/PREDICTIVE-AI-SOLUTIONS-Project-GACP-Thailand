'use strict';

/**
 * A renewal is a submission (operator ruling 2026-10-03): POST
 * /api/applications/renewals requires SUBMIT_APPLICATION on the source
 * certificate's holder entity, checked before any row is written.
 *
 * Real Postgres, the real prisma-database client, the real renewal-service and
 * the real tenant-context middleware. Only authentication is
 * attached by hand. The read witness runs in throw mode, so an unscoped health
 * read on the renewal path answers 500 instead of its normal status.
 *
 * Fixture: company C holds four ACTIVE certificates, one per filer. Each filer
 * is the certificate's own userId (the pre-existing owner check passes for all
 * of them), so the only thing that differs is the filer's role in C:
 *   OWNER                              → 201, one application, one quotation
 *   VIEWER                             → 403, nothing written
 *   MANAGER, no SUBMIT_APPLICATION     → 403, nothing written
 *   MANAGER + SUBMIT_APPLICATION GRANT → 201
 * plus a non-member on the OWNER's certificate → 404 (R2 Task 12: the certificate
 * is read within the holder scope), nothing written, and a certificate whose
 * source application has no holder → 404 (no filer fallback, spec §3.1), nothing written.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const mockActor = { current: null };
jest.mock('../../middleware/auth-middleware', () => {
    const actual = jest.requireActual('../../middleware/auth-middleware');
    const { tenantContextMiddleware } = jest.requireActual('../../middleware/tenant-context-middleware');
    const bindTenant = tenantContextMiddleware();
    const attach = (req, res, next) => {
        req.user = { ...mockActor.current };
        return bindTenant(req, res, next);
    };
    return { ...actual, authenticateAny: attach, authenticateHealth: attach, authenticateProvider: attach, authenticateToken: attach };
});

const sharedLogger = require('../../shared/logger');
const witnessConfig = require('../../config/holder-read-witness');

d('renewal requires SUBMIT_APPLICATION on the certificate holder (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    let warn;
    const sfx = crypto.randomUUID().slice(0, 8);
    const fx = { userIds: [], entityIds: [], appIds: [], certIds: [], sourceOf: {} };
    // The refusal row the submit doors write (application-submit-guard), against the source application.
    const deniedAudit = (user, certId) => raw.auditLog.findMany({
        where: { action: 'APPLICATION_SUBMIT_DENIED', actorId: user.id, resourceId: fx.sourceOf[certId] },
        select: { result: true, errorCode: true },
    });
    const ORIGINAL_MODE = process.env.HOLDER_READ_WITNESS;

    const witnessLogs = () => warn.mock.calls
        .map((c) => c[1])
        .filter((m) => m && m.signal === 'HEALTH_READ_UNSCOPED')
        .map((m) => `${m.model}.${m.op}`);

    const mkUser = async (name) => {
        const id = crypto.randomUUID();
        const canonicalId = `rc-${name}-${sfx}`;
        await raw.user.create({
            data: {
                id, canonicalId, healthId: canonicalId, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `rc-${name}-${sfx}@example.test`, firstName: 'ทดสอบ', lastName: name, organizationId: fx.org,
            },
        });
        fx.userIds.push(id);
        return { id, canonicalId };
    };
    const join = async (user, role) => raw.entityMembership.create({
        data: { userId: user.id, entityId: fx.C, role, status: 'ACTIVE', organizationId: fx.org },
    });
    // A CERTIFIED source application held by C and filed by `user`, and the ACTIVE
    // certificate issued from it to the same user.
    const mkCertified = async (user, label, holder = fx.C) => {
        const a = await raw.application.create({
            data: {
                applicationNumber: `APP-RC-${label}-${sfx}`, healthId: user.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.org, entityId: holder, submitterId: user.id, status: 'CERTIFIED',
                formData: { plantId: 'cannabis', cultivationMethods: ['outdoor'], workflowState: 'CERTIFIED' },
            },
        });
        fx.appIds.push(a.id);
        const c = await raw.certificate.create({
            data: {
                certificateNumber: `GACP-RC-${label}-${sfx}`, verificationCode: `V-${label}-${sfx}`, qrData: 'qr',
                applicationId: a.id, userId: user.id, farmId: fx.farm, farmName: 'ฟาร์ม', applicantName: 'ทดสอบ', cropType: 'cannabis',
                farmSize: 1, province: 'สมุทรปราการ', district: 'บางพลี', subDistrict: 'บางพลีใหญ่', standardId: 'std',
                standardName: 'GACP', expiryDate: new Date(Date.now() + 20 * 86400e3), issuedBy: user.id, status: 'active',
                organizationId: fx.org, holderDisplayName: `บริษัท rc ${sfx} จำกัด`, holderType: 'JURISTIC', submittedByUserId: user.id,
            },
        });
        fx.certIds.push(c.id);
        fx.sourceOf[c.id] = a.id;
        return c.id;
    };
    const as = (u) => {
        mockActor.current = { id: u.id, canonicalId: u.canonicalId, healthId: u.canonicalId, role: 'health', canonicalRole: 'health', organizationId: fx.org };
    };
    const counts = async () => {
        const appIds = (await raw.application.findMany({ where: { organizationId: fx.org }, select: { id: true } })).map((r) => r.id);
        return {
            applications: appIds.length,
            quotations: await raw.quotation.count({ where: { applicationId: { in: appIds } } }),
            invoices: await raw.invoice.count({ where: { applicationId: { in: appIds } } }),
        };
    };
    // R2 Task 12: no workspace header; membership alone decides.
    const renew = (certId) => request(app)
        .post('/api/applications/renewals').send({ originalCertificateId: certId });

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        fx.org = (await raw.organization.create({ data: { name: `rc-${sfx}`, slug: `rc-${sfx}`, code: `RC_${sfx}`.toUpperCase() } })).id;
        fx.C = (await raw.entity.create({ data: { type: 'JURISTIC', displayName: `บริษัท rc ${sfx} จำกัด`, organizationId: fx.org } })).id;
        fx.entityIds.push(fx.C);
        fx.owner = await mkUser('owner');
        fx.viewer = await mkUser('viewer');
        fx.manager = await mkUser('manager');
        fx.granted = await mkUser('granted');
        fx.stranger = await mkUser('stranger');
        await join(fx.owner, 'OWNER');
        await join(fx.viewer, 'VIEWER');
        await join(fx.manager, 'MANAGER');
        const grantedMembership = await join(fx.granted, 'MANAGER');
        await raw.entityMemberPermissionGrant.create({
            data: { membershipId: grantedMembership.id, permission: 'SUBMIT_APPLICATION', effect: 'GRANT', grantedBy: fx.owner.id, organizationId: fx.org },
        });
        fx.farm = (await raw.farm.create({
            data: {
                ownerId: fx.owner.id, farmName: `ฟาร์ม rc ${sfx}`, farmType: 'CULTIVATION', address: '1', province: 'สมุทรปราการ',
                district: 'บางพลี', subDistrict: 'บางพลีใหญ่', postalCode: '10540', totalArea: 1, cultivationArea: 1,
                cultivationMethod: 'OUTDOOR', organizationId: fx.org, entityId: fx.C,
            },
        })).id;
        fx.certOwner = await mkCertified(fx.owner, 'OWN');
        fx.certViewer = await mkCertified(fx.viewer, 'VIEW');
        fx.certManager = await mkCertified(fx.manager, 'MGR');
        fx.certGranted = await mkCertified(fx.granted, 'GRT');
        // Defensive: after the D1 heal no live certificate has a null holder.
        fx.certNoHolder = await mkCertified(fx.owner, 'NUL', null);

        app = express();
        app.use(express.json());
        app.use('/api/applications/renewals', require('../../routes/api/applications/renewals'));
    });

    afterAll(async () => {
        if (ORIGINAL_MODE === undefined) { delete process.env.HOLDER_READ_WITNESS; } else { process.env.HOLDER_READ_WITNESS = ORIGINAL_MODE; }
        witnessConfig.resetHolderReadWitnessModeCache();
        if (!raw) { return; }
        const appIds = (await raw.application.findMany({ where: { organizationId: fx.org }, select: { id: true } })).map((r) => r.id);
        // Never delete with an undefined key: Prisma drops it and the filter matches every row.
        const wipe = async (model, where) => {
            if (!raw[model] || Object.values(where).some((v) => v === undefined || v === null)) { return; }
            await raw[model].deleteMany({ where }).catch(() => {});
        };
        await wipe('certificate', { id: { in: fx.certIds } });
        await wipe('farm', { id: fx.farm });
        for (const model of ['paymentTransaction', 'invoice', 'quotation', 'workActivity']) {
            await wipe(model, { applicationId: { in: appIds } });
        }
        await wipe('auditLog', { resourceId: { in: appIds } });
        await wipe('application', { id: { in: appIds } });
        await wipe('entityMemberPermissionGrant', { organizationId: fx.org });
        await wipe('entityMembership', { entityId: { in: fx.entityIds } });
        await wipe('entity', { id: { in: fx.entityIds } });
        await wipe('user', { id: { in: fx.userIds } });
        await wipe('organization', { id: fx.org });
        await raw.$disconnect();
    });

    beforeEach(() => {
        process.env.HOLDER_READ_WITNESS = 'throw';
        witnessConfig.resetHolderReadWitnessModeCache();
        warn = jest.spyOn(sharedLogger, 'warn');
    });
    afterEach(() => { if (warn) { warn.mockRestore(); } });

    test('VIEWER who filed the certificate is refused 403 and nothing is written', async () => {
        const before = await counts();
        as(fx.viewer);
        const res = await renew(fx.certViewer);
        // One assertion, so a red run shows the status and the rows it wrote together.
        expect({ status: res.status, error: res.body?.code || res.body?.error, after: await counts() })
            .toEqual({ status: 403, error: 'ENTITY_PERMISSION_DENIED', after: before });
        expect(await deniedAudit(fx.viewer, fx.certViewer)).toEqual([{ result: 'FAILURE', errorCode: 'ENTITY_PERMISSION_DENIED' }]);
        expect(witnessLogs()).toEqual([]);
    });

    test('MANAGER without a SUBMIT_APPLICATION grant who filed the certificate is refused 403 and nothing is written', async () => {
        const before = await counts();
        as(fx.manager);
        const res = await renew(fx.certManager);
        // One assertion, so a red run shows the status and the rows it wrote together.
        expect({ status: res.status, error: res.body?.code || res.body?.error, after: await counts() })
            .toEqual({ status: 403, error: 'ENTITY_PERMISSION_DENIED', after: before });
        expect(await deniedAudit(fx.manager, fx.certManager)).toEqual([{ result: 'FAILURE', errorCode: 'ENTITY_PERMISSION_DENIED' }]);
        expect(witnessLogs()).toEqual([]);
    });

    test('a non-member is refused 404 CERT_NOT_FOUND (the certificate is outside its holder scope) and nothing is written', async () => {
        const before = await counts();
        as(fx.stranger);
        const res = await renew(fx.certOwner);
        // One assertion, so a red run shows the status and the rows it wrote together.
        expect({ status: res.status, error: res.body?.code || res.body?.error, after: await counts() })
            .toEqual({ status: 404, error: 'CERT_NOT_FOUND', after: before });
        expect(witnessLogs()).toEqual([]);
    });

    test('a certificate with no holder is refused 404 CERT_NOT_FOUND (no filer fallback) and nothing is written', async () => {
        const before = await counts();
        as(fx.owner);
        const res = await renew(fx.certNoHolder);
        expect({ status: res.status, error: res.body?.code || res.body?.error, after: await counts() })
            .toEqual({ status: 404, error: 'CERT_NOT_FOUND', after: before });
        expect(witnessLogs()).toEqual([]);
    });

    test('OWNER who filed the certificate gets 201 with exactly one new application and one new quotation', async () => {
        const before = await counts();
        as(fx.owner);
        const res = await renew(fx.certOwner);
        expect(res.status).toBe(201);
        expect(witnessLogs()).toEqual([]);
        const after = await counts();
        expect(after).toEqual({ ...before, applications: before.applications + 1, quotations: before.quotations + 1 });
        const created = await raw.application.findUnique({ where: { id: res.body.data.applicationId } });
        expect({ status: created.status, entityId: created.entityId }).toEqual({ status: 'PENDING_AUDIT_FEE', entityId: fx.C });
        expect(await raw.quotation.count({ where: { applicationId: created.id } })).toBe(1);
    });

    test('MANAGER with a SUBMIT_APPLICATION GRANT gets 201', async () => {
        const before = await counts();
        as(fx.granted);
        const res = await renew(fx.certGranted);
        expect(res.status).toBe(201);
        expect(witnessLogs()).toEqual([]);
        const after = await counts();
        expect(after).toEqual({ ...before, applications: before.applications + 1, quotations: before.quotations + 1 });
    });
});
