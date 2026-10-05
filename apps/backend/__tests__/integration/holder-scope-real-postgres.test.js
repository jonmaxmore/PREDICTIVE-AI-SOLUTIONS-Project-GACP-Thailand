'use strict';

/**
 * R2 Task 8 (spec 2026-09-30-remove-workspace-mode §3.2 + §4 cases 6, 7, 8b):
 * the holder is chosen explicitly, through the REAL server app on a REAL
 * Postgres (the §4 fixture, witness in THROW mode under NODE_ENV=test).
 *
 *   case 6   /prepare never re-homes (B11): a body entityId is ignored and stripped.
 *   case 7   create names its holder: S → 403, V → 403, no entityId → 400
 *            APPLICATION_HOLDER_REQUIRED, nothing created.
 *            formData.applicantType = Entity.type; the body's applicantType is ignored.
 *   reads    GET /draft-documents never creates: no id → 400, missing → 404.
 *            GET /draft resumes only the caller's own open draft on a holder it edits.
 *   ordered  the autosave's locked raw-SQL write refuses a holder outside editIds.
 *   case 8b  A REVOKED on C → POST /draft {applicationId: D} → 404, nothing created.
 *
 * R2 Task 9 (spec §3.2 draft edits/submit, §3.3, Q3, C8):
 *   case 3   V sees X; V submits D → 403 ENTITY_PERMISSION_DENIED; V edits D → 403.
 *   case 4   B (MANAGER, not creator) deletes D → 403; A deletes D → 200; O2 (OWNER) deletes D2 → 200.
 *            B (MANAGER) edits D → 200, submits D → 403.
 *   Q3       checkout on C's application: V and B (no SUBMIT_APPLICATION) → 403, no order,
 *            invoice or gateway call; A (OWNER) → 200 (gateway = the mock adapter only).
 *   C8       a bundle stays its filer's; removing or unlinking an application in it
 *            follows §3.3 for that application.
 *   audit    the submit audit row has onBehalfOfEntityId and no activeEntityId.
 *   Every refusal is proven by unchanged row counts on this real Postgres.
 *
 * R2 Task 12 (spec §4 cases 1, 2, 5, 8, 9 + carried items): the middleware, the
 * ALS and the header are gone, so no test sends a workspace header except cases 5
 * and 9, which prove a stale one is inert. Reads follow membership; the revision,
 * deadline, CAR and revision-resubmit doors, checkout, quotation accept and report
 * filing ask the holder (who filed does not matter).
 */

process.env.PAYMENT_ADAPTER = process.env.PAYMENT_ADAPTER || 'mock';
process.env.RATE_LIMIT_MAX = '1000000';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
const { seedHolderScopeFixture, cleanupHolderScopeFixture } = require('./fixtures/holder-scope-fixture');

jest.mock('../../services/pdf/pdf-generator.service', () => ({
    initialize: async () => {},
    warmUp: async () => {},
    close: async () => {},
    generatePDF: async () => Buffer.from('%PDF-1.4 holder'),
    generateFromTemplate: async () => Buffer.from('%PDF-1.4 holder'),
    replaceTemplateVariables: (t) => t,
    readTemplateCached: (templatePath) => require('fs').readFileSync(templatePath, 'utf8'),
}));
jest.mock('../../services/queue-service', () => ({
    ...jest.requireActual('../../services/queue-service'),
    getPrecheckQueue: () => ({ add: async () => ({ id: 'job-holder' }) }),
    getPdfQueue: () => null,
}));

/** A real PDF (the upload door's content guard reads the bytes). */
function realPdf() {
    const PDFDocument = require('pdfkit');
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument();
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.fontSize(14).text('Land rights evidence '.repeat(200));
        doc.end();
    });
}

const DENIED_TH = 'คุณไม่มีสิทธิ์ทำรายการนี้ในนามของผู้ถือรายนี้ ขอให้เจ้าของมอบสิทธิ์ให้คุณก่อน แล้วลองอีกครั้ง';
/** R2 Task 10 round 2: every ENTITY_PERMISSION_DENIED door answers with ONE body shape and the catalogue copy. */
function expectDenied(res) {
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
    expect(res.body.messageTh).toBe(DENIED_TH);
    expect(res.body.error).toBe(DENIED_TH);
    expect(res.body.message).toBe('You may not do this on behalf of this holder. Ask its owner to grant you the permission, then try again');
}

const HOLDER_REQUIRED_TH = 'ยังไม่ได้เลือกว่าจะยื่นในนามใคร กรุณาเลือกที่ขั้นตอนที่ 1 หากเปิดหน้านี้ค้างไว้ ให้โหลดหน้าใหม่ก่อน';

