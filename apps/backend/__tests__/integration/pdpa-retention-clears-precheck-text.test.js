/**
 * pdpa-retention-clears-precheck-text — Task 10 (document pre-check), on a REAL
 * Postgres.
 *
 * A pre-check stores the text read off the applicant's paper
 * (document_prechecks.extracted_text) and a short quote per observation
 * (document_precheck_flags.evidence_snippet). Both can carry the applicant's
 * name, address and id numbers. The retention sweep (jobs/pdpa-retention-job.js)
 * is the rule that ends a person's personal data once their retention window
 * has passed; the same sweep must end this text too.
 *
 * What stays: the pre-check row, its status, and every observation's check,
 * result, reason and confidence — the record that an automatic check ran and
 * what it said, which carries no text off the page.
 *
 * Legal hold wins, as it does for the user row (shared/legal-hold-guard.js): a
 * held user, or an application under legal hold, keeps its text.
 *
 * Seeding and read-back use a RAW PrismaClient (no tenant/soft-delete
 * extensions) so what is asserted is what the database holds. The sweep runs
 * through its own client, exactly as the cron does.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const { runPdpaRetentionSweep } = require('../../jobs/pdpa-retention-job');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const LONG_PAST = new Date('1990-01-01T00:00:00.000Z');
const FAR_FUTURE = new Date('2099-01-01T00:00:00.000Z');
const PAGE_TEXT = 'หนังสือรับรองการจดทะเบียน นายสมชาย ใจดี เลขประจำตัว 1103700012345';
const SNIPPET = 'นายสมชาย ใจดี …2345';

function suffix() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

d('pdpa-retention-clears-precheck-text (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let orgId;
    const created = { users: [], applications: [], prechecks: [] };

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        const s = suffix();
        const org = await raw.organization.create({
            data: { name: 'PDPA precheck text org', slug: `pdpa-pc-${s}`, code: `PDPAPC_${s}`.toUpperCase().slice(0, 24) },
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

    /**
     * One applicant with one application and two pre-checks on it (the current
     * one and a superseded one), each with two observations carrying a snippet.
     */
    async function seedApplicant({ retainUntil, userHold = false, applicationHold = false }) {
        const s = suffix();
        const canonicalId = `pdpa-pc-canon-${s}`;
        const user = await raw.user.create({
            data: {
                canonicalId,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
                firstName: 'สมชาย',
                lastName: 'ใจดี',
                retainUntil,
                legalHold: userHold,
            },
        });
        created.users.push(user.id);
        const application = await raw.application.create({
            data: {
                applicationNumber: `PDPA-PC-${s}`,
                healthId: canonicalId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                status: 'PENDING_DOC_FEE',
                legalHold: applicationHold,
            },
        });
        created.applications.push(application.id);
        const prechecks = [];
        for (const status of ['SUPERSEDED', 'DONE']) {
            const row = await raw.documentPrecheck.create({
                data: {
                    organizationId: orgId,
                    applicationId: application.id,
                    documentId: `doc-${status}-${s}`,
                    slotId: 'company_reg',
                    status,
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
            created.prechecks.push(row.id);
            prechecks.push(row.id);
        }
        return { user, application, prechecks };
    }

    async function readBack(precheckIds) {
        return raw.documentPrecheck.findMany({
            where: { id: { in: precheckIds } },
            select: {
                id: true,
                status: true,
                extractedText: true,
                ocrConfidence: true,
                flags: { select: { check: true, result: true, reasonTH: true, confidence: true, evidenceSnippet: true } },
            },
        });
    }

    test('an expired applicant: every pre-check loses its page text and every snippet; status and results stay', async () => {
        const expired = await seedApplicant({ retainUntil: LONG_PAST });

        await runPdpaRetentionSweep();

        const rows = await readBack(expired.prechecks);
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.status).sort()).toEqual(['DONE', 'SUPERSEDED']);
        for (const row of rows) {
            expect(row.extractedText).toBeNull();
            expect(row.ocrConfidence).toBe(88);
            expect(row.flags).toHaveLength(2);
            for (const flag of row.flags) {
                expect(flag.evidenceSnippet).toBeNull();
                expect(flag.confidence).toBe(88);
            }
            const byCheck = Object.fromEntries(row.flags.map((f) => [f.check, f]));
            expect(byCheck.DOC_TYPE).toMatchObject({ result: 'MATCH', reasonTH: 'ตรงกับชนิดเอกสาร' });
            expect(byCheck.CROSS_MATCH).toMatchObject({
                result: 'MISMATCH',
                reasonTH: 'ข้อมูลในเอกสารไม่ตรงกับข้อมูลที่กรอกไว้ กรุณาตรวจสอบอีกครั้ง',
            });
        }
        // The same run anonymized the person — one rule, both outcomes.
        const user = await raw.user.findUnique({ where: { id: expired.user.id }, select: { isAnonymized: true, firstName: true } });
        expect(user).toEqual({ isAnonymized: true, firstName: null });
    });

    test('an applicant still inside the window keeps the text', async () => {
        const current = await seedApplicant({ retainUntil: FAR_FUTURE });

        await runPdpaRetentionSweep();

        for (const row of await readBack(current.prechecks)) {
            expect(row.extractedText).toBe(PAGE_TEXT);
            expect(row.flags.map((f) => f.evidenceSnippet).sort()).toEqual([SNIPPET, 'หนังสือรับรองการจดทะเบียน'].sort());
        }
    });

    test('a user under legal hold keeps the text', async () => {
        const held = await seedApplicant({ retainUntil: LONG_PAST, userHold: true });

        await runPdpaRetentionSweep();

        for (const row of await readBack(held.prechecks)) {
            expect(row.extractedText).toBe(PAGE_TEXT);
            expect(row.flags.every((f) => f.evidenceSnippet !== null)).toBe(true);
        }
    });

    test('an application under legal hold keeps the text even when its applicant is anonymized', async () => {
        const heldApp = await seedApplicant({ retainUntil: LONG_PAST, applicationHold: true });

        await runPdpaRetentionSweep();

        for (const row of await readBack(heldApp.prechecks)) {
            expect(row.extractedText).toBe(PAGE_TEXT);
            expect(row.flags.every((f) => f.evidenceSnippet !== null)).toBe(true);
        }
        const user = await raw.user.findUnique({ where: { id: heldApp.user.id }, select: { isAnonymized: true } });
        expect(user.isAnonymized).toBe(true);
    });
});
