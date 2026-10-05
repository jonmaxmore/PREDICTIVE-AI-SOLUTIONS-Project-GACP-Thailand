'use strict';

/**
 * Write doors and the certificate / document / pre-check / finance doors run
 * clean under the read witness in THROW mode (spec 2026-09-30-remove-workspace-mode
 * §3.1, Task 4), on a REAL Postgres through the REAL prisma-database client and
 * the real tenant-context + active-entity middlewares. Only authentication is
 * attached by hand; the consent gate, the pre-check queue and the certificate PDF
 * renderer are stubbed (none is the subject).
 *
 * In throw mode an unscoped health read of a watched model rejects before it
 * runs, so a door that still reads Application / ApplicationDocument /
 * DocumentPrecheck / Quotation / CheckoutOrder / Invoice / Certificate / Quote /
 * PaymentTransaction without a registered holder fragment answers 500 (or its
 * own error), never its normal status. Every door below must answer its normal
 * status and the witness must log nothing.
 *
 * Fixture: A is OWNER of personal P and of company C, and acts with header C.
 * The chain is the real filing journey: POST /draft → POST /draft-documents →
 * POST /submit → GET + accept the quotation → POST /payments/checkout (mock
 * adapter) → POST /bundles; plus revision-resubmit and CAR on seeded filings,
 * and the certificate / quote / report-schedule / requirements / planting
 * attachment reads on a seeded certificate.
 */

process.env.PAYMENT_ADAPTER = 'mock';
process.env.STRIPE_CHECKOUT_ENABLED = 'true';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const PDFDocument = require('pdfkit');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

// The holder columns the issuance path writes (services/certificate-service.js holder
// snapshot: entity name/type, else the person and LEGACY_PERSON; submitter, else the
// applicant). m1-holder-backfill asserts no certificate row lacks them.
async function holderColumnsFor(prisma, applicationId) {
    const a = await prisma.application.findUnique({
        where: { id: applicationId },
        select: {
            submitterId: true,
            entity: { select: { displayName: true, type: true } },
            applicant: { select: { id: true, firstName: true, lastName: true } },
        },
    });
    const person = [a.applicant?.firstName, a.applicant?.lastName].filter(Boolean).join(' ') || 'ทดสอบ';
    return {
        holderDisplayName: a.entity ? a.entity.displayName : person,
        holderType: a.entity ? a.entity.type : 'LEGACY_PERSON',
        submittedByUserId: a.submitterId ?? a.applicant.id,
    };
}

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
jest.mock('../../middleware/consent-manager', () => ({
    ...jest.requireActual('../../middleware/consent-manager'),
    requireConsent: (_req, _res, next) => next(),
}));
jest.mock('../../services/queue-service', () => ({
    getPrecheckQueue: () => ({ add: async () => ({ id: 'job-witness' }) }),
    getPdfQueue: () => null,
}));
// Both PDF renderers launch a headless browser; their bytes are not under test,
// the reads in front of them are (the certificate's own synchronous read stays real).
jest.mock('../../services/pdf/certificate-template-service', () => ({
    generateCertificatePdf: async () => Buffer.from('%PDF-1.4 certificate'),
}));
jest.mock('../../services/pdf/invoice-template-service', () => ({
    ...jest.requireActual('../../services/pdf/invoice-template-service'),
    generateQuotationPdf: async () => Buffer.from('%PDF-1.4 quotation'),
}));

const sharedLogger = require('../../shared/logger');
const witnessConfig = require('../../config/holder-read-witness');
const { ConsentCategory, ConsentVersions } = require('../../middleware/consent-manager');

function setMode(mode) {
    if (mode === undefined) { delete process.env.HOLDER_READ_WITNESS; }
    else { process.env.HOLDER_READ_WITNESS = mode; }
    witnessConfig.resetHolderReadWitnessModeCache();
}

const MODE = 'throw';

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
            companyName: 'บริษัท ทดสอบพยาน จำกัด',
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

