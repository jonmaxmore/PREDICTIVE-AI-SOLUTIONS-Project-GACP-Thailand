'use strict';

/**
 * Hardening batch 2026-07-09 — the consent route swallowed the coded
 * PAYMENT_TERMS_NOT_WITHDRAWABLE error into a generic message.
 *
 * consent-manager.recordConsent throws Object.assign(Error(<thai>),
 * { code: 'PAYMENT_TERMS_NOT_WITHDRAWABLE', statusCode: 400 }) — the code is
 * already registered in shared/error-codes.js with curated messageTh — but all
 * 3 route catches returned res.status(400).json({ error: safeErrorMessage(e) })
 * whose English-only allowlist turns the Thai message into the generic
 * 'An error occurred…' with NO `code` field. The FE cannot distinguish the
 * contractual non-withdrawable block (ม.24(3) evidence) from any other 400.
 */

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => { req.user = { id: 'user-1', role: 'HEALTH' }; next(); },
}));
jest.mock('../../utils/client-ip', () => ({ getRequestIp: () => '1.2.3.4' }));

// The real block lives in consent-manager (verified correct) — mock it with the
// EXACT error shape the real chokepoint throws (mock-vs-reality rule: the real
// recordConsent THROWS a coded error, it does not return null).
const paymentTermsBlock = () => Object.assign(
    new Error('การยอมรับเงื่อนไขการชำระเงินเป็นหลักฐานทางสัญญา — ถอนไม่ได้'),
    { code: 'PAYMENT_TERMS_NOT_WITHDRAWABLE', statusCode: 400, status: 400 },
);
const requiredConsentBlock = () => new Error('Cannot withdraw required consent: TERMS_OF_SERVICE');

jest.mock('../../middleware/consent-manager', () => ({
    ConsentCategory: {
        TERMS_OF_SERVICE: 'TERMS_OF_SERVICE',
        PRIVACY_POLICY: 'PRIVACY_POLICY',
        MARKETING_EMAIL: 'MARKETING_EMAIL',
        PAYMENT_TERMS: 'PAYMENT_TERMS',
    },
    RequiredConsents: ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'],
    consentManager: {
        getUserConsents: jest.fn(async () => []),
        recordConsent: jest.fn(async (_uid, category, granted) => {
            if (category === 'PAYMENT_TERMS' && granted === false) { throw paymentTermsBlock(); }
            return { category, granted };
        }),
        recordBulkConsent: jest.fn(async (_uid, consents) => {
            for (const c of consents) {
                if (c.category === 'PAYMENT_TERMS' && c.granted === false) { throw paymentTermsBlock(); }
            }
            return consents;
        }),
        withdrawConsent: jest.fn(async (_uid, category) => {
            if (category === 'PAYMENT_TERMS') { throw paymentTermsBlock(); }
            if (category === 'TERMS_OF_SERVICE') { throw requiredConsentBlock(); }
            return { category, granted: false };
        }),
        getConsentDocument: jest.fn(() => null),
    },
}));

const express = require('express');
const request = require('supertest');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/consent', require('../../routes/api/identity/consent'));
    return app;
}

describe('consent route surfaces PAYMENT_TERMS_NOT_WITHDRAWABLE (machine-readable)', () => {
    test('DELETE /PAYMENT_TERMS → 400 with the specific code + curated Thai message', async () => {
        const res = await request(buildApp()).delete('/api/consent/PAYMENT_TERMS');
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('PAYMENT_TERMS_NOT_WITHDRAWABLE');
        expect(res.body.messageTh).toMatch(/ถอนไม่ได้/);
    });

    test('POST / {PAYMENT_TERMS, granted:false} → same code', async () => {
        const res = await request(buildApp())
            .post('/api/consent')
            .send({ category: 'PAYMENT_TERMS', granted: false });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('PAYMENT_TERMS_NOT_WITHDRAWABLE');
    });

    test('POST /bulk carrying a PAYMENT_TERMS withdraw → same code', async () => {
        const res = await request(buildApp())
            .post('/api/consent/bulk')
            .send({ consents: [{ category: 'PAYMENT_TERMS', granted: false }] });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('PAYMENT_TERMS_NOT_WITHDRAWABLE');
    });

    test('no-regression: withdrawing an optional consent still succeeds (200)', async () => {
        const res = await request(buildApp()).delete('/api/consent/MARKETING_EMAIL');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('no-regression: required-consent withdraw keeps the existing generic path (400, no code)', async () => {
        const res = await request(buildApp()).delete('/api/consent/TERMS_OF_SERVICE');
        expect(res.status).toBe(400);
        expect(res.body.code).toBeUndefined();
        // safeErrorMessage lets this one through via its allowlist ('required').
        expect(String(res.body.error)).toMatch(/required/i);
    });
});
