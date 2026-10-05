#!/usr/bin/env node
/**
 * Backfill Renewal Reminders — Iter R2 (R2-C).
 *
 * One-shot CLI script that seeds the `formData.renewalReminders` markers for
 * tiers the renewal-reminder cron WOULD have hit during the past N days
 * (default 90), so the first live scheduled run of `renewal-reminder-cron`
 * does NOT re-fire reminders for certificates that would already have been
 * notified if the cron had been running.
 *
 * What it does:
 *   For each cadence tier in [60, 30, 15] days BACKWARDS from today across
 *   the requested window, find every ACTIVE certificate whose expiryDate
 *   falls on the tier-trigger day (i.e. the date `today - offset + tier`)
 *   and call `renewalService.markRenewalReminderSent` to write the
 *   per-tier idempotency marker. The underlying service collapses on the
 *   pair (certificateId, reminderType) so re-running this script is safe.
 *
 *   NO notifications are dispatched — this is markers-only. The live cron
 *   handles future dispatch; this script's only job is to make sure the
 *   cron does NOT immediately fire historical reminders.
 *
 * Usage on the droplet:
 *   node apps/backend/scripts/backfill-renewal-reminders.js
 *   node apps/backend/scripts/backfill-renewal-reminders.js --days 30
 *   node apps/backend/scripts/backfill-renewal-reminders.js --dry-run
 *
 * CLI flags:
 *   --days <N>   How many days BACK from today to scan (default 90).
 *   --dry-run    Print what would be marked WITHOUT writing.
 *
 * Output:
 *   Per-tier JSON summary written to stdout:
 *     { tier, scanned, marked, alreadyMarked, errors }
 *   followed by a totals line.
 *
 * Exit codes:
 *   0 — success (zero or more rows marked; any per-row failure recorded
 *       in the per-tier `errors` count without aborting)
 *   1 — fatal error before/while scanning (DB unavailable, missing service
 *       binding, unrecoverable exception)
 *
 * @module scripts/backfill-renewal-reminders
 */

'use strict';

const path = require('path');

const REMINDER_TYPE_BY_DAYS = Object.freeze({
    60: 'D60',
    30: 'D30',
    15: 'D15',
});
const TIER_DAYS = Object.freeze([60, 30, 15]);

function parseArgs(argv) {
    const args = { days: 90, dryRun: false };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--dry-run') {
            args.dryRun = true;
        } else if (token === '--days') {
            const next = argv[i + 1];
            const parsed = Number.parseInt(next, 10);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                throw new Error(`--days requires a positive integer, got "${next}"`);
            }
            args.days = parsed;
            i += 1;
        } else if (token && token.startsWith('--days=')) {
            const parsed = Number.parseInt(token.slice('--days='.length), 10);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                throw new Error(`--days requires a positive integer, got "${token}"`);
            }
            args.days = parsed;
        }
    }
    return args;
}

/**
 * Build the [start, end) UTC window for a single calendar day in server TZ.
 * Mirrors the bucket shape used by renewal-service._expiryWindow so the
 * scan picks up the same certificates the live cron would have seen on
 * that historical day.
 */
function dayWindow(target) {
    const start = new Date(target);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
}

/**
 * For a given backfill date and tier, the trigger window is the day
 * `backfillDate + tier`. Any ACTIVE certificate whose expiryDate falls
 * inside that window is one the live cron WOULD have notified on
 * `backfillDate` for that tier.
 */
function tierTriggerWindow(backfillDate, tierDays) {
    const target = new Date(backfillDate);
    target.setHours(0, 0, 0, 0);
    target.setDate(target.getDate() + tierDays);
    return dayWindow(target);
}

async function loadRuntime({ prisma: injectedPrisma, renewalService: injectedRenewal } = {}) {
    let prisma = injectedPrisma || null;
    let renewalService = injectedRenewal || null;

    if (!prisma) {
        const prismaModule = require(path.resolve(__dirname, '../services/prisma-database'));
        prisma = prismaModule && prismaModule.prisma ? prismaModule.prisma : null;
    }
    if (!renewalService) {
        renewalService = require(path.resolve(__dirname, '../services/renewal-service'));
    }

    if (!prisma) {
        throw new Error('Prisma client unavailable — cannot run backfill');
    }
    if (!renewalService || typeof renewalService.markRenewalReminderSent !== 'function') {
        throw new Error('renewal-service.markRenewalReminderSent is unavailable');
    }
    return { prisma, renewalService };
}

/**
 * Scan a single (backfill-day, tier) pair and mark every matching cert.
 * Returns the per-pair counters that the caller folds into the tier summary.
 */
