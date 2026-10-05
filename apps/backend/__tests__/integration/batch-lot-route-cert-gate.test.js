/**
 * H3 follow-up — the dedicated LOT route (/lot/:lotId) must 410-GATE a lot whose
 * certificate exists but is invalid (revoked/expired), exactly like the batch
 * route already does. Today the lot route computes isCertValid but never gates,
 * so it returns 200 with the full trace for a revoked cert (leak).
 *
 * Both routes are refactored to share common.evaluateCertGate, so the 410 logic
 * lives in one place. This test:
 *   - RED: lot route + revoked cert → expects 410 (today 200).
 *   - Regression guard: batch route + revoked cert stays 410 with the canonical
 *     body shape (success/type/verification/certificate/message).
 *   - GREEN guard: lot route + valid (lowercase 'active', future expiry) cert
 *     → 200.
 *
 * We register the routes into a fake router that captures the handlers, then
 * invoke them directly with mock req/res. traceability-service + qrcodeService
 * are mocked. The DB-import modules are mocked so common.js loads cleanly.
 */
'use strict';

jest.mock('../../server', () => ({ prisma: {} }));
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

const mockBatchFind = jest.fn();
const mockLotFind = jest.fn();
const mockIntegrityRecord = jest.fn().mockResolvedValue(null);

jest.mock('../../services/traceability-service', () => ({
    findPublicBatchByAnyIdentifier: (...a) => mockBatchFind(...a),
    findPublicLotByAnyIdentifier: (...a) => mockLotFind(...a),
    findActiveTraceIntegrityRecord: (...a) => mockIntegrityRecord(...a),
}));

const common = require('../../services/trace-service/common');
const { registerBatchAndLotRoutes } = require('../../routes/api/trace/trace-batch-lot-routes');

const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

// Capture the route handlers registered by registerBatchAndLotRoutes.
function buildHandlers() {
    const handlers = {};
    const router = {
        get(path, fn) {
            if (path === '/batch/:batchId') { handlers.batch = fn; }
            if (path === '/lot/:lotId') { handlers.lot = fn; }
        },
    };
    const deps = {
        qrcodeService: { recordTraceScan: jest.fn().mockResolvedValue({ available: false, valid: null }) },
        logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
        getRequestIp: () => '127.0.0.1',
        normalizeSourceFromPayload: common.normalizeSourceFromPayload,
        parseJsonMetaFromNotes: common.parseJsonMetaFromNotes,
        PLOT_HARVEST_META_PREFIX: common.PLOT_HARVEST_META_PREFIX,
        buildIntegrityPayload: common.buildIntegrityPayload,
        logPublicTraceAccess: jest.fn().mockResolvedValue(undefined),
        TRACE_NOT_FOUND_MESSAGE: common.TRACE_NOT_FOUND_MESSAGE,
        formatThaiDate: common.formatThaiDate,
        SAFETY_DISCLAIMER: common.SAFETY_DISCLAIMER,
        FDA_REFERRAL: common.FDA_REFERRAL,
        evaluateCertGate: common.evaluateCertGate,
    };
    registerBatchAndLotRoutes(router, deps);
    return handlers;
}

