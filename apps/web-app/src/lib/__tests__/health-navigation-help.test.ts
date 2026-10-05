/**
 * X1-FIX-C / H-4 — healthNavigation help entry regression guard.
 *
 * X1-A flagged that `/help` was not reachable from any operational HEALTH
 * page — applicants could only get there via the /onboarding button or by
 * typing the URL. The fix appends a `help` entry to `healthNavigation` so
 * DashboardLayout renders a Help link in the desktop nav alongside the
 * existing 6 items.
 *
 * Assertions:
 *   1. The array contains a `help` entry with href === '/help'.
 *   2. The help entry is APPENDED to the end of the array (we don't
 *      reorder existing items, which would break user muscle memory
 *      and stored-preference index-based defaults).
 *   3. The Thai label is 'ช่วยเหลือ' (per the X1-FIX-C scope).
 *   4. Existing items still appear in their original order.
 */

import { describe, expect, it } from '@jest/globals';

import { healthNavigation } from '../constants';

describe('[X1-FIX-C / H-4] healthNavigation — help entry', () => {
    it('contains a help entry pointing at /help', () => {
        const help = healthNavigation.find((item) => item.key === 'help');
        expect(help).toBeDefined();
        expect(help!.href).toBe('/help');
    });

    it('uses the Thai label ช่วยเหลือ', () => {
        const help = healthNavigation.find((item) => item.key === 'help');
        expect(help!.label).toBe('ช่วยเหลือ');
    });

    it('appends the help entry to the END of the array (existing order preserved)', () => {
        // The pre-existing order — every other consumer of healthNavigation
        // (DashboardLayout, the mobile-bottom-nav slicer, etc.) depends on
        // this being stable. Adding `help` anywhere but the end is a
        // regression.
        const keys = healthNavigation.map((item) => item.key);
        expect(keys).toEqual([
            'dashboard',
            'applications',
            'payments',
            'certificates',
            'planting',
            'profile',
            // Wave A chunk 5 (2026-07-02): workspaces entry inserted before
            // help — help remains the LAST item per this guard's intent.
            'workspaces',
            // C05F680149 ต้นแบบที่ 2 (2026-07-10): surveys entry inserted
            // before help — help remains the LAST item per this guard.
            'surveys',
            // C05F680149 ต้นแบบที่ 5 (2026-07-10): herbs entry inserted before
            // help — help remains the LAST item per this guard.
            'herbs',
            'help',
        ]);
    });

    it('exposes an icon component on the help entry (DashboardLayout calls <item.Icon />)', () => {
        const help = healthNavigation.find((item) => item.key === 'help');
        expect(help!.icon).toBeDefined();
        // It must be a function or a forwardRef object — both render as a
        // React component. The lucide-react `HelpCircle` we picked is a
        // forwardRef ($$typeof) object, so just assert truthy + non-null.
        expect(typeof help!.icon === 'function' || typeof help!.icon === 'object').toBe(true);
    });
});
