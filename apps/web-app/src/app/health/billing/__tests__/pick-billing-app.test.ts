/**
 * Health billing page id-selection — rewritten 2026-09-05.
 *
 * The backend `mapHealthApplication` (routes/api/helpers/applications-helpers.js)
 * used to emit `_id`, a name the PostgreSQL schema never had. The billing page read
 * `list[0].id` / `app.id`, which is ALWAYS undefined for that shape, so:
 *   - loadStatement(selectedAppId) never fired with a real id → permanent spinner
 *   - every picker button rendered key={undefined} → React key collision (all
 *     buttons treated as the same node → "selected" styling bleeds).
 *
 * The name is gone at the source now, so these helpers read `id` like everything else.
 * These tests pin the tiny pure id-selection helpers so the fix can't regress.
 */

import { describe, expect, it } from '@jest/globals';

import {
    pickBillingAppId,
    billingAppKey,
    type MyApplication,
} from '../billing-app-select';

describe('billing app id-selection reads `id`', () => {
    const list: MyApplication[] = [
        { id: 'x', applicationNumber: 'GACP-001', status: 'DRAFT' },
        { id: 'y', applicationNumber: 'GACP-002', status: 'SUBMITTED' },
    ];

    it('pickBillingAppId returns the first application id', () => {
        expect(pickBillingAppId(list)).toBe('x');
    });

    it('billingAppKey derives a stable key from id (undefined once meant colliding React keys)', () => {
        expect(billingAppKey(list[0])).toBe('x');
        expect(billingAppKey(list[1])).toBe('y');
        // Keys must be distinct so the picker buttons do not collide.
        expect(billingAppKey(list[0])).not.toBe(billingAppKey(list[1]));
    });

    it('pickBillingAppId returns null for an empty list (no auto-select)', () => {
        expect(pickBillingAppId([])).toBeNull();
    });

    it('pickBillingAppId is null-safe for a malformed/undefined list', () => {
        expect(pickBillingAppId(undefined as unknown as MyApplication[])).toBeNull();
    });
});
