/**
 * Tests anchoring that payment-service-phase-flow.js bills the CANONICAL
 * customer-facing total, not the back-compat state-only `.total` alias.
 *
 * System deep-dive Tier 8 — Backend + Compliance + Security + QA (2026-05-15).
 *
 * Why this test file exists:
 *
 * The fee-service `buildPhaseFee()` result has BOTH `.total` and `.phaseTotal`:
 *   - `.total`      = stateAmount only      (5,000 / 25,000) — back-compat alias
 *   - `.phaseTotal` = state + platform + VAT (5,535 / 27,675) — canonical total
 *
 * Pre-Tier-8 `payment-service-phase-flow.js` used `.total`, which silently
 * underbilled every applicant by 535 THB (Phase 1) + 2,675 THB (Phase 2):
 *   - Application.phase1Amount / phase2Amount overwritten with state-only
 *   - Payment URL generated with state-only amount
 *   - VAT (35 + 175) and platform fees (500 + 2,500) never collected
 *
 * The Tier 8 fix switches both Phase 1 and Phase 2 to `.phaseTotal`.
 *
 * These tests are anchors against regression: any future change that
 * reverts to `.total` (or any non-canonical alias) will be caught here.
 */

const path = require('path');
const fs = require('fs');

const PHASE_FLOW_PATH = path.join(
    __dirname, '..', '..', 'services', 'payment-service-phase-flow.js',
);

