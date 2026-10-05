/**
 * onsite-evidence-pin-binding.test.js — evidence-integrity fix, 2026-08-26.
 *
 * The onsite evidence gate answers one question: which photographs does THIS
 * certificate rest on? It answers it from a pin — Application.formData
 * .onsiteAuditId, stamped by audit-onsite-service.submitDecision and forwarded
 * by certificate-service.generateCertificate. Adversarial review found two ways
 * that pin could name evidence that is not this application's evidence, and
 * neither needed an attacker to fire.
 *
 *   HOLE 1 — the pin was never bound to the application. The lookup was
 *   `auditChecklist.findFirst({ where: { id: auditId, isDeleted: false } })`,
 *   with no applicationId, so ANY live AuditChecklist id satisfied the gate for
 *   ANY application: app-2 (own audit: zero photos) pinned to app-1's audit
 *   minted a certificate reporting photoCount 5, taken on another farm.
 *
 *   HOLE 2 — the pin outlived its audit. A FAIL stamps the pin too (deliberately:
 *   CAR_REVIEWING -> AUDIT_PASSED is a legal edge, so a corrective action closed
 *   on paper legitimately rests on that visit's photographs). But when the audit
 *   was RE-SCHEDULED, a new AuditChecklist row was armed and nothing moved the
 *   pin, so issuance verified the evidence of the audit the farm FAILED — real
 *   photographs, from the visit that said no.
 *
 * Plus the fail-open branch inside the gate's own photo count: it fell back to
 * counting ROWS when the delegate exposed `count` but not `findMany`.
 *
 * Every test here fails on the pre-fix code. Nothing is mocked away that the
 * gate actually reasons about: the prisma double below is a small in-memory
 * store of real row shapes, and the assertions are on the gate's decisions.
 */

'use strict';

const { assertOnsiteEvidenceSufficient } = require('../../services/onsite-evidence-gate');
const { armOnsiteEvidence } = require('../../services/audit/arm-onsite-evidence');
const { CHECKLIST_TEMPLATE_2026, DEFAULT_MIN_PHOTOS } = require('../../services/audit-onsite-service');

/**
 * In-memory prisma double over real row shapes. `audits` and `photos` are
 * arrays the test seeds directly, so a test can express "app-2's audit has no
 * photographs, app-1's has five" without ceremony.
 */
function makePrisma({ apps = [], audits = [], photos = [], checklistItems = [] } = {}) {
    const appStore = new Map(apps.map((a) => [a.id, { ...a }]));
    const auditStore = audits.map((a) => ({ isDeleted: false, status: 'IN_PROGRESS', createdAt: 0, ...a }));

    const matchesAudit = (row, where) => {
        if (where.id && row.id !== where.id) { return false; }
        if (where.applicationId && row.applicationId !== where.applicationId) { return false; }
        if (where.organizationId && row.organizationId !== where.organizationId) { return false; }
        if (where.isDeleted === false && row.isDeleted) { return false; }
        if (where.status && row.status !== where.status) { return false; }
        return true;
    };

    return {
        application: {
            findUnique: jest.fn(async ({ where: { id } }) => {
                const row = appStore.get(id);
                return row ? { ...row } : null;
            }),
            update: jest.fn(async ({ where: { id }, data }) => {
                const row = appStore.get(id) || { id };
                const updated = { ...row, ...data };
                appStore.set(id, updated);
                return { ...updated };
            }),
        },
        auditChecklist: {
            findFirst: jest.fn(async ({ where, orderBy }) => {
                const hits = auditStore.filter((row) => matchesAudit(row, where));
                if (orderBy?.createdAt === 'desc') {
                    hits.sort((a, b) => b.createdAt - a.createdAt);
                }
                return hits.length ? { ...hits[0] } : null;
            }),
            create: jest.fn(async ({ data }) => {
                const row = {
                    id: `audit-created-${auditStore.length + 1}`,
                    isDeleted: false,
                    createdAt: auditStore.length + 100,
                    ...data,
                };
                auditStore.push(row);
                return { ...row };
            }),
        },
        farmAuditPhoto: {
            count: jest.fn(async ({ where }) => photos.filter((p) => p.auditId === where.auditId).length),
            findMany: jest.fn(async ({ where }) => photos
                .filter((p) => p.auditId === where.auditId)
                .map((p) => ({ fileHash: p.fileHash }))),
        },
        farmAuditChecklistItem: {
            count: jest.fn(async ({ where }) => checklistItems.filter((c) => c.auditId === where.auditId).length),
        },
        // Test-visible handles.
        _appStore: appStore,
        _auditStore: auditStore,
    };
}

