/**
 * application-status-writer's auto-issue hook, END TO END
 *
 * F-CERT-SOD (2026-09-10): the hook moved off AUDIT_PASSED and onto APPROVED — the
 * certificate must not exist before anyone has decided to grant it (ISO/IEC 17065 §7.6).
 * What this file proves is UNCHANGED — the refuse-and-revert contract of the hook — only
 * the hop that reaches the hook moved. The dangling case it guards is now
 * "persisted at APPROVED with no certificate", one state later.
 * through the REAL certificate-service.generateCertificate (NOT mocked) —
 * cert-integrity fix Phase A2, 2026-08-16.
 *
 * application-status-writer-cert-hook.test.js mocks certificate-service
 * entirely, so it proves the writer's rollback CONTRACT ("whatever
 * generateCertificate throws, roll status back to fromStatus and re-throw")
 * but never actually exercises the new onsite-evidence-gate. This file
 * closes that gap: it drives the REAL generateCertificate (which now calls
 * the REAL assertOnsiteEvidenceSufficient) through the REAL writer, so it is
 * the CHOKE POINT proof — every one of the three sibling paths the Phase A2
 * review found (routes/api/audit/audits.js POST /:id/result, routes/api/
 * provider/handlers/auditor-audit-decision-handler.js, and any other caller
 * of writeApplicationStatus with toStatus AUDIT_PASSED/APPROVED) shares this
 * exact hook, so proving IT refuses is proving all three refuse.
 *
 * Reviewer's rollback question, answered here: does a cert-gen throw leave a
 * DANGLING APPROVED (application persisted at APPROVED with no
 * certificate), or is the transition genuinely refused? This suite asserts
 * on the SEQUENCE of prisma.application.update calls (forward write, then a
 * revert to fromStatus) and on the re-thrown error — the same technique the
 * pre-existing generic rollback tests in application-status-writer-cert-hook
 * .test.js already use and already had proven correct for an arbitrary
 * cert-gen failure; this file ties that SAME contract to the real
 * EVIDENCE_CAPTURE_UNAVAILABLE/NO_ONSITE_AUDIT errors instead of a synthetic
 * one, and does so via the real generateCertificate rather than a mock.
 */

'use strict';

const path = require('path');
const { farmAuditPhotoStub } = require('../../test-support/farm-audit-photo-stub');

// workflow-transition-service is DELIBERATELY left un-mocked: it is a
// self-contained state-machine/business-rules module, none of these tests
// pass assertTransition:true (so assertTransitionAllowed never fires), and
// the lazy require chain (onsite-evidence-gate -> audit-onsite-service ->
// car-deadline-service -> admin-application-service) needs its REAL
// WORKFLOW_STATES export — a thin mock here breaks that unrelated chain.

