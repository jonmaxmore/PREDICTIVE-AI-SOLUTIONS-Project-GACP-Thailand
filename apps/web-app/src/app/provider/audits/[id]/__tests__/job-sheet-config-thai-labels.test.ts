/**
 * job-sheet-config-thai-labels.test.ts — X3-FIX-A / H-2 regression guard.
 *
 * Before X3 the provider-audit-job-sheet-config module shipped English
 * labels for every attachment row ("ID Card", "House Registration",
 * "Land Title", "GACP Certificate" …) and rendered date strings via
 * the unlocalised `Date.prototype.toLocaleString()` (which on the
 * server falls back to en-US / en-GB depending on the Node version).
 * The job sheet — AUDITOR's most-visited surface — therefore mixed
 * Thai page chrome with English document labels and English dates.
 *
 * X3-FIX-A localises:
 *   1. ATTACHMENT_KEYS labels (12 entries) — all Thai now.
 *   2. toDateText() — pinned to the 'th-TH' locale so output is
 *      consistent across server + client renders.
 *   3. getRevisionCountdownLabel() — "เกินกำหนด N วัน" /
 *      "ครบกำหนดภายใน N วัน" replaces "Overdue N day(s)" /
 *      "Due in N day(s)".
 *
 * These tests pin the contract via the exported source so a future
 * agent cannot silently revert.
 */

import { describe, expect, it } from '@jest/globals';
import {
    ATTACHMENT_KEYS,
    getRevisionCountdownLabel,
    toDateText,
} from '../provider-audit-job-sheet-config';

describe('[X3-FIX-A / H-2] provider-audit-job-sheet-config Thai labels', () => {
    describe('ATTACHMENT_KEYS — Thai document labels', () => {
        it('every entry uses Thai script for the human-facing label', () => {
            // Thai unicode block — at least one codepoint per label must
            // fall in [0x0E00..0x0E7F]. Allow trailing English in parens
            // (license codes are technical identifiers).
            const thaiRangeRegex = /[฀-๿]/;
            for (const entry of ATTACHMENT_KEYS) {
                expect(entry.label).toMatch(thaiRangeRegex);
            }
        });

        it('does NOT leak the legacy English labels (regression guard)', () => {
            const allLabels = ATTACHMENT_KEYS.map((e) => e.label).join('|');
            const legacy = [
                'ID Card',
                'House Registration',
                'Criminal Background Check',
                'Land Title',
                'Site Map',
                'Water Test',
                'Soil Test',
                'SOP Manual',
                'GACP Certificate',
            ];
            for (const en of legacy) {
                expect(allLabels).not.toContain(en);
            }
        });

        it('keeps the ภ.ท. licence codes (official identifiers) in the labels', () => {
            // ภ.ท. 09 / 10 / 11 are the official licence codes behind the three application
            // purposes — they MUST stay so reviewers can cross-reference paperwork.
            const allLabels = ATTACHMENT_KEYS.map((e) => e.label).join('|');
            expect(allLabels).toContain('ภ.ท. 11');
            expect(allLabels).toContain('ภ.ท. 09');
            expect(allLabels).toContain('ภ.ท. 10');
        });
    });

    describe('toDateText — Thai locale', () => {
        it('returns the literal dash for null / undefined', () => {
            expect(toDateText(null)).toBe('-');
            expect(toDateText(undefined)).toBe('-');
            expect(toDateText('')).toBe('-');
        });

        it('returns the literal dash for unparseable input', () => {
            expect(toDateText('not-a-date')).toBe('-');
        });

        it('treats the Unix epoch sentinel as "no date" (not "1/1/2513")', () => {
            // An unset scheduledDate can arrive as the epoch ISO string
            // rather than null — a *valid* Date, so the NaN guard lets it
            // through and th-TH renders "1/1/2513" (BE 1970). No GACP date
            // predates the 2025 launch, so anything < year 2000 is unset.
            // Seen live on the auditor CAR job-sheet header (staging UAT).
            expect(toDateText('1970-01-01T00:00:00.000Z')).toBe('-');
            expect(toDateText('1970-01-01T07:00:00+07:00')).toBe('-');
            expect(toDateText(new Date(0).toISOString())).toBe('-');
            // A real present-day date must still format (guard not over-broad).
            expect(toDateText('2026-06-16T09:00:00Z')).not.toBe('-');
        });

        it('uses the Thai locale for valid dates', () => {
            // The exact format depends on the host locale data but it
            // MUST round-trip through `toLocaleString('th-TH')` not the
            // bare `toLocaleString()`. We assert the public contract by
            // diffing the output against the canonical TH form.
            const iso = '2026-05-18T10:30:00Z';
            // Bangkok time, named (operator 2026-09-26): 17:30, not the
            // process clock's 10:30 on a UTC server.
            const expected = new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
            expect(expected).toContain('17:30');
            expect(toDateText(iso)).toBe(expected);
        });
    });

    describe('getRevisionCountdownLabel — Thai countdown copy', () => {
        it('returns null for null / unparseable input', () => {
            expect(getRevisionCountdownLabel(null)).toBeNull();
            expect(getRevisionCountdownLabel('not-a-date')).toBeNull();
        });

        it('uses Thai overdue copy for past dates', () => {
            // Two days in the past — diffDays should be negative.
            const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
            const result = getRevisionCountdownLabel(past);
            expect(result).not.toBeNull();
            expect(result!.text).toContain('เกินกำหนด');
            // Must not leak the legacy "Overdue N day(s)" phrasing.
            expect(result!.text).not.toContain('Overdue');
            expect(result!.color).toBe('red');
        });

        it('uses Thai upcoming-deadline copy for future dates', () => {
            // 5 days in the future — diffDays should be > 2.
            const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
            const result = getRevisionCountdownLabel(future);
            expect(result).not.toBeNull();
            expect(result!.text).toContain('ครบกำหนดภายใน');
            expect(result!.text).toContain('วัน');
            expect(result!.text).not.toContain('Due in');
            expect(result!.text).not.toContain('day(s)');
        });
    });
});