d('R2 Task 8: the holder is chosen explicitly (real Postgres, real server)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    let fx;

    let witnessConfig = null;
    try { witnessConfig = require('../../config/holder-read-witness'); } catch (_) { witnessConfig = null; }
    const ORIGINAL_MODE = process.env.HOLDER_READ_WITNESS;

    // R2 Task 12: no test sends a workspace header; membership alone decides.
    const auth = (actor) => ({ Authorization: `Bearer ${fx.tokens[actor]}` });
    // Cases 5 and 9 only: a stale header from an old browser tab must be inert.
    const withStaleHeader = (actor, entityKey) => ({ ...auth(actor), 'x-active-entity-id': fx.entities[entityKey] });
    const appCount = () => raw.application.count({ where: { organizationId: fx.orgId } });
    const appRow = (id) => raw.application.findUnique({ where: { id } });

    beforeAll(async () => {
        delete process.env.HOLDER_READ_WITNESS;
        if (witnessConfig) { witnessConfig.resetHolderReadWitnessModeCache(); }
        raw = new PrismaClient();
        await raw.$connect();
        fx = await seedHolderScopeFixture(raw);
        app = require('../../server');
        await require('../../services/prisma-database').connect();
    }, 120000);

    afterAll(async () => {
        if (ORIGINAL_MODE === undefined) { delete process.env.HOLDER_READ_WITNESS; } else { process.env.HOLDER_READ_WITNESS = ORIGINAL_MODE; }
        if (witnessConfig) { witnessConfig.resetHolderReadWitnessModeCache(); }
        if (raw) {
            await cleanupHolderScopeFixture(raw, fx);
            await raw.$disconnect();
        }
    });

    test('the witness runs in THROW mode for this file', () => {
        expect(witnessConfig.holderReadWitnessMode()).toBe('throw');
    });

    // ── R2 Task 12: reads follow membership, no header (spec §4 cases 1, 2, 5, 9) ──
    describe('Task 12: reads follow membership with no workspace header', () => {
        const ids = (res) => (res.body.data || []).map((r) => r.id);
        const invoiceIds = (res) => {
            const data = res.body.data;
            const rows = Array.isArray(data) ? data : (data && (data.invoices || data.items)) || [];
            return rows.map((r) => r.id);
        };
        const doors = () => [
            `/api/applications/${fx.apps.X}`,
            `/api/invoices/${fx.invoiceX}/pdf`,
            `/api/invoices/my/${fx.invoiceX}/receipt/pdf`,
            `/api/certificates/${fx.certX}`,
        ];

        test('case 1: B (MANAGER of C), no header, lists X and D and not Y', async () => {
            const res = await request(app).get('/api/applications/my').set(auth('B'));
            expect(res.status).toBe(200);
            expect(ids(res)).toEqual(expect.arrayContaining([fx.apps.X, fx.apps.D]));
            expect(ids(res)).not.toContain(fx.apps.Y);
            const invoices = await request(app).get('/api/invoices/my').set(auth('B'));
            expect(invoices.status).toBe(200);
            expect(invoiceIds(invoices)).toContain(fx.invoiceX);
        });

        test('R2 task 15 fix 2: GET /farms/my is holder-scoped - B sees the farm A created for C, with its entityId; S does not', async () => {
            const b = await request(app).get('/api/farms/my').set(auth('B'));
            expect(b.status).toBe(200);
            const row = (b.body.data || []).find((f) => f.id === fx.more.farm);
            expect(row && row.entityId).toBe(fx.entities.C);
            const s = await request(app).get('/api/farms/my').set(auth('S'));
            expect(ids(s)).not.toContain(fx.more.farm);
        });

        test('R2 task 15 fix 2: a REVOKED member of C no longer sees C\'s farm (restored after)', async () => {
            const where = { userId_entityId: { userId: fx.users.O2.id, entityId: fx.entities.C } };
            expect(ids(await request(app).get('/api/farms/my').set(auth('O2')))).toContain(fx.more.farm);
            await raw.entityMembership.update({ where, data: { status: 'REVOKED' } });
            try {
                const res = await request(app).get('/api/farms/my').set(auth('O2'));
                expect(res.status).toBe(200);
                expect(ids(res)).not.toContain(fx.more.farm);
            } finally {
                await raw.entityMembership.update({ where, data: { status: 'ACTIVE' } });
            }
        });

        test('R2 task 15 fix 4: GET /certificates/my carries the holder entityId of each row', async () => {
            const res = await request(app).get('/api/certificates/my').set(auth('B'));
            expect(res.status).toBe(200);
            const row = (res.body.data || []).find((c) => c.id === fx.certX);
            expect(row && row.entityId).toBe(fx.entities.C);
        });

        test('R2 task 15 fix 1: GET /applications/draft carries the entityId of the resumed draft (A)', async () => {
            const res = await request(app).get('/api/applications/draft').set(auth('A'));
            expect(res.status).toBe(200);
            expect(res.body.data && res.body.data.entityId).toBe(fx.entities.C);
        });

        test('case 1: B, no header, opens X, its invoice, its receipt and its certificate → 200 each', async () => {
            const statuses = {};
            for (const url of doors()) { statuses[url] = (await request(app).get(url).set(auth('B'))).status; }
            expect(statuses).toEqual(Object.fromEntries(doors().map((u) => [u, 200])));
        });

        test('case 2: S lists none of X, D, Y and gets 404 on X, its invoice, its receipt and its certificate', async () => {
            const res = await request(app).get('/api/applications/my').set(auth('S'));
            expect(res.status).toBe(200);
            expect(ids(res).filter((id) => [fx.apps.X, fx.apps.D, fx.apps.Y].includes(id))).toEqual([]);
            const invoices = await request(app).get('/api/invoices/my').set(auth('S'));
            expect(invoiceIds(invoices)).not.toContain(fx.invoiceX);
            const statuses = {};
            for (const url of doors()) { statuses[url] = (await request(app).get(url).set(auth('S'))).status; }
            expect(statuses).toEqual(Object.fromEntries(doors().map((u) => [u, 404])));
        });

        test('case 5: S sending x-active-entity-id: C sees nothing and is never answered 403 ACTIVE_ENTITY_MISMATCH', async () => {
            const res = await request(app).get('/api/applications/my').set(withStaleHeader('S', 'C'));
            expect([res.status, res.body.code]).toEqual([200, undefined]);
            expect(ids(res).filter((id) => [fx.apps.X, fx.apps.D, fx.apps.Y].includes(id))).toEqual([]);
            const statuses = {};
            for (const url of doors()) {
                const r = await request(app).get(url).set(withStaleHeader('S', 'C'));
                statuses[url] = `${r.status} ${(r.body && r.body.code) || ''}`.trim();
            }
            expect(statuses).toEqual(Object.fromEntries(doors().map((u) => [u, expect.stringMatching(/^404/)])));
        });

        test('case 9: F (staff) provider listing returns X, D and Y with and without the header', async () => {
            for (const headers of [auth('F'), withStaleHeader('F', 'C')]) {
                const res = await request(app).get('/api/applications').set(headers);
                expect(res.status).toBe(200);
                expect(ids(res)).toEqual(expect.arrayContaining([fx.apps.X, fx.apps.D, fx.apps.Y]));
            }
        });
    });

    // ── case 6: /prepare never re-homes ──────────────────────────────────────
    test('case 6: A /prepare on D with body entityId PA → D.entityId still C, body entityId stripped', async () => {
        const res = await request(app).post('/api/applications/prepare').set(auth('A'))
            .send({ applicationId: fx.apps.D, entityId: fx.entities.PA, plantName: 'ขมิ้นชัน' });
        expect(res.status).toBe(200);
        const after = await appRow(fx.apps.D);
        expect(after.entityId).toBe(fx.entities.C);
        expect(after.formData.entityId).toBeUndefined();
        expect(after.formData.plantName).toBe('ขมิ้นชัน');
    });

    // R2 Task 12: there is no workspace to "act on" any more (the R1 pin of this case,
    // 404 for A acting on PA, is gone with the header). A edits D because A is a
    // non-VIEWER member of D's holder; the holder still never changes.
    test('case 6b: A /prepare on D with no header → 200 (membership decides), D still held by C', async () => {
        const res = await request(app).post('/api/applications/prepare').set(auth('A'))
            .send({ applicationId: fx.apps.D, plantName: 'ขมิ้นชัน' });
        expect(res.status).toBe(200);
        expect((await appRow(fx.apps.D)).entityId).toBe(fx.entities.C);
    });

    // ── case 7: create names its holder ──────────────────────────────────────
    test('case 7: create with entityId C by S → 403 ENTITY_PERMISSION_DENIED, nothing created', async () => {
        const before = await appCount();
        const res = await request(app).post('/api/applications/draft').set(auth('S'))
            .send({ entityId: fx.entities.C, step: 1, formData: { plantId: 'cannabis' } });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(await appCount()).toBe(before);
    });

    test('case 7: create with entityId C by V (VIEWER) → 403 ENTITY_PERMISSION_DENIED, nothing created', async () => {
        const before = await appCount();
        const res = await request(app).post('/api/applications/draft').set(auth('V'))
            .send({ entityId: fx.entities.C, step: 1, formData: { plantId: 'cannabis' } });
        expectDenied(res);
        expect(await appCount()).toBe(before);
    });

    test('case 7: no entityId → 400 APPLICATION_HOLDER_REQUIRED with the spec copy, nothing created', async () => {
        const before = await appCount();
        const res = await request(app).post('/api/applications/draft').set(auth('A'))
            .send({ step: 1, formData: { plantId: 'cannabis' } });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('APPLICATION_HOLDER_REQUIRED');
        expect(res.body.messageTh).toBe(HOLDER_REQUIRED_TH);
        expect(await appCount()).toBe(before);
    });

    test('a draft-document upload with no id and no entityId → 400 APPLICATION_HOLDER_REQUIRED, nothing created, no file kept', async () => {
        const draftsDir = require('path').join(__dirname, '..', '..', 'public', 'uploads', 'application-drafts');
        const files = () => (require('fs').existsSync(draftsDir) ? require('fs').readdirSync(draftsDir).length : 0);
        const filesBefore = files();
        const before = await appCount();
        const res = await request(app).post('/api/applications/draft-documents').set(auth('A'))
            .field('slotId', 'land_rights')
            .attach('file', await realPdf(), { filename: 'land.pdf', contentType: 'application/pdf' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('APPLICATION_HOLDER_REQUIRED');
        expect(await appCount()).toBe(before);
        expect(files()).toBe(filesBefore);
    });

    test('created draft has formData.applicantType = Entity.type; body applicantType ignored', async () => {
        const before = await appCount();
        const res = await request(app).post('/api/applications/draft').set(auth('A'))
            .send({ entityId: fx.entities.PA, step: 1, formData: { plantId: 'cannabis', applicantType: 'JURISTIC' } });
        expect(res.status).toBe(200);
        expect(await appCount()).toBe(before + 1);
        const created = await appRow(res.body.data.id);
        expect(created.entityId).toBe(fx.entities.PA);
        expect(created.submitterId).toBe(fx.users.A.id);
        expect(created.formData.applicantType).toBe('INDIVIDUAL');

        // A later save with the id cannot rewrite it either.
        const again = await request(app).post('/api/applications/draft').set(auth('A'))
            .send({ applicationId: created.id, step: 1, formData: { plantId: 'cannabis', applicantType: 'JURISTIC' } });
        expect(again.status).toBe(200);
        expect((await appRow(created.id)).formData.applicantType).toBe('INDIVIDUAL');
    });

    test('/prepare cannot rewrite applicantType', async () => {
        const own = await raw.application.create({
            data: {
                applicationNumber: `APP-HS-PP-${fx.sfx}`, healthId: fx.users.A.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.orgId, entityId: fx.entities.PA, submitterId: fx.users.A.id, status: 'DRAFT',
                formData: { plantId: 'cannabis', workflowState: 'DRAFT', applicantType: 'INDIVIDUAL' },
            },
        });
        const res = await request(app).post('/api/applications/prepare').set(auth('A'))
            .send({ applicationId: own.id, applicantType: 'COMMUNITY_ENTERPRISE' });
        expect(res.status).toBe(200);
        expect((await appRow(own.id)).formData.applicantType).toBe('INDIVIDUAL');
    });

    // ── reads never create ───────────────────────────────────────────────────
    test('GET /draft-documents without applicationId → 400; missing draft → 404; no row created', async () => {
        const before = await appCount();
        const noId = await request(app).get('/api/applications/draft-documents').set(auth('A'));
        expect(noId.status).toBe(400);
        const missing = await request(app).get('/api/applications/draft-documents')
            .query({ applicationId: '00000000-0000-4000-8000-000000000000' }).set(auth('A'));
        expect(missing.status).toBe(404);
        const del = await request(app).delete(`/api/applications/draft-documents/${fx.more.draftDoc}`).set(auth('A'));
        expect(del.status).toBe(400);
        expect(await appCount()).toBe(before);
        // With the id it lists D's documents.
        const listed = await request(app).get('/api/applications/draft-documents')
            .query({ applicationId: fx.apps.D }).set(auth('A'));
        expect(listed.status).toBe(200);
        expect(listed.body.data.applicationId).toBe(fx.apps.D);
        expect(listed.body.data.documents.map((x) => x.documentId)).toEqual([fx.more.draftDoc]);
    });

    test('GET /draft-documents for a user with no draft at all → 400, nothing minted', async () => {
        const before = await appCount();
        const res = await request(app).get('/api/applications/draft-documents').set(auth('O2'));
        expect(res.status).toBe(400);
        expect(await appCount()).toBe(before);
    });

    // ── resume without an id ─────────────────────────────────────────────────
    test('GET /draft without id returns latest open draft with submitterId = me and holder in editIds', async () => {
        const res = await request(app).get('/api/applications/draft').set(auth('A'));
        expect(res.status).toBe(200);
        const row = await appRow(res.body.data.id);
        expect(row.status).toBe('DRAFT');
        expect(row.submitterId).toBe(fx.users.A.id);
        // No workspace narrows it (R2 Task 12): any holder A may edit (C or PA).
        expect([fx.entities.C, fx.entities.PA]).toContain(row.entityId);

        // V filed a draft on C before being made a VIEWER: C is not in V's editIds.
        const vDraft = await raw.application.create({
            data: {
                applicationNumber: `APP-HS-VD-${fx.sfx}`, healthId: fx.users.V.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.orgId, entityId: fx.entities.C, submitterId: fx.users.V.id, status: 'DRAFT',
                formData: { plantId: 'cannabis', workflowState: 'DRAFT' },
            },
        });
        const asViewer = await request(app).get('/api/applications/draft').set(auth('V'));
        expect(asViewer.status).toBe(200);
        expect(asViewer.body.data).toBeNull();
        expect((await appRow(vDraft.id)).updatedAt.toISOString()).toBe(vDraft.updatedAt.toISOString());
    });

    // ── the autosave's ordered (raw-SQL) write ───────────────────────────────
    test('ordered save: a holder outside editIds → 404 under the lock, nothing written', async () => {
        const applicationService = require('../../services/application-service');
        const before = await appRow(fx.apps.D2);
        const compute = async (fresh) => ({
            data: {
                serviceType: fresh.serviceType, areaType: fresh.areaType, certificationPurpose: null,
                certificationPurposes: [], previousCertNumber: null, consentedPDPA: false,
                formData: { ...fresh.formData, written: 'ห้ามเขียน' }, workflowHistory: [], updatedBy: fx.users.A.id,
            },
        });
        await expect(applicationService.saveApplicantDraftInOrder(fx.apps.D2, { session: 'hs', seq: 1 }, compute, { editIds: [fx.entities.PA] }))
            .rejects.toMatchObject({ statusCode: 404, code: 'APPLICATION_NOT_FOUND' });
        await expect(applicationService.saveApplicantDraftInOrder(fx.apps.D2, { session: 'hs', seq: 1 }, compute))
            .rejects.toThrow(TypeError);
        const after = await appRow(fx.apps.D2);
        expect(after.formData).toEqual(before.formData);
        expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    });

    // ── resume never crosses filers (Task 8 fix round 1, minor) ──────────────
    test('id-less write by B on C never resumes O2\'s open draft on C: B gets its own new draft', async () => {
        const o2Draft = await raw.application.create({
            data: {
                applicationNumber: `APP-HS-O2D-${fx.sfx}`, healthId: fx.users.O2.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.orgId, entityId: fx.entities.C, submitterId: fx.users.O2.id, status: 'DRAFT',
                formData: { plantId: 'cannabis', workflowState: 'DRAFT' },
            },
        });
        const res = await request(app).post('/api/applications/draft').set(auth('B'))
            .send({ entityId: fx.entities.C, step: 1, formData: { plantId: 'cannabis' } });
        expect(res.status).toBe(200);
        expect(res.body.data.id).not.toBe(o2Draft.id);
        const mine = await appRow(res.body.data.id);
        expect(mine.submitterId).toBe(fx.users.B.id);
        expect(mine.entityId).toBe(fx.entities.C);
        expect((await appRow(o2Draft.id)).updatedAt.toISOString()).toBe(o2Draft.updatedAt.toISOString());
        // A second id-less write by B resumes B's own draft, still not O2's.
        const again = await request(app).post('/api/applications/draft').set(auth('B'))
            .send({ entityId: fx.entities.C, step: 1, formData: { plantId: 'cannabis' } });
        expect(again.body.data.id).toBe(mine.id);
    });

    // ── renewal: the source holder decides, and a refusal writes nothing (fix round 1, CRITICAL) ──
    const tableCounts = async () => ({
        applications: await raw.application.count(),
        quotations: await raw.quotation.count(),
        invoices: await raw.invoice.count(),
    });
    async function seedCertifiedSource(label, { filer, entityKey }) {
        const app0 = await raw.application.create({
            data: {
                applicationNumber: `APP-HS-RN-${label}-${fx.sfx}`, healthId: fx.users[filer].canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.orgId, entityId: entityKey ? fx.entities[entityKey] : null,
                submitterId: fx.users[filer].id, status: 'CERTIFIED', formData: { plantId: 'cannabis', workflowState: 'CERTIFIED' },
            },
        });
        const cert = await raw.certificate.create({
            data: {
                certificateNumber: `GACP-HS-RN-${label}-${fx.sfx}`, verificationCode: `V-RN-${label}-${fx.sfx}`, qrData: 'qr',
                applicationId: app0.id, userId: fx.users[filer].id, farmId: fx.more.farm, farmName: 'ฟาร์มโฮลเดอร์',
                applicantName: 'ทดสอบ', cropType: 'cannabis', farmSize: 1, province: 'สมุทรปราการ', district: 'บางพลี',
                subDistrict: 'บางพลีใหญ่', standardId: 'std', standardName: 'GACP',
                expiryDate: new Date(Date.now() + 60 * 86400e3), issuedBy: fx.users.F.id, status: 'active', organizationId: fx.orgId,
            },
        });
        return { app: app0, cert };
    }

    // R2 Task 12 (spec §3.1 "no filer fallback"): a null-holder certificate is read by no
    // one on the health side, so its renewal is 404 CERT_NOT_FOUND (Task 8: 400
    // APPLICATION_HOLDER_REQUIRED, reached through the R1 filer branch). Nothing is written.
    test('renewal of a source with NO holder → 404 CERT_NOT_FOUND; no application, quotation or invoice written', async () => {
        const { cert } = await seedCertifiedSource('NULL', { filer: 'A', entityKey: null });
        const before = await tableCounts();
        const res = await request(app).post('/api/applications/renewals').set(auth('A'))
            .send({ originalCertificateId: cert.id });
        const again = await request(app).post('/api/applications/renewals').set(auth('A'))
            .send({ originalCertificateId: cert.id });
        expect(await tableCounts()).toEqual(before);
        expect([res.status, res.body.error]).toEqual([404, 'CERT_NOT_FOUND']);
        expect(again.status).toBe(404);
    });

    test('renewal of a source with NO holder by a caller with no membership → 404; retries write nothing', async () => {
        // A filer with no membership anywhere: no entity context is bound, so nothing
        // hides the null-holder source from the service (the path that left orphans).
        const jwtConfig = require('../../config/jwt-security');
        const crypto = require('crypto');
        const id = crypto.randomUUID();
        const canonicalId = `hs-u-${fx.sfx}`;
        await raw.user.create({
            data: {
                id, canonicalId, healthId: canonicalId, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `hs-u-${fx.sfx}@example.test`, firstName: 'ทดสอบ', lastName: 'U', organizationId: fx.orgId, status: 'ACTIVE',
            },
        });
        fx.users.U = { id, canonicalId, role: 'health' };
        fx.tokens.U = jwtConfig.generateToken({ id, userId: id, role: 'health', canonicalRole: 'health' }, 'public');
        const { cert } = await seedCertifiedSource('NULLU', { filer: 'U', entityKey: null });
        const before = await tableCounts();
        const first = await request(app).post('/api/applications/renewals').set(auth('U'))
            .send({ originalCertificateId: cert.id });
        const retry = await request(app).post('/api/applications/renewals').set(auth('U'))
            .send({ originalCertificateId: cert.id });
        expect(await tableCounts()).toEqual(before);
        expect([first.status, first.body.error]).toEqual([404, 'CERT_NOT_FOUND']);
        expect(retry.status).toBe(404);
    });

    test('renewal by a VIEWER of the source holder → 403 ENTITY_PERMISSION_DENIED; nothing written', async () => {
        const { cert } = await seedCertifiedSource('VIEW', { filer: 'V', entityKey: 'C' });
        const before = await tableCounts();
        const res = await request(app).post('/api/applications/renewals').set(auth('V'))
            .send({ originalCertificateId: cert.id });
        expect(await tableCounts()).toEqual(before);
        expectDenied(res);
    });

    test('renewal of a source whose holder the caller may submit for (OWNER: SUBMIT_APPLICATION) → 201, the renewal carries that holder', async () => {
        const before = await tableCounts();
        const res = await request(app).post('/api/applications/renewals').set(auth('A'))
            .send({ originalCertificateId: fx.certX });
        expect(res.status).toBe(201);
        const renewal = await appRow(res.body.data.applicationId);
        expect(renewal.entityId).toBe(fx.entities.C);
        const after = await tableCounts();
        expect(after.applications).toBe(before.applications + 1);
        // Its quotation is issued under the same holder scope (no unscoped read in throw mode).
        expect(after.quotations).toBe(before.quotations + 1);
    });


    // Operator ruling 2026-10-03: any member holding SUBMIT_APPLICATION on the source
    // certificate's holder may renew; who filed the source does not matter. The renewal
    // is filed under the source holder by the acting user.
    describe('renewal by a member who did not file the source (operator ruling 2026-10-03)', () => {
        const submitGrant = async (userKey, effect) => {
            const membership = await raw.entityMembership.findUnique({
                where: { userId_entityId: { userId: fx.users[userKey].id, entityId: fx.entities.C } },
            });
            if (effect) {
                await raw.entityMemberPermissionGrant.create({
                    data: { membershipId: membership.id, permission: 'SUBMIT_APPLICATION', effect,
                        grantedBy: fx.users.A.id, organizationId: fx.orgId },
                });
            } else {
                await raw.entityMemberPermissionGrant.deleteMany({ where: { membershipId: membership.id, permission: 'SUBMIT_APPLICATION' } });
            }
        };
        const renew = (actor, certId) => request(app).post('/api/applications/renewals').set(auth(actor))
            .send({ originalCertificateId: certId });

        test('O2 (OWNER of C, not the filer) → 201: one application and one quotation, held by C, filed by O2', async () => {
            const { cert } = await seedCertifiedSource('RN-O2', { filer: 'A', entityKey: 'C' });
            const before = await tableCounts();
            const res = await renew('O2', cert.id);
            expect([res.status, res.body.error]).toEqual([201, undefined]);
            const renewal = await appRow(res.body.data.applicationId);
            expect({ entityId: renewal.entityId, healthId: renewal.healthId, submitterId: renewal.submitterId })
                .toEqual({ entityId: fx.entities.C, healthId: fx.users.O2.canonicalId, submitterId: fx.users.O2.id });
            const after = await tableCounts();
            expect(after).toEqual({ ...before, applications: before.applications + 1, quotations: before.quotations + 1 });
            // O2 sees its renewal in its own list.
            const list = await request(app).get('/api/applications/my').set(auth('O2'));
            expect(list.body.data.map((r) => r.id)).toContain(renewal.id);
        });

        test('B (MANAGER of C) with a SUBMIT_APPLICATION grant → 201, filed by B under C', async () => {
            const { cert } = await seedCertifiedSource('RN-BG', { filer: 'A', entityKey: 'C' });
            await submitGrant('B', 'GRANT');
            try {
                const res = await renew('B', cert.id);
                expect([res.status, res.body.error]).toEqual([201, undefined]);
                const renewal = await appRow(res.body.data.applicationId);
                expect([renewal.entityId, renewal.healthId]).toEqual([fx.entities.C, fx.users.B.canonicalId]);
            } finally {
                await submitGrant('B', null);
            }
        });

        test.each([['B', 'MANAGER without the grant'], ['V', 'VIEWER']])(
            '%s (%s) → 403 ENTITY_PERMISSION_DENIED; nothing written',
            async (actor) => {
                const { cert } = await seedCertifiedSource(`RN-${actor}-NO`, { filer: 'A', entityKey: 'C' });
                const before = await tableCounts();
                expectDenied(await renew(actor, cert.id));
                expect(await tableCounts()).toEqual(before);
            },
        );

        // Re-review of the ruling: one in-flight renewal per certificate (RENEWAL_ALREADY_IN_PROGRESS).
        const renewalsOf = (certId) => raw.application.findMany({
            where: { organizationId: fx.orgId, formData: { path: ['renewalOf'], equals: certId } },
            select: { id: true, status: true },
        });

        test('a second renewal of the same certificate by another member → 409 RENEWAL_ALREADY_IN_PROGRESS; nothing written', async () => {
            const { cert } = await seedCertifiedSource('RN-DUP', { filer: 'A', entityKey: 'C' });
            expect((await renew('A', cert.id)).status).toBe(201);
            const before = await tableCounts();
            const second = await renew('O2', cert.id);
            expect([second.status, second.body.error]).toEqual([409, 'RENEWAL_ALREADY_IN_PROGRESS']);
            expect(second.body.message).toBe('ใบรับรองใบนี้มีคำขอต่ออายุหรือขอใบแทนที่กำลังดำเนินการอยู่แล้ว กรุณาเปิดคำขอนั้นจากรายการคำขอของคุณ');
            expect(await tableCounts()).toEqual(before);
            expect(await renewalsOf(cert.id)).toHaveLength(1);
        });

        test('two concurrent renewals of the same certificate leave exactly one renewal', async () => {
            const { cert } = await seedCertifiedSource('RN-RACE', { filer: 'A', entityKey: 'C' });
            const results = await Promise.all([renew('A', cert.id), renew('O2', cert.id)]);
            // Exactly one created and exactly one refused (a race has no fixed order).
            expect(results.filter((r) => r.status === 201)).toHaveLength(1);
            expect(results.filter((r) => r.status === 409)).toHaveLength(1);
            expect(await renewalsOf(cert.id)).toHaveLength(1);
        });

        test('once the first renewal is no longer in flight (CANCEL_EXPIRED), a new renewal is allowed', async () => {
            const { cert } = await seedCertifiedSource('RN-AGAIN', { filer: 'A', entityKey: 'C' });
            const first = await renew('A', cert.id);
            expect(first.status).toBe(201);
            // eslint-disable-next-line gacp/no-direct-application-status-write -- fixture: the renewal is cancelled by hand
            await raw.application.update({ where: { id: first.body.data.applicationId }, data: { status: 'CANCEL_EXPIRED' } });
            const again = await renew('O2', cert.id);
            expect([again.status, again.body.error]).toEqual([201, undefined]);
            expect(await renewalsOf(cert.id)).toHaveLength(2);
        });

        test('a non-member S → 404 CERT_NOT_FOUND; nothing written', async () => {
            const { cert } = await seedCertifiedSource('RN-S', { filer: 'A', entityKey: 'C' });
            const before = await tableCounts();
            const res = await renew('S', cert.id);
            expect([res.status, res.body.error]).toEqual([404, 'CERT_NOT_FOUND']);
            expect(await tableCounts()).toEqual(before);
        });
    });

    // ── R2 Task 9: owner-only and destructive rules ──────────────────────────
    const writeCounts = async () => ({
        applications: await raw.application.count(),
        liveApplications: await raw.application.count({ where: { isDeleted: false } }),
        invoices: await raw.invoice.count(),
        quotations: await raw.quotation.count(),
        orders: await raw.checkoutOrder.count(),
        payments: await raw.paymentTransaction.count(),
        bundles: await raw.applicationBundle.count(),
    });
    const grantConsents = async (keys, categories) => {
        const { ConsentVersions } = require('../../middleware/consent-manager');
        for (const key of keys) {
            for (const category of categories) {
                await raw.userConsent.create({
                    data: {
                        userId: fx.users[key].id, organizationId: fx.orgId, category,
                        version: ConsentVersions[category], granted: true, grantedAt: new Date(),
                    },
                });
            }
        }
    };

    test('task 9 setup: A, B, V, O2, S hold the PDPA consents the submit door asks first', async () => {
        await grantConsents(['A', 'B', 'V', 'O2', 'S'], ['TERMS_OF_SERVICE', 'PRIVACY_POLICY']);
        const { consentManager } = require('../../middleware/consent-manager');
        expect(await consentManager.hasRequiredConsents(fx.users.V.id)).toBe(true);
    });

    test('case 3: V (VIEWER) sees X in the list', async () => {
        const res = await request(app).get('/api/applications/my').set(auth('V'));
        expect(res.status).toBe(200);
        const rows = res.body.data?.applications || res.body.data || [];
        expect(rows.map((r) => r.id)).toContain(fx.apps.X);
    });

    test('case 3: V submits D → 403 ENTITY_PERMISSION_DENIED; D unchanged, nothing written', async () => {
        const before = await writeCounts();
        const dBefore = await appRow(fx.apps.D);
        const res = await request(app).post('/api/applications/submit').set(auth('V'))
            .send({ applicationId: fx.apps.D, declarationsAccepted: true });
        expectDenied(res);
        expect(await writeCounts()).toEqual(before);
        const dAfter = await appRow(fx.apps.D);
        expect([dAfter.status, dAfter.updatedAt.toISOString()]).toEqual(['DRAFT', dBefore.updatedAt.toISOString()]);
    });

    test('audit: the submit refusal row has onBehalfOfEntityId = C and no activeEntityId', async () => {
        const rows = await raw.auditLog.findMany({
            where: { resourceId: fx.apps.D, action: 'APPLICATION_SUBMIT_DENIED', actorId: fx.users.V.id },
        });
        expect(rows.length).toBeGreaterThanOrEqual(1);
        for (const row of rows) {
            // audit-logger persists metadata as a JSON string (audit-logger.js _buildAuditRow).
            const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
            expect(meta.onBehalfOfEntityId).toBe(fx.entities.C);
            expect(meta).not.toHaveProperty('activeEntityId');
        }
    });

    test('case 3: V edits D (POST /draft, /prepare, draft-documents) → 403 ENTITY_PERMISSION_DENIED; D unchanged', async () => {
        const before = await writeCounts();
        const dBefore = await appRow(fx.apps.D);
        const draft = await request(app).post('/api/applications/draft').set(auth('V'))
            .send({ applicationId: fx.apps.D, step: 1, formData: { plantId: 'cannabis', plantName: 'ห้ามเขียน' } });
        const prepare = await request(app).post('/api/applications/prepare').set(auth('V'))
            .send({ applicationId: fx.apps.D, plantName: 'ห้ามเขียน' });
        const removeDoc = await request(app).delete(`/api/applications/draft-documents/${fx.more.draftDoc}`)
            .query({ applicationId: fx.apps.D }).set(auth('V'));
        expect([draft.status, draft.body.code]).toEqual([403, 'ENTITY_PERMISSION_DENIED']);
        expect([prepare.status, prepare.body.code]).toEqual([403, 'ENTITY_PERMISSION_DENIED']);
        expect([removeDoc.status, removeDoc.body.code]).toEqual([403, 'ENTITY_PERMISSION_DENIED']);
        expect(await writeCounts()).toEqual(before);
        const dAfter = await appRow(fx.apps.D);
        expect(dAfter.updatedAt.toISOString()).toBe(dBefore.updatedAt.toISOString());
        expect(dAfter.formData).toEqual(dBefore.formData);
    });

    test('B (MANAGER) edits D → 200 (the write lands)', async () => {
        const res = await request(app).post('/api/applications/draft').set(auth('B'))
            .send({ applicationId: fx.apps.D, step: 1, formData: { plantId: 'cannabis', plantName: 'ขมิ้นชัน B' } });
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(fx.apps.D);
        const after = await appRow(fx.apps.D);
        expect(after.entityId).toBe(fx.entities.C);
        expect(after.updatedBy).toBe(fx.users.B.id);
    });

    test('B (MANAGER) submits D → 403 ENTITY_PERMISSION_DENIED; D still DRAFT, nothing written', async () => {
        const before = await writeCounts();
        const res = await request(app).post('/api/applications/submit').set(auth('B'))
            .send({ applicationId: fx.apps.D, declarationsAccepted: true });
        expect([res.status, res.body.code]).toEqual([403, 'ENTITY_PERMISSION_DENIED']);
        expect(await writeCounts()).toEqual(before);
        expect((await appRow(fx.apps.D)).status).toBe('DRAFT');
    });

    test('a stranger S cannot reach D at all: edit, submit and delete → 404 / not deleted, nothing written', async () => {
        const before = await writeCounts();
        const edit = await request(app).post('/api/applications/draft').set(auth('S'))
            .send({ applicationId: fx.apps.D, step: 1, formData: { plantId: 'cannabis' } });
        const submit = await request(app).post('/api/applications/submit').set(auth('S'))
            .send({ applicationId: fx.apps.D, declarationsAccepted: true });
        const del = await request(app).delete(`/api/applications/draft/${fx.apps.D}`).set(auth('S'));
        expect(edit.status).toBe(404);
        expect(submit.status).toBe(404);
        expect([del.status, del.body.data?.deleted]).toEqual([200, false]);
        expect(await writeCounts()).toEqual(before);
        expect((await appRow(fx.apps.D)).isDeleted).toBe(false);
    });

    // ── Q3: who may start a checkout ─────────────────────────────────────────
    // ── Task 12 (carried, spec §3.3): a resubmit is a submit — the holder decides, not the filer ──
    describe('Task 12: revision, deadline, CAR and revision-resubmit doors follow the submit guard on the holder', () => {
        const STAMP = { serverRequirementSnapshot: { slotIds: ['land_rights'], rules: [] } };
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        let pdfPath;
        const seeded = {};
        const completeFormData = () => ({
            plantId: 'cannabis', serviceType: 'NEW', certificationPurposes: ['EXPORT'], locationType: 'OUTDOOR',
            cultivationMethods: ['outdoor'], consentedPDPA: true, acknowledgedStandards: true,
            applicantData: {
                applicantType: 'JURISTIC', companyName: 'บริษัท ทดสอบพยาน จำกัด', registrationNumber: '0105560000001',
                directorName: 'สมชาย ใจดี', firstName: 'สมชาย', lastName: 'ใจดี', idCard: '1100000000008',
                phone: '0812345678', email: 'somchai@example.com', address: '123 หมู่ 4',
            },
            farmData: {
                farmName: 'ฟาร์มสมชาย', address: '123 หมู่ 4', province: 'สมุทรปราการ', district: 'บางพลี',
                subdistrict: 'บางพลีใหญ่', postalCode: '10540', totalAreaSize: '5', totalAreaUnit: 'Rai',
                landOwnership: 'OWN', gpsLat: '13.12', gpsLng: '100.65',
            },
            plots: [{ id: 'p1', name: 'แปลงที่ 1', areaSize: '2', areaUnit: 'Rai', solarSystem: 'OUTDOOR' }],
            productionData: { propagationType: ['SEED'], plantParts: ['FLOWER'] },
            harvestData: { harvestMethod: 'MANUAL', dryingMethod: 'SUN', storageSystem: 'AMBIENT' },
            documents: [{ name: 'doc.pdf', url: '/uploads/doc.pdf', type: 'LAND_RIGHT' }],
        });
        const mk = async (label, status, formData) => (await raw.application.create({
            data: {
                applicationNumber: `APP-HS-RS-${label}-${fx.sfx}`, healthId: fx.users.A.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.orgId, entityId: fx.entities.C, submitterId: fx.users.A.id, status,
                formData: { plantId: 'cannabis', workflowState: status, ...formData },
            },
        })).id;
        const landDoc = (applicationId) => raw.applicationDocument.create({
            data: {
                applicationId, documentType: 'LAND_RIGHTS', slotId: 'land_rights', fileName: 'land.pdf',
                fileUrl: '/uploads/hs-rs-land.pdf', currentForSlot: 'land_rights',
            },
        });
        const doors = {
            revision: (id) => request(app).put(`/api/applications/${id}/revision`)
                .send({ formData: completeFormData(), notes: 'แก้ไขแล้ว' }),
            deadline: (id) => request(app).put(`/api/revision-deadline/${id}/submit`).send({ notes: 'แก้ไขแล้ว' }),
            car: (id) => request(app).post(`/api/applications/${id}/car`).field('notes', 'หลักฐาน').attach('carDocument', pdfPath),
            resubmit: (id) => request(app).post(`/api/applications/${id}/revision-resubmit`).send({}),
        };

        beforeAll(async () => {
            const PDFDocument = require('pdfkit');
            pdfPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hs-car-')), 'car.pdf');
            await new Promise((resolve, reject) => {
                const doc = new PDFDocument();
                const out = fs.createWriteStream(pdfPath);
                doc.pipe(out);
                doc.fontSize(14).text('Corrective action evidence '.repeat(200));
                doc.end();
                out.on('finish', resolve);
                out.on('error', reject);
            });
            for (const actor of ['O2', 'V']) {
                const r = {};
                r.revision = await mk(`REV-${actor}`, 'REVISION_REQUESTED', { ...completeFormData(), ...STAMP });
                await landDoc(r.revision);
                r.deadline = await mk(`RD-${actor}`, 'REVISION_REQUESTED', STAMP);
                await landDoc(r.deadline);
                await raw.revisionDeadline.create({
                    data: { applicationId: r.deadline, revisionDue: new Date(Date.now() + 5 * 86400e3), organizationId: fx.orgId },
                });
                r.car = await mk(`CAR-${actor}`, 'CAR_PENDING', STAMP);
                await landDoc(r.car);
                r.resubmit = await mk(`RR-${actor}`, 'REVISION_REQUESTED', STAMP);
                await raw.applicationDocumentReview.create({
                    data: {
                        applicationId: r.resubmit, slotId: 'land_rights', verdict: 'MORE_REQUESTED', reason: 'ภาพโฉนดไม่ชัด กรุณาแนบใหม่',
                        dueDate: new Date(Date.now() + 5 * 86400e3), reviewerId: fx.users.F.id, round: 1,
                        organizationId: fx.orgId, createdAt: new Date(Date.now() - 3600e3),
                    },
                });
                await landDoc(r.resubmit);
                seeded[actor] = r;
            }
        });

        afterAll(async () => {
            const rows = await raw.application.findMany({ where: { organizationId: fx.orgId }, select: { formData: true } });
            const urls = JSON.stringify(rows.map((a) => a.formData)).match(/\/uploads\/car\/[\w./-]+?\.pdf/g) || [];
            for (const url of new Set(urls)) { fs.rmSync(path.join(__dirname, '..', '..', 'public', url), { force: true }); }
            await raw.applicationDocumentReview.deleteMany({ where: { applicationId: { in: Object.values(seeded).flatMap(Object.values) } } });
        });

        test.each(['revision', 'deadline', 'car', 'resubmit'])(
            'V (VIEWER of C, not the filer) on the %s door → 403 ENTITY_PERMISSION_DENIED; the filing is unchanged',
            async (door) => {
                const id = seeded.V[door];
                const before = await appRow(id);
                const counts = await writeCounts();
                const res = await doors[door](id).set(auth('V'));
                expectDenied(res);
                const after = await appRow(id);
                expect([after.status, after.updatedAt.toISOString()]).toEqual([before.status, before.updatedAt.toISOString()]);
                expect(await writeCounts()).toEqual(counts);
            },
        );

        // Found while removing the filer pin (operator: fix what needs fixing): multer
        // stores the CAR evidence before the door decides, and a refusal kept the file.
        test('a refused CAR upload (V: 403 by the guard, S: 404 by the read) leaves no file under public/uploads/car', async () => {
            const carDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'car');
            const files = () => (fs.existsSync(carDir) ? fs.readdirSync(carDir).length : 0);
            const before = files();
            expect((await doors.car(seeded.V.car).set(auth('V'))).status).toBe(403);
            expect((await doors.car(seeded.V.car).set(auth('S'))).status).toBe(404);
            expect(files()).toBe(before);
        });

        test.each([
            ['revision', 'ASSIGNED_FOR_REVIEW'],
            ['deadline', null],
            ['car', null],
            ['resubmit', 'ASSIGNED_FOR_REVIEW'],
        ])('O2 (OWNER of C with SUBMIT_APPLICATION, not the filer) on the %s door → 200', async (door, toStatus) => {
            const id = seeded.O2[door];
            const res = await doors[door](id).set(auth('O2'));
            expect([res.status, res.body.code]).toEqual([200, undefined]);
            if (toStatus) { expect((await appRow(id)).status).toBe(toStatus); }
        });
    });

    describe('Q3 checkout gate (real Postgres; the mock adapter is the only stub)', () => {
        const mockAdapter = require('../../services/payment/mock-payment-adapter');
        let payable;
        let legacyPayable;
        let gatewaySpy;
        const ORIGINAL_CHECKOUT = process.env.STRIPE_CHECKOUT_ENABLED;

        beforeAll(async () => {
            process.env.STRIPE_CHECKOUT_ENABLED = 'true';
            mockAdapter.__reset();
            const quotationService = require('../../services/quotation-service');
            const { issueQuotationOnSubmit } = require('../../services/quotation-issuance-on-submit');
            payable = await raw.application.create({
                data: {
                    applicationNumber: `APP-HS-PAY-${fx.sfx}`, healthId: fx.users.A.canonicalId, areaType: 'OUTDOOR',
                    organizationId: fx.orgId, entityId: fx.entities.C, submitterId: fx.users.A.id,
                    status: 'PENDING_DOC_FEE', formData: {},
                },
            });
            expect(await issueQuotationOnSubmit({ application: payable, actorId: null })).toEqual({ issued: true });
            const [qt] = await raw.quotation.findMany({ where: { applicationId: payable.id, isDeleted: false } });
            await quotationService.markQuotationAccepted(qt.id, {
                acceptedBy: null, snapshot: quotationService.buildAcceptanceSnapshot(qt),
            });
            // The legacy invoice doors (fix round 1, I2) get their own payable filing.
            legacyPayable = await raw.application.create({
                data: {
                    applicationNumber: `APP-HS-LPAY-${fx.sfx}`, healthId: fx.users.A.canonicalId, areaType: 'OUTDOOR',
                    organizationId: fx.orgId, entityId: fx.entities.C, submitterId: fx.users.A.id,
                    status: 'PENDING_DOC_FEE', formData: {},
                },
            });
            expect(await issueQuotationOnSubmit({ application: legacyPayable, actorId: null })).toEqual({ issued: true });
            const [lqt] = await raw.quotation.findMany({ where: { applicationId: legacyPayable.id, isDeleted: false } });
            await quotationService.markQuotationAccepted(lqt.id, {
                acceptedBy: null, snapshot: quotationService.buildAcceptanceSnapshot(lqt),
            });
            // Every caller holds the payment-terms consent, so a refusal below is the gate's alone.
            await grantConsents(['A', 'B', 'V'], ['PAYMENT_TERMS']);
            gatewaySpy = jest.spyOn(mockAdapter, 'createCheckoutSession');
        });

        afterAll(() => {
            if (gatewaySpy) { gatewaySpy.mockRestore(); }
            if (ORIGINAL_CHECKOUT === undefined) { delete process.env.STRIPE_CHECKOUT_ENABLED; } else { process.env.STRIPE_CHECKOUT_ENABLED = ORIGINAL_CHECKOUT; }
        });

        test.each([['V', 'VIEWER'], ['B', 'MANAGER without SUBMIT_APPLICATION']])(
            'checkout by %s (%s) → 403 ENTITY_PERMISSION_DENIED; no order, invoice, payment or gateway call',
            async (actor) => {
                gatewaySpy.mockClear();
                const before = await writeCounts();
                const res = await request(app).post('/api/payments/checkout').set(auth(actor))
                    .send({ applicationId: payable.id, milestone: 'M1' });
                expectDenied(res);
                expect(await writeCounts()).toEqual(before);
                expect(gatewaySpy).not.toHaveBeenCalled();
                expect((await appRow(payable.id)).status).toBe('PENDING_DOC_FEE');
            },
        );

        test('checkout by a stranger S → 404, nothing written, no gateway call', async () => {
            gatewaySpy.mockClear();
            const before = await writeCounts();
            const res = await request(app).post('/api/payments/checkout').set(auth('S'))
                .send({ applicationId: payable.id, milestone: 'M1' });
            expect(res.status).toBe(404);
            expect(await writeCounts()).toEqual(before);
            expect(gatewaySpy).not.toHaveBeenCalled();
        });

        // Fix round 1 (I2): the legacy invoice doors carry the same gate as checkout.
        const LEGACY_DOORS = [
            ['POST /payments/create', (id) => ['/api/payments/create', { applicationId: id, phase: '1' }]],
            ['POST /payments/phase1/:id', (id) => [`/api/payments/phase1/${id}`, {}]],
        ];
        const legacyCases = [];
        for (const [door] of LEGACY_DOORS) {
            for (const [actor, label] of [['V', 'VIEWER'], ['B', 'MANAGER without SUBMIT_APPLICATION']]) {
                legacyCases.push([door, actor, label]);
            }
        }
        test.each(legacyCases)(
            '%s by %s (%s) → 403 ENTITY_PERMISSION_DENIED; no invoice, order, payment or application written',
            async (door, actor) => {
                const [url, body] = LEGACY_DOORS.find(([d]) => d === door)[1](legacyPayable.id);
                gatewaySpy.mockClear();
                const before = await writeCounts();
                const appBefore = await appRow(legacyPayable.id);
                const res = await request(app).post(url).set(auth(actor)).send(body);
                expectDenied(res);
                expect(await writeCounts()).toEqual(before);
                expect(gatewaySpy).not.toHaveBeenCalled();
                const appAfter = await appRow(legacyPayable.id);
                expect([appAfter.status, appAfter.updatedAt.toISOString()]).toEqual([appBefore.status, appBefore.updatedAt.toISOString()]);
            },
        );

        test('legacy doors by a stranger S → 404, nothing written', async () => {
            const before = await writeCounts();
            for (const [, build] of LEGACY_DOORS) {
                const [url, body] = build(legacyPayable.id);
                const res = await request(app).post(url).set(auth('S')).send(body);
                expect(res.status).toBe(404);
            }
            expect(await writeCounts()).toEqual(before);
        });

        // Fix round 1b: measured with the witness in THROW mode (this file's mode), so an
        // unscoped Application/Invoice/Quotation read behind these doors fails the test.
        test('legacy doors by A (OWNER) keep their success, witness THROW: /create → 200, then /phase1 → 200', async () => {
            expect(witnessConfig.holderReadWitnessMode()).toBe('throw');
            // A best-effort caller (the frozen-quote price lock) catches the witness's
            // throw and falls back, so the status alone cannot prove every read was
            // scoped: no witness report may be logged during these requests either.
            const logger = require('../../shared/logger');
            const warn = jest.spyOn(logger, 'warn');
            try {
                for (const [, build] of LEGACY_DOORS) {
                    const [url, body] = build(legacyPayable.id);
                    const res = await request(app).post(url).set(auth('A')).send(body);
                    expect([res.status, res.body.success, res.body.error]).toEqual([200, true, undefined]);
                }
                const unscoped = warn.mock.calls.map((c) => c[1])
                    .filter((m) => m && m.signal === 'HEALTH_READ_UNSCOPED').map((m) => `${m.model}.${m.op} ${m.route}`);
                expect(unscoped).toEqual([]);
            } finally {
                warn.mockRestore();
            }
        });

        // Task 12 (carried): the checkout service reads by holder, not by filer.
        test('checkout by O2 (OWNER of C, not the filer) → 200, one order minted; V on the same filing → 403, nothing written', async () => {
            const quotationService = require('../../services/quotation-service');
            const { issueQuotationOnSubmit } = require('../../services/quotation-issuance-on-submit');
            const ownerPayable = await raw.application.create({
                data: {
                    applicationNumber: `APP-HS-OPAY-${fx.sfx}`, healthId: fx.users.A.canonicalId, areaType: 'OUTDOOR',
                    organizationId: fx.orgId, entityId: fx.entities.C, submitterId: fx.users.A.id,
                    status: 'PENDING_DOC_FEE', formData: {},
                },
            });
            expect(await issueQuotationOnSubmit({ application: ownerPayable, actorId: null })).toEqual({ issued: true });
            const [oqt] = await raw.quotation.findMany({ where: { applicationId: ownerPayable.id, isDeleted: false } });
            await quotationService.markQuotationAccepted(oqt.id, {
                acceptedBy: null, snapshot: quotationService.buildAcceptanceSnapshot(oqt),
            });
            await grantConsents(['O2'], ['PAYMENT_TERMS']);

            gatewaySpy.mockClear();
            const beforeV = await writeCounts();
            const denied = await request(app).post('/api/payments/checkout').set(auth('V'))
                .send({ applicationId: ownerPayable.id, milestone: 'M1' });
            expectDenied(denied);
            expect(await writeCounts()).toEqual(beforeV);
            expect(gatewaySpy).not.toHaveBeenCalled();

            const before = await writeCounts();
            const res = await request(app).post('/api/payments/checkout').set(auth('O2'))
                .send({ applicationId: ownerPayable.id, milestone: 'M1' });
            expect([res.status, res.body.code]).toEqual([200, undefined]);
            expect(res.body.data.checkoutOrderId).toBeTruthy();
            expect(gatewaySpy).toHaveBeenCalledTimes(1);
            expect((await writeCounts()).orders).toBe(before.orders + 1);
            const order = await raw.checkoutOrder.findUnique({ where: { id: res.body.data.checkoutOrderId } });
            expect(order.applicationId).toBe(ownerPayable.id);
        });

        test('checkout by A (OWNER, holds SUBMIT_APPLICATION) → 200, one order minted through the gateway', async () => {
            gatewaySpy.mockClear();
            const before = await writeCounts();
            const res = await request(app).post('/api/payments/checkout').set(auth('A'))
                .send({ applicationId: payable.id, milestone: 'M1' });
            expect(res.status).toBe(200);
            expect(res.body.data.checkoutOrderId).toBeTruthy();
            expect(gatewaySpy).toHaveBeenCalledTimes(1);
            expect((await writeCounts()).orders).toBe(before.orders + 1);
        });
    });

    // ── Task 12 (found by the R1→R2 matrix): writes the filer pin used to guard ──
    describe('Task 12: accepting a quotation and filing a report act for the holder', () => {
        let pendingApp;
        let pendingQt;
        beforeAll(async () => {
            const { issueQuotationOnSubmit } = require('../../services/quotation-issuance-on-submit');
            pendingApp = await raw.application.create({
                data: {
                    applicationNumber: `APP-HS-QACC-${fx.sfx}`, healthId: fx.users.A.canonicalId, areaType: 'OUTDOOR',
                    organizationId: fx.orgId, entityId: fx.entities.C, submitterId: fx.users.A.id,
                    status: 'PENDING_DOC_FEE', formData: {},
                },
            });
            expect(await issueQuotationOnSubmit({ application: pendingApp, actorId: null })).toEqual({ issued: true });
            [pendingQt] = await raw.quotation.findMany({ where: { applicationId: pendingApp.id, isDeleted: false } });
        });
        const accept = (actor) => request(app).post(`/api/applications/${pendingApp.id}/quotations/PLATFORM/accept`)
            .set(auth(actor)).send({});
        const qtRow = () => raw.quotation.findUnique({ where: { id: pendingQt.id } });

        test.each([['V', 'VIEWER'], ['B', 'MANAGER without SUBMIT_APPLICATION']])(
            'quotation accept by %s (%s) → 403 ENTITY_PERMISSION_DENIED; the quotation is not accepted',
            async (actor) => {
                const before = await qtRow();
                expectDenied(await accept(actor));
                const after = await qtRow();
                expect([after.status, after.acceptedAt, after.updatedAt.toISOString()])
                    .toEqual([before.status, before.acceptedAt, before.updatedAt.toISOString()]);
            },
        );

        test('quotation accept by a stranger S → 404, the quotation is not accepted', async () => {
            const before = await qtRow();
            expect((await accept('S')).status).toBe(404);
            expect((await qtRow()).status).toBe(before.status);
        });

        test('quotation accept by O2 (OWNER of C, SUBMIT_APPLICATION, not the filer) → 200, ACCEPTED', async () => {
            const res = await accept('O2');
            expect([res.status, res.body.success]).toEqual([200, true]);
            expect((await qtRow()).status).toBe('ACCEPTED');
        });

        const report = (actor, month) => request(app).post('/api/report-submissions').set(auth(actor))
            .send({ certificateId: fx.certX, reportType: 'PT27', reportMonth: month, reportYear: 2569 });
        const reportCount = () => raw.reportSubmission.count({ where: { certificateId: fx.certX } });

        test('a report on C\'s certificate by V (VIEWER, read-only) → 403 ENTITY_PERMISSION_DENIED; no report row', async () => {
            const before = await reportCount();
            expectDenied(await report('V', 2));
            expect(await reportCount()).toBe(before);
        });

        test('a report on C\'s certificate by S (stranger) → 404; no report row', async () => {
            const before = await reportCount();
            expect((await report('S', 3)).status).toBe(404);
            expect(await reportCount()).toBe(before);
        });

        test('a report on C\'s certificate by B (MANAGER, not the filer) → 201, one row', async () => {
            const before = await reportCount();
            const res = await report('B', 4);
            expect(res.status).toBe(201);
            expect(await reportCount()).toBe(before + 1);
        });
    });

    // ── C8: bundles stay the filer's; §3.3 per application inside ────────────
    test('C8: B\'s bundle holding D (created by A): B unlinking D → 403; B deleting the bundle → 403; nothing written', async () => {
        const bundle = await raw.applicationBundle.create({
            data: { bundleNumber: `BND-HS-B-${fx.sfx}`, healthId: fx.users.B.canonicalId, organizationId: fx.orgId },
        });
        await raw.application.update({ where: { id: fx.apps.D }, data: { bundleId: bundle.id } });
        const before = await writeCounts();
        const unlink = await request(app).delete(`/api/application-bundles/${bundle.id}/applications/${fx.apps.D}`).set(auth('B'));
        const del = await request(app).delete(`/api/application-bundles/${bundle.id}`).set(auth('B'));
        expectDenied(unlink);
        expectDenied(del);
        expect(await writeCounts()).toEqual(before);
        expect((await appRow(fx.apps.D)).bundleId).toBe(bundle.id);
        expect(await raw.applicationBundle.count({ where: { id: bundle.id } })).toBe(1);
        // Put D back for the delete cases below.
        await raw.application.update({ where: { id: fx.apps.D }, data: { bundleId: null } });
        await raw.applicationBundle.delete({ where: { id: bundle.id } });
    });

    test('C8: B\'s bundle holding B\'s own draft on C: B unlinks it → 200, then deletes the bundle → 200', async () => {
        const own = await raw.application.create({
            data: {
                applicationNumber: `APP-HS-BB-${fx.sfx}`, healthId: fx.users.B.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.orgId, entityId: fx.entities.C, submitterId: fx.users.B.id, status: 'DRAFT',
                formData: { plantId: 'cannabis', workflowState: 'DRAFT' },
            },
        });
        const bundle = await raw.applicationBundle.create({
            data: { bundleNumber: `BND-HS-BB-${fx.sfx}`, healthId: fx.users.B.canonicalId, organizationId: fx.orgId },
        });
        await raw.application.update({ where: { id: own.id }, data: { bundleId: bundle.id } });
        const unlink = await request(app).delete(`/api/application-bundles/${bundle.id}/applications/${own.id}`).set(auth('B'));
        expect(unlink.status).toBe(200);
        expect((await appRow(own.id)).bundleId).toBeNull();
        await raw.application.update({ where: { id: own.id }, data: { bundleId: bundle.id } });
        const del = await request(app).delete(`/api/application-bundles/${bundle.id}`).set(auth('B'));
        expect(del.status).toBe(200);
        expect(await raw.applicationBundle.count({ where: { id: bundle.id } })).toBe(0);
        expect((await appRow(own.id)).bundleId).toBeNull();
    });

    // ── R2 Task 11: the certificate PRINT_QR gate (B14) and QR exposure (C5) ──
    // Until Task 12 a certificate is read by its filer (Certificate.userId, the
    // R1 pin), so each actor downloads a certificate it filed; every one of them
    // is held by C (certificate.application.entityId). The gate asks the engine
    // on that holder, with GRANT and REVOKE, whatever the active workspace is.
    describe('Task 11: PRINT_QR on the certificate holder (real Postgres, real engine)', () => {
        const certs = {};
        const binary = (res, cb) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(Buffer.from(c)));
            res.on('end', () => cb(null, Buffer.concat(chunks)));
        };
        const download = async (actor, certId) => {
            const res = await request(app).get(`/api/certificates/${certId}/download`)
                .set(auth(actor)).buffer(true).parse(binary);
            const rawBody = res.body;
            let json = null;
            if (/json/.test(res.headers['content-type'] || '')) { json = JSON.parse(rawBody.toString('utf8')); }
            return { status: res.status, type: res.headers['content-type'] || '', rawBody, json };
        };
        /** A refusal carries the one denial body and nothing of the certificate. */
        const expectPrintDenied = (r) => {
            expect(r.status).toBe(403);
            expect(r.type).toMatch(/application\/json/);
            expect(r.rawBody.includes('%PDF')).toBe(false);
            expectDenied({ status: r.status, body: r.json });
            expect(r.json.permission).toBe('PRINT_QR');
            expect(r.json).not.toHaveProperty('qrCode');
            expect(r.json).not.toHaveProperty('qrData');
        };
        const expectPdf = (r) => {
            expect(r.status).toBe(200);
            expect(r.type).toMatch(/application\/pdf/);
            expect(r.rawBody.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        };
        const membershipOf = async (userKey, entityKey) => (await raw.entityMembership.findUnique({
            where: { userId_entityId: { userId: fx.users[userKey].id, entityId: fx.entities[entityKey] } },
        })).id;
        const setGrant = async (userKey, entityKey, effect) => raw.entityMemberPermissionGrant.create({
            data: {
                membershipId: await membershipOf(userKey, entityKey), permission: 'PRINT_QR', effect,
                grantedBy: fx.users.A.id, organizationId: fx.orgId,
            },
        });
        const clearGrant = async (userKey, entityKey) => raw.entityMemberPermissionGrant.deleteMany({
            where: { membershipId: await membershipOf(userKey, entityKey), permission: 'PRINT_QR' },
        });
        const mkCert = async (key, applicationId, userKey) => {
            certs[key] = (await raw.certificate.create({
                data: {
                    certificateNumber: `GACP-HS-T11-${key}-${fx.sfx}`, verificationCode: `V-T11-${key}-${fx.sfx}`,
                    qrData: `qr-t11-${key}`, applicationId, userId: fx.users[userKey].id, farmId: fx.more.farm,
                    farmName: 'ฟาร์มโฮลเดอร์', applicantName: 'ทดสอบ', cropType: 'cannabis', farmSize: 1,
                    province: 'สมุทรปราการ', district: 'บางพลี', subDistrict: 'บางพลีใหญ่', standardId: 'std',
                    standardName: 'GACP', expiryDate: new Date(Date.now() + 365 * 86400e3), issuedBy: fx.users.F.id,
                    status: 'active', organizationId: fx.orgId, holderType: 'JURISTIC',
                    holderDisplayName: 'บริษัท โฮลเดอร์ จำกัด', submittedByUserId: fx.users[userKey].id,
                },
            })).id;
        };
        const myRow = async (actor, certId) => {
            const res = await request(app).get('/api/certificates/my').set(auth(actor));
            expect(res.status).toBe(200);
            return res.body.data.find((r) => r.id === certId);
        };

        beforeAll(async () => {
            // V and B each filed a certificate of C's application X (filed while they
            // could submit; a role changes after issuance, the filing does not).
            await mkCert('V', fx.apps.X, 'V');
            await mkCert('B', fx.apps.X, 'B');
            // A legacy certificate whose application has no holder (fail closed).
            const legacy = await raw.application.create({
                data: {
                    applicationNumber: `APP-HS-T11-NULL-${fx.sfx}`, healthId: fx.users.A.canonicalId, areaType: 'OUTDOOR',
                    organizationId: fx.orgId, entityId: null, submitterId: fx.users.A.id, status: 'CERTIFIED',
                    formData: { plantId: 'cannabis', workflowState: 'CERTIFIED' },
                },
            });
            await mkCert('NULL', legacy.id, 'A');
        });

        afterAll(async () => {
            for (const [u, e] of [['V', 'C'], ['A', 'C']]) { await clearGrant(u, e); }
        });

        test('V (VIEWER) downloads its certificate of C → 403 ENTITY_PERMISSION_DENIED (not CAPABILITY_DENIED), no PDF bytes', async () => {
            expectPrintDenied(await download('V', certs.V));
        });

        test('B (MANAGER) downloads its certificate of C → 200 PDF', async () => {
            expectPdf(await download('B', certs.B));
        });

        test('A (OWNER) downloads certX → 200 PDF', async () => {
            expectPdf(await download('A', fx.certX));
        });

        test('S (stranger) downloads certX → 404, no PDF bytes', async () => {
            const r = await download('S', fx.certX);
            expect(r.status).toBe(404);
            expect(r.rawBody.includes('%PDF')).toBe(false);
        });

        // R2 Task 12 (spec §3.1 "no filer fallback"): a null-holder row is readable by
        // no one on the health side, so its own filer gets 404 (Task 11: 403 by the gate).
        test('a certificate whose application has no holder → 404 for its own filer, no PDF bytes (fail closed)', async () => {
            const r = await download('A', certs.NULL);
            expect(r.status).toBe(404);
            expect(r.rawBody.includes('%PDF')).toBe(false);
        });

        test('V /certificates/my row: canPrintQr false, qrCode null; B row: canPrintQr true, qrCode kept', async () => {
            const v = await myRow('V', certs.V);
            expect(v).toBeDefined();
            expect(v.canPrintQr).toBe(false);
            expect(v.qrCode).toBeNull();
            const b = await myRow('B', certs.B);
            expect(b.canPrintQr).toBe(true);
            expect(b.qrCode).toBe('qr-t11-B');
            // The null-holder certificate is not listed at all (spec §3.1, R2 Task 12).
            expect(await myRow('A', certs.NULL)).toBeUndefined();
        });

        test('V GET /certificates/:id: canPrintQr false and qrData null; B: canPrintQr true and qrData kept', async () => {
            const v = await request(app).get(`/api/certificates/${certs.V}`).set(auth('V'));
            expect(v.status).toBe(200);
            expect(v.body.data.canPrintQr).toBe(false);
            expect(v.body.data.qrData).toBeNull();
            expect(v.body.data.application).toEqual({ applicationNumber: `APP-HS-X-${fx.sfx}` });
            const b = await request(app).get(`/api/certificates/${certs.B}`).set(auth('B'));
            expect(b.status).toBe(200);
            expect(b.body.data.canPrintQr).toBe(true);
            expect(b.body.data.qrData).toBe('qr-t11-B');
        });

        test('round 1: GET /certificates (list) — V (VIEWER, no grant) gets no QR value; A (OWNER) and B (MANAGER) do', async () => {
            const listed = async (actor, certId) => {
                const res = await request(app).get('/api/certificates').set(auth(actor));
                expect(res.status).toBe(200);
                return res.body.data.find((r) => r.id === certId);
            };
            const listRow = async (actor, certId) => {
                const row = await listed(actor, certId);
                expect(row).toBeDefined();
                return row;
            };
            const v = await listRow('V', certs.V);
            expect(v.canPrintQr).toBe(false);
            expect(v.qrData).toBeNull();
            expect(v.qrCode ?? null).toBeNull();
            expect(JSON.stringify(v)).not.toContain('qr-t11-V');
            const a = await listRow('A', fx.certX);
            expect(a.canPrintQr).toBe(true);
            expect(a.qrData).toBe('qr');
            const b = await listRow('B', certs.B);
            expect(b.canPrintQr).toBe(true);
            expect(b.qrData).toBe('qr-t11-B');
            // The holder id read for the gate is not added to the row.
            expect(a).not.toHaveProperty('application');
            // The null-holder certificate is not listed at all (spec §3.1, R2 Task 12).
            expect(await listed('A', certs.NULL)).toBeUndefined();
        });

        test('V with a PRINT_QR GRANT on C → download 200, /my canPrintQr true', async () => {
            await setGrant('V', 'C', 'GRANT');
            expectPdf(await download('V', certs.V));
            const v = await myRow('V', certs.V);
            expect(v.canPrintQr).toBe(true);
            expect(v.qrCode).toBe('qr-t11-V');
            await clearGrant('V', 'C');
        });

        test('A (OWNER) with a PRINT_QR REVOKE on C → download 403; /my and /:id hide the QR', async () => {
            await setGrant('A', 'C', 'REVOKE');
            expectPrintDenied(await download('A', fx.certX));
            const row = await myRow('A', fx.certX);
            expect(row.canPrintQr).toBe(false);
            expect(row.qrCode).toBeNull();
            const detail = await request(app).get(`/api/certificates/${fx.certX}`).set(auth('A'));
            expect(detail.status).toBe(200);
            expect(detail.body.data.canPrintQr).toBe(false);
            expect(detail.body.data.qrData).toBeNull();
            await clearGrant('A', 'C');
            expectPdf(await download('A', fx.certX));
        });
    });

    // ── case 4: deleting a draft (§3.3) ──────────────────────────────────────
    test('case 4: B (MANAGER, not creator) deletes D → 403 ENTITY_PERMISSION_DENIED; D not deleted', async () => {
        const before = await writeCounts();
        const res = await request(app).delete(`/api/applications/draft/${fx.apps.D}`).set(auth('B'));
        expectDenied(res);
        expect(await writeCounts()).toEqual(before);
        expect((await appRow(fx.apps.D)).isDeleted).toBe(false);
    });

    test('case 4: V (VIEWER) deletes D → 403; D not deleted', async () => {
        const before = await writeCounts();
        const res = await request(app).delete(`/api/applications/draft/${fx.apps.D}`).set(auth('V'));
        expect([res.status, res.body.code]).toEqual([403, 'ENTITY_PERMISSION_DENIED']);
        expect(await writeCounts()).toEqual(before);
    });

    test('case 4: O2 (OWNER, not creator) deletes D2 → 200, D2 soft-deleted', async () => {
        const res = await request(app).delete(`/api/applications/draft/${fx.apps.D2}`).set(auth('O2'));
        expect([res.status, res.body.data.deleted]).toEqual([200, true]);
        expect((await appRow(fx.apps.D2)).isDeleted).toBe(true);
    });

    test('case 4: A (creator, OWNER) deletes D → 200, D soft-deleted', async () => {
        const res = await request(app).delete(`/api/applications/draft/${fx.apps.D}`).set(auth('A'));
        expect([res.status, res.body.data.deleted]).toEqual([200, true]);
        expect((await appRow(fx.apps.D)).isDeleted).toBe(true);
    });

    // ── case 8b: revoked mid-draft (last: it changes A's membership) ─────────
    test('case 8b: A REVOKED on C → POST /draft {applicationId: D3} → 404, applications count unchanged', async () => {
        // D was deleted by case 4; D3 is another of A's open drafts on C.
        fx.apps.D3 = (await raw.application.create({
            data: {
                applicationNumber: `APP-HS-D3-${fx.sfx}`, healthId: fx.users.A.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.orgId, entityId: fx.entities.C, submitterId: fx.users.A.id, status: 'DRAFT',
                formData: { plantId: 'cannabis', workflowState: 'DRAFT' },
            },
        })).id;
        await raw.entityMembership.update({
            where: { userId_entityId: { userId: fx.users.A.id, entityId: fx.entities.C } },
            data: { status: 'REVOKED' },
        });
        const before = await appCount();
        const dBefore = await appRow(fx.apps.D3);
        const res = await request(app).post('/api/applications/draft').set(auth('A'))
            .send({ applicationId: fx.apps.D3, step: 1, formData: { plantId: 'cannabis' } });
        expect(res.status).toBe(404);
        expect(await appCount()).toBe(before);
        expect((await appRow(fx.apps.D3)).updatedAt.toISOString()).toBe(dBefore.updatedAt.toISOString());
    });

    // ── case 8 (Task 12): a revoked membership takes the company's rows away ──
    test('case 8: A REVOKED on C → X gone from A\'s list and 404 by id, though A filed it', async () => {
        await raw.entityMembership.update({
            where: { userId_entityId: { userId: fx.users.A.id, entityId: fx.entities.C } },
            data: { status: 'REVOKED' },
        });
        const list = await request(app).get('/api/applications/my').set(auth('A'));
        expect(list.status).toBe(200);
        const listed = list.body.data.map((r) => r.id);
        expect(listed).not.toContain(fx.apps.X);
        expect(listed).toContain(fx.apps.Y);
        expect((await request(app).get(`/api/applications/${fx.apps.X}`).set(auth('A'))).status).toBe(404);
    });
});
