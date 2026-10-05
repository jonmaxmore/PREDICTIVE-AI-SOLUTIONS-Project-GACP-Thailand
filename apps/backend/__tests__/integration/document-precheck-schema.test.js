'use strict';
/**
 * RED-first — Task 5 (document pre-check data model + migration,
 * task-5-brief.md). Proves the two new tables (`document_prechecks`,
 * `document_precheck_flags`) and the `ApplicationDocumentReview.precheckId`
 * FK exist and behave against a REAL Postgres — not a mock, per
 * "a-mocked-dependency-hides-a-dead-feature" — and that the tenant
 * extension's org read-scope isolates a precheck row the same way it
 * isolates every other TENANT_SCOPED_MODELS table
 * (see tenant-isolation-cross-org-be.test.js, the pattern this file follows).
 *
 * BEFORE the migration lands, this suite fails with `prisma.documentPrecheck
 * is not a function` (the model does not exist on the generated client) —
 * captured as this task's RED evidence. AFTER `npx prisma generate` +
 * `npx prisma migrate deploy` have run against the throwaway Postgres
 * (task-5-brief.md decision 5), it is GREEN.
 *
 * Requires DATABASE_URL → a migrated Postgres; skips cleanly (never
 * `.skip`) otherwise — test-support/test-database.js's run-level guard,
 * the same pattern invoice-tax-id-select.test.js and
 * tenant-isolation-cross-org-be.test.js use.
 */

const { PrismaClient } = require('@prisma/client');
const { prisma: scopedPrisma } = require('../../services/prisma-database');
const { runWithTenantContext } = require('../../services/tenant-context');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

function suffix() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function makeOrgAppUser(raw, tag) {
    const s = suffix();
    const org = await raw.organization.create({
        data: { name: `precheck ${tag} org`, slug: `precheck-${tag}-${s}`, code: `PC_${tag}_${s}`.toUpperCase().slice(0, 24) },
    });
    const canonicalId = `precheck-${tag}-user-${s}`;
    const user = await raw.user.create({
        data: {
            canonicalId,
            password: 'x',
            organizationId: org.id,
            authType: 'EMAIL_LEGACY',
            firstName: 'ทดสอบ',
            lastName: 'พรีเช็ค',
            email: `precheck-${tag}-${s}@example.test`,
            phoneNumber: '0810000000',
        },
    });
    const app = await raw.application.create({
        data: {
            applicationNumber: `PRECHECK-${tag}-${s}`,
            healthId: canonicalId,
            areaType: 'OUTDOOR',
            organizationId: org.id,
            status: 'PENDING_DOC_FEE',
        },
    });
    return { orgId: org.id, userId: user.id, canonicalId, applicationId: app.id };
}

