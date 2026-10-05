/**
 * provider-module-tabs.test.ts
 *
 * The bug this fixes.
 *
 * The provider portal's chrome (header, nav, footer) does not live in the Next
 * route layout — `provider/layout.tsx` renders only `<>{children}</>` and every
 * page imports a `ProviderLayout` *component* instead. Two modules also had a
 * real route-level `layout.tsx` whose job was to draw their tab bar. Next nests
 * a route layout ABOVE the page it wraps, so on /provider/accounting and
 * /provider/settings/* the module tab bar rendered above the global header:
 * measured live at sub-nav domIndex 31 / top:0 versus header domIndex 37 /
 * top:69, while a module without a sub-layout had the header first at
 * domIndex 29 / top:0.
 *
 * The eventual fix is to hoist the chrome into the route layout where it
 * belongs, but that means rewriting 92 `<ProviderLayout>` call sites and
 * finding another channel for the title/subtitle props 36 of them pass — its
 * own piece of work. Until then the rule has to be the other way round: if the
 * chrome is inside the page, the module tabs must be inside it too.
 *
 * So the tabs are derived from the pathname by `ProviderLayout` itself and the
 * two sub-layouts are gone. One place decides which tabs a route gets, no page
 * has to remember to wire anything, and a module page added tomorrow picks up
 * its tab bar — in the right position — for free.
 */

import { describe, expect, it } from '@jest/globals';

import { moduleTabsFor } from '../provider-module-tabs';

describe('moduleTabsFor', () => {
    it('returns nothing for a route that is not part of a tabbed module', () => {
        expect(moduleTabsFor('/provider/dashboard')).toBeNull();
        expect(moduleTabsFor('/provider/applications')).toBeNull();
        expect(moduleTabsFor(null)).toBeNull();
    });

    it('returns the accounting tabs on the accounting module', () => {
        const group = moduleTabsFor('/provider/accounting');
        expect(group).not.toBeNull();
        expect(group!.ariaLabel).toBe('เมนูบัญชี');
        expect(group!.tabs.map((t) => t.href)).toContain('/provider/accounting/ar-aging');
    });

    it('keeps the accounting tabs on a nested accounting page', () => {
        const group = moduleTabsFor('/provider/accounting/period-close');
        expect(group?.ariaLabel).toBe('เมนูบัญชี');
    });

    it('gives every viewer the same accounting tabs — no per-side filter (operator 2026-09-11)', () => {
        // เดิม: the DTAM lane saw only ar-aging (wht/period-close hidden).
        const hrefs = moduleTabsFor('/provider/accounting')!.tabs.map((t) => t.href);
        expect(hrefs).toContain('/provider/accounting/ar-aging');
        expect(hrefs).toContain('/provider/accounting/wht');
        expect(hrefs).toContain('/provider/accounting/period-close');
    });

    it('returns the settings tabs on the settings module', () => {
        const group = moduleTabsFor('/provider/settings/system');
        expect(group?.ariaLabel).toBe('เมนูตั้งค่า');
        expect(group!.tabs.map((t) => t.label)).toEqual(['ระบบ', 'คิวงาน']);
    });

    it('marks exactly the current tab as active', () => {
        const group = moduleTabsFor('/provider/accounting/ar-aging');
        const active = group!.tabs.filter((t) => t.isActive);
        expect(active).toHaveLength(1);
        expect(active[0]!.href).toBe('/provider/accounting/ar-aging');
    });

    it('does not mark a sibling tab active while on a different child page (prefix-collision guard)', () => {
        // '/provider/accounting' is a prefix of every accounting route, so a
        // naive startsWith would light up two tabs at once. Task 7 (N12
        // "ไม่มีเมนูตรวจสลิป") removed the index tab itself
        // (href='/provider/accounting') — the prefix-collision risk this
        // test guards against now lives between siblings (e.g. ar-aging vs
        // reports); pin that viewing one never also lights up another.
        const group = moduleTabsFor('/provider/accounting/reports');
        const active = group!.tabs.filter((t) => t.isActive);
        expect(active).toHaveLength(1);
        expect(active[0]!.href).toBe('/provider/accounting/reports');
    });

    it('labels every tab in Thai', () => {
        for (const pathname of ['/provider/accounting', '/provider/settings/system']) {
            const group = moduleTabsFor(pathname);
            for (const tab of group!.tabs) {
                expect(tab.label).not.toMatch(/[A-Za-z]{4,}/);
            }
        }
    });
});
