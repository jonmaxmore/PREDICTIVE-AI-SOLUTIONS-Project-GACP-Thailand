'use client';

/**
 * RootLangUpdater — W3-D (Iter W3)
 *
 * Reactive `<html lang>` updater. The SSR/initial-render `<html lang="th">`
 * stays static in `app/layout.tsx` so hydration matches between server +
 * client (Option A per `docs/handoffs/iter-W3/00-rfc.md` §W3-D). Once the
 * client mounts, this component reads `useLanguage().language` and mirrors
 * it onto `document.documentElement.lang`. When the user flips the language
 * picker, the effect re-runs and updates the DOM attribute so assistive
 * tech announces the right language (WCAG 2.1 SC 3.1.1 — Language of Page,
 * 3.1.2 — Language of Parts).
 *
 * Behaviour contract:
 *   - SSR-safe: returns null and does nothing on the server.
 *   - Hydration-safe: the `lang="th"` on `<html>` from SSR matches the
 *     initial client state (LanguageProvider defaults to 'th' before
 *     localStorage hydrates), so React does not warn about a mismatch.
 *   - Effect-only: never renders DOM; mirrors language state into the
 *     existing `<html>` element imperatively via
 *     `document.documentElement.setAttribute('lang', ...)`.
 *
 * Mount inside `<LanguageProvider>` (see `app/providers.tsx`) so the
 * `useLanguage()` hook resolves. Mounted in `app/layout.tsx` next to
 * `<Toaster />` inside the `<ConfigProvider>` tree (already nested under
 * Providers, which wraps LanguageProvider).
 *
 * Pattern mirrors `components/runtime/pwa-service-worker-guard.tsx` —
 * single `useEffect`, no JSX output.
 */

import { useEffect } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

export function RootLangUpdater() {
    const { language } = useLanguage();

    useEffect(() => {
        if (typeof document === 'undefined') {
            return;
        }
        const root = document.documentElement;
        if (root.getAttribute('lang') !== language) {
            root.setAttribute('lang', language);
        }
    }, [language]);

    return null;
}

export default RootLangUpdater;
