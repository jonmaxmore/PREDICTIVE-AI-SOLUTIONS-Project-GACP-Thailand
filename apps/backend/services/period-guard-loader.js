'use strict';

/**
 * Load the journal period guard at CALL time, or refuse the post.
 *
 * Controller ruling 2026-09-26 (bangkok-time re-review 2, New 2): the period
 * guard FAILS CLOSED. A journal writer that cannot load the guard must not skip
 * the closed-period check — it refuses with PERIOD_CHECK_UNAVAILABLE (503), the
 * same code the guard throws when it cannot ask the database.
 *
 * Loaded at call time, not at module load: a module captured during a require
 * cycle can be half-built (see services/journal-accounts.js). By the time a
 * post happens every module has finished loading, so a call-time require
 * returns the complete guard whichever module Node loaded first.
 *
 * This file requires nothing at load time, so it cannot itself fail to load
 * for any reason the guard could.
 */

function periodCheckUnavailable(reason) {
    return Object.assign(
        new Error(`Period-close check unavailable — refusing the journal post (${reason})`),
        { code: 'PERIOD_CHECK_UNAVAILABLE', statusCode: 503, httpStatus: 503 },
    );
}

/**
 * @returns {{ checkPeriodOpen: Function }}
 * @throws {Error & { code: 'PERIOD_CHECK_UNAVAILABLE' }}
 */
function loadPeriodGuardOrRefuse() {
    let guard;
    try {
        guard = require('./journal-entry-period-guard');
    } catch (err) {
        throw periodCheckUnavailable(`journal-entry-period-guard failed to load: ${err && err.message}`);
    }
    if (!guard || typeof guard.checkPeriodOpen !== 'function') {
        throw periodCheckUnavailable('journal-entry-period-guard has no checkPeriodOpen');
    }
    return guard;
}

module.exports = { loadPeriodGuardOrRefuse, periodCheckUnavailable };
