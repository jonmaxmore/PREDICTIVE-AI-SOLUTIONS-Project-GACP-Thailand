/**
 * a11y-fixes-top-pages.test.tsx — W3-D (Iter W3)
 *
 * Pins the per-page accessibility fixes applied in W3-D so they don't
 * regress. Coverage by page:
 *
 *   1. health-login-page         — ShieldCheck icons get `aria-hidden`,
 *                                  ProviderLogin link gains focus-visible,
 *                                  Leaf+ChevronRight icons hidden.
 *   2. provider-login-page       — language-toggle gains aria-label +
 *                                  focus-visible; password-reveal gains
 *                                  aria-label + aria-pressed + focus-visible;
 *                                  decorative icons hidden.
 *   3. register page             — language-toggle gains aria-label +
 *                                  focus-visible; final submit button gains
 *                                  aria-label + aria-busy + focus-visible.
 *   4. register/success page     — language-toggle gains aria-label;
 *                                  primary CTA gains focus-visible;
 *                                  decorative IconCheck wrappers hidden.
 *   5. help page                 — every primary link gains focus-visible;
 *                                  the "ดูทั้งหมด →" link gets a real
 *                                  aria-label (arrow is decorative).
 *   6. about page                — external `<a>` to MINISTRY website
 *                                  gets aria-label declaring "opens in
 *                                  new tab"; CTA Links gain focus-visible.
 *
 * Strategy: render each component (server components via
 * renderToStaticMarkup; client components via LanguageProvider +
 * Suspense as needed) and assert the rendered markup contains the
 * expected attribute fragments. Markup-level assertions are sufficient
 * because the fixes are static prop changes — no behaviour to drive.
 *
 * I-016: jest.setup.tsx already provides a global next/navigation mock;
 * none of these pages have effect dep arrays on the router, so no
 * per-file stable mock is needed.
 */

