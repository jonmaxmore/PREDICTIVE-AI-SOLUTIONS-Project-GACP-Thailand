/**
 * Round 2 (operator 2026-10-05): the certificate number is the real DTAM style
 * `TH-GACP {n}/{ปี พ.ศ.}` — no zero padding, restarting at 1 each Buddhist year.
 * URLs and the QR carry the slug `TH-GACP-{n}-{ปี}`. Both spell one certificate.
 *
 * Prisma is replaced by an in-memory counter store that behaves like the
 * ReceiptSequence upsert (one row per prefix+year, increment on hit). A real
 * Postgres concurrency run lives in integration/certificate-number-allocation-real-postgres.test.js
 * and self-skips without a test database.
 */
'use strict';

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log), stream: { write: jest.fn() } };
});
jest.mock('../../middleware/rate-limiter', () => ({
    createRateLimiter: () => (_req, _res, next) => next(),
}));

const STORED = 'TH-GACP 87/2568';
const LEGACY = 'GACP-TH-2569-A3F7B2';

const mockRows = new Map();
const mockFindUnique = jest.fn(async ({ where }) => (where.certificateNumber === STORED ? mockCert(STORED) : where.certificateNumber === LEGACY ? mockCert(LEGACY) : null));
const mockFindFirst = jest.fn(async ({ where }) => {
    const hit = (where.OR || []).map((c) => c.certificateNumber).find((n) => n === STORED || n === LEGACY);
    return hit ? mockCert(hit) : null;
});
function mockCert(certificateNumber) {
    return {
        id: 'c1', uuid: 'u1', certificateNumber, status: 'active', isDeleted: false,
        expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000), issuedDate: new Date('2026-01-01'),
        farmName: 'สวนทดสอบ', applicantName: 'สมชาย ใจดี', province: 'เชียงใหม่', cropType: 'กัญชา',
        standardName: 'GACP', documentHash: null, signature: null,
    };
}
const mockPrisma = {
    certificate: { findUnique: (a) => mockFindUnique(a), findFirst: (a) => mockFindFirst(a) },
    receiptSequence: {
        upsert: jest.fn(async ({ where, create, update }) => {
            await Promise.resolve();
            const k = `${where.prefix_year.prefix}|${where.prefix_year.year}`;
            const row = mockRows.get(k);
            if (!row) { mockRows.set(k, { counter: create.counter }); return { counter: create.counter }; }
            row.counter += update.counter.increment;
            return { counter: row.counter };
        }),
    },
};
jest.mock('../../services/prisma-database', () => ({ get prisma() { return mockPrisma; } }));

const express = require('express');
const request = require('supertest');
const {
    toCanonicalCertificateNumber, toCertificateSlug, buildDtamCertNumberDisplay,
} = require('../../services/certificate-number-display');

describe('normaliser: every accepted spelling maps to the stored value', () => {
    test.each([
        'TH-GACP 87/2568', 'TH-GACP-87-2568', 'th-gacp 87/2568', '  TH-GACP   87 / 2568 ', 'Th-Gacp-87-2568',
    ])('%s -> stored', (input) => {
        expect(toCanonicalCertificateNumber(input)).toBe(STORED);
    });
    test('legacy forms, any case, map to GACP-TH', () => {
        for (const v of ['GACP-TH-2569-A3F7B2', 'GACP-DTAM-2569-A3F7B2', 'gacp-th-2569-a3f7b2', 'gacp-dtam-2569-a3f7b2']) {
            expect(toCanonicalCertificateNumber(v)).toBe(LEGACY);
        }
    });
    test('slug and display round-trip', () => {
        expect(toCertificateSlug(STORED)).toBe('TH-GACP-87-2568');
        expect(toCanonicalCertificateNumber(toCertificateSlug(STORED))).toBe(STORED);
        expect(toCertificateSlug(toCanonicalCertificateNumber('th-gacp 1/2569'))).toBe('TH-GACP-1-2569');
    });
    test('slug leaves legacy numbers and ids alone; new numbers pass the legacy projection unchanged', () => {
        expect(toCertificateSlug(LEGACY)).toBe(LEGACY);
        expect(toCertificateSlug('clx9abc')).toBe('clx9abc');
        expect(buildDtamCertNumberDisplay(STORED)).toBe(STORED);
        expect(buildDtamCertNumberDisplay(LEGACY)).toBe('GACP-DTAM-2569-A3F7B2');
    });
    test('junk is left unchanged', () => {
        for (const v of ['TH-GACP', 'TH-GACP 87', 'TH-GACP 87/25', 'TH-GACP x/2568', 'clx9abc', '']) {
            expect(toCanonicalCertificateNumber(v)).toBe(v);
        }
    });
});