describe('[Tier 8] payment-service-phase-flow uses canonical phaseTotal (not state-only .total)', () => {
    let source;
    let codeOnly;
    beforeAll(() => {
        source = fs.readFileSync(PHASE_FLOW_PATH, 'utf8');
        // Strip line-comments and block-comments so the assertions match
        // code only — the explanatory block-comment we added quotes the
        // pre-fix `.total` lines verbatim for documentation, which would
        // otherwise trip the "no `.total` regression" assertion.
        codeOnly = source
            .replace(/\/\*[\s\S]*?\*\//g, '')   // strip block comments
            .replace(/(^|[^:])\/\/.*$/gm, '$1'); // strip line comments
    });

    it('sources the Phase 1 amount from the locked full-phase-total (canonical 5,535)', () => {
        // GAP-5 (2026-07-08): the writer no longer reads calculatedFees.phase1
        // directly — it sources the full phase total through
        // resolveLockedPhaseTotals(), which copies the accepted-quote frozen
        // amount or the recompute. Both branches read `.phaseTotal`, never the
        // state-only `.total` alias.
        expect(codeOnly).toMatch(/const\s+phase1Amount\s*=\s*locked\.phase1Total\s*;/);
        // resolveLockedPhaseTotals sources the canonical recompute total.
        expect(codeOnly).toMatch(/phase1Total:\s*recomputedFees\.phase1\.phaseTotal\b/);
    });

    it('sources the Phase 2 amount from the locked full-phase-total', () => {
        // One writer since Wave 0: createPhase2Payment was removed with the
        // dead route surface (the DOC_APPROVED auto-chain mints Phase-2
        // invoices instead). The Phase-1 flow still patches phase2Amount and
        // must keep sourcing it from the locked total.
        const matches = codeOnly.match(/const\s+phase2Amount\s*=\s*locked\.phase2Total\s*;/g);
        expect(matches).not.toBeNull();
        expect(matches.length).toBeGreaterThanOrEqual(1);
        expect(codeOnly).toMatch(/phase2Total:\s*recomputedFees\.phase2\.phaseTotal\b/);
    });

    it('does NOT use the state-only `.total` alias for phase amounts (code only)', () => {
        // Anchor against regression — if anyone "simplifies" back to `.total`,
        // this test fires and the reviewer is forced to look at the comment.
        // Match against `codeOnly` so the verbatim before/after comment block
        // (which documents the pre-fix code) doesn't trip this assertion.
        expect(codeOnly).not.toMatch(
            /const\s+phase1Amount\s*=\s*calculatedFees\.phase1\.total\s*;/,
        );
        expect(codeOnly).not.toMatch(
            /const\s+phase2Amount\s*=\s*calculatedFees\.phase2\.total\s*;/,
        );
    });

    it('keeps the explanatory comment so the next dev understands why', () => {
        // The fix comment block carries the bug narrative — make sure nobody
        // strips it during a future drive-by refactor. Match against `source`
        // (with comments) — these phrases live in the comment.
        expect(source).toMatch(/Tier 8/);
        expect(source).toMatch(/phaseTotal/);
        // Match either "Underbilling" or "underbill" (case-insensitive) so the
        // comment can use either casing without false-failing the anchor.
        expect(source).toMatch(/underbill/i);
    });
});

describe('[Tier 8] fee-service canonical totals — anchor', () => {
    // Direct anchor on fee-service output so we cannot accidentally rename
    // `.phaseTotal` to something else without breaking this test.
    const feeService = require('../../services/fee-service');

    it('exposes .phaseTotal that equals state + platform + VAT (canonical 5,535/27,675 for single scope)', () => {
        const fees = feeService.calculateApplicationFees({
            cultivationMethods: ['indoor'], // single scope
        });

        expect(fees.scopeCount).toBe(1);
        // Phase 1: 5,000 (state) + 500 (10% platform) + 35 (7% of platform VAT) = 5,535
        expect(fees.phase1.phaseTotal).toBe(5885);
        // Phase 2: 25,000 + 2,500 + 175 = 27,675
        expect(fees.phase2.phaseTotal).toBe(29425);
    });

    it('exposes .total as an alias for phaseTotal (post-Phase-A6 audit, 2026-04-28)', () => {
        // Post-mortem update (2026-05-16): the original Tier 8 narrative
        // assumed `.total` still returned `stateAmount` (5,000) as a back-compat
        // alias. Audit of `modules/billing/internal/fee-service.js:142` shows
        // `.total` was already canonicalized to equal `phaseTotal` (5,535) in
        // Phase A6 (2026-04-28) precisely to fix the same "underbilling" the
        // Tier 8 narrative described — that revenue-leak was closed weeks
        // before the Tier 8 sprint began. The remaining Tier 8 work (forcing
        // `payment-service-phase-flow.js` to read `.phaseTotal` explicitly)
        // is now a defense-in-depth measure: if `.total` is ever rolled back
        // to stateAmount, the payment service still does the canonical thing.
        //
        // For callers that genuinely need the state-only sub-total, the
        // canonical reading is `.stateAmount` (NOT `.total`).
        const fees = feeService.calculateApplicationFees({
            cultivationMethods: ['indoor'],
        });

        expect(fees.phase1.total).toBe(5885);            // post-A6 canonical
        expect(fees.phase2.total).toBe(29425);
        expect(fees.phase1.total).toBe(fees.phase1.phaseTotal);
        expect(fees.phase2.total).toBe(fees.phase2.phaseTotal);
        // The state-only sub-total used to be readable as `.stateAmount`
        // (5,000 / 25,000). operator 2026-09-11 retired the split, so the
        // pre-VAT figure is ค่าบริการ itself and there is no state slice to
        // expose. Asserting its ABSENCE keeps the old reader from coming back
        // and silently reading `undefined` into a money calculation.
        expect(fees.phase1.serviceFeeAmount).toBe(5500);
        expect(fees.phase2.serviceFeeAmount).toBe(27500);
        expect(fees.phase1).not.toHaveProperty('stateAmount');
        expect(fees.phase2).not.toHaveProperty('stateAmount');
    });

    it('multi-scope canonical total scales linearly with scopeCount', () => {
        const fees = feeService.calculateApplicationFees({
            cultivationMethods: ['indoor', 'greenhouse', 'outdoor'],
        });
        expect(fees.scopeCount).toBe(3);
        // 3-scope Phase 1: 15,000 + 1,500 + 105 = 16,605
        expect(fees.phase1.phaseTotal).toBe(17655);
        // 3-scope Phase 2: 75,000 + 7,500 + 525 = 83,025
        expect(fees.phase2.phaseTotal).toBe(88275);
    });

    // Tier 14 batches 9-12 — anchor for 5-scope billing. Highest scope tier
    // a farmer can register; if canonical scaling regresses here, a 5-scope
    // applicant gets undercharged by N × (535 + 2,675) THB. The exact 5x
    // multiplier of single-scope is the canonical proof — Phase 1 single
    // (5,535) × 5 = 27,675 and Phase 2 single (27,675) × 5 = 138,375.
    it('5-scope canonical total = 5 × single-scope (Tier 14 anchor)', () => {
        const single = feeService.calculateApplicationFees({
            cultivationMethods: ['indoor'],
        });
        const fiveScope = feeService.calculateApplicationFees({
            cultivationMethods: ['indoor', 'greenhouse', 'outdoor', 'rooftop', 'mixed'],
        });
        expect(fiveScope.scopeCount).toBe(5);
        // Hard-coded canonical values — independent regression guard.
        expect(fiveScope.phase1.phaseTotal).toBe(29425);
        expect(fiveScope.phase2.phaseTotal).toBe(147125);
        // Linear-scaling proof against single-scope.
        expect(fiveScope.phase1.phaseTotal).toBe(single.phase1.phaseTotal * 5);
        expect(fiveScope.phase2.phaseTotal).toBe(single.phase2.phaseTotal * 5);
        // The .total alias must scale identically (post-A6 canonicalisation).
        expect(fiveScope.phase1.total).toBe(29425);
        expect(fiveScope.phase2.total).toBe(147125);
    });
});
