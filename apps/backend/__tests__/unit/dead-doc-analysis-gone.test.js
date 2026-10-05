/**
 * Task 10 (document pre-check): the old document-analysis path is gone, and
 * nothing that used to lean on it answers 500.
 *
 * The pre-check (services/document-precheck/) replaced it. What was left:
 *   - services/document-analysis-service.js — only verifyUploadedDocument
 *     remained, behind POST /api/documents/verify, with no caller in the web
 *     or mobile app;
 *   - services/ai/document-classifier.js and services/ocr-service.js — reached
 *     only through that service; ocr-service ran Tesseract with no local
 *     language data and called pdf-parse with the v1 API while v2 is installed;
 *   - GET /api/plants/:plantId/documents — called getBaseRequirements(), which
 *     was removed from the service on 2026-09-11, so every call threw a
 *     TypeError and answered 500. No web or mobile caller.
 *
 * These are asserted through the real routers, not by reading the source.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l), stream: { write: jest.fn() } };
});

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { id: 'user-1', userId: 'user-1', canonicalId: 'fk-1', role: 'health' };
        next();
    },
}));

// A plant that exists, so the old handler got past its 404 and reached the
// removed service method.
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        plantSpecies: {
            findUnique: jest.fn(async () => ({ code: 'CAN', nameTH: 'กัญชา', isActive: true })),
            findMany: jest.fn(async () => []),
        },
        $queryRaw: jest.fn(),
    },
}));

describe('the retired document-analysis modules cannot be loaded', () => {
    test.each([
        ['../../services/document-analysis-service'],
        ['../../services/ai/document-classifier'],
        ['../../services/ocr-service'],
    ])('require(%s) throws MODULE_NOT_FOUND', (modulePath) => {
        let error = null;
        jest.isolateModules(() => {
            try {
                require(modulePath);
            } catch (e) {
                error = e;
            }
        });
        expect(error).not.toBeNull();
        expect(error.code).toBe('MODULE_NOT_FOUND');
    });
});

describe('POST /api/documents/verify', () => {
    test('answers 404: the door is gone', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/documents', require('../../routes/api/documents/documents'));

        const res = await request(app).post('/api/documents/verify').send({ expectedType: 'ID_CARD' });

        expect(res.status).toBe(404);
    });
});

describe('GET /api/plants/:plantId/documents', () => {
    // Task 10 took the "no caller → delete" branch (no web/mobile caller), so the
    // pin is the one outcome that branch has: 404 (fix round 1, review M4).
    test('answers 404: the route and its handler are gone', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/plants', require('../../routes/api/cultivation/plants'));

        const res = await request(app).get('/api/plants/CAN/documents');

        expect(res.status).toBe(404);
    });
});
