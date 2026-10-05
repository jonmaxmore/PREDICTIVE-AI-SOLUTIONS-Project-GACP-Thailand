/**
 * onsite-evidence-mode-flip.test.js — evidence-integrity fix, 2026-08-26.
 *
 * armOnsiteEvidence refuses to arm anything for a mode that cannot produce onsite
 * evidence (ONLINE_MEET, or any mode it does not recognise). That refusal used to
 * be enforced on the FIRST scheduling of an application only, because the refusal
 * branch returned without writing: it created nothing, and it also deleted nothing
 * and un-pinned nothing.
 *
 * So this walk, with no attacker in it, reached a minted certificate:
 *
 *   1. schedule the application ONSITE  -> a row is armed, Application.formData
 *      .onsiteAuditId is pinned at it;
 *   2. the auditor uploads photographs and answers the checklist against that row;
 *   3. re-schedule the SAME application ONLINE_MEET -> armOnsiteEvidence returns
 *      early;
 *   4. the armed row and the pin are both still standing, and issuance verifies
 *      the onsite evidence of a visit that has just been called off.
 *
 * Every test in the first describe below fails on the pre-fix code. The rest are
 * the two things the fix was not allowed to break, asserted here rather than left
 * to be rediscovered: the pin still freezes a DECIDED row against a newer, emptier
 * duplicate, and a FAIL followed by a paper CAR close still rests on the failed
 * visit's photographs.
 *
 * The prisma double is a small in-memory store of real row shapes (the same shape
 * as onsite-evidence-pin-binding.test.js), and the assertions are on the gate's
 * decisions, not on which functions were called.
 */

'use strict';

const { assertOnsiteEvidenceSufficient } = require('../../services/onsite-evidence-gate');
const { armOnsiteEvidence } = require('../../services/audit/arm-onsite-evidence');
const { CHECKLIST_TEMPLATE_2026, DEFAULT_MIN_PHOTOS } = require('../../services/audit-onsite-service');

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
            // The write the retire path needs. It mutates the store for real, so a
            // retired row genuinely stops being findable — a mock that swallowed
            // the write would let this whole file pass over the unfixed code.
            update: jest.fn(async ({ where: { id }, data }) => {
                const row = auditStore.find((r) => r.id === id);
                if (!row) { throw new Error(`no such AuditChecklist ${id}`); }
                Object.assign(row, data);
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
            count: jest.fn(async ({ where }) => checklistItems.filter((c) => {
                if (c.auditId !== where.auditId) { return false; }
                if (where.itemCode?.in && !where.itemCode.in.includes(c.itemCode)) { return false; }
                if (where.response?.in && !where.response.in.includes(c.response)) { return false; }
                return true;
            }).length),
        },
        _appStore: appStore,
        _auditStore: auditStore,
    };
}

/** N distinct photographs recorded against `auditId`. */
function photosFor(auditId, n = DEFAULT_MIN_PHOTOS) {
    return Array.from({ length: n }, (_, i) => ({ auditId, fileHash: `${auditId}-hash-${i}`.padEnd(64, '0') }));
}

/** A complete checklist recorded against `auditId`, every item answered PASS. */
function checklistFor(auditId) {
    return CHECKLIST_TEMPLATE_2026.map((item) => ({ auditId, itemCode: item.itemCode, response: 'PASS' }));
}

const SCHEDULE = { auditorId: 'auditor-1', organizationId: 'org-1', createdBy: 'scheduler-1' };

