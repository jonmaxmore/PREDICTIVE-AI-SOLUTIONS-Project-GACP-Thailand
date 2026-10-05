'use strict';
/**
 * The ONE payment-terms gate — services/billing/payment-terms-gate.js
 * (F-G4-64 R4, Q4 pre-payment disclosure, owner ruling 2026-07-08).
 *
 * Disclosure-before-payment is what makes the no-refund policy enforceable
 * (พ.ร.บ.ข้อสัญญาที่ไม่เป็นธรรม 2540 exposure without it). Until today it bound
 * the slip rail only, and payment_slips holds zero rows — so no applicant has
 * ever actually seen the text, while the card rail collected 176,550 THB
 * (reports/research/2026-08-28-f-g4-64/register.md G).
 *
 * Coordinator ruling 2 (2026-08-28) — ONE consent namespace:
 *   the ledger is `UserConsent` (category PAYMENT_TERMS), the version is
 *   `ConsentVersions.PAYMENT_TERMS` (env-driven, consent-manager.js), and BOTH
 *   rails ask this one function. There is no second version string and no
 *   client-supplied acknowledgment: a request body cannot be evidence that a
 *   human was shown a document.
 *
 * This module is the assertion the slip rail has been running since 2026-07-08,
 * moved to where both rails can reach it (the same move quotation-gate.js made
 * for the quotation gate). payment-slip-service delegates to it, so the policy
 * exists once; the card rail additionally records WHICH disclosure authorised
 * the charge, which is why the function returns the version and the instant
 * instead of just resolving.
 *
 * FAIL-CLOSED in every direction: no identity, no row, a stale version or a
 * lookup failure are all refusals. There is no branch that returns a "skip".
 */

const { prisma } = require('../prisma-database');
// The default logger, not createLogger(): this module is required from
// payment-slip-service, whose suites stub shared/logger as a bare
// {info,warn,error,debug} object. Every line here is prefixed by hand anyway.
const logger = require('../../shared/logger');
const { ERROR_CODES, getMessage } = require('../../shared/error-codes');
// The consent namespace is consent-manager's (coordinator ruling 2), so the
// category identifier is READ from it and never retyped here. Typing it would
// survive a rename silently: the findFirst below would match no row and BOTH
// rails would then refuse every payment with PAYMENT_TERMS_NOT_ACCEPTED, with
// no test failing, because a fixture that types the same string agrees with the
// mistake. Pinned by payment-terms-gate-reads-the-consent-category.test.js.
const { ConsentCategory, ConsentVersions } = require('../../middleware/consent-manager');

/** The one refusal this gate can raise; its row lives in shared/error-codes.js. */
const PAYMENT_TERMS_CODE = 'PAYMENT_TERMS_NOT_ACCEPTED';

/** The consent category this gate reads (consent-manager ConsentCategory). */
const PAYMENT_TERMS_CATEGORY = ConsentCategory.PAYMENT_TERMS;

/**
 * Build the refusal both rails' routes already understand: `status` AND
 * `statusCode`, carrying the applicant-facing Thai copy READ FROM the
 * catalogue rather than repeated here, so the sentence the applicant sees and
 * the sentence the Thai-copy review reads are the same string.
 */
function termsError() {
    const row = ERROR_CODES[PAYMENT_TERMS_CODE];
    if (!row) {
        logger.error('[payment-terms-gate] refusal code is not in the catalogue, refusing as 503');
        return Object.assign(new Error(getMessage('INTERNAL_SERVER_ERROR', 'th')), {
            code: PAYMENT_TERMS_CODE, status: 503, statusCode: 503,
        });
    }
    return Object.assign(new Error(row.messageTh), {
        code: PAYMENT_TERMS_CODE, status: row.httpStatus, statusCode: row.httpStatus,
    });
}

/**
 * Refuse to create a payment unless this actor has a granted, current
 * PAYMENT_TERMS consent.
 *
 * @param {object} args
 * @param {string} args.actorUserId — User.id (UserConsent.userId is that FK)
 * @returns {Promise<{version: string, acceptedAt: Date|null}>} the disclosure
 *   that authorises this charge: the version the grant was recorded under and
 *   the instant it was granted. `acceptedAt` is null only for a legacy row that
 *   carries no timestamp at all; the caller stores what it is given rather than
 *   inventing an instant.
 * @throws {Error & {code:'PAYMENT_TERMS_NOT_ACCEPTED', status, statusCode}}
 */
async function assertPaymentTermsAccepted({ actorUserId } = {}) {
    if (!actorUserId) { throw termsError(); }

    let consent = null;
    // consent-manager resolves ConsentVersions once, at ITS require time, from
    // CONSENT_VERSION_PAYMENT_TERMS. Reading the frozen value here and reading
    // it inside the try are the same read; it lives beside the category so both
    // halves of the namespace come from one place.
    const currentVersion = ConsentVersions.PAYMENT_TERMS;
    try {
        consent = await prisma.userConsent.findFirst({
            where: { userId: actorUserId, category: PAYMENT_TERMS_CATEGORY, granted: true },
            select: { id: true, version: true, grantedAt: true, updatedAt: true },
        });
    } catch (err) {
        // A lookup failure must not silently open the gate — surface as the gate
        // error so the applicant retries (mirror of the quotation gate).
        logger.error('[payment-terms-gate] lookup failed, refusing rather than opening', {
            errMessage: err?.message || String(err),
        });
        throw Object.assign(termsError(), { cause: err });
    }

    if (!consent) { throw termsError(); }
    // S5: disclosure is version-bound (PDPA ม.19 pattern) — a grant recorded
    // under an older CONSENT_VERSION_PAYMENT_TERMS forces re-acceptance, so
    // bumping the env after a terms change actually re-discloses to everyone.
    if (currentVersion && consent.version !== currentVersion) { throw termsError(); }

    return {
        version: consent.version,
        // grantedAt is stamped by recordConsent on every grant; updatedAt is the
        // fallback for a row written before that was true. Never `new Date()`:
        // "when the applicant accepted" is a recorded fact, not the instant this
        // gate happened to run.
        acceptedAt: consent.grantedAt || consent.updatedAt || null,
    };
}

module.exports = {
    assertPaymentTermsAccepted,
    PAYMENT_TERMS_CODE,
    PAYMENT_TERMS_CATEGORY,
};
