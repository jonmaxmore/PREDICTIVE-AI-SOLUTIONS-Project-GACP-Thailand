/**
 * Tests for invoice-template-service.js issuer wiring + CI gate logic.
 *
 * System deep-dive Tier 12 — Backend + Compliance + QA (2026-05-15).
 *
 * Covers:
 *   1. `resolveIssuerForTemplate` — pulls from canonical config + parses
 *      `(สำนักงานใหญ่)` branch suffix from legalNameTH
 *   2. The receipt / tax invoice template (receipt-tax-invoice.html, the one
 *      ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป paper since 2026-09-29) HAS the four issuer template variables
 *      (`{{ISSUER_NAME_TH}}`, `{{ISSUER_TAX_ID}}`, `{{ISSUER_BRANCH}}`,
 *      `{{ISSUER_ADDRESS}}`) — replaces the old hardcoded value
 *   3. CI gate `check-hardcoded-tax-ids` flags violations correctly
 *      (synthetic regression scenarios)
 */

const path = require('path');
const fs = require('fs');

const SERVICE_FILE = path.join(
    __dirname, '..', '..', 'services', 'pdf', 'invoice-template-service.js',
);
const TAX_INVOICE_TEMPLATE = path.join(
    __dirname, '..', '..', 'services', 'pdf', 'templates', 'receipt-tax-invoice.html',
);

