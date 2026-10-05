'use strict';

/**
 * Routes for สัญญา C05F680149 ต้นแบบที่ 1 (ระบบวิเคราะห์มาตรฐาน GACP 3 ระบบ),
 * mounted at /api/standards (routes/api/certificates/standards.js):
 *
 *   GET /                          — list active standards (pre-existing)
 *   GET /asean/comparison          — 1.3 ASEAN 10-country reference table (public)
 *   GET /:code/analyze/:appId      — 1.1/1.2 gap analysis (authenticateAny;
 *                                    HEALTH owner or any provider role)
 *
 * Auth middleware is mocked: x-test-user header injects req.user, absence → 401
 * (mirrors the real authenticateAny contract for unit purposes).
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateAny: (req, res, next) => {
        const raw = req.headers['x-test-user'];
        if (!raw) {
            return res.status(401).json({ success: false, error: 'Unauthorized', code: 'NO_TOKEN' });
        }
        req.user = JSON.parse(raw);
        next();
    },
}));

const mockAnalyze = jest.fn();
const mockListStandards = jest.fn();

jest.mock('../../services/standards-analyzer-service', () => ({
    analyzeApplication: (...a) => mockAnalyze(...a),
    // requireActual the PURE data module, not the service — the real service
    // drags services/prisma-database which process.exit(1)s without
    // DATABASE_URL (the project rules test gotcha: never load DB-importing modules
    // un-mocked in unit tests).
    getAseanComparison: () =>
        jest.requireActual('../../data/standards/asean-gacp-comparison').ASEAN_COMPARISON,
}));

jest.mock('../../services/certificate-service', () => ({
    listActiveStandards: (...a) => mockListStandards(...a),
}));

const standardsRouter = require('../../routes/api/certificates/standards');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/standards', standardsRouter);
    return app;
}

const APP_ID = '11111111-1111-4111-8111-111111111111';

describe('GET /api/standards/asean/comparison', () => {
    test('returns the 10-country reference table without auth (public reference data)', async () => {
        const res = await request(makeApp()).get('/api/standards/asean/comparison');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(10);
        expect(res.body.count).toBe(10);
    });
});

describe('GET /api/standards/:code/analyze/:applicationId', () => {
    beforeEach(() => jest.clearAllMocks());

    test('no token → 401 (authenticateAny gate)', async () => {
        const res = await request(makeApp()).get(`/api/standards/WHO/analyze/${APP_ID}`);
        expect(res.status).toBe(401);
        expect(mockAnalyze).not.toHaveBeenCalled();
    });

    test('provider actor → 200 with analysis payload; actor forwarded to service', async () => {
        mockAnalyze.mockResolvedValue({ standard: { code: 'WHO' }, requirements: [], summary: { total: 0 } });
        const res = await request(makeApp())
            .get(`/api/standards/who/analyze/${APP_ID}`)
            .set('x-test-user', JSON.stringify({ canonicalRole: 'DOCUMENT_REVIEWER', canonicalId: 'tok_staff' }));

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.standard.code).toBe('WHO');
        expect(mockAnalyze).toHaveBeenCalledWith(APP_ID, 'who', expect.objectContaining({
            actor: expect.objectContaining({ role: expect.any(String), canonicalId: 'tok_staff' }),
        }));
    });

    test('service 404 (STANDARD_NOT_FOUND) propagates statusCode + code', async () => {
        const err = new Error('Unknown certification standard');
        err.statusCode = 404;
        err.code = 'STANDARD_NOT_FOUND';
        mockAnalyze.mockRejectedValue(err);

        const res = await request(makeApp())
            .get(`/api/standards/NOPE/analyze/${APP_ID}`)
            .set('x-test-user', JSON.stringify({ canonicalRole: 'ADMIN', canonicalId: 'tok_admin' }));

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('STANDARD_NOT_FOUND');
    });

    test('invalid application id (not a UUID) → 400 without hitting the service', async () => {
        const res = await request(makeApp())
            .get('/api/standards/WHO/analyze/not-a-uuid')
            .set('x-test-user', JSON.stringify({ canonicalRole: 'ADMIN', canonicalId: 'tok_admin' }));

        expect(res.status).toBe(400);
        expect(mockAnalyze).not.toHaveBeenCalled();
    });

    test('unexpected service error → 500 generic (no stack leak)', async () => {
        mockAnalyze.mockRejectedValue(new Error('boom'));
        const res = await request(makeApp())
            .get(`/api/standards/WHO/analyze/${APP_ID}`)
            .set('x-test-user', JSON.stringify({ canonicalRole: 'ADMIN', canonicalId: 'tok_admin' }));

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});
