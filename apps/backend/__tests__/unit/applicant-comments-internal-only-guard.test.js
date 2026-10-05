/**
 * P1-G leak-guard (pulled forward into the P0 batch) — applicant-side comment
 * reads must EXCLUDE internal staff notes.
 *
 * ApplicationComment has `internalOnly Boolean @default(false)` but NO read
 * path ever filtered on it: both applicant-facing includes fetched every
 * comment. Today that is latent (comments are only auto-created on
 * revision/CAR, all internalOnly=false) — but the moment the chatter composer
 * (Wave 3 / P1-G) lets staff post internal notes, they would leak straight to
 * the applicant. Guard the WHERE first, ship the composer second.
 *
 * Surfaces pinned here:
 *   - GET /:id            (application-workflow-handlers.js — authenticateHealth)
 *   - the history include (application-listing-handlers.js)
 */

'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => { req.user = { id: 'u-1', healthId: 'h-1', canonicalRole: 'health' }; next(); },
    authenticateAny: (req, _res, next) => { req.user = { id: 'u-1', healthId: 'h-1', canonicalRole: 'health' }; next(); },
    authenticateProvider: (req, _res, next) => next(),
}));

jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(async () => ({ healthId: 'h-1', userId: 'u-1' })),
}));

const mockFindFirst = jest.fn(async () => ({ id: 'app-1', comments: [], workflowHistory: [] }));
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findFirst: (...a) => mockFindFirst(...a) },
        workActivity: { findMany: jest.fn(async () => []) },
    },
}));

describe('P1-G leak-guard — applicant comment reads filter internalOnly', () => {
    beforeEach(() => jest.clearAllMocks());

    test('GET /:id (workflow-handlers) includes comments with where internalOnly:false', async () => {
        const router = require('../../routes/api/applications/application-workflow-handlers');
        const app = express();
        app.use(express.json());
        app.use('/apps', router);

        const res = await request(app).get('/apps/app-1');
        expect(res.status).toBe(200);
        const args = mockFindFirst.mock.calls[0][0];
        expect(args.include.comments.where).toEqual({ internalOnly: false });
    });

    test('history include (listing-handlers) filters internalOnly too', async () => {
        // The listing handler mounts several routes; requiring it and grepping
        // its call shape is brittle — instead pin the SOURCE contract: the
        // include literal must carry the internalOnly filter.
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../routes/api/applications/application-listing-handlers.js'),
            'utf8',
        );
        // Every `include: { comments:` in the applicant listing handler must
        // scope to non-internal comments.
        const includes = src.match(/include:\s*\{\s*comments:\s*\{[^}]*\}/g) || [];
        expect(includes.length).toBeGreaterThan(0);
        for (const frag of includes) {
            expect(frag).toContain('internalOnly: false');
        }
    });
});