describe('a mode that cannot certify does not leave a certifiable pin behind', () => {
    /**
     * The full walk: ONSITE, a real visit's worth of evidence, then a re-schedule
     * as ONLINE_MEET.
     */
    async function flipToOnlineAfterAnOnsiteVisit(mode = 'ONLINE_MEET') {
        const prisma = makePrisma({ apps: [{ id: 'app-1', formData: {} }] });

        const armed = await armOnsiteEvidence(prisma, {
            ...SCHEDULE, applicationId: 'app-1', inspectionMode: 'ONSITE',
        });
        expect(armed.armed).toBe(true);
        expect(prisma._appStore.get('app-1').formData.onsiteAuditId).toBe(armed.auditChecklistId);

        // The visit's evidence lands on the armed row, exactly as it would in the
        // real flow: it really is this application's evidence, which is why every
        // binding check downstream is satisfied by it.
        const evidenced = makePrisma({
            apps: [{ id: 'app-1', formData: { ...prisma._appStore.get('app-1').formData } }],
            audits: prisma._auditStore.map((r) => ({ ...r })),
            photos: photosFor(armed.auditChecklistId),
            checklistItems: checklistFor(armed.auditChecklistId),
        });

        // Sanity: at this moment the certificate WOULD be issuable. If this ever
        // stops holding, the tests below are passing for the wrong reason.
        await expect(assertOnsiteEvidenceSufficient({
            prisma: evidenced,
            applicationId: 'app-1',
            auditId: armed.auditChecklistId,
        })).resolves.toMatchObject({ auditId: armed.auditChecklistId });

        const flipped = await armOnsiteEvidence(evidenced, {
            ...SCHEDULE, applicationId: 'app-1', inspectionMode: mode,
        });

        return { prisma: evidenced, onsiteAuditId: armed.auditChecklistId, flipped };
    }

    test('re-scheduling ONLINE_MEET un-pins the armed row, so issuance no longer verifies it', async () => {
        const { prisma, onsiteAuditId, flipped } = await flipToOnlineAfterAnOnsiteVisit();

        expect(flipped.armed).toBe(false);
        expect(flipped.retiredAuditChecklistIds).toEqual([onsiteAuditId]);
        expect(flipped.pinCleared).toBe(true);
        expect(prisma._appStore.get('app-1').formData).not.toHaveProperty('onsiteAuditId');

        // The certificate path, end to end: certificate-service passes
        // formData.onsiteAuditId (now absent) and the application id.
        await expect(assertOnsiteEvidenceSufficient({
            prisma,
            applicationId: 'app-1',
            auditId: prisma._appStore.get('app-1').formData.onsiteAuditId,
        })).rejects.toMatchObject({ code: 'NO_ONSITE_AUDIT' });
    });

    test('and the row itself is stood down, so clearing the pin cannot be undone by the resolver', async () => {
        const { prisma, onsiteAuditId } = await flipToOnlineAfterAnOnsiteVisit();

        // The load-bearing half. Un-pinning alone would have fixed nothing: with no
        // pin the gate falls back to resolveCurrentOnsiteAuditId, which PREFERS the
        // IN_PROGRESS row, so the called-off visit's five photographs would have been
        // counted one hop later.
        expect(prisma._auditStore.find((r) => r.id === onsiteAuditId).isDeleted).toBe(true);
        expect(prisma._auditStore.find((r) => r.id === onsiteAuditId).deleteReason).toMatch(/ONLINE_MEET/);

        // The unpinned resolution — the path an un-pinned application takes — must now
        // find nothing, and must never have COUNTED the called-off visit's photographs
        // on the way to saying so. (Cleared first: the helper's sanity check above
        // deliberately read them while the audit was still live.)
        prisma.farmAuditPhoto.findMany.mockClear();
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .rejects.toMatchObject({ code: 'NO_ONSITE_AUDIT' });
        expect(prisma.farmAuditPhoto.findMany).not.toHaveBeenCalled();
    });

    test('someone re-pinning the stale row by hand is refused too', async () => {
        const { prisma, onsiteAuditId } = await flipToOnlineAfterAnOnsiteVisit();

        // A retired row is not a live audit of this application, so the pinned door
        // refuses on the same fact the resolver honours (isDeleted) rather than on a
        // second, separate rule that could drift from it.
        await expect(assertOnsiteEvidenceSufficient({
            prisma,
            applicationId: 'app-1',
            auditId: onsiteAuditId,
        })).rejects.toMatchObject({ code: 'AUDIT_APPLICATION_MISMATCH' });
    });

    test('an unrecognised mode stands the evidence down as well, because unrecognised means not certifiable', async () => {
        const { prisma, onsiteAuditId, flipped } = await flipToOnlineAfterAnOnsiteVisit('SOMETHING_NEW');

        expect(flipped.canLeadToCertificate).toBe(false);
        expect(flipped.retiredAuditChecklistIds).toEqual([onsiteAuditId]);
        expect(prisma._appStore.get('app-1').formData).not.toHaveProperty('onsiteAuditId');
    });

    test('the scheduler is told, in Thai, that the earlier onsite evidence was stood down', async () => {
        const { flipped } = await flipToOnlineAfterAnOnsiteVisit();

        expect(flipped.reason).toContain('ต้องนัดตรวจแบบลงพื้นที่');
        expect(flipped.reason).toContain('ยกเลิกรายการตรวจลงพื้นที่ที่เตรียมไว้ก่อนหน้า');
        // Thai copy rule: no em dash (the thai-ui-copy guideline).
        expect(flipped.reason).not.toContain('—');
    });

    test('a duplicate IN_PROGRESS row is retired too, not left behind for the resolver', async () => {
        // Two live rows is a violated invariant, but a reachable one: the checklist
        // controller minted its own rows inline until 2026-08-26. Retiring only the
        // newest would be the same hole, one row over.
        const prisma = makePrisma({
            apps: [{ id: 'app-1', formData: { onsiteAuditId: 'audit-newer' } }],
            audits: [
                { id: 'audit-older', applicationId: 'app-1', status: 'IN_PROGRESS', createdAt: 1 },
                { id: 'audit-newer', applicationId: 'app-1', status: 'IN_PROGRESS', createdAt: 2 },
            ],
            photos: [...photosFor('audit-older'), ...photosFor('audit-newer')],
            checklistItems: [...checklistFor('audit-older'), ...checklistFor('audit-newer')],
        });

        const flipped = await armOnsiteEvidence(prisma, {
            ...SCHEDULE, applicationId: 'app-1', inspectionMode: 'ONLINE_MEET',
        });

        expect(flipped.retiredAuditChecklistIds.sort()).toEqual(['audit-newer', 'audit-older']);
        expect(prisma._auditStore.every((r) => r.isDeleted)).toBe(true);
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .rejects.toMatchObject({ code: 'NO_ONSITE_AUDIT' });
    });

    test('an ONLINE_MEET with nothing armed writes nothing at all', async () => {
        const prisma = makePrisma({ apps: [{ id: 'app-1', formData: { carDueAt: '2569-01-15' } }] });

        const flipped = await armOnsiteEvidence(prisma, {
            ...SCHEDULE, applicationId: 'app-1', inspectionMode: 'ONLINE_MEET',
        });

        expect(flipped.retiredAuditChecklistIds).toEqual([]);
        expect(flipped.pinCleared).toBe(false);
        expect(prisma.auditChecklist.update).not.toHaveBeenCalled();
        expect(prisma.application.update).not.toHaveBeenCalled();
    });
});

