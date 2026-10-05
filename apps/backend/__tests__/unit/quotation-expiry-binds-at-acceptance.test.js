'use strict';
/**
 * The validity window binds at the ACCEPTANCE door, and the applicant has a
 * remedy that the product actually delivers (F-G4-64 final round, R1).
 *
 * Before this suite the gate refused a still-unaccepted quotation past
 * `validUntil` (quotation-gate.js) while `markQuotationAccepted` looked only at
 * `status` — so an applicant who hit QUOTATION_EXPIRED pressed ยอมรับ on the
 * same screen, the row flipped to ACCEPTED, and the gate passed it. The window
 * was enforced only against applicants who did not press the button, and
 * nothing in the product ever wrote status EXPIRED.
 *
 * Two halves, and they are one change:
 *   1. the door refuses a lapsed offer (this is the rule);
 *   2. the read that follows re-issues, once, so the refusal has a next step
 *      the system performs itself (this is what makes the rule fair).
 *
 * The expired row is soft-deleted in the SAME transaction as the replacement,
 * because the partial unique index quotations_application_issuer_live_uq admits
 * exactly one live row per (applicationId, issuerType).
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

let mockPrisma;
jest.mock('../../services/prisma-database', () => ({
    get prisma() { return mockPrisma; },
}));

const quotationService = require('../../services/quotation-service');

const NOW = new Date('2026-08-29T09:00:00.000Z');
const LAPSED = new Date('2026-07-15T00:00:00.000Z');
const STILL_VALID = new Date('2026-09-20T00:00:00.000Z');

const INSTALMENTS = [
    { phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
    { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
];

function row(over = {}) {
    return {
        id: 'qt-1',
        applicationId: 'app-1',
        quotationNumber: 'QT-PRD-2026-000001',
        issuerType: 'PLATFORM',
        status: 'PENDING',
        isDeleted: false,
        subtotal: '33000.00',
        vat: '2310.00',
        totalAmount: '35310.00',
        installments: INSTALMENTS,
        validUntil: STILL_VALID,
        ...over,
    };
}

function stubPrisma(seed) {
    return {
        quotation: {
            findFirst: jest.fn(async () => (seed ? { ...seed } : null)),
            update: jest.fn(async ({ data }) => ({ ...seed, ...data })),
        },
    };
}

describe('markQuotationAccepted refuses a lapsed offer', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each(['PENDING', 'SENT', 'DRAFT'])(
        'a %s row whose validUntil has passed is QUOTATION_EXPIRED, and nothing is written',
        async (status) => {
            mockPrisma = stubPrisma(row({ status, validUntil: LAPSED }));
            const snapshot = quotationService.buildAcceptanceSnapshot(row(), { renderedAt: NOW });

            await expect(quotationService.markQuotationAccepted('qt-1', {
                acceptedBy: 'user-1', acceptedAt: NOW, snapshot,
            })).rejects.toMatchObject({ code: 'QUOTATION_EXPIRED' });

            expect(mockPrisma.quotation.update).not.toHaveBeenCalled();
        },
    );

    it('a row still inside its window is accepted normally', async () => {
        mockPrisma = stubPrisma(row());
        const snapshot = quotationService.buildAcceptanceSnapshot(row(), { renderedAt: NOW });

        const out = await quotationService.markQuotationAccepted('qt-1', {
            acceptedBy: 'user-1', acceptedAt: NOW, snapshot,
        });

        expect(out.status).toBe('ACCEPTED');
        expect(mockPrisma.quotation.update).toHaveBeenCalledTimes(1);
    });

    it('a row with no validUntil at all is accepted (a legacy row is not a lapsed one)', async () => {
        mockPrisma = stubPrisma(row({ validUntil: null }));
        const snapshot = quotationService.buildAcceptanceSnapshot(row(), { renderedAt: NOW });

        const out = await quotationService.markQuotationAccepted('qt-1', {
            acceptedBy: 'user-1', acceptedAt: NOW, snapshot,
        });

        expect(out.status).toBe('ACCEPTED');
    });

    it('an ALREADY-ACCEPTED lapsed row is still the idempotent no-op, not an expiry refusal', async () => {
        // An accepted quotation is an agreement, and agreements do not lapse
        // because the offer window closed — the same rule the gate applies.
        mockPrisma = stubPrisma(row({ status: 'ACCEPTED', validUntil: LAPSED }));
        const snapshot = quotationService.buildAcceptanceSnapshot(row(), { renderedAt: NOW });

        const out = await quotationService.markQuotationAccepted('qt-1', {
            acceptedBy: 'user-1', acceptedAt: NOW, snapshot,
        });

        expect(out.status).toBe('ACCEPTED');
        expect(mockPrisma.quotation.update).not.toHaveBeenCalled();
    });

    it('the refusal carries the catalogued code, so both rails read one vocabulary', async () => {
        const { ERROR_CODES } = require('../../shared/error-codes');
        mockPrisma = stubPrisma(row({ validUntil: LAPSED }));
        const snapshot = quotationService.buildAcceptanceSnapshot(row(), { renderedAt: NOW });

        const err = await quotationService.markQuotationAccepted('qt-1', {
            acceptedBy: 'user-1', acceptedAt: NOW, snapshot,
        }).catch((e) => e);

        expect(ERROR_CODES[err.code]).toBeDefined();
        expect(err.code).toBe('QUOTATION_EXPIRED');
    });
});

// ── The remedy: one transaction, one replacement ─────────────────────────────

/**
 * A prisma stand-in with the two writes this path needs, so the ORDER and the
 * ATOMICITY can be read off the call log: the soft-delete must be inside the
 * same $transaction callback as the create, or the partial unique index refuses
 * the replacement.
 */
