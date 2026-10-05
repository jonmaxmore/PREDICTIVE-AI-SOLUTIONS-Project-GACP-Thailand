/**
 * What the last screen of the wizard is allowed to say.
 *
 * Step 10 carried a button labelled "ส่งคำขอโดยยังไม่ชำระ" whose whole
 * implementation was `router.push('/health/applications/new/step/12')`. No
 * request was made to anything. Step 12 is the success screen — "ยินดีด้วย!
 * ส่งคำขอสำเร็จ", with an application number taken from the browser's own draft
 * state. A farmer who pressed it was congratulated on filing an application
 * that did not exist, and would find out weeks later, if at all.
 *
 * The button is gone. This decides what the screen may claim when it is reached
 * some other way — a bookmark, a stale deep link, the back button — and the
 * rule is that the server decides. An unrecognised or missing status is not a
 * submission; defaulting the other way is how the original defect worked.
 */

export type SubmissionClaim =
    /** The application is filed and the fee has been accepted. */
    | { kind: 'submitted'; applicationNumber: string }
    /** Filed, but the fee has not been paid yet. */
    | { kind: 'awaiting-payment'; applicationNumber: string }
    /** Filed and since rejected, expired or cancelled. */
    | { kind: 'closed'; applicationNumber: string }
    /** Nothing was submitted. Say so, and do not print a number. */
    | { kind: 'not-submitted' }
    /**
     * The status lookup failed. The screen knows nothing — which is not the
     * same as knowing there is nothing. Saying "not submitted" would alarm
     * someone whose application is fine; saying "submitted" is the defect this
     * file exists to prevent.
     */
    | { kind: 'unknown' };

/** The answer when the status request itself failed. */
export const LOOKUP_FAILED: SubmissionClaim = { kind: 'unknown' };

interface ApplicationLike {
    applicationId?: string | null;
    status?: string | null;
}

/**
 * States that only exist after a submission the platform has accepted and been
 * paid for. Anything not listed here is not one of them — including states
 * added later, which is deliberate: a new state should have to be classified
 * on purpose rather than inherit a congratulation.
 */
const SUBMITTED_STATES = new Set([
    'DOC_FEE_PAID',
    'ASSIGNED_FOR_REVIEW',
    'REVISION_REQUESTED',
    'DOC_APPROVED',
    'PENDING_AUDIT_FEE',
    'AUDIT_FEE_PAID',
    'AUDIT_CONFIRMED',
    'CAR_PENDING',
    'CAR_REVIEWING',
    'AUDIT_PASSED',
    'APPROVED',
    'CERTIFIED',
]);

/** Filed, nothing paid. */
const AWAITING_PAYMENT_STATES = new Set(['SUBMITTED', 'PENDING_DOC_FEE']);

/** Filed and over. */
const CLOSED_STATES = new Set(['REJECTED', 'EXPIRED', 'CANCEL_EXPIRED']);

export function submissionClaim(application: ApplicationLike | null | undefined): SubmissionClaim {
    const applicationNumber = application?.applicationId;
    const status = application?.status;

    // No id means there is nothing to point at. The old screen fell back to the
    // browser's draft id and printed it as "เลขที่คำขอ", which looked exactly
    // like the real thing.
    if (!applicationNumber || !status) return { kind: 'not-submitted' };

    if (SUBMITTED_STATES.has(status)) return { kind: 'submitted', applicationNumber };
    if (AWAITING_PAYMENT_STATES.has(status)) return { kind: 'awaiting-payment', applicationNumber };
    if (CLOSED_STATES.has(status)) return { kind: 'closed', applicationNumber };

    return { kind: 'not-submitted' };
}
