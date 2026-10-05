'use strict';

/**
 * Read-witness mode (spec 2026-09-30-remove-workspace-mode §3.1 guard).
 *
 * HOLDER_READ_WITNESS selects what services/holder-read-witness.js does with a
 * health read of a holder-bearing model whose `where` holds no holder fragment
 * registered (by value) in the current request:
 *   'off'    — nothing, and holderReadWhere/farmAccessWhere register nothing;
 *   'shadow' — count health_read_unscoped_total{model,op} and log model, op,
 *              route and principal, then let the read run (the default: R1 is
 *              behaviour-neutral);
 *   'throw'  — the same, then reject the read with code HEALTH_READ_UNSCOPED.
 * An unset or unknown value is 'shadow', so a typo never turns the witness off,
 * except under NODE_ENV=test, where it is 'throw' (spec §3.1 guard part 1, Task 6):
 * every real-database suite then fails on a health read that carries no holder
 * fragment. An explicit value still wins, so a suite may opt into 'shadow'.
 *
 * Read once and cached: the witness asks on every health read of a watched
 * model, so it must not parse process.env each time. A change takes effect on
 * restart; tests call resetHolderReadWitnessModeCache after changing the env.
 */

const MODES = Object.freeze(['off', 'shadow', 'throw']);
const DEFAULT_MODE = 'shadow';
const TEST_DEFAULT_MODE = 'throw';

function defaultMode() {
    return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'test' ? TEST_DEFAULT_MODE : DEFAULT_MODE;
}

let cachedMode = null;

/**
 * Deployed environments where 'throw' is refused (Task 4 fix round 1, Minor 4).
 * Several health paths still swallow their own read errors (the document sync,
 * quotation issuance on submit, the status writer's formData pre-read, the
 * pre-check enqueue), so a rejected read there would lose a write silently.
 * 'throw' is a test instrument until every health read is converted.
 */
const THROW_REFUSED_NODE_ENVS = Object.freeze(['production', 'staging']);
const THROW_REFUSED_DEPLOY_ENVS = Object.freeze(['production', 'staging', 'demo']);

function throwRefusedHere() {
    const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
    const deployEnv = String(process.env.SENTRY_ENVIRONMENT || '').trim().toLowerCase();
    return THROW_REFUSED_NODE_ENVS.includes(nodeEnv) || THROW_REFUSED_DEPLOY_ENVS.includes(deployEnv);
}

/** @returns {'off'|'shadow'|'throw'} */
function holderReadWitnessMode() {
    if (cachedMode === null) {
        const raw = String(process.env.HOLDER_READ_WITNESS || '').trim().toLowerCase();
        let mode = MODES.includes(raw) ? raw : defaultMode();
        if (mode === 'throw' && throwRefusedHere()) {
            mode = DEFAULT_MODE;
            try {
                require('../shared/logger').warn(
                    '[holder-read-witness] HOLDER_READ_WITNESS=throw is refused in a deployed environment; running in shadow mode',
                    { nodeEnv: process.env.NODE_ENV || null, deployEnv: process.env.SENTRY_ENVIRONMENT || null },
                );
            } catch (_) { /* the downgrade stands even if the warning cannot be logged */ }
        }
        cachedMode = mode;
    }
    return cachedMode;
}

/** Drop the cached mode so the next call re-reads HOLDER_READ_WITNESS (tests). */
function resetHolderReadWitnessModeCache() {
    cachedMode = null;
}

module.exports = {
    holderReadWitnessMode,
    resetHolderReadWitnessModeCache,
    HOLDER_READ_WITNESS_MODES: MODES,
    THROW_REFUSED_NODE_ENVS,
    THROW_REFUSED_DEPLOY_ENVS,
};
