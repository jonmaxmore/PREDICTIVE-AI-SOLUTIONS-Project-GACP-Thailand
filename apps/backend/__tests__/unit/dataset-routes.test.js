'use strict';

/**
 * Dataset routes — สัญญา C05F680149 ภาคผนวก 4 ข้อ 3, mounted at /api/datasets:
 *   GET /                     — catalog (any provider role)
 *   GET /dictionary           — data dictionary markdown (any provider role)
 *   GET /:domain/export       — bulk export (ADMIN only + audit stamp)
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

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, res, next) => {
        const raw = req.headers['x-test-user'];
        if (!raw) {
            return res.status(401).json({ success: false, error: 'Unauthorized', code: 'NO_TOKEN' });
        }
        req.user = JSON.parse(raw);
        next();
    },
}));

const mockService = {
    listDomains: jest.fn(),
    exportDomain: jest.fn(),
    generateDataDictionaryMarkdown: jest.fn(),
};
jest.mock('../../services/dataset-export-service', () => mockService);

const datasetsRouter = require('../../routes/api/datasets/datasets');

function makeApp() {
    const app = express();
    app.use('/api/datasets', datasetsRouter);
    return app;
}

const asUser = (u) => JSON.stringify(u);
const ADMIN = { id: 'admin-uuid', canonicalRole: 'system_admin_dtam' };
const REVIEWER = { id: 'rev-uuid', canonicalRole: 'DOCUMENT_REVIEWER' };

beforeEach(() => {
    jest.clearAllMocks();
});

describe('GET /api/datasets (catalog)', () => {
    test('any provider role → 200 with domain list', async () => {
        mockService.listDomains.mockReturnValue([{ key: 'care-logs', thaiName: 'x', fieldCount: 8 }]);
        const res = await request(makeApp()).get('/api/datasets').set('x-test-user', asUser(REVIEWER));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });

    test('no token → 401', async () => {
        const res = await request(makeApp()).get('/api/datasets');
        expect(res.status).toBe(401);
    });
});

describe('GET /api/datasets/dictionary', () => {
    test('returns markdown with text content-type', async () => {
        mockService.generateDataDictionaryMarkdown.mockReturnValue('# คู่มือ');
        const res = await request(makeApp()).get('/api/datasets/dictionary').set('x-test-user', asUser(REVIEWER));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/markdown');
        expect(res.text).toContain('คู่มือ');
    });
});

describe('GET /api/datasets/:domain/export', () => {
    test('non-admin provider → 403 (no service call)', async () => {
        const res = await request(makeApp())
            .get('/api/datasets/care-logs/export?format=csv')
            .set('x-test-user', asUser(REVIEWER));
        expect(res.status).toBe(403);
        expect(mockService.exportDomain).not.toHaveBeenCalled();
    });

    test('ADMIN csv → 200 text/csv attachment + audit stamped', async () => {
        mockService.exportDomain.mockResolvedValue('﻿"id"\n"a1"');
        const res = await request(makeApp())
            .get('/api/datasets/care-logs/export?format=csv')
            .set('x-test-user', asUser(ADMIN));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-disposition']).toContain('attachment');
        expect(mockService.exportDomain).toHaveBeenCalledWith('care-logs', 'csv');
        expect(mockAuditLog).toHaveBeenCalled();
    });

    test('ADMIN jsonl → 200 application/x-ndjson', async () => {
        mockService.exportDomain.mockResolvedValue('{"id":"a1"}\n');
        const res = await request(makeApp())
            .get('/api/datasets/care-logs/export?format=jsonl')
            .set('x-test-user', asUser(ADMIN));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/x-ndjson');
    });

    test('default format = csv when query omitted', async () => {
        mockService.exportDomain.mockResolvedValue('﻿"id"');
        await request(makeApp())
            .get('/api/datasets/care-logs/export')
            .set('x-test-user', asUser(ADMIN));
        expect(mockService.exportDomain).toHaveBeenCalledWith('care-logs', 'csv');
    });

    test('service 404 DATASET_NOT_FOUND propagates', async () => {
        const err = new Error('nope');
        err.statusCode = 404;
        err.code = 'DATASET_NOT_FOUND';
        mockService.exportDomain.mockRejectedValue(err);
        const res = await request(makeApp())
            .get('/api/datasets/nope/export?format=csv')
            .set('x-test-user', asUser(ADMIN));
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('DATASET_NOT_FOUND');
    });
});