/** N distinct photographs recorded against `auditId`. */
function photosFor(auditId, n = DEFAULT_MIN_PHOTOS) {
    return Array.from({ length: n }, (_, i) => ({ auditId, fileHash: `${auditId}-hash-${i}`.padEnd(64, '0') }));
}

/** A complete checklist recorded against `auditId`. */
function checklistFor(auditId) {
    return CHECKLIST_TEMPLATE_2026.map((item) => ({ auditId, itemCode: item.itemCode || item.code }));
}

describe('the pin must name THIS application\'s audit (HOLE 1)', () => {
    /**
     * The reproduction from the review, reduced: two applications, one of which
     * has done the work. Pre-fix, the second one borrows the first one's visit.
     */
    function twoApplications() {
        return makePrisma({
            apps: [{ id: 'app-1', formData: {} }, { id: 'app-2', formData: {} }],
            audits: [
                { id: 'audit-app-1', applicationId: 'app-1', organizationId: 'org-1', createdAt: 1 },
                { id: 'audit-app-2', applicationId: 'app-2', organizationId: 'org-1', createdAt: 2 },
            ],
            // Only app-1 was actually visited.
            photos: photosFor('audit-app-1'),
            checklistItems: checklistFor('audit-app-1'),
        });
    }

    test('app-2 pinned to app-1\'s fully evidenced audit is REFUSED, not credited with another farm\'s photographs', async () => {
        const prisma = twoApplications();

        await expect(assertOnsiteEvidenceSufficient({
            prisma,
            applicationId: 'app-2',
            auditId: 'audit-app-1',
        })).rejects.toMatchObject({ code: 'AUDIT_APPLICATION_MISMATCH' });

        // The load-bearing half: the gate must never have COUNTED app-1's
        // photographs on app-2's behalf. A refusal that still read the wrong
        // rows would pass a code assertion while leaving the hole open for the
        // next caller that only checks photoCount.
        expect(prisma.farmAuditPhoto.findMany).not.toHaveBeenCalled();
    });

    test('the same application pinned to its OWN audit still resolves — the binding does not break the happy path', async () => {
        const prisma = makePrisma({
            apps: [{ id: 'app-1', formData: {} }],
            audits: [{ id: 'audit-app-1', applicationId: 'app-1', organizationId: 'org-1', createdAt: 1 }],
            photos: photosFor('audit-app-1'),
            checklistItems: checklistFor('audit-app-1'),
        });

        const out = await assertOnsiteEvidenceSufficient({
            prisma,
            applicationId: 'app-1',
            auditId: 'audit-app-1',
        });

        expect(out.auditId).toBe('audit-app-1');
        expect(out.photoCount).toBe(DEFAULT_MIN_PHOTOS);
        expect(out.itemCount).toBe(CHECKLIST_TEMPLATE_2026.length);
    });

    test('unpinned, app-2 refuses on its own (empty) audit — the pin was the whole difference', async () => {
        const prisma = twoApplications();

        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-2' }))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });
    });

    test('a soft-deleted audit of this application is still refused, and says the pin is what failed', async () => {
        const prisma = makePrisma({
            apps: [{ id: 'app-1', formData: {} }],
            audits: [{ id: 'audit-app-1', applicationId: 'app-1', isDeleted: true, createdAt: 1 }],
            photos: photosFor('audit-app-1'),
            checklistItems: checklistFor('audit-app-1'),
        });

        await expect(assertOnsiteEvidenceSufficient({
            prisma, applicationId: 'app-1', auditId: 'audit-app-1',
        })).rejects.toMatchObject({ code: 'AUDIT_APPLICATION_MISMATCH' });
    });
});

