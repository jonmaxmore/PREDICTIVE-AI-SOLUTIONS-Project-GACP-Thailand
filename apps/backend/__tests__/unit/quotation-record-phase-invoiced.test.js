'use strict';
/**
 * recordPhaseInvoiced — the ONLY production writer of INVOICED (F-G4-64 §3.3,
 * coordinator ruling 10).
 *
 * settlement-closes-quotation.test.js (card rail) and
 * slip-approval-closes-quotation.test.js (transfer rail) prove that each rail
 * CALLS this function, after its commit, and survives it failing. Both mock the
 * function out, so none of the decisions the function itself makes are
 * exercised there:
 * which column a milestone stamps, whether the document is closed or only
 * stamped, and what happens to a row nobody ever accepted. Those decisions are
 * the money-relevant half — INVOICED is not an inert label, the slip gate
 * reads it as "the applicant accepted" (quotation-gate.js:45) — so they are
 * pinned here, with no database in the loop.
 *
 * These cases were written AFTER the implementation and are PINS, not a
 * red-to-green fix. Their bite is shown by mutation instead:
 * evidence/f-g4-64-task6/mutation-*.txt.
 */
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});

const rows = new Map();
const update = jest.fn(async ({ where, data }) => {
    const row = { ...rows.get(where.id), ...data };
    rows.set(where.id, row);
    return row;
});
/**
 * The guarded close (fix round 4, R4). It is an updateMany because the decision
 * "every instalment this document prices has now been billed" is taken by the
 * DATABASE against the row as it stands at that instant, not from the snapshot
 * this call read before it stamped. So this stub has to honour the WHERE the
 * production code sends: `not: null` on each priced phase column, and a status
 * still in the flippable set.
 */