d('document-precheck schema (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
    });

    afterAll(async () => {
        await raw.$disconnect();
    });

    describe('DocumentPrecheck + DocumentPrecheckFlag + ApplicationDocumentReview.precheckId', () => {
        let orgId;
        let userId;
        let applicationId;
        let documentId;
        let precheckId;
        let reviewId;

        beforeAll(async () => {
            const ctx = await makeOrgAppUser(raw, 'core');
            orgId = ctx.orgId;
            userId = ctx.userId;
            applicationId = ctx.applicationId;
            documentId = `doc-${suffix()}`;

            const precheck = await raw.documentPrecheck.create({
                data: {
                    organizationId: orgId,
                    applicationId,
                    documentId,
                    slotId: 'id_card',
                    status: 'DONE',
                    rulesVersion: 1,
                    extractMethod: 'TEXT_LAYER',
                    pageCount: 1,
                    extractedText: 'ตัวอย่างข้อความที่สกัดได้',
                    flags: {
                        create: [
                            { organizationId: orgId, check: 'READABILITY', result: 'OK', reasonTH: 'อ่านได้ชัดเจน', confidence: 0.95 },
                            { organizationId: orgId, check: 'SIGNATURE', result: 'MANUAL', reasonTH: 'ต้องตรวจลายเซ็นด้วยตนเอง', confidence: 1, evidenceSnippet: null },
                        ],
                    },
                },
                include: { flags: true },
            });
            precheckId = precheck.id;
        });

        afterAll(async () => {
            if (reviewId) {
                await raw.applicationDocumentReview.deleteMany({ where: { id: reviewId } }).catch(() => {});
            }
            if (precheckId) {
                await raw.documentPrecheckFlag.deleteMany({ where: { precheckId } }).catch(() => {});
                await raw.documentPrecheck.deleteMany({ where: { id: precheckId } }).catch(() => {});
            }
            if (applicationId) {
                await raw.application.deleteMany({ where: { id: applicationId } }).catch(() => {});
            }
            if (userId) {
                await raw.user.deleteMany({ where: { id: userId } }).catch(() => {});
            }
            if (orgId) {
                await raw.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
            }
        });

        test('inserts a precheck with 2 flags', async () => {
            const precheck = await raw.documentPrecheck.findUnique({ where: { id: precheckId }, include: { flags: true } });
            expect(precheck).not.toBeNull();
            expect(precheck.documentId).toBe(documentId);
            expect(precheck.flags).toHaveLength(2);
            expect(precheck.flags.map((f) => f.check).sort()).toEqual(['READABILITY', 'SIGNATURE']);
        });

        test('the unique documentId refuses a duplicate', async () => {
            await expect(
                raw.documentPrecheck.create({
                    data: {
                        organizationId: orgId,
                        applicationId,
                        documentId, // same documentId as the row created above
                        slotId: 'id_card',
                        status: 'DONE',
                        rulesVersion: 1,
                    },
                }),
            ).rejects.toMatchObject({ code: 'P2002' });
        });

        test('ApplicationDocumentReview.precheckId FK works', async () => {
            const review = await raw.applicationDocumentReview.create({
                data: {
                    applicationId,
                    slotId: 'id_card',
                    verdict: 'ACCEPTED',
                    reviewerId: userId,
                    organizationId: orgId,
                    precheckId,
                },
            });
            reviewId = review.id;

            const fetched = await raw.applicationDocumentReview.findUnique({
                where: { id: review.id },
                include: { precheck: true },
            });
            expect(fetched.precheck).not.toBeNull();
            expect(fetched.precheck.id).toBe(precheckId);
        });
    });

    describe('tenant read-scope isolates document_prechecks by organization', () => {
        let orgAId;
        let orgBId;
        let userAId;
        let userBId;
        let appAId;
        let appBId;
        let docA;
        let docB;

        beforeAll(async () => {
            const a = await makeOrgAppUser(raw, 'tenA');
            const b = await makeOrgAppUser(raw, 'tenB');
            orgAId = a.orgId;
            userAId = a.userId;
            appAId = a.applicationId;
            orgBId = b.orgId;
            userBId = b.userId;
            appBId = b.applicationId;
            docA = `doc-tenA-${suffix()}`;
            docB = `doc-tenB-${suffix()}`;

            await raw.documentPrecheck.create({
                data: { organizationId: orgAId, applicationId: appAId, documentId: docA, slotId: 'id_card', status: 'DONE', rulesVersion: 1 },
            });
            await raw.documentPrecheck.create({
                data: { organizationId: orgBId, applicationId: appBId, documentId: docB, slotId: 'id_card', status: 'DONE', rulesVersion: 1 },
            });
        });

        afterAll(async () => {
            await raw.documentPrecheck.deleteMany({ where: { documentId: { in: [docA, docB] } } }).catch(() => {});
            await raw.application.deleteMany({ where: { id: { in: [appAId, appBId] } } }).catch(() => {});
            await raw.user.deleteMany({ where: { id: { in: [userAId, userBId] } } }).catch(() => {});
            await raw.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } }).catch(() => {});
        });

        test('org A cannot read org B\'s precheck through prisma.documentPrecheck.findFirst in a bound tenant context', async () => {
            // Prisma queries are lazy: await INSIDE the bound context, same as
            // tenant-isolation-cross-org-be.test.js's own note on this.
            const seenByA = await runWithTenantContext({ organizationId: orgAId }, async () => {
                return scopedPrisma.documentPrecheck.findFirst({ where: { documentId: { in: [docA, docB] } } });
            });
            expect(seenByA).not.toBeNull();
            expect(seenByA.documentId).toBe(docA);
            expect(seenByA.organizationId).toBe(orgAId);

            const seenByB = await runWithTenantContext({ organizationId: orgBId }, async () => {
                return scopedPrisma.documentPrecheck.findFirst({ where: { documentId: { in: [docA, docB] } } });
            });
            expect(seenByB).not.toBeNull();
            expect(seenByB.documentId).toBe(docB);
            expect(seenByB.organizationId).toBe(orgBId);
        });
    });

    // Fix round 1 (task-5-review.md Important 1) — RED before the
    // applicationId FK existed: with no FK on that column at all,
    // `raw.application.delete()` succeeded silently and left the precheck
    // row behind, pointing at a now-deleted application. This asserts the
    // CASCADE explicitly (the row is actually gone), not merely that the
    // delete call itself does not throw.
    describe('deleting the Application cascades to its DocumentPrecheck rows (FK CASCADE)', () => {
        let orgId;
        let applicationId;
        let precheckId;

        beforeAll(async () => {
            const ctx = await makeOrgAppUser(raw, 'casc');
            orgId = ctx.orgId;
            applicationId = ctx.applicationId;

            const precheck = await raw.documentPrecheck.create({
                data: {
                    organizationId: orgId,
                    applicationId,
                    documentId: `doc-casc-${suffix()}`,
                    slotId: 'id_card',
                    status: 'DONE',
                    rulesVersion: 1,
                },
            });
            precheckId = precheck.id;
        });

        afterAll(async () => {
            // The application (and, if the fix is missing, the orphaned
            // precheck it leaves behind) may already be gone — never fail
            // cleanup on that.
            await raw.documentPrecheck.deleteMany({ where: { id: precheckId } }).catch(() => {});
            await raw.application.deleteMany({ where: { id: applicationId } }).catch(() => {});
            await raw.user.deleteMany({ where: { canonicalId: { contains: 'precheck-casc-' } } }).catch(() => {});
            await raw.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        });

        test('deleting the Application removes its DocumentPrecheck row', async () => {
            await raw.application.delete({ where: { id: applicationId } });

            const survivor = await raw.documentPrecheck.findUnique({ where: { id: precheckId } });
            expect(survivor).toBeNull();
        });
    });
});
