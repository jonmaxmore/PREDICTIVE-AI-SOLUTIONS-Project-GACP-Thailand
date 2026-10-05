'use strict';

/**
 * notification-view — shape a Notification row for the inbox API.
 *
 * WHY THIS EXISTS: `Notification` has no `actionUrl` column
 * (prisma/schema/system.prisma). `createNotification` folds it into the `metadata`
 * JSON instead (services/notification-service.js:325-326), while both inboxes read it
 * at the top level:
 *   apps/web-app/src/app/health/notifications/client-view.tsx:255,257
 *   apps/web-app/src/app/provider/notifications/client-view.tsx:41
 * The read route returned rows straight from Prisma, so `n.actionUrl` was always
 * undefined and every call-to-action button in the platform silently disappeared —
 * "go fix your documents", "go pay", "your inspection is scheduled".
 *
 * That was a papercut while email and SMS existed. It is the whole channel now: the
 * operator decided on 2026-08-13 to delete the email and SMS code, and the
 * external-services cleanup (2026-08-19, Tasks 1-4) carried it out — the in-app inbox
 * is the only route to a farmer — including a five-working-day correction deadline
 * whose penalty is starting the application over and paying again.
 *
 * Lifting in the read layer rather than adding a column keeps this a Tier-B change with
 * no migration and no backfill: rows written months ago start working immediately,
 * because the value was always there.
 *
 * NO IMPORTS ON PURPOSE. This module must stay loadable without prisma, without env,
 * and without node_modules, so its selftest runs on a bare clone with `node` alone —
 * see notification-view.selftest.js for why that matters on the staging box.
 */

/**
 * @param {object|null|undefined} row a Notification row as Prisma returns it
 * @returns {object|null|undefined} a copy with `actionUrl` lifted out of `metadata`
 *   when it is a string; the input is never mutated.
 */
function toNotificationView(row) {
    if (!row || typeof row !== 'object') {
        return row;
    }

    // `metadata` is `Json?` — it can be null, and legacy rows can hold a non-object.
    const metadata = row.metadata;
    const candidate = metadata && typeof metadata === 'object' ? metadata.actionUrl : undefined;

    // Anything that is not a string would become a broken href. An empty string is left
    // to fall through: both inboxes guard with `{n.actionUrl && ...}`, so it renders no
    // link, which is the correct outcome.
    if (typeof candidate !== 'string') {
        return { ...row };
    }

    return { ...row, actionUrl: candidate };
}

module.exports = { toNotificationView };
