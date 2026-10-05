/**
 * onsite-evidence-gate — shared fail-closed evidence check (cert-integrity
 * fix, Phase A2, 2026-08-16).
 *
 * Single choke-point helper: is there sufficient, verifiable onsite-audit
 * evidence (a recorded audit + enough photos + a completed checklist) for an
 * application before a PASS / certificate may proceed? Both
 * audit-onsite-service.submitDecision (Phase A) and
 * certificate-service.generateCertificate (Phase A2) call this SAME function
 * — see the change log for the verified-Critical this closes.
 *
 * FAIL-CLOSED contract under test:
 *   - no onsite audit row for the application at all      → NO_ONSITE_AUDIT
 *   - photo/checklist-item models not provisioned          → EVIDENCE_CAPTURE_UNAVAILABLE
 *     (BOTH absent, or exactly ONE of the two absent — a partial deployment
 *     must still refuse, not silently check only the half that exists)
 *   - provisioned but below the photo minimum               → INSUFFICIENT_PHOTOS
 *   - provisioned but the checklist is incomplete            → INCOMPLETE_CHECKLIST
 *   - provisioned + sufficient                                → resolves
 */

'use strict';

// Isolate this unit test from audit-onsite-service.js's own dependency chain
// (application-status-writer, attachment-service, notification-fanout-service,
// car-deadline-service, audit-logger) — onsite-evidence-gate.js lazily requires
// audit-onsite-service.js ONLY to read the two shared constants below (single
// source of truth), so a minimal mock is all this file needs.
jest.mock('../../services/audit-onsite-service', () => ({
    DEFAULT_MIN_PHOTOS: 5,
    CHECKLIST_TEMPLATE_2026: Array.from({ length: 24 }, (_, i) => ({ itemCode: String(i) })),
}));

const { assertOnsiteEvidenceSufficient } = require('../../services/onsite-evidence-gate');
const { farmAuditPhotoStub } = require('../../test-support/farm-audit-photo-stub');

function makePrisma({ audits = [], withPhotoModel = true, withChecklistModel = true, photoCount = 5, itemCount = 24 } = {}) {
    const prisma = {
        auditChecklist: {
            findFirst: jest.fn(async ({ where, orderBy }) => {
                const matches = audits.filter((a) => a.applicationId === where.applicationId);
                if (matches.length === 0) { return null; }
                if (orderBy?.createdAt === 'desc') {
                    return [...matches].sort((a, b) => b.createdAt - a.createdAt)[0];
                }
                return matches[0];
            }),
        },
    };
    if (withPhotoModel) {
        prisma.farmAuditPhoto = farmAuditPhotoStub(photoCount);
    }
    if (withChecklistModel) {
        prisma.farmAuditChecklistItem = { count: jest.fn(async () => itemCount) };
    }
    return prisma;
}

