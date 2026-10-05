/**
 * Renewal Reminder Cron — Iter 26 (2026-05-16).
 *
 * Daily script (suggested 09:00 ICT) that walks each cadence tier
 * [60, 30, 15] days and dispatches the CERTIFICATE_EXPIRING_SOON
 * notification to every farmer whose ACTIVE certificate expires on
 * exactly that day. Each tier is idempotent — the `markRenewalReminderSent`
 * service writes the reminder marker so a re-run on the same day skips
 * already-sent reminders.
 *
 * Scheduling: this file is a self-contained script. The orchestrator
 * (cron daemon, Kubernetes CronJob, or jobs/scheduler.js if we wire it
 * into the in-process node-cron stack) decides cadence. Two common
 * invocations:
 *
 *   1) System cron / supervisord:
 *      `0 2 * * *  node apps/backend/cron/renewal-reminder-cron.js`
 *      (02:00 UTC = 09:00 ICT)
 *
 *   2) Kubernetes CronJob:
 *      apiVersion: batch/v1
 *      kind: CronJob
 *      spec: { schedule: "0 2 * * *", ... }
 *
 *   3) In-process (only if you want single-process scheduling):
 *      add a node-cron entry inside apps/backend/jobs/scheduler.js
 *      that requires this module's `run()` export.
 *
 * The body exits the process when invoked as a top-level script so a
 * supervisord / k8s CronJob has a clean exit code (0 success, 1 failure).
 * When `require()`d from the in-process scheduler we just return the
 * summary object — no process.exit.
 *
 * Notification dispatch:
 *   - notification-fanout-service.send(type=CERTIFICATE_EXPIRING_SOON)
 *     fans the message out across IN_APP + EMAIL + SMS based on the
 *     user's notificationSettings (default-allow per Iter 23 contract).
 *   - The fanout's built-in 60-minute dedupe protects against accidental
 *     double-trigger on the same day.
 *   - We additionally write a per-cert marker via markRenewalReminderSent
 *     so subsequent runs (e.g. a retry after a partial outage) do not
 *     re-send the same tier the next day.
 *
 * @module cron/renewal-reminder-cron
 */

'use strict';

const logger = require('../shared/logger');
const renewalService = require('../services/renewal-service');
const notificationFanoutService = require('../services/notification-fanout-service');
const { getZonedParts } = require('../utils/working-days');

const RENEWAL_URL_BASE = process.env.RENEWAL_URL_BASE
    || 'https://gacpth.com/dashboard/certificates';

/**
 * Build a CERTIFICATE_EXPIRING_SOON payload that the fanout service can
 * render. Since the template registry lives inside notification-fanout-
 * service.js (touched-by-Iter-23 boundary), we ship a raw template
 * override here — the fanout service's `send()` falls back gracefully
 * when the type has no registered template (it logs and goes IN_APP-only),
 * so we ship a more useful path: we pass the type, and the payload that
 * already contains the rendered strings the notification-service IN_APP
 * row will read. EMAIL + SMS transports also pick the payload-supplied
 * `template` if the fanout layer's resolver returns null (future patch
 * promotes this to a first-class template, but that requires touching
 * notification-fanout-service which is Iter 23's territory).
 *
 * The applicant-facing copy matches the spec exactly:
 *   "ใบรับรองของท่านจะหมดอายุในอีก {daysLeft} วัน ({{expiryDate}}).
 *    กรุณาดำเนินการต่ออายุที่ {{renewalUrl}}"
 */
function _buildRenewalPayload({ certificate, daysBeforeExpiry }) {
    const expiryDate = certificate.expiryDate
        ? new Date(certificate.expiryDate)
        : null;
    const expiryDateText = expiryDate
        ? (({ day, month, year }) => `${day}/${month}/${year + 543}`)(getZonedParts(expiryDate)) // Bangkok day
        : '-';
    const renewalUrl = `${RENEWAL_URL_BASE}/${certificate.id}/renew`;
    const messageTH =
        `ใบรับรองของท่านจะหมดอายุในอีก ${daysBeforeExpiry} วัน `
        + `(${expiryDateText}). กรุณาดำเนินการต่ออายุที่ ${renewalUrl}`;
    return {
        certificateId: certificate.id,
        certNumber: certificate.certificateNumber,
        farmName: certificate.farmName,
        daysLeft: daysBeforeExpiry,
        expiryDate: certificate.expiryDate,
        expiryDateText,
        renewalUrl,
        actionUrl: renewalUrl,
        priority: daysBeforeExpiry <= 15 ? 'HIGH' : 'NORMAL',
        // Inline-rendered strings used by the IN_APP notification row when
        // the fanout template registry has no entry for the type:
        title: 'ใบรับรอง GACP ใกล้หมดอายุ',
        message: messageTH,
        bodyTHHtml: `<p>${messageTH}</p>`,
        bodyTHText: messageTH,
        smsTH: messageTH,
    };
}