d('write doors + certificate/document/finance doors run clean under the witness (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    let warn;
    let tmpDir;
    const sfx = crypto.randomUUID().slice(0, 8);
    const fx = { userIds: [], entityIds: [], appIds: [], bundleIds: [] };
    const ORIGINAL_MODE = process.env.HOLDER_READ_WITNESS;

    const witnessLogs = () => warn.mock.calls
        .map((c) => c[1])
        .filter((m) => m && m.signal === 'HEALTH_READ_UNSCOPED')
        .map((m) => `${m.model}.${m.op} ${m.route || ''}`);

    const mkUser = async (name) => {
        const id = crypto.randomUUID();
        const canonicalId = `hw-${name}-${sfx}`;
        await raw.user.create({
            data: {
                id, canonicalId, healthId: canonicalId, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `hw-${name}-${sfx}@example.test`, firstName: 'ทดสอบ', lastName: name, organizationId: fx.org,
            },
        });
        fx.userIds.push(id);
        return { id, canonicalId };
    };
    const mkEntity = async (type, displayName) => {
        const row = await raw.entity.create({ data: { type, displayName, organizationId: fx.org } });
        fx.entityIds.push(row.id);
        return row.id;
    };
    const mkApp = async (label, status, extra = {}) => {
        const row = await raw.application.create({
            data: {
                applicationNumber: `APP-HW-${label}-${sfx}`, healthId: fx.A.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.org, entityId: fx.C, submitterId: fx.A.id, status,
                formData: { steps: {}, workflowState: status }, ...extra,
            },
        });
        fx.appIds.push(row.id);
        return row.id;
    };
    const as = (u) => {
        mockActor.current = { id: u.id, canonicalId: u.canonicalId, healthId: u.canonicalId, role: 'health', canonicalRole: 'health', organizationId: fx.org };
    };
    const hdr = () => ({ 'x-active-entity-id': fx.C });

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holder-witness-'));
        fx.org = (await raw.organization.create({ data: { name: `hw-${sfx}`, slug: `hw-${sfx}`, code: `HW_${sfx}`.toUpperCase() } })).id;
        fx.A = await mkUser('a');
        fx.P = await mkEntity('INDIVIDUAL', `hw a ${sfx}`);
        fx.C = await mkEntity('JURISTIC', `บริษัท hw ${sfx} จำกัด`);
        for (const e of [fx.P, fx.C]) {
            await raw.entityMembership.create({ data: { userId: fx.A.id, entityId: e, role: 'OWNER', status: 'ACTIVE', organizationId: fx.org } });
        }
        await raw.userConsent.create({
            data: {
                userId: fx.A.id, organizationId: fx.org, category: ConsentCategory.PAYMENT_TERMS,
                version: ConsentVersions.PAYMENT_TERMS, granted: true, grantedAt: new Date(),
            },
        });
        fx.toSubmit = await mkApp('SUB', 'DRAFT', { formData: { ...completeCanonicalFormData(), workflowState: 'DRAFT' } });
        fx.forBundle = await mkApp('BND', 'DRAFT');
        fx.aRev = await mkApp('REV', 'REVISION_REQUESTED');
        fx.aCar = await mkApp('CAR', 'CAR_PENDING');
        fx.aCert = await mkApp('CRT', 'CERTIFIED');
        await raw.applicationDocumentReview.create({
            data: {
                applicationId: fx.aRev, slotId: 'land_rights', verdict: 'MORE_REQUESTED', reviewerId: fx.A.id,
                round: 1, organizationId: fx.org, createdAt: new Date(Date.now() - 3600e3), reason: 'อ่านไม่ออก',
                dueDate: new Date(Date.now() + 5 * 86400e3),
            },
        });
        await raw.applicationDocument.create({
            data: {
                applicationId: fx.aRev, documentType: 'LAND_RIGHTS', slotId: 'land_rights', fileName: 'f.pdf',
                fileUrl: '/uploads/f.pdf', currentForSlot: 'land_rights',
            },
        });
        fx.certDoc = (await raw.applicationDocument.create({
            data: { applicationId: fx.aCert, documentType: 'LAND_RIGHTS', slotId: 'land_rights', fileName: 'c.pdf', fileUrl: '/uploads/c.pdf' },
        })).id;
        fx.farm = (await raw.farm.create({
            data: {
                ownerId: fx.A.id, farmName: `ฟาร์ม hw ${sfx}`, farmType: 'CULTIVATION', address: '1', province: 'สมุทรปราการ',
                district: 'บางพลี', subDistrict: 'บางพลีใหญ่', postalCode: '10540', totalArea: 1, cultivationArea: 1,
                cultivationMethod: 'OUTDOOR', organizationId: fx.org, entityId: fx.C,
            },
        })).id;
        fx.species = (await raw.plantSpecies.create({ data: { code: `W${sfx}`.slice(0, 8).toUpperCase(), nameTH: 'ทดสอบ' } })).id;
        fx.cycle = (await raw.plantingCycle.create({
            data: { cycleName: 'รอบที่ 1', farmId: fx.farm, plantSpeciesId: fx.species, startDate: new Date(), organizationId: fx.org },
        })).id;
        fx.cert = (await raw.certificate.create({
            data: {
                certificateNumber: `GACP-HW-${sfx}`, verificationCode: `V-${sfx}`, qrData: 'qr', applicationId: fx.aCert, userId: fx.A.id,
                farmId: fx.farm, farmName: 'ฟาร์ม', applicantName: 'ทดสอบ', cropType: 'cannabis', farmSize: 1,
                province: 'สมุทรปราการ', district: 'บางพลี', subDistrict: 'บางพลีใหญ่', standardId: 'std', standardName: 'GACP',
                expiryDate: new Date(Date.now() + 365 * 86400e3), issuedBy: fx.A.id, status: 'active', organizationId: fx.org,
                ...(await holderColumnsFor(raw, fx.aCert)),
            },
        })).id;

        app = express();
        app.use(express.json());
        app.use('/api/applications/bundles', require('../../routes/api/applications/application-bundles'));
        app.use('/api/applications/:applicationId/quotations', require('../../routes/api/applications/quotations'));
        app.use('/api/applications', require('../../routes/api/applications/revision-resubmit'));
        app.use('/api/applications', require('../../routes/api/applications/applications-car'));
        app.use('/api/applications', require('../../routes/api/applications/requirements'));
        app.use('/api/applications', require('../../routes/api/applications/applications'));
        app.use('/api/payments', require('../../routes/api/finance/payments'));
        app.use('/api/quotes', require('../../routes/api/finance/quotes'));
        app.use('/api/certificates', require('../../routes/api/certificates/certificates'));
        app.use('/api/report-submissions', require('../../routes/api/documents/report-submissions'));
        app.use('/api/planting-cycles', require('../../routes/api/cultivation/planting-cycles'));
    });

    afterAll(async () => {
        setMode(ORIGINAL_MODE);
        if (tmpDir) { fs.rmSync(tmpDir, { recursive: true, force: true }); }
        if (!raw) { return; }
        const appRows = await raw.application.findMany({ where: { organizationId: fx.org }, select: { id: true, formData: true } });
        const appIds = appRows.map((r) => r.id);
        // The upload and CAR doors store real files under public/uploads; remove the ones this run wrote.
        const docUrls = (await raw.applicationDocument.findMany({ where: { applicationId: { in: appIds } }, select: { fileUrl: true } }))
            .map((r) => r.fileUrl);
        const formUrls = JSON.stringify(appRows.map((r) => r.formData)).match(/\/uploads\/[\w./-]+?\.pdf/g) || [];
        for (const url of new Set([...docUrls, ...formUrls])) {
            if (typeof url === 'string' && /^\/uploads\/(car|application-drafts)\//.test(url)) {
                fs.rmSync(path.join(__dirname, '..', '..', 'public', url), { force: true });
            }
        }
        // Never delete with an undefined key: Prisma drops it and the filter matches every row.
        const wipe = async (model, where) => {
            if (!raw[model] || Object.values(where).some((v) => v === undefined || v === null)) { return; }
            await raw[model].deleteMany({ where }).catch(() => {});
        };
        // Rows that reference the certificate (report submissions, the cycle) go first, or the
        // certificate delete fails silently and leaves a row behind for later suites.
        await wipe('cultivationLog', { cycleId: fx.cycle });
        await wipe('plantingCycle', { id: fx.cycle });
        await wipe('reportSubmission', { userId: { in: fx.userIds } });
        await wipe('certificate', { applicationId: { in: appIds } });
        await wipe('farm', { organizationId: fx.org });
        await wipe('plantSpecies', { id: fx.species });
        const orders = await raw.checkoutOrder.findMany({ where: { applicationId: { in: appIds } } }).catch(() => []);
        await wipe('checkoutOrder', { applicationId: { in: appIds } });
        await wipe('invoiceLineItem', { invoiceId: { in: orders.map((o) => o.invoiceId).filter(Boolean) } });
        for (const model of ['paymentTransaction', 'invoice', 'quotation', 'documentPrecheck', 'applicationDocumentReview',
            'applicationDocument', 'revisionDeadline', 'workActivity', 'correctionSubmissionVersion', 'correctionRound',
            'applicationComment']) {
            await wipe(model, { applicationId: { in: appIds } });
        }
        await raw.application.updateMany({ where: { id: { in: appIds } }, data: { bundleId: null } }).catch(() => {});
        await wipe('applicationBundle', { healthId: fx.A?.canonicalId });
        await wipe('auditLog', { resourceId: { in: appIds } });
        await wipe('application', { id: { in: appIds } });
        await wipe('userConsent', { userId: { in: fx.userIds } });
        await wipe('entityMembership', { entityId: { in: fx.entityIds } });
        await wipe('entity', { id: { in: fx.entityIds } });
        await wipe('user', { id: { in: fx.userIds } });
        await wipe('organization', { id: fx.org });
        await raw.$disconnect();
    });

    beforeEach(() => {
        setMode(MODE);
        warn = jest.spyOn(sharedLogger, 'warn');
    });
    afterEach(() => { if (warn) { warn.mockRestore(); } });

    const results = {};
    const call = async (name, req) => {
        const res = await req;
        results[name] = { status: res.status, code: res.body?.code || res.body?.error || null };
        return res;
    };

    const writePdf = async (file) => {
        await new Promise((resolve, reject) => {
            const doc = new PDFDocument();
            const out = fs.createWriteStream(file);
            doc.pipe(out);
            doc.fontSize(14).text('Land title deed - witness fixture '.repeat(200));
            doc.end();
            out.on('finish', resolve);
            out.on('error', reject);
        });
        return file;
    };

    test('write doors run clean under witness throw: draft → upload → submit → quotation → checkout → bundle, revision-resubmit, CAR', async () => {
        const pdf = await writePdf(path.join(tmpDir, 'land.pdf'));
        as(fx.A);

        const draft = await call('POST /draft', request(app).post('/api/applications/draft').set(hdr()).send({ formData: { plantId: 'cannabis' } }));
        const draftId = draft.body?.data?.id;
        const upDraft = await call('POST /draft-documents', request(app).post('/api/applications/draft-documents').set(hdr())
            .field('applicationId', draftId || '').field('slotId', 'land_rights').attach('file', pdf));
        const upFiling = await call('POST /draft-documents (filing)', request(app).post('/api/applications/draft-documents').set(hdr())
            .field('applicationId', fx.toSubmit).field('slotId', 'juristic_reg_6m').attach('file', pdf));
        // fix round 5: the claimed purpose EXPORT (ภ.ท.10) now needs its licence paper on file at submit
        await call('POST /draft-documents (licence)', request(app).post('/api/applications/draft-documents').set(hdr())
            .field('applicationId', fx.toSubmit).field('slotId', 'licence_pt10').attach('file', pdf));
        await call('POST /submit', request(app).post('/api/applications/submit').set(hdr())
            .send({ applicationId: fx.toSubmit, declarationsAccepted: true }));
        await call('GET /:id/quotations', request(app).get(`/api/applications/${fx.toSubmit}/quotations`).set(hdr()));
        await call('GET /:id/quotations/PLATFORM/pdf', request(app).get(`/api/applications/${fx.toSubmit}/quotations/PLATFORM/pdf`).set(hdr()));
        await call('POST /:id/quotations/PLATFORM/accept', request(app).post(`/api/applications/${fx.toSubmit}/quotations/PLATFORM/accept`).set(hdr()).send({}));
        const pay = await call('POST /payments/checkout', request(app).post('/api/payments/checkout').set(hdr())
            .send({ applicationId: fx.toSubmit, milestone: 'M1' }));
        const again = await call('POST /payments/checkout (re-entry)', request(app).post('/api/payments/checkout').set(hdr())
            .send({ applicationId: fx.toSubmit, milestone: 'M1' }));
        await call('POST /bundles', request(app).post('/api/applications/bundles').set(hdr()).send({ applications: [fx.forBundle] }));
        await call('POST /:id/revision-resubmit', request(app).post(`/api/applications/${fx.aRev}/revision-resubmit`).set(hdr()).send({}));
        await call('POST /:id/car', request(app).post(`/api/applications/${fx.aCar}/car`).set(hdr()).field('notes', 'หลักฐาน')
            .attach('carDocument', pdf));

        expect(witnessLogs()).toEqual([]);
        expect(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.status]))).toEqual({
            'POST /draft': 200,
            'POST /draft-documents': 200,
            'POST /draft-documents (filing)': 200,
            'POST /draft-documents (licence)': 200,
            'POST /submit': 200,
            'GET /:id/quotations': 200,
            'GET /:id/quotations/PLATFORM/pdf': 200,
            'POST /:id/quotations/PLATFORM/accept': 200,
            'POST /payments/checkout': 200,
            'POST /payments/checkout (re-entry)': 200,
            'POST /bundles': 200,
            'POST /:id/revision-resubmit': 200,
            'POST /:id/car': 200,
        });

        // A status alone does not prove the internal reads ran: the document sync and the
        // pre-check enqueue swallow their own errors, so a rejected read there would still
        // answer 200. The rows they write are the proof.
        const synced = await raw.applicationDocument.findMany({
            where: { documentId: { in: [upDraft.body?.data?.documentId, upFiling.body?.data?.documentId] } },
            select: { applicationId: true, currentForSlot: true },
        });
        expect(synced).toHaveLength(2);
        expect(synced.every((row) => row.currentForSlot)).toBe(true);
        expect(await raw.documentPrecheck.count({ where: { documentId: upFiling.body?.data?.documentId } })).toBe(1);
        expect((await raw.application.findUnique({ where: { id: fx.toSubmit } })).status).toBe('PENDING_DOC_FEE');
        const quotation = await raw.quotation.findFirst({ where: { applicationId: fx.toSubmit, isDeleted: false } });
        expect(quotation.status).toBe('ACCEPTED');
        expect(again.body?.data?.checkoutOrderId).toBe(pay.body?.data?.checkoutOrderId);
        expect((await raw.checkoutOrder.findUnique({ where: { id: pay.body.data.checkoutOrderId } })).status).toBe('PENDING_PAYMENT');
        expect((await raw.application.findUnique({ where: { id: fx.forBundle } })).bundleId).not.toBeNull();
        // The writer's formData pre-read swallows its own errors: a rejected read would
        // leave the status moved but the workflowState stamp behind.
        const resubmitted = await raw.application.findUnique({ where: { id: fx.aRev } });
        expect(resubmitted.status).not.toBe('REVISION_REQUESTED');
        expect(resubmitted.formData.workflowState).toBe(resubmitted.status);
        expect((await raw.application.findUnique({ where: { id: fx.aCar } })).status).not.toBe('CAR_PENDING');
    });

    test('certificate, report, quote, requirements and pre-check doors run clean under witness throw', async () => {
        as(fx.A);
        await call('GET /certificates', request(app).get('/api/certificates').set(hdr()));
        await call('GET /certificates/my', request(app).get('/api/certificates/my').set(hdr()));
        await call('GET /certificates/:id', request(app).get(`/api/certificates/${fx.cert}`).set(hdr()));
        await call('GET /certificates/:id/download', request(app).get(`/api/certificates/${fx.cert}/download`).set(hdr()));
        await call('GET /report-submissions/schedule', request(app).get('/api/report-submissions/schedule').set(hdr()));
        await call('POST /report-submissions', request(app).post('/api/report-submissions').set(hdr())
            .send({ certificateId: fx.cert, reportType: 'PT27', reportMonth: 1, reportYear: 2569 }));
        await call('GET /quotes/my', request(app).get('/api/quotes/my').set(hdr()));
        await call('GET /:id/requirements', request(app).get(`/api/applications/${fx.toSubmit}/requirements`).set(hdr()));
        const precheck = await raw.documentPrecheck.findFirst({ where: { applicationId: fx.toSubmit }, select: { id: true } });
        await call('POST /:id/prechecks/:pid/acknowledge', request(app)
            .post(`/api/applications/${fx.toSubmit}/prechecks/${precheck?.id || 'none'}/acknowledge`).set(hdr()).send({}));

        expect(witnessLogs()).toEqual([]);
        const statuses = Object.fromEntries(Object.entries(results)
            .filter(([k]) => !k.startsWith('POST /draft') && !k.startsWith('POST /submit') && !k.includes('quotations') && !k.startsWith('POST /payments')
                && !k.startsWith('POST /bundles') && !k.includes('revision') && !k.includes('/car'))
            .map(([k, v]) => [k, v.status]));
        expect(statuses).toEqual({
            'GET /certificates': 200,
            'GET /certificates/my': 200,
            'GET /certificates/:id': 200,
            'GET /certificates/:id/download': 200,
            'GET /report-submissions/schedule': 200,
            'POST /report-submissions': 201,
            'GET /quotes/my': 200,
            'GET /:id/requirements': 200,
            'POST /:id/prechecks/:pid/acknowledge': 200,
        });
    });

    test('planting activity attachments run clean under witness throw (the cycle\'s Farm read converted in Task 6)', async () => {
        as(fx.A);
        const res = await call('POST /planting-cycles/:id/activities', request(app).post(`/api/planting-cycles/${fx.cycle}/activities`).set(hdr())
            .send({ scope: 'CYCLE', activityType: 'IRRIGATION', attachmentIds: [fx.certDoc] }));
        expect(res.status).toBe(201);
        expect(witnessLogs()).toEqual([]);
    });
});
