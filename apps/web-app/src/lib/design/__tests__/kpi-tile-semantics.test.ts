/**
 * kpi-tile-semantics.test.ts — X3-FIX-B (M-3) regression.
 *
 * Pins the contract surface of `kpi-tile-semantics.ts` so future
 * refactors (e.g. renaming a tone, swapping a Tailwind class) cannot
 * silently break call-sites that import the colour map.
 *
 * The full migration of every KPI tile site to the `tone` prop is
 * deferred (X3.5 — see the comment block in the source file), so the
 * primary protection X3-FIX-B can deliver is locking the contract
 * itself: the 4 named tones, the 3-part className shape, and the
 * concept-to-tone defaults.
 */

import { describe, expect, it } from '@jest/globals';
import {
    KPI_TILE_CLASS_BY_TONE,
    KPI_TONE_BY_CONCEPT,
    type KpiTileTone,
} from '../kpi-tile-semantics';

describe('X3-FIX-B M-3 — KPI tile semantic colour contract', () => {
    it('exposes exactly the 4 documented tones', () => {
        const expected: KpiTileTone[] = ['success', 'warning', 'danger', 'info'];
        const actual = Object.keys(KPI_TILE_CLASS_BY_TONE).sort();
        expect(actual).toEqual(expected.sort());
    });

    it('every tone exposes container + eyebrow + value class strings', () => {
        for (const tone of Object.keys(KPI_TILE_CLASS_BY_TONE) as KpiTileTone[]) {
            const entry = KPI_TILE_CLASS_BY_TONE[tone];
            expect(typeof entry.container).toBe('string');
            expect(typeof entry.eyebrow).toBe('string');
            expect(typeof entry.value).toBe('string');
            // Every container is a rounded tile with a 4-unit pad.
            expect(entry.container).toMatch(/rounded-xl/);
            expect(entry.container).toMatch(/p-4/);
        }
    });

    it('success tone uses the gov-green primary palette', () => {
        // The success/approved tone must use `primary` (the
        // gov-gradient base) so it ties the KPI tile to the platform's
        // overall brand colour.
        const success = KPI_TILE_CLASS_BY_TONE.success;
        expect(success.container).toMatch(/border-primary\/10 bg-primary\/5/);
        expect(success.value).toMatch(/text-primary/);
    });

    it('warning tone uses the amber palette', () => {
        const warning = KPI_TILE_CLASS_BY_TONE.warning;
        expect(warning.container).toMatch(/border-amber-100 bg-amber-50/);
        expect(warning.value).toMatch(/text-amber-700/);
    });

    it('danger tone uses the rose palette (matches M-4 CAR finding swap)', () => {
        // The danger tone MUST be rose — same hue family as the CAR
        // findings panel after the M-4 swap, so the platform reads
        // consistently destructive everywhere it matters.
        const danger = KPI_TILE_CLASS_BY_TONE.danger;
        expect(danger.container).toMatch(/border-rose-100 bg-rose-50/);
        expect(danger.value).toMatch(/text-rose-700/);
    });

    it('info tone uses the blue palette', () => {
        const info = KPI_TILE_CLASS_BY_TONE.info;
        expect(info.container).toMatch(/border-blue-100 bg-blue-50/);
        expect(info.value).toMatch(/text-blue-700/);
    });

    it('concept-to-tone map routes destructive concepts to danger', () => {
        // Pin the most safety-critical concept routings — any future
        // edit that demotes "major finding" or "overdue" to a softer
        // tone has to update this test deliberately.
        expect(KPI_TONE_BY_CONCEPT.overdue).toBe('danger');
        expect(KPI_TONE_BY_CONCEPT.majorTriggers).toBe('danger');
        expect(KPI_TONE_BY_CONCEPT.failed).toBe('danger');
        expect(KPI_TONE_BY_CONCEPT.rejected).toBe('danger');
    });

    it('concept-to-tone map routes pending concepts to warning', () => {
        expect(KPI_TONE_BY_CONCEPT.pending).toBe('warning');
        expect(KPI_TONE_BY_CONCEPT.awaitingResult).toBe('warning');
    });

    it('concept-to-tone map routes approved concepts to success', () => {
        expect(KPI_TONE_BY_CONCEPT.approved).toBe('success');
        expect(KPI_TONE_BY_CONCEPT.passed).toBe('success');
        expect(KPI_TONE_BY_CONCEPT.auditPassedToday).toBe('success');
    });

    it('concept-to-tone map routes neutral scheduling concepts to info', () => {
        expect(KPI_TONE_BY_CONCEPT.scheduled).toBe('info');
        expect(KPI_TONE_BY_CONCEPT.scheduledToday).toBe('info');
        expect(KPI_TONE_BY_CONCEPT.scheduledThisWeek).toBe('info');
    });
});
