'use strict';
/**
 * Acceptance freezes what the applicant saw (F-G4-64 R2, spec 3.2).
 *
 * The snapshot is built from the STORED ROW, never from a live fee
 * calculation: channel C in synthesis.md 3.3 is precisely that the rate table
 * has no effective date, so a recompute renders a different document from the
 * one the row holds. A snapshot that recomputes proves nothing at all.
 */
const crypto = require('crypto');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});
const mockQuotationUpdate = jest.fn();
const mockQuotationFindFirst = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        quotation: {
            findFirst: (...a) => mockQuotationFindFirst(...a),
            update: (...a) => mockQuotationUpdate(...a),
        },
    },
}));

const quotationService = require('../../services/quotation-service');
const { buildAcceptanceSnapshot, canonicalSnapshotHash } = quotationService._internals;

/** QT-PRD-2026-000001 exactly as the register holds it (register.md B). */
const ROW = {
    id: 'qt-1',
    quotationNumber: 'QT-PRD-2026-000001',
    issuerType: 'PLATFORM',
    status: 'PENDING',
    subtotal: '33000.00',
    vat: '2310.00',
    totalAmount: '35310.00',
    validUntil: new Date('2026-09-24T00:00:00.000Z'),
    installments: [
        { phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
        { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
    ],
};

/**
 * Fix round 1 (reviewer F1/F2). A PRE-W14 application carries TWO rows, and
 * `_buildInstallments` before commit 6248a0d1 gave both of them the IDENTICAL
 * full-phase split — only `amount` is issuer-specific (DTAM = state, PLATFORM =
 * platform + VAT). A snapshot built from the split alone therefore freezes the
 * WHOLE price on each of the two documents, and each frozen document then
 * contradicts its own totalAmount.
 */
const PRE_W14_DTAM = {
    id: 'qt-dtam',
    quotationNumber: 'QT-DTAM-2026-000007',
    issuerType: 'DTAM',
    status: 'PENDING',
    subtotal: '30000.00',
    vat: '0.00',
    totalAmount: '30000.00',
    installments: [
        { phase: 'PHASE_1', amount: 5000, serviceFeeAmount: 5500, vatAmount: 35, scopeCount: 1 },
        { phase: 'PHASE_2', amount: 25000, serviceFeeAmount: 27500, vatAmount: 175, scopeCount: 1 },
    ],
};

const PRE_W14_PLATFORM = {
    ...PRE_W14_DTAM,
    id: 'qt-plat',
    quotationNumber: 'QT-PRD-2026-000007',
    issuerType: 'PLATFORM',
    subtotal: '3000.00',
    vat: '210.00',
    totalAmount: '3210.00',
    installments: [
        { phase: 'PHASE_1', amount: 535, serviceFeeAmount: 5500, vatAmount: 35, scopeCount: 1 },
        { phase: 'PHASE_2', amount: 2675, serviceFeeAmount: 27500, vatAmount: 175, scopeCount: 1 },
    ],
};

/** The row class GAP-5 replaced: `{phase, amount}` and nothing else. */
const PRE_GAP5 = {
    ...ROW,
    id: 'qt-legacy',
    installments: [
        { phase: 'PHASE_1', amount: 5535 },
        { phase: 'PHASE_2', amount: 27675 },
    ],
};

const AT = new Date('2026-08-28T03:00:00.000Z');

describe('buildAcceptanceSnapshot — the row, and only the row', () => {
    it('carries every instalment with a 2-decimal string per money field', () => {
        const s = buildAcceptanceSnapshot(ROW, { renderedAt: AT });
        expect(s.quotationNumber).toBe('QT-PRD-2026-000001');
        expect(s.issuerType).toBe('PLATFORM');
        expect(s.currency).toBe('THB');
        expect(s.scopeCount).toBe(1);
        // `stateAmount` / `platformAmount` were frozen here until 2026-09-11.
        // The operator retired the split, so a snapshot carrying them would be
        // freezing a decomposition the system can no longer produce — and an
        // acceptance record is evidence, so it may only contain figures that
        // are true when it is written. ค่าบริการ + VAT is the whole document now.
        expect(s.installments).toEqual([
            { phase: 'PHASE_1', amount: '5885.00', serviceFeeAmount: '5500.00', vatAmount: '385.00', phaseTotal: '5885.00' },
            { phase: 'PHASE_2', amount: '29425.00', serviceFeeAmount: '27500.00', vatAmount: '1925.00', phaseTotal: '29425.00' },
        ]);
        expect(s.subtotal).toBe('33000.00');
        expect(s.vat).toBe('2310.00');
        expect(s.totalAmount).toBe('35310.00');
        expect(s.validUntil).toBe('2026-09-24T00:00:00.000Z');
        expect(s.renderedAt).toBe('2026-08-28T03:00:00.000Z');
    });

    it('reads no rate table: a row whose figures predate a rate change snapshots the OLD figures', () => {
        const old = { ...ROW, installments: [{ phase: 'PHASE_1', amount: 5535, serviceFeeAmount: 5500, vatAmount: 35, scopeCount: 1 },
            { phase: 'PHASE_2', amount: 27675, serviceFeeAmount: 27500, vatAmount: 175, scopeCount: 1 }] };
        const s = buildAcceptanceSnapshot(old, { renderedAt: AT });
        // The retired pre-W14 VAT base. If anything here recomputed, these would
        // come back 385 / 1,925 instead.
        expect(s.installments[0].vatAmount).toBe('35.00');
        expect(s.installments[1].vatAmount).toBe('175.00');
    });

    it('a renewal row (PHASE_2 only) snapshots one instalment, not two', () => {
        const renewal = { ...ROW, installments: [ROW.installments[1]] };
        expect(buildAcceptanceSnapshot(renewal, { renderedAt: AT }).installments).toHaveLength(1);
    });

    // ── Fix round 1 — F1: the frozen document must be THIS issuer's money ──

    it('freezes each pre-W14 side at ITS OWN amount, and the amounts sum to that row totalAmount', () => {
        const dtam = buildAcceptanceSnapshot(PRE_W14_DTAM, { renderedAt: AT });
        const platform = buildAcceptanceSnapshot(PRE_W14_PLATFORM, { renderedAt: AT });

        expect(dtam.installments.map((i) => i.amount)).toEqual(['5000.00', '25000.00']);
        expect(platform.installments.map((i) => i.amount)).toEqual(['535.00', '2675.00']);

        // The frozen figures must add up to the frozen total. Before this fix
        // both documents froze the full phase (5,535 + 27,675 = 33,210) under
        // totals of 30,000 and 3,210: an acceptance record that contradicts
        // itself the moment it is written, then hashed as evidence.
        const sum = (s) => s.installments.reduce((t, i) => t + Number(i.amount), 0).toFixed(2);
        expect(sum(dtam)).toBe(dtam.totalAmount);
        expect(sum(platform)).toBe(platform.totalAmount);
        expect(dtam.totalAmount).toBe('30000.00');
        expect(platform.totalAmount).toBe('3210.00');
    });

    it('keeps phaseTotal as the FULL phase, so the split is still recoverable from either side', () => {
        const platform = buildAcceptanceSnapshot(PRE_W14_PLATFORM, { renderedAt: AT });
        // `amount` is this side's slice (535); `phaseTotal` is the whole phase
        // the two pre-W14 rows priced between them, recovered from the row's own
        // ค่าบริการ + VAT. That is what "recoverable from either side" means now
        // that there is no stateAmount column to read it out of.
        expect(platform.installments[0].amount).toBe('535.00');
        expect(platform.installments[0].phaseTotal).toBe('5535.00');
        expect(platform.installments[0].serviceFeeAmount).toBe('5500.00');
        // …and the W14 single-issuer row prices the whole phase itself, so its
        // amount and its phaseTotal are the same number.
        const single = buildAcceptanceSnapshot(ROW, { renderedAt: AT });
        expect(single.installments[0].amount).toBe(single.installments[0].phaseTotal);
    });

    // ── Fix round 1 — F2: never freeze a document of zeros ──

    it('REFUSES a pre-GAP-5 row ({phase, amount} only) instead of freezing zeros', () => {
        expect(() => buildAcceptanceSnapshot(PRE_GAP5, { renderedAt: AT }))
            .toThrow(expect.objectContaining({ code: 'SNAPSHOT_REQUIRED' }));
    });

    it('REFUSES a row with no instalments at all', () => {
        expect(() => buildAcceptanceSnapshot({ ...ROW, installments: [] }, { renderedAt: AT }))
            .toThrow(expect.objectContaining({ code: 'SNAPSHOT_REQUIRED' }));
        expect(() => buildAcceptanceSnapshot({}, { renderedAt: AT }))
            .toThrow(expect.objectContaining({ code: 'SNAPSHOT_REQUIRED' }));
    });
});

describe('canonicalSnapshotHash', () => {
    it('is sha256 over key-sorted JSON, so key order cannot change the hash', () => {
        const a = { b: '2.00', a: '1.00', nested: { y: 2, x: 1 } };
        const b = { a: '1.00', nested: { x: 1, y: 2 }, b: '2.00' };
        expect(canonicalSnapshotHash(a)).toBe(canonicalSnapshotHash(b));
        expect(canonicalSnapshotHash(a)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes when one satang changes', () => {
        const s = buildAcceptanceSnapshot(ROW, { renderedAt: AT });
        const drifted = JSON.parse(JSON.stringify(s));
        drifted.installments[0].phaseTotal = '5885.01';
        expect(canonicalSnapshotHash(drifted)).not.toBe(canonicalSnapshotHash(s));
    });

    it('matches an independently computed sha256 of the canonical form', () => {
        const s = { b: '2.00', a: '1.00' };
        const expected = crypto.createHash('sha256')
            .update(JSON.stringify({ a: '1.00', b: '2.00' })).digest('hex');
        expect(canonicalSnapshotHash(s)).toBe(expected);
    });
});

describe('markQuotationAccepted — records the actor, the instant, the snapshot and its hash', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockQuotationFindFirst.mockResolvedValue({ ...ROW });
        mockQuotationUpdate.mockImplementation(async ({ data }) => ({ ...ROW, ...data }));
    });

    it('writes acceptedSnapshot, acceptedSnapshotHash, acceptedBy and acceptedAt', async () => {
        const snapshot = buildAcceptanceSnapshot(ROW, { renderedAt: AT });
        await quotationService.markQuotationAccepted('qt-1', {
            acceptedBy: 'user-1', acceptedAt: AT, snapshot,
        });
        const { data } = mockQuotationUpdate.mock.calls[0][0];
        expect(data.status).toBe('ACCEPTED');
        expect(data.acceptedAt).toBe(AT);
        expect(data.acceptedBy).toBe('user-1');
        // updatedBy keeps its old meaning too — existing readers are unchanged.
        expect(data.updatedBy).toBe('user-1');
        expect(data.acceptedSnapshot).toEqual(snapshot);
        expect(data.acceptedSnapshotHash).toBe(canonicalSnapshotHash(snapshot));
    });

    it('refuses to record an acceptance with no snapshot: an acceptance of nothing is not evidence', async () => {
        await expect(quotationService.markQuotationAccepted('qt-1', { acceptedBy: 'user-1' }))
            .rejects.toMatchObject({ code: 'SNAPSHOT_REQUIRED' });
        expect(mockQuotationUpdate).not.toHaveBeenCalled();
    });

    it('an already-ACCEPTED row is still an idempotent no-op and its snapshot is NOT overwritten', async () => {
        const frozen = buildAcceptanceSnapshot(ROW, { renderedAt: AT });
        mockQuotationFindFirst.mockResolvedValue({
            ...ROW, status: 'ACCEPTED', acceptedSnapshot: frozen, acceptedSnapshotHash: canonicalSnapshotHash(frozen),
        });
        const out = await quotationService.markQuotationAccepted('qt-1', {
            acceptedBy: 'user-2', snapshot: buildAcceptanceSnapshot(ROW, { renderedAt: new Date() }),
        });
        expect(mockQuotationUpdate).not.toHaveBeenCalled();
        expect(out.acceptedSnapshotHash).toBe(canonicalSnapshotHash(frozen));
    });
});
