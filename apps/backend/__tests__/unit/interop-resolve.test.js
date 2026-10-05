'use strict';

/**
 * DTAM Next partner integration (owner directive 2026-07-08): universal code
 * resolver — GET /interoperability/v1/resolve?code=<anything scanned>.
 *
 * DTAM Next (กลางน้ำ/ปลายน้ำ) scans a QR / receives a code string and asks the
 * upstream (us): "what is this + its provenance?" Existing /v1/trace/events
 * requires knowing entityType up front; this endpoint classifies ANY of the
 * live identifier shapes and returns type + PII-safe provenance + HATEOAS
 * links, behind the SAME partner key + export limiter as the other partner
 * endpoints (SEC-AUDIT-012 pattern).
 *
 * Documented probe precedence (the contract):
 *   0. URL normalization — full https URLs, /trace/<type>/<code>, /verify/<cert>,
 *      legacy doubled /trace/trace/<kind>/<qr>.
 *   1. Deterministic prefixes: GACP-*=certificate · BT-=batch qrCode ·
 *      BATCH-=batchNumber. (UNIT-=plant code and PU-=plant qrCode were
 *      withdrawn on 2026-08-25 when R8 retired per-plant tracking.)
 *   2. LOT- (ambiguous by data): Lot.lotNumber FIRST, then legacy
 *      HarvestBatch.batchNumber.
 *   3. TraceQrSecurity.qrCode unique index (covers plot-cycle UUIDs +
 *      batch/lot qrCode UUIDs in one query).
 *   4. Bare-string cascade: certificate → plant unit → planting cycle →
 *      harvest batch → lot.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockCertFindFirst = jest.fn();
const mockPlantFindFirst = jest.fn();
const mockCycleFindFirst = jest.fn();
const mockBatchFindFirst = jest.fn();
const mockLotFindFirst = jest.fn();
const mockCyclePlotFindFirst = jest.fn();
const mockTraceQrFindUnique = jest.fn();
const mockTraceQrFindFirst = jest.fn();

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: { findFirst: (...a) => mockCertFindFirst(...a) },
        // The `plantUnit` delegate stays WIRED here on purpose while every other
        // suite drops it: the PU-*/UNIT-* test below arms it with a full row and
        // asserts it is never touched. Unwiring it would silently defang that
        // tripwire — a re-added probe would then throw rather than prove the
        // resolver reached for a PlantUnit. (Spec R8, 2026-08-25.)
        plantUnit: { findFirst: (...a) => mockPlantFindFirst(...a) },
        plantingCycle: { findFirst: (...a) => mockCycleFindFirst(...a) },
        harvestBatch: { findFirst: (...a) => mockBatchFindFirst(...a) },
        lot: { findFirst: (...a) => mockLotFindFirst(...a) },
        plantingCyclePlot: { findFirst: (...a) => mockCyclePlotFindFirst(...a) },
        traceQrSecurity: {
            findUnique: (...a) => mockTraceQrFindUnique(...a),
            findFirst: (...a) => mockTraceQrFindFirst(...a),
        },
        // Legacy surface used elsewhere in the interop router.
        application: { findFirst: jest.fn() },
    },
}));

// Best-effort partner access log — must NEVER break the request.
const mockRecordPartnerAccess = jest.fn().mockResolvedValue(null);
jest.mock('../../services/partner-access-log', () => ({
    recordPartnerAccess: (...a) => mockRecordPartnerAccess(...a),
}));

// The heavy services the interop router pulls transitively.
jest.mock('../../services/certificate-service', () => ({
    revokeCertificate: jest.fn(),
}));
jest.mock('../../services/qrcode/qrcode-service', () => ({
    verifyTraceIntegrity: jest.fn(async () => ({ available: false })),
}));

const { requirePartnerApiKey } = require('../../middleware/partner-api-key');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/interoperability', require('../../routes/api/integration/interoperability'));
    return app;
}

// REAL Farm shape: the display column is farmName (NOT name) — the resolver
// maps it to provenance.farm.name. Caught live (500 Unknown field `name`).
const FARM = { farmName: 'ฟาร์มทดสอบ', province: 'เชียงใหม่', district: 'แม่ริม' };
const CERT = {
    id: 'cert-uuid-1', uuid: 'cert-uuid-1b', certificateNumber: 'GACP-TH-2569-A3F7B2',
    status: 'ACTIVE', expiryDate: new Date(Date.now() + 86400000), isDeleted: false,
    issuedDate: new Date('2026-01-01'), standard: 'GACP',
    farm: { id: 'farm-1', ...FARM },
    application: { id: 'app-1', applicationNumber: 'APP-1', status: 'CERTIFIED', updatedAt: new Date() },
};

beforeAll(() => {
    process.env.INTEROP_PARTNER_API_KEYS = JSON.stringify({ 'dtam-next': 'test-key-123' });
    requirePartnerApiKey._reload();
});

