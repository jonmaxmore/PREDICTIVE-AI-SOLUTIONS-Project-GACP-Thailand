'use strict';

/**
 * Survey routes — สัญญา C05F680149 ต้นแบบที่ 2, mounted at /api/surveys
 * (routes/api/surveys/surveys.js):
 *
 *   POST /templates                    — ADMIN only (master data) + audit stamp
 *   POST /templates/:id/activate|close — ADMIN only + audit stamp
 *   GET  /templates[/:id|/stats|/export] — any provider role
 *   GET  /active                       — authenticateAny (respondents)
 *   POST /templates/:id/responses      — authenticateAny (HEALTH submits)
 *   GET/POST /interviews               — provider read / ADMIN create
 *
 * Auth middlewares are mocked: x-test-user header injects req.user; absence →
 * 401. RBAC checks inside the router are REAL (normalizeRole + role sets).
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAuditLog(...a) },
    AuditCategory: { ADMIN: 'ADMIN' },
    AuditSeverity: { INFO: 'INFO' },
    ResourceType: { SYSTEM: 'SYSTEM' },
}));

jest.mock('../../middleware/auth-middleware', () => {
    const inject = (req, res, next) => {
        const raw = req.headers['x-test-user'];
        if (!raw) {
            return res.status(401).json({ success: false, error: 'Unauthorized', code: 'NO_TOKEN' });
        }
        req.user = JSON.parse(raw);
        next();
    };
    return { authenticateAny: inject, authenticateProvider: inject };
});

const mockService = {
    createTemplate: jest.fn(),
    activateTemplate: jest.fn(),
    closeTemplate: jest.fn(),
    listTemplates: jest.fn(),
    listActiveTemplates: jest.fn(),
    getTemplate: jest.fn(),
    submitResponse: jest.fn(),
    getTemplateStats: jest.fn(),
    exportResponsesCsv: jest.fn(),
    createInterview: jest.fn(),
    listInterviews: jest.fn(),
};
jest.mock('../../services/survey-service', () => ({
    ...mockService,
    TEMPLATE_STATUS: { DRAFT: 'DRAFT', ACTIVE: 'ACTIVE', CLOSED: 'CLOSED' },
}));

const surveysRouter = require('../../routes/api/surveys/surveys');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/surveys', surveysRouter);
    return app;
}

const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const asUser = (user) => JSON.stringify(user);
const ADMIN = { id: 'admin-uuid', canonicalRole: 'system_admin_dtam' };
const REVIEWER = { id: 'rev-uuid', canonicalRole: 'DOCUMENT_REVIEWER' };
const FARMER = { id: 'farmer-uuid', canonicalRole: 'HEALTH', canonicalId: 'tok_farmer' };

beforeEach(() => {
    jest.clearAllMocks();
});

describe('template management (ADMIN master data)', () => {
    test('POST /templates without token → 401', async () => {
        const res = await request(makeApp()).post('/api/surveys/templates').send({});
        expect(res.status).toBe(401);
    });

    test('POST /templates as non-admin provider → 403 (no service call)', async () => {
        const res = await request(makeApp())
            .post('/api/surveys/templates')
            .set('x-test-user', asUser(REVIEWER))
            .send({ code: 'X', title: 'x', questions: [] });
        expect(res.status).toBe(403);
        expect(mockService.createTemplate).not.toHaveBeenCalled();
    });

    test('POST /templates as ADMIN → 201 + audit stamp', async () => {
        mockService.createTemplate.mockResolvedValue({ id: TEMPLATE_ID, code: 'F1' });
        const res = await request(makeApp())
            .post('/api/surveys/templates')
            .set('x-test-user', asUser(ADMIN))
            .send({ code: 'F1', title: 'แบบสำรวจ', questions: [{ questionText: 'q', questionType: 'TEXT' }] });

        expect(res.status).toBe(201);
        expect(res.body.data.id).toBe(TEMPLATE_ID);
        expect(mockService.createTemplate).toHaveBeenCalledWith(expect.any(Object),
            expect.objectContaining({ actor: expect.objectContaining({ id: 'admin-uuid' }) }));
        expect(mockAuditLog).toHaveBeenCalled();
    });

    test('POST /templates/:id/activate — ADMIN 200; service 409 propagates', async () => {
        mockService.activateTemplate.mockResolvedValue({ id: TEMPLATE_ID, status: 'ACTIVE' });
        const ok = await request(makeApp())
            .post(`/api/surveys/templates/${TEMPLATE_ID}/activate`)
            .set('x-test-user', asUser(ADMIN));
        expect(ok.status).toBe(200);
        expect(ok.body.data.status).toBe('ACTIVE');

        const conflict = new Error('cannot');
        conflict.statusCode = 409;
        conflict.code = 'INVALID_SURVEY_TEMPLATE_STATUS';
        mockService.activateTemplate.mockRejectedValue(conflict);
        const bad = await request(makeApp())
            .post(`/api/surveys/templates/${TEMPLATE_ID}/activate`)
            .set('x-test-user', asUser(ADMIN));
        expect(bad.status).toBe(409);
        expect(bad.body.error).toBe('INVALID_SURVEY_TEMPLATE_STATUS');
    });

    test('invalid template id (not UUID) → 400 without service call', async () => {
        const res = await request(makeApp())
            .post('/api/surveys/templates/not-a-uuid/activate')
            .set('x-test-user', asUser(ADMIN));
        expect(res.status).toBe(400);
        expect(mockService.activateTemplate).not.toHaveBeenCalled();
    });

    test('GET /templates as any provider role → 200', async () => {
        mockService.listTemplates.mockResolvedValue([{ id: TEMPLATE_ID }]);
        const res = await request(makeApp())
            .get('/api/surveys/templates')
            .set('x-test-user', asUser(REVIEWER));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });
});

describe('respondent surface (authenticateAny)', () => {
    test('GET /active as HEALTH → 200 with ACTIVE templates', async () => {
        mockService.listActiveTemplates.mockResolvedValue([{ id: TEMPLATE_ID, status: 'ACTIVE' }]);
        const res = await request(makeApp())
            .get('/api/surveys/active')
            .set('x-test-user', asUser(FARMER));
        expect(res.status).toBe(200);
        expect(res.body.data[0].status).toBe('ACTIVE');
    });

    test('POST /templates/:id/responses as HEALTH → 201; actor forwarded', async () => {
        mockService.submitResponse.mockResolvedValue({ id: 'resp-1' });
        const res = await request(makeApp())
            .post(`/api/surveys/templates/${TEMPLATE_ID}/responses`)
            .set('x-test-user', asUser(FARMER))
            .send({ region: 'NORTH', answers: [{ questionId: 'q1', value: 'ขิง' }] });

        expect(res.status).toBe(201);
        expect(mockService.submitResponse).toHaveBeenCalledWith(TEMPLATE_ID, expect.any(Object),
            expect.objectContaining({ actor: expect.objectContaining({ id: 'farmer-uuid' }) }));
    });

    test('service validation error (400 MISSING_REQUIRED_ANSWERS) propagates', async () => {
        const err = new Error('missing');
        err.statusCode = 400;
        err.code = 'MISSING_REQUIRED_ANSWERS';
        mockService.submitResponse.mockRejectedValue(err);
        const res = await request(makeApp())
            .post(`/api/surveys/templates/${TEMPLATE_ID}/responses`)
            .set('x-test-user', asUser(FARMER))
            .send({ region: 'NORTH', answers: [] });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('MISSING_REQUIRED_ANSWERS');
    });
});

describe('stats + CSV export (provider read)', () => {
    test('GET /templates/:id/stats → 200', async () => {
        mockService.getTemplateStats.mockResolvedValue({ templateId: TEMPLATE_ID, totalResponses: 2 });
        const res = await request(makeApp())
            .get(`/api/surveys/templates/${TEMPLATE_ID}/stats`)
            .set('x-test-user', asUser(REVIEWER));
        expect(res.status).toBe(200);
        expect(res.body.data.totalResponses).toBe(2);
    });

    test('GET /templates/:id/export → text/csv + attachment headers', async () => {
        mockService.exportResponsesCsv.mockResolvedValue('﻿"a","b"');
        const res = await request(makeApp())
            .get(`/api/surveys/templates/${TEMPLATE_ID}/export`)
            .set('x-test-user', asUser(ADMIN));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('attachment');
    });
});

describe('expert interviews (ต้นแบบ 2.2)', () => {
    test('POST /interviews as ADMIN → 201; non-admin → 403', async () => {
        mockService.createInterview.mockResolvedValue({ id: 'int-1' });
        const ok = await request(makeApp())
            .post('/api/surveys/interviews')
            .set('x-test-user', asUser(ADMIN))
            .send({ title: 'x', intervieweeName: 'y', interviewDate: '2026-07-01', transcript: 'z' });
        expect(ok.status).toBe(201);
        expect(mockAuditLog).toHaveBeenCalled();

        const forbidden = await request(makeApp())
            .post('/api/surveys/interviews')
            .set('x-test-user', asUser(REVIEWER))
            .send({ title: 'x', intervieweeName: 'y', interviewDate: '2026-07-01', transcript: 'z' });
        expect(forbidden.status).toBe(403);
    });

    test('GET /interviews as provider → 200', async () => {
        mockService.listInterviews.mockResolvedValue([{ id: 'int-1' }]);
        const res = await request(makeApp())
            .get('/api/surveys/interviews')
            .set('x-test-user', asUser(REVIEWER));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });
});
