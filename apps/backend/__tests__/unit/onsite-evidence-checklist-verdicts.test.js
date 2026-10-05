/**
 * Evidence integrity — the checklist half of the gate must read the checklist
 * (2026-08-26).
 *
 * onsite-evidence-gate counted FarmAuditChecklistItem ROWS with no filter on
 * the verdict the auditor recorded, so:
 *   - an inspection in which every single item was marked FAIL satisfied
 *     "enough checklist items", and a certificate minted on top of an
 *     inspection that says the farm does not comply;
 *   - a row carrying no recognised verdict counted as an answer (response is a
 *     plain String column, not an enum);
 *   - rows for itemCodes outside CHECKLIST_TEMPLATE_2026 padded a total that is
 *     supposed to mean "the canonical template was completed".
 *
 * And the second half of the same round: the application binding added earlier
 * today was applied only `if (applicationId)`, so a caller passing an auditId
 * alone got the pre-binding gate back. applicationId is now required.
 *
 * The rule under test, stated once:
 *   itemCount   = template itemCodes carrying PASS | FAIL | NA — a FAIL IS the
 *                 record of a completed inspection, so it counts here;
 *   issuance    = additionally refused when any CRITICAL template item is
 *                 recorded FAIL (CHECKLIST_TEMPLATE_2026's own documented rule,
 *                 audit-onsite-service.js:159, which nothing implemented).
 */

'use strict';

// Same isolation the sibling onsite suites use: audit-onsite-service pulls in
// the status writer / CAR deadline / audit-logger chain at module load, none of
// which this file exercises.
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../services/car-deadline-service', () => ({
    computeCarDueDate: jest.fn(() => new Date('2026-09-01T00:00:00.000Z')),
    seedCarRevisionDeadline: jest.fn(async () => ({})),
}));
jest.mock('../../middleware/audit-logger', () => ({
    statusTransitionAuditHook: () => (async () => {}),
}));
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return Object.assign(l, { createLogger: () => l, default: l });
});

const onsite = require('../../services/audit-onsite-service');
const { assertOnsiteEvidenceSufficient } = require('../../services/onsite-evidence-gate');

const TEMPLATE = onsite.CHECKLIST_TEMPLATE_2026;
const MIN_PHOTOS = onsite.DEFAULT_MIN_PHOTOS;
const CRITICAL_CODES = TEMPLATE.filter((t) => t.isCritical === true).map((t) => t.itemCode);
const ORG = 'org-1';

const AUDIT_A = { id: 'audit-A', applicationId: 'app-A', organizationId: ORG, status: 'IN_PROGRESS', isDeleted: false };
const AUDIT_B = { id: 'audit-B', applicationId: 'app-B', organizationId: ORG, status: 'IN_PROGRESS', isDeleted: false };

/** Every template item answered the same way — the shape a real inspection has. */
function answerAll(response, auditId = AUDIT_A.id) {
    return TEMPLATE.map((t) => ({ auditId, itemCode: t.itemCode, response, isCritical: t.isCritical }));
}

/** Same, with named itemCodes overridden — used to plant a single FAIL. */
function answerAllExcept(overrides, auditId = AUDIT_A.id) {
    return answerAll('PASS', auditId).map((row) => (
        Object.prototype.hasOwnProperty.call(overrides, row.itemCode)
            ? { ...row, response: overrides[row.itemCode] }
            : row
    ));
}

/**
 * prisma stub that HONOURS the `where` the gate sends. A stub that answers a
 * constant regardless of the filter is precisely how a row count passed for an
 * answer count in the first place, so this one filters for real:
 * `{ auditId, itemCode: { in: [...] }, response: { in: [...] } }`.
 */
function makePrisma({ audits = [AUDIT_A, AUDIT_B], items = [], distinctPhotos = MIN_PHOTOS } = {}) {
    const photoRows = Array.from({ length: distinctPhotos }, (_, i) => ({ fileHash: `hash-${i}`.padEnd(64, '0') }));
    return {
        auditChecklist: {
            findFirst: jest.fn(async ({ where }) => {
                const hit = audits.find((a) => (
                    (where.id === undefined || a.id === where.id)
                    && (where.applicationId === undefined || a.applicationId === where.applicationId)
                )) || null;
                if (!hit) { return null; }
                if (where.isDeleted === false && hit.isDeleted) { return null; }
                return hit;
            }),
        },
        farmAuditPhoto: {
            findMany: jest.fn(async () => photoRows.map((r) => ({ ...r }))),
            count: jest.fn(async () => photoRows.length),
        },
        farmAuditChecklistItem: {
            count: jest.fn(async ({ where }) => items.filter((row) => (
                row.auditId === where.auditId
                && (where.itemCode?.in ? where.itemCode.in.includes(row.itemCode) : true)
                && (where.response?.in ? where.response.in.includes(row.response) : true)
            )).length),
        },
    };
}

function gate(extra = {}) {
    return assertOnsiteEvidenceSufficient({
        applicationId: AUDIT_A.applicationId,
        auditId: AUDIT_A.id,
        ...extra,
    });
}

