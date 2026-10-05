'use strict';
/**
 * Issue an application's quotation at submit — awaited, audited, and reported
 * to the caller (F-G4-64 R3, spec 3.4).
 *
 * ONE helper for the TWO submit doors (routes/api/applications/applications.js
 * and services/application-service/application-review-revision-methods.js),
 * which until now each carried their own fire-and-forget `.catch` that wrote a
 * logger.warn and told nobody. Debt already recorded at the backlog.
 *
 * What it does NOT do: roll the application back. The status is already
 * committed by application-status-writer, which is on the no-touch list, and an
 * applicant who filed successfully has filed successfully. What changes is that
 * the failure is now visible in three places at once — the response, the audit
 * trail, and the admin queue.
 */
const { createLogger } = require('../shared/logger');
const {
    auditLogger, AuditCategory, AuditSeverity, ResourceType,
} = require('../middleware/audit-logger');
const { normalizeRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');
const { PAYABLE_STATES } = require('./checkout/stripe-checkout-service');
// The phase name the M2 milestone bills, read from the gate that owns that
// mapping rather than retyped as a literal here.
const { MILESTONE_TO_PHASE } = require('./billing/quotation-gate');

const logger = createLogger('quotation-issuance');

/**
 * AuditLog.actorRole is NOT NULL (prisma/schema/audit.prisma:25) and
 * audit-logger persists the caller's value verbatim (`actorRole ?? null`,
 * middleware/audit-logger.js:388), so an omitted role does not write a row with
 * a blank role — it writes NO ROW, and the best-effort catch below swallows the
 * rejection. renewal-service.js:478-484 records that same failure, found by a
 * real press against the live database. This is the spelling audit-logger
 * itself falls back to (middleware/audit-logger.js:662, :840) rather than a new
 * vocabulary, and it is only reached when a caller does not know the role.
 */
const UNKNOWN_ACTOR_ROLE = 'UNKNOWN';

/**
 * @param {{application: {id: string, applicationNumber?: string, organizationId?: string},
 *          actorId: string|null, actorRole?: string|null, tx?: object|null,
 *          holderScope?: object|null}} args
 *   `holderScope` — the health caller's holder scope (holder-access); the
 *   issuance reads then carry its fragment. Omitted by staff/system callers.
 *   `tx` — the Prisma client or transaction handle to issue ON. The renewal
 *   door needs it: createRenewalApplication resolves its own client and the
 *   application row it just created is not visible on any other connection, so
 *   issuing on the module global would fail APPLICATION_NOT_FOUND and the log
 *   would blame issuance instead of the client. Omitted by the two submit
 *   doors, which issue after their transaction has committed.
 * @returns {Promise<{issued: true} | {issued: false, error: 'QUOTATION_ISSUE_FAILED'}>}
 *          never rejects
 */
async function issueQuotationOnSubmit({
    application, actorId = null, actorRole = null, tx = null, holderScope = null,
} = {}) {
    try {
        // Lazy require — quotation-service drags document-numbering in at load,
        // and requiring it at module top would pull that chain into every
        // caller of this helper (both submit doors and the GET route).
        const quotationService = require('./quotation-service');
        await quotationService.issueQuotationsForApplication(application.id, {
            actorId,
            ...(tx ? { tx } : {}),
            // A health submit reads within the caller's holder scope (spec
            // 2026-09-30 §3.1); the renewal door and system callers pass none.
            ...(holderScope ? { holderScope } : {}),
        });
        return { issued: true };
    } catch (err) {
        logger.error('[quotation-issuance] issue failed at submit', {
            applicationId: application?.id,
            applicationNumber: application?.applicationNumber || null,
            errCode: err?.code || null,
            errMessage: err?.message || String(err),
        });
        // Both sinks are best-effort and independently guarded: a down audit
        // table must not turn a successful submission into a 500.
        try {
            await auditLogger.log({
                category: AuditCategory.APPLICATION,
                action: 'QUOTATION_ISSUE_FAILED',
                severity: AuditSeverity.ERROR,
                actorId,
                actorRole: actorRole || UNKNOWN_ACTOR_ROLE,
                resourceType: ResourceType.APPLICATION,
                resourceId: application?.id,
                organizationId: application?.organizationId || null,
                metadata: {
                    applicationNumber: application?.applicationNumber || null,
                    errCode: err?.code || null,
                },
            });
        } catch (auditErr) {
            logger.error('[quotation-issuance] could not record QUOTATION_ISSUE_FAILED', {
                applicationId: application?.id, errMessage: auditErr?.message || String(auditErr),
            });
        }
        try {
            const { notifyAdminQuotationIssueFailed } = require('./notification/domain-helpers');
            await notifyAdminQuotationIssueFailed({
                applicationId: application?.id,
                applicationNumber: application?.applicationNumber || null,
                reason: err?.code || err?.message || 'unknown',
            });
        } catch (notifyErr) {
            logger.error('[quotation-issuance] could not notify the admin queue', {
                applicationId: application?.id, errMessage: notifyErr?.message || String(notifyErr),
            });
        }
        return { issued: false, error: 'QUOTATION_ISSUE_FAILED' };
    }
}

/**
 * The window in which a read may mint a missing quotation.
 *
 * DERIVED from the card rail's own PAYABLE_STATES rather than retyped, so the
 * self-heal cannot drift away from the states in which money is actually
 * taken (services/checkout/stripe-checkout-service.js). DRAFT is subtracted:
 * an application still being written has no price of record by design, and
 * quoting one would put a number on a document the applicant has not filed.
 *
 * Fix round 1 (reviewer MAJOR M2). The previous ceiling was "not DRAFT", which
 * is not a ceiling at all: REJECTED, EXPIRED, CANCEL_EXPIRED, CERTIFIED and
 * every settled application sit past DRAFT, and the population of unquoted
 * applications is real (pre-Tier-18 filings, and revision-door filings from
 * before the 2026-08-18 fix). Reading the billing screen of a rejected 2026-06
 * application would have minted it a PENDING quotation at today's rates with a
 * fresh QT-PRD number off the legal sequence, which nothing can withdraw —
 * quotations are soft-deleted only.
 *
 * Final round (R3): M2 is subtracted as well, so the window is M1 minus DRAFT.
 * DOC_APPROVED and PENDING_AUDIT_FEE are M2-payable, and both mean งวดที่ 1 HAS
 * ALREADY BEEN COLLECTED. issueQuotationsForApplication knows nothing about what
 * is already paid: for a non-renewal it always emits [PHASE_1, PHASE_2] at the
 * full amount, so an unquoted application in those states was handed a fresh,
 * numbered document billing money the applicant had already transferred. Late
 * issuance is now only for the window in which nothing has been paid yet; an
 * M2-payable application with no quotation meets the gate's QUOTATION_NOT_ISSUED
 * and the admin alert instead, and the missing staff re-issue door is ledger
 * F-G4-71.
 */
const SELF_HEAL_STATUSES = Object.freeze(new Set(
    [...PAYABLE_STATES.M1].filter((s) => s !== 'DRAFT'),
));

/**
 * The statuses in which a quotation is still an OFFER — the only ones a
 * validity window can close. ACCEPTED and INVOICED are agreements and do not
 * lapse; REJECTED and EXPIRED are already over.
 */
const UNACCEPTED_OFFER_STATUSES = Object.freeze(new Set(['DRAFT', 'PENDING', 'SENT']));

/**
 * The one live row a lapsed-offer replacement may touch, or null.
 *
 * Deliberately narrow. A pre-W14 application legitimately holds a PAIR (DTAM +
 * PLATFORM) which between them price the whole bill; replacing them produces
 * ONE W14 document carrying the whole price, and that is a repricing decision,
 * not a repair. So a pair is left exactly as it is, and only the single
 * post-W14 company row is replaceable.
 *
 * @param {{dtam: object|null, platform: object|null}} found
 * @param {Date} [now]
 * @returns {object|null}
 * @private
 */
function _lapsedOfferToReplace(found, now = new Date()) {
    // BOTH slots are counted, still. `dtam` is not a live issuer any more, but
    // a pre-W14 application physically holds two rows that priced the bill
    // between them, and the paragraph above is the rule: replacing a PAIR with
    // one post-W14 document is a REPRICING, not a repair, so the heal must see
    // two and decline. Narrowing this to `[found?.platform]` makes a pair read
    // as one replaceable offer and reprices it silently — which is the exact
    // outcome this function exists to prevent.
    const live = [found?.dtam, found?.platform].filter(Boolean);
    if (live.length !== 1) { return null; }
    const row = live[0];
    if (!UNACCEPTED_OFFER_STATUSES.has(String(row.status || '').toUpperCase())) { return null; }
    if (!row.validUntil) { return null; }
    if (new Date(row.validUntil).getTime() >= now.getTime()) { return null; }
    return row;
}

/**
 * MAY this application's lapsed offer be replaced? (Fix round 1 of the final
 * round, reviewer BLOCKER.)
 *
 * The replacement has its OWN window, wider than the late MINT's, because the
 * two do different things to the bill.
 *
 * MINTING in an M2-payable state is what R3 forbids: issueQuotationsForApplication
 * knows nothing about what is already paid and, for a non-renewal, always emits
 * [PHASE_1, PHASE_2] at the full amount — a numbered document billing money the
 * applicant has already transferred.
 *
 * REPLACING is not that. A renewal lives in exactly one of those states
 * (services/renewal-service creates it at PENDING_AUDIT_FEE) and holds ONE
 * quotation that prices งวดที่ 2 only, valid 7 working days. Left out of this
 * branch it could never be replaced: past that window the acceptance door and
 * the payment gate both refuse it (QUOTATION_EXPIRED), and there is no staff issuance door
 * (ledger F-G4-71), so the renewal was unacceptable and unpayable for ever —
 * and QUOTATION_EXPIRED's copy named a replacement that never happened.
 *
 * So an M2-payable application is admitted only when replacing bills exactly
 * what the retired row billed and none of it has been invoiced yet: the row
 * prices งวดที่ 2 and nothing else, and its phase-2 stamp is empty. A row that
 * prices both instalments is still refused there — its replacement WOULD
 * re-bill งวดที่ 1. A row that records no instalments (legacy) proves nothing
 * about what its replacement would bill, so it is refused too.
 *
 * @param {string} status  the application's status, upper-cased
 * @param {object} lapsed  the live row _lapsedOfferToReplace returned
 * @returns {boolean}
 */
function mayReplaceLapsedQuotation(status, lapsed) {
    if (SELF_HEAL_STATUSES.has(status)) { return true; }
    if (!PAYABLE_STATES.M2.includes(status)) { return false; }
    const priced = Array.isArray(lapsed?.installments)
        ? [...new Set(lapsed.installments.map((i) => String(i?.phase || '').toUpperCase()))]
        : [];
    if (priced.length !== 1 || priced[0] !== MILESTONE_TO_PHASE.M2) { return false; }
    return !lapsed.phase2InvoicedAt;
}

/**
 * Retire the lapsed row, issue its replacement, record both in the trail, and
 * never fail the read that asked (R1).
 * @private
 */
async function _replaceLapsedQuotation({
    quotationService, application, lapsed, actorId, actorRole, found, holderScope = null,
}) {
    try {
        const reissued = await quotationService.reissueLapsedQuotation(application.id, {
            lapsed,
            actorId,
            // Spec 2026-09-30 §3.1: the replacement's reads stay in the caller's holder scope.
            ...(holderScope ? { holderScope } : {}),
        });
        try {
            await auditLogger.log({
                category: AuditCategory.APPLICATION,
                action: 'QUOTATION_REISSUED_AFTER_EXPIRY',
                severity: AuditSeverity.WARNING,
                actorId,
                // NOT NULL, and known: the role gate above admitted only the
                // applicant-owner, so there is nothing to fall back to.
                actorRole,
                resourceType: ResourceType.APPLICATION,
                resourceId: application.id,
                organizationId: application.organizationId || null,
                metadata: {
                    applicationNumber: application.applicationNumber || null,
                    applicationStatus: application.status,
                    replacedQuotationId: lapsed.id,
                    replacedQuotationNumber: lapsed.quotationNumber || null,
                    replacedValidUntil: lapsed.validUntil
                        ? new Date(lapsed.validUntil).toISOString() : null,
                    // The same limitation the late issue carries: there is no
                    // effective-dated rate table, so the replacement is priced
                    // at today's rates (F-G4-69).
                    limitation: 'priced at the current rate table (F-G4-69: no effective date)',
                },
            });
        } catch (auditErr) {
            logger.error('[quotation-issuance] could not record QUOTATION_REISSUED_AFTER_EXPIRY', {
                applicationId: application.id, errMessage: auditErr?.message || String(auditErr),
            });
        }
        return { dtam: reissued.dtam || null, platform: reissued.platform || null };
    } catch (err) {
        // The applicant keeps the lapsed row on screen (where the accept button
        // is not drawn) rather than an error page: a read may not fail because
        // a repair did.
        logger.error('[quotation-issuance] replacing a lapsed quotation failed', {
            applicationId: application.id,
            quotationId: lapsed.id,
            errCode: err?.code || null,
            errMessage: err?.message || String(err),
        });
        return found;
    }
}

/**
 * Read this application's quotations, and issue one if the APPLICANT-OWNER is
 * asking and the application is inside the payable window (spec 3.4, the
 * controlled self-heal).
 *
 * ACCEPTED LIMITATION: the late issue prices at the rate table as it stands
 * NOW. The table has no effective date (config/business-rules.js:112-154), so
 * an application quoted late is not priced as of its submission date. v1.1
 * promised that price; docs/legal/payment-terms-th-v1.2.md §3.1 says the
 * quotation is issued at submission, so a late issue still differs from the
 * terms in force. That is ledger F-G4-69 and
 * is deliberately not fixed here; `notes` records it on the row so the
 * difference is visible rather than assumed away.
 *
 * @param {{application: {id: string, status: string, applicationNumber?: string,
 *          organizationId?: string}, actorId?: string|null,
 *          actorRole?: string|null, reason?: string, holderScope?: object|null}} args
 * @returns {Promise<{dtam: object|null, platform: object|null}>} never rejects
 */
async function ensureQuotationForIssuedApplication({
    application, actorId = null, actorRole = null, reason = 'MISSING_AT_READ', holderScope = null,
} = {}) {
    const quotationService = require('./quotation-service');
    // The health caller's holder scope (spec 2026-09-30 §3.1) rides on every read
    // below; finance/admin readers of the same door pass none.
    const scoped = holderScope ? { holderScope } : {};
    const readArgs = holderScope ? [application.id, scoped] : [application.id];
    const found = await quotationService.findQuotationsByApplicationId(...readArgs);
    const lapsed = _lapsedOfferToReplace(found);
    if ((found.dtam || found.platform) && !lapsed) { return found; }

    // Half 1 — WHO is asking. Only the applicant-owner's own read may mint.
    // The GET handler admits every provider role with no ownership check, and
    // it is a state-changing GET behind sameSite:'lax' cookie auth, so a link
    // in an email fires it. An accountant must be able to SEE that an
    // application has no price of record without creating one by looking.
    // (The ownership half is the route's: it 404s a HEALTH caller who does not
    // own the application before this function is reached.)
    if (normalizeRole(actorRole) !== CANONICAL_ROLES.HEALTH) { return found; }

    // WHICH application. A status this function cannot read is outside every
    // window below: the GET door composes `{ id, ...(app || {}) }`, so a
    // non-existent or unreadable application arrives with no status at all,
    // quotation-service would refuse it anyway (APPLICATION_NOT_FOUND /
    // APPLICATION_DELETED), and logging that refusal as a late-issue failure on
    // every such read would drain that log line of meaning.
    const status = String(application.status || '').toUpperCase();

    // Half 2 — a lapsed OFFER is REPLACED rather than minted alongside (R1),
    // and this branch is asked FIRST, with its own window
    // (mayReplaceLapsedQuotation), because replacing a document is not the same
    // act as minting one and cannot inherit the mint's ceiling. Under the mint
    // ceiling a renewal — created at PENDING_AUDIT_FEE, one row pricing งวดที่ 2
    // only — could never be replaced, so past day 30 it was unacceptable and
    // unpayable for ever (fix round 1, reviewer BLOCKER). The acceptance door
    // refuses a quotation past validUntil and no staff surface can issue one
    // (ledger F-G4-71), so this read is where the applicant's next step comes
    // from. It is also the sentence QUOTATION_EXPIRED's copy promises.
    if (lapsed) {
        if (!mayReplaceLapsedQuotation(status, lapsed)) { return found; }
        return _replaceLapsedQuotation({
            quotationService, application, lapsed, actorId, actorRole, found, holderScope,
        });
    }

    // Half 3 — the MINT window, which stays R3's: only where nothing has been
    // paid yet, because issueQuotationsForApplication always prices the whole
    // bill and an M2-payable application has already transferred งวดที่ 1.
    if (!SELF_HEAL_STATUSES.has(status)) { return found; }

    try {
        await quotationService.issueQuotationsForApplication(application.id, {
            actorId,
            notes: `ISSUED_LATE: ${reason}`,
            ...scoped,
        });
        try {
            await auditLogger.log({
                category: AuditCategory.APPLICATION,
                action: 'QUOTATION_ISSUED_LATE',
                severity: AuditSeverity.WARNING,
                actorId,
                // NOT NULL, and known: the role gate above already refused
                // everybody whose role does not normalise to HEALTH, so there
                // is nothing to fall back to here — the caller IS the
                // applicant-owner, and the trail says which one.
                actorRole,
                resourceType: ResourceType.APPLICATION,
                resourceId: application.id,
                organizationId: application.organizationId || null,
                metadata: {
                    applicationNumber: application.applicationNumber || null,
                    applicationStatus: application.status,
                    reason,
                    // Named so a reader of the trail knows what this row cost.
                    limitation: 'priced at the current rate table (F-G4-69: no effective date)',
                },
            });
        } catch (auditErr) {
            logger.error('[quotation-issuance] could not record QUOTATION_ISSUED_LATE', {
                applicationId: application.id, errMessage: auditErr?.message || String(auditErr),
            });
        }
        // `return await`, not `return`. Without the await the re-read's
        // rejection escapes this try and breaks the "never rejects" contract
        // above — and it breaks it AFTER the row has been minted, so the
        // applicant gets a 500 out of a read that has just succeeded in
        // writing, and retries it. (Fix round 1, reviewer m1.)
        return await quotationService.findQuotationsByApplicationId(...readArgs);
    } catch (err) {
        logger.error('[quotation-issuance] late issue failed', {
            applicationId: application.id,
            errCode: err?.code || null,
            errMessage: err?.message || String(err),
        });
        return found;
    }
}

module.exports = {
    issueQuotationOnSubmit,
    ensureQuotationForIssuedApplication,
    // Exported so a test can prove the window IS the card rail's PAYABLE_STATES
    // and not a second list that drifts.
    SELF_HEAL_STATUSES,
    // Exported so the replacement window can be read directly: it is wider than
    // the mint's on purpose, and the difference is what keeps a renewal payable.
    mayReplaceLapsedQuotation,
};
