'use strict';

/**
 * CAR / corrective-action deadline helper (workflow audit 2026-06-11, HIGH).
 *
 * A CAR raised by an auditor (MINOR/MAJOR → CAR_PENDING on the Job Sheet path,
 * or FAIL on the field-tool path) must start the canonical 5-working-day clock:
 *   - stamp `formData.carDueAt` so the /auto-cancel cron + the applicant-facing
 *     CAR enforcement can read the due date, and
 *   - upsert a RevisionDeadline row so the hourly revision-deadline-checker cron
 *     can EXPIRE it.
 * Previously the auditor decision handlers wrote the decision but set NEITHER,
 * so a CAR raised through the real auditor surfaces never auto-expired — the
 * applicant could sit in CAR_PENDING indefinitely (SLA unenforced). This
 * centralises the proven logic from workflow-side-effects.js so every CAR
 * writer uses the SAME, Thai-holiday-aware due-date math.
 */

const { addWorkingDays } = require('../utils/working-days');
const businessRules = require('../config/business-rules');
const adminApplicationService = require('./admin-application-service');

// Source of truth for the window length (config/business-rules.js).
// R2 M3 (Law 3.5/3.6): the former nullish-coalescing fallback literal was
// removed — the canonical constant is always defined, and a silent fallback
// would be a second source of the number (grep-pinned by
// __tests__/unit/correction-round.test.js).
const CAR_DEADLINE_BUSINESS_DAYS = businessRules.PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS;

/**
 * The canonical CAR/revision due date = `from` + N working days, computed with
 * the Asia/Bangkok + Thai-public-holiday calendar (utils/working-days, NOT the
 * holiday-blind services/working-days-service).
 * @param {Date} [from]
 * @returns {Date}
 */
function computeCarDueDate(from = new Date()) {
    return addWorkingDays(from, CAR_DEADLINE_BUSINESS_DAYS);
}

/**
 * Upsert the RevisionDeadline row that the hourly cron scans, mirroring the
 * CAR_PENDING branch of workflow-side-effects.js. Bumps revisionCount on an
 * existing row (a fresh CAR loop) or creates the first one. No-op on missing
 * args. Best-effort by contract — the caller must not block the decision write
 * on a deadline-seed failure, but it SHOULD log it (this is the SLA clock).
 * @param {{ applicationId: string, dueAt: Date, actorId?: string }} args
 */
async function seedCarRevisionDeadline({ applicationId, dueAt, actorId = null } = {}) {
    if (!applicationId || !(dueAt instanceof Date) || Number.isNaN(dueAt.getTime())) {
        return null;
    }
    const existing = await adminApplicationService.findRevisionDeadlineByApplicationId(
        applicationId,
        { select: { revisionCount: true } },
    );
    const nextRevisionCount = (existing?.revisionCount || 0) + 1;
    return adminApplicationService.upsertRevisionDeadline({
        applicationId,
        update: {
            revisionDue: dueAt,
            status: 'PENDING',
            revisionCount: nextRevisionCount,
            updatedBy: actorId,
        },
        create: {
            applicationId,
            revisionDue: dueAt,
            status: 'PENDING',
            revisionCount: 1,
            createdBy: actorId,
        },
    });
}

module.exports = {
    computeCarDueDate,
    seedCarRevisionDeadline,
    CAR_DEADLINE_BUSINESS_DAYS,
};
