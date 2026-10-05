#!/usr/bin/env node
/**
 * Forbid hardcoded tax IDs / company names inside HTML financial-document
 * templates.
 *
 * How this runs (2026-08-14): by hand only — `pnpm check:hardcoded-tax-ids`
 * (package.json:36). This script was never wired into a workflow, and GitHub
 * Actions is permanently unavailable anyway (the change log 2026-08-14); it has
 * no row in scripts/ci/full-gate-checks.txt or local-gate.sh.
 *
 * System deep-dive Tier 12 — Backend + Compliance + DevOps (2026-05-15).
 *
 * Background
 * ──────────
 * Before Tier 12, `tax-invoice.html` had a literal `0994000036540` in the
 * "Tax Invoice Issuer" block. Two problems:
 *   1. Wrong entity — that's DTAM's tax ID, but tax invoices are issued
 *      by the platform company (Predictive AI Solution) per ม.86/4 ป.รัษฎากร.
 *   2. Drift — the moment the legal entity rotates (rare but legally possible)
 *      the template silently keeps emitting the stale value.
 *
 * Tier 12 swapped the hardcoded value for `{{ISSUER_TAX_ID}}` template
 * variables driven by `config/invoice-issuers.js`. This gate prevents
 * regressions: NO 13-digit number may appear in the issuer-info block of
 * any financial-document HTML template.
 *
 * Scope
 * ─────
 * - Files checked: `apps/backend/services/pdf/templates/*.html`
 * - Block context: lines inside an issuer section (delimited by HTML
 *   comments like "Tax registration info" or "Issuer")
 *
 * Allowlist
 * ─────────
 * Payment-info sections (bank-transfer account number, PromptPay account
 * tax ID) are intentionally left literal — they identify the destination
 * account at the bank, which is a separate concern from the legal-entity
 * issuer block.
 *
 * Where that literal lives now (verified 2026-08-14): no 13-digit literal
 * remains in any template — `grep -n "[0-9]\{13\}" apps/backend/services/pdf/
 * templates/*.html` returns nothing. The DTAM number survives as a fallback in
 * `apps/backend/config/invoice-issuers.js:283` (`process.env.DTAM_TAX_ID ||
 * '0994000036540'`) and `:383` (PromptPay). Whether that fallback is the right
 * DTAM identity for money documents is a Tier C question standing with the
 * operator — tabled in reports/rules-audit/operator-decisions.md, not decided
 * by this script.
 *
 * Exit codes
 * ──────────
 *   0 — clean
 *   1 — at least one violation
 *   2 — runtime / IO error
 */

const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.join(
    __dirname, '..', '..', 'apps', 'backend', 'services', 'pdf', 'templates',
);

// Files to scan. Limit explicitly so a new template doesn't get checked
// silently — adding one is a Compliance-review event.
const FILES = ['invoice.html', 'receipt-tax-invoice.html'];

// 13-digit Thai tax ID regex (uses matchAll — no child_process / shell)
const TAX_ID_REGEX = /\b\d{13}\b/g;

// Block markers — when we're inside an issuer-info block, ANY 13-digit
// literal is a violation. Outside (e.g. inside payment-info bank-account
// block in invoice.html), the literal might be intentional (bank account).
const ISSUER_BLOCK_OPEN = /<!--\s*Tax registration info|<!--\s*.*Issuer\b|<!--\s*.*ผู้ออก/i;
// Any HTML comment — used to detect block boundaries (next comment closes
// the previous block in our scanner).
const ANY_HTML_COMMENT = /<!--[\s\S]*?-->/g;

function findViolationsInFile(filePath) {
    const src = fs.readFileSync(filePath, 'utf8');
    const violations = [];

    // Collect all `<!-- ... -->` comments using matchAll (no .exec usage,
    // pure regex pattern matching — safe from any code-execution path).
    const commentMatches = Array.from(src.matchAll(ANY_HTML_COMMENT));
    const commentRanges = commentMatches.map((m) => ({
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        isIssuerOpen: ISSUER_BLOCK_OPEN.test(m[0]),
    }));

    // Build issuer-block spans: from an isIssuerOpen comment to the next
    // top-level comment (or end of file).
    const issuerSpans = [];
    for (let i = 0; i < commentRanges.length; i += 1) {
        if (!commentRanges[i].isIssuerOpen) continue;
        const start = commentRanges[i].end;
        const end = i + 1 < commentRanges.length
            ? commentRanges[i + 1].start
            : src.length;
        issuerSpans.push({ start, end });
    }

    // Scan 13-digit literals via matchAll; if the literal falls inside
    // any issuer span, it's a violation.
    const literalMatches = Array.from(src.matchAll(TAX_ID_REGEX));
    for (const lit of literalMatches) {
        const inIssuer = issuerSpans.some((sp) =>
            lit.index >= sp.start && lit.index < sp.end);
        if (!inIssuer) continue;
        // Compute line number (1-based) for the violation
        const lineNum = src.slice(0, lit.index).split('\n').length;
        violations.push({
            file: path.relative(process.cwd(), filePath),
            line: lineNum,
            literal: lit[0],
            suggestion: '{{ISSUER_TAX_ID}}',
        });
    }

    return violations;
}

function main() {
    const allViolations = [];
    for (const fname of FILES) {
        const filePath = path.join(TEMPLATE_DIR, fname);
        if (!fs.existsSync(filePath)) {
            // eslint-disable-next-line no-console
            console.warn(`[check-hardcoded-tax-ids] skip missing: ${filePath}`);
            continue;
        }
        const v = findViolationsInFile(filePath);
        allViolations.push(...v);
    }

    if (allViolations.length === 0) {
        // eslint-disable-next-line no-console
        console.log('[check-hardcoded-tax-ids] OK — no hardcoded tax IDs in issuer blocks');
        process.exit(0);
    }

    // eslint-disable-next-line no-console
    console.error('[check-hardcoded-tax-ids] FAIL — hardcoded tax IDs found:');
    for (const v of allViolations) {
        // eslint-disable-next-line no-console
        console.error(
            `  ${v.file}:${v.line}  literal=${v.literal}  → use ${v.suggestion}`,
        );
    }
    // eslint-disable-next-line no-console
    console.error('');
    // eslint-disable-next-line no-console
    console.error('See docs/financial-documents/RECEIPT-DESIGN-SPEC.md §11 (anti-patterns)');
    // eslint-disable-next-line no-console
    console.error('and config/invoice-issuers.js for the canonical source.');
    process.exit(1);
}

module.exports = { findViolationsInFile };

if (require.main === module) {
    try {
        main();
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[check-hardcoded-tax-ids] runtime error:', err.message);
        process.exit(2);
    }
}
