/**
 * PDPA ม.30 — what an auditor wrote about a farmer is that farmer's own data.
 *
 * §5.2 of the T&T scope ruling settled this on 2026-09-05: *"อ้างอิงตามกฎหมาย PDPA ได้เลย"*
 * ⇒ ม.30 วรรคหนึ่ง gives the data subject the right to see and copy their personal data,
 * and an auditor's checklist answer and free-text `notes` about a farm are exactly that.
 *
 * Measured before this existed: the only door reading `farmAuditChecklistItem` was
 * routes/api/audit/onsite.js behind `requireRole(AUDIT_STAFF)`, so a farmer could not
 * reach a single row about their own farm. The right was decided and unusable.
 *
 * ม.30 วรรคสอง is the other half and the reason a plain read door would have been wrong:
 * the controller may refuse when the law or a court says so, or when disclosing would
 * affect ANOTHER person's rights and freedoms. That is a per-row judgement, so the switch
 * lives on the row — and a withheld row is SAID to be withheld, never silently dropped.
 * A farmer who cannot see a row must at least learn that a row exists and was withheld,
 * or the right to access becomes unauditable.
 */
'use strict';

const {
    listAuditNotesForApplicant,
    setNoteDisclosure,
    WITHHOLD_REASON_MIN,
} = require('../../services/audit-notes-disclosure');

const APP = 'app-1';
const HEALTH = 'health-1';
// Spec 2026-09-30 §3.1: the ownership check is the caller's holder scope.
const SCOPE = { userId: 'user-1', readIds: ['entity-1'], editIds: ['entity-1'] };

function itemRow(over = {}) {
    return {
        id: 'item-1',
        itemCode: 'GAP-1.1',
        section: 'บุคลากร',
        response: 'PASS',
        notes: 'ผู้ปฏิบัติงานผ่านการอบรมครบตามหลักสูตร',
        isCritical: false,
        recordedAt: new Date('2026-08-01T03:00:00.000Z'),
        disclosureWithheld: false,
        withholdReason: null,
        audit: { id: 'audit-1', applicationId: APP, submittedAt: new Date('2026-08-01T04:00:00.000Z') },
        ...over,
    };
}

// Who may decide a disclosure is covered in audit-notes-disclosure-authz.test.js; these
// tests are about what the decision records, so they act as the DTAM admin.
const ADMIN = { id: 'officer-1', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam' };

function prismaWith(items, { application = { id: APP, healthId: HEALTH } } = {}) {
    return {
        application: { findFirst: jest.fn(async () => application) },
        farmAuditChecklistItem: {
            findMany: jest.fn(async () => items),
            findUnique: jest.fn(async () => items[0] || null),
            update: jest.fn(async ({ data }) => ({ ...items[0], ...data })),
        },
    };
}

describe('the farmer reads what was written about them', () => {
    test('a disclosed note comes through in full', async () => {
        const prisma = prismaWith([itemRow()]);
        const out = await listAuditNotesForApplicant({ prisma, applicationId: APP, holderScope: SCOPE, healthId: HEALTH });

        expect(out.items).toHaveLength(1);
        expect(out.items[0]).toMatchObject({
            itemCode: 'GAP-1.1',
            section: 'บุคลากร',
            response: 'PASS',
            notes: 'ผู้ปฏิบัติงานผ่านการอบรมครบตามหลักสูตร',
            withheld: false,
        });
    });

    test('the read is scoped to the applicant — another filing is not theirs to read', async () => {
        const prisma = prismaWith([itemRow()], { application: null });
        await expect(listAuditNotesForApplicant({ prisma, applicationId: APP, holderScope: { userId: 'user-other', readIds: [], editIds: [] } }))
            .rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND', statusCode: 404 });
        // 404, not 403: confirming a filing exists to someone who may not read it is itself
        // a disclosure.
        expect(prisma.farmAuditChecklistItem.findMany).not.toHaveBeenCalled();
    });

    test('the query asks the database for THIS applicant\'s holders, not for everything', async () => {
        const prisma = prismaWith([itemRow()]);
        await listAuditNotesForApplicant({ prisma, applicationId: APP, holderScope: SCOPE, healthId: HEALTH });
        expect(prisma.application.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            // R1: OR [holder fragment, the pre-R1 healthId pin] and the pin as the AND member
            // (r1ApplicationHolderOrPin, final review C1). Task 12: the fragment alone.
            where: expect.objectContaining({
                id: APP,
                OR: [expect.objectContaining({ entityId: { in: SCOPE.readIds } }), expect.objectContaining({ healthId: HEALTH })],
                AND: [{ healthId: HEALTH }],
            }),
        }));
    });
});

