'use strict';

/**
 * The read witness (spec 2026-09-30-remove-workspace-mode §3.1 guard).
 *
 * Check-only. tenantInjectExtension calls checkHolderScoped first in every
 * hooked read op, before applyReadScopes rewrites the args. When
 *   - the request's principal is 'health' (tenant-context middleware sets it
 *     from req.user.canonicalRole; jobs, cron, scripts and withoutTenantScope
 *     have no principal and are never witnessed),
 *   - the model is holder-bearing (WATCHED_MODELS), and
 *   - args.where holds no fragment registered for that model in this request
 *     (isRegisteredHolderScoped: top level, a top-level AND member, or every
 *     OR branch, compared by canonical value),
 * it counts health_read_unscoped_total{model,op} and logs signal
 * HEALTH_READ_UNSCOPED with model, op, route and principal (plus checkError
 * when the check itself failed, which counts as unscoped). In mode 'throw' it
 * then throws code HEALTH_READ_UNSCOPED, so the read never runs. Mode comes
 * from config/holder-read-witness.js (HOLDER_READ_WITNESS, default 'shadow').
 *
 * By value, not by the symbol marker: Prisma 5.22 hands each hook a deep
 * clone of the caller's args, so the symbol and object identity never arrive
 * (pinned on a real Postgres by holder-marker-prisma-real-postgres.test.js).
 *
 * What the witness does not see:
 *   - the caller's file: the hook runs inside PrismaPromise.then, whose stack
 *     holds only Prisma frames; the logged route is the pointer instead;
 *   - relation reads nested in include/select of another model's read;
 *   - a where value-equal to a fragment registered earlier in the same request
 *     (the same predicate, so genuinely scoped).
 *
 * Ordering is load-bearing: under R1 the entity dimension of applyReadScopes
 * still overwrites `where.entityId` for Application and Farm, which would
 * break the value equality. The witness must see the where before that.
 *
 * Shadow mode must never change a read: the counter and the log are each
 * wrapped, and a failure in either is swallowed. This module requires nothing
 * that requires prisma-database (the extension loads it while prisma-database
 * is still initialising); the Prometheus counter is required lazily.
 */

const { getTenantContext } = require('./tenant-context');
const { isWatchedModel } = require('./holder-marker');
const { isRegisteredHolderScoped } = require('./holder-fragment-registry');
// Called through the module object, so a test can observe how often the mode is read.
const witnessConfig = require('../config/holder-read-witness');
const logger = require('../shared/logger');

const SIGNAL = 'HEALTH_READ_UNSCOPED';

let unscopedCounter = null;
function incrementCounter(model, op) {
    try {
        if (!unscopedCounter) {
            unscopedCounter = require('../shared/prometheus').healthReadUnscopedTotal;
        }
        unscopedCounter.inc({ model, op });
    } catch (_) { /* a witness must never affect the read it only measures */ }
}

function report(model, op, ctx, checkError) {
    incrementCounter(model, op);
    try {
        const meta = { signal: SIGNAL, model, op, route: ctx.route || null, principal: ctx.principal };
        if (checkError) { meta.checkError = String(checkError.message || checkError); }
        logger.warn('[holder-read-witness] health read of a holder-bearing model with no registered holder fragment', meta);
    } catch (_) { /* a witness must never affect the read it only measures */ }
}

/**
 * Witness one read op. Returns nothing; in mode 'throw' throws an Error with
 * code HEALTH_READ_UNSCOPED.
 * @param {string} model — Prisma model name
 * @param {string} op — the read operation (findMany, findUnique, count, ...)
 * @param {object|undefined} args — the caller's args, before any rewrite
 */
function checkHolderScoped(model, op, args) {
    // Cheapest test first: most reads are of unwatched models.
    if (!isWatchedModel(model)) { return; }
    const mode = witnessConfig.holderReadWitnessMode();
    if (mode === 'off') { return; }
    const ctx = getTenantContext();
    if (!ctx || ctx.principal !== 'health') { return; }

    // The check itself must never change a read in shadow mode: an error in it
    // (an unexpected value in Prisma's clone of the args) counts and logs the
    // read once as unscoped, and only throw mode turns that into a rejection
    // (fail closed).
    let scoped = false;
    let checkError = null;
    try {
        scoped = isRegisteredHolderScoped(model, args?.where, ctx);
    } catch (error) {
        checkError = error || new Error('holder check failed');
    }
    if (scoped) { return; }

    report(model, op, ctx, checkError);
    if (mode === 'throw') {
        const error = new Error(`${SIGNAL}: health read ${model}.${op} has no holder scope (spread holderReadWhere into where)`);
        error.code = SIGNAL;
        error.model = model;
        error.op = op;
        throw error;
    }
}

module.exports = { checkHolderScoped, HEALTH_READ_UNSCOPED: SIGNAL };
