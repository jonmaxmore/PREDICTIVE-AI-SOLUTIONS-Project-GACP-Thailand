'use strict';
/**
 * Task 6 (document pre-check) — the whole flow against a REAL Postgres (a
 * throwaway container, `prisma migrate deploy`), REAL extraction
 * (services/document-precheck/extract.js — its forked pdf-parse child for
 * PDFs) and REAL tesseract (the PNG case). The only thing replaced is Redis:
 * `getPrecheckQueue()` returns a stand-in whose `add` records or throws, and
 * the processor (jobs/document-precheck-processor.js) is called directly with
 * the job Bull would have handed it.
 *
 * The upload door (POST /api/applications/draft-documents) runs for real on
 * the enqueue-failure case — its real router, real storage, real content
 * guard, real database — with only authentication and the health-identity
 * lookup stubbed (both are the caller, not the thing under test).
 *
 * Requires a migrated test database (test-support/test-database.js's
 * run-level guard); skips cleanly without one, same as
 * document-precheck-schema.test.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const mockQueueRef = { current: null };
jest.mock('../../services/queue-service', () => ({
    getPrecheckQueue: () => mockQueueRef.current,
}));

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
    // The identity lookup is the caller's side (hash-first user lookup), not
    // the thing under test; everything else on the service is the real one.
    actual.resolveHealthIdentity = async () => mockHealthIdentity.current.identity;
    return actual;
});

// Real extraction, with one observation hook: the in-flight race test needs to
// know that A has really started extracting before it uploads B.
const mockExtractStarted = { notify: null };
jest.mock('../../services/document-precheck/extract', () => {
    const actual = jest.requireActual('../../services/document-precheck/extract');
    return {
        ...actual,
        extractDocument: (...args) => {
            if (mockExtractStarted.notify) {
                mockExtractStarted.notify();
            }
            return actual.extractDocument(...args);
        },
    };
});

const service = require('../../services/document-precheck/service');
const processPrecheckJob = require('../../jobs/document-precheck-processor');

const FONT_PATH = path.join(__dirname, '..', '..', '..', 'mobile-app', 'assets', 'fonts', 'Sarabun-Regular.ttf');
const FAILURE_REASON = 'ตรวจอัตโนมัติไม่สำเร็จ เจ้าหน้าที่จะตรวจเอง';
const APPLICANT_FIRST = 'สมชาย';
const APPLICANT_LAST = 'ใจดี';
const DEED_TEXT = `โฉนดที่ดิน เลขที่ 12345 ผู้ถือกรรมสิทธิ์ นาย${APPLICANT_FIRST} ${APPLICANT_LAST}`;

const timings = [];
function timed(label, fn) {
    return async () => {
        const start = Date.now();
        try {
            return await fn();
        } finally {
            timings.push({ label, ms: Date.now() - start });
        }
    };
}

function suffix() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function writeTextLayerPdf(filePath, text) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);
        doc.font(FONT_PATH).fontSize(24).text(text);
        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}

async function writeTextPng(filePath, text) {
    const fontBase64 = fs.readFileSync(FONT_PATH).toString('base64');
    const svg = `
        <svg width="1800" height="200" xmlns="http://www.w3.org/2000/svg">
            <style>
                @font-face { font-family: 'PrecheckFlowFont'; src: url(data:font/ttf;base64,${fontBase64}) format('truetype'); }
                text { font-family: 'PrecheckFlowFont'; font-size: 48px; fill: #000000; }
            </style>
            <rect width="100%" height="100%" fill="#ffffff"/>
            <text x="20" y="120">${text}</text>
        </svg>`;
    await sharp(Buffer.from(svg)).png().toFile(filePath);
}

function recordingQueue() {
    return { add: jest.fn(async () => ({ id: `job-${suffix()}` })) };
}

function jobFor(precheckId, file, attemptsMade = 0) {
    return { id: `job-${precheckId}`, data: { precheckId, absPath: file.absPath, mimeType: file.mimeType }, attemptsMade, opts: { attempts: 2 } };
}

d('document-precheck flow (real Postgres + real extract + real tesseract)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let tmpDir;
    let deedPdf;
    let deedPng;
    const fx = {};
    const suiteStart = Date.now();

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'precheck-flow-'));
        deedPdf = { absPath: path.join(tmpDir, 'deed.pdf'), mimeType: 'application/pdf' };
        deedPng = { absPath: path.join(tmpDir, 'deed.png'), mimeType: 'image/png' };
        await writeTextLayerPdf(deedPdf.absPath, DEED_TEXT);
        await writeTextPng(deedPng.absPath, 'โฉนดที่ดิน');

        const s = suffix();
        const org = await raw.organization.create({
            data: { name: `precheck flow org ${s}`, slug: `precheck-flow-${s}`, code: `PCF_${s}`.toUpperCase().slice(0, 24) },
        });
        const canonicalId = `precheck-flow-user-${s}`;
        const user = await raw.user.create({
            data: {
                canonicalId,
                password: 'x',
                organizationId: org.id,
                authType: 'EMAIL_LEGACY',
                firstName: APPLICANT_FIRST,
                lastName: APPLICANT_LAST,
                email: `precheck-flow-${s}@example.test`,
                phoneNumber: '0810000000',
            },
        });
        const entity = await raw.entity.create({
            data: { type: 'INDIVIDUAL', displayName: `${APPLICANT_FIRST} ${APPLICANT_LAST}`, organizationId: org.id },
        });
        // The applicant is the holder's ACTIVE owner: the upload door loads the
        // draft by id within the caller's holders, and edits it only when the
        // holder is in the caller's edit set (spec 2026-09-30 §3.1-3.2).
        await raw.entityMembership.create({
            data: { userId: user.id, entityId: entity.id, role: 'OWNER', status: 'ACTIVE', organizationId: org.id },
        });
        const app = await raw.application.create({
            data: {
                applicationNumber: `PRECHECK-FLOW-${s}`,
                healthId: canonicalId,
                entityId: entity.id,
                submitterId: user.id,
                areaType: 'OUTDOOR',
                organizationId: org.id,
                status: 'DRAFT',
                formData: { steps: {}, workflowState: 'DRAFT' },
            },
        });
        Object.assign(fx, { orgId: org.id, userId: user.id, canonicalId, entityId: entity.id, applicationId: app.id });
        mockHealthIdentity.current = {
            reqUser: { id: user.id, role: 'health', canonicalRole: 'health' },
            identity: { userId: user.id, healthId: canonicalId },
        };
    });

    afterAll(async () => {
        if (fx.applicationId) {
            await raw.documentPrecheckFlag.deleteMany({ where: { organizationId: fx.orgId } }).catch(() => {});
            await raw.documentPrecheck.deleteMany({ where: { applicationId: fx.applicationId } }).catch(() => {});
            await raw.applicationDocument.deleteMany({ where: { applicationId: fx.applicationId } }).catch(() => {});
            await raw.application.deleteMany({ where: { id: fx.applicationId } }).catch(() => {});
        }
        if (fx.entityId) {
            await raw.entityMembership.deleteMany({ where: { entityId: fx.entityId } }).catch(() => {});
            await raw.entity.deleteMany({ where: { id: fx.entityId } }).catch(() => {});
        }
        if (fx.userId) {
            await raw.user.deleteMany({ where: { id: fx.userId } }).catch(() => {});
        }
        if (fx.orgId) {
            await raw.organization.deleteMany({ where: { id: fx.orgId } }).catch(() => {});
        }
        await raw.$disconnect();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        // jest.setup.js mocks console.log; the timing table goes straight to stdout.
        const lines = [`\n--- document-precheck-flow wall time: total ${Date.now() - suiteStart}ms ---`];
        for (const t of timings) {
            lines.push(`  ${t.label}: ${t.ms}ms`);
        }
        process.stdout.write(`${lines.join('\n')}\n`);
    });

    beforeEach(() => {
        mockQueueRef.current = recordingQueue();
    });

    function enqueue(slotId, file) {
        return service.enqueueForUpload({
            applicationId: fx.applicationId,
            organizationId: fx.orgId,
            documentId: `doc-${suffix()}`,
            slotId,
            absPath: file.absPath,
            mimeType: file.mimeType,
        });
    }

    function load(precheckId) {
        return raw.documentPrecheck.findUnique({ where: { id: precheckId }, include: { flags: true } });
    }

    test('a land_deed upload creates a PENDING row; the processor gives DONE with exactly the checks CATALOG defines (4)', timed('land_deed text-layer PDF', async () => {
        const { precheckId } = await enqueue('land_deed', deedPdf);
        expect((await load(precheckId)).status).toBe('PENDING');
        expect(mockQueueRef.current.add).toHaveBeenCalledWith({ precheckId, absPath: deedPdf.absPath, mimeType: deedPdf.mimeType }, { jobId: precheckId });

        await processPrecheckJob(jobFor(precheckId, deedPdf));

        const row = await load(precheckId);
        expect(row).toMatchObject({ status: 'DONE', slotId: 'land_rights', rulesVersion: 1, extractMethod: 'TEXT_LAYER', ocrConfidence: 100, pageCount: 1 });
        expect(row.completedAt).toBeInstanceOf(Date);
        expect(row.extractedText).toContain('โฉนดที่ดิน');
        // land_deed has no VALIDITY rule in CATALOG (catalog.js) → 4, not 5
        expect(row.flags.map((f) => f.check).sort()).toEqual(['CROSS_MATCH', 'DOC_TYPE', 'READABILITY', 'SIGNATURE']);
        expect(row.flags.find((f) => f.check === 'DOC_TYPE').result).toBe('MATCH');
        expect(row.flags.find((f) => f.check === 'CROSS_MATCH').result).toBe('MATCH');
        expect(row.flags.every((f) => f.organizationId === fx.orgId)).toBe(true);
    }), 60000);

    test('a scanned (PNG) land_deed goes through real tesseract: DONE, OCR method, a real confidence', timed('land_deed PNG through tesseract', async () => {
        const { precheckId } = await enqueue('land_deed', deedPng);

        await processPrecheckJob(jobFor(precheckId, deedPng));

        const row = await load(precheckId);
        expect(row.status).toBe('DONE');
        expect(row.extractMethod).toBe('OCR');
        expect(row.ocrConfidence).toBeGreaterThan(0);
        expect(row.ocrConfidence).toBeLessThanOrEqual(100);
        expect(row.flags.map((f) => f.check).sort()).toEqual(['CROSS_MATCH', 'DOC_TYPE', 'READABILITY', 'SIGNATURE']);
    }), 90000);

    test('a slot outside scope (sop_cultivation) creates no row', timed('sop_cultivation out of scope', async () => {
        const before = await raw.documentPrecheck.count({ where: { applicationId: fx.applicationId } });

        const result = await enqueue('sop_cultivation', deedPdf);

        expect(result).toBeNull();
        expect(await raw.documentPrecheck.count({ where: { applicationId: fx.applicationId } })).toBe(before);
        expect(mockQueueRef.current.add).not.toHaveBeenCalled();
    }));

    test('precheck-supersede-race: upload A → upload B (same slot) → A\'s job runs after B exists: A\'s flags are not written, A is SUPERSEDED', timed('supersede race (A after B)', async () => {
        const a = await enqueue('house_reg', deedPdf);
        const b = await enqueue('house_reg', deedPdf);

        await processPrecheckJob(jobFor(a.precheckId, deedPdf));

        const rowA = await load(a.precheckId);
        expect(rowA.status).toBe('SUPERSEDED');
        expect(rowA.flags).toHaveLength(0);
        expect(rowA.extractedText).toBeNull();

        await processPrecheckJob(jobFor(b.precheckId, deedPdf));
        const rowB = await load(b.precheckId);
        expect(rowB.status).toBe('DONE');
        expect(rowB.flags.length).toBeGreaterThan(0);
    }), 60000);

    test('precheck-supersede-race, in flight: B lands while A is extracting → A ends SUPERSEDED with no flags', timed('supersede race (in flight)', async () => {
        const a = await enqueue('land_lease', deedPdf);

        const started = new Promise((resolve) => {
            mockExtractStarted.notify = resolve;
        });
        const running = processPrecheckJob(jobFor(a.precheckId, deedPdf));
        await started; // A has read its PENDING row and real extraction has begun
        mockExtractStarted.notify = null;
        const b = await enqueue('land_lease', deedPdf);
        await running;

        const rowA = await load(a.precheckId);
        expect(rowA.status).toBe('SUPERSEDED');
        expect(rowA.flags).toHaveLength(0);
        expect((await load(b.precheckId)).status).toBe('PENDING');
    }), 60000);

    // Fix round 1 (M2): under READ COMMITTED two concurrent supersede+insert
    // transactions for one slot never see each other's insert, so both rows
    // stayed PENDING. Several independent pairs, so the RED is not luck.
    test('two concurrent uploads into one slot → exactly one PENDING row, the other SUPERSEDED', timed('concurrent enqueue x5 pairs', async () => {
        const slots = ['land_rights', 'id_house_reg', 'juristic_reg_6m', 'landlord_consent', 'prev_cert_original'];
        for (const slot of slots) {
            const [first, second] = await Promise.all([enqueue(slot, deedPdf), enqueue(slot, deedPdf)]);
            const rows = await raw.documentPrecheck.findMany({
                where: { id: { in: [first.precheckId, second.precheckId] } },
                select: { status: true },
            });
            expect(rows.map((r) => r.status).sort()).toEqual(['PENDING', 'SUPERSEDED']);
            expect(await raw.documentPrecheck.count({ where: { applicationId: fx.applicationId, slotId: slot, status: 'PENDING' } })).toBe(1);
        }
    }), 60000);

    test('a processor exception yields FAILED plus the flag after the retry; nothing is left PENDING', timed('processor exception (missing file)', async () => {
        const missing = { absPath: path.join(tmpDir, 'gone.pdf'), mimeType: 'application/pdf' };
        const { precheckId } = await enqueue('company_reg', missing);

        // attempt 1 of 2: extraction throws (ENOENT from the real readFile) → rethrown for the queue's retry
        await expect(processPrecheckJob(jobFor(precheckId, missing, 0))).rejects.toMatchObject({ code: 'ENOENT' });
        expect((await load(precheckId)).status).toBe('PENDING');

        await expect(processPrecheckJob(jobFor(precheckId, missing, 1))).resolves.toBeUndefined();
        const row = await load(precheckId);
        expect(row.status).toBe('FAILED');
        expect(row.flags).toHaveLength(1);
        expect(row.flags[0]).toMatchObject({ check: 'READABILITY', result: 'UNREADABLE', reasonTH: FAILURE_REASON, organizationId: fx.orgId });
        expect(await raw.documentPrecheck.count({ where: { applicationId: fx.applicationId, slotId: 'juristic_reg_6m', status: 'PENDING' } })).toBe(0);
    }), 60000);

    test('enqueue-failure-still-uploads: the queue add throws → POST /draft-documents still returns 200 and the row is FAILED with the failure flag', timed('upload door, queue add throws', async () => {
        mockQueueRef.current.add.mockRejectedValue(new Error('Redis connection refused'));
        const applicationsRouter = require('../../routes/api/applications/applications');
        const storageService = require('../../services/storage-service');
        const draftDir = path.join(storageService.BASE_UPLOAD_DIR, 'application-drafts');
        const listDraftDir = () => (fs.existsSync(draftDir) ? new Set(fs.readdirSync(draftDir)) : new Set());
        const app = express();
        app.use(express.json());
        app.use('/api/applications', applicationsRouter);

        const before = listDraftDir();
        let res;
        try {
            res = await request(app)
                .post('/api/applications/draft-documents')
                .field('slotId', 'land_deed')
                .field('stepKey', 'documents')
                .attach('file', fs.readFileSync(deedPdf.absPath), { filename: 'deed.pdf', contentType: 'application/pdf' });
        } finally {
            // the stored upload bytes are this suite's to clean up, pass or fail
            for (const name of listDraftDir()) {
                if (!before.has(name)) {
                    fs.rmSync(path.join(draftDir, name), { force: true });
                }
            }
        }

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Object.keys(res.body.data).sort()).toEqual(['applicationId', 'documentId', 'draftId', 'fileName', 'fileUrl', 'mimeType', 'size']);
        expect(res.body.data.applicationId).toBe(fx.applicationId);

        const row = await raw.documentPrecheck.findUnique({ where: { documentId: res.body.data.documentId }, include: { flags: true } });
        expect(row).not.toBeNull();
        expect(row.status).toBe('FAILED');
        expect(row.slotId).toBe('land_rights');
        expect(row.flags).toHaveLength(1);
        expect(row.flags[0]).toMatchObject({ check: 'READABILITY', result: 'UNREADABLE', reasonTH: FAILURE_REASON });
    }), 60000);

    // Final review I2: deleting a file retires its pre-check — SUPERSEDED, the
    // page text and every quoted snippet cleared — so neither side is shown
    // observations about a file that is gone. Real upload, delete and
    // requirements doors; only auth, the identity lookup and Redis are stubbed.
    describe('deleting the file retires its pre-check (final review I2)', () => {
        const storedUploads = [];
        let ruleId;

        beforeAll(async () => {
            // The requirements door lists a slot only when the register demands
            // it for this filing's plant (as document-precheck-api.test.js does).
            const { deriveDimensions } = require('../../services/application-requirements-service');
            const application = await raw.application.findUnique({ where: { id: fx.applicationId }, select: { formData: true } });
            await raw.application.update({
                where: { id: fx.applicationId },
                data: { formData: { ...(application.formData || {}), plantId: 'cannabis' } },
            });
            const rule = await raw.requirementRule.create({
                data: {
                    plantCode: deriveDimensions({ id: 'probe', areaType: 'OUTDOOR', formData: { plantId: 'cannabis' } }).plantCode,
                    slotId: 'land_rights',
                    isRequired: true,
                    effectiveFrom: new Date('2020-01-01'),
                    createdBy: fx.userId,
                    reason: 'fixture: land_rights is required so the slot is on the filing',
                },
                select: { id: true },
            });
            ruleId = rule.id;
        });

        afterAll(async () => {
            if (ruleId) {
                await raw.requirementRule.deleteMany({ where: { id: ruleId } }).catch(() => {});
            }
            // the stored bytes are this suite's to clean up if a delete never ran
            for (const file of storedUploads) {
                fs.rmSync(file, { force: true });
            }
        });

        function applicantDoors() {
            const applicationsRouter = require('../../routes/api/applications/applications');
            const requirementsRouter = require('../../routes/api/applications/requirements');
            const app = express();
            app.use(express.json());
            app.use('/api/applications', requirementsRouter);
            app.use('/api/applications', applicationsRouter);
            return app;
        }

        async function uploadThroughTheDoor(app, slotId, file) {
            const res = await request(app)
                .post('/api/applications/draft-documents')
                .field('slotId', slotId)
                .field('stepKey', 'documents')
                .attach('file', fs.readFileSync(file.absPath), { filename: path.basename(file.absPath), contentType: file.mimeType });
            expect(res.status).toBe(200);
            const queued = mockQueueRef.current.add.mock.calls.at(-1)[0];
            storedUploads.push(queued.absPath);
            return { documentId: res.body.data.documentId, job: { id: `job-${queued.precheckId}`, data: queued, attemptsMade: 0, opts: { attempts: 2 } } };
        }

        async function landRightsPrecheck(app) {
            const res = await request(app).get(`/api/applications/${fx.applicationId}/requirements`);
            expect(res.status).toBe(200);
            const slot = res.body.data.slots.find((entry) => entry.slotId === 'land_rights');
            expect(slot).toBeDefined();
            return slot.precheck;
        }

        test('delete a checked file → its pre-check is SUPERSEDED, text and snippets null, and the requirements door shows precheck null', timed('upload → DONE → delete', async () => {
            const app = applicantDoors();
            const { documentId, job } = await uploadThroughTheDoor(app, 'land_deed', deedPdf);
            await processPrecheckJob(job);

            const done = await raw.documentPrecheck.findUnique({ where: { documentId }, include: { flags: true } });
            expect(done.status).toBe('DONE');
            expect(done.extractedText).toContain('โฉนดที่ดิน');
            expect(done.flags.some((f) => f.evidenceSnippet !== null)).toBe(true);
            expect(await landRightsPrecheck(app)).toMatchObject({ id: done.id, status: 'DONE' });

            const del = await request(app).delete(`/api/applications/draft-documents/${documentId}`);
            expect(del.status).toBe(200);
            expect(del.body).toEqual({ success: true, data: { applicationId: fx.applicationId, documentId, deleted: true } });

            const retired = await raw.documentPrecheck.findUnique({ where: { documentId }, include: { flags: true } });
            expect(retired.status).toBe('SUPERSEDED');
            expect(retired.extractedText).toBeNull();
            expect(retired.flags.length).toBe(done.flags.length);
            expect(retired.flags.map((f) => f.evidenceSnippet)).toEqual(done.flags.map(() => null));
            expect(await landRightsPrecheck(app)).toBeNull();
        }), 60000);

        test('delete while the job is still queued → the late job writes nothing: SUPERSEDED, no text, no flags', timed('upload → delete → late job', async () => {
            const app = applicantDoors();
            const { documentId, job } = await uploadThroughTheDoor(app, 'land_deed', deedPdf);
            expect((await raw.documentPrecheck.findUnique({ where: { documentId } })).status).toBe('PENDING');

            const del = await request(app).delete(`/api/applications/draft-documents/${documentId}`);
            expect(del.status).toBe(200);
            await processPrecheckJob({ ...job, data: { ...job.data, absPath: deedPdf.absPath } });

            const row = await raw.documentPrecheck.findUnique({ where: { documentId }, include: { flags: true } });
            expect(row.status).toBe('SUPERSEDED');
            expect(row.extractedText).toBeNull();
            expect(row.flags).toHaveLength(0);
            expect(await landRightsPrecheck(app)).toBeNull();
        }), 60000);
    });
});