describe('a withheld note is declared, not hidden', () => {
    const withheld = itemRow({
        disclosureWithheld: true,
        withholdReason: 'บันทึกนี้อ้างถึงบุคคลที่สามซึ่งไม่ได้ยินยอมให้เปิดเผย',
    });

    test('the row still appears, and says it was withheld', async () => {
        const prisma = prismaWith([withheld]);
        const out = await listAuditNotesForApplicant({ prisma, applicationId: APP, holderScope: SCOPE, healthId: HEALTH });

        expect(out.items).toHaveLength(1);
        expect(out.items[0].withheld).toBe(true);
        // The item's own identity is NOT the withheld part — the applicant still learns
        // which criterion was judged and what the verdict was.
        expect(out.items[0].itemCode).toBe('GAP-1.1');
        expect(out.items[0].response).toBe('PASS');
    });

    test('the free text does not travel, and no field smuggles it out', async () => {
        const prisma = prismaWith([withheld]);
        const out = await listAuditNotesForApplicant({ prisma, applicationId: APP, holderScope: SCOPE, healthId: HEALTH });

        expect(out.items[0].notes).toBeNull();
        expect(JSON.stringify(out)).not.toContain('ผู้ปฏิบัติงานผ่านการอบรม');
    });

    test('the applicant is told WHY, because ม.30 วรรคสอง has to be justifiable', async () => {
        const prisma = prismaWith([withheld]);
        const out = await listAuditNotesForApplicant({ prisma, applicationId: APP, holderScope: SCOPE, healthId: HEALTH });
        expect(out.items[0].withholdReason).toBe('บันทึกนี้อ้างถึงบุคคลที่สามซึ่งไม่ได้ยินยอมให้เปิดเผย');
    });

    test('the summary counts what was withheld so the total is never quietly short', async () => {
        const prisma = prismaWith([itemRow(), withheld, itemRow({ id: 'item-3' })]);
        const out = await listAuditNotesForApplicant({ prisma, applicationId: APP, holderScope: SCOPE, healthId: HEALTH });
        expect(out.total).toBe(3);
        expect(out.withheldCount).toBe(1);
    });
});

describe('withholding is an act with a name on it', () => {
    test('a reason is required, and a token one is not a reason', async () => {
        const prisma = prismaWith([itemRow()]);
        await expect(setNoteDisclosure({
            prisma, itemId: 'item-1', withheld: true, reason: 'ไม่ให้', actorId: 'officer-1', actor: ADMIN,
        })).rejects.toMatchObject({ code: 'WITHHOLD_REASON_REQUIRED', statusCode: 422 });
        expect(prisma.farmAuditChecklistItem.update).not.toHaveBeenCalled();
        expect(WITHHOLD_REASON_MIN).toBeGreaterThanOrEqual(10);
    });

    test('withholding records who did it and when', async () => {
        const prisma = prismaWith([itemRow()]);
        await setNoteDisclosure({
            prisma,
            itemId: 'item-1',
            withheld: true,
            reason: 'บันทึกนี้อ้างถึงบุคคลที่สามซึ่งไม่ได้ยินยอมให้เปิดเผย',
            actorId: 'officer-1',
            actor: ADMIN,
        });
        const { data } = prisma.farmAuditChecklistItem.update.mock.calls[0][0];
        expect(data).toMatchObject({ disclosureWithheld: true, withheldBy: 'officer-1' });
        expect(data.withheldAt).toBeInstanceOf(Date);
        expect(data.withholdReason).toContain('บุคคลที่สาม');
    });

    test('disclosing again clears the refusal instead of leaving a stale reason behind', async () => {
        const prisma = prismaWith([itemRow({ disclosureWithheld: true, withholdReason: 'เหตุผลเดิม' })]);
        await setNoteDisclosure({ prisma, itemId: 'item-1', withheld: false, actorId: 'officer-1', actor: ADMIN });
        const { data } = prisma.farmAuditChecklistItem.update.mock.calls[0][0];
        expect(data).toMatchObject({
            disclosureWithheld: false, withholdReason: null, withheldBy: null, withheldAt: null,
        });
    });

    test('an item nobody has is a 404, not a silent no-op', async () => {
        const prisma = prismaWith([]);
        prisma.farmAuditChecklistItem.findUnique = jest.fn(async () => null);
        await expect(setNoteDisclosure({
            prisma, itemId: 'nope', withheld: false, actorId: 'officer-1',
        })).rejects.toMatchObject({ code: 'CHECKLIST_ITEM_NOT_FOUND', statusCode: 404 });
    });
});
