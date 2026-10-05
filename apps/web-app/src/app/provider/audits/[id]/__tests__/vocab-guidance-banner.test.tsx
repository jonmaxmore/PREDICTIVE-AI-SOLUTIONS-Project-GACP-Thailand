/**
 * vocab-guidance-banner.test.tsx — X3-FIX-A / H-1 architectural-note guard.
 *
 * Background — H-1 finding: the AUDITOR can submit a decision from two
 * surfaces with conflicting vocabularies:
 *   - "เครื่องมือภาคสนาม" / inspect → PASS / FAIL / NEEDS_REVIEW
 *   - "Job Sheet" decision modal     → PASS / MINOR / MAJOR
 * Same application; no UI guidance. State-divergence risk.
 *
 * Full vocab unification needs (1) product decision on canonical 3- vs
 * 5-state outcome, (2) backend migration of historical decisions, (3)
 * state-machine refactor — post-Loop-X. For X3 we surface a non-
 * blocking advisory banner so AUDITOR picks the right path. role="note"
 * (NOT role="alert" — informational, not error).
 *
 * This test reads the source of audits/[id]/page.tsx directly (the
 * component itself depends on heavy router + apiClient mocks that
 * blow the SSR pass; source-string inspection is the established
 * pattern for this kind of static-contract pin — see inspect-tap-
 * targets.test.tsx).
 */

import { describe, expect, it } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path') as typeof import('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'page.tsx'),
    'utf8',
);

// Y1-FIX-C migrated banner copy to dict.provider.audits.detail.vocabBanner.
// Source-grep tests below that check user-visible Thai copy must now read
// the dict file, not page.tsx (page.tsx references `dDict?.vocabBanner`).
const TH_PROVIDER_DICT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../../../../lib/i18n/dictionaries/sections/th-provider.ts'),
    'utf8',
);

describe('[X3-FIX-A / H-1] audits/[id]/page.tsx — vocab guidance banner', () => {
    it('declares the banner with role="note" and the X3 data-testid', () => {
        // The testid pins the banner so a future tab-refactor can't
        // remove it silently. role="note" (informational) — NOT
        // role="alert" (errors only).
        const idx = SRC.indexOf('audit-vocab-guidance-banner');
        expect(idx).toBeGreaterThanOrEqual(0);
        const chunk = SRC.slice(idx - 600, idx + 1200);
        expect(chunk).toContain('role="note"');
        expect(chunk).not.toContain('role="alert"');
    });

    it('uses the amber/yellow advisory tone (NOT rose/red error tone)', () => {
        const idx = SRC.indexOf('audit-vocab-guidance-banner');
        const chunk = SRC.slice(idx - 200, idx + 1000);
        // Amber background — informational, not destructive.
        expect(chunk).toContain('bg-amber-50');
        // Rose would mean error — explicitly NOT used.
        expect(chunk).not.toContain('bg-rose-50');
    });

    it('explains both decision-flow vocabularies in the Thai copy (dict-driven post Y1-FIX-C)', () => {
        // Both vocabularies must be enumerated so AUDITOR sees the
        // distinction at a glance. Y1-FIX-C migrated the literal copy
        // from page.tsx to dict.provider.audits.detail.vocabBanner — so
        // we now assert the dict, not the page source.
        expect(TH_PROVIDER_DICT_SRC).toContain('PASS/FAIL/NEEDS_REVIEW');
        expect(TH_PROVIDER_DICT_SRC).toContain('PASS/MINOR/MAJOR');
        // The two surfaces must be named.
        expect(TH_PROVIDER_DICT_SRC).toContain('เครื่องมือภาคสนาม');
        expect(TH_PROVIDER_DICT_SRC).toContain('Job Sheet');
        // The closing instruction.
        expect(TH_PROVIDER_DICT_SRC).toContain('กรุณาตรวจสอบให้ตรงกับชนิดงาน');
        // Page.tsx still wires to the dict (so a rename of the dict key
        // would break this).
        expect(SRC).toMatch(/vocabBanner/);
    });

    it('localizes the notebook-tab triggers to Thai', () => {
        // H-2 sub-fix: the same page.tsx had English tab labels
        // ("Application", "Review History", "Audit Record"). X3-FIX-A
        // ports them to Thai. Source-string check is sufficient.
        expect(SRC).toContain('ข้อมูลคำขอ');
        expect(SRC).toContain('ประวัติการตรวจ');
        expect(SRC).toContain('บันทึกการตรวจ');
        expect(SRC).toContain('เครื่องมือภาคสนาม');
        // Legacy English labels must be gone.
        expect(SRC).not.toMatch(/>\s*Application\s*</);
        expect(SRC).not.toContain('Review History');
        expect(SRC).not.toContain('Audit Record');
    });
});
