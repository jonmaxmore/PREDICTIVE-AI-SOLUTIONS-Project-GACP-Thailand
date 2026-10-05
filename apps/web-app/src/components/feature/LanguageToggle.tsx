'use client';

/**
 * Y1-FIX-A — Language toggle button primitive.
 *
 * Why this exists:
 *   The HEALTH and PROVIDER portals had ZERO post-login language toggle
 *   (X2-A finding §6, Y1-AUDIT §1). The auth pages already had a
 *   `<Globe />` + EN/TH inline button (see `health-login-page.tsx`
 *   L151-159 and `provider-login-page.tsx`) but every page rendered
 *   through `DashboardLayout` was locked to its session locale. Users
 *   had to navigate to /health/settings to change language (HEALTH) or
 *   had no toggle at all (PROVIDER).
 *
 * Implementation note — provider-agnostic state read:
 *   This component intentionally reads `language` from localStorage
 *   plus a `storage` event listener rather than from `useLanguage()`.
 *   Reason: the existing `LanguageProvider` already persists every
 *   `setLanguage` write to localStorage AND already listens for
 *   storage events from other tabs (see language-context.tsx:30-47).
 *   By writing to localStorage + dispatching a synthetic `storage`
 *   event on the SAME tab, we ride the existing same-tab→provider
 *   propagation path without depending on the React context being
 *   present. This means:
 *
 *     - In production (LanguageProvider mounted at app root), the
 *       toggle writes localStorage, dispatches storage, and the
 *       provider's listener flips its React state — the rest of the
 *       app re-renders.
 *     - In legacy tests that mount portal pages without wiring up
 *       LanguageProvider, the toggle still functions visually and
 *       does not throw. No test-file changes required outside this
 *       agent's scope.
 *
 *   The `useLanguage()` hook stays the canonical reader for OTHER
 *   components; this toggle is the writer-with-fallback because it's
 *   the universal control surface.
 *
 * Pattern:
 *   - Reads/writes the global language via localStorage + the existing
 *     `storage` event channel. Persistence is automatic.
 *   - Renders the "other" language as the button label (TH when current
 *     is EN, EN when current is TH) — same UX as the login pages.
 *   - Two visual variants:
 *       • `topbar` (default) — 44x44 circular icon-only button matching
 *         the bell / theme toggle in the gov-topbar header.
 *       • `pill` — small TH/EN pill button (used in login pages, can
 *         be re-used in modals or auth flows). Carries a `<Globe />`
 *         icon and language text.
 *   - A11y: dynamic `aria-label` names the destination language while
 *     staying in the language the page is currently in ("สลับภาษาเป็น
 *     ภาษาอังกฤษ" on a Thai page, "Switch language to Thai" on an English
 *     one). It used to be written in the destination's script, which put
 *     Thai glyphs on English pages and gave an English screen reader
 *     nothing it could pronounce.
 */

import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';

import { cn } from '@/lib/utils';

export type LanguageToggleVariant = 'topbar' | 'pill';
export type LanguageToggleLanguage = 'th' | 'en';

export interface LanguageToggleProps {
    variant?: LanguageToggleVariant;
    className?: string;
}

/**
 * Aria label resolver — names the destination language, phrased in the
 * language the page is currently in.
 */
export function resolveLanguageToggleAria(currentLanguage: LanguageToggleLanguage): string {
    // Announced in the language the page is CURRENTLY in, naming the
    // destination — not written in the destination's script. The old
    // cross-script form put Thai glyphs on an English page, which is the one
    // thing EN mode must not contain, and a screen reader running in English
    // has no voice for them: it reads noise rather than an instruction.
    return currentLanguage === 'th'
        ? 'สลับภาษาเป็นภาษาอังกฤษ'
        : 'Switch language to Thai';
}

/**
 * Read the active language from localStorage. Returns 'th' (the project
 * default) on any error or missing/invalid value.
 */
function readStoredLanguage(): LanguageToggleLanguage {
    if (typeof window === 'undefined') return 'th';
    try {
        const stored = window.localStorage.getItem('language');
        if (stored === 'th' || stored === 'en') return stored;
    } catch {
        // localStorage may be disabled in some environments.
    }
    return 'th';
}

export function LanguageToggle({ variant = 'topbar', className }: LanguageToggleProps) {
    const [language, setLanguage] = useState<LanguageToggleLanguage>('th');

    // After mount, sync to the persisted value. Mirrors the
    // LanguageProvider's hydration pattern; without this the SSR'd
    // markup would always show TH until a user clicked the toggle.
    useEffect(() => {
        setLanguage(readStoredLanguage());
    }, []);

    // Cross-tab / cross-provider sync: when another part of the app
    // (the provider itself, the settings page toggle, or another tab)
    // changes the language via localStorage, reflect that change here
    // so the button label stays accurate.
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === 'language') {
                if (e.newValue === 'th' || e.newValue === 'en') {
                    setLanguage(e.newValue);
                }
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const otherLanguage: LanguageToggleLanguage = language === 'th' ? 'en' : 'th';
    const buttonLabel = language === 'th' ? 'EN' : 'TH';
    const ariaLabel = resolveLanguageToggleAria(language);

    const handleClick = () => {
        setLanguage(otherLanguage);
        try {
            window.localStorage.setItem('language', otherLanguage);
        } catch {
            // Storage may be disabled — fall through; visual flip still works
            // for the lifetime of this component.
        }
        // Dispatch a synthetic storage event so the existing
        // LanguageProvider's listener (language-context.tsx:30-47) picks
        // up the change in the same tab. The native `storage` event only
        // fires across tabs, but dispatchEvent on the current tab is
        // honoured by listeners on the same window.
        try {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: 'language',
                    newValue: otherLanguage,
                    oldValue: language,
                }),
            );
        } catch {
            // Some test harnesses (older jsdom) lack StorageEvent —
            // fall through. localStorage write still persisted.
        }
    };

    if (variant === 'pill') {
        return (
            <button
                type="button"
                data-testid="language-toggle"
                data-variant="pill"
                onClick={handleClick}
                aria-label={ariaLabel}
                className={cn(
                    'flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2',
                    className,
                )}
            >
                <Globe size={12} aria-hidden="true" focusable="false" />
                {buttonLabel}
            </button>
        );
    }

    // Default `topbar` variant — circular 44x44 button matching the
    // theme toggle and bell in the gov-topbar control cluster.
    return (
        <button
            type="button"
            data-testid="language-toggle"
            data-variant="topbar"
            onClick={handleClick}
            aria-label={ariaLabel}
            className={cn(
                'flex h-11 w-11 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2',
                className,
            )}
        >
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase">
                <Globe className="h-4 w-4" aria-hidden="true" focusable="false" />
                {buttonLabel}
            </span>
        </button>
    );
}