function mockRes() {
    const res = {};
    res.statusCode = 200;
    res.body = undefined;
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

function batchRow(cert) {
    return {
        id: 'batch-1', batchNumber: 'B1', freshWeight: 1, harvestDate: null, notes: null,
        farm: { id: 'f1', farmName: 'F', district: 'D', province: 'P' },
        cycle: { id: 'cyc-1', cycleName: 'C1', certificate: cert },
        lots: [],
    };
}
function lotRow(cert) {
    return {
        id: 'lot-1', lotNumber: 'L1', batchId: 'batch-1',
        packageType: 'BAG', unitWeight: 1, quantity: 1, totalWeight: 1, trackingUrl: null,
        batch: {
            id: 'batch-1', batchNumber: 'B1', harvestDate: null, notes: null,
            farm: { id: 'f1', farmName: 'F', district: 'D', province: 'P' },
            cycle: { id: 'cyc-1', cycleName: 'C1', certificate: cert },
        },
    };
}

const req = { params: {}, get: () => 'jest', originalUrl: '/trace' };

beforeEach(() => {
    jest.clearAllMocks();
    mockIntegrityRecord.mockResolvedValue(null);
});

describe('dedicated batch/lot routes — certificate 410-gate (H3 follow-up)', () => {
    test('RED: lot route with revoked cert → 410 (today 200)', async () => {
        mockLotFind.mockResolvedValue(
            lotRow({ certificateNumber: 'CERT-L', status: 'revoked', expiryDate: future, issuedDate: past }),
        );
        const { lot } = buildHandlers();
        const res = mockRes();
        await lot({ ...req, params: { lotId: 'L1' } }, res);
        expect(res.statusCode).toBe(410);
        expect(res.body.type).toBe('LOT');
        expect(res.body.data).toBeUndefined();
        expect(res.body.verification.reason).toBe('certificate_revoked');
    });

    test('regression: batch route with revoked cert stays 410 with canonical body shape', async () => {
        mockBatchFind.mockResolvedValue(
            batchRow({ certificateNumber: 'CERT-B', status: 'revoked', expiryDate: future, issuedDate: past }),
        );
        const { batch } = buildHandlers();
        const res = mockRes();
        await batch({ ...req, params: { batchId: 'B1' } }, res);
        expect(res.statusCode).toBe(410);
        expect(Object.keys(res.body).sort())
            .toEqual(['success', 'type', 'verification', 'certificate', 'message'].sort());
        expect(res.body.type).toBe('HARVEST_BATCH');
        expect(res.body.verification.reason).toBe('certificate_revoked');
        expect(res.body.certificate.reference).toBe('CERT-B');
        expect(res.body.certificate.status).toBe('revoked');
    });

    test('GREEN guard: lot route with valid lowercase-active cert (future expiry) → 200', async () => {
        mockLotFind.mockResolvedValue(
            lotRow({ certificateNumber: 'CERT-OK', status: 'active', expiryDate: future, issuedDate: past }),
        );
        const { lot } = buildHandlers();
        const res = mockRes();
        await lot({ ...req, params: { lotId: 'L1' } }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.certificate.isValid).toBe(true);
    });

    test('GREEN guard: batch route with valid lowercase-active cert (future expiry) → 200', async () => {
        mockBatchFind.mockResolvedValue(
            batchRow({ certificateNumber: 'CERT-OK', status: 'active', expiryDate: future, issuedDate: past }),
        );
        const { batch } = buildHandlers();
        const res = mockRes();
        await batch({ ...req, params: { batchId: 'B1' } }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.certificate.isValid).toBe(true);
    });

    // F-QA-02 (deep-qa 2026-09-06): the screen must be able to tell "never
    // certified" from "certificate lapsed", and the ONLY signal it gets is this
    // one. A lot that was never certified is NOT gated (410 is for a cert that
    // exists and is no longer good) — it answers 200 with certificate: null.
    // If this ever became `{ isValid: false }` instead, the public page would
    // have no way left to avoid calling an uncertified lot expired.
    test('never certified: lot route answers 200 with certificate: null — NOT a 410 gate', async () => {
        mockLotFind.mockResolvedValue(lotRow(null));
        const { lot } = buildHandlers();
        const res = mockRes();
        await lot({ ...req, params: { lotId: 'L1' } }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.certificate).toBeNull();
        expect(res.body.data).toBeDefined();
    });

    test('never certified: batch route answers 200 with certificate: null — NOT a 410 gate', async () => {
        mockBatchFind.mockResolvedValue(batchRow(null));
        const { batch } = buildHandlers();
        const res = mockRes();
        await batch({ ...req, params: { batchId: 'B1' } }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.data.certificate).toBeNull();
    });
});