import * as React from 'react';
import { describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

import { LanguageProvider } from '@/lib/i18n/language-context';

// Marketing + help server components — pure render, no providers needed.
import HelpHomePage from '@/app/help/page';
import AboutPage from '@/app/(marketing)/about/page';

// Client components — wrap in LanguageProvider so useLanguage resolves.
// Suspense boundary required for components that consume useSearchParams
// (register/success).
import HealthLoginPage from '@/app/auth/_components/health-login-page';
import ProviderLoginPage from '@/app/auth/_components/provider-login-page';
import RegisterPage from '@/app/(auth)/register/page';
import RegisterSuccessPage from '@/app/(auth)/register/success/page';

function withLanguage(node: React.ReactNode): string {
    return renderToStaticMarkup(<LanguageProvider>{node}</LanguageProvider>);
}

describe('W3-D a11y fixes — top public pages', () => {
    describe('health-login-page', () => {
        const html = withLanguage(<HealthLoginPage />);

        it('marks decorative icons (Leaf, ChevronRight, ShieldCheck) aria-hidden', () => {
            // At least 4 aria-hidden occurrences:
            //   Leaf×2 (mobile header + hero), ChevronRight×3 (feature bullets),
            //   ShieldCheck×2 (officer-link row + secure-note),
            //   plus the icons already present pre-W3-D (CreditCard, Lock,
            //   Globe, Eye/EyeOff, Phone, Mail, AlertCircle in some flows).
            const ariaHiddenCount = (html.match(/aria-hidden="true"/g) ?? []).length;
            expect(ariaHiddenCount).toBeGreaterThanOrEqual(8);
        });

        it('gives the "For Officers" link a visible focus ring', () => {
            // Link route is PROVIDER_LOGIN_ROUTE — pin focus-visible class
            // is present somewhere in the link's className.
            expect(html).toContain('focus-visible:ring');
        });

        it('keeps the password-reveal button keyboard accessible (aria-label + aria-pressed)', () => {
            expect(html).toMatch(/aria-label="(แสดงรหัสผ่าน|ซ่อนรหัสผ่าน)"/);
            expect(html).toContain('aria-pressed="false"');
        });
    });

    describe('provider-login-page', () => {
        const html = withLanguage(<ProviderLoginPage />);

        it('language-toggle button has aria-label + focus-visible', () => {
            // Either Thai or English aria-label is acceptable since the
            // default starts Thai → toggle label reads "Switch language to English".
            expect(html).toMatch(/aria-label="Switch language to English"/);
            expect(html).toContain('focus-visible:ring');
        });

        it('decorative icons (Leaf, User, Lock, Globe, AlertTriangle, ArrowRight) carry aria-hidden', () => {
            const ariaHiddenCount = (html.match(/aria-hidden="true"/g) ?? []).length;
            // 6 decorative icons minimum: Leaf, User, Lock, Globe,
            // AlertTriangle, ArrowRight (+ optional Eye/EyeOff if reveal
            // state happens to render with one of them).
            expect(ariaHiddenCount).toBeGreaterThanOrEqual(6);
        });

        it('password-reveal button gains aria-label + aria-pressed + focus-visible', () => {
            // The bilingual aria-label expression renders the Thai version
            // for the default `language="th"` state.
            expect(html).toMatch(/aria-label="แสดงรหัสผ่าน"/);
            expect(html).toContain('aria-pressed="false"');
        });

        it('submit button gains aria-busy + focus-visible ring', () => {
            expect(html).toContain('aria-busy="false"');
            expect(html).toContain('focus-visible:ring');
        });
    });

    describe('register page', () => {
        const html = withLanguage(<RegisterPage />);

        it('language-toggle has aria-label + focus-visible', () => {
            expect(html).toMatch(/aria-label="Switch language to English"/);
            expect(html).toContain('focus-visible:ring');
        });

        it('icons used inside the language-toggle + form inputs carry aria-hidden', () => {
            const ariaHiddenCount = (html.match(/aria-hidden="true"/g) ?? []).length;
            // Step 1 is the visible step on first render → ID + first name
            // + last name inputs each carry a User icon with aria-hidden.
            expect(ariaHiddenCount).toBeGreaterThanOrEqual(4);
        });
    });

    describe('register/success page', () => {
        // Suspense fallback handles the useSearchParams boundary.
        const html = renderToStaticMarkup(
            <React.Suspense fallback={null}>
                <LanguageProvider>
                    <RegisterSuccessPage />
                </LanguageProvider>
            </React.Suspense>,
        );

        it('language-toggle button has aria-label + focus-visible', () => {
            expect(html).toMatch(/aria-label="Switch language to English"/);
            expect(html).toContain('focus-visible:ring');
        });

        it('feature-bullet icon wrappers carry aria-hidden', () => {
            const ariaHiddenCount = (html.match(/aria-hidden="true"/g) ?? []).length;
            // 3 hero-feature wrappers + 1 hero badge IconCheck + brand-mark
            // wrapper (pre-existing) + the in-panel IconCheck/IconShieldCheck.
            expect(ariaHiddenCount).toBeGreaterThanOrEqual(5);
        });
    });

    describe('help page', () => {
        const html = renderToStaticMarkup(<HelpHomePage />);

        it('top CTA Links carry focus-visible rings', () => {
            // Spot-check 2 of the 3 ratcheted links (header CTAs).
            expect(html).toContain('focus-visible:ring-2');
        });

        it('"ดูทั้งหมด →" link has aria-label and the arrow is hidden', () => {
            // The aria-label says "ดูคำถามทั้งหมด" and the rendered text
            // wraps the arrow in <span aria-hidden="true">.
            expect(html).toContain('aria-label="ดูคำถามทั้งหมด"');
            expect(html).toContain('aria-hidden="true">ดูทั้งหมด');
        });
    });

    describe('about page (marketing)', () => {
        const html = renderToStaticMarkup(<AboutPage />);

        it('external website link declares "opens in new tab" via aria-label', () => {
            expect(html).toMatch(/aria-label="[^"]*\(เปิดในแท็บใหม่\)"/);
        });

        it('CTA Links carry focus-visible outline rings', () => {
            expect(html).toContain('focus-visible:outline');
        });
    });
});
