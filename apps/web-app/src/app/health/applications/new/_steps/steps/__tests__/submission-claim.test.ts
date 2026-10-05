/**
 * What the last screen of the wizard is allowed to say.
 *
 * Step 10 offered a button labelled "ส่งคำขอโดยยังไม่ชำระ" whose entire
 * implementation was `router.push('/health/applications/new/step/12')`. No
 * request was made. Step 12 is the success screen: a green panel reading
 * "ยินดีด้วย! ส่งคำขอสำเร็จ" and "คำขอรับรองมาตรฐาน GACP ของท่านได้รับการ
 * บันทึกเรียบร้อยแล้ว".
 *
 * So a farmer who pressed it was congratulated on filing an application that
 * did not exist, given an application number that came from the browser's own
 * draft state, and sent away. They would find out weeks later, if at all.
 *
 * The button is gone. This is the guard that makes sure it cannot come back by
 * another route — a bookmark, a stale deep link, a back button: the screen
 * claims a submission only when the server says there is one, and says what
 * actually happened otherwise.
 */

import { submissionClaim, LOOKUP_FAILED } from '../submission-claim';

describe('submissionClaim', () => {
    describe('a real submission', () => {
        it('is claimed once the fee has been paid and accepted', () => {
            expect(submissionClaim({ applicationId: 'A-1', status: 'DOC_FEE_PAID' }))
                .toEqual({ kind: 'submitted', applicationNumber: 'A-1' });
        });

        it('is claimed for every state that only happens after a real submission', () => {
            for (const status of [
                'ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED', 'DOC_APPROVED',
                'PENDING_AUDIT_FEE', 'AUDIT_FEE_PAID',
                'AUDIT_CONFIRMED', 'CAR_PENDING', 'CAR_REVIEWING', 'AUDIT_PASSED',
                'APPROVED', 'CERTIFIED',
            ]) {
                expect(submissionClaim({ applicationId: 'A-1', status }).kind).toBe('submitted');
            }
        });
    });

    describe('submitted, but the money has not arrived', () => {
        it('says payment is still owed when it is', () => {
            expect(submissionClaim({ applicationId: 'A-1', status: 'PENDING_DOC_FEE' }))
                .toEqual({ kind: 'awaiting-payment', applicationNumber: 'A-1' });
            expect(submissionClaim({ applicationId: 'A-1', status: 'SUBMITTED' }))
                .toEqual({ kind: 'awaiting-payment', applicationNumber: 'A-1' });
        });
    });

    describe('nothing was submitted', () => {
        it('refuses to claim anything for a draft', () => {
            // This is exactly what the removed button produced.
            expect(submissionClaim({ applicationId: 'A-1', status: 'DRAFT' }))
                .toEqual({ kind: 'not-submitted' });
        });

        it('refuses when there is no application at all', () => {
            expect(submissionClaim({ applicationId: null, status: 'DOC_FEE_PAID' }))
                .toEqual({ kind: 'not-submitted' });
            expect(submissionClaim({ applicationId: '', status: 'DOC_FEE_PAID' }))
                .toEqual({ kind: 'not-submitted' });
            expect(submissionClaim(null)).toEqual({ kind: 'not-submitted' });
            expect(submissionClaim(undefined)).toEqual({ kind: 'not-submitted' });
        });

        it('refuses when the server has not answered yet', () => {
            // An unknown status is not a submitted one. Defaulting the other
            // way is how the original defect worked.
            expect(submissionClaim({ applicationId: 'A-1', status: null }))
                .toEqual({ kind: 'not-submitted' });
            expect(submissionClaim({ applicationId: 'A-1', status: '' }))
                .toEqual({ kind: 'not-submitted' });
        });

        it('refuses a status it does not recognise', () => {
            expect(submissionClaim({ applicationId: 'A-1', status: 'SOMETHING_NEW' }))
                .toEqual({ kind: 'not-submitted' });
        });
    });

    describe('applications that ended badly', () => {
        it('does not congratulate someone whose application was rejected', () => {
            expect(submissionClaim({ applicationId: 'A-1', status: 'REJECTED' }).kind).toBe('closed');
            expect(submissionClaim({ applicationId: 'A-1', status: 'EXPIRED' }).kind).toBe('closed');
            expect(submissionClaim({ applicationId: 'A-1', status: 'CANCEL_EXPIRED' }).kind).toBe('closed');
        });

        it('still names the application, so they can look it up', () => {
            expect(submissionClaim({ applicationId: 'A-1', status: 'REJECTED' }))
                .toEqual({ kind: 'closed', applicationNumber: 'A-1' });
        });
    });

    it('never invents an application number', () => {
        // The old screen fell back to the browser's draft id and printed it as
        // "เลขที่คำขอ", which looked exactly like a real one.
        for (const status of ['DRAFT', 'DOC_FEE_PAID', 'REJECTED', null]) {
            const claim = submissionClaim({ applicationId: null, status });
            expect('applicationNumber' in claim).toBe(false);
        }
    });
});

describe('LOOKUP_FAILED', () => {
    it('is its own answer, not a submission and not an absence', () => {
        // If the status request fails, the screen knows nothing. Rendering
        // "not submitted" would alarm someone whose application is fine;
        // rendering "submitted" is the defect this whole file exists to
        // prevent.
        expect(LOOKUP_FAILED).toEqual({ kind: 'unknown' });
    });

    it('carries no application number to print', () => {
        expect('applicationNumber' in LOOKUP_FAILED).toBe(false);
    });
});
