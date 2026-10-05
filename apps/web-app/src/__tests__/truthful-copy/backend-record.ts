/**
 * The backend records the truthful-copy suites compare the web's words to.
 *
 * Read as SOURCE TEXT, not required: the web jest runs in jsdom and the backend
 * modules pull in their own logger and Prisma. The backend side of the same
 * comparison, with a real require, is
 * apps/backend/__tests__/unit/frontend-service-facts-mirror.test.js.
 *
 * Every reader throws when its pattern stops matching, so a refactor of the
 * backend file turns these suites red instead of letting them compare against
 * `undefined`.
 */

import * as fs from 'fs';
import * as path from 'path';

export const REPO_ROOT = path.resolve(__dirname, '../../../../..');

export function readRepoFile(relative: string): string {
    return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

function match(relative: string, pattern: RegExp): string {
    const m = readRepoFile(relative).match(pattern);
    if (!m || m[1] === undefined) {
        throw new Error(`${pattern} no longer matches ${relative}; update this reader`);
    }
    return m[1];
}

/** CERTIFICATE.VALIDITY_YEARS — operator 2026-09-11, commit a22007e4. */
export function backendCertificateValidityYears(): number {
    return Number(
        match(
            'apps/backend/config/business-rules.js',
            /const CERTIFICATE = Object\.freeze\(\{[\s\S]*?VALIDITY_YEARS:\s*(\d+)/,
        ),
    );
}

/** REMINDER_DAYS — the renewal reminder cadence the cron walks. */
export function backendRenewalReminderDays(): number[] {
    return match(
        'apps/backend/services/renewal-service.js',
        /const REMINDER_DAYS = Object\.freeze\(\[([^\]]+)\]\)/,
    )
        .split(',')
        .map((d) => Number(d.trim()));
}

/**
 * The payment methods the one live rail offers (mandate D3 2026-08-04):
 * CHECKOUT_PAYMENT_METHOD_TYPES, the list the checkout passes to the gateway.
 */
export function backendCheckoutPaymentMethods(): string[] {
    return match(
        'apps/backend/services/checkout/stripe-checkout-service.js',
        /const CHECKOUT_PAYMENT_METHOD_TYPES = Object\.freeze\(\[([^\]]*)\]\)/,
    )
        .split(',')
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}

/** PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS — the CAR revision window. */
export function backendCarRevisionDeadlineBusinessDays(): number {
    return Number(
        match(
            'apps/backend/config/business-rules.js',
            /const PAYMENT = Object\.freeze\(\{[\s\S]*?REVISION_DEADLINE_BUSINESS_DAYS:\s*(\d+)/,
        ),
    );
}

/** The text the applicant accepts before paying — the refund policy of record. */
export function paymentTermsDocument(): string {
    return readRepoFile('docs/legal/payment-terms-th-v1.2.md');
}
