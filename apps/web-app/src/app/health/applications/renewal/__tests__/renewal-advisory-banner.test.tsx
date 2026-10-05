/**
 * X1-FIX-C / C-3 — renewal advisory banner regression guard.
 *
 * X1-A flagged that the existing payment-step inline notice surfaced too
 * late: applicants only saw the "contact DTAM" message AFTER filling in
 * upload, quotation, and invoice screens. The fix introduces a prominent
 * `RenewalAdvisoryBanner` rendered at the TOP of every step of the
 * renewal wizard so the limitation is set up-front.
 *
 * SOURCE-FILE assertions (cheap + hermetic) — we don't fully mount the
 * page because the Suspense + router + api wiring is heavy; a source-
 * level grep is enough to catch a regression where the banner stops
 * being rendered or the data-testid is renamed silently. This mirrors
 * the existing `renewal-payment-pending.test.tsx` pattern (the
 * "client-view source no longer POSTs to /api/payments/confirm" test).
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const clientView = readFileSync(
    resolve(__dirname, '../client-view.tsx'),
    'utf8',
);

describe('[X1-FIX-C / C-3] renewal advisory banner — regression guard', () => {
    it('renders the data-testid="renewal-advisory-banner" on every step', () => {
        // The banner component is defined once and the JSX `{banner}`
        // expression is injected into the no-cert branch + each switch case.
        expect(clientView).toContain('data-testid="renewal-advisory-banner"');
        // The component name must be present (catches a refactor that
        // accidentally inlines or removes it).
        expect(clientView).toContain('RenewalAdvisoryBanner');
    });

    it('wires the banner into the no-cert empty state', () => {
        // Below `if (!certificate && (!certId || notFound))` the JSX must mention
        // `{banner}` BEFORE the dict-driven goToCertList CTA so the
        // applicant sees the advisory even on the empty entry case.
        // Y1-FIX-B moved the CTA literal into dict.health.renewal.goToCertList
        // so we anchor on the dict reference instead of the Thai string.
        const noCertSlice = clientView.split('if (!certificate && (!certId || notFound))')[1] || '';
        const ctaIndex = noCertSlice.indexOf('renewalCopy.goToCertList');
        const bannerIndex = noCertSlice.indexOf('{banner}');
        expect(bannerIndex).toBeGreaterThanOrEqual(0);
        expect(ctaIndex).toBeGreaterThanOrEqual(0);
        expect(bannerIndex).toBeLessThan(ctaIndex);
    });

    it('injects the banner into each wizard step (payment / invoice / quotation / default)', () => {
        // Lazy regex on `case '<step>':` ... `{banner}` — order matters so a
        // future refactor that drops one case is caught.
        for (const step of ['payment', 'invoice', 'quotation']) {
            const segment = clientView.split(`case '${step}':`)[1] || '';
            // Only look at the next case branch so we don't cross-pollinate.
            const upToNext = segment.split('case ')[0];
            expect(upToNext).toContain('{banner}');
        }
        // The default branch (upload step) must also have the banner.
        const defaultSegment = clientView.split('default: return (')[1] || '';
        expect(defaultSegment).toContain('{banner}');
    });

    it('pulls copy from dict.renewalAdvisory (i18n-aware)', () => {
        expect(clientView).toContain('dict.renewalAdvisory');
        expect(clientView).toContain('useLanguage');
    });

    it('renders a mailto: + /help/contact CTA so applicants have a recovery path', () => {
        expect(clientView).toContain('mailto:');
        expect(clientView).toContain('/help/contact');
    });
});
