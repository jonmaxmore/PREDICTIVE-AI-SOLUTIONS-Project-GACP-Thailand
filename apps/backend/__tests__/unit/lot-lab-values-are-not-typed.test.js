/**
 * T10b — the lot doors stop taking a number a farmer typed.
 *
 * The ruling is one sentence and it decides this file: "เราจะไม่ได้พิมพ์บอกค่าเท่าไหร่
 * เราจะอัพโหลดผลแลป". A COA is a document issued by a laboratory. The moment the
 * platform also accepts a hand-typed 0.2% beside it, there are two answers to the
 * same question and no way to tell which one is the lab's — and the typed one is
 * the one that is cheap to make say whatever the seller wants.
 *
 * Bug 6.3 (2026-06) reached the honest version of the OLD model: a bare report URL
 * must not auto-PASS a lot, so the farmer had to self-attest PASSED explicitly.
 * That was right while self-attestation was the model. It is not the model now:
 * the batch carries a real report (T9/T10), an officer verifies it (T13), and the
 * public scan reads THAT — never the lot's own word for itself.
 *
 * So these five fields are refused rather than ignored. Ignoring them would let a
 * caller send 0.2% and read back 200 OK, which reports success for a write that
 * did not happen — the same class of lie the platform's whole evidence rule exists
 * to prevent. The refusal names the real door instead.
 *
 * The stored columns are left alone: rows written before today keep their values,
 * and deleting a column is how you lose the ability to explain a historical page.
 * They are simply no longer written by anything a farmer can reach.
 */
'use strict';

const express = require('express');
const request = require('supertest');

const mockFindLotForUpdate = jest.fn();
const mockListOwnerFarmIds = jest.fn(async () => ['farm-1']);
const mockFindBatchFarmId = jest.fn(async () => ({ farmId: 'farm-1' }));
const mockCreateLot = jest.fn(async (_batchId, data) => ({ id: 'lot-1', ...data }));
const mockUpdateLot = jest.fn(async (_id, data) => ({ id: 'lot-1', ...data }));

// Task 6: the code under test now passes a holder scope beside its pre-R1 where
// (spec 2026-09-30 §3.1). The scope's own reads are not this suite's subject; the
// real-Postgres walk (health-door-walk-real-postgres.test.js) proves them.
jest.mock('../../services/holder-access', () => ({
    holderScope: async (req) => ({ userId: String(req?.user?.id || ''), readIds: [], editIds: [] }),
    r1HolderOrLegacyWhenScoped: () => ({}),
}));
jest.mock('../../middleware/auth-middleware', () => {
    const u = (req, _res, next) => {
        req.user = { id: 'farmer-1', role: 'health', canonicalRole: 'health', organizationId: 'org-1' };
        next();
    };
    return { authenticateHealth: u, authenticateProvider: u, authenticateAny: u, requireRole: () => (_q, _s, n) => n() };
});
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../shared/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(async () => {}) },
    AuditCategory: {}, AuditSeverity: {}, ResourceType: {},
}));
jest.mock('../../services/qrcode/qrcode-service', () => ({
    generateQRCodeId: () => 'QR-1',
    generatePublicTraceUrl: (p) => `https://example.test/${p}`,
    registerTraceIntegrity: jest.fn(async () => {}),
}));
jest.mock('../../services/attachment-service', () => ({
    attach: jest.fn(async () => {}), detach: jest.fn(async () => {}), listForResource: jest.fn(async () => []),
}));
jest.mock('../../routes/api/helpers/lots-label-routes', () => ({ registerLotLabelRoutes: jest.fn() }));
jest.mock('../../routes/api/helpers/lots-utility-routes', () => ({ registerLotUtilityRoutes: jest.fn() }));
jest.mock('../../services/traceability-service', () => ({
    listOwnerFarmIdsForTrace: (...a) => mockListOwnerFarmIds(...a),
    findHarvestBatchFarmId: (...a) => mockFindBatchFarmId(...a),
    findLotForUpdate: (...a) => mockFindLotForUpdate(...a),
    createLotWithQuotaCheck: (...a) => mockCreateLot(...a),
    updateLotTrackingUrl: jest.fn(async (id) => ({ id, batch: { farmId: 'farm-1' } })),
    updateLotWithFarmInclude: (...a) => mockUpdateLot(...a),
    findLotDetailById: jest.fn(async () => null),
    isAutoTraceBatch: () => false,
    normalizeLotTestStatus: jest.fn((v) => (v === undefined || v === null || v === '' ? 'PENDING' : String(v).toUpperCase())),
    buildLotNumber: jest.fn(async () => 'LOT-001'),
}));

const app = express();
app.use(express.json());
app.use('/api/lots', require('../../routes/api/trace/lots'));

const VALID_LOT = { batchId: 'hb-1', packageType: 'BAG', quantity: 10, unitWeight: 1000 };
const TYPED = {
    thcContent: '0.2',
    cbdContent: '12.5',
    moistureContent: '9',
    labTestReportUrl: '/uploads/i-typed-this.pdf',
    testStatus: 'PASSED',
};

beforeEach(() => {
    jest.clearAllMocks();
    mockListOwnerFarmIds.mockResolvedValue(['farm-1']);
    mockFindBatchFarmId.mockResolvedValue({ farmId: 'farm-1' });
    mockFindLotForUpdate.mockResolvedValue({ id: 'lot-1', printedAt: null, batch: { farmId: 'farm-1' } });
});

describe('POST /api/lots — creating a lot', () => {
    test('a lot with no lab claim at all is created, exactly as before', async () => {
        const res = await request(app).post('/api/lots').send(VALID_LOT);
        expect(res.status).toBeLessThan(400);
        expect(mockCreateLot).toHaveBeenCalled();
    });

    for (const field of Object.keys(TYPED)) {
        test(`refuses ${field} — and says so, rather than dropping it silently`, async () => {
            const res = await request(app).post('/api/lots').send({ ...VALID_LOT, [field]: TYPED[field] });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('LAB_VALUES_NOT_TYPED');
            expect(res.body.message).toContain(field);
            expect(mockCreateLot).not.toHaveBeenCalled();
        });
    }

    test('the refusal points at the door that does work, in Thai', async () => {
        const res = await request(app).post('/api/lots').send({ ...VALID_LOT, thcContent: '0.2' });
        expect(res.body.message).toMatch(/[ก-๙]/);
        expect(res.body.message).toContain('lab-results');
    });
});

describe('PUT /api/lots/:id — editing a lot', () => {
    test('the fields that were never a lab claim still edit', async () => {
        const res = await request(app).put('/api/lots/lot-1').send({ packagedAt: '2026-09-05' });
        expect(res.status).toBeLessThan(400);
        expect(mockUpdateLot).toHaveBeenCalled();
    });

    for (const field of Object.keys(TYPED)) {
        test(`refuses ${field} with the lab refusal, not the generic one`, async () => {
            const res = await request(app).put('/api/lots/lot-1').send({ [field]: TYPED[field] });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('LAB_VALUES_NOT_TYPED');
            expect(mockUpdateLot).not.toHaveBeenCalled();
        });
    }

    test('an unrelated forbidden field keeps the generic refusal — the two are not merged', async () => {
        const res = await request(app).put('/api/lots/lot-1').send({ quantity: 99 });
        expect(res.status).toBe(400);
        expect(res.body.code).not.toBe('LAB_VALUES_NOT_TYPED');
    });
});
