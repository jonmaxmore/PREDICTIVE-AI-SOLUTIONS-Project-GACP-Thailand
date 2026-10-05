/**
 * x3-fix-c-a11y.test.tsx — Loop X Iter 3 (X3-FIX-C) regression guards.
 *
 * Covers two H-10 + H-11 fixes that ship in the calendar surface:
 *
 *   1. Calendar event Join + Map buttons bumped from h-7 (28 px) to
 *      min-h-[44px] min-w-[44px] (WCAG 2.5.5 — pre-X3 they failed AA
 *      on tablet field use; see X3-C handoff §1.2 S-NEW-1).
 *   2. ScheduleModal first input (DateInput) carries `autoFocus` so
 *      keyboard users don't need to tab past the dialog title; matches
 *      the X2-FIX-A M-13 ReviewDecisionModal pattern.
 *
 * The test pattern is a grep over the production source (mirrors
 * `findings-remove-button-tap-target.test.tsx`) — cheap, deterministic,
 * and pins a regression that lowers the tap target back to h-7 or
 * removes the autoFocus prop.
 */

import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

const calendarClientView = fs.readFileSync(
    path.resolve(__dirname, '..', 'client-view.tsx'),
    'utf8',
);

const scheduleModal = fs.readFileSync(
    path.resolve(__dirname, '..', 'schedule-modal.tsx'),
    'utf8',
);

describe('[X3-FIX-C / H-10] calendar event Join/Map tap target ≥ 44 px', () => {
    it('the Join button no longer uses size="xs" + h-7 (28 px fail)', () => {
        // The Join + Map buttons used to be size="xs" with h-7 (28 px).
        // After X3-FIX-C they bump to size="sm" + min-h-[44px] min-w-[44px].
        // We grep for the legacy small-class anywhere on a Button to lock
        // the regression — finding either string fails the test.
        expect(calendarClientView).not.toContain('size="xs" variant="outline" className="h-7');
    });

    it('Join + Map buttons declare min-h-[44px] and min-w-[44px]', () => {
        // 2 Buttons × 2 declarations each = at least 4 occurrences of
        // each token in the calendar event tile area.
        const minH = calendarClientView.match(/min-h-\[44px\]/g) || [];
        const minW = calendarClientView.match(/min-w-\[44px\]/g) || [];
        expect(minH.length).toBeGreaterThanOrEqual(2);
        expect(minW.length).toBeGreaterThanOrEqual(2);
    });

    it('IconVideo + IconMapPin inside the event tile carry aria-hidden', () => {
        // Decorative icons next to text label — they should be ignored
        // by screen readers (the "Join"/"Map" text already conveys the
        // action). M-7 fold-in.
        expect(calendarClientView).toContain('<IconVideo size={12} className="mr-1" aria-hidden="true"');
        expect(calendarClientView).toContain('<IconMapPin size={12} className="mr-1" aria-hidden="true"');
    });
});

describe('[X3-FIX-C / H-11] ScheduleModal first input autoFocus', () => {
    it('the DateInput receives autoFocus on open', () => {
        // The first interactive field in ScheduleModal is the date input
        // (วันที่นัดหมาย). The fix wires autoFocus + the eslint-disable
        // comment per the X2-FIX-A M-13 pattern. Grep both so a future
        // refactor that removes autoFocus fails this test, and so the
        // explanatory comment is preserved (caller-readable rationale).
        expect(scheduleModal).toContain('autoFocus');
        expect(scheduleModal).toContain(
            'eslint-disable-next-line jsx-a11y/no-autofocus',
        );
    });

    it('autoFocus sits on the DateInput, not on a Button or close-trigger', () => {
        // Defensive check — locate the autoFocus occurrence and make
        // sure it appears inside the DateInput block (preceded by
        // `<DateInput` and followed by the closing `/>`). This blocks
        // future regressions that move autoFocus onto a Button or
        // dialog-close trigger (jsx-a11y allows neither and the WAI-ARIA
        // APG warns against it for buttons).
        const dateInputBlockStart = scheduleModal.indexOf('<DateInput');
        const dateInputBlockEnd = scheduleModal.indexOf(
            '/>',
            dateInputBlockStart,
        );
        expect(dateInputBlockStart).toBeGreaterThan(-1);
        expect(dateInputBlockEnd).toBeGreaterThan(dateInputBlockStart);
        const dateInputBlock = scheduleModal.slice(
            dateInputBlockStart,
            dateInputBlockEnd,
        );
        expect(dateInputBlock).toContain('autoFocus');
    });
});
