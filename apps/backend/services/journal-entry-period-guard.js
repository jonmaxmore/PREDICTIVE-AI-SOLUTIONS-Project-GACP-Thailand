/**
 * Journal Entry Period Guard — interceptor for closed-period enforcement.
 *
 * Iter 24 (2026-05-16). This module owns the closed-period lock check
 * that gates new journal entries posted with `entryDate` inside a
 * CLOSED PeriodClose row. It is split out of journal-entry-service
 * to keep that file's surface area unchanged for parallel batches
 * (B24-A Invoice columns, B24-C recordReversingEntry).
 *
 * Inversion-of-dependency rationale:
 *   - journal-entry-service.js (the entry writer) is touched by multiple
 *     iterations simultaneously. Adding a hard `require` to
 *     period-close-service inside that file would create a merge hotspot
 *     and tangle the schema-coupling story.
 *   - Instead, callers of journal-entry-service.recordPaymentEntry /
 *     recordReversingEntry / postManualEntry opt-in to the period-close
 *     check by calling `checkPeriodOpen({ entryDate, organizationId })`
 *     BEFORE the entry insert. The slip-flow caller, the manual JE
 *     poster, and the future reversing-entry caller all share this one
 *     guard.
 *
 * Compliance basis:
 *   - TFRS for NPAEs ch.5 — year-end close enforcement requires that no
 *     entry can be posted to a closed period without explicit ADMIN
 *     override.
 *   - TFRS for NPAEs ch.2 — chronological integrity of the GL.
 *   - ป.รัษฎากร ม.86/4 — VAT period closure aligns with monthly ภ.พ.30.
 *
 * Usage:
 *
 *   const periodGuard = require('./journal-entry-period-guard');
 *   await periodGuard.checkPeriodOpen({
 *     entryDate: invoice.paidAt,
 *     organizationId,
 *     allowClosedPeriod: meta?.allowClosedPeriod === true,
 *   });
 *   // ... then proceed with journal entry insertion ...
 *
 * On a closed period the function throws an Error with code = PERIOD_CLOSED
 * and metadata about the year/month so the caller can surface a 409 to
 * the API consumer.
 *
 * @module services/journal-entry-period-guard
 */

'use strict';
const { getZonedParts } = require('../utils/working-days');
const { periodCheckUnavailable } = require('./period-guard-loader');

/**
 * period-close-service, loaded at CALL time. A module captured at load time can
 * be a half-built one from a require cycle (the guard kept period-close's empty
 * exports and let posts through — re-review 1); at call time every module has
 * finished loading. Tests still jest.doMock it before requiring the guard.
 *
 * FAILS CLOSED (controller ruling 2026-09-26): if the service cannot load, or
 * has no isPeriodClosed, the post is REFUSED with PERIOD_CHECK_UNAVAILABLE —
 * never waved through.
 */
function loadPeriodCloseServiceOrRefuse() {
    let svc;
    try {
        svc = require('./period-close-service');
    } catch (err) {
        throw periodCheckUnavailable(`period-close-service failed to load: ${err && err.message}`);
    }
    if (!svc || typeof svc.isPeriodClosed !== 'function') {
        throw periodCheckUnavailable('period-close-service has no isPeriodClosed');
    }
    return svc;
}

/**
 * Throw PERIOD_CLOSED when `entryDate` lands in a CLOSED PeriodClose row
 * for `organizationId`. Bypass with `allowClosedPeriod=true` (ADMIN
 * recovery path — caller is responsible for verifying the role).
 *
 * Defensive about inputs: an invalid `entryDate` returns silently
 * (the caller's date validator will surface the real error). A missing
 * organizationId still consults the global period (organizationId-less
 * close rows are matched in service.isPeriodClosed by omitting the
 * filter).
 *
 * @param {object} args
 * @param {Date|string|number} args.entryDate
 * @param {string} [args.organizationId]
 * @param {boolean} [args.allowClosedPeriod=false]
 * @returns {Promise<void>}
 */
async function checkPeriodOpen({ entryDate, organizationId, allowClosedPeriod = false } = {}) {
    if (allowClosedPeriod === true) {
        return;
    }
    const periodCloseService = loadPeriodCloseServiceOrRefuse();
    const d = entryDate instanceof Date ? entryDate : new Date(entryDate);
    if (!d || Number.isNaN(d.getTime())) {
        return;
    }
    // The accounting month is the Bangkok calendar month — the same month the
    // ภ.พ.30 report files the entry under (vat-report-service toMonthBoundaries).
    // A UTC month put an entry at 03:00 on 1 Oct in Bangkok into September
    // (review 2026-09-26, operator ruling "เวลาไทยทั้งหมด").
    const { year, month } = getZonedParts(d); // month is 1-based for the API contract
    // Bug 7.4: do NOT `.catch(() => false)` here. The old swallow meant a DB
    // error inside isPeriodClosed silently reported the period OPEN → the entry
    // posted into a period we could not confirm was open (fail-open). Let BOTH
    // PERIOD_CLOSED (period is closed → 409) and the new PERIOD_CHECK_UNAVAILABLE
    // (cannot check → 503) propagate to the caller, which blocks the post.
    const closed = await periodCloseService.isPeriodClosed({
        year,
        month,
        organizationId: organizationId || null,
    });
    if (closed) {
        throw Object.assign(
            new Error(
                `Cannot post journal entry to closed period ${year}-${String(month).padStart(2, '0')} `
                + `(organizationId=${organizationId || 'global'}). `
                + 'Reopen the period via period-close-service.reopenPeriod or '
                + 'set meta.allowClosedPeriod=true for the ADMIN recovery path.',
            ),
            {
                code: 'PERIOD_CLOSED',
                // Bug 7.4 (adversarial-verify finding 5): carry the HTTP status on
                // the error itself so routes that map via sendServiceError
                // (credit-notes / debit-notes) return 409 — not a generic 500 —
                // without each route needing an explicit err.code branch.
                statusCode: 409,
                httpStatus: 409,
                year,
                month,
                organizationId: organizationId || null,
            },
        );
    }
}

module.exports = {
    checkPeriodOpen,
};