describe('allocation: running number per Buddhist year, Bangkok business date', () => {
    const allocateCertificateNumber = (a) => require('../../services/certificate-number-allocator').allocateCertificateNumber(a);
    beforeEach(() => mockRows.clear());

    test('first of 2569 is 1, the next is 2, a new year restarts at 1, no padding', async () => {
        const d2569 = new Date('2026-03-01T05:00:00Z');
        expect(await allocateCertificateNumber({ client: mockPrisma, issuedDate: d2569 })).toBe('TH-GACP 1/2569');
        expect(await allocateCertificateNumber({ client: mockPrisma, issuedDate: d2569 })).toBe('TH-GACP 2/2569');
        expect(await allocateCertificateNumber({ client: mockPrisma, issuedDate: new Date('2027-02-01T05:00:00Z') })).toBe('TH-GACP 1/2570');
        expect(await allocateCertificateNumber({ client: mockPrisma, issuedDate: d2569 })).toBe('TH-GACP 3/2569');
    });
    test('the year boundary is Bangkok midnight, not UTC', async () => {
        // 2026-12-31T18:00Z is 2027-01-01 01:00 in Bangkok
        expect(await allocateCertificateNumber({ client: mockPrisma, issuedDate: new Date('2026-12-31T18:00:00Z') })).toBe('TH-GACP 1/2570');
    });
    test('concurrent allocations never share a number', async () => {
        const d = new Date('2026-03-01T05:00:00Z');
        const got = await Promise.all(Array.from({ length: 25 }, () => allocateCertificateNumber({ client: mockPrisma, issuedDate: d })));
        expect(new Set(got).size).toBe(25);
    });
});

describe('verify URL / QR carry the slug and it resolves', () => {
    test('buildCertVerifyUrl uses the slug; legacy unchanged', () => {
        const { buildCertVerifyUrl } = require('../../services/certificate-verify-url');
        expect(buildCertVerifyUrl(STORED).endsWith('/TH-GACP-87-2568')).toBe(true);
        expect(buildCertVerifyUrl(STORED)).not.toMatch(/[ %]|\/2568$/);
        expect(buildCertVerifyUrl(LEGACY).endsWith(`/${LEGACY}`)).toBe(true);
    });
    test('publicVerifyUrlFor fallback uses the slug', () => {
        const { publicVerifyUrlFor } = require('../../services/qrcode/public-trace-url');
        expect(publicVerifyUrlFor('http://127.0.0.1:8099/verify/x', STORED).endsWith('/TH-GACP-87-2568')).toBe(true);
    });
    test('the QR url path resolves through the partner resolver', async () => {
        const { buildCertVerifyUrl } = require('../../services/certificate-verify-url');
        const { resolveScannedCode } = require('../../routes/api/interoperability/interoperability-resolve');
        const { result: out } = await resolveScannedCode(buildCertVerifyUrl(STORED));
        expect(out.matched.entityId).toBe(STORED);
        const bare = await resolveScannedCode('TH-GACP 87/2568');
        expect(bare.probed).toEqual(['certificate']);
        expect(bare.result.matched.entityId).toBe(STORED);
        expect(out.links.publicVerify.endsWith('/verify/TH-GACP-87-2568')).toBe(true);
        expect(out.links.traceEvents).not.toMatch(/[ /]2568|TH-GACP 87/);
    });
    test('partner links carry the slug', async () => {
        const { fetchCertificateByLookup } = require('../../routes/api/interoperability/interoperability-core');
        expect((await fetchCertificateByLookup('TH-GACP-87-2568')).certificateNumber).toBe(STORED);
    });
});

describe('verify door finds the certificate by display, slug and legacy forms', () => {
    const publicRouter = require('../../routes/api/auth/public');
    const app = express();
    app.use('/api/v1/public', publicRouter);

    test.each([
        ['TH-GACP-87-2568', STORED], [encodeURIComponent('TH-GACP 87/2568'), STORED],
        ['th-gacp-87-2568', STORED], ['gacp-dtam-2569-a3f7b2', LEGACY], ['gacp-th-2569-a3f7b2', LEGACY],
    ])('%s', async (param, stored) => {
        const res = await request(app).get(`/api/v1/public/verify/${param}`);
        expect(res.body.verified).toBe(true);
        expect(res.body.data.certificateNumber).toBe(stored);
    });
    test('unknown numbers are still not found', async () => {
        const res = await request(app).get('/api/v1/public/verify/TH-GACP-999-2568');
        expect(res.body.verified).toBe(false);
    });
});
