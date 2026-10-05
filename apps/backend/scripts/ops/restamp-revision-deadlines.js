#!/usr/bin/env node
'use strict';

/**
 * Blocker-F backfill (waiver-reopen decision doc §"Companion", 2026-07-08).
 *
 * PR #646 fixed the reject-deadline computation (holiday-blind server-TZ
 * services/working-days-service → Thai-holiday-aware Asia/Bangkok
 * utils/working-days) — but only for NEW stamps. Applications that are STILL
 * OPEN in REVISION_REQUESTED / CAR_PENDING carry due dates stamped by the old
 * engine; the auto-expire enforcement reads the STORED value, so wrongful
 * (too-early) expiry keeps happening for them until restamped.
 *
 * What it does, per open app in REVISION_REQUESTED/CAR_PENDING:
 *   correct = addWorkingDays(requestedAt, SLA_DAYS)  // utils/working-days (ICT + Thai holidays)
 *   if correct > storedDue:  restamp formData twins (revisionDueAt/revision_due_at
 *   or carDueAt/car_due_at) + RevisionDeadline.revisionDue (when the row exists
 *   and is PENDING/EXTENDED).
 *   NEVER shortens: if correct <= storedDue the app is skipped (extensions and
 *   manual grants are preserved).
 *
 * Usage:
 *   node apps/backend/scripts/ops/restamp-revision-deadlines.js --dry-run   # read-only report
 *   node apps/backend/scripts/ops/restamp-revision-deadlines.js --apply     # write
 *
 * Refuses to run without exactly one of --dry-run / --apply (the
 * flag-that-doesn't-exist=live-run class from the entities backfill incident).
 */

const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const APPLY = args.has('--apply');
if (DRY_RUN === APPLY) {
    console.error('Usage: restamp-revision-deadlines.js (--dry-run | --apply)');
    process.exit(1);
}

const { prisma } = require('../../services/prisma-database');
const { withoutTenantScope } = require('../../services/tenant-context');
const { addWorkingDays } = require('../../utils/working-days');
// The window length is defined ONCE, in config/business-rules.js (Law 3.5/3.6).
// A backfill that re-spells it would restamp to a number the running platform
// no longer uses the moment the config moves — the exact drift this script
// exists to repair.
const { PAYMENT } = require('../../config/business-rules');

const SLA_DAYS = PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS;

function asObject(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

function toDate(v) {
    if (!v) { return null; }
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
}

/** Pull the requestedAt + storedDue pair for the app's CURRENT state. */
function extractStamps(app) {
    const formData = asObject(app.formData);
    if (app.status === 'CAR_PENDING') {
        return {
            kind: 'CAR',
            requestedAt: toDate(formData.carRequestedAt || formData.car_requested_at),
            storedDue: toDate(formData.carDueAt || formData.car_due_at),
            dueFields: ['carDueAt', 'car_due_at'],
        };
    }
    return {
        kind: 'REVISION',
        requestedAt: toDate(formData.revisionRequestedAt || formData.revision_requested_at),
        storedDue: toDate(formData.revisionDueAt || formData.revision_due_at),
        dueFields: ['revisionDueAt', 'revision_due_at'],
    };
}

async function main() {
    console.log(`[restamp] mode=${DRY_RUN ? 'DRY-RUN (read-only)' : 'APPLY'}`);

    const apps = await withoutTenantScope(() => prisma.application.findMany({
        where: { isDeleted: false, status: { in: ['REVISION_REQUESTED', 'CAR_PENDING'] } },
        select: { id: true, applicationNumber: true, status: true, formData: true },
        orderBy: { updatedAt: 'asc' },
    }));
    console.log(`[restamp] open revision/CAR applications: ${apps.length}`);

    const report = { checked: 0, missingStamps: 0, alreadyCorrect: 0, extended: 0, restamped: [] };

    for (const app of apps) {
        report.checked += 1;
        const { kind, requestedAt, storedDue, dueFields } = extractStamps(app);
        if (!requestedAt || !storedDue) {
            report.missingStamps += 1;
            console.log(`  ~ ${app.applicationNumber} [${kind}] missing requestedAt/dueAt stamps — skipped (manual review)`);
            continue;
        }
        const correct = addWorkingDays(requestedAt, SLA_DAYS);
        if (correct.getTime() <= storedDue.getTime()) {
            // Stored due already >= holiday-aware due (correct stamp, manual
            // extension, or grant) — never shorten.
            report.alreadyCorrect += 1;
            continue;
        }

        report.extended += 1;
        const entry = {
            applicationNumber: app.applicationNumber,
            kind,
            requestedAt: requestedAt.toISOString(),
            storedDue: storedDue.toISOString(),
            correctDue: correct.toISOString(),
            gainedMs: correct.getTime() - storedDue.getTime(),
        };
        report.restamped.push(entry);
        console.log(`  + ${app.applicationNumber} [${kind}] ${entry.storedDue} -> ${entry.correctDue}`);

        if (APPLY) {
            const formData = asObject(app.formData);
            const iso = correct.toISOString();
            await withoutTenantScope(() => prisma.$transaction(async (tx) => {
                await tx.application.update({
                    where: { id: app.id },
                    data: {
                        formData: {
                            ...formData,
                            [dueFields[0]]: iso,
                            [dueFields[1]]: iso,
                            deadlineRestampedAt: new Date().toISOString(),
                            deadlineRestampReason: 'BLOCKER_F_HOLIDAY_BLIND_ENGINE',
                        },
                    },
                });
                await tx.revisionDeadline.updateMany({
                    where: { applicationId: app.id, status: { in: ['PENDING', 'EXTENDED'] } },
                    data: { revisionDue: correct, updatedBy: 'ops:restamp-blocker-f' },
                });
            }));
        }
    }

    console.log('[restamp] summary:', JSON.stringify({
        mode: DRY_RUN ? 'dry-run' : 'apply',
        checked: report.checked,
        alreadyCorrect: report.alreadyCorrect,
        missingStamps: report.missingStamps,
        extended: report.extended,
    }));
    return report;
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error('[restamp] FAILED:', e); process.exit(1); });
