/**
 * กทล.๑ ส่วนที่ ๔ — the คำรับรอง, and who is allowed to say when they were given.
 *
 * ── WHY A GATE AND NOT A FORM FIELD ───────────────────────────────────────────
 * ส่วนที่ ๔ is where the applicant certifies that the filing is true, consents to
 * an inspector entering their land, and accepts that a false statement revokes
 * the certificate. Everything downstream leans on it: the officer who schedules
 * the visit, the auditor who walks the farm, and the revocation door. A filing
 * that reached the department without it is a filing nobody certified, and the
 * platform would have no answer to "who agreed to this?".
 *
 * ── WHY THE SERVER OWNS THE TIMESTAMP ─────────────────────────────────────────
 * `declarationsAcceptedAt` is evidence of WHEN a person accepted. `formData` is
 * applicant-writable through /prepare (stripServerOwnedKeys removes TOP-LEVEL
 * keys only), so a stamp already sitting in a draft proves nothing about a
 * person unless this server wrote it. The client is therefore allowed to say
 * exactly one thing — "accepted" — and the server says when.
 *
 * This is the same rule the platform applies to a bank transfer it cannot
 * witness and to a certificate without onsite evidence: record only what you can
 * point at.
 *
 * ── AND WHY A RESUBMIT IS NOT ASKED AGAIN ─────────────────────────────────────
 * A correction resubmit is the SAME filing. The acceptance already recorded
 * stands, and re-asking on every round would train applicants to click past the
 * one screen that carries legal weight. Re-accepting does not move the original
 * time either: the first certification is the one with consequence.
 *
 * @module services/application-declarations-gate
 */

'use strict';

const DECLARATIONS_REQUIRED = 'DECLARATIONS_REQUIRED';

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** A stamp the SERVER wrote, or nothing. Blank strings and junk are nothing. */
function serverStampOf(formData) {
    const raw = isPlainObject(formData) ? formData.declarationsAcceptedAt : null;
    if (typeof raw !== 'string' || !raw.trim()) { return null; }
    return Number.isNaN(new Date(raw).getTime()) ? null : raw;
}

function refuse() {
    return Object.assign(
        new Error('The ส่วนที่ ๔ declarations must be accepted before this application can be submitted'),
        {
            code: DECLARATIONS_REQUIRED,
            httpStatus: 422,
            messageTh: 'กรุณายืนยันคำรับรองทั้ง 5 ข้อและการยินยอมเปิดเผยข้อมูลก่อนยื่นคำขอ',
        },
    );
}

/**
 * @param {object}  args
 * @param {object}  args.formData        the draft's stored formData
 * @param {object}  args.payload         this request's body
 * @param {boolean} [args.isFirstSubmit] true for DRAFT, false for a correction resubmit
 * @param {Date}    [args.now]           injected for tests; the server's clock otherwise
 * @returns {{acceptedAt: string, alreadyAccepted: boolean}}
 * @throws  DECLARATIONS_REQUIRED (422) when no acceptance exists to stand on
 */
function resolveDeclarationsAcceptance({ formData, payload, isFirstSubmit = true, now } = {}) {
    // A resubmit stands on what the server recorded the first time.
    if (!isFirstSubmit) {
        const existing = serverStampOf(formData);
        if (existing) {
            return { acceptedAt: existing, alreadyAccepted: true };
        }
    }

    // Strict boolean. 'true', 1 and truthy objects are all things a client sends
    // by accident; none of them is a person having read five paragraphs.
    const accepted = isPlainObject(payload) && payload.declarationsAccepted === true;
    if (!accepted) {
        throw refuse();
    }

    // The client's own `declarationsAcceptedAt`, if it sent one, is ignored here
    // on purpose — see the header.
    const at = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    return { acceptedAt: at.toISOString(), alreadyAccepted: false };
}

module.exports = {
    resolveDeclarationsAcceptance,
    DECLARATIONS_REQUIRED,
};
