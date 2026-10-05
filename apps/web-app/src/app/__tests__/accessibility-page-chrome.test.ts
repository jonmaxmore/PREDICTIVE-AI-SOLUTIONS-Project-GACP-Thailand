import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two defects on the accessibility statement, both of which the page itself
 * makes promises about.
 *
 * 1. `prose prose-slate` was inert. `@tailwindcss/typography` was never
 *    installed and `tailwind.config.cjs` had `plugins: []`, so every prose
 *    class produced nothing: no paragraph spacing, headings ๑.–๗.
 *    indistinguishable from body text. The page was written against the plugin
 *    — it uses `not-prose` three times, an API only that plugin defines — so
 *    the markup had been waiting on a dependency that never arrived.
 *    Measured at 1440px: h2 margin 0 -> 48px/24px, p margin-bottom 0 -> 20px.
 *
 * 2. Two identical "ข้ามไปยังเนื้อหาหลัก" links sat in the tab order. The root
 *    layout renders one for every page and GovLayout rendered a second; in the
 *    App Router the root layout always wraps GovLayout, so the duplicate was
 *    unconditional. Measured on /accessibility: 2 skip anchors before, 1 after,
 *    with / and /help unchanged at 1 throughout.
 *
 * 3. `max-w-none` cancelled the plugin's 65ch measure, letting body copy run
 *    864px wide at 1440px. Now 589px.
 */

const WEB_APP = resolve(__dirname, '../../..');

function read(rel: string): string {
    return readFileSync(resolve(WEB_APP, rel), 'utf8');
}

describe('accessibility statement chrome', () => {
    it('registers the typography plugin the page is authored against', () => {
        const config = read('tailwind.config.cjs').replace(/^\s*\/\/.*$/gm, '');
        expect(config).toMatch(/plugins:\s*\[[^\]]*@tailwindcss\/typography/);

        const pkg = JSON.parse(read('package.json'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        // The lockfile alone is not enough — CI installs from the manifest.
        expect(deps['@tailwindcss/typography']).toBeDefined();
    });

    it('keeps the page inside the typography measure', () => {
        // The body moved to client-view.tsx when the page gained i18n:
        // `metadata` may only be declared by a server component, `useLanguage()`
        // only by a client one, so page.tsx keeps the metadata and the article
        // lives in the client view.
        const page = read('src/app/accessibility/client-view.tsx');
        const article = page.match(/<article className="([^"]*)"/);
        expect(article).not.toBeNull();
        expect(article![1]).toMatch(/\bprose\b/);
        expect(article![1]).not.toMatch(/\bmax-w-none\b/);
    });

    it('renders exactly one skip link per page', () => {
        // The root layout owns it; anything else rendering SkipToContent inside
        // that tree duplicates it, because the root layout wraps every route.
        // Comments are stripped from GovLayout first — its own docstring names
        // the element it deliberately no longer renders.
        const stripComments = (src: string) =>
            src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

        expect(stripComments(read('src/app/layout.tsx'))).toMatch(/<SkipToContent\s*\/>/);
        expect(stripComments(read('src/components/layout/GovLayout.tsx')))
            .not.toMatch(/<SkipToContent\s*\/>/);
    });
});