beforeEach(() => {
    jest.clearAllMocks();
    mockRecordPartnerAccess.mockResolvedValue(null);
    for (const m of [mockCertFindFirst, mockPlantFindFirst, mockCycleFindFirst,
        mockBatchFindFirst, mockLotFindFirst, mockCyclePlotFindFirst,
        mockTraceQrFindUnique, mockTraceQrFindFirst]) {
        m.mockResolvedValue(null);
    }
});

const KEY = { 'x-api-key': 'test-key-123' };

describe('GET /interoperability/v1/resolve — partner gate', () => {
    test('401 without a partner key (fail-closed like every partner endpoint)', async () => {
        const res = await request(buildApp()).get('/interoperability/v1/resolve?code=GACP-TH-2569-A3F7B2');
        expect(res.status).toBe(401);
    });

    test('400 when code param is missing/blank', async () => {
        const res = await request(buildApp()).get('/interoperability/v1/resolve').set(KEY);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('RESOLVE_CODE_REQUIRED');
    });
});

describe('GET /interoperability/v1/resolve — deterministic prefixes', () => {
    test('GACP-* resolves a certificate with trust status + PII-safe provenance (no applicantName)', async () => {
        mockCertFindFirst.mockResolvedValue({ ...CERT });
        const res = await request(buildApp())
            .get('/interoperability/v1/resolve?code=GACP-TH-2569-A3F7B2').set(KEY);

        expect(res.status).toBe(200);
        expect(res.body.resolved).toBe(true);
        expect(res.body.matched).toMatchObject({ entityType: 'CERTIFICATE', keyKind: 'certificateNumber' });
        expect(res.body.trust).toMatchObject({ trustStatus: 'ACTIVE' });
        expect(res.body.links.traceEvents).toContain('/trace/events/CERTIFICATE/');
        // PDPA: the resolver must never carry applicant PII.
        expect(JSON.stringify(res.body)).not.toMatch(/applicantName/);
    });

    test('PU-* and UNIT-* no longer resolve — per-plant tracking is retired (R8)', async () => {
        // R8 (design note 2026-08-20-planting-tnt-design) retired
        // per-plant tracking on 2026-08-25, and probePlantUnit went with it. These
        // prefixes were the per-plant QR and per-plant code families.
        //
        // The mock is armed with a full row on purpose: if a probe is ever wired
        // back up it will find something and return 200, so this test fails loudly
        // instead of passing because the fixture happened to be empty.
        mockPlantFindFirst.mockResolvedValue({
            id: 'unit-1', code: 'UNIT-2026-AB12-00001', qrCode: 'PU-1780000000000-A1B2C3',
            status: 'HARVESTED',
            cycle: { id: 'cyc-1', status: 'HARVESTING', farm: { ...FARM }, certificate: null },
        });

        for (const code of ['PU-1780000000000-A1B2C3', 'UNIT-2026-AB12-00001']) {
            const res = await request(buildApp())
                .get(`/interoperability/v1/resolve?code=${code}`).set(KEY);

            expect(res.status).toBe(404);
            expect(res.body).toMatchObject({ success: false, resolved: false, code });
            // 404 with the probe list, not a 5xx and not a hollow 200: an unknown
            // code is a real answer for a family the platform no longer tracks.
            expect(Array.isArray(res.body.probed)).toBe(true);
        }
        expect(mockPlantFindFirst).not.toHaveBeenCalled();
    });

    test('BATCH-* resolves a harvest batch by batchNumber', async () => {
        mockBatchFindFirst.mockResolvedValue({
            id: 'batch-1', batchNumber: 'BATCH-2026-000123', qrCode: 'some-uuid', isDeleted: false,
            farm: { ...FARM }, cycle: { certificate: { certificateNumber: CERT.certificateNumber, status: 'ACTIVE' } },
        });
        const res = await request(buildApp())
            .get('/interoperability/v1/resolve?code=BATCH-2026-000123').set(KEY);
        expect(res.status).toBe(200);
        expect(res.body.matched).toMatchObject({ entityType: 'HARVEST_BATCH', keyKind: 'batchNumber' });
    });

    test('LOT-* probes Lot.lotNumber FIRST, then falls back to legacy batchNumber', async () => {
        mockLotFindFirst.mockResolvedValue({
            id: 'lot-1', lotNumber: 'LOT-2026-000123-A', isDeleted: false,
            batch: { id: 'batch-1', batchNumber: 'BATCH-2026-000123', farm: { ...FARM }, cycle: { certificate: { certificateNumber: CERT.certificateNumber } } },
        });
        const res = await request(buildApp())
            .get('/interoperability/v1/resolve?code=LOT-2026-000123-A').set(KEY);
        expect(res.status).toBe(200);
        expect(res.body.matched).toMatchObject({ entityType: 'PACKAGING_LOT', keyKind: 'lotNumber' });

        // legacy: no lot matches, a LEGACY batchNumber does
        jest.clearAllMocks();
        mockLotFindFirst.mockResolvedValue(null);
        mockBatchFindFirst.mockResolvedValue({
            id: 'batch-9', batchNumber: 'LOT-2026-F4RM-001', isDeleted: false,
            farm: { ...FARM }, cycle: null,
        });
        const res2 = await request(buildApp())
            .get('/interoperability/v1/resolve?code=LOT-2026-F4RM-001').set(KEY);
        expect(res2.status).toBe(200);
        expect(res2.body.matched).toMatchObject({ entityType: 'HARVEST_BATCH', keyKind: 'batchNumber' });
    });
});

