/**
 * GOALS.md G1 item 1, the half nobody had closed: the FRONTEND fee mirror.
 *
 * Item 1 asks for one fee SSOT and names two files to strip of literals —
 * `apps/backend/config/payment-fees.js` (done: it is a derived view now, and
 * `fee-single-source` PASSes with one defining file) and
 * `apps/web-app/src/constants/fees.ts` (not done: it still declares
 * GACP_APPLICATION_FEE, GACP_INSPECTION_FEE และ
 * GACP_VAT_RATE as literals).
 *
 * ── WHAT WAS ACTUALLY UNGUARDED ───────────────────────────────────────────────
 * The renewal fee has a real cross-check: renewal-fee-ssot.test.js case D
 * compares the frontend mirror to `FEE_RATES.RENEWAL_PER_SCOPE` "whatever the
 * number is", so moving one and forgetting the other turns that suite red.
 *
 * The PHASE fees had nothing of the kind. Grepping both test trees for
 * GACP_APPLICATION_FEE / GACP_INSPECTION_FEE returns exactly one file, and every
 * assertion in it compares those constants to OTHER FRONTEND CONSTANTS — ratios
 * within fees.ts, and a sum of the two. Not one of them reads the backend. So an
 * operator raising PHASE1_PER_SCOPE in business-rules.js would move the invoice,
 * the quotation and the remittance while every screen kept quoting the old price,
 * and the whole suite would stay green.
 *
 * That is the "บั๊ก 30k/15k" GOALS.md G1 names, in the tense that matters: not a
 * past incident, the same gap still open one fee over.
 *
 * ── 2026-10-03: THE MIRROR IS DELETED (fix/fees-from-server) ──────────────────
 * The end state described below is done. apps/web-app/src/constants/fees.ts
 * declares no fee; every screen reads GET /api/pricing/fees and shows no number
 * when it cannot. The cases below therefore no longer compare a web literal to
 * this table. They pin (1) that no web fee literal can come back, and (2) the
 * contract that replaced the mirror: every field the web's parser requires is
 * served by the route, equal to the canonical engine.
 *
 * ── WHY A MIRROR TEST AND NOT DELETION (history, superseded) ─────────────────
 * Deleting the constants and reading GET /api/pricing/fees everywhere is the
 * end state item 1 describes, and it is a frontend change with its own loading,
 * SSR and offline questions. This file does not pretend to be that. It makes the
 * mirror UNABLE TO DRIFT in the meantime, using the pattern this repository
 * already chose for the renewal fee — which is worth more than an intention,
 * and less than the deletion. The remaining work is recorded in the backlog.
 */

'use strict';

jest.mock('../../services/system-config-service', () => ({
    getValue: jest.fn().mockResolvedValue(null),
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const FE_FEES_FILE = path.resolve(__dirname, '../../../web-app/src/constants/fees.ts');
const FE_PUBLIC_FEES = path.resolve(__dirname, '../../../web-app/src/lib/pricing/public-fees.ts');

const { FEES } = require('../../config/business-rules');
const {
    calculatePhase1Fee,
    calculatePhase2Fee,
    calculateRenewalFee,
} = require('../../modules/billing');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/pricing', require('../../routes/api/finance/pricing'));
    return app;
}

/** The amount keys the web refuses to render without (AMOUNT_KEYS in public-fees.ts). */
function webRequiredAmountKeys() {
    const src = fs.readFileSync(FE_PUBLIC_FEES, 'utf8');
    const m = src.match(/const\s+AMOUNT_KEYS\s*=\s*\[([\s\S]*?)\]/);
    if (!m) throw new Error(`AMOUNT_KEYS not found in ${FE_PUBLIC_FEES}`);
    return [...m[1].matchAll(/'([A-Za-z0-9]+)'/g)].map((x) => x[1]);
}

// Each served field the web prints, and the canonical value it must equal.
// Compared to the engine and never to a literal.
const CONTRACT = {
    applicationFee: () => FEES.PHASE1_PER_SCOPE,
    inspectionFee: () => FEES.PHASE2_PER_SCOPE,
    renewalFee: () => FEES.RENEWAL_PER_SCOPE,
    phase1TotalPerScope: () => calculatePhase1Fee({}, { scopeCount: 1 }).phaseTotal,
    phase2TotalPerScope: () => calculatePhase2Fee({}, { scopeCount: 1 }).phaseTotal,
    renewalTotalPerScope: () => calculateRenewalFee({}, { scopeCount: 1 }).phaseTotal,
};

describe('the web holds no fee of its own', () => {
    test('constants/fees.ts declares no GACP fee, rate, percent or total', () => {
        const src = fs.readFileSync(FE_FEES_FILE, 'utf8');
        const declared = [...src.matchAll(/export\s+const\s+(GACP_\w+)/g)].map((m) => m[1]);
        expect(declared).toEqual([]);
    });
});

describe('the contract that replaced the mirror', () => {
    test('the web parser requires exactly the fields this table answers for', () => {
        expect([...webRequiredAmountKeys()].sort()).toEqual(Object.keys(CONTRACT).sort());
    });

    test.each(Object.keys(CONTRACT))('GET /api/pricing/fees serves %s equal to the canonical engine', async (key) => {
        const res = await request(buildApp()).get('/api/pricing/fees');
        expect(res.status).toBe(200);
        expect(res.body.data[key]).toBe(CONTRACT[key]());
    });

    test('GET /api/pricing/fees serves the canonical VAT rate the web labels', async () => {
        const res = await request(buildApp()).get('/api/pricing/fees');
        expect(res.body.data.vatRate).toBe(FEES.VAT_RATE);
    });
});
