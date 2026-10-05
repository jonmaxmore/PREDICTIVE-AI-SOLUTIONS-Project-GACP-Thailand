'use strict';

/**
 * Herb routes — สัญญา C05F680149 ต้นแบบที่ 5, mounted at /api/herbs
 * (routes/api/herbs/herbs.js):
 *
 *   Public reads (no auth): GET / , /coverage , /:code , /:code/entries
 *   ADMIN writes (authenticateProvider + requireAdmin) + audit stamp:
 *     POST /:code/entries , PATCH/DELETE /:code/entries/:id ,
 *     POST /:code/entries/import
 *
 * Auth mocked: x-test-user injects req.user; requireAdmin enforced for real.
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
            return res.status(401).json({ success: false, code: 'NO_TOKEN' });
        }
        req.user = JSON.parse(raw);
        next();
    },
}));

const mockService = {
    listSpecies: jest.fn(),
    getSpecies: jest.fn(),
    listEntries: jest.fn(),
    createEntry: jest.fn(),
    updateEntry: jest.fn(),
    deleteEntry: jest.fn(),
    bulkImportEntries: jest.fn(),
    getCoverageStats: jest.fn(),
};
jest.mock('../../services/herb-knowledge-service', () => ({
    ...mockService,
    CATEGORIES: ['VARIETY', 'ACTIVE_COMPOUND', 'CULTIVATION', 'HARVEST', 'PROCESSING', 'DISEASE', 'LEGAL', 'GENERAL'],
}));

const herbsRouter = require('../../routes/api/herbs/herbs');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/herbs', herbsRouter);
    return app;
}

// authenticateProvider populates BOTH req.user.role and canonicalRole; the
// shared requireAdmin reads user.role — inject it as the real middleware would.
const ADMIN = JSON.stringify({ id: 'admin-uuid', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam' });
const REVIEWER = JSON.stringify({ id: 'rev-uuid', role: 'DOCUMENT_REVIEWER', canonicalRole: 'DOCUMENT_REVIEWER' });

beforeEach(() => jest.clearAllMocks());

describe('public reads (no auth required)', () => {
    test('GET /api/herbs → 200 list (no token)', async () => {
        mockService.listSpecies.mockResolvedValue([{ code: 'CANNABIS', entryCount: 5 }]);
        const res = await request(makeApp()).get('/api/herbs');
        expect(res.status).toBe(200);
        expect(res.body.data[0].code).toBe('CANNABIS');
    });

    test('GET /api/herbs/coverage → 200 KPI stats (no token)', async () => {
        mockService.getCoverageStats.mockResolvedValue({ target: 300, herbs: [] });
        const res = await request(makeApp()).get('/api/herbs/coverage');
        expect(res.status).toBe(200);
        expect(res.body.data.target).toBe(300);
    });

    test('GET /api/herbs/:code → 200; unknown → 404 propagated', async () => {
        mockService.getSpecies.mockResolvedValue({ code: 'CANNABIS' });
        const ok = await request(makeApp()).get('/api/herbs/cannabis');
        expect(ok.status).toBe(200);

        const err = new Error('nf'); err.statusCode = 404; err.code = 'HERB_NOT_FOUND';
        mockService.getSpecies.mockRejectedValue(err);
        const bad = await request(makeApp()).get('/api/herbs/nope');
        expect(bad.status).toBe(404);
        expect(bad.body.error).toBe('HERB_NOT_FOUND');
    });

    test('GET /api/herbs/:code/entries → 200 paginated', async () => {
        mockService.listEntries.mockResolvedValue({ total: 2, entries: [{}, {}] });
        const res = await request(makeApp()).get('/api/herbs/CANNABIS/entries?category=VARIETY&page=2&pageSize=10');
        expect(res.status).toBe(200);
        expect(res.body.data.total).toBe(2);
        expect(mockService.listEntries).toHaveBeenCalledWith('CANNABIS',
            expect.objectContaining({ category: 'VARIETY', page: 2, pageSize: 10 }));
    });
});

describe('ADMIN writes (auth + requireAdmin + audit)', () => {
    test('POST /:code/entries without token → 401', async () => {
        const res = await request(makeApp()).post('/api/herbs/CANNABIS/entries').send({});
        expect(res.status).toBe(401);
    });

    test('POST /:code/entries as non-admin → 403 (no service call)', async () => {
        const res = await request(makeApp())
            .post('/api/herbs/CANNABIS/entries')
            .set('x-test-user', REVIEWER)
            .send({ category: 'VARIETY', title: 't', content: 'c' });
        expect(res.status).toBe(403);
        expect(mockService.createEntry).not.toHaveBeenCalled();
    });

    test('POST /:code/entries as ADMIN → 201 + audit stamp', async () => {
        mockService.createEntry.mockResolvedValue({ id: 'e1' });
        const res = await request(makeApp())
            .post('/api/herbs/CANNABIS/entries')
            .set('x-test-user', ADMIN)
            .send({ category: 'VARIETY', title: 'พันธุ์', content: 'x' });
        expect(res.status).toBe(201);
        expect(mockService.createEntry).toHaveBeenCalledWith('CANNABIS', expect.any(Object),
            expect.objectContaining({ actor: expect.objectContaining({ id: 'admin-uuid' }) }));
        expect(mockAuditLog).toHaveBeenCalled();
    });

    test('POST /:code/entries/import as ADMIN → 200 with import summary', async () => {
        mockService.bulkImportEntries.mockResolvedValue({ imported: 250, skipped: 2, errors: [] });
        const res = await request(makeApp())
            .post('/api/herbs/TURMERIC/entries/import')
            .set('x-test-user', ADMIN)
            .send({ rows: [{ category: 'VARIETY', title: 't', content: 'c' }] });
        expect(res.status).toBe(200);
        expect(res.body.data.imported).toBe(250);
        expect(mockAuditLog).toHaveBeenCalled();
    });

    test('import with non-array rows → 400 without service call', async () => {
        const res = await request(makeApp())
            .post('/api/herbs/TURMERIC/entries/import')
            .set('x-test-user', ADMIN)
            .send({ rows: 'not-an-array' });
        expect(res.status).toBe(400);
        expect(mockService.bulkImportEntries).not.toHaveBeenCalled();
    });

    test('DELETE /:code/entries/:id as ADMIN → 200; service 404 propagates', async () => {
        mockService.deleteEntry.mockResolvedValue({ id: 'e1' });
        const ok = await request(makeApp())
            .delete('/api/herbs/CANNABIS/entries/e1')
            .set('x-test-user', ADMIN);
        expect(ok.status).toBe(200);
        expect(mockAuditLog).toHaveBeenCalled();

        const err = new Error('nf'); err.statusCode = 404; err.code = 'HERB_ENTRY_NOT_FOUND';
        mockService.deleteEntry.mockRejectedValue(err);
        const bad = await request(makeApp())
            .delete('/api/herbs/CANNABIS/entries/missing')
            .set('x-test-user', ADMIN);
        expect(bad.status).toBe(404);
    });
});
