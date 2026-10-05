/**
 * The company contact email printed on financial PDFs (invoice/ใบวางบิล,
 * receipt, tax invoice, credit/debit note) cannot drift from the web's own
 * contact-emails constant.
 *
 * Controller decision (fix/invoice-pdf-truth, 2026-09-27): the company
 * contact email on financial documents is finance@gacpth.com — the SAME
 * value as `FINANCE_EMAIL` in apps/web-app/src/constants/contact-emails.ts.
 * `config/invoice-issuers.js` FINANCE_CONTACT_EMAIL is the ONE backend
 * source (`PLATFORM_ISSUER.contactEmail` reads it); this test pins it
 * against the web literal the same way frontend-service-facts-mirror.test.js
 * pins CERTIFICATE.VALIDITY_YEARS etc. — never against a second literal
 * typed here, so moving one and forgetting the other turns this red.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { FINANCE_CONTACT_EMAIL, PLATFORM_ISSUER } = require('../../config/invoice-issuers');

const FE_CONTACT_EMAILS_FILE = path.resolve(
    __dirname, '../../../web-app/src/constants/contact-emails.ts',
);

function feLiteral(name) {
    const src = fs.readFileSync(FE_CONTACT_EMAILS_FILE, 'utf8');
    const m = src.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*'([^']+)'`));
    if (!m) throw new Error(`${name} is not a string literal of the expected shape in ${FE_CONTACT_EMAILS_FILE}`);
    return m[1];
}

describe('finance contact email mirrors the web constant', () => {
    test('backend FINANCE_CONTACT_EMAIL === web FINANCE_EMAIL', () => {
        expect(FINANCE_CONTACT_EMAIL).toBe(feLiteral('FINANCE_EMAIL'));
    });

    test('FINANCE_CONTACT_EMAIL is finance@gacpth.com (operator ruling 2026-09-26 — gacpth.com addresses stay)', () => {
        expect(FINANCE_CONTACT_EMAIL).toBe('finance@gacpth.com');
    });

    test('PLATFORM_ISSUER.contactEmail defaults to FINANCE_CONTACT_EMAIL, never a personal gmail', () => {
        if (process.env.PLATFORM_CONTACT_EMAIL) {
            // An operator/ops env override is in play in this process — this test
            // only pins the DEFAULT, so skip rather than false-fail against an
            // intentional override.
            return;
        }
        expect(PLATFORM_ISSUER.contactEmail).toBe(FINANCE_CONTACT_EMAIL);
        expect(PLATFORM_ISSUER.contactEmail).not.toMatch(/gmail\.com/i);
    });
});