async function processTierDay({
    prisma,
    renewalService,
    backfillDate,
    tierDays,
    dryRun,
    now,
    log,
}) {
    const reminderType = REMINDER_TYPE_BY_DAYS[tierDays];
    const { start, end } = tierTriggerWindow(backfillDate, tierDays);

    const certificates = await prisma.certificate.findMany({
        where: {
            isDeleted: false,
            status: 'active',
            expiryDate: { gte: start, lt: end },
        },
        select: {
            id: true,
            certificateNumber: true,
            expiryDate: true,
        },
    });

    let scanned = 0;
    let marked = 0;
    let alreadyMarked = 0;
    let errors = 0;

    for (const cert of certificates) {
        scanned += 1;
        try {
            if (dryRun) {
                log({
                    action: 'would-mark',
                    certificateId: cert.id,
                    certificateNumber: cert.certificateNumber,
                    reminderType,
                    backfillDate: backfillDate.toISOString(),
                });
                marked += 1;
                continue;
            }

            const result = await renewalService.markRenewalReminderSent({
                certificateId: cert.id,
                reminderType,
                sentAt: now,
                prisma,
            });
            if (result && result.alreadySent) {
                alreadyMarked += 1;
            } else {
                marked += 1;
            }
        } catch (_err) {
            errors += 1;
            log({
                action: 'error',
                certificateId: cert.id,
                reminderType,
                error: _err && _err.message ? _err.message : String(_err),
            });
        }
    }

    return { scanned, marked, alreadyMarked, errors };
}

/**
 * Walk all tiers BACKWARDS across the requested window.
 *
 * For each (backfillDay, tier) pair we accumulate scanned / marked /
 * alreadyMarked / errors into a per-tier total. The result is one
 * JSON-emitable summary per tier plus an overall totals object.
 */
async function backfill({
    days = 90,
    dryRun = false,
    now,
    prisma: injectedPrisma,
    renewalService: injectedRenewal,
    log,
} = {}) {
    const clock = now instanceof Date ? now : new Date();
    const emit = typeof log === 'function' ? log : () => {};

    const { prisma, renewalService } = await loadRuntime({
        prisma: injectedPrisma,
        renewalService: injectedRenewal,
    });

    const perTier = new Map(TIER_DAYS.map((tier) => [tier, {
        tier,
        type: REMINDER_TYPE_BY_DAYS[tier],
        scanned: 0,
        marked: 0,
        alreadyMarked: 0,
        errors: 0,
    }]));

    // Walk BACKWARDS — offset 0 is today, offset N is N days ago.
    for (let offset = 0; offset <= days; offset += 1) {
        const backfillDate = new Date(clock);
        backfillDate.setHours(0, 0, 0, 0);
        backfillDate.setDate(backfillDate.getDate() - offset);

        for (const tier of TIER_DAYS) {
            const slice = await processTierDay({
                prisma,
                renewalService,
                backfillDate,
                tierDays: tier,
                dryRun,
                now: clock,
                log: emit,
            });
            const cur = perTier.get(tier);
            cur.scanned += slice.scanned;
            cur.marked += slice.marked;
            cur.alreadyMarked += slice.alreadyMarked;
            cur.errors += slice.errors;
        }
    }

    const tiers = TIER_DAYS.map((tier) => perTier.get(tier));
    const totals = tiers.reduce((acc, t) => {
        acc.scanned += t.scanned;
        acc.marked += t.marked;
        acc.alreadyMarked += t.alreadyMarked;
        acc.errors += t.errors;
        return acc;
    }, { scanned: 0, marked: 0, alreadyMarked: 0, errors: 0 });

    return {
        ranAt: clock.toISOString(),
        days,
        dryRun,
        tiers,
        totals,
    };
}

async function main() {
    let parsed;
    try {
        parsed = parseArgs(process.argv.slice(2));
    } catch (_err) {

        console.error(`backfill-renewal-reminders: ${_err.message}`);
        process.exit(1);
        return;
    }

    try {
        const result = await backfill({
            days: parsed.days,
            dryRun: parsed.dryRun,
            log: (entry) => {

                console.log(JSON.stringify(entry));
            },
        });
        for (const tier of result.tiers) {

            console.log(JSON.stringify(tier));
        }

        console.log(JSON.stringify({
            ranAt: result.ranAt,
            days: result.days,
            dryRun: result.dryRun,
            totals: result.totals,
        }));
        process.exit(0);
    } catch (_err) {

        console.error(`backfill-renewal-reminders: fatal ${_err.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    backfill,
    parseArgs,
    _internals: {
        REMINDER_TYPE_BY_DAYS,
        TIER_DAYS,
        dayWindow,
        tierTriggerWindow,
        processTierDay,
    },
};
