/**
 * A grant given under a superseded version is not an acceptance of this one.
 *
 * F-G4-64 T9, review r1 MINOR 3. The backend gate refuses when the stored
 * UserConsent version differs from ConsentVersions.PAYMENT_TERMS
 * (services/billing/payment-terms-gate.js), and publishing
 * payment-terms-th-v1.1 moves that value. Both payment rails hide the
 * acknowledgment checkbox on `isPaymentTermsGranted(...) === true`
 * (slip-upload-modal.tsx, checkout/client-view.tsx), so if this parser answers
 * true for a stale grant the applicant is shown "ท่านได้ยอมรับเงื่อนไขนี้ไว้แล้ว",
 * has no control to re-accept with, and the upload or the checkout is refused
 * by a 409 they cannot act on.
 *
 * GET /consent now reports `currentVersion` beside each grant's own `version`
 * (consent-manager getUserConsents), which is the only way the client can tell
 * the two apart — the client must never carry a version string of its own
 * (coordinator ruling 2: one consent namespace, the server's).
 */

import { describe, expect, it } from '@jest/globals';

import { isPaymentTermsGranted } from '../payment-service';

const body = (paymentTerms: Record<string, unknown>) => ({ consents: { PAYMENT_TERMS: paymentTerms } });

describe('isPaymentTermsGranted is version-aware', () => {
    it('a grant recorded under the version now in force counts', () => {
        expect(isPaymentTermsGranted(body({
            granted: true,
            version: 'payment-terms-th-v1.2',
            currentVersion: 'payment-terms-th-v1.2',
        }))).toBe(true);
    });

    it('a grant recorded under a superseded version does NOT count', () => {
        expect(isPaymentTermsGranted(body({
            granted: true,
            version: 'payment-terms-th-v1.1',
            currentVersion: 'payment-terms-th-v1.2',
        }))).toBe(false);
    });

    it('a response that reports no currentVersion is trusted as before', () => {
        // Older backend, or a category the server does not version. Refusing
        // here would hide the accepted state from applicants whose consent is
        // perfectly good.
        expect(isPaymentTermsGranted(body({ granted: true, version: '1.0.0' }))).toBe(true);
    });

    it('an ungranted row is still not a grant', () => {
        expect(isPaymentTermsGranted(body({
            granted: false,
            version: 'payment-terms-th-v1.1',
            currentVersion: 'payment-terms-th-v1.2',
        }))).toBe(false);
    });

    it('a body with no consents object is still not a grant', () => {
        expect(isPaymentTermsGranted({})).toBe(false);
        expect(isPaymentTermsGranted(null)).toBe(false);
    });
});
