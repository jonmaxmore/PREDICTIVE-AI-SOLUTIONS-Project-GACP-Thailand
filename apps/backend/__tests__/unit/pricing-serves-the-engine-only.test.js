/**
 * GET /api/pricing and /api/pricing/fees serve the fee engine's figures and
 * nothing else (fix/fees-from-server round 1, 2026-10-03).
 *
 * Both routes used to answer `stored || defaultFeesPayload()`, where `stored`
 * was a SystemConfig `pricing_fees` blob served as-is. That blob was a second
 * fee source: invoices are billed from the engine (fee.* keys through
 * config/business-rules.js, modules/billing), so a stored blob would have put
 * one price on every screen and another on every invoice. The coordinator
 * checked staging and demo read-only on 2026-10-03: neither holds a
 * `pricing_fees` row, so removing the override changes nothing served today.
 *
 * Read-only route; no fee computation, invoice or checkout is touched (L3).
 */

'use strict';

jest.mock('../../services/system-config-service', () => ({
    getValue: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const systemConfigService = require('../../services/system-config-service');
const {
    calculatePhase1Fee,
    calculatePhase2Fee,
    calculateRenewalFee,
    FEE_RATES,
    VAT_RATE,
} = require('../../modules/billing');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/pricing', require('../../routes/api/finance/pricing'));
    return app;
}

/** A stored blob that disagrees with the engine on every figure. */
const STORED_BLOB = {
    applicationFee: 1,
    inspectionFee: 2,
    renewalFee: 3,
    renewalTotalPerScope: 4,
    renewalChargeCount: 9,
    phase1TotalPerScope: 5,
    phase2TotalPerScope: 6,
    vatRate: 0.5,
    currency: 'USD',
};

const ENGINE = () => ({
    applicationFee: FEE_RATES.PHASE1_PER_SCOPE,
    inspectionFee: FEE_RATES.PHASE2_PER_SCOPE,
    renewalFee: calculateRenewalFee({}, { scopeCount: 1 }).serviceFeeAmount,
    renewalTotalPerScope: calculateRenewalFee({}, { scopeCount: 1 }).phaseTotal,
    renewalChargeCount: 1,
    phase1TotalPerScope: calculatePhase1Fee({}, { scopeCount: 1 }).phaseTotal,
    phase2TotalPerScope: calculatePhase2Fee({}, { scopeCount: 1 }).phaseTotal,
    vatRate: VAT_RATE,
    currency: 'THB',
});

describe.each([
    ['GET /api/pricing/fees', '/api/pricing/fees'],
    ['GET /api/pricing', '/api/pricing'],
])('%s serves the engine only', (_label, path) => {
    beforeEach(() => {
        systemConfigService.getValue.mockReset();
        systemConfigService.getValue.mockImplementation(async (key) => (key === 'pricing_fees' ? STORED_BLOB : null));
    });

    test('a stored pricing_fees blob cannot change a single served figure', async () => {
        const res = await request(buildApp()).get(path);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        const served = res.body.data;
        const engine = ENGINE();
        for (const key of Object.keys(engine)) {
            expect({ key, value: served[key] }).toEqual({ key, value: engine[key] });
        }
    });

    test('the route does not even read pricing_fees', async () => {
        await request(buildApp()).get(path);
        expect(systemConfigService.getValue).not.toHaveBeenCalledWith('pricing_fees');
    });
});
