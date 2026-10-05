'use strict';
/**
 * The published fee table must equal what the fee service charges.
 *
 * docs/legal/payment-terms-th-v1.md declares 5,535 / 27,675 (the retired VAT
 * base: 7% of the platform fee alone). W14 (operator ruling 2026-08-22) put VAT
 * on the WHOLE ค่าบริการ, so the real figures are 5,885 / 29,425. A LIVE
 * consent document that understates the price is a legal exposure, not a typo.
 */
const fs = require('fs');
const path = require('path');
const { calculateApplicationFees, calculateRenewalFee } = require('../../modules/billing');

const V11 = path.resolve(__dirname, '../../../../docs/legal/payment-terms-th-v1.1.md');

describe('payment-terms v1.1 prints the figures the fee service produces', () => {
    const doc = fs.readFileSync(V11, 'utf8');
    const fees = calculateApplicationFees({ cultivationMethods: ['outdoor'] }, { scopeCount: 1 });
    const renewal = calculateRenewalFee({ cultivationMethods: ['outdoor'] }, { scopeCount: 1 });

    it('the per-scope phase totals are the ones the fee service returns', () => {
        expect(fees.phase1.phaseTotal).toBe(5885);
        expect(fees.phase2.phaseTotal).toBe(29425);
        expect(doc).toContain('5,885');
        expect(doc).toContain('29,425');
        expect(doc).toContain('35,310');
    });

    it('the retired figures are gone', () => {
        expect(doc).not.toContain('5,535');
        expect(doc).not.toContain('27,675');
    });

    it('the renewal charge is printed and is the renewal rate, not the phase-2 rate', () => {
        expect(renewal.phaseTotal).toBe(35310);
        expect(doc).toMatch(/ต่ออายุ[\s\S]{0,200}35,310/);
    });

    it('it names the VAT base W14 actually uses', () => {
        expect(doc).toMatch(/VAT 7%[\s\S]{0,120}ค่าธรรมเนียมกรม[\s\S]{0,40}ค่าแพลตฟอร์ม/);
    });

    it('it carries the version string the code sends with the acknowledgment', () => {
        expect(doc).toContain('payment-terms-th-v1.1');
    });

    it('v1 is marked superseded rather than deleted (applicants consented to that text)', () => {
        const v1 = fs.readFileSync(path.resolve(__dirname, '../../../../docs/legal/payment-terms-th-v1.md'), 'utf8');
        expect(v1).toMatch(/SUPERSEDED/);
        expect(v1).toContain('payment-terms-th-v1.1');
    });
});

/**
 * Fix round 1 (review r0, findings 1-2).
 *
 * Finding 1: the document contradicted itself about who the applicant is
 * paying. Section 1 states the W14 single-issuer model while sections 4 and 6
 * kept v1's collection-agent model ("แพลตฟอร์มเป็นผู้รับชำระแทนและนำส่งเท่านั้น",
 * state-fee refunds routed to DTAM's own process). The tree retired that model:
 * config/invoice-issuers.js:459-465 ("ONE issuer … the company settles the state
 * portion with DTAM afterwards, outside this system") and config/business-rules.js:34-36
 * ("There is no VAT-exempt government leg and no collection agent"). A consent
 * document that names two counterparties is the same class of defect this task
 * exists to remove.
 *
 * Finding 2: the document's effective date was conditional on an environment
 * variable that no tracked artifact sets, so merging the branch would leave
 * ConsentVersions.PAYMENT_TERMS at '1.0.0' (middleware/consent-manager.js:48)
 * and nobody would re-consent. The version the runtime must stamp now lives in
 * the env templates the operator deploys from, and is pinned to the version
 * string the document itself prints.
 */
