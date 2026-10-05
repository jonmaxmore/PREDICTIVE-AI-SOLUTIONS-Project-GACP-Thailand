'use strict';

/**
 * The wizard renewal and replacement doors (operator ruling 2026-10-03: a renewal is a
 * submission; the same rule closes the same hole for a replacement).
 *
 * A filing is judged as a RENEWAL or a REPLACEMENT only when
 *   (a) the previous certificate's holder (its application.entityId) IS the filing's
 *       holder: a certificate of company C cannot be renewed into a personal entity P;
 *   (b) the actor holds SUBMIT_APPLICATION on that holder.
 * Checked when the draft door classifies the claim (POST /api/applications/draft) and
 * again at submit (POST /api/applications/submit), before any state change, fee,
 * quotation or invoice. Membership can change between the two.
 *
 * Real Postgres, the real prisma-database client, the real tenant-context and
 * active-entity middlewares, the real consent gate (consents are seeded). Only
 * authentication is attached by hand. The read witness runs in throw mode.
 *
 * Fixture: user X filed company C's CERTIFIED certificate. P is X's personal entity
 * (X OWNER). X's role in C changes between tests.
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
    const { activeEntityMiddleware } = jest.requireActual('../../middleware/active-entity-middleware');
    const bindTenant = tenantContextMiddleware();
    const bindEntity = activeEntityMiddleware();
    const attach = (req, res, next) => {
        req.user = { ...mockActor.current };
        return bindTenant(req, res, () => bindEntity(req, res, next));
    };
    return { ...actual, authenticateAny: attach, authenticateHealth: attach, authenticateProvider: attach, authenticateToken: attach };
});

const sharedLogger = require('../../shared/logger');
const witnessConfig = require('../../config/holder-read-witness');
const { ConsentCategory, ConsentVersions } = require('../../middleware/consent-manager');

function completeCanonicalFormData() {
    return {
        plantId: 'cannabis',
        serviceType: 'NEW',
        certificationPurposes: ['EXPORT'],
        locationType: 'OUTDOOR',
        cultivationMethods: ['outdoor'],
        consentedPDPA: true,
        acknowledgedStandards: true,
        applicantData: {
            applicantType: 'JURISTIC',
            companyName: 'บริษัท ทดสอบต่ออายุ จำกัด',
            registrationNumber: '0105560000001',
            directorName: 'สมชาย ใจดี',
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            idCard: '1100000000008',
            phone: '0812345678',
            email: 'somchai@example.com',
            address: '123 หมู่ 4',
        },
        farmData: {
            farmName: 'ฟาร์มสมชาย',
            address: '123 หมู่ 4',
            province: 'สมุทรปราการ',
            district: 'บางพลี',
            subdistrict: 'บางพลีใหญ่',
            postalCode: '10540',
            totalAreaSize: '5',
            totalAreaUnit: 'Rai',
            landOwnership: 'OWN',
            gpsLat: '13.12',
            gpsLng: '100.65',
        },
        plots: [{ id: 'p1', name: 'แปลงที่ 1', areaSize: '2', areaUnit: 'Rai', solarSystem: 'OUTDOOR' }],
        productionData: { propagationType: ['SEED'], plantParts: ['FLOWER'] },
        harvestData: { harvestMethod: 'MANUAL', dryingMethod: 'SUN', storageSystem: 'AMBIENT' },
        documents: [{ name: 'doc.pdf', url: '/uploads/doc.pdf', type: 'LAND_RIGHT' }],
    };
}

d('wizard renewal door: same holder + SUBMIT_APPLICATION on it (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    let warn;
    const sfx = crypto.randomUUID().slice(0, 8);
    const fx = { entityIds: [], appIds: [] };
    const ORIGINAL_MODE = process.env.HOLDER_READ_WITNESS;

    const witnessLogs = () => warn.mock.calls
        .map((c) => c[1])
        .filter((m) => m && m.signal === 'HEALTH_READ_UNSCOPED')
        .map((m) => `${m.model}.${m.op}`);

    const setRoleInC = async (role, status = 'ACTIVE') => {
        await raw.entityMemberPermissionGrant.deleteMany({ where: { membershipId: fx.membershipC } });
        await raw.entityMembership.update({ where: { id: fx.membershipC }, data: { role, status } });
    };
    const grantSubmitInC = () => raw.entityMemberPermissionGrant.create({
        data: { membershipId: fx.membershipC, permission: 'SUBMIT_APPLICATION', effect: 'GRANT', grantedBy: fx.X.id, organizationId: fx.org },
    });
    const mkDraft = async (label, entityId, extraFormData = {}) => {
        const row = await raw.application.create({
            data: {
                applicationNumber: `APP-RW-${label}-${sfx}`, healthId: fx.X.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.org, entityId, submitterId: fx.X.id, status: 'DRAFT',
                formData: { ...completeCanonicalFormData(), workflowState: 'DRAFT', ...extraFormData },
            },
        });
        fx.appIds.push(row.id);
        return row.id;
    };
    // What the pre-fix draft door wrote for a claim it accepted (application-law-dimensions).
    const classifiedAs = (kind) => ({
        requestType: kind,
        renewalOf: kind === 'RENEWAL' ? fx.certC : null,
        replacementOf: kind === 'REPLACEMENT' ? fx.certC : null,
        renewalOfCertificateNumber: fx.certNumber,
        renewalOfExpiryDate: fx.certExpiry.toISOString(),
    });
    const claim = (kind, draftId, entityId) => request(app).post('/api/applications/draft')
        .set({ 'x-active-entity-id': entityId })
        .send({ applicationId: draftId, formData: { requestType: kind, previousCertificateNumber: fx.certNumber } });
    // The papers each judged filing asks for here: the company registration, and for a
    // REPLACEMENT one of police report / damaged certificate, and the licence of the claimed purpose EXPORT (ภ.ท.10).
    const attachPapers = async (draftId) => {
        for (const [documentType, slotId] of [['JURISTIC_REG_6M', 'juristic_reg_6m'], ['POLICE_REPORT', 'police_report'], ['LICENCE_PT10', 'licence_pt10']]) {
            await raw.applicationDocument.create({
                data: { applicationId: draftId, documentType, slotId, fileName: `${slotId}.pdf`, fileUrl: `/uploads/${slotId}.pdf`, currentForSlot: slotId },
            });
        }
    };
    const submit = (draftId, entityId) => request(app).post('/api/applications/submit')
        .set({ 'x-active-entity-id': entityId })
        .send({ applicationId: draftId, declarationsAccepted: true });
    const lawOf = async (draftId) => {
        const row = await raw.application.findUnique({ where: { id: draftId } });
        return {
            status: row.status,
            requestType: row.formData.requestType ?? null,
            linked: row.formData.renewalOf ?? row.formData.replacementOf ?? null,
        };
    };
    const writtenFor = async (draftId) => ({
        quotations: await raw.quotation.count({ where: { applicationId: draftId } }),
        invoices: await raw.invoice.count({ where: { applicationId: draftId } }),
    });
    // Round 2: the bundle door and /prepare (which re-points a draft's holder).
    const prepareUnder = (draftId, entityId) => request(app).post('/api/applications/prepare')
        .set({ 'x-active-entity-id': entityId }).send({ applicationId: draftId });
    const bundleAndSubmit = async (draftId, entityId) => {
        const made = await request(app).post('/api/applications/bundles')
            .set({ 'x-active-entity-id': entityId }).send({ applications: [draftId] });
        const bundleId = made.body?.data?.id;
        expect({ status: made.status, bundleId: Boolean(bundleId) }).toEqual({ status: 200, bundleId: true });
        return request(app).post(`/api/applications/bundles/${bundleId}/submit`).set({ 'x-active-entity-id': entityId }).send({});
    };
    const filedAs = async (draftId) => {
        const row = await raw.application.findUnique({ where: { id: draftId } });
        return {
            status: row.status,
            entityId: row.entityId === fx.P ? 'P' : (row.entityId === fx.C ? 'C' : row.entityId),
            requestType: row.formData.requestType ?? null,
            linked: row.formData.renewalOf ?? row.formData.replacementOf ?? null,
            stampedSlots: row.formData.serverRequirementSnapshot?.slotIds ?? null,
        };
    };
    const deniedAuditRows = (draftId) => raw.auditLog.count({
        where: { action: 'APPLICATION_SUBMIT_DENIED', actorId: fx.X.id, resourceId: draftId },
    });

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        fx.org = (await raw.organization.create({ data: { name: `rw-${sfx}`, slug: `rw-${sfx}`, code: `RW_${sfx}`.toUpperCase() } })).id;
        const xId = crypto.randomUUID();
        const canonicalId = `rw-x-${sfx}`;
        await raw.user.create({
            data: {
                id: xId, canonicalId, healthId: canonicalId, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `rw-x-${sfx}@example.test`, firstName: 'ทดสอบ', lastName: 'ต่ออายุ', organizationId: fx.org,
            },
        });
        fx.X = { id: xId, canonicalId };
        for (const category of [ConsentCategory.TERMS_OF_SERVICE, ConsentCategory.PRIVACY_POLICY, ConsentCategory.PAYMENT_TERMS]) {
            await raw.userConsent.create({
                data: { userId: xId, organizationId: fx.org, category, version: ConsentVersions[category] || '1.0', granted: true, grantedAt: new Date() },
            });
        }
        fx.P = (await raw.entity.create({ data: { type: 'INDIVIDUAL', displayName: `rw x ${sfx}`, organizationId: fx.org } })).id;
        fx.C = (await raw.entity.create({ data: { type: 'JURISTIC', displayName: `บริษัท rw ${sfx} จำกัด`, organizationId: fx.org } })).id;
        fx.entityIds.push(fx.P, fx.C);
        await raw.entityMembership.create({ data: { userId: xId, entityId: fx.P, role: 'OWNER', status: 'ACTIVE', organizationId: fx.org } });
        fx.membershipC = (await raw.entityMembership.create({
            data: { userId: xId, entityId: fx.C, role: 'OWNER', status: 'ACTIVE', organizationId: fx.org },
        })).id;
        fx.farm = (await raw.farm.create({
            data: {
                ownerId: xId, farmName: `ฟาร์ม rw ${sfx}`, farmType: 'CULTIVATION', address: '1', province: 'สมุทรปราการ',
                district: 'บางพลี', subDistrict: 'บางพลีใหญ่', postalCode: '10540', totalArea: 1, cultivationArea: 1,
                cultivationMethod: 'OUTDOOR', organizationId: fx.org, entityId: fx.C,
            },
        })).id;
        const source = await raw.application.create({
            data: {
                applicationNumber: `APP-RW-SRC-${sfx}`, healthId: canonicalId, areaType: 'OUTDOOR', organizationId: fx.org,
                entityId: fx.C, submitterId: xId, status: 'CERTIFIED',
                formData: { plantId: 'cannabis', cultivationMethods: ['outdoor'], workflowState: 'CERTIFIED' },
            },
        });
        fx.appIds.push(source.id);
        fx.certNumber = `GACP-RW-${sfx}`;
        fx.certExpiry = new Date(Date.now() + 20 * 86400e3);
        fx.certC = (await raw.certificate.create({
            data: {
                certificateNumber: fx.certNumber, verificationCode: `V-RW-${sfx}`, qrData: 'qr', applicationId: source.id, userId: xId,
                farmId: fx.farm, farmName: 'ฟาร์ม', applicantName: 'ทดสอบ', cropType: 'cannabis', farmSize: 1, province: 'สมุทรปราการ',
                district: 'บางพลี', subDistrict: 'บางพลีใหญ่', standardId: 'std', standardName: 'GACP', expiryDate: fx.certExpiry,
                issuedBy: xId, status: 'active', organizationId: fx.org, holderDisplayName: `บริษัท rw ${sfx} จำกัด`,
                holderType: 'JURISTIC', submittedByUserId: xId,
            },
        })).id;

        mockActor.current = { id: xId, canonicalId, healthId: canonicalId, role: 'health', canonicalRole: 'health', organizationId: fx.org };
        app = express();
        app.use(express.json());
        app.use('/api/applications/bundles', require('../../routes/api/applications/application-bundles'));
        app.use('/api/applications', require('../../routes/api/applications/applications'));
    });

    afterAll(async () => {
        if (ORIGINAL_MODE === undefined) { delete process.env.HOLDER_READ_WITNESS; } else { process.env.HOLDER_READ_WITNESS = ORIGINAL_MODE; }
        witnessConfig.resetHolderReadWitnessModeCache();
        if (!raw) { return; }
        const appIds = (await raw.application.findMany({ where: { organizationId: fx.org }, select: { id: true } })).map((r) => r.id);
        const wipe = async (model, where) => {
            if (!raw[model] || Object.values(where).some((v) => v === undefined || v === null)) { return; }
            await raw[model].deleteMany({ where }).catch(() => {});
        };
        await wipe('certificate', { id: fx.certC });
        await wipe('farm', { organizationId: fx.org });
        const orders = await raw.checkoutOrder.findMany({ where: { applicationId: { in: appIds } } }).catch(() => []);
        await wipe('checkoutOrder', { applicationId: { in: appIds } });
        await wipe('invoiceLineItem', { invoiceId: { in: orders.map((o) => o.invoiceId).filter(Boolean) } });
        for (const model of ['paymentTransaction', 'invoice', 'quotation', 'documentPrecheck', 'applicationDocument', 'workActivity']) {
            await wipe(model, { applicationId: { in: appIds } });
        }
        await raw.application.updateMany({ where: { id: { in: appIds } }, data: { bundleId: null } }).catch(() => {});
        await wipe('applicationBundle', { healthId: fx.X?.canonicalId });
        await wipe('auditLog', { resourceId: { in: appIds } });
        await wipe('application', { id: { in: appIds } });
        await wipe('userConsent', { userId: fx.X?.id });
        await wipe('entityMemberPermissionGrant', { organizationId: fx.org });
        await wipe('entityMembership', { entityId: { in: fx.entityIds } });
        await wipe('entity', { id: { in: fx.entityIds } });
        await wipe('user', { id: fx.X?.id });
        await wipe('organization', { id: fx.org });
        await raw.$disconnect();
    });

    beforeEach(() => {
        process.env.HOLDER_READ_WITNESS = 'throw';
        witnessConfig.resetHolderReadWitnessModeCache();
        warn = jest.spyOn(sharedLogger, 'warn');
    });
    afterEach(() => { if (warn) { warn.mockRestore(); } });

    // RENEWAL skips the document review and is priced as a renewal; REPLACEMENT is judged
    // by two document rows instead of the full set. Both remove requirements, so both are
    // claims about a certificate and both follow the same rule.
    describe.each([
        ['RENEWAL', 'PENDING_AUDIT_FEE'],
        ['REPLACEMENT', 'PENDING_DOC_FEE'],
    ])('%s claim', (kind, entryState) => {
        describe.each([
            ['a VIEWER of C', 'VIEWER', 'ACTIVE'],
            ['revoked from C', 'MANAGER', 'REVOKED'],
        ])('X is %s and files under personal entity P', (_label, role, status) => {
            test(`the draft door does not judge the P draft a ${kind} of C's certificate`, async () => {
                await setRoleInC(role, status);
                const draft = await mkDraft(`DP-${kind}-${role}-${status}`, fx.P);
                const res = await claim(kind, draft, fx.P);
                expect({
                    status: res.status,
                    requestType: res.body?.data?.requestType,
                    notice: res.body?.data?.lawNotice?.code ?? null,
                    stored: await lawOf(draft),
                }).toEqual({
                    status: 200,
                    requestType: 'NEW',
                    notice: 'PREVIOUS_CERTIFICATE_OTHER_HOLDER',
                    stored: { status: 'DRAFT', requestType: 'NEW', linked: null },
                });
                expect(witnessLogs()).toEqual([]);
            });

            test(`a P draft already judged a ${kind} of C's certificate is refused at submit: no state change, no quotation`, async () => {
                await setRoleInC(role, status);
                const draft = await mkDraft(`SP-${kind}-${role}-${status}`, fx.P, classifiedAs(kind));
                await attachPapers(draft);
                const res = await submit(draft, fx.P);
                expect({
                    status: res.status,
                    code: res.body?.code || res.body?.error || null,
                    stored: (await lawOf(draft)).status,
                    written: await writtenFor(draft),
                    deniedAudit: await deniedAuditRows(draft),
                }).toEqual({
                    status: 422,
                    code: 'RENEWAL_HOLDER_MISMATCH',
                    stored: 'DRAFT',
                    written: { quotations: 0, invoices: 0 },
                    deniedAudit: 1,
                });
                expect(witnessLogs()).toEqual([]);
            });
        });

        test(`X is a MANAGER of C without the grant: the C draft is not judged a ${kind}`, async () => {
            await setRoleInC('MANAGER');
            const draft = await mkDraft(`DC-MGR-${kind}`, fx.C);
            const res = await claim(kind, draft, fx.C);
            expect({
                status: res.status,
                requestType: res.body?.data?.requestType,
                notice: res.body?.data?.lawNotice?.code ?? null,
                stored: await lawOf(draft),
            }).toEqual({
                status: 200,
                requestType: 'NEW',
                notice: 'PREVIOUS_CERTIFICATE_NO_SUBMIT_RIGHT',
                stored: { status: 'DRAFT', requestType: 'NEW', linked: null },
            });
            expect(witnessLogs()).toEqual([]);
        });

        test(`X is a MANAGER of C with a SUBMIT_APPLICATION grant: the C draft is judged a ${kind}`, async () => {
            await setRoleInC('MANAGER');
            await grantSubmitInC();
            const draft = await mkDraft(`DC-GRT-${kind}`, fx.C);
            const res = await claim(kind, draft, fx.C);
            expect({ status: res.status, requestType: res.body?.data?.requestType, notice: res.body?.data?.lawNotice ?? null })
                .toEqual({ status: 200, requestType: kind, notice: null });
            expect(await lawOf(draft)).toEqual({ status: 'DRAFT', requestType: kind, linked: fx.certC });
            expect(witnessLogs()).toEqual([]);
        });

        test(`X is OWNER of C, draft under C: ${kind} accepted, and submit takes its path`, async () => {
            await setRoleInC('OWNER');
            const draft = await mkDraft(`DC-OWN-${kind}`, fx.C);
            await attachPapers(draft);
            const accepted = await claim(kind, draft, fx.C);
            expect({ status: accepted.status, requestType: accepted.body?.data?.requestType, notice: accepted.body?.data?.lawNotice ?? null })
                .toEqual({ status: 200, requestType: kind, notice: null });
            const res = await submit(draft, fx.C);
            expect({ status: res.status, code: res.body?.code || res.body?.error || null, body: res.status === 200 ? null : res.body })
                .toEqual({ status: 200, code: null, body: null });
            expect((await lawOf(draft)).status).toBe(entryState);
            expect((await writtenFor(draft)).quotations).toBe(1);
            expect(witnessLogs()).toEqual([]);
        });
    });

    // Round 2 (review IMPORTANT): a claim judged under C must not survive /prepare moving
    // the draft to P, and the bundle door must apply the same holder check as /submit.
    describe.each([['RENEWAL'], ['REPLACEMENT']])('%s claim across a holder change', (kind) => {
        test(`/prepare cannot carry a ${kind} of C's certificate to P: the draft stays under C (R1) and a holder change is re-judged`, async () => {
            await setRoleInC('OWNER');
            const draft = await mkDraft(`PREP-${kind}`, fx.C);
            const accepted = await claim(kind, draft, fx.C);
            expect(accepted.body?.data?.requestType).toBe(kind);

            // Under R1 the entity dimension only finds a draft under its own holder, so
            // /prepare with the P header does not reach the C draft at all.
            const prepared = await prepareUnder(draft, fx.P);
            expect({ status: prepared.status, stored: await filedAs(draft) }).toEqual({
                status: 404,
                stored: { status: 'DRAFT', entityId: 'C', requestType: kind, linked: fx.certC, stampedSlots: null },
            });

            // The re-judge /prepare runs when the holder does change (Task 12 removes the
            // R1 intersection): on the real client, against the real certificate.
            const { prisma } = require('../../services/prisma-database');
            const { rejudgeClaimForHolder } = require('../../services/application-law-dimensions');
            const storedForm = (await raw.application.findUnique({ where: { id: draft } })).formData;
            const toP = await rejudgeClaimForHolder({ prisma, actorUserId: fx.X.id, formData: storedForm, toEntityId: fx.P });
            expect({ requestType: toP.dimensions.requestType, renewalOf: toP.dimensions.renewalOf, replacementOf: toP.dimensions.replacementOf, notice: toP.notice?.code })
                .toEqual({ requestType: 'NEW', renewalOf: null, replacementOf: null, notice: 'PREVIOUS_CERTIFICATE_OTHER_HOLDER' });
            const toC = await rejudgeClaimForHolder({ prisma, actorUserId: fx.X.id, formData: storedForm, toEntityId: fx.C });
            expect({ requestType: toC.dimensions.requestType, notice: toC.notice }).toEqual({ requestType: kind, notice: null });
            expect(witnessLogs()).toEqual([]);
        });

        test(`a P draft still carrying a ${kind} of C's certificate is refused at BUNDLE submit: 422, no state change, audit row`, async () => {
            await setRoleInC('OWNER');
            const draft = await mkDraft(`BND-${kind}`, fx.P, classifiedAs(kind));
            await attachPapers(draft);
            const res = await bundleAndSubmit(draft, fx.P);
            expect({
                status: res.status,
                code: res.body?.code || res.body?.error || null,
                stored: (await filedAs(draft)).status,
                written: await writtenFor(draft),
                deniedAudit: await deniedAuditRows(draft),
            }).toEqual({
                status: 422,
                code: 'RENEWAL_HOLDER_MISMATCH',
                stored: 'DRAFT',
                written: { quotations: 0, invoices: 0 },
                deniedAudit: 1,
            });
            const row = await raw.auditLog.findFirst({ where: { action: 'APPLICATION_SUBMIT_DENIED', resourceId: draft }, select: { metadata: true } });
            // audit-logger persists metadata as a JSON string.
            const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            expect(meta.permission).toBe('CERTIFICATE_HOLDER_MATCH');
            expect(witnessLogs()).toEqual([]);
        });
    });
});
