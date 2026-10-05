'use client';

import { useLanguage } from '@/lib/i18n/language-context';

/**
 * The skip-to-content link, split out of GovLayout so it can follow the
 * language.
 *
 * GovLayout is a server component and the language lives in localStorage,
 * so the layout itself cannot read it. This was the last Thai string left
 * on an English screen — on every route, since GovLayout wraps them all.
 * Extracting one small client component is enough; converting the whole
 * layout would have pulled every page it wraps into the client bundle for
 * the sake of eleven words.
 */
export function SkipToContent() {
    const { dict } = useLanguage();
    return (
        <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-blue-800 focus:underline focus:ring-2 focus:ring-blue-800"
        >
            {dict.common.skipToContent}
        </a>
    );
}
