/**
 * F-TX-DEFAULT-5S — pins the CLIENT-LEVEL interactive-transaction defaults.
 *
 * Prisma's 5-second default aborted three separate real-walk hops over
 * Supabase latency (checkout settle, onsite decision + cert mint, work-inbox
 * APPROVED→CERTIFIED advance — Phase 0 walk-2 2026-08-19). The remedy is a
 * client-wide default in services/prisma-database.js; the per-call pins
 * (SETTLEMENT.*, ONSITE_AUDIT.*) cover only their own call-sites, so without
 * THIS pin a future edit could silently drop the default back to 5s and
 * nothing would go red (review 2026-08-19, confirmed finding).
 *
 * Source-scan style (like role-filters-canonical-only.test.js) on purpose:
 * requiring the real module constructs a PrismaClient against DATABASE_URL,
 * which a unit test must not do.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'services', 'prisma-database.js'),
    'utf8',
);

describe('F-TX-DEFAULT-5S — client-level transactionOptions', () => {
    test('TRANSACTION_OPTIONS literal keeps timeout ≥30s and maxWait ≥10s', () => {
        const m = SRC.match(
            /const TRANSACTION_OPTIONS\s*=\s*\{\s*timeout:\s*(\d+)\s*,\s*maxWait:\s*(\d+)\s*\}/,
        );
        expect(m).not.toBeNull();
        expect(Number(m[1])).toBeGreaterThanOrEqual(30000);
        expect(Number(m[2])).toBeGreaterThanOrEqual(10000);
    });

    test('the PrismaClient constructor actually receives TRANSACTION_OPTIONS', () => {
        const ctor = SRC.match(/new PrismaClient\(\{[\s\S]*?\n\}\);/);
        expect(ctor).not.toBeNull();
        expect(ctor[0]).toContain('transactionOptions: TRANSACTION_OPTIONS');
    });
});
