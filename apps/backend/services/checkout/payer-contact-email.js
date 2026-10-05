'use strict';

/**
 * The email Stripe is given when the applicant confirms a PromptPay payment.
 *
 * Stripe refuses to confirm a PromptPay intent without billing_details.email
 * (the live test-mode API answered `parameter_missing billing_details[email]`,
 * evidence/promptpay-qr-2026-09-27/email-required-probe.txt), and it is the
 * address Stripe contacts about a refund (docs.stripe.com/payments/promptpay).
 * Email as contact data is allowed (operator 2026-09-26: email is retired only
 * as a second factor and for password reset).
 *
 * Source order:
 *   1. the paying entity's contact email: the certificate holder is the payer
 *      (Entity.payload.contact.email, written by entity-service
 *      buildJuristicPayload / buildCommunityPayload);
 *   2. the signed-in user's own email (User.email);
 *   3. null: the checkout screen then asks for one. Never a placeholder.
 *
 * Read-only, and it never fails a checkout: this runs after the order and the
 * intent exist, and a lookup failure only means the screen asks for the email
 * instead of pre-filling it.
 */

const { prisma } = require('../prisma-database');
const logger = require('../../shared/logger');

/** Shape check only, so a malformed stored value is never sent to Stripe. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function usableEmail(value) {
    if (typeof value !== 'string') { return null; }
    const trimmed = value.trim();
    return EMAIL_SHAPE.test(trimmed) ? trimmed : null;
}

async function entityContactEmail(entityId) {
    if (!entityId) { return null; }
    const entity = await prisma.entity.findUnique({
        where: { id: entityId },
        select: { payload: true },
    });
    return usableEmail(entity?.payload?.contact?.email);
}

async function userEmail(userId) {
    if (!userId) { return null; }
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
    });
    return usableEmail(user?.email);
}

async function lookup(label, fn) {
    try {
        return await fn();
    } catch (err) {
        logger.warn('[checkout] payer email lookup failed; the screen will ask', {
            source: label,
            error: err?.message,
        });
        return null;
    }
}

async function resolvePayerContactEmail({ application, userId }) {
    return (await lookup('entity', () => entityContactEmail(application?.entityId)))
        || (await lookup('user', () => userEmail(userId)));
}

module.exports = { resolvePayerContactEmail };
