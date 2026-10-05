'use strict';

const { resolveCurrentOnsiteAuditId } = require('../../services/onsite-audit-resolver');

function makePrisma(rows) {
    return {
        auditChecklist: {
            findFirst: jest.fn(async ({ where, orderBy }) => {
                let matches = rows.filter((r) =>
                    r.applicationId === where.applicationId
                    && r.isDeleted === where.isDeleted
                    && (where.organizationId === undefined || r.organizationId === where.organizationId)
                    && (where.status === undefined || r.status === where.status));
                if (orderBy?.createdAt === 'desc') {
                    matches = [...matches].sort((a, b) => b.createdAt - a.createdAt);
                }
                const row = matches[0];
                return row ? { id: row.id } : null;
            }),
        },
    };
}

describe('resolveCurrentOnsiteAuditId', () => {
    const R = (over) => ({ isDeleted: false, status: 'IN_PROGRESS', organizationId: 'org-1', createdAt: 1, ...over });

    test('returns null when no row exists', async () => {
        expect(await resolveCurrentOnsiteAuditId(makePrisma([]), 'app-1')).toBeNull();
    });

    test('prefers an IN_PROGRESS row over a newer COMPLETED one', async () => {
        const prisma = makePrisma([
            R({ id: 'a-inprog', applicationId: 'app-1', status: 'IN_PROGRESS', createdAt: 1 }),
            R({ id: 'a-done', applicationId: 'app-1', status: 'COMPLETED', createdAt: 5 }),
        ]);
        expect(await resolveCurrentOnsiteAuditId(prisma, 'app-1')).toBe('a-inprog');
    });

    test('falls back to the most-recent row of any status when none IN_PROGRESS', async () => {
        const prisma = makePrisma([
            R({ id: 'a-old', applicationId: 'app-1', status: 'COMPLETED', createdAt: 1 }),
            R({ id: 'a-new', applicationId: 'app-1', status: 'COMPLETED', createdAt: 9 }),
        ]);
        expect(await resolveCurrentOnsiteAuditId(prisma, 'app-1')).toBe('a-new');
    });

    test('excludes soft-deleted rows (isDeleted:false always applied)', async () => {
        const prisma = makePrisma([R({ id: 'a-del', applicationId: 'app-1', isDeleted: true })]);
        expect(await resolveCurrentOnsiteAuditId(prisma, 'app-1')).toBeNull();
    });

    test('applies organizationId ONLY when supplied', async () => {
        const rows = [R({ id: 'a-org1', applicationId: 'app-1', organizationId: 'org-1' })];
        expect(await resolveCurrentOnsiteAuditId(makePrisma(rows), 'app-1', { organizationId: 'org-2' })).toBeNull();
        expect(await resolveCurrentOnsiteAuditId(makePrisma(rows), 'app-1')).toBe('a-org1');
    });
});