describe('the checklist half reads the verdicts, not the row count', () => {
    test('an inspection whose items are ALL recorded FAIL does not satisfy the gate', async () => {
        const prisma = makePrisma({ items: answerAll('FAIL') });

        // The completeness half is satisfied — a FAIL is a real answer from a
        // real visit — so the refusal has to come from reading what it says.
        await expect(gate({ prisma }))
            .rejects.toMatchObject({ code: 'CRITICAL_CHECKLIST_FAILURE' });
    });

    test('ONE critical item recorded FAIL refuses issuance, even with every other item PASS', async () => {
        const prisma = makePrisma({ items: answerAllExcept({ [CRITICAL_CODES[0]]: 'FAIL' }) });

        await expect(gate({ prisma }))
            .rejects.toMatchObject({ code: 'CRITICAL_CHECKLIST_FAILURE' });
    });

    test('the refusal names how many critical items failed, so the operator can find them', async () => {
        const prisma = makePrisma({
            items: answerAllExcept({ [CRITICAL_CODES[0]]: 'FAIL', [CRITICAL_CODES[1]]: 'FAIL' }),
        });

        await expect(gate({ prisma }))
            .rejects.toThrow(new RegExp(`2 of ${CRITICAL_CODES.length} critical checklist items`));
    });

    test('a NON-critical FAIL still mints — the documented rule is about CRITICAL items', async () => {
        const nonCritical = TEMPLATE.find((t) => t.isCritical !== true).itemCode;
        const prisma = makePrisma({ items: answerAllExcept({ [nonCritical]: 'FAIL' }) });

        // Deliberate boundary: audit-onsite-service.js:159 says a single FAIL on
        // a CRITICAL item forces overall FAIL. Scoring the rest is the auditor's
        // judgement, and the gate must not quietly become the decision.
        await expect(gate({ prisma })).resolves.toMatchObject({ auditId: AUDIT_A.id });
    });

    test('NA on a critical item is not FAIL, so it does not block', async () => {
        const prisma = makePrisma({ items: answerAllExcept({ [CRITICAL_CODES[0]]: 'NA' }) });

        await expect(gate({ prisma })).resolves.toMatchObject({ auditId: AUDIT_A.id });
    });
});

describe('a row is not an answer', () => {
    test('rows carrying no recognised verdict are INCOMPLETE_CHECKLIST, not a completed checklist', async () => {
        // response is a plain String column (no enum), so a writer other than
        // submitChecklistItem can leave it blank. A full set of blank rows used
        // to count as a full set of answers.
        const prisma = makePrisma({ items: answerAll('') });

        await expect(gate({ prisma }))
            .rejects.toMatchObject({ code: 'INCOMPLETE_CHECKLIST' });
    });

    test('an unanswered item is not evidence: one blank row leaves the checklist short', async () => {
        const prisma = makePrisma({ items: answerAllExcept({ [TEMPLATE[0].itemCode]: 'PENDING' }) });

        await expect(gate({ prisma }))
            .rejects.toThrow(new RegExp(`${TEMPLATE.length} checklist items required \\(got ${TEMPLATE.length - 1} answered\\)`));
    });

    test('rows for itemCodes outside the template do not pad the total', async () => {
        const half = answerAll('PASS').slice(0, 3);
        const padding = Array.from({ length: TEMPLATE.length }, (_, i) => ({
            auditId: AUDIT_A.id, itemCode: `not-in-template-${i}`, response: 'PASS', isCritical: false,
        }));
        const prisma = makePrisma({ items: [...half, ...padding] });

        await expect(gate({ prisma }))
            .rejects.toMatchObject({ code: 'INCOMPLETE_CHECKLIST' });
    });
});

describe('the unbound call is closed', () => {
    test('a caller supplying only an auditId is refused before any lookup happens', async () => {
        const prisma = makePrisma({ items: answerAll('PASS', AUDIT_A.id) });

        await expect(assertOnsiteEvidenceSufficient({ prisma, auditId: AUDIT_A.id }))
            .rejects.toThrow(TypeError);
        // Fail-closed means it never got as far as resolving the pin: an
        // auditId-only call used to reach the pinned lookup with no
        // applicationId in the `where`, which is the whole hole.
        expect(prisma.auditChecklist.findFirst).not.toHaveBeenCalled();
        expect(prisma.farmAuditChecklistItem.count).not.toHaveBeenCalled();
    });

    test('an auditId-only call cannot borrow ANOTHER application\'s fully-evidenced audit', async () => {
        // app-B's audit is perfect. Before this fix, a caller minting for app-A
        // could pass audit-B alone and the gate answered yes.
        const prisma = makePrisma({ items: answerAll('PASS', AUDIT_B.id) });

        await expect(assertOnsiteEvidenceSufficient({ prisma, auditId: AUDIT_B.id }))
            .rejects.toThrow(/applicationId required/);
    });

    test('naming the application still catches the borrowed pin (AUDIT_APPLICATION_MISMATCH)', async () => {
        const prisma = makePrisma({ items: answerAll('PASS', AUDIT_B.id) });

        await expect(assertOnsiteEvidenceSufficient({
            prisma,
            applicationId: AUDIT_A.applicationId,
            auditId: AUDIT_B.id,
        })).rejects.toMatchObject({ code: 'AUDIT_APPLICATION_MISMATCH' });
    });
});

describe('the legitimate path still mints', () => {
    test('a completed, passing inspection with enough distinct photos resolves', async () => {
        const prisma = makePrisma({ items: answerAll('PASS') });

        await expect(gate({ prisma })).resolves.toEqual({
            auditId: AUDIT_A.id,
            photoCount: MIN_PHOTOS,
            itemCount: TEMPLATE.length,
        });
    });

    test('and so does the unpinned resolve-from-application path', async () => {
        const prisma = makePrisma({ items: answerAll('PASS') });

        await expect(assertOnsiteEvidenceSufficient({ prisma, applicationId: AUDIT_A.applicationId }))
            .resolves.toMatchObject({ auditId: AUDIT_A.id, itemCount: TEMPLATE.length });
    });
});
