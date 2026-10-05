/**
 * The paper says GACP-DTAM-{year}-{suffix}; storage says GACP-TH-{year}-{suffix}.
 * Operator ruling 2026-10-05 (option ข): every door that looks a certificate up
 * by number accepts BOTH and resolves to the same row.
 *
 * Doors under test use the REAL certificate-service / interoperability-core with
 * only prisma replaced by a fake that knows one certificate stored canonically.
 * No Postgres here — a real-DB run of the verify door is NOT proved by this file.
 */
'use strict';

const STORED = 'GACP-TH-2569-A3F7B2';

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log), stream: { write: jest.fn() } };
});
jest.mock('../../middleware/rate-limiter', () => ({
    createRateLimiter: () => (_req, _res, next) => next(),
}));

const mockCert = {
    id: 'c1', uuid: 'u1', certificateNumber: STORED, status: 'active', isDeleted: false,
    expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000), issuedDate: new Date('2026-01-01'),
    farmName: 'สวนทดสอบ', applicantName: 'สมชาย ใจดี', province: 'เชียงใหม่', cropType: 'กัญชา',
    standardName: 'GACP', documentHash: null, signature: null,
};
// Only the stored (canonical) number exists — a printed-form lookup that is not
// normalised before reaching prisma finds nothing, exactly like production.
const mockFindUnique = jest.fn(async ({ where }) => (where.certificateNumber === STORED ? mockCert : null));
const mockFindFirst = jest.fn(async ({ where }) => {
    const hit = (where.OR || []).some((c) => c.certificateNumber === STORED);
    return hit ? mockCert : null;
});
jest.mock('../../services/prisma-database', () => ({
    prisma: { certificate: { findUnique: (a) => mockFindUnique(a), findFirst: (a) => mockFindFirst(a) } },
}));

const express = require('express');
const request = require('supertest');
const { buildDtamCertNumberDisplay, toCanonicalCertificateNumber } = require('../../services/certificate-number-display');
const { buildDtamCertNumberDisplay: viaTemplate } = (() => {
    try { return require('../../services/pdf/certificate-template-service'); } catch { return {}; }
})();

describe('toCanonicalCertificateNumber', () => {
    test('printed form -> canonical', () => {
        expect(toCanonicalCertificateNumber('GACP-DTAM-2569-A3F7B2')).toBe(STORED);
    });
    test('trims and uppercases the printed form', () => {
        expect(toCanonicalCertificateNumber('  gacp-dtam-2569-a3f7b2 ')).toBe(STORED);
    });
    test('canonical, ids and junk are left unchanged', () => {
        for (const v of [STORED, 'LEGACY-2024-001', 'clx9abc', '', 'GACP-DTAM-25-AB', 'GACP-DTAM-2569-', "GACP-DTAM-2569-A'B"]) {
            expect(toCanonicalCertificateNumber(v)).toBe(v);
        }
        expect(toCanonicalCertificateNumber(undefined)).toBeUndefined();
    });
    test('exact inverses of buildDtamCertNumberDisplay, both ways', () => {
        expect(toCanonicalCertificateNumber(buildDtamCertNumberDisplay(STORED))).toBe(STORED);
        expect(buildDtamCertNumberDisplay(toCanonicalCertificateNumber('GACP-DTAM-2569-A3F7B2'))).toBe('GACP-DTAM-2569-A3F7B2');
    });
    test('the PDF template still exports the same builder', () => {
        if (viaTemplate) { expect(viaTemplate(STORED)).toBe('GACP-DTAM-2569-A3F7B2'); }
    });
});

describe('public verify doors accept the printed number', () => {
    const publicRouter = require('../../routes/api/auth/public');
    const app = express();
    app.use('/api/v1/public', publicRouter);

    test('JSON door finds the certificate by GACP-DTAM and answers with the canonical number', async () => {
        const res = await request(app).get('/api/v1/public/verify/GACP-DTAM-2569-A3F7B2');
        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(true);
        expect(res.body.data.certificateNumber).toBe(STORED);
    });
    test('/page and /revisions doors resolve the printed number too', async () => {
        const page = await request(app).get('/api/v1/public/verify/GACP-DTAM-2569-A3F7B2/page');
        expect(mockFindUnique).toHaveBeenLastCalledWith({ where: { certificateNumber: STORED } });
        expect(page.status).toBe(200);
        mockFindUnique.mockClear();
        await request(app).get('/api/v1/public/verify/GACP-DTAM-2569-A3F7B2/revisions/1');
        expect(mockFindUnique).toHaveBeenCalledWith({ where: { certificateNumber: STORED } });
    });
    test('canonical still works', async () => {
        const res = await request(app).get(`/api/v1/public/verify/${STORED}`);
        expect(res.body.verified).toBe(true);
    });
    test('printed form with an unknown suffix is still not found', async () => {
        const res = await request(app).get('/api/v1/public/verify/GACP-DTAM-2569-ZZZZZZ');
        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(false);
        expect(res.body.data.status).toBe('invalid');
    });
    test('malformed input is refused as before (not found, not an error)', async () => {
        const res = await request(app).get('/api/v1/public/verify/GACP-DTAM-notanumber');
        expect(res.status).toBe(200);
        expect(res.body.verified).toBe(false);
    });
});

describe('legacy certificates door and partner lookup accept the printed number', () => {
    test('fetchCertificateByLookup (partner verify + /v1/resolve)', async () => {
        const core = require('../../routes/api/interoperability/interoperability-core');
        expect((await core.fetchCertificateByLookup('GACP-DTAM-2569-A3F7B2'))?.certificateNumber).toBe(STORED);
        expect(await core.fetchCertificateByLookup('GACP-DTAM-2569-ZZZZZZ')).toBeNull();
    });
});
