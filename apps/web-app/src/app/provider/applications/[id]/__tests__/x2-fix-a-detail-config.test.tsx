/**
 * x2-fix-a-detail-config.test.tsx — X2-FIX-A (H-2, H-3, H-4) regression.
 *
 * Pure helper tests covering:
 *   - H-2: REVISION_CATEGORIES labels are Thai (matches surrounding modal).
 *   - H-3: DOCUMENT_FIELDS document names are Thai.
 *   - H-4: SLA labels Thai ("N วัน") + locale th-TH + revision countdown
 *          Thai ("เลย N วัน" / "เหลือ N วัน").
 *
 * Shape — pure functions imported directly from the config module; no
 * React rendering needed (per the project convention used by
 * approve-button-disabled.test.tsx and sla-aging-badge.test.tsx). The
 * date-arithmetic tests freeze Date.now() with jest fake timers for
 * deterministic boundaries.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
    DOCUMENT_FIELDS,
    REVISION_CATEGORIES,
    formatDate,
    getRevisionCountdown,
    getSlaDays,
} from '../provider-application-detail-config';

const FIXED_NOW = new Date('2026-05-18T10:00:00.000Z').getTime();

const daysAgoIso = (days: number) =>
    new Date(FIXED_NOW - days * 24 * 60 * 60 * 1000).toISOString();
const daysAheadIso = (days: number) =>
    new Date(FIXED_NOW + days * 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
});

afterEach(() => {
    jest.useRealTimers();
});

describe('X2-FIX-A H-2 — REVISION_CATEGORIES Thai labels', () => {
    it('exposes four canonical categories in stable order', () => {
        expect(REVISION_CATEGORIES.map((c) => c.value)).toEqual([
            'MISSING_DOCUMENT',
            'INVALID_DOCUMENT',
            'DATA_MISMATCH',
            'OTHER',
        ]);
    });

    it('labels every category in Thai (regression guard for EN→TH gap)', () => {
        const labels = REVISION_CATEGORIES.map((c) => c.label);
        // Every label must contain at least one Thai char.
        for (const label of labels) {
            expect(label).toMatch(/[฀-๿]+/);
        }
    });

    it('labels the four categories with the canonical Thai strings', () => {
        const byValue = Object.fromEntries(
            REVISION_CATEGORIES.map((c) => [c.value, c.label]),
        );
        expect(byValue.MISSING_DOCUMENT).toBe('เอกสารขาด');
        expect(byValue.INVALID_DOCUMENT).toBe('เอกสารไม่ถูกต้อง');
        expect(byValue.DATA_MISMATCH).toBe('ข้อมูลไม่ตรงกัน');
        expect(byValue.OTHER).toBe('อื่น ๆ');
    });

    it('does NOT leak the legacy English labels (regression guard)', () => {
        const labels = REVISION_CATEGORIES.map((c) => c.label).join(' | ');
        expect(labels).not.toMatch(/Missing document/);
        expect(labels).not.toMatch(/Invalid document/);
        expect(labels).not.toMatch(/Data mismatch/);
        // 'Other' is borderline (4-letter word) — match case-sensitively:
        expect(labels).not.toMatch(/\bOther\b/);
    });
});

describe('X2-FIX-A H-3 — DOCUMENT_FIELDS Thai names', () => {
    it('keeps the 15-entry document-checklist surface stable', () => {
        // The shape is consumed by the documents-tab-panel checklist;
        // dropping or re-ordering entries breaks the reviewer's
        // mental model. Lock the count + the canonical keys.
        expect(DOCUMENT_FIELDS).toHaveLength(15);
        expect(DOCUMENT_FIELDS.map((d) => d.key)).toEqual([
            'idCardDoc',
            'houseRegDoc',
            'criminalBgDoc',
            // the issued licence behind each purpose (operator ruling 2026-10-05)
            'LICENCE_PT09',
            'LICENCE_PT10',
            'LICENCE_PT11',
            'KRATOM_EXPORT_LICENCE',
            'LAND_TITLE',
            'SITE_MAP',
            'WATER_TEST',
            'SOIL_TEST',
            'SOP_MANUAL',
            'GACP_CERTIFICATE',
            'companyRegDoc',
            'communityRegDoc',
        ]);
    });

    it('labels every document name in Thai (regression guard)', () => {
        for (const doc of DOCUMENT_FIELDS) {
            expect(doc.name).toMatch(/[฀-๿]+/);
        }
    });

    it('uses canonical DTAM Thai names for the well-known documents', () => {
        const byKey = Object.fromEntries(
            DOCUMENT_FIELDS.map((d) => [d.key, d.name]),
        );
        expect(byKey.idCardDoc).toBe('บัตรประจำตัวประชาชน');
        expect(byKey.houseRegDoc).toBe('ทะเบียนบ้าน');
        expect(byKey.criminalBgDoc).toBe('หนังสือรับรองประวัติอาชญากรรม');
        expect(byKey.LICENCE_PT09).toBe('ใบอนุญาตให้ศึกษาวิจัยสมุนไพรควบคุม (ภ.ท. 09)');
        expect(byKey.LICENCE_PT10).toBe('ใบอนุญาตให้ส่งออกสมุนไพรควบคุมเพื่อการค้า (ภ.ท. 10)');
        expect(byKey.LICENCE_PT11).toBe('ใบอนุญาตให้จำหน่าย หรือแปรรูปสมุนไพรควบคุมเพื่อการค้า (ภ.ท. 11)');
        expect(byKey.GACP_CERTIFICATE).toBe('ใบประกาศนียบัตรอบรม GACP');
    });

    it('does NOT leak the legacy English document names', () => {
        const names = DOCUMENT_FIELDS.map((d) => d.name).join(' | ');
        expect(names).not.toMatch(/Citizen ID/);
        expect(names).not.toMatch(/House Registration/);
        expect(names).not.toMatch(/Criminal Record Check/);
        expect(names).not.toMatch(/PT\.11 License/);
        expect(names).not.toMatch(/Soil Test Result/);
    });
});

describe('X2-FIX-A H-4 — SLA labels + locale', () => {
    describe('formatDate', () => {
        it('returns "-" for missing or invalid input', () => {
            expect(formatDate(undefined)).toBe('-');
            expect(formatDate('')).toBe('-');
            expect(formatDate('not-a-date')).toBe('-');
        });

        it('uses Thai locale (th-TH) — verifiable by inverse of en-GB output', () => {
            const iso = '2026-05-18T10:00:00.000Z';
            // Bangkok time, named (operator 2026-09-26) — 17:00, whatever zone
            // the test process runs in.
            const expected = new Date(iso).toLocaleString('th-TH', {
                timeZone: 'Asia/Bangkok',
                dateStyle: 'medium',
                timeStyle: 'short',
            });
            expect(expected).toContain('17:00');
            const enGb = new Date(iso).toLocaleString('en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
            });
            const actual = formatDate(iso);
            expect(actual).toBe(expected);
            // Lock the regression — the production helper used en-GB
            // before X2-FIX-A. The Thai locale renders differently
            // (Buddhist year + Thai month) so the two strings must
            // diverge.
            expect(actual).not.toBe(enGb);
        });
    });

    describe('getSlaDays', () => {
        it('returns "-" for missing input', () => {
            expect(getSlaDays(undefined).label).toBe('-');
            expect(getSlaDays('').label).toBe('-');
            expect(getSlaDays('not-a-date').label).toBe('-');
        });

        it('formats the elapsed-days label in Thai (regression guard)', () => {
            const result = getSlaDays(daysAgoIso(3));
            expect(result.label).toBe('3 วัน');
            expect(result.danger).toBe(false);
        });

        it('flips the danger flag past the 5-day threshold (Thai label intact)', () => {
            const result = getSlaDays(daysAgoIso(7));
            expect(result.label).toBe('7 วัน');
            expect(result.danger).toBe(true);
        });

        it('does NOT leak the legacy "N days" English format', () => {
            const result = getSlaDays(daysAgoIso(4));
            expect(result.label).not.toMatch(/days?/i);
        });

        it('preserves split-on-space parseability for the SLA aging badge', () => {
            // getSlaAgingBadge in applications/page.tsx splits on " ":
            //   sla.label.split(' ')[0] → "5"
            // The Thai unit ("วัน") must remain space-separated for
            // that parsing path to keep working.
            const result = getSlaDays(daysAgoIso(5));
            const first = result.label.split(' ')[0];
            expect(Number.parseInt(first ?? '', 10)).toBe(5);
        });
    });

    describe('getRevisionCountdown', () => {
        it('returns null when dueAt missing or invalid', () => {
            expect(getRevisionCountdown(undefined)).toBeNull();
            expect(getRevisionCountdown(null)).toBeNull();
            expect(getRevisionCountdown('')).toBeNull();
            expect(getRevisionCountdown('not-a-date')).toBeNull();
        });

        it('emits Thai "เลย N วัน" + red color when overdue', () => {
            const result = getRevisionCountdown(daysAgoIso(3));
            expect(result).not.toBeNull();
            expect(result?.label).toBe('เลย 3 วัน');
            expect(result?.color).toBe('red');
        });

        it('emits Thai "เหลือ N วัน" + teal color when well within window', () => {
            const result = getRevisionCountdown(daysAheadIso(5));
            expect(result?.label).toMatch(/^เหลือ \d+ วัน$/);
            expect(result?.color).toBe('teal');
        });

        it('uses orange color when remaining ≤ 2 days (urgency cue)', () => {
            const result = getRevisionCountdown(daysAheadIso(1));
            expect(result?.label).toMatch(/^เหลือ \d+ วัน$/);
            expect(result?.color).toBe('orange');
        });

        it('does NOT leak the legacy English countdown copy', () => {
            const overdue = getRevisionCountdown(daysAgoIso(1));
            const upcoming = getRevisionCountdown(daysAheadIso(7));
            expect(overdue?.label).not.toMatch(/Overdue/i);
            expect(overdue?.label).not.toMatch(/day\(s\)/i);
            expect(upcoming?.label).not.toMatch(/Due in/i);
            expect(upcoming?.label).not.toMatch(/day\(s\)/i);
        });
    });
});
