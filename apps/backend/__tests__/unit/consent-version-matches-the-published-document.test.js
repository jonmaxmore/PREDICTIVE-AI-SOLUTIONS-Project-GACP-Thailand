'use strict';

/**
 * The version the runtime stamps must be the document that is published.
 *
 * F-G4-64 T9, review r1 MINOR 3. `_resolveConsentVersion` fell back to
 * DEFAULT_CONSENT_VERSION ('1.0.0') for EVERY category, so a deploy that
 * publishes docs/legal/payment-terms-th-v1.1.md without also editing the real
 * .env leaves ConsentVersions.PAYMENT_TERMS at '1.0.0'. The consequences are
 * not cosmetic:
 *
 *   - services/billing/payment-terms-gate.js compares the stored grant against
 *     ConsentVersions.PAYMENT_TERMS, so every v1-era grant reads as current and
 *     nobody re-consents to the corrected price;
 *   - checkout_orders.paymentTermsVersion stamps the superseded version onto
 *     the money row that IS the no-refund evidence;
 *   - docs/legal/payment-terms-th-v1.1.md:7 promises the applicant, in their own
 *     text, that they will be asked to accept once more. That sentence is false
 *     until the runtime default equals the published document.
 *
 * A template that tells a human to set a variable is an instruction, not a
 * mechanism (the project rules: a rule with no machine behind it is a draft rule). The
 * default therefore comes from the tree, and the env var stays an override.
 *
 * The two sides compared here are independent artifacts: the filenames in
 * docs/legal/ versus the constant the middleware resolves. Adding
 * payment-terms-th-v1.2.md without bumping the default turns this red.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        userConsent: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        user: { findUnique: jest.fn() },
    },
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(undefined) },
    AuditCategory: { SECURITY: 'SECURITY' },
}));

const LEGAL_DIR = path.resolve(__dirname, '../../../../docs/legal');
const ENV_KEY = 'CONSENT_VERSION_PAYMENT_TERMS';

/** The newest payment-terms document on disk, by numeric version, without .md. */
function newestPublishedPaymentTerms() {
    const versioned = fs.readdirSync(LEGAL_DIR)
        .map((file) => /^payment-terms-th-v(\d+(?:\.\d+)*)\.md$/.exec(file))
        .filter(Boolean)
        .map((m) => ({ file: m[0], parts: m[1].split('.').map(Number) }));
    versioned.sort((a, b) => {
        const width = Math.max(a.parts.length, b.parts.length);
        for (let i = 0; i < width; i += 1) {
            const diff = (b.parts[i] || 0) - (a.parts[i] || 0);
            if (diff !== 0) {
                return diff;
            }
        }
        return 0;
    });
    return versioned[0].file.replace(/\.md$/, '');
}

/**
 * Re-require consent-manager with the env var set / unset, never leaking the
 * ambient value (jest inherits apps/backend/.env — Global Constraint 9).
 */
function consentManagerWithEnv(value) {
    const had = Object.prototype.hasOwnProperty.call(process.env, ENV_KEY);
    const saved = process.env[ENV_KEY];
    if (value === undefined) { delete process.env[ENV_KEY]; } else { process.env[ENV_KEY] = value; }
    let loaded;
    let db;
    jest.isolateModules(() => {
        loaded = require('../../middleware/consent-manager');
        // The isolated registry builds its OWN copy of the mocked module, so the
        // prisma stub the manager actually calls is this one, not the outer one.
        db = require('../../services/prisma-database').prisma;
    });
    if (had) { process.env[ENV_KEY] = saved; } else { delete process.env[ENV_KEY]; }
    return { ConsentVersions: loaded.ConsentVersions, consentManager: loaded.consentManager, prisma: db };
}

describe('the consent version the runtime stamps equals the published document', () => {
    it('PAYMENT_TERMS defaults to the newest published payment-terms document, with no env var set', () => {
        const { ConsentVersions } = consentManagerWithEnv(undefined);
        expect(ConsentVersions.PAYMENT_TERMS).toBe(newestPublishedPaymentTerms());
        expect(ConsentVersions.PAYMENT_TERMS).toBe('payment-terms-th-v1.2');
    });

    it('the document that default names is the one that carries the version string', () => {
        const { ConsentVersions } = consentManagerWithEnv(undefined);
        const doc = fs.readFileSync(path.join(LEGAL_DIR, `${ConsentVersions.PAYMENT_TERMS}.md`), 'utf8');
        expect(doc).toContain(ConsentVersions.PAYMENT_TERMS);
    });

    it('the env var still overrides the default (ops can bump without a code deploy)', () => {
        const { ConsentVersions } = consentManagerWithEnv('payment-terms-th-v9.9');
        expect(ConsentVersions.PAYMENT_TERMS).toBe('payment-terms-th-v9.9');
    });

    it('a category with no published document in this tree keeps the historical baseline', () => {
        const { ConsentVersions } = consentManagerWithEnv(undefined);
        expect(ConsentVersions.PRIVACY_POLICY).toBe('1.0.0');
        expect(ConsentVersions.TERMS_OF_SERVICE).toBe('1.0.0');
    });

    it('getUserConsents reports the version in force beside the version each grant was given under', async () => {
        // Without this the FE cannot tell a current grant from a stale one: the
        // slip modal and the checkout page both hide the acknowledgment
        // checkbox on `granted === true` (isPaymentTermsGranted), so a version
        // bump would leave the applicant with no way to re-accept and a 409
        // from the gate they cannot act on.
        const { consentManager, prisma } = consentManagerWithEnv(undefined);
        prisma.userConsent.findMany.mockResolvedValue([
            {
                category: 'PAYMENT_TERMS',
                granted: true,
                version: '1.0.0',
                grantedAt: new Date('2026-07-09T00:00:00.000Z'),
                withdrawnAt: null,
            },
        ]);

        const status = await consentManager.getUserConsents('user-1');
        expect(status.PAYMENT_TERMS).toMatchObject({
            granted: true,
            version: '1.0.0',
            currentVersion: 'payment-terms-th-v1.2',
        });
    });
});
