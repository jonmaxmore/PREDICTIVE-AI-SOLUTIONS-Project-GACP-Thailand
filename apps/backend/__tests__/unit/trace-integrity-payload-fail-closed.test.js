/**
 * H2 — buildIntegrityPayload must be fail-CLOSED.
 *
 * The previous implementation used `valid: result.valid !== false`, which made a
 * null/undefined result OR a result whose `valid` was null resolve to TRUE. That
 * is fail-OPEN: an entity whose integrity could not actually be confirmed would
 * be reported as `valid: true` ("QR code verified") to a public scanner.
 *
 * A genuinely-sealed entity returns `valid` as a real boolean (never null), so
 * requiring `valid === true` (plus `available === true`) cannot break a
 * legitimately sealed entity — it only closes the fail-open hole.
 *
 * common.js imports ../../server and ../prisma-database, both of which call
 * process.exit(1) at module load without DATABASE_URL — mock them BEFORE require
 * (the project rules DB-import gotcha). buildIntegrityPayload itself is pure.
 */
'use strict';

jest.mock('../../server', () => ({ prisma: {} }));
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

const { buildIntegrityPayload } = require('../../services/trace-service/common');

describe('buildIntegrityPayload — fail-CLOSED', () => {
    test('null result → valid === false (not fail-open true)', () => {
        const out = buildIntegrityPayload(null);
        expect(out.valid).toBe(false);
    });

    test('unavailable result with valid:null → fail-CLOSED (the core RED)', () => {
        const out = buildIntegrityPayload({ available: false, valid: null });
        expect(out.valid).toBe(false);
        expect(out.available).toBe(false);
        expect(out.message).not.toBe('QR code verified');
    });

    test('sealed + valid result → valid:true, "QR code verified", fields preserved', () => {
        const out = buildIntegrityPayload({ available: true, valid: true, scanCount: 3 });
        expect(out.valid).toBe(true);
        expect(out.available).toBe(true);
        expect(out.message).toBe('QR code verified');
        expect(out.scanCount).toBe(3);
    });

    test('sealed but invalid result → valid:false, integrity-failed message', () => {
        const out = buildIntegrityPayload({ available: true, valid: false });
        expect(out.valid).toBe(false);
        expect(out.message).toBe('QR code integrity check failed');
    });
});