/**
 * Process a single cadence tier (e.g. 60 days). Returns
 * { tier, found, sent, skipped, failed } for the summary.
 */
async function _processTier({ daysBeforeExpiry, now }) {
    const tierType = renewalService.REMINDER_TYPE_BY_DAYS[daysBeforeExpiry];
    if (!tierType) {
        logger.warn('[renewal-reminder-cron] unknown tier, skipping', { daysBeforeExpiry });
        return { tier: daysBeforeExpiry, found: 0, sent: 0, skipped: 0, failed: 0 };
    }

    const certificates = await renewalService.getApplicationsForRenewalReminder({
        daysBeforeExpiry,
        now,
    });

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const cert of certificates) {
        try {
            // Idempotency check — if we already marked this tier sent for
            // this certificate, skip the fanout dispatch entirely.
            const probe = await renewalService.markRenewalReminderSent({
                certificateId: cert.id,
                reminderType: tierType,
                sentAt: now,
            });
            if (probe.alreadySent) {
                skipped += 1;
                continue;
            }

            const payload = _buildRenewalPayload({ certificate: cert, daysBeforeExpiry });
            const fanoutResult = await notificationFanoutService.send({
                userId: cert.userId,
                type: 'CERTIFICATE_EXPIRING_SOON',
                payload,
            });

            // Best-effort: rewrite the marker with the dispatch id so we
            // can audit which fanout call covered which reminder.
            if (fanoutResult?.dedupeKey) {
                // markRenewalReminderSent is idempotent — re-call writes
                // a no-op when the entry already exists; we'd want to
                // patch the dispatchId only on first insert. Today's
                // service collapses on first-write so we don't double-
                // record. A future iteration can add an `update` path.
            }

            sent += 1;
        } catch (err) {
            failed += 1;
            logger.error('[renewal-reminder-cron] failed to send reminder', {
                certificateId: cert.id,
                tier: tierType,
                error: err?.message,
            });
        }
    }

    return {
        tier: daysBeforeExpiry,
        type: tierType,
        found: certificates.length,
        sent,
        skipped,
        failed,
    };
}

/**
 * Run the cron — walks all configured cadence tiers and returns a
 * per-tier summary. Safe to call repeatedly on the same day (idempotent).
 *
 * @param {object} [opts]
 * @param {Date} [opts.now]   — clock injection (tests)
 * @returns {Promise<{ ranAt: string, summary: Array }>}
 */
async function run({ now } = {}) {
    const clock = now instanceof Date ? now : new Date();
    const ranAt = clock.toISOString();
    logger.info('[renewal-reminder-cron] start', { ranAt });

    const summary = [];
    for (const days of renewalService.REMINDER_DAYS) {
        try {
            const tierSummary = await _processTier({ daysBeforeExpiry: days, now: clock });
            summary.push(tierSummary);
            logger.info('[renewal-reminder-cron] tier complete', tierSummary);
        } catch (err) {
            logger.error('[renewal-reminder-cron] tier failed', {
                tier: days,
                error: err?.message,
            });
            summary.push({ tier: days, error: err?.message });
        }
    }

    const totals = summary.reduce(
        (acc, t) => {
            acc.found += t.found || 0;
            acc.sent += t.sent || 0;
            acc.skipped += t.skipped || 0;
            acc.failed += t.failed || 0;
            return acc;
        },
        { found: 0, sent: 0, skipped: 0, failed: 0 },
    );

    logger.info('[renewal-reminder-cron] finished', { ranAt, totals });
    return { ranAt, summary, totals };
}

// CLI entry-point — when invoked directly as `node renewal-reminder-cron.js`
// we exit with a status code so supervisord / k8s CronJob can report success.
if (require.main === module) {
    run()
        .then((result) => {
             
            console.log(JSON.stringify(result, null, 2));
            process.exit(0);
        })
        .catch((err) => {
            logger.error('[renewal-reminder-cron] fatal', { error: err?.message });
            process.exit(1);
        });
}

module.exports = {
    run,
    _internals: {
        _buildRenewalPayload,
        _processTier,
    },
};
