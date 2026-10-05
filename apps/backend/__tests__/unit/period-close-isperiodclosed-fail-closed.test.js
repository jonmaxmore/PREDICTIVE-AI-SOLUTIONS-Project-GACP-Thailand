/**
 * Bug 7.4 — period-close-service.isPeriodClosed FAILS CLOSED on a DB error.
 *
 * Before this fix isPeriodClosed had `.catch((err) => { logger.warn(...);
 * return null })` on the periodClose query, so a transient DB error was
 * swallowed and the period was reported OPEN (Boolean(null) === false) — a
 * back-dated / closed-period journal entry could then slip through while the
 * period-close table was unreachable. Owner decision (bug-hunt Batch 7):
 * FAIL CLOSED — throw a typed PERIOD_CHECK_UNAVAILABLE so the caller blocks
 * the post (mapped to 503) rather than allowing it.
 *
 * This suite is a SEPARATE file (not period-close-lock-enforcement.test.js) on
 * purpose: that suite `jest.doMock('period-close-service', …)` to test the
 * guard in isolation, and a doMock registration for a module leaks across the
 * whole file's requires. Here we need the REAL period-close-service with only
 * prisma-database mocked, so it must live on its own.
 */

'use strict';

describe('[Bug 7.4] period-close-service.isPeriodClosed — fail-CLOSED on DB error', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('THROWS PERIOD_CHECK_UNAVAILABLE when the periodClose query rejects', async () => {
        jest.doMock('../../services/prisma-database', () => ({
            prisma: {
                periodClose: {
                    findFirst: jest.fn(async () => { throw new Error('connection reset by peer'); }),
                },
            },
        }));
        const svc = require('../../services/period-close-service');
        // adversarial-verify finding 5: carries statusCode 503 so sendServiceError
        // routes + the /check read route return 503 (transient), not 500.
        await expect(svc.isPeriodClosed({ year: 2026, month: 4, organizationId: 'org-1' }))
            .rejects.toMatchObject({ code: 'PERIOD_CHECK_UNAVAILABLE', statusCode: 503 });
    });

    test('returns false for an OPEN period (no CLOSED row) — normal path unaffected', async () => {
        jest.doMock('../../services/prisma-database', () => ({
            prisma: { periodClose: { findFirst: jest.fn(async () => null) } },
        }));
        const svc = require('../../services/period-close-service');
        await expect(svc.isPeriodClosed({ year: 2026, month: 4, organizationId: 'org-1' }))
            .resolves.toBe(false);
    });

    test('returns true when a CLOSED row exists — normal path unaffected', async () => {
        jest.doMock('../../services/prisma-database', () => ({
            prisma: { periodClose: { findFirst: jest.fn(async () => ({ id: 'pc-1' })) } },
        }));
        const svc = require('../../services/period-close-service');
        await expect(svc.isPeriodClosed({ year: 2026, month: 4, organizationId: 'org-1' }))
            .resolves.toBe(true);
    });

    test('returns false (not throw) for invalid args — input guard, not a DB failure', async () => {
        jest.doMock('../../services/prisma-database', () => ({
            prisma: { periodClose: { findFirst: jest.fn() } },
        }));
        const svc = require('../../services/period-close-service');
        await expect(svc.isPeriodClosed({ year: NaN, month: 4, organizationId: 'org-1' }))
            .resolves.toBe(false);
    });
});