describe('onsite-evidence-gate.assertOnsiteEvidenceSufficient', () => {
    test('throws TypeError when prisma is missing', async () => {
        await expect(assertOnsiteEvidenceSufficient({ applicationId: 'app-1' }))
            .rejects.toThrow(TypeError);
    });

    test('throws TypeError when applicationId is missing', async () => {
        await expect(assertOnsiteEvidenceSufficient({ prisma: makePrisma() }))
            .rejects.toThrow(TypeError);
    });

    test('NO_ONSITE_AUDIT: no AuditChecklist row exists for the application', async () => {
        const prisma = makePrisma({ audits: [] });
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .rejects.toMatchObject({ code: 'NO_ONSITE_AUDIT' });
    });

    test('EVIDENCE_CAPTURE_UNAVAILABLE: BOTH evidence models unprovisioned', async () => {
        const prisma = makePrisma({
            audits: [{ id: 'audit-1', applicationId: 'app-1', createdAt: 1 }],
            withPhotoModel: false,
            withChecklistModel: false,
        });
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .rejects.toMatchObject({ code: 'EVIDENCE_CAPTURE_UNAVAILABLE' });
    });

    test('EVIDENCE_CAPTURE_UNAVAILABLE: only farmAuditPhoto provisioned (checklist model absent) — partial deployment still fail-closed', async () => {
        const prisma = makePrisma({
            audits: [{ id: 'audit-1', applicationId: 'app-1', createdAt: 1 }],
            withPhotoModel: true,
            withChecklistModel: false,
        });
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .rejects.toMatchObject({ code: 'EVIDENCE_CAPTURE_UNAVAILABLE' });
    });

    test('EVIDENCE_CAPTURE_UNAVAILABLE: only farmAuditChecklistItem provisioned (photo model absent) — partial deployment still fail-closed', async () => {
        const prisma = makePrisma({
            audits: [{ id: 'audit-1', applicationId: 'app-1', createdAt: 1 }],
            withPhotoModel: false,
            withChecklistModel: true,
        });
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .rejects.toMatchObject({ code: 'EVIDENCE_CAPTURE_UNAVAILABLE' });
    });

    test('INSUFFICIENT_PHOTOS: provisioned but below the minimum', async () => {
        const prisma = makePrisma({
            audits: [{ id: 'audit-1', applicationId: 'app-1', createdAt: 1 }],
            photoCount: 2,
            itemCount: 24,
        });
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });
    });

    test('INCOMPLETE_CHECKLIST: enough photos but the checklist is short', async () => {
        const prisma = makePrisma({
            audits: [{ id: 'audit-1', applicationId: 'app-1', createdAt: 1 }],
            photoCount: 5,
            itemCount: 3,
        });
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .rejects.toMatchObject({ code: 'INCOMPLETE_CHECKLIST' });
    });

    test('resolves with auditId + counts when evidence is sufficient', async () => {
        const prisma = makePrisma({
            audits: [{ id: 'audit-1', applicationId: 'app-1', createdAt: 1 }],
            photoCount: 5,
            itemCount: 24,
        });
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .resolves.toEqual({ auditId: 'audit-1', photoCount: 5, itemCount: 24 });
    });

    test('respects a custom minPhotos override', async () => {
        const prisma = makePrisma({
            audits: [{ id: 'audit-1', applicationId: 'app-1', createdAt: 1 }],
            photoCount: 8,
            itemCount: 24,
        });
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1', minPhotos: 10 }))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });
    });

    test('when multiple AuditChecklist rows exist for the application, checks the most recent one', async () => {
        const prisma = makePrisma({
            audits: [
                { id: 'audit-old', applicationId: 'app-1', createdAt: 1 },
                { id: 'audit-new', applicationId: 'app-1', createdAt: 2 },
            ],
            photoCount: 5,
            itemCount: 24,
        });
        const result = await assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' });
        expect(result.auditId).toBe('audit-new');
    });

    // `makePrisma` above filters `auditChecklist.findFirst` ONLY on
    // applicationId — it can't distinguish "IN_PROGRESS-first" from
    // "most-recent-wins" because it ignores `where.status` and
    // `where.isDeleted` entirely. Confirmed (2026-08-17): re-running the
    // exact case below through `makePrisma` resolves to the newest row
    // (a soft-deleted one) instead of the live IN_PROGRESS one — a false
    // GREEN that would let a resolver regression through undetected. This
    // mock HONORS both `where` keys, mirroring real Prisma `findFirst`
    // semantics, so it actually pins resolveCurrentOnsiteAuditId's
    // documented two-tier preference order (onsite-audit-resolver.js) at
    // the gate's own call site — not the resolver directly, per Task 13.
    function makeCrossRowPrisma(rows) {
        return {
            auditChecklist: {
                findFirst: jest.fn(async ({ where, orderBy }) => {
                    let matches = rows.filter((r) => r.applicationId === where.applicationId);
                    if (where.isDeleted !== undefined) {
                        matches = matches.filter((r) => r.isDeleted === where.isDeleted);
                    }
                    if (where.status !== undefined) {
                        matches = matches.filter((r) => r.status === where.status);
                    }
                    if (orderBy?.createdAt === 'desc') {
                        matches = [...matches].sort((a, b) => b.createdAt - a.createdAt);
                    }
                    return matches[0] || null;
                }),
            },
            farmAuditPhoto: farmAuditPhotoStub(5),
            farmAuditChecklistItem: { count: jest.fn(async () => 24) },
        };
    }

    describe('cross-row resolution honors status + isDeleted, not just recency', () => {
        test('resolves to the IN_PROGRESS row — not a newer COMPLETED row, not a soft-deleted (even newer, even IN_PROGRESS) row', async () => {
            const prisma = makeCrossRowPrisma([
                { id: 'audit-in-progress', applicationId: 'app-1', status: 'IN_PROGRESS', isDeleted: false, createdAt: 1 },
                { id: 'audit-completed-newer', applicationId: 'app-1', status: 'COMPLETED', isDeleted: false, createdAt: 2 },
                { id: 'audit-deleted-newest', applicationId: 'app-1', status: 'IN_PROGRESS', isDeleted: true, createdAt: 3 },
            ]);

            const result = await assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' });

            expect(result.auditId).toBe('audit-in-progress');
        });

        test('falls back to the most-recent live row when no row is IN_PROGRESS', async () => {
            const prisma = makeCrossRowPrisma([
                { id: 'audit-completed-old', applicationId: 'app-1', status: 'COMPLETED', isDeleted: false, createdAt: 1 },
                { id: 'audit-submitted-new', applicationId: 'app-1', status: 'SUBMITTED', isDeleted: false, createdAt: 2 },
                { id: 'audit-deleted-in-progress', applicationId: 'app-1', status: 'IN_PROGRESS', isDeleted: true, createdAt: 3 },
            ]);

            const result = await assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' });

            expect(result.auditId).toBe('audit-submitted-new');
        });
    });
});
