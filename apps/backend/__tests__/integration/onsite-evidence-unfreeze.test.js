/**
 * Phase B (cert-integrity fix, 2026-08-16) — provisions FarmAuditPhoto /
 * FarmAuditChecklistItem in the Prisma schema, unfreezing certificate
 * issuance.
 *
 * Background: services/onsite-evidence-gate.js (Phase A/A2, merged) refuses
 * to mint a certificate unless the onsite audit has recorded photos + a
 * complete checklist — but the two models it counts against did not exist
 * in the schema, so `typeof prisma.farmAuditPhoto?.count !== 'function'`
 * was true for EVERY application and the gate threw
 * EVIDENCE_CAPTURE_UNAVAILABLE unconditionally (fail-closed, but a total
 * freeze). services/audit-onsite-service.js `submitChecklistItem` /
 * `uploadPhoto` were already fully coded against these models; they just
 * crashed.
 *
 * RED (run against the schema/DB BEFORE prisma/schema/audit-onsite-
 * evidence.prisma + its migration exist): every test below fails —
 * submitChecklistItem/uploadPhoto throw a raw TypeError
 * (`prisma.farmAuditChecklistItem`/`farmAuditPhoto` is undefined on the
 * generated client) and the gate/generateCertificate throw
 * EVIDENCE_CAPTURE_UNAVAILABLE for every application, evidenced or not.
 *
 * GREEN (after): the exact same real functions — no jest.mock on
 * prisma-database, audit-onsite-service, onsite-evidence-gate, or
 * certificate-service — succeed against a real Postgres. The headline
 * proof: certificate-service.generateCertificate mints a real Certificate
 * row for an application with sufficient recorded evidence, while an
 * application whose audit has NO evidence rows still throws — the gate
 * holds; the fix is fail-closed, not a blanket unfreeze.
 *
 * `skipInitialAssets: true` is passed to generateCertificate deliberately —
 * it is an existing, already-supported option (certificate-service.js
 * `opts.skipInitialAssets === true`) that skips PlantingCycle/HarvestBatch/QR
 * bootstrap. That machinery is unrelated to the onsite-evidence-gate fix
 * this suite proves; using the option keeps the proof isolated to the two
 * models this change actually adds, without touching cert-mint logic.
 *
 * The seeded application (test-support/phase-b-application-seed.js) carries
 * the wizard answers issuance refuses without: its plant, resolved from the
 * plant_species master (F-G4-58: slug cannabis -> code CAN, which the test
 * database must hold — prisma/seed-plants.js declares it), and its farm's
 * location (F-G4-52). __tests__/unit/phase-b-seed-reaches-the-mint.test.js
 * walks that same row through the real issuance chain without a database, so
 * a seed that would stop at either gate goes red on a laptop too.
 *
 * Requires a verified test database (test-support/test-database.js); skips
 * with the reason in the suite title otherwise.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const onsiteEvidenceGate = require('../../services/onsite-evidence-gate');
const auditOnsiteService = require('../../services/audit-onsite-service');
const certificateService = require('../../services/certificate-service');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
// The seeded application row, shared with the database-free walk in
// __tests__/unit/phase-b-seed-reaches-the-mint.test.js so the same shape is checked
// on a laptop (this suite skips there) and minted on a database runner.
const { phaseBApplicationData } = require('../../test-support/phase-b-application-seed');

d('Phase B — onsite evidence models unfreeze certificate issuance', () => {
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
        // fix round 5: issuance resolves the plant from the master; do not rely on another suite having filed CAN first
        if (!(await prisma.plantSpecies.findFirst({ where: { code: 'CAN' } }))) {
            await prisma.plantSpecies.create({ data: { code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' } });
        }
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const org = await prisma.organization.create({
            data: {
                name: 'Phase-B Evidence Test Org',
                slug: `phase-b-evi-${suffix}`,
                code: `PBEVI_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;

        const auditor = await prisma.user.create({
            data: {
                canonicalId: `phase-b-auditor-${suffix}`,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
                role: 'auditor',
                firstName: 'Phase-B',
                lastName: 'Auditor',
            },
        });
        auditorId = auditor.id;

        // Application.healthId FKs to User.canonicalId (NOT User.id) — see
        // prisma/schema/application.prisma `applicant User @relation(fields:
        // [healthId], references: [canonicalId])`.
        applicantCanonicalId = `phase-b-applicant-${suffix}`;
        await prisma.user.create({
            data: {
                canonicalId: applicantCanonicalId,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
                role: 'health',
                firstName: 'Phase-B',
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
        await prisma.attachment.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.plot.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.farm.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.auditChecklist.deleteMany({ where: { id: { in: auditIds } } }).catch(() => {});
        await prisma.application.deleteMany({ where: { id: { in: applicationIds } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
        await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        await prisma.$disconnect();
    });

    async function seedApplicationWithAudit(appOverrides = {}) {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const app = await prisma.application.create({
            data: phaseBApplicationData(
                { applicationNumber: `PHASE-B-${suffix}`, healthId: applicantCanonicalId, organizationId: orgId },
                appOverrides,
            ),
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
                auditId,
                itemCode: item.itemCode,
                response: 'PASS',
                actorId: auditorId,
                prisma,
            });
        }
        for (let i = 0; i < auditOnsiteService.DEFAULT_MIN_PHOTOS; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await auditOnsiteService.uploadPhoto({
                auditId,
                fileBuffer: Buffer.from(`phase-b-evidence-photo-${auditId}-${i}`, 'utf8'),
                fileName: `evidence-${i}.jpg`,
                gpsLat: 13.75 + i * 0.0001,
                gpsLng: 100.5 + i * 0.0001,
                capturedAt: new Date(),
                uploadedBy: auditorId,
                organizationId: orgId,
                prisma,
            });
        }
    }

    describe('the already-coded capture flow (submitChecklistItem / uploadPhoto)', () => {
        test('submitChecklistItem persists a real FarmAuditChecklistItem row', async () => {
            const { audit } = await seedApplicationWithAudit();

            const row = await auditOnsiteService.submitChecklistItem({
                auditId: audit.id,
                itemCode: '4.1',
                response: 'PASS',
                notes: 'Phase-B RED->GREEN proof',
                actorId: auditorId,
                prisma,
            });

            expect(row.itemCode).toBe('4.1');
            expect(row.response).toBe('PASS');

            const reread = await prisma.farmAuditChecklistItem.findUnique({
                where: { auditId_itemCode: { auditId: audit.id, itemCode: '4.1' } },
            });
            expect(reread).not.toBeNull();
            expect(reread.section).toBe('CULTIVATION');
            expect(reread.isCritical).toBe(true);
        });

        test('uploadPhoto persists a real FarmAuditPhoto row carrying its SHA-256 hash', async () => {
            const { audit } = await seedApplicationWithAudit();
            const buf = Buffer.from(`phase-b-photo-${audit.id}`, 'utf8');

            const out = await auditOnsiteService.uploadPhoto({
                auditId: audit.id,
                fileBuffer: buf,
                fileName: 'phase-b.jpg',
                gpsLat: 13.7563,
                gpsLng: 100.5018,
                capturedAt: new Date('2026-08-16T04:00:00Z'),
                caption: 'Phase-B evidence photo',
                uploadedBy: auditorId,
                organizationId: orgId,
                prisma,
            });

            expect(out.fileHash).toBe(auditOnsiteService.computePhotoHash(buf));

            const reread = await prisma.farmAuditPhoto.findUnique({ where: { id: out.photoId } });
            expect(reread).not.toBeNull();
            expect(reread.fileHash).toBe(out.fileHash);
            expect(reread.gpsLatitude).toBe(13.7563);
            expect(reread.organizationId).toBe(orgId);
        });
    });

    describe('onsite-evidence-gate + certificate issuance (the headline unfreeze)', () => {
        test('assertOnsiteEvidenceSufficient resolves once photos+checklist are fully recorded', async () => {
            const { app, audit } = await seedApplicationWithAudit();
            await recordFullEvidence(audit.id);

            const result = await onsiteEvidenceGate.assertOnsiteEvidenceSufficient({
                prisma,
                applicationId: app.id,
            });

            expect(result.auditId).toBe(audit.id);
            expect(result.photoCount).toBeGreaterThanOrEqual(auditOnsiteService.DEFAULT_MIN_PHOTOS);
            expect(result.itemCount).toBe(auditOnsiteService.CHECKLIST_TEMPLATE_2026.length);
        });

        test('HEADLINE: generateCertificate mints a real Certificate for an application with sufficient recorded evidence', async () => {
            const { app, audit } = await seedApplicationWithAudit({
                status: 'AUDIT_PASSED',
                auditResult: 'PASS',
            });
            await recordFullEvidence(audit.id);

            const cert = await certificateService.generateCertificate(app.id, auditorId, {
                prisma,
                skipInitialAssets: true,
            });

            expect(cert).toBeTruthy();
            expect(cert.certificateNumber).toMatch(/^TH-GACP \d+\/\d{4}$/);
            expect(cert.applicationId).toBe(app.id);

            const reread = await prisma.certificate.findFirst({ where: { applicationId: app.id } });
            expect(reread).not.toBeNull();
            expect(reread.id).toBe(cert.id);
            expect(reread.status).toBe('active');
        });

        test('gate holds: generateCertificate still throws INSUFFICIENT_PHOTOS for an application whose audit has NO evidence rows', async () => {
            const { app } = await seedApplicationWithAudit({
                status: 'AUDIT_PASSED',
                auditResult: 'PASS',
            });
            // Deliberately no submitChecklistItem / uploadPhoto calls.

            await expect(
                certificateService.generateCertificate(app.id, auditorId, { prisma, skipInitialAssets: true }),
            ).rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });

            const cert = await prisma.certificate.findFirst({ where: { applicationId: app.id } });
            expect(cert).toBeNull();
        });

        test('gate holds: generateCertificate still throws INCOMPLETE_CHECKLIST when photos are present but the checklist is short', async () => {
            const { app, audit } = await seedApplicationWithAudit({
                status: 'AUDIT_PASSED',
                auditResult: 'PASS',
            });
            for (let i = 0; i < auditOnsiteService.DEFAULT_MIN_PHOTOS; i += 1) {
                // eslint-disable-next-line no-await-in-loop
                await auditOnsiteService.uploadPhoto({
                    auditId: audit.id,
                    fileBuffer: Buffer.from(`phase-b-partial-${audit.id}-${i}`, 'utf8'),
                    fileName: `partial-${i}.jpg`,
                    gpsLat: 13.75,
                    gpsLng: 100.5,
                    capturedAt: new Date(),
                    uploadedBy: auditorId,
                    organizationId: orgId,
                    prisma,
                });
            }
            // Only one checklist item recorded — short of the full template.
            await auditOnsiteService.submitChecklistItem({
                auditId: audit.id,
                itemCode: '1.1',
                response: 'PASS',
                actorId: auditorId,
                prisma,
            });

            await expect(
                certificateService.generateCertificate(app.id, auditorId, { prisma, skipInitialAssets: true }),
            ).rejects.toMatchObject({ code: 'INCOMPLETE_CHECKLIST' });
        });
    });
});
