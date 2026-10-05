/**
 * Thai copy, checked on the rendered page rather than in the source.
 *
 * `scripts/ci/check-thai-copy-style.js` reads string literals. That is the
 * right place to enforce the rules, but it cannot see three things that only
 * exist once a browser has laid the page out:
 *
 *   - **Double spaces.** Removing an em dash from JSX text leaves the spaces
 *     that surrounded it. In a quoted string that is one space; across a JSX
 *     text node it can be two, and HTML collapses only *some* of those cases.
 *   - **Words run together.** Trimming a dash that sat against an element
 *     boundary can join the last word of a text node to the first word of the
 *     next element with no separator at all.
 *   - **Overflow.** Thai has no inter-word spaces, so a longer replacement
 *     phrase can push a container past the viewport where an em dash gave the
 *     line a break opportunity.
 *
 * So this walks the public surfaces, reads what the user would actually see,
 * and captures a screenshot of each for the record.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

// The sandbox pre-installs Chromium at a build the pinned @playwright/test does
// not expect, and downloading is blocked. Point at the binary that is here.
// Unset elsewhere, so CI keeps using its own managed browser.
if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    test.use({ launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } });
}

/** Public surfaces — no session needed, so this stays hermetic. */
const PAGES = [
    { path: '/', name: 'landing' },
    { path: '/help', name: 'help-centre' },
    { path: '/help/glossary', name: 'help-glossary' },
    { path: '/help/contact', name: 'help-contact' },
    { path: '/pricing', name: 'pricing' },
    { path: '/privacy-policy', name: 'privacy-policy' },
    { path: '/accessibility', name: 'accessibility' },
];

const THAI = '฀-๿';

/** Everything the user can actually read on the page. */
async function visibleText(page: Page): Promise<string> {
    return page.evaluate(() => document.body.innerText || '');
}

test.describe('Thai copy as rendered', () => {
    for (const target of PAGES) {
        test(`${target.name} obeys the Thai typography rules on screen`, async ({ page }, testInfo) => {
            const response = await page.goto(`${BASE}${target.path}`, { waitUntil: 'networkidle' });
            expect(response?.status(), `${target.path} should render`).toBeLessThan(400);

            await page.waitForTimeout(400);
            const text = await visibleText(page);
            expect(text.length, `${target.path} rendered no text`).toBeGreaterThan(50);

            const shot = await page.screenshot({ fullPage: true });
            await testInfo.attach(`${target.name}.png`, { body: shot, contentType: 'image/png' });

            // 1. No em dash anywhere near Thai text.
            const emDash = text.match(new RegExp(`[${THAI}][^\\n]{0,40}—|—[^\\n]{0,40}[${THAI}]`, 'g'));
            expect(emDash ?? [], `em dash rendered beside Thai on ${target.path}`).toEqual([]);

            // 2. ไม้ยมก always takes a space before it.
            const maiyamok = text.match(new RegExp(`[${THAI}]ๆ`, 'g'));
            expect(maiyamok ?? [], `ไม้ยมก with no preceding space on ${target.path}`).toEqual([]);

            // 3. No doubled space inside Thai text — the tell-tale of a dash
            //    removed without closing the gap it left.
            const doubleSpace = text.match(new RegExp(`[${THAI}]  +[${THAI}]`, 'g'));
            expect(doubleSpace ?? [], `double space inside Thai copy on ${target.path}`).toEqual([]);
        });
    }

    test('no page scrolls sideways at a phone width', async ({ page }) => {
        // Thai does not break between words, so a longer replacement phrase can
        // push a container wider than the screen. 390px is the iPhone width the
        // earlier mobile sweep used.
        await page.setViewportSize({ width: 390, height: 844 });
        const overflowing: string[] = [];

        for (const target of PAGES) {
            await page.goto(`${BASE}${target.path}`, { waitUntil: 'networkidle' });
            await page.waitForTimeout(300);
            const overflow = await page.evaluate(() =>
                document.documentElement.scrollWidth - document.documentElement.clientWidth);
            if (overflow > 1) {
                overflowing.push(`${target.path} (+${overflow}px)`);
            }
        }

        expect(overflowing, 'pages scroll horizontally at 390px').toEqual([]);
    });
});