jest.mock('../../services/notification-fanout-service', () => ({
    send: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));

// The happy-path control test drives the REAL (unmodified) auto-issue hook,
// which deliberately does NOT skip initial-asset bootstrap (C-1: "the hook
// owns the full cert + PlantingCycle + Batch + QR creation") — so QR
// generation needs a boundary mock the same way every other external I/O
// boundary in this suite does.
jest.mock('../../services/qrcode/qrcode-service', () => ({
    generateForRecord: jest.fn(async () => ({ qrCode: 'qr-data', trackingUrl: 'https://gacpth.com/t/batch-701' })),
}));

// certificate-service is DELIBERATELY left un-mocked — this file's entire
// point is to exercise the real generateCertificate (and, through it, the
// real onsite-evidence-gate) from inside the writer's auto-issue hook.

const writerPath = path.resolve(__dirname, '../../services/application-status-writer.js');

function loadWriter() {
    jest.resetModules();
    jest.doMock('../../services/notification-fanout-service', () => ({
        send: jest.fn(async () => ({ ok: true })),
    }));
    jest.doMock('../../services/cache-service', () => ({
        invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../../services/qrcode/qrcode-service', () => ({
        generateForRecord: jest.fn(async () => ({ qrCode: 'qr-data', trackingUrl: 'https://gacpth.com/t/batch-701' })),
    }));
    return require(writerPath);
}

function makeApp() {
    return {
        id: 'app-701',
        organizationId: 'org-1',
        entityId: null,
        submitterId: null,
        applicationNumber: 'GACP-2026-0701',
        status: 'APPROVED',
        auditResult: null,
        formData: {
            auditResult: 'PASS',
            auditedAt: new Date().toISOString(),
            // 2026-09-05: issuance is fail-closed on a plant it cannot resolve
            // (CERTIFICATE_PLANT_UNKNOWN), so an application that names no plant can
            // never reach the evidence gate this suite exists to test — the control
            // case was failing on the plant check and never exercising the gate at all.
            // 'cannabis' is the platform's own slug (config/plant-species-slugs.js).
            plantId: 'cannabis',
            // F-G4-52: a farm cannot be created without its location; the control
            // test's mint runs through the resolver's farm.create branch.
            farmData: { farmName: 'ฟาร์มของผู้ยื่น', address: '1 หมู่ 1', province: 'เชียงใหม่', district: 'สันทราย', subdistrict: 'แม่แฝก', postalCode: '50210' },
        },
        applicant: { id: 'user-701', firstName: 'ทดสอบ', lastName: 'ระบบ' },
        entity: null,
    };
}

/**
 * A tx-shaped prisma double mirroring the REAL shape every live route uses:
 * `prisma.$transaction(async (tx) => { await writeApplicationStatus({ prisma: tx, ... }) })`.
 * `application.update` records every call so the test can assert the exact
 * sequence (forward write, then — on cert-gen failure — the writer's revert).
 * No farmAuditPhoto / farmAuditChecklistItem: the real unprovisioned state.
 */
function makeTxPrisma() {
    const updateCalls = [];
    const tx = {
        application: {
            update: jest.fn(async ({ where, data }) => {
                updateCalls.push({ where: { ...where }, data: { ...data } });
                return { id: where.id, organizationId: 'org-1', healthId: null, applicationNumber: 'GACP-2026-0701', ...data };
            }),
            findUnique: jest.fn(async () => makeApp()),
        },
        // certificate number draws its running number from the ReceiptSequence series
        receiptSequence: { upsert: jest.fn(async () => ({ counter: 1 })) },
        certificate: {
            findFirst: jest.fn(async () => null),
            findUnique: jest.fn(async () => null),
            create: jest.fn(async ({ data }) => ({ id: 'cert-new', ...data })),
        },
        auditChecklist: {
            findFirst: jest.fn(async () => null), // NO_ONSITE_AUDIT — no audit row recorded at all
        },
        farm: {
            findFirst: jest.fn(async () => null), // no farm at that address — resolver creates one
            create: jest.fn(async ({ data }) => ({ id: 'farm-701', ...data })),
        },
        plot: { count: jest.fn(async () => 1) },
        // Only exercised by the sufficient-evidence control test — the real
        // (unskipped) createInitialAssets bootstrap the auto-issue hook runs
        // after a successful mint.
        plantSpecies: {
            findFirst: jest.fn(async () => ({ id: 'species-1', nameTH: 'Unknown', code: 'SP-1' })),
            // resolvePlantSpecies looks the plant up by its master CODE, so the double
            // needs findUnique too — without it the chain died on the double, not on
            // anything the evidence gate had to say.
            findUnique: jest.fn(async () => ({ id: 'species-can', code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' })),
        },
        plantingCycle: { create: jest.fn(async ({ data }) => ({ id: 'cycle-1', ...data })) },
        harvestBatch: {
            create: jest.fn(async ({ data }) => ({ id: 'batch-1', ...data })),
            update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
        },
    };
    tx.updateCalls = updateCalls;
    return tx;
}

describe('APPROVED auto-issue hook -> REAL generateCertificate -> REAL onsite-evidence-gate (choke point)', () => {
    test('cert-gen refuses (NO_ONSITE_AUDIT) -> writer rolls the status back to fromStatus and re-throws -> caller tx aborts, nothing persists at APPROVED', async () => {
        const { writeApplicationStatus } = loadWriter();
        const tx = makeTxPrisma();

        // Mirrors the real live-route shape: writeApplicationStatus is called
        // WITH the tx handle from an outer prisma.$transaction (the shape
        // audits.js, auditor-audit-decision-handler.js and audit-onsite-
        // service.js all use). If this rejects, the real Prisma.$transaction
        // wrapping it would abort the WHOLE transaction — nothing here would
        // ever commit, which is the strongest form of "not dangling."
        const promise = writeApplicationStatus({
            prisma: tx,
            applicationId: 'app-701',
            fromStatus: 'AUDIT_PASSED',
            toStatus: 'APPROVED',
            actorId: 'auditor-701',
            actorRole: 'AUDITOR',
        });

        await expect(promise).rejects.toMatchObject({ code: 'NO_ONSITE_AUDIT' });

        // The writer's own bookkeeping: forward write to APPROVED, THEN a
        // revert back to fromStatus — never left sitting at APPROVED.
        expect(tx.updateCalls).toHaveLength(2);
        expect(tx.updateCalls[0].data.status).toBe('APPROVED');
        expect(tx.updateCalls[1].data.status).toBe('AUDIT_PASSED');
        expect(tx.updateCalls[1].where).toEqual({ id: 'app-701' });

        // No certificate was ever created.
        expect(tx.certificate.create).not.toHaveBeenCalled();
    });

    test('cert-gen refuses (EVIDENCE_CAPTURE_UNAVAILABLE — audit row exists but photo/checklist models are not provisioned) -> same refuse-and-revert contract', async () => {
        const { writeApplicationStatus } = loadWriter();
        const tx = makeTxPrisma();
        tx.auditChecklist.findFirst = jest.fn(async () => ({ id: 'audit-701', applicationId: 'app-701' }));
        // farmAuditPhoto / farmAuditChecklistItem intentionally absent — the real state.

        const promise = writeApplicationStatus({
            prisma: tx,
            applicationId: 'app-701',
            fromStatus: 'AUDIT_PASSED',
            toStatus: 'APPROVED',
            actorId: 'auditor-701',
            actorRole: 'AUDITOR',
        });

        await expect(promise).rejects.toMatchObject({ code: 'EVIDENCE_CAPTURE_UNAVAILABLE' });
        expect(tx.updateCalls).toHaveLength(2);
        expect(tx.updateCalls[0].data.status).toBe('APPROVED');
        expect(tx.updateCalls[1].data.status).toBe('AUDIT_PASSED');
        expect(tx.certificate.create).not.toHaveBeenCalled();
    });

    test('control: sufficient evidence -> the real chain mints a certificate and does NOT roll back', async () => {
        const { writeApplicationStatus } = loadWriter();
        const tx = makeTxPrisma();
        tx.auditChecklist.findFirst = jest.fn(async () => ({ id: 'audit-701', applicationId: 'app-701' }));
        // eslint-disable-next-line global-require
        const { CHECKLIST_TEMPLATE_2026, DEFAULT_MIN_PHOTOS } = require('../../services/audit-onsite-service');
        tx.farmAuditPhoto = farmAuditPhotoStub(DEFAULT_MIN_PHOTOS);
        tx.farmAuditChecklistItem = { count: jest.fn(async () => CHECKLIST_TEMPLATE_2026.length) };

        const result = await writeApplicationStatus({
            prisma: tx,
            applicationId: 'app-701',
            fromStatus: 'AUDIT_PASSED',
            toStatus: 'APPROVED',
            actorId: 'auditor-701',
            actorRole: 'AUDITOR',
        });

        expect(result.status).toBe('APPROVED');
        // Exactly ONE update — the forward write. No revert.
        expect(tx.updateCalls).toHaveLength(1);
        expect(tx.certificate.create).toHaveBeenCalledTimes(1);
    });
});
