/**
 * W11-2 (backlog 05-BACKLOG.md §2 B-MONEY-SMALL #56) — paymentLimiter must
 * cover POST /api/payments/checkout.
 *
 * Defect on main @94ac46ac: `server.js:325-328` mounts paymentLimiter on
 * /api/payments/create, /phase1, /phase2 and /slip/upload — but NOT on
 * /api/payments/checkout (`routes/api/finance/payments.js:409`), the Wave 2
 * Stripe lump-sum route. That route calls createCheckoutForApplication, which
 * mints a Stripe PaymentIntent per call. Only the 100-req/min globalLimiter
 * (`server.js:230,284`) stands in front of it, so one authenticated applicant
 * can create an order of magnitude more PaymentIntents than the 10-per-5-min
 * budget every other payment route enforces.
 *
 * This test reads the mount table out of server.js as text rather than booting
 * the server: booting server.js opens DB/Redis connections and this must run
 * in the DB-less unit lane. The assertion is on the wiring, which is exactly
 * what the defect is.
 *
 * No money logic is touched: this applies an EXISTING middleware to one more
 * path. Amounts, settlement state and ledger writes are untouched (L3).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SERVER_JS = path.resolve(__dirname, '../../server.js');
const PAYMENTS_ROUTES = path.resolve(__dirname, '../../routes/api/finance/payments.js');

function limitedPaths(source) {
    const found = [];
    const re = /app\.use\(\s*'([^']+)'\s*,\s*paymentLimiter\s*\)/g;
    let m;
    while ((m = re.exec(source)) !== null) {found.push(m[1]);}
    return found;
}

function mountedPaymentPosts(source) {
    const found = [];
    const re = /router\.post\(\s*'(\/[^']*)'/g;
    let m;
    while ((m = re.exec(source)) !== null) {found.push(m[1]);}
    return found;
}

describe('W11-2 — every money-creating payments route sits behind paymentLimiter', () => {
    const server = fs.readFileSync(SERVER_JS, 'utf8');
    const payments = fs.readFileSync(PAYMENTS_ROUTES, 'utf8');

    test('the checkout route exists and mints a Stripe PaymentIntent', () => {
        expect(mountedPaymentPosts(payments)).toContain('/checkout');
        expect(payments).toContain('createCheckoutForApplication');
    });

    test('/api/payments/checkout is rate limited', () => {
        expect(limitedPaths(server)).toContain('/api/payments/checkout');
    });

    test('no POST route under /api/payments is left unlimited', () => {
        const limited = limitedPaths(server)
            .filter(p => p.startsWith('/api/payments/'))
            .map(p => p.replace('/api/payments', ''));

        // `/:param` suffixes are matched by the prefix mount, so compare on the
        // first path segment only.
        const firstSegment = p => `/${p.split('/').filter(Boolean)[0] || ''}`;
        const covered = new Set(limited.map(firstSegment));

        const uncovered = mountedPaymentPosts(payments)
            .map(firstSegment)
            .filter(p => !covered.has(p));

        expect(uncovered).toEqual([]);
    });
});
