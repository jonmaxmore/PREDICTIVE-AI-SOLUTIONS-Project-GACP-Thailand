'use strict';

/**
 * Stale PENDING document pre-check sweep (final review M4, 2026-09-29).
 *
 * The queue's `failed` handler (services/queue-service.js) closes every job Bull
 * itself gives up on. What it never sees — a job lost with Redis, or the database
 * down inside `markFailed` — leaves the pre-check PENDING for ever: the applicant's
 * card keeps saying "กำลังตรวจเอกสาร…" and the officer's row never settles. This
 * sweep turns a row still PENDING past STALE_PENDING_AFTER_MS into FAILED with the
 * one failure flag, through the same `failPrecheck` the queue handler uses.
 *
 * WHY 10 MINUTES, AND WHY THE QUEUE IS ASKED. The longest a RUNNING job can hold
 * a row PENDING is two attempts of the queue's 120 s job timeout plus the 30 s
 * backoff (PRECHECK_JOB_OPTIONS, services/queue-service.js) = 4.5 minutes. But the
 * queue runs one job at a time, so a burst of uploads leaves the last ones merely
 * WAITING well past that (fix round 1, I1: ~12 uploads pass 10 minutes). So a row
 * PENDING for 10-60 minutes is failed only when its Bull job (job id = pre-check id,
 * set by enqueueForUpload) is missing, completed or failed — or when the queue
 * cannot answer at all. A job that is waiting, active, delayed or paused is left
 * alone. Past HARD_CEILING_MS the row is failed whatever the queue says: an hour
 * in the queue is a queue that is not draining, and the applicant must be told.
 * Rows enqueued before job ids were set have no job under their id and are treated
 * as missing.
 *
 * TENANCY. The scan is cross-tenant by design (the cron holds no tenant), so it
 * runs under `withoutTenantScope`; each write re-enters the row's own tenant inside
 * `failPrecheck` (same idiom as jobs/settlement-reconcile-job.js).
 *
 * IDEMPOTENT. `markFailed` moves a row only `WHERE status = 'PENDING'` and adds the
 * flag in the same transaction, so a second run — or a race with the queue handler
 * or a late job — never adds a second flag.
 *
 * Bounded (BATCH_LIMIT per run, oldest first) and fault-isolated per row: one row's
 * failure is counted in `errors` and the sweep goes on.
 */

const { prisma } = require('../services/prisma-database');
const { withoutTenantScope } = require('../services/tenant-context');
const { failPrecheck } = require('../services/document-precheck/service');
const { getPrecheckQueue } = require('../services/queue-service');
const { PRECHECK_STATUS } = require('../services/document-precheck/status');
const { createLogger } = require('../shared/logger');

const logger = createLogger('document-precheck-stale-sweep');

/** A PENDING row older than this is reaped. See "WHY 10 MINUTES" above. */
const STALE_PENDING_AFTER_MS = 10 * 60 * 1000;

/** Past this a PENDING row is failed even while its job is still live in the queue. */
const HARD_CEILING_MS = 60 * 60 * 1000;

/** Bull states in which the job will still run (or is running): leave its row alone. */
const LIVE_JOB_STATES = new Set(['waiting', 'active', 'delayed', 'paused']);

/** Rows per run; the next run (every 5 minutes) takes the rest. */
const BATCH_LIMIT = 200;

/**
 * Is this row's Bull job still going to run? false when there is no queue, the
 * queue cannot answer, or the job is missing / completed / failed.
 *
 * @param {object|null} queue Bull queue (or null when it is not initialised)
 * @param {string} precheckId
 * @returns {Promise<boolean>}
 */
async function jobIsLive(queue, precheckId) {
    if (!queue) { return false; }
    try {
        const job = await queue.getJob(precheckId);
        if (!job) { return false; }
        return LIVE_JOB_STATES.has(await job.getState());
    } catch (error) {
        logger.warn(`[precheck-stale-sweep] queue could not say the state of ${precheckId} (${error.message}); failing the row`);
        return false;
    }
}

/**
 * @param {{now?: Date, queue?: object|null}} [options] `queue` defaults to the
 *        live pre-check queue; tests pass a stand-in (or null for "unavailable").
 * @returns {Promise<{scanned: number, failed: number, live: number, skipped: number, errors: number}>}
 */
async function runStalePrecheckSweep({ now = new Date(), queue = getPrecheckQueue() } = {}) {
    const cutoff = new Date(now.getTime() - STALE_PENDING_AFTER_MS);
    const ceiling = new Date(now.getTime() - HARD_CEILING_MS);
    const stats = { scanned: 0, failed: 0, live: 0, skipped: 0, errors: 0 };

    // `async` + `await` INSIDE the bypass, not `() => prisma…findMany()`: a Prisma
    // query is a lazy thenable that runs when it is awaited, so returning it
    // un-awaited runs it back OUTSIDE withoutTenantScope — under whatever tenant
    // the caller holds. Measured: called inside org A's context, the un-awaited
    // form scanned org A's stale row only (evidence/precheck-followups/5-stale-sweep).
    const rows = await withoutTenantScope(async () => await prisma.documentPrecheck.findMany({
        where: { status: PRECHECK_STATUS.PENDING, createdAt: { lt: cutoff } },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: BATCH_LIMIT,
    }));

    for (const row of rows) {
        stats.scanned += 1;
        try {
            const pastCeiling = row.createdAt < ceiling;
            if (!pastCeiling && await jobIsLive(queue, row.id)) {
                stats.live += 1;
                continue;
            }
            if (await failPrecheck(row.id)) {
                stats.failed += 1;
            } else {
                // Settled between the scan and the write (the job finished, or the
                // queue handler got there first) — nothing to do.
                stats.skipped += 1;
            }
        } catch (error) {
            stats.errors += 1;
            logger.error(`[precheck-stale-sweep] ${row.id} could not be marked FAILED: ${error.message}`);
        }
    }

    if (stats.scanned > 0) {
        logger.info('[precheck-stale-sweep] done', stats);
    }
    return stats;
}

module.exports = { runStalePrecheckSweep, STALE_PENDING_AFTER_MS, HARD_CEILING_MS, BATCH_LIMIT };
