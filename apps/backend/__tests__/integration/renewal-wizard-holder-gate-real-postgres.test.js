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
 * Real Postgres, the real prisma-database client, the real tenant-context
 * middleware, the real consent gate (consents are seeded). Only
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
    const bindTenant = tenantContextMiddleware();
    const attach = (req, res, next) => {
        req.user = { ...mockActor.current };
        return bindTenant(req, res, next);
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
    // R2 Task 12: no workspace header; the draft's own holder decides.
    const claim = (kind, draftId) => request(app).post('/api/applications/draft')
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
    const submit = (draftId) => request(app).post('/api/applications/submit')
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
    const bundleAndSubmit = async (draftId) => {
        const made = await request(app).post('/api/applications/bundles')
            .send({ applications: [draftId] });
        const bundleId = made.body?.data?.id;
        expect({ status: made.status, bundleId: Boolean(bundleId) }).toEqual({ status: 200, bundleId: true });
        return request(app).post(`/api/applications/bundles/${bundleId}/submit`).send({});
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
        app.use('/api/applications/renewals', require('../../routes/api/applications/renewals'));
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
        // R2 Task 12: a revoked X can no longer read C's certificate at all, so the
        // draft door answers NOT_FOUND for it (a member of C still hears OTHER_HOLDER).
        describe.each([
            ['a VIEWER of C', 'VIEWER', 'ACTIVE', 'PREVIOUS_CERTIFICATE_OTHER_HOLDER'],
            ['revoked from C', 'MANAGER', 'REVOKED', 'PREVIOUS_CERTIFICATE_NOT_FOUND'],
        ])('X is %s and files under personal entity P', (_label, role, status, pNotice) => {
            test(`the draft door does not judge the P draft a ${kind} of C's certificate`, async () => {
                await setRoleInC(role, status);
                const draft = await mkDraft(`DP-${kind}-${role}-${status}`, fx.P);
                const res = await claim(kind, draft);
                expect({
                    status: res.status,
                    requestType: res.body?.data?.requestType,
                    notice: res.body?.data?.lawNotice?.code ?? null,
                    stored: await lawOf(draft),
                }).toEqual({
                    status: 200,
                    requestType: 'NEW',
                    notice: pNotice,
                    stored: { status: 'DRAFT', requestType: 'NEW', linked: null },
                });
                expect(witnessLogs()).toEqual([]);
            });

            test(`a P draft already judged a ${kind} of C's certificate is refused at submit: no state change, no quotation`, async () => {
                await setRoleInC(role, status);
                const draft = await mkDraft(`SP-${kind}-${role}-${status}`, fx.P, classifiedAs(kind));
                await attachPapers(draft);
                const res = await submit(draft);
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
            const res = await claim(kind, draft);
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
            const res = await claim(kind, draft);
            expect({ status: res.status, requestType: res.body?.data?.requestType, notice: res.body?.data?.lawNotice ?? null })
                .toEqual({ status: 200, requestType: kind, notice: null });
            expect(await lawOf(draft)).toEqual({ status: 'DRAFT', requestType: kind, linked: fx.certC });
            expect(witnessLogs()).toEqual([]);
        });

        test(`X is OWNER of C, draft under C: ${kind} accepted, and submit takes its path`, async () => {
            await setRoleInC('OWNER');
            // One succession of a certificate in flight at a time (RENEWAL_ALREADY_IN_PROGRESS):
            // the other kind's filing from the previous case is retired first.
            for (const path of [['renewalOf'], ['replacementOf']]) {
                // eslint-disable-next-line gacp/no-direct-application-status-write -- fixture: retire the previous case's filing
                await raw.application.updateMany({
                    where: { organizationId: fx.org, status: { notIn: ['DRAFT', 'CERTIFIED'] }, formData: { path, equals: fx.certC } },
                    data: { status: 'CANCEL_EXPIRED' },
                });
            }
            const draft = await mkDraft(`DC-OWN-${kind}`, fx.C);
            await attachPapers(draft);
            const accepted = await claim(kind, draft);
            expect({ status: accepted.status, requestType: accepted.body?.data?.requestType, notice: accepted.body?.data?.lawNotice ?? null })
                .toEqual({ status: 200, requestType: kind, notice: null });
            const res = await submit(draft);
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
        test(`/prepare never moves a ${kind} of C's certificate to P (B11): the draft and its claim stay under C`, async () => {
            await setRoleInC('OWNER');
            const draft = await mkDraft(`PREP-${kind}`, fx.C);
            const accepted = await claim(kind, draft);
            expect(accepted.body?.data?.requestType).toBe(kind);

            // R2 (spec 2026-09-30 §3.2, B11): /prepare never re-homes a draft; a body
            // entityId is dropped. The claim was judged for C and stays with C, so it
            // can never be carried to another holder through this door.
            // A body naming P: 200, nothing moves (R2 Task 12: no header, so there is no
            // "acting on P" any more; asking twice changes nothing either).
            const prepared = await request(app).post('/api/applications/prepare')
                .send({ applicationId: draft, entityId: fx.P });
            const again = await request(app).post('/api/applications/prepare')
                .send({ applicationId: draft, entityId: fx.P });
            expect({ status: prepared.status, again: again.status, stored: await filedAs(draft) }).toEqual({
                status: 200,
                again: 200,
                stored: { status: 'DRAFT', entityId: 'C', requestType: kind, linked: fx.certC, stampedSlots: null },
            });
            expect(witnessLogs()).toEqual([]);
        });

        test(`a P draft still carrying a ${kind} of C's certificate is refused at BUNDLE submit: 422, no state change, audit row`, async () => {
            await setRoleInC('OWNER');
            const draft = await mkDraft(`BND-${kind}`, fx.P, classifiedAs(kind));
            await attachPapers(draft);
            const res = await bundleAndSubmit(draft);
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
    // Operator ruling 2026-10-03: same holder + SUBMIT_APPLICATION is enough; who filed
    // the previous certificate does not matter (no filer match at the draft door).
    test('X, OWNER of C, judges a RENEWAL of C\'s certificate that another member filed', async () => {
        await setRoleInC('OWNER');
        const otherId = crypto.randomUUID();
        await raw.user.create({
            data: {
                id: otherId, canonicalId: `rw-o-${sfx}`, healthId: `rw-o-${sfx}`, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `rw-o-${sfx}@example.test`, firstName: 'ทดสอบ', lastName: 'ผู้ยื่นเดิม', organizationId: fx.org,
            },
        });
        await raw.certificate.update({ where: { id: fx.certC }, data: { userId: otherId, submittedByUserId: otherId } });
        try {
            const draft = await mkDraft('DC-NONFILER', fx.C);
            const res = await claim('RENEWAL', draft);
            expect({ status: res.status, requestType: res.body?.data?.requestType, notice: res.body?.data?.lawNotice?.code ?? null })
                .toEqual({ status: 200, requestType: 'RENEWAL', notice: null });
            expect(await lawOf(draft)).toEqual({ status: 'DRAFT', requestType: 'RENEWAL', linked: fx.certC });
            expect(witnessLogs()).toEqual([]);
        } finally {
            await raw.certificate.update({ where: { id: fx.certC }, data: { userId: fx.X.id, submittedByUserId: fx.X.id } });
            await raw.user.delete({ where: { id: otherId } }).catch(() => {});
        }
    });
    // Re-review of the renewal ruling: one in-flight succession per certificate, also at submit.
    test('a draft claiming a RENEWAL of C\'s certificate while another renewal of it is in flight is refused at submit: 409, nothing changed', async () => {
        await setRoleInC('OWNER');
        const inFlight = await raw.application.create({
            data: {
                applicationNumber: `APP-RW-INFLIGHT-${sfx}`, healthId: fx.X.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.org, entityId: fx.C, submitterId: fx.X.id, status: 'PENDING_AUDIT_FEE',
                formData: { ...completeCanonicalFormData(), requestType: 'RENEWAL', renewalOf: fx.certC },
            },
        });
        fx.appIds.push(inFlight.id);
        try {
            const draft = await mkDraft('DC-DUP', fx.C, classifiedAs('RENEWAL'));
            await attachPapers(draft);
            const res = await submit(draft);
            expect({ status: res.status, code: res.body?.code || res.body?.error || null, stored: (await lawOf(draft)).status, written: await writtenFor(draft) })
                .toEqual({ status: 409, code: 'RENEWAL_ALREADY_IN_PROGRESS', stored: 'DRAFT', written: { quotations: 0, invoices: 0 } });
            expect(witnessLogs()).toEqual([]);
        } finally {
            // eslint-disable-next-line gacp/no-direct-application-status-write -- fixture cleanup
            await raw.application.update({ where: { id: inFlight.id }, data: { status: 'CANCEL_EXPIRED' } });
        }
    });
    // Decision 2 of the re-review: the in-flight check and the status transition of a
    // succession claim run under the same per-certificate advisory lock as the renewal
    // door, inside the submit transaction.
    describe('concurrent successions of one certificate', () => {
        const retireSuccessions = async () => {
            for (const path of [['renewalOf'], ['replacementOf']]) {
                // eslint-disable-next-line gacp/no-direct-application-status-write -- fixture: retire earlier filings
                await raw.application.updateMany({
                    where: { organizationId: fx.org, status: { notIn: ['DRAFT', 'CERTIFIED'] }, formData: { path, equals: fx.certC } },
                    data: { status: 'CANCEL_EXPIRED' },
                });
            }
        };
        const leftDraft = async (ids) => (await raw.application.findMany({ where: { id: { in: ids } }, select: { status: true } }))
            .filter((r) => r.status !== 'DRAFT').length;

        test('two drafts claiming a RENEWAL of the same certificate, submitted at the same moment: one leaves DRAFT, the other 409', async () => {
            await setRoleInC('OWNER');
            await retireSuccessions();
            const d1 = await mkDraft('RACE-1', fx.C, classifiedAs('RENEWAL'));
            const d2 = await mkDraft('RACE-2', fx.C, classifiedAs('RENEWAL'));
            await attachPapers(d1);
            await attachPapers(d2);
            const [r1, r2] = await Promise.all([submit(d1), submit(d2)]);
            // Exactly one submitted and exactly one refused (a race has no fixed order).
            expect([r1, r2].filter((r) => r.status === 200)).toHaveLength(1);
            expect([r1, r2].filter((r) => r.status === 409)).toHaveLength(1);
            expect([r1, r2].find((r) => r.status === 409).body?.code).toBe('RENEWAL_ALREADY_IN_PROGRESS');
            expect(await leftDraft([d1, d2])).toBe(1);
            expect(witnessLogs()).toEqual([]);
        });

        test('a draft submit racing the renewal door on the same certificate: exactly one succeeds', async () => {
            await setRoleInC('OWNER');
            await retireSuccessions();
            const d = await mkDraft('RACE-DOOR', fx.C, classifiedAs('RENEWAL'));
            await attachPapers(d);
            const [sub, door] = await Promise.all([
                submit(d),
                request(app).post('/api/applications/renewals').send({ originalCertificateId: fx.certC }),
            ]);
            const succeeded = [sub.status === 200, door.status === 201].filter(Boolean).length;
            expect({ succeeded, refused: [sub.status, door.status].includes(409) }).toEqual({ succeeded: 1, refused: true });
            const inFlight = await raw.application.count({
                where: { organizationId: fx.org, status: { notIn: ['DRAFT', 'CERTIFIED', 'CANCEL_EXPIRED'] }, formData: { path: ['renewalOf'], equals: fx.certC } },
            });
            expect(inFlight).toBe(1);
            if (door.status === 201) { fx.appIds.push(door.body.data.applicationId); }
        });
    });
});
