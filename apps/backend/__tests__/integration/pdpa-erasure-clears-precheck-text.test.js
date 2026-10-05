/**
 * erasure clears precheck text — Task 10 fix round 1 (security review I1), on a
 * REAL Postgres.
 *
 * A user who exercises PDPA ม.32 erasure (services/pdpa-erasure-service.js
 * executeErasure) is soft-deleted in the same transaction (User.isDeleted), so
 * the nightly retention sweep — which reads users through the soft-delete
 * filter — never sees them again. If erasure itself does not clear the
 * pre-check's page text (DocumentPrecheck.extractedText) and snippets
 * (DocumentPrecheckFlag.evidenceSnippet), that text stays forever.
 *
 * What stays, as in the retention sweep: the rows, status, and each
 * observation's check/result/reasonTH/confidence. An application under legal
 * hold keeps its text (negative control).
 *
 * Seeding and read-back use a RAW PrismaClient (no extensions) so the
 * assertions are what the database holds.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

// Final review I3: a job still queued at erasure time must not write the page
// text back. Extraction (file → text) is the one thing replaced: it always
// "reads" PAGE_TEXT, so a row that is still PENDING when the processor runs
// WOULD receive it — the control test below proves that.
jest.mock('../../services/document-precheck/extract', () => ({
    extractDocument: jest.fn(async () => ({
        method: 'TEXT_LAYER',
        pageCount: 1,
        truncated: false,
        pages: [{ text: 'หนังสือรับรองการจดทะเบียน นายสมชาย ใจดี เลขประจำตัว 1103700012345', confidence: 100 }],
    })),
}));

const PAGE_TEXT = 'หนังสือรับรองการจดทะเบียน นายสมชาย ใจดี เลขประจำตัว 1103700012345';
const SNIPPET = 'นายสมชาย ใจดี …2345';

function suffix() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

d('erasure clears precheck text (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let erasureService;
    let orgId;
    const created = { users: [], applications: [], prechecks: [] };

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        erasureService = require('../../services/pdpa-erasure-service');
        const s = suffix();
        const org = await raw.organization.create({
            data: { name: 'PDPA erasure precheck org', slug: `pdpa-er-pc-${s}`, code: `PDPAERPC_${s}`.toUpperCase().slice(0, 24) },
        });
        orgId = org.id;
    });

    afterAll(async () => {
        if (created.prechecks.length) {
            await raw.documentPrecheckFlag.deleteMany({ where: { precheckId: { in: created.prechecks } } }).catch(() => {});
            await raw.documentPrecheck.deleteMany({ where: { id: { in: created.prechecks } } }).catch(() => {});
        }
        if (created.applications.length) {
            await raw.application.deleteMany({ where: { id: { in: created.applications } } }).catch(() => {});
        }
        if (created.users.length) {
            await raw.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => {});
        }
        if (orgId) {
            await raw.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        }
        await raw.$disconnect();
    });

    /** One user; one application per entry of `applicationHolds`, each with one DONE pre-check and two snippets. */
    async function seedUser(applicationHolds) {
        const s = suffix();
        const canonicalId = `pdpa-er-pc-canon-${s}`;
        const user = await raw.user.create({
            data: {
                canonicalId,
                healthId: `pdpa-er-pc-hid-${s}`,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
                firstName: 'สมชาย',
                lastName: 'ใจดี',
            },
        });
        created.users.push(user.id);
        const prechecksByHold = {};
        for (const [i, legalHold] of applicationHolds.entries()) {
            const application = await raw.application.create({
                data: {
                    applicationNumber: `PDPA-ER-PC-${s}-${i}`,
                    healthId: canonicalId,
                    areaType: 'OUTDOOR',
                    organizationId: orgId,
                    status: 'PENDING_DOC_FEE',
                    legalHold,
                },
            });
            created.applications.push(application.id);
            const precheck = await raw.documentPrecheck.create({
                data: {
                    organizationId: orgId,
                    applicationId: application.id,
                    documentId: `doc-${s}-${i}`,
                    slotId: 'company_reg',
                    status: 'DONE',
                    rulesVersion: 1,
                    extractMethod: 'OCR',
                    ocrConfidence: 88,
                    pageCount: 1,
                    extractedText: PAGE_TEXT,
                    flags: {
                        create: [
                            { organizationId: orgId, check: 'DOC_TYPE', result: 'MATCH', reasonTH: 'ตรงกับชนิดเอกสาร', confidence: 88, evidenceSnippet: 'หนังสือรับรองการจดทะเบียน' },
                            { organizationId: orgId, check: 'CROSS_MATCH', result: 'MISMATCH', reasonTH: 'ข้อมูลในเอกสารไม่ตรงกับข้อมูลที่กรอกไว้ กรุณาตรวจสอบอีกครั้ง', confidence: 88, evidenceSnippet: SNIPPET },
                        ],
                    },
                },
            });
            created.prechecks.push(precheck.id);
            prechecksByHold[legalHold ? 'held' : 'free'] = precheck.id;
        }
        return { user, prechecksByHold };
    }

    /** A PENDING pre-check (no text yet — its job is still queued) on a new application of `user`. */
    async function seedPending(user, { legalHold = false } = {}) {
        const s = suffix();
        const canonical = await raw.user.findUnique({ where: { id: user.id }, select: { canonicalId: true } });
        const application = await raw.application.create({
            data: {
                applicationNumber: `PDPA-ER-PC-P-${s}`,
                healthId: canonical.canonicalId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                status: 'DRAFT',
                legalHold,
            },
        });
        created.applications.push(application.id);
        const precheck = await raw.documentPrecheck.create({
            data: { organizationId: orgId, applicationId: application.id, documentId: `doc-p-${s}`, slotId: 'juristic_reg_6m', status: 'PENDING', rulesVersion: 1 },
        });
        created.prechecks.push(precheck.id);
        return precheck.id;
    }

    const LATE_JOB = { absPath: '/nonexistent/late-job.pdf', mimeType: 'application/pdf' };
    const FAILURE_REASON = 'ตรวจอัตโนมัติไม่สำเร็จ เจ้าหน้าที่จะตรวจเอง';

    async function readBack(precheckId) {
        return raw.documentPrecheck.findUnique({
            where: { id: precheckId },
            select: {
                status: true,
                extractedText: true,
                flags: { select: { check: true, result: true, reasonTH: true, confidence: true, evidenceSnippet: true } },
            },
        });
    }

    test('erasure clears the page text and every snippet of the user\'s pre-checks; status and results stay', async () => {
        const { user, prechecksByHold } = await seedUser([false]);

        await erasureService.executeErasure({ userId: user.id, actorId: user.id });

        const row = await readBack(prechecksByHold.free);
        expect(row.status).toBe('DONE');
        expect(row.extractedText).toBeNull();
        expect(row.flags).toHaveLength(2);
        for (const flag of row.flags) {
            expect(flag.evidenceSnippet).toBeNull();
            expect(flag.confidence).toBe(88);
        }
        const byCheck = Object.fromEntries(row.flags.map((f) => [f.check, f]));
        expect(byCheck.DOC_TYPE).toMatchObject({ result: 'MATCH', reasonTH: 'ตรงกับชนิดเอกสาร' });
        expect(byCheck.CROSS_MATCH.result).toBe('MISMATCH');
        const erased = await raw.user.findUnique({ where: { id: user.id }, select: { isDeleted: true } });
        expect(erased.isDeleted).toBe(true);
    });

    test('negative control: an application under legal hold keeps its text; the user\'s other application is cleared', async () => {
        const { user, prechecksByHold } = await seedUser([true, false]);

        await erasureService.executeErasure({ userId: user.id, actorId: user.id });

        const held = await readBack(prechecksByHold.held);
        expect(held.extractedText).toBe(PAGE_TEXT);
        expect(held.flags.map((f) => f.evidenceSnippet).sort()).toEqual([SNIPPET, 'หนังสือรับรองการจดทะเบียน'].sort());
        const free = await readBack(prechecksByHold.free);
        expect(free.extractedText).toBeNull();
        expect(free.flags.every((f) => f.evidenceSnippet === null)).toBe(true);
    });
    test('I3: a pre-check still PENDING at erasure becomes FAILED with the failure flag, and its late job writes no text', async () => {
        const { user } = await seedUser([false]);
        const pendingId = await seedPending(user);

        await erasureService.executeErasure({ userId: user.id, actorId: user.id });

        const failed = await readBack(pendingId);
        expect(failed.status).toBe('FAILED');
        expect(failed.flags).toEqual([{ check: 'READABILITY', result: 'UNREADABLE', reasonTH: FAILURE_REASON, confidence: 0, evidenceSnippet: null }]);

        const { runPrecheck } = require('../../services/document-precheck/service');
        await runPrecheck(pendingId, LATE_JOB);

        const after = await readBack(pendingId);
        expect(after.status).toBe('FAILED');
        expect(after.extractedText).toBeNull();
        expect(after.flags).toHaveLength(1);
        expect(after.flags[0].evidenceSnippet).toBeNull();
    });

    test('I3 control: the same late job on a PENDING row of a user who was NOT erased does write the text', async () => {
        const { user } = await seedUser([false]);
        const pendingId = await seedPending(user);

        const { runPrecheck } = require('../../services/document-precheck/service');
        await runPrecheck(pendingId, LATE_JOB);

        const row = await readBack(pendingId);
        expect(row.status).toBe('DONE');
        expect(row.extractedText).toBe(PAGE_TEXT);
    });

    test('I3 legal hold: a PENDING pre-check on a held application stays PENDING (a held application keeps its text)', async () => {
        const { user } = await seedUser([false]);
        const heldPendingId = await seedPending(user, { legalHold: true });

        await erasureService.executeErasure({ userId: user.id, actorId: user.id });

        const held = await readBack(heldPendingId);
        expect(held.status).toBe('PENDING');
        expect(held.flags).toHaveLength(0);
    });
});
