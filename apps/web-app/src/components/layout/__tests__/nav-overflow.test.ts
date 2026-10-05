/**
 * nav-overflow.test.ts
 *
 * The bug this fixes.
 *
 * The provider top nav renders up to 15 destinations in one horizontal row
 * inside `overflow-x-auto` with the scrollbar deliberately hidden
 * (`[scrollbar-width:none]` + `[&::-webkit-scrollbar]:hidden`, see
 * dashboard-layout.tsx). Measured live in Chromium as an ADMIN:
 *
 *     1280px — nav scrollWidth 1558 vs clientWidth 660: 9 items out of view
 *     1440px — 7 items out of view
 *     1920px — 3 items out of view
 *
 * The items pushed out at every width include ตั้งค่า and ผู้ดูแลระบบ. With no
 * scrollbar and no other affordance, an officer on a 1920px monitor has no way
 * to know those destinations exist, let alone reach them. The last visible item
 * is sliced mid-word, which reads as a rendering bug rather than an invitation
 * to scroll.
 *
 * That state came from the W3-B fix, which stopped the control cluster being
 * pushed off the painted bar (white text on a white page background, 1.08:1)
 * by making the nav scroll. It solved "invisible because the colours collide"
 * and introduced "invisible because it is past an edge nobody can see" — the
 * comment in that file claims the nav "scrolls inside the bar" and never
 * checked whether anything past the edge was reachable.
 *
 * The fix is measurement, not a bigger scroll area: whatever does not fit goes
 * into an explicit "เพิ่มเติม" menu that is always visible. Reachability then
 * holds at any viewport and any item count, and does not depend on a later
 * decision to reduce or regroup the destinations.
 *
 * `fitCount` is the whole decision, so it is tested here without a DOM.
 */

import { describe, expect, it } from '@jest/globals';

import { fitCount } from '../nav-overflow';

const OVERFLOW_BTN = 100;

describe('fitCount', () => {
    it('shows every item when they all fit', () => {
        expect(fitCount([100, 100, 100], 400, OVERFLOW_BTN)).toBe(3);
    });

    it('shows every item when they fit exactly, with no room to spare', () => {
        // The overflow button must NOT be reserved when it is not needed —
        // otherwise a nav that fits perfectly would still hide its last item.
        expect(fitCount([100, 100, 100], 300, OVERFLOW_BTN)).toBe(3);
    });

    it('reserves room for the overflow button once anything must be hidden', () => {
        // 4 items x 100 = 400 into 350: without the button 3 would fit, but the
        // button needs 100, so only 2 items can stay.
        expect(fitCount([100, 100, 100, 100], 350, OVERFLOW_BTN)).toBe(2);
    });

    it('handles the measured real case — 15 items, 660px of nav at 1280px', () => {
        // Average measured item width was ~104px (scrollWidth 1558 / 15).
        const items = Array.from({ length: 15 }, () => 104);
        const visible = fitCount(items, 660, OVERFLOW_BTN);
        expect(visible).toBeGreaterThan(0);
        expect(visible).toBeLessThan(15);
        // Whatever the split, the visible items plus the button must fit.
        expect(visible * 104 + OVERFLOW_BTN).toBeLessThanOrEqual(660);
    });

    it('returns 0 rather than a negative count when nothing fits', () => {
        expect(fitCount([300], 50, OVERFLOW_BTN)).toBe(0);
    });

    it('accounts for varying item widths, not an average', () => {
        // Thai labels differ a lot in width — ปฏิทิน vs ตรวจประเมินภาพ.
        expect(fitCount([50, 250, 50], 220, OVERFLOW_BTN)).toBe(1);
    });

    it('shows nothing but the button when not even one item can share the row', () => {
        // 250 available minus a 100 button leaves 150, and the first item is
        // 200. Everything goes to the menu rather than letting one item
        // overhang the edge — an item half off the bar is the exact failure
        // this whole mechanism exists to remove.
        expect(fitCount([200, 200], 250, OVERFLOW_BTN)).toBe(0);
    });

    it('treats an empty nav as fitting', () => {
        expect(fitCount([], 500, OVERFLOW_BTN)).toBe(0);
    });

    it('does not hide items when the container has not been measured yet', () => {
        // Width 0 means "not laid out yet". Hiding everything on the first
        // paint would flash an empty nav on every page load.
        expect(fitCount([100, 100], 0, OVERFLOW_BTN)).toBe(2);
    });
});
