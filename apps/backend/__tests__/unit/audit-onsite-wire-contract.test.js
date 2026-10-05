/**
 * audit-onsite-wire-contract.test.js — Task 12 (fixes B10).
 *
 * B10: every prior test of this router mocked audit-onsite-service
 * WHOLESALE and never asserted the exact request -> service-args mapping
 * the route performs. That let real breaks (B3 checklist body shape, B6
 * /start GPS, B7 /photo GPS+itemId) ship invisibly — the mocked service
 * happily accepted whatever malformed args the route handed it.
 *
 * This suite is the antidote: supertest drives the REAL Express router
 * (routes/api/audit/onsite.js, unmocked) end-to-end through real
 * express.json() body parsing; only the router's *collaborators*
 * (auth-middleware, prisma-database, logger, multer) are mocked, and the
 * service module itself is mocked ONLY so its call args can be captured
 * and asserted verbatim — never as a wholesale behavior stub whose
 * contract silently drifts from the route's real destructuring.
 *
 * Bootstrap style mirrors __tests__/unit/audit-onsite-routes.test.js
 * (mock auth-middleware/prisma-database/logger/multer, mount the real
 * router). Service method signatures verified live against
 * services/audit-onsite-service.js as of Tasks 8-9 (2026-08-17):
 * startInspection/submitChecklistItem/uploadPhoto/submitDecision/
 * verifyGpsAgainstFarm all match the shapes asserted below.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const u = (req, _res, next) => {
        req.user = {
            id: req.headers['x-test-user-id'] || 'auditor-1',
            role: 'auditor',
            canonicalRole: 'auditor',
            organizationId: 'org-1',
        };
        next();
    };
    return {
        authenticateProvider: u,
        authenticateHealth: u,
        authenticateAny: u,
        requireRole: () => (req, _res, next) => next(),
    };
});
jest.mock('../../shared/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
// Fake multer: injects a fixed req.file and calls next(). It does NOT parse
// multipart text fields into req.body — real multer does that via busboy,
// but reproducing busboy here would test our fake parser, not the router.
// The /photo test below therefore drives req.body directly (a plain JSON
// POST carrying gps as a STRING, exactly the shape real multer hands the
// route for a multipart text field) so the router's real
// `typeof rawGps === 'string' -> JSON.parse` branch (the Task 9 fix) is
// the thing actually under test, not multipart wire mechanics.
//
// F-G4-08 third door: the injected buffer used to be Buffer.from('x'), one
// byte. That was fine while the route checked only that req.file existed, and
// it is exactly the file the content guard now refuses — so the fixture is a
// REAL onsite photograph (the 1200x900 JPEG the G4 audit walk captured). The
// gps/itemId contract this suite exists to pin is only proved by a file that
// reaches the service, so the fixture has to be one the guard passes.
jest.mock('multer', () => {
    const fs = require('fs');
    const path = require('path');
    const realPhoto = fs.readFileSync(path.join(__dirname, '../fixtures/onsite-farm-photo.jpg'));
    const m = () => ({
        single: () => (req, _res, next) => {
            req.file = { buffer: realPhoto, size: realPhoto.length, originalname: 'p.jpg', mimetype: 'image/jpeg' };
            next();
        },
    });
    m.memoryStorage = () => ({});
    return m;
});
jest.mock('../../services/prisma-database', () => ({ prisma: { auditChecklist: { findFirst: jest.fn(async () => null) } } }));

const onsiteService = require('../../services/audit-onsite-service');
jest.mock('../../services/audit-onsite-service', () => ({
    CHECKLIST_TEMPLATE_2026: [],
    startInspection: jest.fn(async () => ({ ok: true })),
    submitChecklistItem: jest.fn(async (a) => ({ id: 'row', ...a })),
    uploadPhoto: jest.fn(async () => ({ photoId: 'photo-1', url: '/uploads/x.jpg', fileHash: 'h' })),
    submitDecision: jest.fn(async () => ({ audit: {}, transition: {}, notify: null })),
    verifyGpsAgainstFarm: jest.fn(async () => ({ withinTolerance: true })),
}));

const router = require('../../routes/api/audit/onsite');
const app = express();
app.use(express.json());
app.use('/api/audit/onsite', router);

beforeEach(() => jest.clearAllMocks());

describe('onsite wire contract (real router, real express.json() parsing)', () => {
    test('/checklist unwraps {items:[...]} and calls submitChecklistItem per item with itemCode/response', async () => {
        const res = await request(app).post('/api/audit/onsite/aud-1/checklist')
            .send({ items: [{ itemCode: '4.1', response: 'PASS', notes: 'n', photoIds: ['p1'] }] });
        expect(res.status).toBe(200);
        expect(onsiteService.submitChecklistItem).toHaveBeenCalledWith(expect.objectContaining({
            auditId: 'aud-1', itemCode: '4.1', response: 'PASS', notes: 'n', photoIds: ['p1'], actorId: 'auditor-1',
        }));
    });

    test('/checklist with no items -> 400 CHECKLIST_ITEMS_REQUIRED', async () => {
        const res = await request(app).post('/api/audit/onsite/aud-1/checklist').send({ itemId: 'x', answer: 'YES' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('CHECKLIST_ITEMS_REQUIRED');
    });

    test('/start reads nested gps -> numeric gpsLat/gpsLng (fixes B6)', async () => {
        await request(app).post('/api/audit/onsite/aud-1/start').send({ gps: { latitude: 13.75, longitude: 100.5, accuracy: 5 } });
        expect(onsiteService.startInspection).toHaveBeenCalledWith(expect.objectContaining({
            auditId: 'aud-1', auditorId: 'auditor-1', gpsLat: 13.75, gpsLng: 100.5, gpsAccuracy: 5,
        }));
    });

    test('/start with missing gps -> NaN guard means startInspection is still called (service throws, not the route)', async () => {
        // The route itself does not guard NaN — Number.isFinite lives in the
        // service (startInspection). This test pins that the route forwards
        // whatever it computed rather than silently swallowing a bad request.
        await request(app).post('/api/audit/onsite/aud-1/start').send({});
        const callArgs = onsiteService.startInspection.mock.calls[0][0];
        expect(Number.isNaN(callArgs.gpsLat)).toBe(true);
        expect(Number.isNaN(callArgs.gpsLng)).toBe(true);
    });

    test('/photo parses gps JSON string + itemId, responds {photoId,url,fileHash} (fixes B7)', async () => {
        // req.body.gps arrives as a STRING here (exactly what real multer
        // hands the route for a multipart text field) so the router's
        // JSON.parse(rawGps) branch is what's actually exercised.
        const res = await request(app).post('/api/audit/onsite/aud-1/photo')
            .send({ gps: JSON.stringify({ latitude: 13.75, longitude: 100.5, capturedAt: '2026-08-17T00:00:00Z' }), itemId: '4.1' });
        expect(res.status).toBe(200);
        expect(onsiteService.uploadPhoto).toHaveBeenCalledWith(expect.objectContaining({
            auditId: 'aud-1',
            gpsLat: 13.75,
            gpsLng: 100.5,
            checklistItemCode: '4.1',
            uploadedBy: 'auditor-1',
            organizationId: 'org-1',
        }));
        expect(res.body.data).toEqual({ photoId: 'photo-1', url: '/uploads/x.jpg', fileHash: 'h' });
    });

    test('/photo with an unparseable gps string degrades to {} instead of throwing (route does not 500)', async () => {
        // Malformed JSON in the gps text field must not crash the request —
        // the route's try/catch around JSON.parse(rawGps) degrades to {},
        // which then yields NaN lat/lng forwarded as-is (NaN-guarding is
        // uploadPhoto's job, not the route's — mirrors the /start case above).
        const res = await request(app).post('/api/audit/onsite/aud-1/photo')
            .send({ gps: 'not-json', itemId: '4.1' });
        expect(res.status).toBe(200);
        expect(onsiteService.uploadPhoto).toHaveBeenCalledWith(expect.objectContaining({
            checklistItemCode: '4.1',
            gpsLat: NaN,
            gpsLng: NaN,
        }));
    });

    test('/decision forwards PASS to submitDecision', async () => {
        const res = await request(app).post('/api/audit/onsite/aud-1/decision').send({ decision: 'PASS', summary: 'ok' });
        expect(res.status).toBe(200);
        expect(onsiteService.submitDecision).toHaveBeenCalledWith(expect.objectContaining({
            auditId: 'aud-1', decision: 'PASS', summary: 'ok', actorId: 'auditor-1', actorRole: 'auditor',
        }));
    });

    test('/decision forwards criticalFindings array (defaults to [] when absent)', async () => {
        await request(app).post('/api/audit/onsite/aud-1/decision').send({ decision: 'FAIL', summary: 'x', criticalFindings: [{ note: 'leak' }] });
        expect(onsiteService.submitDecision).toHaveBeenCalledWith(expect.objectContaining({
            decision: 'FAIL', criticalFindings: [{ note: 'leak' }],
        }));
        onsiteService.submitDecision.mockClear();
        await request(app).post('/api/audit/onsite/aud-1/decision').send({ decision: 'PASS' });
        expect(onsiteService.submitDecision).toHaveBeenCalledWith(expect.objectContaining({ criticalFindings: [] }));
    });
});
