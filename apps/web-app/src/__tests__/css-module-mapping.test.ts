import { describe, expect, it } from '@jest/globals';

/**
 * Two independent defects in the jest CSS wiring, both silent because nothing
 * under test had reached a stylesheet yet.
 *
 * 1. `jest.config.mjs` maps every CSS import to `identity-obj-proxy`, which was
 *    neither installed nor declared in package.json. Same shape as the
 *    @tailwindcss/typography gap on the accessibility statement: config
 *    pointing at a dependency that was never added.
 *
 * 2. The CSS pattern sat BELOW `'^@/(.*)$'` in moduleNameMapper. Jest applies
 *    the first matching pattern and does not chain, so `@/styles/x.css`
 *    resolved to the real file and jest parsed CSS as JavaScript
 *    ("SyntaxError: Invalid or unexpected token"). The app imports CSS both
 *    ways -- `./globals.css` in app/layout.tsx and
 *    `@/styles/provider-styles.css` in the print view and clear-session page --
 *    so only the relative form was ever covered.
 *
 * Both import shapes are exercised here; fixing one without the other leaves
 * half the app's stylesheets unmockable in tests.
 */

import aliased from '@/styles/globals.css';
import relative from '../styles/globals.css';

describe('CSS imports resolve through the jest module mapper', () => {
    it('maps an aliased @/ stylesheet import', () => {
        expect(aliased).toBeDefined();
    });

    it('maps a relative stylesheet import', () => {
        expect(relative).toBeDefined();
    });

    it('returns each requested class name unchanged', () => {
        // identity-obj-proxy's contract: any key reads back as its own name, so
        // `className={styles.foo}` renders "foo" under test instead of undefined.
        expect((aliased as Record<string, string>).govAuthPage).toBe('govAuthPage');
        expect((relative as Record<string, string>).anythingAtAll).toBe('anythingAtAll');
    });
});