describe('the pin must not outlive its audit (HOLE 2)', () => {
    /**
     * The whole scenario end to end, with no attacker in it: a farm is visited,
     * FAILS, the decision pins the failed audit (correctly — a paper CAR close
     * rests on that visit), the audit is re-scheduled, and then somebody
     * approves. Pre-fix the pin still named the failed visit and issuance
     * verified ITS five photographs.
     */
    test('after a FAIL and a re-schedule, the gate no longer verifies the failed audit\'s photos', async () => {
        const prisma = makePrisma({
            apps: [{ id: 'app-1', formData: { onsiteAuditId: 'audit-failed' } }],
            audits: [{
                id: 'audit-failed',
                applicationId: 'app-1',
                organizationId: 'org-1',
                status: 'COMPLETED',
                createdAt: 1,
            }],
            // The FAILED visit's evidence: real, complete, and the wrong answer.
            photos: photosFor('audit-failed'),
            checklistItems: checklistFor('audit-failed'),
        });

        // Sanity: before the re-schedule the pin is exactly what it should be.
        expect(prisma._appStore.get('app-1').formData.onsiteAuditId).toBe('audit-failed');

        // The re-schedule. This is the ONLY place an AuditChecklist row is
        // created (see audit-checklist-created-by-every-scheduling-door.test.js),
        // which is why the pin is re-pointed here.
        const armed = await armOnsiteEvidence(prisma, {
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            organizationId: 'org-1',
            inspectionMode: 'ONSITE',
        });
        expect(armed.armed).toBe(true);
        expect(armed.auditChecklistId).not.toBe('audit-failed');

        const repinned = prisma._appStore.get('app-1').formData;
        expect(repinned.onsiteAuditId).toBe(armed.auditChecklistId);

        // Issuance now looks at the audit that is actually pending, which has no
        // evidence yet — so it refuses instead of minting on the failed visit.
        await expect(assertOnsiteEvidenceSufficient({
            prisma,
            applicationId: 'app-1',
            auditId: repinned.onsiteAuditId,
        })).rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });

        // And it refuses because the NEW audit is empty, never because it read
        // the failed one and found it wanting.
        expect(prisma.farmAuditPhoto.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { auditId: armed.auditChecklistId } }),
        );
    });

    test('re-pointing survives the idempotent branch: arming onto an audit already IN_PROGRESS still clears a stale pin', async () => {
        const prisma = makePrisma({
            apps: [{ id: 'app-1', formData: { onsiteAuditId: 'audit-failed', carDueAt: '2569-01-15' } }],
            audits: [
                { id: 'audit-failed', applicationId: 'app-1', status: 'COMPLETED', createdAt: 1 },
                { id: 'audit-live', applicationId: 'app-1', status: 'IN_PROGRESS', createdAt: 2 },
            ],
        });

        const armed = await armOnsiteEvidence(prisma, {
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            organizationId: 'org-1',
            inspectionMode: 'ONSITE',
        });

        expect(armed.auditChecklistId).toBe('audit-live');
        expect(prisma.auditChecklist.create).not.toHaveBeenCalled();
        expect(prisma._appStore.get('app-1').formData.onsiteAuditId).toBe('audit-live');
        // Everything else in the blob is left exactly as it was — the CAR clock
        // among it. A re-point that rebuilt formData from a stale snapshot would
        // quietly drop the applicant's corrective-action deadline.
        expect(prisma._appStore.get('app-1').formData.carDueAt).toBe('2569-01-15');
    });

    test('an already-correct pin is not rewritten, so arming twice is not two writes', async () => {
        const prisma = makePrisma({
            apps: [{ id: 'app-1', formData: { onsiteAuditId: 'audit-live' } }],
            audits: [{ id: 'audit-live', applicationId: 'app-1', status: 'IN_PROGRESS', createdAt: 1 }],
        });

        await armOnsiteEvidence(prisma, {
            applicationId: 'app-1', auditorId: 'auditor-1', organizationId: 'org-1', inspectionMode: 'ONSITE',
        });

        expect(prisma.application.update).not.toHaveBeenCalled();
    });

    test('ONLINE_MEET arms nothing and leaves the pin alone — a paper CAR close still rests on the only onsite visit there is', async () => {
        const prisma = makePrisma({
            apps: [{ id: 'app-1', formData: { onsiteAuditId: 'audit-visited' } }],
            audits: [{ id: 'audit-visited', applicationId: 'app-1', status: 'COMPLETED', createdAt: 1 }],
            photos: photosFor('audit-visited'),
            checklistItems: checklistFor('audit-visited'),
        });

        const armed = await armOnsiteEvidence(prisma, {
            applicationId: 'app-1', auditorId: 'auditor-1', organizationId: 'org-1', inspectionMode: 'ONLINE_MEET',
        });

        expect(armed.armed).toBe(false);
        expect(prisma.application.update).not.toHaveBeenCalled();
        expect(prisma._appStore.get('app-1').formData.onsiteAuditId).toBe('audit-visited');

        // And that visit's evidence still satisfies the gate.
        await expect(assertOnsiteEvidenceSufficient({
            prisma, applicationId: 'app-1', auditId: 'audit-visited',
        })).resolves.toMatchObject({ auditId: 'audit-visited' });
    });
});

