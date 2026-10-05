/**
 * A3 (HIGH) — layer 2 defensive read on the DEDICATED public batch/lot trace
 * routes (the QR target for a manually-created batch:
 * trackingUrl = /trace/batch/<id>): a batch whose cycle belongs to a DIFFERENT
 * farm must not surface that cycle's certificate on the public QR.
 *
 * CLEANUP-#7 (batch-2 fast-follow): the public projection from
 * traceability-service NOW exposes cycle.farmId (A3-layer-2b), so the route
 * compares batch.cycle.farmId !== batch.farmId IN-MEMORY and the per-request
 * prisma.plantingCycle.findUnique is DELETED. These tests assert the cross-farm
 * cert-drop STILL fires WITHOUT any findUnique call, and that a MISSING
 * cycle.farmId fails OPEN (keeps the cert — the definitive guard is the
 * create-time farm check in harvest-batches.js).
 */
'use strict';

const express = require('express');
const request = require('supertest');

const mockTrace = {
    findPublicBatchByAnyIdentifier: jest.fn(),
    findPublicLotByAnyIdentifier: jest.fn(),
    findActiveTraceIntegrityRecord: jest.fn().mockResolvedValue(null),
};
jest.mock('../../services/traceability-service', () => mockTrace);

const { registerBatchAndLotRoutes } = require('../../routes/api/trace/trace-batch-lot-routes');

const mockPlantingCycleFindUnique = jest.fn();

function evaluateCertGate(cert) {
    if (!cert) {
        return { gated: false, isValid: false, certExpired: false, status: null, minimalBody: () => ({}) };
    }
    return { gated: false, isValid: true, certExpired: false, status: 'active', minimalBody: () => ({}) };
}

function buildApp() {
    const router = express.Router();
    registerBatchAndLotRoutes(router, {
        prisma: { plantingCycle: { findUnique: (...a) => mockPlantingCycleFindUnique(...a) } },
        qrcodeService: { recordTraceScan: jest.fn().mockResolvedValue({ available: false, valid: null }) },
        logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
        getRequestIp: () => '127.0.0.1',
        normalizeSourceFromPayload: () => ({ plot: {}, cycle: {}, cultivationMethod: null }),
        parseJsonMetaFromNotes: () => null,
        PLOT_HARVEST_META_PREFIX: 'x',
        buildIntegrityPayload: () => ({}),
        logPublicTraceAccess: jest.fn().mockResolvedValue(undefined),
        TRACE_NOT_FOUND_MESSAGE: 'not found',
        formatThaiDate: (x) => (x ? String(x) : null),
        SAFETY_DISCLAIMER: 'disclaimer',
        FDA_REFERRAL: 'fda',
        evaluateCertGate,
    });
    const app = express();
    app.use('/trace', router);
    return app;
}

const CERT = { certificateNumber: 'CERT-X', issuedDate: null, expiryDate: null, status: 'active' };

// cycleFarmId is now carried IN the public projection (A3-layer-2b). Pass
// undefined to simulate a projection missing the field (fail-open path).
function batchObj(batchFarmId, cycleFarmId) {
    return {
        id: 'batch-1', batchNumber: 'B1', farmId: batchFarmId,
        farm: { id: 'farm-A', farmName: 'F', district: 'D', province: 'P' },
        harvestDate: null, freshWeight: 5, notes: null,
        lots: [],
        cycle: { id: 'cycle-1', farmId: cycleFarmId, cycleName: 'C1', certificate: { ...CERT } },
    };
}
function lotObj(batchFarmId, cycleFarmId) {
    return {
        id: 'lot-1', lotNumber: 'L1', batchId: 'batch-1', trackingUrl: null, testStatus: 'PASSED',
        packageType: 'BAG', unitWeight: 1, quantity: 1, totalWeight: 1,
        batch: {
            id: 'batch-1', batchNumber: 'B1', farmId: batchFarmId, harvestDate: null, notes: null,
            farm: { id: 'farm-A', farmName: 'F', district: 'D', province: 'P' },
            cycle: { id: 'cycle-1', farmId: cycleFarmId, cycleName: 'C1', certificate: { ...CERT } },
        },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockTrace.findActiveTraceIntegrityRecord.mockResolvedValue(null);
});

describe('A3 — /trace/batch drops a cross-farm cert (in-memory, no findUnique)', () => {
    test('cycle on a DIFFERENT farm → certificate null (dropped) WITHOUT a findUnique call', async () => {
        mockTrace.findPublicBatchByAnyIdentifier.mockResolvedValue(batchObj('farm-A', 'farm-B'));
        const res = await request(buildApp()).get('/trace/batch/batch-1');
        expect(res.status).toBe(200);
        expect(res.body.data.certificate).toBeNull();
        // CLEANUP-#7: the comparison is now purely in-memory.
        expect(mockPlantingCycleFindUnique).not.toHaveBeenCalled();
    });

    test('cycle on the SAME farm → certificate surfaced WITHOUT a findUnique call', async () => {
        mockTrace.findPublicBatchByAnyIdentifier.mockResolvedValue(batchObj('farm-A', 'farm-A'));
        const res = await request(buildApp()).get('/trace/batch/batch-1');
        expect(res.status).toBe(200);
        expect(res.body.data.certificate).not.toBeNull();
        expect(res.body.data.certificate.reference).toBe('CERT-X');
        expect(mockPlantingCycleFindUnique).not.toHaveBeenCalled();
    });

    test('MISSING cycle.farmId → fail OPEN (cert kept) WITHOUT a findUnique call', async () => {
        mockTrace.findPublicBatchByAnyIdentifier.mockResolvedValue(batchObj('farm-A', undefined));
        const res = await request(buildApp()).get('/trace/batch/batch-1');
        expect(res.status).toBe(200);
        expect(res.body.data.certificate).not.toBeNull();
        expect(mockPlantingCycleFindUnique).not.toHaveBeenCalled();
    });
});

describe('A3 — /trace/lot drops a cross-farm cert (in-memory, no findUnique)', () => {
    test('cycle on a DIFFERENT farm → certificate null (dropped) WITHOUT a findUnique call', async () => {
        mockTrace.findPublicLotByAnyIdentifier.mockResolvedValue(lotObj('farm-A', 'farm-B'));
        const res = await request(buildApp()).get('/trace/lot/lot-1');
        expect(res.status).toBe(200);
        expect(res.body.data.certificate).toBeNull();
        expect(mockPlantingCycleFindUnique).not.toHaveBeenCalled();
    });

    test('cycle on the SAME farm → certificate surfaced WITHOUT a findUnique call', async () => {
        mockTrace.findPublicLotByAnyIdentifier.mockResolvedValue(lotObj('farm-A', 'farm-A'));
        const res = await request(buildApp()).get('/trace/lot/lot-1');
        expect(res.status).toBe(200);
        expect(res.body.data.certificate).not.toBeNull();
        expect(mockPlantingCycleFindUnique).not.toHaveBeenCalled();
    });

    test('MISSING cycle.farmId → fail OPEN (cert kept) WITHOUT a findUnique call', async () => {
        mockTrace.findPublicLotByAnyIdentifier.mockResolvedValue(lotObj('farm-A', undefined));
        const res = await request(buildApp()).get('/trace/lot/lot-1');
        expect(res.status).toBe(200);
        expect(res.body.data.certificate).not.toBeNull();
        expect(mockPlantingCycleFindUnique).not.toHaveBeenCalled();
    });
});
