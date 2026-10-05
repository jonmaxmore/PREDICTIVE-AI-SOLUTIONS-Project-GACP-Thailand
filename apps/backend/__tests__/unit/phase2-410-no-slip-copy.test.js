/**
 * phase2-410-no-slip-copy.test.js — one-fee residue sweep (2026-09-26).
 *
 * routes/api/finance/payments.js keeps two retired phase-2 endpoints alive
 * as 410 tombstones (POST /payments — phase 2 branch; POST /phase2/:id) so a
 * stale client gets a clear signal instead of a 404. Both bodies told the
 * applicant to "อัปโหลดสลิปงวด 2" — upload the phase-2 slip. The slip rail
 * was retired 2026-09-11 (migration 20260911140000_retire_subscriptions_and_slips
 * dropped its tables); a stale client hitting this 410 today would be sent to
 * do something that no longer exists anywhere in the app. งวดที่ 2 is now
 * quoted automatically on document approval (F-G4-71) and settled through the
 * Stripe checkout page, per the DEPRECATED comment already above both routes.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'api', 'finance', 'payments.js'),
    'utf8',
);

describe('[one-fee residue sweep 2026-09-26] phase-2 410 tombstones name no slip', () => {
    it('names no slip upload anywhere in the file', () => {
        expect(SOURCE).not.toMatch(/อัปโหลดสลิป/);
    });

    it('both PHASE_2_PAYMENT_DEPRECATED bodies point at the checkout page that exists today', () => {
        const messages = [...SOURCE.matchAll(/message:\s*'([^']*ยกเลิก[^']*)'/g)].map((m) => m[1]);
        expect(messages.length).toBe(2);
        for (const message of messages) {
            expect(message).not.toMatch(/สลิป/);
            expect(message).toMatch(/ชำระ/);
        }
    });
});