const updateMany = jest.fn(async ({ where, data }) => {
    const row = rows.get(where.id);
    if (!row) { return { count: 0 }; }
    for (const [field, cond] of Object.entries(where)) {
        if (field === 'id') { continue; }
        if (cond && typeof cond === 'object' && 'not' in cond) {
            if (cond.not === null && (row[field] === null || row[field] === undefined)) { return { count: 0 }; }
            continue;
        }
        if (cond && typeof cond === 'object' && Array.isArray(cond.in)) {
            if (!cond.in.includes(row[field])) { return { count: 0 }; }
            continue;
        }
        if (row[field] !== cond) { return { count: 0 }; }
    }
    rows.set(where.id, { ...row, ...data });
    return { count: 1 };
});
const mockDb = {
    quotation: {
        findFirst: jest.fn(async ({ where }) => {
            const row = rows.get(where.id);
            if (!row || (where.isDeleted === false && row.isDeleted)) { return null; }
            return { ...row };
        }),
        findMany: jest.fn(async ({ where }) => Array.from(rows.values())
            .filter((r) => r.applicationId === where.applicationId && !r.isDeleted)
            .map((r) => ({ ...r }))),
        update,
        updateMany,
    },
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

const { recordPhaseInvoiced, QUOTATION_STATUS } = require('../../services/quotation-service');

const BOTH_PHASES = [
    { phase: 'PHASE_1', serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
    { phase: 'PHASE_2', serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
];
const RENEWAL_PHASE_2_ONLY = [
    { phase: 'PHASE_2', serviceFeeAmount: 33000, vatAmount: 2310, scopeCount: 1 },
];

const seed = (over = {}) => {
    const row = {
        id: 'qt-1',
        applicationId: 'app_1',
        issuerType: 'PLATFORM',
        status: QUOTATION_STATUS.ACCEPTED,
        isDeleted: false,
        installments: BOTH_PHASES,
        phase1InvoicedAt: null,
        phase2InvoicedAt: null,
        notes: null,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        ...over,
    };
    rows.set(row.id, row);
    return row;
};

const AT = new Date('2026-08-28T10:00:00.000Z');

beforeEach(() => {
    jest.clearAllMocks();
    rows.clear();
});

test('M1 stamps phase 1 and does NOT close a quotation that still prices งวดที่ 2', async () => {
    seed();
    const r = await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M1', at: AT });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toEqual({ phase1InvoicedAt: AT });
    expect(r).toEqual({
        quotationId: 'qt-1', phase: 'PHASE_1', closed: false, status: QUOTATION_STATUS.ACCEPTED,
        stamped: true, mismatch: null,
    });
    // The label the slip gate reads as "accepted" must not appear early.
    expect(rows.get('qt-1').status).not.toBe(QUOTATION_STATUS.INVOICED);
});

test('M2 closes it once BOTH instalments the row prices are billed', async () => {
    seed({ phase1InvoicedAt: new Date('2026-08-20T00:00:00.000Z') });
    const r = await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M2', at: AT });

    // The stamp and the close are two writes now (R4): the stamp is this
    // caller's fact, the close is a claim about the whole document and is
    // therefore decided by the database against the row's own columns.
    expect(update.mock.calls[0][0].data).toEqual({ phase2InvoicedAt: AT });
    expect(updateMany.mock.calls[0][0].data).toEqual({ status: QUOTATION_STATUS.INVOICED });
    expect(r).toEqual({
        quotationId: 'qt-1', phase: 'PHASE_2', closed: true, status: QUOTATION_STATUS.INVOICED,
        stamped: true, mismatch: null,
    });
});

test('a renewal prices PHASE_2 only, so that ONE stamp closes the document', async () => {
    seed({ installments: RENEWAL_PHASE_2_ONLY });
    const r = await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M2', at: AT });

    expect(r.closed).toBe(true);
    expect(rows.get('qt-1').status).toBe(QUOTATION_STATUS.INVOICED);
    expect(rows.get('qt-1').phase1InvoicedAt).toBeNull();
});

test('a legacy row with no installments is only closed when BOTH phases are stamped', async () => {
    seed({ installments: null });
    const first = await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M1', at: AT });
    expect(first.closed).toBe(false);

    const second = await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M2', at: AT });
    expect(second.closed).toBe(true);
});

test('a row nobody ever accepted is STAMPED but never flipped, and says so in its notes', async () => {
    seed({ status: QUOTATION_STATUS.PENDING, installments: RENEWAL_PHASE_2_ONLY });
    const r = await recordPhaseInvoiced({
        quotationId: 'qt-1', milestone: 'M2', invoiceNumber: 'TAX-PRD-2026-000009', at: AT,
    });

    expect(r).toEqual({
        quotationId: 'qt-1', phase: 'PHASE_2', closed: false, status: QUOTATION_STATUS.PENDING,
        stamped: true, mismatch: null,
    });
    const written = update.mock.calls[0][0].data;
    expect(written.status).toBeUndefined();          // the acceptance is NOT invented
    expect(written.phase2InvoicedAt).toBe(AT);       // the invoicing IS a fact
    expect(written.notes).toBe('INVOICED_WITHOUT_ACCEPTANCE PHASE_2 TAX-PRD-2026-000009');
});

test('an existing note is appended to, never overwritten', async () => {
    seed({ status: QUOTATION_STATUS.SENT, notes: 'ออกใบอัตโนมัติเมื่อยื่นคำขอ' });
    await recordPhaseInvoiced({
        quotationId: 'qt-1', milestone: 'M1', invoiceNumber: 'TAX-PRD-2026-000009', at: AT,
    });
    expect(update.mock.calls[0][0].data.notes)
        .toBe('ออกใบอัตโนมัติเมื่อยื่นคำขอ\nINVOICED_WITHOUT_ACCEPTANCE PHASE_1 TAX-PRD-2026-000009');
});

test('a second settlement for the same phase keeps the FIRST instant', async () => {
    const already = new Date('2026-08-20T00:00:00.000Z');
    seed({ phase1InvoicedAt: already });

    await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M1', at: AT });

    // Fix round 3 (review r1, finding 1): the first instant is kept by writing
    // NOTHING, rather than by re-writing the value the row already holds. The
    // assertion moved from the UPDATE payload to the row itself, because the
    // update is exactly what no longer happens.
    expect(update).not.toHaveBeenCalled();
    const row = await mockDb.quotation.findFirst({ where: { id: 'qt-1' } });
    expect(row.phase1InvoicedAt).toBe(already);
});

/**
 * ── The heal path has to be idempotent for the rows it exists to heal
 *    (review r1, finding 1) ─────────────────────────────────────────────────
 *
 * The already-SETTLED fast path calls this function on EVERY redelivery,
 * settleEvent retry and reconcile pass for the same (order, phase), and the
 * rows it targets are the drain-window ones whose quotation is still PENDING -
 * i.e. exactly `wasAccepted === false`, the branch that writes the note. The
 * case above does not cover it: its row is ACCEPTED, so no note is written at
 * all. A quotation whose provider note reads INVOICED_WITHOUT_ACCEPTANCE three
 * times says the same instalment was billed three times against one receipt.
 */
test('re-driving the same phase on a never-accepted row leaves ONE note, not one per attempt', async () => {
    seed({ status: QUOTATION_STATUS.PENDING });
    const args = { quotationId: 'qt-1', milestone: 'M1', invoiceNumber: 'TAX-PRD-2026-000009', at: AT };

    await recordPhaseInvoiced(args);
    await recordPhaseInvoiced(args);
    await recordPhaseInvoiced(args);

    const note = 'INVOICED_WITHOUT_ACCEPTANCE PHASE_1 TAX-PRD-2026-000009';
    const row = await mockDb.quotation.findFirst({ where: { id: 'qt-1' } });
    expect(row.notes).toBe(note);
    expect(row.notes.split('\n').filter((l) => l === note)).toHaveLength(1);
});

/**
 * The same run, second half: an UPDATE whose data changes no field still bumps
 * `updatedAt` (@updatedAt on the Quotation model) on a money document, so
 * "healing a row that is already correct costs one UPDATE and changes nothing"
 * was inaccurate in both directions. Nothing to write is nothing to write.
 */
test('a heal pass over a row that is already correct issues no write at all', async () => {
    const already = new Date('2026-08-20T00:00:00.000Z');
    seed({ status: QUOTATION_STATUS.INVOICED, phase1InvoicedAt: already, phase2InvoicedAt: already });

    const r = await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M1', at: AT });

    expect(update).not.toHaveBeenCalled();
    // Not even the guarded close: the row already says INVOICED, and writing
    // it again would bump updatedAt on a money document for nothing.
    expect(updateMany).not.toHaveBeenCalled();
    // Still the same answer the caller gets from a writing pass, so the heal
    // path cannot read a no-op as a failure.
    expect(r).toEqual({
        quotationId: 'qt-1', phase: 'PHASE_1', closed: true,
        status: QUOTATION_STATUS.INVOICED, stamped: true, mismatch: null,
    });
});

test('an order minted before the binding falls back to the applicationId, preferring the company row', async () => {
    seed({ id: 'qt-dtam', issuerType: 'DTAM' });
    seed({ id: 'qt-platform', issuerType: 'PLATFORM' });
    const r = await recordPhaseInvoiced({ applicationId: 'app_1', milestone: 'M1', at: AT });
    expect(r.quotationId).toBe('qt-platform');
});

test('no quotation anywhere returns null and writes nothing — the caller logs it', async () => {
    const r = await recordPhaseInvoiced({ quotationId: 'qt-missing', applicationId: 'app_none', milestone: 'M1', at: AT });
    expect(r).toBeNull();
    expect(update).not.toHaveBeenCalled();
});

test('a soft-deleted row is not a quotation to stamp', async () => {
    seed({ isDeleted: true });
    const r = await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M1', at: AT });
    expect(r).toBeNull();
    expect(update).not.toHaveBeenCalled();
});

test('an unknown milestone throws UNKNOWN_MILESTONE and writes nothing', async () => {
    seed();
    await expect(recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M3', at: AT }))
        .rejects.toMatchObject({ code: 'UNKNOWN_MILESTONE' });
    expect(update).not.toHaveBeenCalled();
});

/**
 * The slip rail speaks PHASE_1 / PHASE_2 where the card rail says M1 / M2, and
 * both are accepted here.
 *
 * This case was labelled "tolerance, NOT coverage" while nothing on the slip
 * rail called this function (review r0, finding 4). It is coverage now:
 * payment-slip-service.approveSlip closes the instalment after its transaction
 * commits, with `milestone: phase`, and slip-approval-closes-quotation.test.js
 * pins that hand-off. What is still card-rail-only is the PROBE:
 * scripts/probes/quotation-closure.sh joins checkout_orders, so a slip-paid
 * application is outside its population (the backlog F-G4-64-SLIP-CLOSURE).
 */
test('the argument vocabulary tolerates PHASE_1/PHASE_2 as well as M1/M2 — the slip rail`s words', async () => {
    seed();
    const r = await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'PHASE_2', at: AT });
    expect(r.phase).toBe('PHASE_2');
    expect(update.mock.calls[0][0].data.phase2InvoicedAt).toBe(AT);
});

test('a row already INVOICED is stamped without a redundant status write', async () => {
    seed({ status: QUOTATION_STATUS.INVOICED, phase1InvoicedAt: new Date('2026-08-20T00:00:00.000Z') });
    const r = await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M2', at: AT });
    expect(update.mock.calls[0][0].data).toEqual({ phase2InvoicedAt: AT });
    expect(updateMany).not.toHaveBeenCalled();
    expect(r.closed).toBe(true);
});

/**
 * ── The close is decided by the database, not by the read that preceded it
 *    (fix round 4, R4) ─────────────────────────────────────────────────────
 *
 * Under W14 one quotation prices BOTH phases, and the two phases settle on
 * their own webhooks. `row` was read outside any transaction and `allBilled`
 * was computed from that snapshot, so two closes that interleave both saw the
 * other stamp as NULL: neither wrote INVOICED, and the document stayed
 * ACCEPTED with both instalments billed — which the closure probe then reads as
 * an open quotation forever.
 *
 * The cases below drive the interleaving the old shape lost: both readers take
 * their snapshot BEFORE either writes.
 */
describe('two closes that interleave', () => {
    it('the LAST writer flips the document, even though both read it unstamped', async () => {
        seed();
        const first = recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M1', at: AT });
        const second = recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M2', at: AT });
        const [a, b] = await Promise.all([first, second]);

        expect(rows.get('qt-1').status).toBe(QUOTATION_STATUS.INVOICED);
        expect(rows.get('qt-1').phase1InvoicedAt).toBe(AT);
        expect(rows.get('qt-1').phase2InvoicedAt).toBe(AT);
        // Exactly one of the two performed the flip; the other answered
        // truthfully about the phase it stamped.
        expect([a.closed, b.closed].filter(Boolean)).toHaveLength(1);
    });

    it('a redelivery of the first phase cannot un-close a document already closed', async () => {
        seed({ phase1InvoicedAt: new Date('2026-08-20T00:00:00.000Z') });
        await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M2', at: AT });
        expect(rows.get('qt-1').status).toBe(QUOTATION_STATUS.INVOICED);

        const again = await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M1', at: AT });
        expect(again.status).toBe(QUOTATION_STATUS.INVOICED);
        expect(rows.get('qt-1').status).toBe(QUOTATION_STATUS.INVOICED);
    });

    it('a never-accepted row is stamped by both phases and still not flipped', async () => {
        seed({ status: QUOTATION_STATUS.PENDING });
        await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M1', at: AT });
        await recordPhaseInvoiced({ quotationId: 'qt-1', milestone: 'M2', at: AT });

        // The guard names the accepted states, so a document nobody agreed to
        // cannot be closed by the arithmetic alone.
        expect(rows.get('qt-1').status).toBe(QUOTATION_STATUS.PENDING);
    });
});

/**
 * ── The applicationId fallback must not stamp a document it did not collect
 *    against (review r0, finding 3) ────────────────────────────────────────
 *
 * When checkout_orders.quotationId is present, the figures were already
 * compared to the satang before the order was minted (T5's
 * assertChargeMatchesAcceptedFigures, which refuses as CHECKOUT_PRICE_DRIFT and
 * mints nothing), and the order carries the hash of the snapshot that matched.
 * The fallback has none of that: it picks whatever quotation is live for the
 * application today. A drain-window order for 5,535 THB, never re-entered
 * through createCheckoutForApplication so never bound, can be confirmed from a
 * stale tab long after staff re-issued and the applicant accepted a corrected
 * 5,885 document — and stamping THAT document would record that it was billed
 * by a charge which collected a different figure, invisibly, because
 * quotation-closure would then read the row as closed.
 *
 * So the fallback compares before it stamps, against the same field the mint
 * compares (the accepted instalment's phaseTotal), and refuses on any
 * difference. The refusal is a return value, never a throw: settlement must not
 * be able to fail for a quotation reason.
 */
const ACCEPTED_BOTH_PHASES = {
    quotationNumber: 'QT-PRD-2026-000001',
    installments: [
        {
            phase: 'PHASE_1', amount: '5885.00', stateAmount: '5000.00',
            platformAmount: '500.00', vatAmount: '385.00', phaseTotal: '5885.00',
        },
        {
            phase: 'PHASE_2', amount: '29425.00', stateAmount: '25000.00',
            platformAmount: '2500.00', vatAmount: '1925.00', phaseTotal: '29425.00',
        },
    ],
};

test('the fallback refuses to stamp a document whose accepted figure is not what was collected', async () => {
    seed({ acceptedSnapshot: ACCEPTED_BOTH_PHASES });

    const r = await recordPhaseInvoiced({
        applicationId: 'app_1', milestone: 'M1', chargedAmount: 5535, at: AT,
    });

    expect(update).not.toHaveBeenCalled();
    expect(r).toEqual({
        quotationId: 'qt-1', phase: 'PHASE_1', closed: false,
        status: QUOTATION_STATUS.ACCEPTED, stamped: false,
        mismatch: { chargedAmount: '5535.00', acceptedAmount: '5885.00' },
    });
});

test('the fallback stamps when the accepted phase total matches the charge to the satang', async () => {
    seed({ acceptedSnapshot: ACCEPTED_BOTH_PHASES });

    const r = await recordPhaseInvoiced({
        applicationId: 'app_1', milestone: 'M1', chargedAmount: 5885, at: AT,
    });

    expect(update.mock.calls[0][0].data).toEqual({ phase1InvoicedAt: AT });
    expect(r.stamped).toBe(true);
    expect(r.mismatch).toBeNull();
});

test('the fallback refuses a document that does not price the instalment being billed at all', async () => {
    seed({
        installments: RENEWAL_PHASE_2_ONLY,
        acceptedSnapshot: {
            quotationNumber: 'QT-PRD-2026-000002',
            installments: [ACCEPTED_BOTH_PHASES.installments[1]],
        },
    });

    const r = await recordPhaseInvoiced({
        applicationId: 'app_1', milestone: 'M1', chargedAmount: 5885, at: AT,
    });

    expect(update).not.toHaveBeenCalled();
    expect(r.stamped).toBe(false);
    // Nothing was accepted for this phase, so there is no figure to print
    // beside the charge. Saying "0.00" would invent one.
    expect(r.mismatch).toEqual({ chargedAmount: '5885.00', acceptedAmount: null });
});

test('the fallback refuses an accepted document when the caller cannot say what was collected', async () => {
    seed({ acceptedSnapshot: ACCEPTED_BOTH_PHASES });

    const r = await recordPhaseInvoiced({ applicationId: 'app_1', milestone: 'M1', at: AT });

    expect(update).not.toHaveBeenCalled();
    expect(r.stamped).toBe(false);
    expect(r.mismatch).toEqual({ chargedAmount: null, acceptedAmount: '5885.00' });
});

test('a row nobody accepted has no frozen figure to disagree with, so the fallback still stamps it and says why in its notes', async () => {
    seed({ status: QUOTATION_STATUS.PENDING, acceptedSnapshot: null });

    const r = await recordPhaseInvoiced({
        applicationId: 'app_1', milestone: 'M1',
        invoiceNumber: 'TAX-PRD-2026-000009', chargedAmount: 5535, at: AT,
    });

    expect(r.stamped).toBe(true);
    expect(update.mock.calls[0][0].data.notes)
        .toBe('INVOICED_WITHOUT_ACCEPTANCE PHASE_1 TAX-PRD-2026-000009');
});

test('a BOUND quotationId is stamped without re-comparing — the mint-time drift gate already did that', async () => {
    seed({ acceptedSnapshot: ACCEPTED_BOTH_PHASES });

    const r = await recordPhaseInvoiced({
        quotationId: 'qt-1', milestone: 'M1', chargedAmount: 5535, at: AT,
    });

    expect(r.stamped).toBe(true);
    expect(update.mock.calls[0][0].data).toEqual({ phase1InvoicedAt: AT });
});
