#!/usr/bin/env node
'use strict';

/**
 * Blocker-F wrongful-expiry cohort identification (READ-ONLY).
 * Waiver-reopen decision doc §"Companion" / owner fork #4, 2026-07-08.
 *
 * Finds applications that were auto-EXPIRED under the OLD holiday-blind
 * deadline engine where the holiday-aware recompute (utils/working-days,
 * post-#646) yields a LATER due date than the one enforcement used — i.e. the
 * platform cancelled them EARLY (platform fault, not farmer fault).
 *
 * For each hit it also reports whether the same applicant (canonicalId token)
 * has since re-applied and PAID again — the "paid-twice" sub-cohort whose
 * restitution needs an explicit owner/DTAM decision (the fee-reuse reopen
 * cannot retro-fix a second payment already made).
 *
 * Output: JSON report to stdout. Writes NOTHING.
 *
 * Usage: node apps/backend/scripts/ops/identify-wrongful-expiry-cohort.js
 */

const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

const { prisma } = require('../../services/prisma-database');
const { withoutTenantScope } = require('../../services/tenant-context');
const { addWorkingDays } = require('../../utils/working-days');
// Same single definition the platform enforces with (Law 3.5/3.6). A cohort
// report that recomputes on its own copy of the number would name the wrong
// applications the moment the two diverge.
const { PAYMENT } = require('../../config/business-rules');

const SLA_DAYS = PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS;

function asObject(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function toDate(v) {
    if (!v) { return null; }
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
}

function extractStamps(formData, cancelReason) {
    const isCar = String(cancelReason || '').toUpperCase().includes('CAR');
    if (isCar) {
        return {
            kind: 'CAR',
            requestedAt: toDate(formData.carRequestedAt || formData.car_requested_at),
            enforcedDue: toDate(formData.carDueAt || formData.car_due_at),
        };
    }
    return {
        kind: 'REVISION',
        requestedAt: toDate(formData.revisionRequestedAt || formData.revision_requested_at),
        enforcedDue: toDate(formData.revisionDueAt || formData.revision_due_at),
    };
}

async function main() {
    const expired = await withoutTenantScope(() => prisma.application.findMany({
        where: { isDeleted: false, status: 'EXPIRED' },
        select: {
            id: true, applicationNumber: true, healthId: true,
            formData: true, updatedAt: true,
        },
        orderBy: { updatedAt: 'asc' },
    }));
    console.error(`[cohort] EXPIRED applications: ${expired.length}`);

    const report = { totalExpired: expired.length, unstamped: 0, rightful: 0, wrongful: [] };

    for (const app of expired) {
        const formData = asObject(app.formData);
        const { kind, requestedAt, enforcedDue } = extractStamps(formData, formData.cancelReason);
        if (!requestedAt || !enforcedDue) { report.unstamped += 1; continue; }

        const correctDue = addWorkingDays(requestedAt, SLA_DAYS);
        if (correctDue.getTime() <= enforcedDue.getTime()) { report.rightful += 1; continue; }

        // Wrongful: the platform enforced an earlier deadline than the legal
        // holiday-aware one. Check whether the expiry actually happened inside
        // the stolen window is not recoverable post-hoc (we only know the
        // enforcement threshold was wrong) — flag ALL such rows for review.
        const entry = {
            applicationNumber: app.applicationNumber,
            kind,
            requestedAt: requestedAt.toISOString(),
            enforcedDue: enforcedDue.toISOString(),
            correctDue: correctDue.toISOString(),
            expiredAt: formData.canceledExpiredAt || formData.expiredAt || app.updatedAt?.toISOString?.() || null,
            paidAgain: false,
            newApplications: [],
        };

        // Paid-twice sub-cohort: same applicant token, application created
        // AFTER this one expired, with at least one PAID/RECEIPT_ISSUED invoice.
        if (app.healthId) {
            const laterApps = await withoutTenantScope(() => prisma.application.findMany({
                where: {
                    isDeleted: false,
                    healthId: app.healthId,
                    id: { not: app.id },
                    createdAt: { gt: new Date(entry.expiredAt || app.updatedAt) },
                },
                select: { id: true, applicationNumber: true, status: true },
            }));
            for (const later of laterApps) {
                const paid = await withoutTenantScope(() => prisma.invoice.count({
                    where: {
                        applicationId: later.id,
                        isDeleted: false,
                        status: { in: ['PAID', 'RECEIPT_ISSUED'] },
                    },
                }));
                entry.newApplications.push({
                    applicationNumber: later.applicationNumber,
                    status: later.status,
                    paidInvoices: paid,
                });
                if (paid > 0) { entry.paidAgain = true; }
            }
        }

        report.wrongful.push(entry);
    }

    report.wrongfulCount = report.wrongful.length;
    report.paidAgainCount = report.wrongful.filter((w) => w.paidAgain).length;
    console.log(JSON.stringify(report, null, 2));
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error('[cohort] FAILED:', e); process.exit(1); });
