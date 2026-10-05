/**
 * onsite-decision-mint-e2e.test.js — Task 12 (final closure proof, fixes B10).
 *
 * The end-to-end proof that the whole 12-task onsite-evidence-capture fix
 * actually works: a real auditor decision, through the REAL
 * audit-onsite-service.submitDecision, on a REAL Postgres, auto-mints a REAL
 * Certificate row (the in-tx AUDIT_PASSED hook inside
 * application-status-writer.js -> certificate-service.generateCertificate) —
 * and an under-evidenced PASS still refuses. NOTHING in this file is mocked:
 * no jest.mock on prisma-database, audit-onsite-service, onsite-evidence-gate,
 * application-status-writer, or certificate-service. This is deliberately the
 * opposite of the B10 pattern (wholesale service mocks that let every one of
 * B1-B9 ship invisibly) at the highest level: real service, real transaction,
 * real DB constraints.
 *
 * Unlike __tests__/integration/onsite-evidence-unfreeze.test.js (which passes
 * `skipInitialAssets: true` to isolate the evidence-gate proof from
 * PlantingCycle/HarvestBatch/QR bootstrap), this suite runs the FULL cert
 * machinery — submitDecision's PASS path never passes skipInitialAssets, so
 * this is the first test that also proves the auto-mint survives
 * createInitialAssets. That function early-returns cleanly when no
 * PlantSpecies exists at all (certificate-service.js ~line 752-769: `species
 * = await client.plantSpecies.findFirst(); if (!species) { ...return; }`), so
 * the mint still succeeds on a species-empty DB. If the target DB instead has
 * a MALFORMED (but present) PlantSpecies row, seed one clean row in
 * beforeAll before running this against that environment.
 *
 * Gated on DATABASE_URL presence only — the repo convention (no separate
 * REQUIRE_DB var exists anywhere in this codebase; confirmed against
 * __tests__/integration/rls-shadow-guc.int.test.js:37-41 and
 * __tests__/integration/onsite-evidence-unfreeze.test.js:39-41, both of which
 * use the identical `Boolean(process.env.DATABASE_URL)` + `describe.skip`
 * pattern this file copies verbatim). Skips cleanly without a DB.
 *
 * Seed/teardown pattern mirrors onsite-evidence-unfreeze.test.js:43-179
 * (same org/auditor/applicant seed shape, same recordFullEvidence helper).
 *
 * Third test (PIN-PROPAGATION) is a carried requirement from earlier task
 * reviews, not from the original task-12 brief: it proves the Task-3
 * decided-auditId pin (audit-onsite-service.js submitDecision stamping
 * formData.onsiteAuditId, forwarded by certificate-service.js:314 as the
 * `auditId` arg to assertOnsiteEvidenceSufficient) is actually load-bearing
 * end-to-end, not just unit-tested in isolation. See that test's own comment
 * for the exact failure mode it catches.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const auditOnsiteService = require('../../services/audit-onsite-service');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('onsite PASS through /decision auto-mints a Certificate (e2e closure)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let auditorId;
    let applicantCanonicalId;
    const applicationIds = [];
    const auditIds = [];

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const org = await prisma.organization.create({
            data: { name: 'E2E Mint Org', slug: `e2e-mint-${s}`, code: `E2EMINT_${s}`.toUpperCase().slice(0, 24) },
        });
        orgId = org.id;
        const auditor = await prisma.user.create({
            data: {
                canonicalId: `e2e-auditor-${s}`,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
                role: 'auditor',
                firstName: 'E2E',
                lastName: 'Auditor',
            },
        });
        auditorId = auditor.id;
        // Application.healthId FKs to User.canonicalId (NOT User.id) — see
        // prisma/schema/application.prisma `applicant User @relation(fields:
        // [healthId], references: [canonicalId])` (same shape onsite-evidence-
        // unfreeze.test.js relies on).
        applicantCanonicalId = `e2e-applicant-${s}`;
        await prisma.user.create({
            data: {
                canonicalId: applicantCanonicalId,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
                role: 'health',
                firstName: 'E2E',
                lastName: 'Applicant',
            },
        });
    });

    afterAll(async () => {
        // Children before parents (no onDelete cascade on any of these FKs).
        await prisma.certificate.deleteMany({ where: { applicationId: { in: applicationIds } } }).catch(() => {});
        if (prisma.farmAuditPhoto) {
            await prisma.farmAuditPhoto.deleteMany({ where: { auditId: { in: auditIds } } }).catch(() => {});
        }
        if (prisma.farmAuditChecklistItem) {
            await prisma.farmAuditChecklistItem.deleteMany({ where: { auditId: { in: auditIds } } }).catch(() => {});
        }
        // Full cert machinery (no skipInitialAssets) may create these —
        // onsite-evidence-unfreeze.test.js does not need to clean them up
        // because it always skips initial-asset creation; this suite does not.
        await prisma.harvestBatch.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.plantingCycle.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.attachment.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.plot.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.farm.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.auditChecklist.deleteMany({ where: { id: { in: auditIds } } }).catch(() => {});
        await prisma.application.deleteMany({ where: { id: { in: applicationIds } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        await prisma.$disconnect();
    });

    async function seed() {
        const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const app = await prisma.application.create({
            data: {
                applicationNumber: `E2E-${s}`,
                healthId: applicantCanonicalId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                status: 'AUDIT_CONFIRMED',
                formData: { workflowState: 'AUDIT_CONFIRMED' },
            },
        });
        applicationIds.push(app.id);
        const audit = await prisma.auditChecklist.create({
            data: {
                applicationId: app.id,
                templateName: 'GACP_GENERAL',
                sections: [],
                auditorId,
                organizationId: orgId,
                status: 'IN_PROGRESS',
            },
        });
        auditIds.push(audit.id);
        return { app, audit };
    }

    async function recordFullEvidence(auditId) {
        for (const item of auditOnsiteService.CHECKLIST_TEMPLATE_2026) {
            // eslint-disable-next-line no-await-in-loop
            await auditOnsiteService.submitChecklistItem({
                auditId, itemCode: item.itemCode, response: 'PASS', actorId: auditorId, prisma,
            });
        }
        for (let i = 0; i < auditOnsiteService.DEFAULT_MIN_PHOTOS; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await auditOnsiteService.uploadPhoto({
                auditId,
                fileBuffer: Buffer.from(`e2e-${auditId}-${i}`),
                fileName: `e-${i}.jpg`,
                gpsLat: 13.75 + i * 1e-4,
                gpsLng: 100.5 + i * 1e-4,
                capturedAt: new Date(),
                uploadedBy: auditorId,
                organizationId: orgId,
                prisma,
            });
        }
    }

    test('HEADLINE: a fully-evidenced PASS through submitDecision mints a Certificate (auto-mint in-tx)', async () => {
        const { app, audit } = await seed();
        await recordFullEvidence(audit.id);

        await auditOnsiteService.submitDecision({
            auditId: audit.id, decision: 'PASS', summary: 'ผ่านการตรวจ', actorId: auditorId, actorRole: 'AUDITOR', prisma,
        });

        const cert = await prisma.certificate.findFirst({ where: { applicationId: app.id } });
        expect(cert).not.toBeNull();
        expect(cert.certificateNumber).toMatch(/^TH-GACP \d+\/\d{4}$/);
        const reread = await prisma.application.findUnique({ where: { id: app.id }, select: { status: true, formData: true } });
        expect(reread.status).toBe('AUDIT_PASSED');
        expect(reread.formData.onsiteAuditId).toBe(audit.id);
    });

    test('gate holds: an under-evidenced PASS refuses and mints nothing', async () => {
        const { app, audit } = await seed();
        // no evidence recorded
        await expect(auditOnsiteService.submitDecision({
            auditId: audit.id, decision: 'PASS', summary: 'x', actorId: auditorId, actorRole: 'AUDITOR', prisma,
        })).rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });
        const cert = await prisma.certificate.findFirst({ where: { applicationId: app.id } });
        expect(cert).toBeNull();
    });

    // ── Carried requirement (Task-3 linchpin, currently untested before this
    // file): prove the decided-auditId PIN actually reaches generateCertificate
    // in-tx, by making the WITHOUT-the-pin failure mode concrete and seeded. ──
    test('PIN-PROPAGATION: audit-A fully evidenced + audit-B a newer EMPTY IN_PROGRESS orphan on the SAME application — PASS on audit-A still mints, proving the pin froze the decided row', async () => {
        const { app, audit: auditA } = await seed();
        await recordFullEvidence(auditA.id);

        // audit-B: created AFTER audit-A, IN_PROGRESS, deliberately given ZERO
        // evidence. onsite-audit-resolver.js's resolveCurrentOnsiteAuditId
        // prefers (1) the IN_PROGRESS row, (2) then most-recently-created —
        // audit-B satisfies BOTH tie-breakers over audit-A (which submitDecision
        // is about to flip to COMPLETED). Without Task 3's pin (formData.
        // onsiteAuditId, stamped by submitDecision and forwarded by
        // certificate-service.js:314 to assertOnsiteEvidenceSufficient as the
        // `auditId` arg), generateCertificate would re-resolve to audit-B — 0
        // photos, 0 checklist items — and throw INSUFFICIENT_PHOTOS, minting
        // NOTHING. A minted cert below is only reachable if the pin held.
        const auditB = await prisma.auditChecklist.create({
            data: {
                applicationId: app.id,
                templateName: 'GACP_GENERAL',
                sections: [],
                auditorId,
                organizationId: orgId,
                status: 'IN_PROGRESS',
                // Force an unambiguous ordering gap so the resolver's
                // `orderBy: { createdAt: 'desc' }` deterministically prefers
                // audit-B over audit-A if the pin were ever dropped — the
                // exact failure mode this test exists to catch.
                createdAt: new Date(auditA.createdAt.getTime() + 60_000),
            },
        });
        auditIds.push(auditB.id);
        expect(auditB.createdAt.getTime()).toBeGreaterThan(auditA.createdAt.getTime());

        await auditOnsiteService.submitDecision({
            auditId: auditA.id, decision: 'PASS', summary: 'ผ่านการตรวจ (pin-propagation proof)', actorId: auditorId, actorRole: 'AUDITOR', prisma,
        });

        const cert = await prisma.certificate.findFirst({ where: { applicationId: app.id } });
        // If this is null, the pin never reached generateCertificate — the gate
        // silently fell back to resolveCurrentOnsiteAuditId and hit the empty
        // audit-B orphan instead of the decided audit-A. Report that loudly;
        // it means the Task-3 pin is inert end-to-end, not just unit-covered.
        expect(cert).not.toBeNull();
        expect(cert.certificateNumber).toMatch(/^TH-GACP \d+\/\d{4}$/);

        const reread = await prisma.application.findUnique({ where: { id: app.id }, select: { status: true, formData: true } });
        expect(reread.status).toBe('AUDIT_PASSED');
        // The load-bearing assertion: generateCertificate verified audit-A
        // specifically (the row actually decided on), never audit-B (the
        // empty orphan resolveCurrentOnsiteAuditId would otherwise prefer).
        expect(reread.formData.onsiteAuditId).toBe(auditA.id);
        expect(reread.formData.onsiteAuditId).not.toBe(auditB.id);
    });
});
