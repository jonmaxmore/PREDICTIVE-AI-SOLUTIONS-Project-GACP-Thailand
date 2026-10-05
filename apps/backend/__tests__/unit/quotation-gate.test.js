'use strict';
/**
 * The ONE quotation gate, both rails (F-G4-64 R1).
 *
 * Fail-CLOSED in every direction: no quotation is a refusal, not a pass; a
 * lookup failure is a 503, not a pass. The slip rail's legacy fail-open
 * ("no quotation ... allowing PHASE_1 slip") is exactly how application A2
 * collected 35,310 THB and reached CERTIFIED with no document of record at all
 * (reports/research/2026-08-28-f-g4-64/register.md B).
 */
const mockFindQuotations = jest.fn();
jest.mock('../../services/quotation-service', () => ({
    findQuotationsByApplicationId: (...a) => mockFindQuotations(...a),
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});

const { assertQuotationAcceptedForPayment, MILESTONE_TO_PHASE } =
    require('../../services/billing/quotation-gate');

const APP = 'app-1';
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const PAST = new Date(Date.now() - 24 * 3600 * 1000);

function accepted(overrides = {}) {
    return {
        id: 'qt-1',
        issuerType: 'PLATFORM',
        status: 'ACCEPTED',
        validUntil: FUTURE,
        acceptedSnapshot: { installments: [{ phase: 'PHASE_1', phaseTotal: '5885.00' }] },
        acceptedSnapshotHash: 'h1',
        ...overrides,
    };
}

beforeEach(() => jest.clearAllMocks());

test('an ACCEPTED quotation passes and hands back the row, the phase and the snapshot', async () => {
    mockFindQuotations.mockResolvedValue({ dtam: null, platform: accepted() });
    const out = await assertQuotationAcceptedForPayment({ applicationId: APP, milestone: 'M1' });
    expect(out.quotation.id).toBe('qt-1');
    expect(out.phase).toBe('PHASE_1');
    expect(out.snapshot).toEqual(accepted().acceptedSnapshot);
});

test('INVOICED passes too (post-acceptance terminal)', async () => {
    mockFindQuotations.mockResolvedValue({ dtam: null, platform: accepted({ status: 'INVOICED' }) });
    await expect(assertQuotationAcceptedForPayment({ applicationId: APP, milestone: 'M2' }))
        .resolves.toMatchObject({ phase: 'PHASE_2' });
});

test('NO quotation is QUOTATION_NOT_ISSUED 409, never a pass', async () => {
    mockFindQuotations.mockResolvedValue({ dtam: null, platform: null });
    await expect(assertQuotationAcceptedForPayment({ applicationId: APP, milestone: 'M1' }))
        .rejects.toMatchObject({ code: 'QUOTATION_NOT_ISSUED', status: 409 });
});

test('PENDING is QUOTATION_NOT_ACCEPTED 409', async () => {
    mockFindQuotations.mockResolvedValue({ dtam: null, platform: accepted({ status: 'PENDING' }) });
    await expect(assertQuotationAcceptedForPayment({ applicationId: APP, milestone: 'M1' }))
        .rejects.toMatchObject({ code: 'QUOTATION_NOT_ACCEPTED', status: 409 });
});

test('a still-unaccepted quotation past validUntil is QUOTATION_EXPIRED 409', async () => {
    mockFindQuotations.mockResolvedValue({
        dtam: null, platform: accepted({ status: 'PENDING', validUntil: PAST }),
    });
    await expect(assertQuotationAcceptedForPayment({ applicationId: APP, milestone: 'M1' }))
        .rejects.toMatchObject({ code: 'QUOTATION_EXPIRED', status: 409 });
});

test('an ACCEPTED quotation does NOT expire', async () => {
    mockFindQuotations.mockResolvedValue({ dtam: null, platform: accepted({ validUntil: PAST }) });
    await expect(assertQuotationAcceptedForPayment({ applicationId: APP, milestone: 'M1' }))
        .resolves.toMatchObject({ phase: 'PHASE_1' });
});

test('a lookup failure is QUOTATION_GATE_UNAVAILABLE 503, never a pass', async () => {
    mockFindQuotations.mockRejectedValue(new Error('db down'));
    await expect(assertQuotationAcceptedForPayment({ applicationId: APP, milestone: 'M1' }))
        .rejects.toMatchObject({ code: 'QUOTATION_GATE_UNAVAILABLE', status: 503 });
});

test('a pre-W14 application with BOTH issuer rows requires BOTH to be accepted', async () => {
    mockFindQuotations.mockResolvedValue({
        dtam: accepted({ id: 'qt-dtam', issuerType: 'DTAM', status: 'PENDING' }),
        platform: accepted({ id: 'qt-plat' }),
    });
    await expect(assertQuotationAcceptedForPayment({ applicationId: APP, milestone: 'M1' }))
        .rejects.toMatchObject({ code: 'QUOTATION_NOT_ACCEPTED' });
});

test('both rails speak their own milestone vocabulary onto the same two phases', () => {
    expect(MILESTONE_TO_PHASE).toEqual({
        M1: 'PHASE_1', M2: 'PHASE_2', PHASE_1: 'PHASE_1', PHASE_2: 'PHASE_2',
    });
});

test('an unknown milestone is refused rather than silently allowed', async () => {
    mockFindQuotations.mockResolvedValue({ dtam: null, platform: accepted() });
    await expect(assertQuotationAcceptedForPayment({ applicationId: APP, milestone: 'M9' }))
        .rejects.toMatchObject({ code: 'QUOTATION_GATE_UNAVAILABLE' });
});
