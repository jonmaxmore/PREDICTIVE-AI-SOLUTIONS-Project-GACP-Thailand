/**
 * Tests for period-close-service (Iter 24, 2026-05-16).
 *
 * Anchors:
 *   - closePeriod: validates future month rejected
 *   - closePeriod: validates pending-invoice present → error
 *   - closePeriod: creates PeriodClose row + audit log
 *   - reopenPeriod: ADMIN-only + reason required
 *   - reopenPeriod: closer cannot reopen (separation of duties)
 *   - isPeriodClosed: returns true for CLOSED + false for REOPENED/OPEN
 *   - getPeriodCloseStatus: returns array
 */

'use strict';

const createPrismaMock = () => {
    const store = new Map();
    let counter = 0;

    const periodCloseModel = {
        create: jest.fn(async ({ data }) => {
            counter += 1;
            const row = {
                id: `pc-${counter}`,
                ...data,
                closedAt: data.closedAt || new Date(),
                reopenedAt: null,
                reopenedBy: null,
                reopenReason: null,
            };
            store.set(row.id, row);
            return row;
        }),
        findFirst: jest.fn(async ({ where }) => {
            const rows = Array.from(store.values()).filter((row) => {
                if (where.organizationId && row.organizationId !== where.organizationId) {return false;}
                if (where.year !== undefined && row.year !== where.year) {return false;}
                if (where.month !== undefined && row.month !== where.month) {return false;}
                if (where.status && row.status !== where.status) {return false;}
                return true;
            });
            return rows[0] || null;
        }),
        findUnique: jest.fn(async ({ where: { id } }) => store.get(id) || null),
        findMany: jest.fn(async ({ where = {} } = {}) => {
            return Array.from(store.values()).filter((row) => {
                if (where.organizationId && row.organizationId !== where.organizationId) {return false;}
                if (where.year && typeof where.year === 'object') {
                    if (where.year.gte && row.year < where.year.gte) {return false;}
                    if (where.year.lte && row.year > where.year.lte) {return false;}
                }
                return true;
            });
        }),
        update: jest.fn(async ({ where: { id }, data }) => {
            const existing = store.get(id);
            if (!existing) {throw new Error('not found');}
            const updated = { ...existing, ...data };
            store.set(id, updated);
            return updated;
        }),
    };

    const prisma = {
        periodClose: periodCloseModel,
        $transaction: jest.fn(async (cb) => cb({ periodClose: periodCloseModel })),
    };
    return { prisma, store };
};

function loadServiceWithMocks({ prismaObj, vatStub, auditStub }) {
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaObj.prisma }));
    jest.doMock('../../services/vat-report-service', () => vatStub);
    jest.doMock('../../middleware/audit-logger', () => auditStub);
    return require('../../services/period-close-service');
}

const makeVatStub = (closable = true, openInvoices = 0) => ({
    checkPeriodClosable: jest.fn(async () => ({
        closable,
        openInvoices,
        lastPaidInvoiceDate: null,
        warnings: closable ? [] : [`${openInvoices} pending invoices`],
    })),
});

const makeAuditStub = () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(null) },
    AuditCategory: { PAYMENT: 'PAYMENT', SYSTEM: 'SYSTEM' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { SYSTEM: 'SYSTEM' },
});

// We use 2026-05-16 as "today" (per the iteration brief). Picking a
// last-elapsed month: April 2026 (m=4) → fully past. Picking the current
// month: May 2026 (m=5) → not yet elapsed (rejected by FUTURE_PERIOD).
const TODAY = new Date('2026-05-16T00:00:00Z');