describe('what the fix was not allowed to break', () => {
    test('a FAIL followed by a paper CAR close still rests on the failed visit\'s evidence, even after a mode flip', async () => {
        // CAR_REVIEWING -> AUDIT_PASSED is a legal edge, and the close legitimately
        // rests on the photographs of the visit that said no. That row is DECIDED,
        // not IN_PROGRESS: nothing about it is pending, so a later online meeting
        // does not un-visit the farm and must not stand it down.
        const prisma = makePrisma({
            apps: [{ id: 'app-1', formData: { onsiteAuditId: 'audit-failed', carDueAt: '2569-01-15' } }],
            audits: [{ id: 'audit-failed', applicationId: 'app-1', status: 'COMPLETED', createdAt: 1 }],
            photos: photosFor('audit-failed'),
            checklistItems: checklistFor('audit-failed'),
        });

        const flipped = await armOnsiteEvidence(prisma, {
            ...SCHEDULE, applicationId: 'app-1', inspectionMode: 'ONLINE_MEET',
        });

        expect(flipped.retiredAuditChecklistIds).toEqual([]);
        expect(flipped.pinCleared).toBe(false);
        expect(prisma._appStore.get('app-1').formData.onsiteAuditId).toBe('audit-failed');
        expect(prisma._appStore.get('app-1').formData.carDueAt).toBe('2569-01-15');
        expect(prisma._auditStore[0].isDeleted).toBe(false);

        await expect(assertOnsiteEvidenceSufficient({
            prisma, applicationId: 'app-1', auditId: 'audit-failed',
        })).resolves.toMatchObject({ auditId: 'audit-failed', photoCount: DEFAULT_MIN_PHOTOS });
    });

    test('the pin still freezes a DECIDED row against a newer duplicate, and a mode flip does not thaw it', async () => {
        // The reason the pin exists at all: a newer, EMPTY, IN_PROGRESS row wins both
        // of resolveCurrentOnsiteAuditId's tie-breakers over the row the decision was
        // recorded against. Retiring that orphan must not take the pin with it.
        const prisma = makePrisma({
            apps: [{ id: 'app-1', formData: { onsiteAuditId: 'audit-decided' } }],
            audits: [
                { id: 'audit-decided', applicationId: 'app-1', status: 'COMPLETED', createdAt: 1 },
                { id: 'audit-orphan', applicationId: 'app-1', status: 'IN_PROGRESS', createdAt: 2 },
            ],
            photos: photosFor('audit-decided'),
            checklistItems: checklistFor('audit-decided'),
        });

        // Before the flip the orphan is what an unpinned resolution finds.
        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: 'app-1' }))
            .rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });

        const flipped = await armOnsiteEvidence(prisma, {
            ...SCHEDULE, applicationId: 'app-1', inspectionMode: 'ONLINE_MEET',
        });

        expect(flipped.retiredAuditChecklistIds).toEqual(['audit-orphan']);
        expect(flipped.pinCleared).toBe(false);
        expect(prisma._appStore.get('app-1').formData.onsiteAuditId).toBe('audit-decided');

        await expect(assertOnsiteEvidenceSufficient({
            prisma, applicationId: 'app-1', auditId: 'audit-decided',
        })).resolves.toMatchObject({ auditId: 'audit-decided', photoCount: DEFAULT_MIN_PHOTOS });
    });

    test('ONSITE still arms and pins, and a re-schedule of the same ONSITE visit still re-uses its evidence row', async () => {
        // The inheritance is deliberate (see the idempotency comment in
        // arm-onsite-evidence.js): one pending visit whose date moved is still one
        // visit, and splitting its evidence across two rows would drop both below the
        // gate's minimum.
        const prisma = makePrisma({ apps: [{ id: 'app-1', formData: {} }] });

        const first = await armOnsiteEvidence(prisma, {
            ...SCHEDULE, applicationId: 'app-1', inspectionMode: 'ONSITE',
        });
        const second = await armOnsiteEvidence(prisma, {
            ...SCHEDULE, applicationId: 'app-1', inspectionMode: 'ONSITE',
        });

        expect(second.auditChecklistId).toBe(first.auditChecklistId);
        expect(prisma.auditChecklist.create).toHaveBeenCalledTimes(1);
        expect(prisma._appStore.get('app-1').formData.onsiteAuditId).toBe(first.auditChecklistId);
        expect(prisma._auditStore[0].isDeleted).toBe(false);
    });
});
