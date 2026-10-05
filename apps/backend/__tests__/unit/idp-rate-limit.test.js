'use strict';

/**
 * The /auth/idp rate-limit carve-out, tested with REAL requests.
 *
 * The E1 deep review proved the previous protection — three source-text
 * regexes over server.js — constrained nothing: inverting the branch so the
 * public read got the strict limiter and the OAuth surfaces got a free pass
 * survived every pin. This suite mounts the actual factory in express and
 * counts which limiter saw which request, which no mutation of the branch can
 * survive.
 */
const express = require('express');
const request = require('supertest');
const { createIdpRateLimit } = require('../../middleware/idp-rate-limit');

function buildApp() {
    const seenByAuthLimiter = [];
    const app = express();
    const authLimiter = (req, res, next) => {
        seenByAuthLimiter.push(`${req.method} ${req.path}`);
        next();
    };
    app.use('/api/auth/idp', createIdpRateLimit({ authLimiter }));
    app.all('/api/auth/idp/*', (req, res) => res.status(200).json({ ok: true }));
    app.get('/api/auth/idp/providers', (req, res) => res.status(200).json({ ok: true }));
    return { app, seenByAuthLimiter };
}

describe('createIdpRateLimit', () => {
    it('GET /providers bypasses the strict limiter — the one and only exemption', async () => {
        const { app, seenByAuthLimiter } = buildApp();
        for (let i = 0; i < 7; i++) {
            const r = await request(app).get('/api/auth/idp/providers');
            expect(r.status).toBe(200);
        }
        expect(seenByAuthLimiter).toEqual([]);
    });

    it('POST to the same path is NOT the read and stays on the strict limiter', async () => {
        const { app, seenByAuthLimiter } = buildApp();
        await request(app).post('/api/auth/idp/providers');
        expect(seenByAuthLimiter).toEqual(['POST /providers']);
    });

    it('the OAuth surfaces stay on the strict limiter', async () => {
        const { app, seenByAuthLimiter } = buildApp();
        await request(app).post('/api/auth/idp/thaid/authorize-url');
        await request(app).post('/api/auth/idp/thaid/callback');
        await request(app).get('/api/auth/idp/thaid/anything');
        expect(seenByAuthLimiter).toEqual([
            'POST /thaid/authorize-url',
            'POST /thaid/callback',
            'GET /thaid/anything',
        ]);
    });

    it('path variants do not slip through the exemption', async () => {
        const { app, seenByAuthLimiter } = buildApp();
        await request(app).get('/api/auth/idp/providers/');
        await request(app).get('/api/auth/idp/Providers');
        expect(seenByAuthLimiter).toEqual(['GET /providers/', 'GET /Providers']);
    });

    it('refuses to be built without the strict limiter — no silent unlimited mount', () => {
        expect(() => createIdpRateLimit({})).toThrow(TypeError);
    });
});