describe('[Iter 24] period-close-service', () => {
    beforeAll(() => {
        // Freeze "now" so isMonthFullyElapsed is deterministic. Modern
        // fake timers replace `new Date()` with the simulated time;
        // `Date.UTC(...)` and `new Date(arg)` still work normally.
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        jest.setSystemTime(TODAY);
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        // Re-pin the simulated clock every test. `resetModules()` +
        // `clearAllMocks()` can drop the @sinonjs fake-timer system time set in
        // beforeAll, so a later test's default `new Date()` silently falls back
        // to the real wall-clock. That made `closePeriod({ month: 5 })` flip
        // from FUTURE_PERIOD (correct under frozen May 16 2026) to a successful
        // close once the real date crossed June 1 — a date-dependent flake, not
        // a product bug. Re-freezing here keeps every test deterministic.
        jest.setSystemTime(TODAY);
    });

    describe('_internals.isMonthFullyElapsed', () => {
        test('returns true for April 2026 when now is May 16 2026', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            expect(service._internals.isMonthFullyElapsed(2026, 4, TODAY)).toBe(true);
        });

        test('returns false for May 2026 (current month)', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            expect(service._internals.isMonthFullyElapsed(2026, 5, TODAY)).toBe(false);
        });

        test('returns false for June 2026 (future month)', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            expect(service._internals.isMonthFullyElapsed(2026, 6, TODAY)).toBe(false);
        });
    });

    describe('closePeriod', () => {
        test('rejects future month with FUTURE_PERIOD', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            try {
                await service.closePeriod({
                    year: 2026, month: 6,
                    organizationId: 'org-1',
                    actorId: 'user-closer',
                });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('FUTURE_PERIOD');
            }
        });

        test('rejects current (not-yet-elapsed) month', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            try {
                await service.closePeriod({
                    year: 2026, month: 5,
                    organizationId: 'org-1',
                    actorId: 'user-closer',
                });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('FUTURE_PERIOD');
            }
        });

        test('rejects when pending invoices exist in period', async () => {
            const prismaObj = createPrismaMock();
            const vatStub = makeVatStub(false, 3);
            const service = loadServiceWithMocks({
                prismaObj, vatStub, auditStub: makeAuditStub(),
            });
            try {
                await service.closePeriod({
                    year: 2026, month: 4,
                    organizationId: 'org-1',
                    actorId: 'user-closer',
                });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('PENDING_INVOICES_IN_PERIOD');
                expect(err.openInvoices).toBe(3);
            }
            expect(vatStub.checkPeriodClosable).toHaveBeenCalledWith({
                year: 2026, month: 4, organizationId: 'org-1',
            });
        });

        test('creates a PeriodClose row with status=CLOSED and audit log', async () => {
            const prismaObj = createPrismaMock();
            const auditStub = makeAuditStub();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub,
            });

            const result = await service.closePeriod({
                year: 2026, month: 4,
                organizationId: 'org-1',
                actorId: 'user-closer',
                notes: 'May 1 close',
            });

            expect(result.id).toBeTruthy();
            expect(result.year).toBe(2026);
            expect(result.month).toBe(4);
            expect(result.status).toBe('CLOSED');

            // Persistence
            expect(prismaObj.prisma.periodClose.create).toHaveBeenCalledTimes(1);
            const createCall = prismaObj.prisma.periodClose.create.mock.calls[0][0];
            expect(createCall.data.status).toBe('CLOSED');
            expect(createCall.data.closedBy).toBe('user-closer');
            expect(createCall.data.organizationId).toBe('org-1');

            // Audit log fired
            expect(auditStub.auditLogger.log).toHaveBeenCalledTimes(1);
            const auditCall = auditStub.auditLogger.log.mock.calls[0][0];
            expect(auditCall.action).toBe('PERIOD_CLOSED');
            expect(auditCall.actorId).toBe('user-closer');
        });

        test('rejects ALREADY_CLOSED when a CLOSED row exists', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            // First close
            await service.closePeriod({
                year: 2026, month: 4,
                organizationId: 'org-1',
                actorId: 'user-closer',
            });
            // Second close on the same period — must fail
            try {
                await service.closePeriod({
                    year: 2026, month: 4,
                    organizationId: 'org-1',
                    actorId: 'user-closer',
                });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('ALREADY_CLOSED');
            }
        });

        test('rejects missing organizationId / actorId', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            await expect(service.closePeriod({
                year: 2026, month: 4, actorId: 'u1',
            })).rejects.toThrow(/organizationId is required/);
            await expect(service.closePeriod({
                year: 2026, month: 4, organizationId: 'org-1',
            })).rejects.toThrow(/actorId is required/);
        });
    });

    describe('reopenPeriod — separation of duties', () => {
        test('flips CLOSED → REOPENED when reopener != closer + records reason', async () => {
            const prismaObj = createPrismaMock();
            const auditStub = makeAuditStub();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub,
            });

            const closed = await service.closePeriod({
                year: 2026, month: 4,
                organizationId: 'org-1',
                actorId: 'user-closer',
            });

            const reopened = await service.reopenPeriod(closed.id, {
                reason: 'Audit finding requires reopen',
                actorId: 'user-admin-different',
            });
            expect(reopened.status).toBe('REOPENED');
            expect(reopened.reopenedBy).toBe('user-admin-different');
            expect(reopened.reopenReason).toBe('Audit finding requires reopen');
            expect(reopened.reopenedAt).toBeInstanceOf(Date);

            // Audit log fired with WARNING severity
            const auditCalls = auditStub.auditLogger.log.mock.calls;
            const reopenedAudit = auditCalls.find((c) => c[0].action === 'PERIOD_REOPENED');
            expect(reopenedAudit).toBeTruthy();
            expect(reopenedAudit[0].severity).toBe('WARNING');
        });

        test('REJECTS SELF_REOPEN_FORBIDDEN when reopener === closer', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });

            const closed = await service.closePeriod({
                year: 2026, month: 4,
                organizationId: 'org-1',
                actorId: 'user-closer',
            });
            try {
                await service.reopenPeriod(closed.id, {
                    reason: 'Self-reopen attempt',
                    actorId: 'user-closer',
                });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('SELF_REOPEN_FORBIDDEN');
            }
        });

        test('rejects when reason is missing or < 10 chars', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            const closed = await service.closePeriod({
                year: 2026, month: 4,
                organizationId: 'org-1',
                actorId: 'user-closer',
            });
            await expect(service.reopenPeriod(closed.id, {
                reason: 'short',
                actorId: 'user-admin',
            })).rejects.toThrow(/at least 10 characters/);
            await expect(service.reopenPeriod(closed.id, {
                actorId: 'user-admin',
            })).rejects.toThrow(/reason is required/);
        });

        test('rejects reopen from REOPENED status (INVALID_STATE)', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            const closed = await service.closePeriod({
                year: 2026, month: 4,
                organizationId: 'org-1',
                actorId: 'user-closer',
            });
            await service.reopenPeriod(closed.id, {
                reason: 'first reopen reason',
                actorId: 'user-admin',
            });
            try {
                await service.reopenPeriod(closed.id, {
                    reason: 'second reopen attempt',
                    actorId: 'user-admin-2',
                });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('INVALID_STATE');
            }
        });

        test('rejects when PeriodClose not found', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            try {
                await service.reopenPeriod('does-not-exist', {
                    reason: 'reopen not found row',
                    actorId: 'u-admin',
                });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('NOT_FOUND');
            }
        });
    });

    describe('isPeriodClosed', () => {
        test('returns true when a CLOSED row exists', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            await service.closePeriod({
                year: 2026, month: 4,
                organizationId: 'org-1',
                actorId: 'user-closer',
            });
            const closed = await service.isPeriodClosed({
                year: 2026, month: 4, organizationId: 'org-1',
            });
            expect(closed).toBe(true);
        });

        test('returns false when row is REOPENED', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            const closed = await service.closePeriod({
                year: 2026, month: 4,
                organizationId: 'org-1',
                actorId: 'user-closer',
            });
            await service.reopenPeriod(closed.id, {
                reason: 'reopen for late posting',
                actorId: 'user-admin',
            });
            const isClosed = await service.isPeriodClosed({
                year: 2026, month: 4, organizationId: 'org-1',
            });
            expect(isClosed).toBe(false);
        });

        test('returns false when no row exists (OPEN by default)', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            const isClosed = await service.isPeriodClosed({
                year: 2026, month: 3, organizationId: 'org-1',
            });
            expect(isClosed).toBe(false);
        });

        test('returns false for invalid inputs (defensive)', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            expect(await service.isPeriodClosed({ year: 'bogus', month: 4 })).toBe(false);
            expect(await service.isPeriodClosed({})).toBe(false);
        });
    });

    describe('getPeriodCloseStatus', () => {
        test('returns array of records for the org', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            await service.closePeriod({
                year: 2026, month: 3,
                organizationId: 'org-1',
                actorId: 'user-closer',
            });
            await service.closePeriod({
                year: 2026, month: 4,
                organizationId: 'org-1',
                actorId: 'user-closer',
            });

            const records = await service.getPeriodCloseStatus({
                organizationId: 'org-1',
                fromYear: 2026,
                toYear: 2026,
            });
            expect(Array.isArray(records)).toBe(true);
            expect(records.length).toBe(2);
        });

        test('returns empty array when no records exist', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            const records = await service.getPeriodCloseStatus({ organizationId: 'org-empty' });
            expect(records).toEqual([]);
        });
    });

    describe('STATUS + ACTIONS exports', () => {
        test('exposes STATUS state-machine', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            expect(service.STATUS).toEqual({
                OPEN: 'OPEN',
                CLOSED: 'CLOSED',
                REOPENED: 'REOPENED',
            });
        });

        test('exposes ACTIONS for audit-logger', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks({
                prismaObj, vatStub: makeVatStub(), auditStub: makeAuditStub(),
            });
            expect(service.ACTIONS.CLOSED).toBe('PERIOD_CLOSED');
            expect(service.ACTIONS.REOPENED).toBe('PERIOD_REOPENED');
        });
    });
});
