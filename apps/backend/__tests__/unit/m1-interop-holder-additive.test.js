'use strict';

/**
 * M1 / plan D12 — the holder name travels to partner systems ADDITIVELY.
 *
 * The e-certificate envelope (interoperability-core.js buildCertificateEnvelope)
 * is a standing contract with external agencies. M1 moves the weight of "who
 * holds this certificate" from the person to the farm/entity, so partners need
 * `holderDisplayName` + `holderType` — but every field they already parse
 * (`subject.applicantName` above all) must keep its old name AND its old value.
 * Adding fields is a MINOR schema change, so `ECERT_SCHEMA_VERSION` moves
 * 1.0.0 → 1.1.0: a partner pinned on "1.x" keeps working, and one that pins the
 * exact string learns there is something new to read.
 *
 * The trust registry search is the other partner-visible reader: a partner that
 * searches for the farm/company name must now find the certificate by its
 * HOLDER name too, without losing any of the three existing search columns.
 */

const express = require('express');
const request = require('supertest');

process.env.INTEROP_PARTNER_API_KEYS = JSON.stringify({ 'test-partner': 'valid-partner-key' });

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => {
        req.user = { id: 'provider-1', role: 'ADMIN', canonicalRole: 'ADMIN' };
        next();
    },
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
        plantingCycle: { findFirst: jest.fn() },
        harvestBatch: { findFirst: jest.fn() },
        lot: { findFirst: jest.fn() },
        // No `plantUnit` delegate: the interoperability resolver stopped resolving a
        // PLANT_UNIT entity on 2026-08-25 (R8 of design notes
        // 2026-08-20-planting-tnt-design.md retires per-plant tracking). A re-added
        // branch fails loudly here instead of reading a mocked null.
        traceQrSecurity: { findFirst: jest.fn() },
    },
}));

jest.mock('../../services/crypto/signature-service', () => ({
    getSignatureService: jest.fn(() => ({
        sign: jest.fn().mockResolvedValue('mock-signature'),
        verify: jest.fn().mockResolvedValue(true),
        getPublicKey: jest.fn().mockResolvedValue('mock-public-key'),
    })),
}));

jest.mock('../../shared/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const { prisma } = require('../../services/prisma-database');
const { requirePartnerApiKey } = require('../../middleware/partner-api-key');
requirePartnerApiKey._reload();

const { buildCertificateEnvelope } = require('../../routes/api/interoperability/interoperability-core');
const { ECERT_SCHEMA_VERSION } = require('../../routes/api/interoperability/interoperability-contracts');
const interoperabilityRouter = require('../../routes/api/integration/interoperability');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/interoperability', interoperabilityRouter);
    return app;
}

const JURISTIC_CERT = {
    id: 'cert-1',
    certificateNumber: 'GACP-TH-2569-A3F7B2',
    status: 'ACTIVE',
    issuedDate: new Date('2026-01-01'),
    expiryDate: new Date('2027-01-01'),
    farmName: 'ฟาร์มสมุนไพรบ้านนา',
    applicantName: 'สมชาย ใจดี',
    cropType: 'ขมิ้นชัน',
    userId: 'user-1',
    province: 'เชียงใหม่',
    district: 'แม่ริม',
    holderDisplayName: 'บริษัท สมุนไพรไทย จำกัด',
    holderType: 'JURISTIC',
};

describe('M1 D12 — e-certificate envelope carries the holder additively', () => {
    test('schema version is bumped MINOR (additive change, partners on 1.x survive)', () => {
        expect(ECERT_SCHEMA_VERSION).toBe('DTAM_ECERT_SCHEMA_1.1.0');
    });

    test('subject gains holderDisplayName + holderType', () => {
        const envelope = buildCertificateEnvelope(JURISTIC_CERT, 'https://gacpth.com');
        expect(envelope.subject.holderDisplayName).toBe('บริษัท สมุนไพรไทย จำกัด');
        expect(envelope.subject.holderType).toBe('JURISTIC');
        expect(envelope.schemaVersion).toBe('DTAM_ECERT_SCHEMA_1.1.0');
    });

    test('every pre-M1 subject field keeps its name AND its value (no silent re-meaning)', () => {
        const envelope = buildCertificateEnvelope(JURISTIC_CERT, 'https://gacpth.com');
        expect(envelope.subject).toMatchObject({
            certificateNumber: 'GACP-TH-2569-A3F7B2',
            applicantName: 'สมชาย ใจดี',
            farmName: 'ฟาร์มสมุนไพรบ้านนา',
            cropType: 'ขมิ้นชัน',
        });
        expect(typeof envelope.subject.userIdHash).toBe('string');
        expect(envelope.subject.userIdHash).toHaveLength(64);
    });

    test('a pre-backfill row (no holder columns) still emits both keys as null, not undefined', () => {
        const legacy = { ...JURISTIC_CERT };
        delete legacy.holderDisplayName;
        delete legacy.holderType;
        const envelope = buildCertificateEnvelope(legacy, 'https://gacpth.com');
        expect(envelope.subject.holderDisplayName).toBeNull();
        expect(envelope.subject.holderType).toBeNull();
        // A partner parsing JSON must see the keys, not a hole.
        const parsed = JSON.parse(JSON.stringify(envelope));
        expect(Object.keys(parsed.subject)).toEqual(
            expect.arrayContaining(['holderDisplayName', 'holderType', 'applicantName']),
        );
    });
});

describe('M1 D12 — trust registry search finds a certificate by its holder name', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        prisma.certificate.findMany.mockResolvedValue([]);
    });

    test('search OR adds holderDisplayName and keeps all three existing columns', async () => {
        const res = await request(buildApp())
            .get('/api/interoperability/v1/trust/registry?search=สมุนไพรไทย')
            .set('x-api-key', 'valid-partner-key');

        expect(res.status).toBe(200);
        expect(prisma.certificate.findMany).toHaveBeenCalledTimes(1);
        const { where } = prisma.certificate.findMany.mock.calls[0][0];
        expect(where.OR).toEqual(expect.arrayContaining([
            { certificateNumber: { contains: 'สมุนไพรไทย', mode: 'insensitive' } },
            { farmName: { contains: 'สมุนไพรไทย', mode: 'insensitive' } },
            { applicantName: { contains: 'สมุนไพรไทย', mode: 'insensitive' } },
            { holderDisplayName: { contains: 'สมุนไพรไทย', mode: 'insensitive' } },
        ]));
        expect(where.OR).toHaveLength(4);
    });

    test('no search term → no OR clause at all (unchanged behaviour)', async () => {
        const res = await request(buildApp())
            .get('/api/interoperability/v1/trust/registry')
            .set('x-api-key', 'valid-partner-key');

        expect(res.status).toBe(200);
        const { where } = prisma.certificate.findMany.mock.calls[0][0];
        expect(where.OR).toBeUndefined();
        expect(where.isDeleted).toBe(false);
    });
});
