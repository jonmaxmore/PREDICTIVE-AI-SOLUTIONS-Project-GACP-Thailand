'use strict';

/**
 * Image Assessment routes — สัญญา C05F680149 ต้นแบบที่ 6, mounted at
 * /api/image-assessment (routes/api/audit/image-assessment.js):
 *
 *   GET  /catalog          — 3-module catalog (AUDIT_STAFF)
 *   POST /assess           — multipart image → 6.1 inspection + 6.3 disease
 *   POST /quality-score    — JSON sub-scores → 6.2 score + certificate
 *   POST /evaluate         — JSON labelled samples → KPI ≥85% confusion matrix
 *
 * Auth mocked: x-test-user injects req.user; requireRole checks AUDIT_STAFF.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

// Auth: inject user; requireRole(group) → 403 unless role ∈ group.
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, res, next) => {
        const raw = req.headers['x-test-user'];
        if (!raw) { return res.status(401).json({ success: false, code: 'NO_TOKEN' }); }
        req.user = JSON.parse(raw);
        next();
    },
    requireRole: (allowed) => (req, res, next) => {
        if (!allowed.includes(req.user?.role)) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        next();
    },
}));

jest.mock('../../shared/canonical-rbac', () => ({
    ROLE_GROUPS: { AUDIT_STAFF: ['ADMIN', 'AUDITOR', 'DOCUMENT_REVIEWER'] },
}));

const mockService = {
    getCatalog: jest.fn(),
    assessImage: jest.fn(),
    scoreProductQuality: jest.fn(),
    evaluateModel: jest.fn(),
};
jest.mock('../../services/image-assessment/image-assessment-service', () => mockService);

const router = require('../../routes/api/audit/image-assessment');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/image-assessment', router);
    return app;
}

const AUDITOR = JSON.stringify({ id: 'aud-uuid', role: 'AUDITOR' });
const HEALTH = JSON.stringify({ id: 'h-uuid', role: 'HEALTH' });

beforeEach(() => jest.clearAllMocks());

describe('GET /catalog', () => {
    test('no token → 401', async () => {
        const res = await request(makeApp()).get('/api/image-assessment/catalog');
        expect(res.status).toBe(401);
    });
    test('AUDIT_STAFF → 200 catalog', async () => {
        mockService.getCatalog.mockReturnValue({ diseases: [], qualityDimensions: [], accuracyTarget: 0.85 });
        const res = await request(makeApp()).get('/api/image-assessment/catalog').set('x-test-user', AUDITOR);
        expect(res.status).toBe(200);
        expect(res.body.data.accuracyTarget).toBe(0.85);
    });
    test('non-audit role (HEALTH) → 403', async () => {
        const res = await request(makeApp()).get('/api/image-assessment/catalog').set('x-test-user', HEALTH);
        expect(res.status).toBe(403);
    });
});

describe('POST /assess (multipart image)', () => {
    test('no file → 400 NO_IMAGE', async () => {
        const res = await request(makeApp())
            .post('/api/image-assessment/assess')
            .set('x-test-user', AUDITOR)
            .field('herbCode', 'CANNABIS');
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('NO_IMAGE');
        expect(mockService.assessImage).not.toHaveBeenCalled();
    });

    test('with file → 200; buffer + herbCode forwarded', async () => {
        mockService.assessImage.mockResolvedValue({ imageInspection: { passed: true }, disease: { top: { disease: 'HEALTHY' } } });
        const res = await request(makeApp())
            .post('/api/image-assessment/assess')
            .set('x-test-user', AUDITOR)
            .field('herbCode', 'CANNABIS')
            .attach('image', Buffer.from('fake-jpeg-bytes'), 'leaf.jpg');
        expect(res.status).toBe(200);
        expect(mockService.assessImage).toHaveBeenCalledWith(
            expect.any(Buffer),
            expect.objectContaining({ herbCode: 'CANNABIS' }),
        );
    });

    test('service 422 IMAGE_UNREADABLE propagates', async () => {
        const err = new Error('bad'); err.statusCode = 422; err.code = 'IMAGE_UNREADABLE';
        mockService.assessImage.mockRejectedValue(err);
        const res = await request(makeApp())
            .post('/api/image-assessment/assess')
            .set('x-test-user', AUDITOR)
            .attach('image', Buffer.from('x'), 'x.jpg');
        expect(res.status).toBe(422);
        expect(res.body.error).toBe('IMAGE_UNREADABLE');
    });
});

describe('POST /quality-score', () => {
    test('valid sub-scores → 200 with score + certificate', async () => {
        mockService.scoreProductQuality.mockReturnValue({ score: 88, grade: 'A', certificate: { kind: 'PRODUCT_QUALITY_ASSESSMENT' } });
        const res = await request(makeApp())
            .post('/api/image-assessment/quality-score')
            .set('x-test-user', AUDITOR)
            .send({ subScores: { COLOR: 90, SIZE: 85, MOISTURE: 95, CONTAMINATION: 80, ACTIVE_COMPOUND: 88 }, herbCode: 'TURMERIC' });
        expect(res.status).toBe(200);
        expect(res.body.data.score).toBe(88);
    });

    test('service 400 QUALITY_INPUT_INVALID propagates', async () => {
        const err = new Error('bad'); err.statusCode = 400; err.code = 'QUALITY_INPUT_INVALID';
        mockService.scoreProductQuality.mockImplementation(() => { throw err; });
        const res = await request(makeApp())
            .post('/api/image-assessment/quality-score')
            .set('x-test-user', AUDITOR)
            .send({ subScores: { COLOR: 90 } });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('QUALITY_INPUT_INVALID');
    });
});

describe('POST /evaluate (KPI harness)', () => {
    test('samples array → 200 confusion matrix; non-array → 400', async () => {
        mockService.evaluateModel.mockReturnValue({ accuracy: 1, meetsTarget: true });
        const ok = await request(makeApp())
            .post('/api/image-assessment/evaluate')
            .set('x-test-user', AUDITOR)
            .send({ samples: [{ actual: 'HEALTHY', predicted: 'HEALTHY' }] });
        expect(ok.status).toBe(200);
        expect(ok.body.data.meetsTarget).toBe(true);

        const bad = await request(makeApp())
            .post('/api/image-assessment/evaluate')
            .set('x-test-user', AUDITOR)
            .send({ samples: 'nope' });
        expect(bad.status).toBe(400);
        expect(mockService.evaluateModel).toHaveBeenCalledTimes(1);
    });
});
