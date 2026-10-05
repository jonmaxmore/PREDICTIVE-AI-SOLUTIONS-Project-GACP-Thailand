'use strict';

/**
 * Checkout-order lifecycle SSOT — Wave 1 of the single lump-sum checkout
 * engine (docs/payment-refactor/step2-data-model-design.md v2, approved).
 *
 * The canonical 7-step workflow has exactly two payment gates (Milestone 1 at
 * submission, Milestone 2 after document approval). Each gate is a
 * CheckoutOrder whose ONLY path to SETTLED is the cryptographically verified
 * Stripe `payment_intent.succeeded` webhook — no human role holds that
 * transition. This module is the vocabulary those rules are written against;
 * the matching Postgres CHECK constraints (migration 20260802150000) make the
 * database refuse anything this module refuses.
 *
 * Same discipline as workflow-transition-service: frozen String vocabulary,
 * total transition table, boot-time assertion. Executive decision R1 chose
 * String + CHECK over a Prisma enum so the state-machine enforcement
 * machinery (boot assertions, AST ratchet) keeps one pattern.
 */

const CHECKOUT_STATUSES = Object.freeze([
    'PENDING_PAYMENT',
    'SETTLED',
    'EXPIRED',
    'CANCELLED',
]);

/** The two payment gates of the canonical 7-step workflow. */
const MILESTONES = Object.freeze(['M1', 'M2']);

/**
 * from → allowed targets.
 *
 *   PENDING_PAYMENT → SETTLED    the verified webhook, and nothing else
 *   PENDING_PAYMENT → EXPIRED    the Payment Intent expired unpaid
 *   PENDING_PAYMENT → CANCELLED  applicant/system abandoned the checkout
 *   EXPIRED → PENDING_PAYMENT    re-entry mints a fresh intent on the order
 *   SETTLED → (nothing)          money moved; terminal
 *   CANCELLED → (nothing)        a new attempt is a NEW order
 */
const ALLOWED_CHECKOUT_TRANSITIONS = Object.freeze({
    PENDING_PAYMENT: Object.freeze(['SETTLED', 'EXPIRED', 'CANCELLED']),
    EXPIRED: Object.freeze(['PENDING_PAYMENT']),
    SETTLED: Object.freeze([]),
    CANCELLED: Object.freeze([]),
});

function canTransitionCheckout(from, to) {
    const targets = ALLOWED_CHECKOUT_TRANSITIONS[from];
    return Array.isArray(targets) && targets.includes(to);
}

/**
 * Boot-time totality: every status has a transition row, every row's targets
 * are statuses. Runs at require() so a vocabulary edit that forgets a row is
 * a boot failure, not a silent dead state.
 */
function assertCheckoutVocabularyIsTotal() {
    const missing = CHECKOUT_STATUSES.filter(
        (s) => !Object.prototype.hasOwnProperty.call(ALLOWED_CHECKOUT_TRANSITIONS, s),
    );
    const unknownRows = Object.keys(ALLOWED_CHECKOUT_TRANSITIONS)
        .filter((s) => !CHECKOUT_STATUSES.includes(s));
    const unknownTargets = Object.entries(ALLOWED_CHECKOUT_TRANSITIONS)
        .flatMap(([from, targets]) => targets
            .filter((t) => !CHECKOUT_STATUSES.includes(t))
            .map((t) => `${from} -> ${t}`));

    const problems = [
        ...missing.map((s) => `status ${s} has no transition row`),
        ...unknownRows.map((s) => `transition row ${s} is not a checkout status`),
        ...unknownTargets.map((e) => `transition target ${e} is not a checkout status`),
    ];
    if (problems.length > 0) {
        throw new Error(`[checkout-status] vocabulary is not total:\n  - ${problems.join('\n  - ')}`);
    }
}

assertCheckoutVocabularyIsTotal();

module.exports = {
    CHECKOUT_STATUSES,
    MILESTONES,
    ALLOWED_CHECKOUT_TRANSITIONS,
    canTransitionCheckout,
    assertCheckoutVocabularyIsTotal,
};
