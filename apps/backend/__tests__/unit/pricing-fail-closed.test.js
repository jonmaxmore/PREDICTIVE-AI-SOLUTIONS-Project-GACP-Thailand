/**
 * W11-1 (backlog 05-BACKLOG.md §2 B-MONEY-SMALL #55) — /api/pricing must FAIL CLOSED.
 *
 * Defect on main @94ac46ac: both read routes swallow an internal error and
 * answer `200 { success: true, data: defaultFeesPayload() }`
 * (`routes/api/finance/pricing.js:172-175` and `:199-206`). An applicant whose
 * SystemConfig lookup blew up is therefore QUOTED A NUMBER the platform never
 * verified, and the client has no way to tell the difference from a real quote.
 *
 * Money invariant protected (skill gacp-payment-invariants):
 *   "อ่าน / flag / เสนอ diff เท่านั้น" — this suite removes a WRONG-NUMBER path.
 *   It never computes or mutates money: the fix turns an invented 200 into an
 *   error. A fee shown to an applicant must come from the canonical engine or
 *   not be shown at all.
 *
 * NOTE (2026-10-03): the stored `pricing_fees` override is gone; the route
 * serves the engine only (pricing-serves-the-engine-only.test.js). The
 * failure injected below is therefore the engine's.
 */

'use strict';

// fix/fees-from-server round 1 (2026-10-03): the route no longer reads a
// SystemConfig `pricing_fees` blob, so the internal error this suite injects is
// now the fee ENGINE failing (defaultFeesPayload → calculateRenewalFee). The
// assertions are unchanged: an error is an error, never success:true with
// invented numbers.
let mockEngineFails = false;
jest.mock('../../modules/billing', () => {
    const actual = jest.requireActual('../../modules/billing');
    return {
        ...actual,
        calculateRenewalFee: (...args) => {
            if (mockEngineFails) throw new Error('fee engine exploded');
            return actual.calculateRenewalFee(...args);
        },
    };
});

const express = require('express');
const request = require('supertest');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/pricing', require('../../routes/api/finance/pricing'));
    return app;
}

describe('W11-1 — /api/pricing fails CLOSED on an internal error', () => {
    beforeEach(() => {
        mockEngineFails = false;
    });

    describe.each([
        ['GET /api/pricing', '/api/pricing'],
        ['GET /api/pricing/fees', '/api/pricing/fees'],
    ])('%s', (_label, path) => {
        test('an internal error returns an error, never success:true with invented numbers', async () => {
            mockEngineFails = true;

            const res = await request(buildApp()).get(path);

            expect(res.status).toBe(503);
            expect(res.body.success).toBe(false);
            // The catalogued code, so an integrator can branch on it.
            expect(res.body.error).toBe('PRICING_UNAVAILABLE');
            // No fee numbers may leak out of the failure path.
            expect(res.body.data).toBeUndefined();
            expect(JSON.stringify(res.body)).not.toMatch(/5500|27500|5535|27675/);
        });

        test('the Thai message states the cause AND the next action', async () => {
            mockEngineFails = true;

            const res = await request(buildApp()).get(path);
            const message = String(res.body.message || '');

            // Thai copy, not an English stack leak.
            expect(message).toMatch(/[฀-๿]/);
            // cause: the fee table could not be read
            expect(message).toContain('ค่าธรรมเนียม');
            // next action: retry / contact — the user must be told what to do
            expect(message).toMatch(/ลองใหม่|ติดต่อ/);
            // never echo the internal error text (safeErrorMessage discipline)
            expect(message).not.toContain('exploded');
        });

        test('the happy path serves the engine (no stored override since 2026-10-03)', async () => {
            const res = await request(buildApp()).get(path);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.applicationFee).toBe(5500);
            expect(res.body.data.inspectionFee).toBe(27500);
        });
    });

    test('PRICING_UNAVAILABLE is in the canonical error catalog', () => {
        const { ERROR_CODES } = require('../../shared/error-codes');
        expect(ERROR_CODES.PRICING_UNAVAILABLE).toBeDefined();
        expect(ERROR_CODES.PRICING_UNAVAILABLE.httpStatus).toBe(503);
        expect(ERROR_CODES.PRICING_UNAVAILABLE.messageTh).toMatch(/[฀-๿]/);
    });
});