describe('GET /interoperability/v1/resolve — URL normalization', () => {
    test('a /trace/plant/ URL does not resolve, plain or legacy-doubled (R8)', async () => {
        // The URL still parses — the doubled-/trace/ stripping is still exercised —
        // but 'plant' is no longer a family the resolver knows, so the code falls
        // through to the untyped cascade and comes back unmatched. Per-plant
        // tracking was retired on 2026-08-25.
        mockPlantFindFirst.mockResolvedValue({
            id: 'unit-1', code: 'UNIT-2026-AB12-00001', qrCode: 'PU-1780000000000-A1B2C3',
            status: 'GROWING',
            cycle: { farm: { ...FARM }, certificate: null },
        });

        const url = encodeURIComponent('https://gacpth.com/trace/plant/PU-1780000000000-A1B2C3');
        const res = await request(buildApp()).get(`/interoperability/v1/resolve?code=${url}`).set(KEY);
        expect(res.status).toBe(404);
        expect(res.body.resolved).toBe(false);

        const doubled = encodeURIComponent('https://staging.gacpth.com/trace/trace/plant/PU-1780000000000-A1B2C3');
        const res2 = await request(buildApp()).get(`/interoperability/v1/resolve?code=${doubled}`).set(KEY);
        expect(res2.status).toBe(404);
        expect(res2.body.resolved).toBe(false);

        expect(mockPlantFindFirst).not.toHaveBeenCalled();
    });

    test('cert verify URL (gacpth.com/verify/<n>) resolves the certificate', async () => {
        mockCertFindFirst.mockResolvedValue({ ...CERT });
        const url = encodeURIComponent('https://gacpth.com/verify/GACP-TH-2569-A3F7B2');
        const res = await request(buildApp()).get(`/interoperability/v1/resolve?code=${url}`).set(KEY);
        expect(res.status).toBe(200);
        expect(res.body.matched.entityType).toBe('CERTIFICATE');
    });
});

describe('GET /interoperability/v1/resolve — TraceQrSecurity index + cascade', () => {
    test('bare UUID found in the TraceQrSecurity index resolves a plot-cycle QR', async () => {
        mockTraceQrFindUnique.mockResolvedValue({
            qrCode: '3f0a2b1c-aaaa-bbbb-cccc-1234567890ab',
            entityType: 'PLANTING_CYCLE_PLOT', entityId: 'cycleplot-1',
            status: 'ACTIVE', scanCount: 7,
        });
        mockCyclePlotFindFirst.mockResolvedValue({
            id: 'cycleplot-1',
            cycle: { id: 'cyc-1', farm: { ...FARM }, certificate: { certificateNumber: CERT.certificateNumber, status: 'ACTIVE' } },
        });
        const res = await request(buildApp())
            .get('/interoperability/v1/resolve?code=3f0a2b1c-aaaa-bbbb-cccc-1234567890ab').set(KEY);
        expect(res.status).toBe(200);
        expect(res.body.matched).toMatchObject({ entityType: 'PLANTING_CYCLE_PLOT', keyKind: 'traceQrIndex' });
        expect(res.body.seal).toMatchObject({ sealed: true, scanCount: 7 });
        expect(res.body.links.publicTrace).toContain('/trace/plot-cycle/');
    });

    test('unknown code → 404 resolved:false with the probe trail', async () => {
        const res = await request(buildApp())
            .get('/interoperability/v1/resolve?code=totally-unknown-junk').set(KEY);
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ success: false, resolved: false });
        expect(Array.isArray(res.body.probed)).toBe(true);
    });
});

describe('partner access log — best-effort, never breaks the request', () => {
    test('a resolved call records partnerId + endpoint', async () => {
        mockCertFindFirst.mockResolvedValue({ ...CERT });
        await request(buildApp()).get('/interoperability/v1/resolve?code=GACP-TH-2569-A3F7B2').set(KEY);
        expect(mockRecordPartnerAccess).toHaveBeenCalledWith(expect.objectContaining({
            partnerId: 'dtam-next',
        }));
    });

    test('an access-log failure does NOT fail the request', async () => {
        mockRecordPartnerAccess.mockRejectedValue(new Error('db down'));
        mockCertFindFirst.mockResolvedValue({ ...CERT });
        const res = await request(buildApp())
            .get('/interoperability/v1/resolve?code=GACP-TH-2569-A3F7B2').set(KEY);
        expect(res.status).toBe(200);
    });
});