describe('the reason the pin exists still holds', () => {
    /**
     * The Task-3 linchpin, in unit form (the DB-backed version lives in
     * __tests__/integration/onsite-decision-mint-e2e.test.js). A newer, EMPTY,
     * IN_PROGRESS duplicate row satisfies BOTH of resolveCurrentOnsiteAuditId's
     * tie-breakers over the row a decision was just recorded against. If the
     * binding fix had been written as "prefer the current live audit over the
     * pin", this is what it would have broken: the decided row would lose to an
     * orphan and a fully evidenced PASS would mint nothing.
     */
    test('a newer duplicate audit row cannot steal a decision from the pinned, decided row', async () => {
        const prisma = makePrisma({
            apps: [{ id: 'app-1', formData: { onsiteAuditId: 'audit-decided' } }],
            audits: [
                { id: 'audit-decided', applicationId: 'app-1', status: 'COMPLETED', createdAt: 1 },
                { id: 'audit-orphan', applicationId: 'app-1', status: 'IN_PROGRESS', createdAt: 2 },
            ],
            photos: photosFor('audit-decided'),
            checklistItems: checklistFor('audit-decided'),
        });

        const out = await assertOnsiteEvidenceSufficient({
            prisma,
            applicationId: 'app-1',
            auditId: 'audit-decided',
        });

        expect(out.auditId).toBe('audit-decided');
        expect(out.photoCount).toBe(DEFAULT_MIN_PHOTOS);

        // Without the pin the very same call resolves to the empty orphan and
        // refuses — which is precisely the divergence the pin was added to stop.
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });
    });
});

describe('the photo count has no laxer mode to fall back to', () => {
    test('a client exposing count but not findMany is REFUSED, not counted by rows', async () => {
        const prisma = makePrisma({
            apps: [{ id: 'app-1', formData: {} }],
            audits: [{ id: 'audit-1', applicationId: 'app-1', createdAt: 1 }],
            // One photograph uploaded five times: five ROWS, one distinct hash.
            photos: Array.from({ length: 5 }, () => ({ auditId: 'audit-1', fileHash: 'the-same-photo'.padEnd(64, '0') })),
            checklistItems: checklistFor('audit-1'),
        });
        delete prisma.farmAuditPhoto.findMany;

        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .rejects.toMatchObject({ code: 'EVIDENCE_CAPTURE_UNAVAILABLE' });

        // The point of the refusal: the row count would have said 5 and minted.
        expect(prisma.farmAuditPhoto.count).not.toHaveBeenCalled();
    });

    test('with findMany present the same rows count as ONE photograph, and refuse', async () => {
        const prisma = makePrisma({
            apps: [{ id: 'app-1', formData: {} }],
            audits: [{ id: 'audit-1', applicationId: 'app-1', createdAt: 1 }],
            photos: Array.from({ length: 5 }, () => ({ auditId: 'audit-1', fileHash: 'the-same-photo'.padEnd(64, '0') })),
            checklistItems: checklistFor('audit-1'),
        });

        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS', message: /got 1 distinct/ });
    });
});