function makeReissuePrisma(seedRow) {
    const rows = [{ ...seedRow }];
    const calls = [];
    const client = {
        __rows: rows,
        __calls: calls,
        application: {
            findUnique: jest.fn(async () => ({
                id: 'app-1',
                formData: { cultivationMethods: ['outdoor'] },
                cultivationScopeCount: 1,
                totalAreaTypes: 1,
                organizationId: 'org-1',
                isDeleted: false,
            })),
        },
        quotation: {
            findMany: jest.fn(async ({ where }) => rows.filter(
                (r) => r.applicationId === where.applicationId && !r.isDeleted,
            ).map((r) => ({ ...r }))),
            updateMany: jest.fn(async ({ where, data }) => {
                calls.push('updateMany');
                let count = 0;
                for (const r of rows) {
                    if (r.id === where.id && (where.isDeleted === undefined || r.isDeleted === where.isDeleted)) {
                        Object.assign(r, data);
                        count += 1;
                    }
                }
                return { count };
            }),
            create: jest.fn(async ({ data }) => {
                calls.push('create');
                const clash = rows.some((r) => !r.isDeleted
                    && r.applicationId === data.applicationId && r.issuerType === data.issuerType);
                if (clash) {
                    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
                }
                const created = { id: `qt-${rows.length + 1}`, isDeleted: false, createdAt: new Date(), ...data };
                rows.push(created);
                return { ...created };
            }),
        },
    };
    // No receiptSequence delegate — the QT allocator takes its documented
    // in-memory test fallback rather than a DB round trip.
    client.$transaction = jest.fn(async (cb) => {
        calls.push('tx:begin');
        // The handle a real interactive transaction hands back has no
        // $transaction of its own; modelling that is the point of this stub.
        const { $transaction: _unusedTx, ...handle } = client;
        const out = await cb(handle);
        calls.push('tx:commit');
        return out;
    });
    return client;
}

describe('reissueLapsedQuotation — the expired row and its replacement move together', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        quotationService._resetFallbackCountersForTest();
    });

    it('soft-deletes the lapsed row and issues the replacement inside ONE transaction', async () => {
        const lapsed = row({ status: 'PENDING', validUntil: LAPSED });
        mockPrisma = makeReissuePrisma(lapsed);

        const out = await quotationService.reissueLapsedQuotation('app-1', {
            lapsed, actorId: 'user-1', at: NOW,
        });

        // Both writes are inside the callback — begin, both writes, commit.
        expect(mockPrisma.__calls).toEqual(['tx:begin', 'updateMany', 'create', 'tx:commit']);

        const retired = mockPrisma.__rows.find((r) => r.id === 'qt-1');
        expect(retired.status).toBe('EXPIRED');
        expect(retired.isDeleted).toBe(true);
        expect(retired.deleteReason).toBe('EXPIRED_REISSUED');
        expect(retired.deletedAt).toBe(NOW);

        // The replacement says on its face what it replaced.
        expect(out.platform.notes).toBe('REISSUED_AFTER_EXPIRY:QT-PRD-2026-000001');
        expect(out.platform.status).toBe('PENDING');
        expect(out.platform.id).not.toBe('qt-1');
        expect(mockPrisma.__rows.filter((r) => !r.isDeleted)).toHaveLength(1);
    });

    it('prices the replacement from the fee calculator, never from the retired row', async () => {
        const lapsed = row({ status: 'PENDING', validUntil: LAPSED, totalAmount: '1.00' });
        mockPrisma = makeReissuePrisma(lapsed);

        const out = await quotationService.reissueLapsedQuotation('app-1', {
            lapsed, actorId: 'user-1', at: NOW,
        });

        expect(Number(out.platform.totalAmount)).toBeGreaterThan(1);
        expect(Array.isArray(out.platform.installments)).toBe(true);
    });
});

// ── The gate passes once the replacement is accepted ─────────────────────────

describe('the gate after a re-accept', () => {
    it('passes the replacement row and hands back its snapshot', async () => {
        jest.resetModules();
        jest.doMock('../../services/quotation-service', () => ({
            findQuotationsByApplicationId: jest.fn(async () => ({
                dtam: null,
                platform: {
                    id: 'qt-2',
                    issuerType: 'PLATFORM',
                    status: 'ACCEPTED',
                    // Accepted AFTER the replacement was issued, so the new
                    // window is open; and an accepted row never expires anyway.
                    validUntil: STILL_VALID,
                    notes: 'REISSUED_AFTER_EXPIRY:QT-PRD-2026-000001',
                    acceptedSnapshot: { installments: [{ phase: 'PHASE_1', phaseTotal: '5885.00' }] },
                },
            })),
        }));
        jest.doMock('../../shared/logger', () => {
            const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            return { ...l, createLogger: () => l };
        });
        const { assertQuotationAcceptedForPayment } = require('../../services/billing/quotation-gate');

        await expect(assertQuotationAcceptedForPayment({ applicationId: 'app-1', milestone: 'M1' }))
            .resolves.toMatchObject({
                phase: 'PHASE_1',
                quotation: { id: 'qt-2' },
                snapshot: { installments: [{ phase: 'PHASE_1', phaseTotal: '5885.00' }] },
            });
        jest.resetModules();
    });
});