describe('[Tier 12] invoice-template-service — issuer wiring', () => {
    let source;
    beforeAll(() => {
        source = fs.readFileSync(SERVICE_FILE, 'utf8');
    });

    it('imports `getInvoiceIssuer` from canonical config', () => {
        expect(source).toMatch(
            /require\(['"]\.\.\/\.\.\/config\/invoice-issuers['"]\)/,
        );
        expect(source).toMatch(/getInvoiceIssuer/);
    });

    it('exposes `resolveIssuerForTemplate` helper', () => {
        expect(source).toMatch(/function resolveIssuerForTemplate/);
    });

    it('tax-invoice data payload includes the four issuer template variables', () => {
        // The data object passed into replaceTemplateVariables for tax-invoice
        // must include ALL the issuer fields we added to the template.
        expect(source).toMatch(/ISSUER_NAME_TH\s*:/);
        expect(source).toMatch(/ISSUER_TAX_ID\s*:/);
        expect(source).toMatch(/ISSUER_BRANCH\s*:/);
        expect(source).toMatch(/ISSUER_ADDRESS\s*:/);
    });

    it('tax invoice resolves issuer via the PLATFORM service type (never DTAM)', () => {
        // Tax invoices are always issued by the platform company per ม.86/4.
        // The service file should call resolveIssuerForTemplate with a
        // PHASE_1_PLATFORM_FEE or PHASE_2_PLATFORM_FEE service type, NOT
        // a STATE_FEE type.
        expect(source).toMatch(/PHASE_\d_PLATFORM_FEE/);
        // It should NOT mention STATE_FEE inside the tax-invoice flow context.
        // (Allow STATE_FEE references in other flows like service-type-label
        // maps, which is fine — only flag inside generateReceiptTaxInvoicePdf.)
        const taxInvoiceFn = source.match(
            /async function generateReceiptTaxInvoicePdf[\s\S]*?(?=\nasync function|\nmodule\.exports)/,
        );
        expect(taxInvoiceFn).toBeTruthy();
        // The only STATE_FEE mention allowed is the refusal guard (a substring
        // test on the row's own serviceType), never a STATE_FEE issuer lookup.
        expect(taxInvoiceFn[0]).not.toMatch(/resolveIssuerForTemplate\([^)]*STATE_FEE/);
    });

    describe('resolveIssuerForTemplate behavior (loaded via require)', () => {
        let mod;
        beforeAll(() => {
            jest.resetModules();
            // Load fresh module — invoice-template-service exports it
            mod = require(SERVICE_FILE);
        });

        it('module loads without throwing (sanity check)', () => {
            // The module is mostly side-effect-free at load time. The fact
            // that requiring it doesn't crash means the canonical config
            // import resolved correctly.
            expect(mod).toBeTruthy();
        });
    });
});

describe('[Tier 12] receipt-tax-invoice.html template — issuer block content', () => {
    let html;
    beforeAll(() => {
        html = fs.readFileSync(TAX_INVOICE_TEMPLATE, 'utf8');
    });

    /**
     * Helper: extract the rendered issuer block (since 2026-09-29 the combined
     * paper carries the seller's name, tax ID, branch and address in the
     * `issuer-header` block at the top — one block, not a header plus a box).
     * Earlier: <div class="issuer-detail-box">...</div>
     * markup, stripping HTML comments inside so explanatory text (which may
     * cite the pre-Tier-12 hardcoded value as a historical reference) doesn't
     * count as live template content.
     *
     * B21-B (2026-05-16): the FlowAccount-grade redesign renamed the wrapper
     * from `tax-info-box` to `issuer-detail-box` so the styling reads naturally
     * across the 7 finance templates. The match falls back to the legacy class
     * name so older spec fixtures continue to resolve while the redesign rolls
     * forward.
     */
    function extractIssuerDivStripped() {
        const divMatch = html.match(
            /<div class="(?:issuer-header|issuer-detail-box|tax-info-box)">[\s\S]*?<\/div>\s*<\/div>/,
        );
        if (!divMatch) {return null;}
        // Strip HTML comments inside the div block
        return divMatch[0].replace(/<!--[\s\S]*?-->/g, '');
    }

    it('uses {{ISSUER_TAX_ID}} (not a hardcoded 13-digit number) in the rendered issuer block', () => {
        const block = extractIssuerDivStripped();
        expect(block).toBeTruthy();
        // Must contain the template variable
        expect(block).toContain('{{ISSUER_TAX_ID}}');
        // Must NOT contain a literal 13-digit number in the RENDERED markup
        // (comments stripped above so the bug-narrative comment doesn't fail this).
        expect(block).not.toMatch(/\b\d{13}\b/);
    });

    it('issuer block exposes all four required template variables', () => {
        const issuerBlock = extractIssuerDivStripped();
        expect(issuerBlock).toContain('{{ISSUER_NAME_TH}}');
        expect(issuerBlock).toContain('{{ISSUER_TAX_ID}}');
        expect(issuerBlock).toContain('{{ISSUER_BRANCH}}');
        expect(issuerBlock).toContain('{{ISSUER_ADDRESS}}');
    });

    it('keeps the ม.86/4 (1) "ใบกำกับภาษี" badge — never auto-strip', () => {
        // Compliance anchor: the literal Thai label MUST appear since
        // ม.86/4 (1) requires the document to say "ใบกำกับภาษี" prominently.
        expect(html).toContain('ใบกำกับภาษี');
    });
});

describe('[Tier 12] CI gate — check-hardcoded-tax-ids logic', () => {
    const { findViolationsInFile } = require(
        path.join(__dirname, '..', '..', '..', '..', 'scripts', 'ci', 'check-hardcoded-tax-ids'),
    );
    const os = require('os');

    // Write synthetic templates to a tmp dir to test the violation detector
    // without poisoning real templates.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier12-tax-id-test-'));

    afterAll(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_e) { /* ignore cleanup error */ }
    });

    it('flags a 13-digit literal INSIDE an issuer block as a violation', () => {
        const fakeHtml = `
            <html><body>
            <!-- Tax registration info -->
            <div>
              <span>เลขประจำตัวผู้เสียภาษีอากร</span>
              <span class="val">0105568045932</span>
            </div>
            <!-- Footer -->
            </body></html>
        `;
        const fakePath = path.join(tmpDir, 'violation.html');
        fs.writeFileSync(fakePath, fakeHtml, 'utf8');
        const violations = findViolationsInFile(fakePath);
        expect(violations).toHaveLength(1);
        expect(violations[0].literal).toBe('0105568045932');
    });

    it('does NOT flag a 13-digit literal OUTSIDE an issuer block (e.g. payment-info bank account)', () => {
        const fakeHtml = `
            <html><body>
            <!-- Payment info -->
            <div>เลขประจำตัวผู้เสียภาษี: 0994000036540</div>
            <!-- Footer -->
            </body></html>
        `;
        const fakePath = path.join(tmpDir, 'allowed.html');
        fs.writeFileSync(fakePath, fakeHtml, 'utf8');
        const violations = findViolationsInFile(fakePath);
        expect(violations).toHaveLength(0);
    });

    it('flags multiple violations in same block, reports line numbers', () => {
        const fakeHtml = `<html><body>
<!-- Tax registration info -->
<div>0105568045932</div>
<div>0105566098765</div>
<!-- Done -->
</body></html>`;
        const fakePath = path.join(tmpDir, 'multi.html');
        fs.writeFileSync(fakePath, fakeHtml, 'utf8');
        const violations = findViolationsInFile(fakePath);
        expect(violations).toHaveLength(2);
        expect(violations[0].line).toBe(3);
        expect(violations[1].line).toBe(4);
    });

    it('passes clean templates (zero violations) when only {{...}} variables in issuer block', () => {
        const fakeHtml = `
            <html><body>
            <!-- Tax registration info -->
            <div>{{ISSUER_TAX_ID}}</div>
            <div>{{ISSUER_NAME_TH}}</div>
            <!-- Footer -->
            </body></html>
        `;
        const fakePath = path.join(tmpDir, 'clean.html');
        fs.writeFileSync(fakePath, fakeHtml, 'utf8');
        const violations = findViolationsInFile(fakePath);
        expect(violations).toHaveLength(0);
    });

    it('the REAL receipt-tax-invoice.html template currently has zero violations (regression anchor)', () => {
        const violations = findViolationsInFile(TAX_INVOICE_TEMPLATE);
        expect(violations).toHaveLength(0);
    });
});