describe('payment-terms v1.1 names one counterparty and one effective date', () => {
    const doc = fs.readFileSync(V11, 'utf8');
    // The text an applicant is asked to accept. HTML comments are maintainer
    // notes: markdown renderers drop them, so they are not part of the consent.
    const applicantFacing = doc.replace(/<!--[\s\S]*?-->/g, '');
    const ENV_TEMPLATES = [
        path.resolve(__dirname, '../../.env.example'),
        path.resolve(__dirname, '../../.env.production.example'),
    ];

    it('describes no collection agent: the retired two-issuer wording is gone', () => {
        expect(applicantFacing).not.toMatch(/ผู้รับชำระแทน/);
        expect(applicantFacing).not.toMatch(/คืนตามกระบวนการของกรมการแพทย์แผนไทย/);
    });

    it('names the company as the party that refunds a duplicate charge', () => {
        expect(applicantFacing).toMatch(/ชำระเงินซ้ำ[\s\S]{0,400}บริษัท[\s\S]{0,240}คืนเงิน/);
    });

    it('keeps the state rates of section 6 (pin: green before this round, must stay green)', () => {
        expect(doc).toContain('5,000');
        expect(doc).toContain('25,000');
    });

    it('carries a plain effective date, not one conditional on a system setting', () => {
        expect(applicantFacing).toMatch(/ตั้งแต่วันที่ 28 สิงหาคม 2569/);
        expect(applicantFacing).not.toContain('CONSENT_VERSION_PAYMENT_TERMS');
        expect(applicantFacing).not.toContain('consent-manager.js');
    });

    it('the version the runtime stamps is documented in the env templates the operator deploys from', () => {
        // v1.2 superseded this document on 2026-10-03; the templates follow the
        // document in force (payment-terms-v1-2-is-the-current-terms.test.js).
        const current = fs.readFileSync(path.resolve(__dirname, '../../../../docs/legal/payment-terms-th-v1.2.md'), 'utf8');
        const docVersion = (current.match(/`(payment-terms-th-v[\d.]+)`/) || [])[1];
        expect(docVersion).toBe('payment-terms-th-v1.2');
        for (const file of ENV_TEMPLATES) {
            const template = fs.readFileSync(file, 'utf8');
            const value = (template.match(/^#?\s*CONSENT_VERSION_PAYMENT_TERMS=\s*"?([^"\s#]+)"?/m) || [])[1];
            expect(value).toBe(docVersion);
        }
    });

    /**
     * Review r2 MINOR 2: a template that ships the override SET turns every
     * environment provisioned from it into a permanent pin. When v1.2 publishes
     * and PUBLISHED_CONSENT_VERSIONS moves, the deployed value does not: nobody
     * re-consents to the corrected text and checkout_orders.paymentTermsVersion
     * stamps the superseded version onto the row that is the no-refund evidence.
     * The line stays in the templates as documentation, commented out.
     */
    it('the override is documented but not set, so a copied template does not become a pin', () => {
        for (const file of ENV_TEMPLATES) {
            const template = fs.readFileSync(file, 'utf8');
            const lines = template.split('\n').filter((l) => /CONSENT_VERSION_PAYMENT_TERMS=/.test(l));
            expect(lines.length).toBeGreaterThan(0);
            for (const line of lines) {
                expect(line.trimStart().startsWith('#')).toBe(true);
            }
        }
    });

    it('the env templates state what happens when it is left unset', () => {
        for (const file of ENV_TEMPLATES) {
            const template = fs.readFileSync(file, 'utf8');
            expect(template).toContain('docs/legal/payment-terms-th-v1.2.md');
            expect(template).toContain('1.0.0');
        }
    });

    /**
     * Review r2 MINOR 1: the maintainer note is the instruction whoever
     * publishes v1.2 copies forward. While it said the env var "must be bumped
     * in the same deploy", following it set the override in a real environment
     * — the exact pin the test above exists to prevent. The note must name the
     * place a new version really ships.
     */
    it('the maintainer note names the code default, not the env var, as where a new version ships', () => {
        const maintainerNotes = (doc.match(/<!--[\s\S]*?-->/g) || []).join('\n');
        expect(maintainerNotes).toContain('PUBLISHED_CONSENT_VERSIONS');
        expect(maintainerNotes).not.toMatch(/must be bumped/);
        expect(maintainerNotes).toMatch(/OLDER/);
    });
});

/**
 * Review r1 MINOR 2: the document must not claim to be a screen it is not.
 *
 * v1:3 opened with "เอกสารนี้คือข้อความชุดเดียวกับที่แสดงให้ผู้ยื่นคำขอ …" and v1.1
 * inherited it verbatim. The tree contradicts it: both rails render a four to
 * five bullet summary with no fee table (checkout/client-view.tsx
 * `data-testid="checkout-terms-section"`, slip-upload-modal.tsx
 * `data-testid="slip-upload-terms-section"`), and apps/web-app/src/app has no
 * /legal/payment-terms route, so nothing renders this markdown at all. A
 * corrected price the applicant never sees, under a sentence saying they read
 * it, is the same defect this task exists to remove.
 */
describe('payment-terms v1.1 describes the surface the applicant actually reads', () => {
    const doc = fs.readFileSync(V11, 'utf8');
    const applicantFacing = doc.replace(/<!--[\s\S]*?-->/g, '');

    it('does not claim the payment screens render this exact text', () => {
        expect(applicantFacing).not.toContain('ข้อความชุดเดียวกับที่แสดง');
    });

    it('says the payment screens show a summary of these terms', () => {
        expect(applicantFacing).toMatch(/หน้าจอชำระเงิน[\s\S]{0,200}สรุป/);
    });

    it('names where the full text can be had, through a channel the product already runs', () => {
        // ข้อ 3 and ข้อ 4 already send the applicant to the responsible
        // inspector; this names no new door.
        expect(applicantFacing).toMatch(/ข้อความเต็ม[\s\S]{0,400}เจ้าหน้าที่ผู้ตรวจ/);
    });
});

/**
 * Review r1 MINOR 3 landed a code default, so the templates that used to carry
 * the whole mechanism must stop describing the old one. A template that says
 * "unset falls back to 1.0.0" for PAYMENT_TERMS is now simply wrong, and wrong
 * deployment instructions are how the mismatch happened in the first place.
 */
describe('the env templates describe the mechanism that is actually in the code', () => {
    const ENV_TEMPLATES = [
        path.resolve(__dirname, '../../.env.example'),
        path.resolve(__dirname, '../../.env.production.example'),
    ];

    it.each(ENV_TEMPLATES)('%s says where the default comes from', (file) => {
        const template = fs.readFileSync(file, 'utf8');
        const declaration = template.indexOf('CONSENT_VERSION_PAYMENT_TERMS=');
        expect(declaration).toBeGreaterThan(-1);
        const block = template.slice(Math.max(0, declaration - 1200), declaration);
        // Names the code-side default that ships with the document …
        expect(block).toContain('PUBLISHED_CONSENT_VERSIONS');
        // … and no longer claims the payment terms fall back to the baseline.
        expect(block).not.toMatch(/[Uu]nset falls back to[\s\S]{0,80}1\.0\.0/);
    });
});
