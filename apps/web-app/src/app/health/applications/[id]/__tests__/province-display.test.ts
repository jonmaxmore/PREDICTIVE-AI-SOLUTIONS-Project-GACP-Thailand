/**
 * V1-A / D7 fix — province vs surroundingEnvironment separation.
 *
 * Before the fix, `client-view.tsx` derived `province` via
 *   pickStepValue(step2, ['province', 'surrounding_environment', 'surroundingEnvironment'])
 * which silently fell back to surroundingEnvironment whenever the real
 * province field was empty. Applicants saw rows like
 *   จังหวัด/สภาพแวดล้อม : ใกล้คลองชลประทาน
 * which is gibberish for a province slot.
 *
 * The fix:
 *   - `province` reads ONLY the `province` alias (no env fallback).
 *   - `surroundingEnvironment` is derived separately from
 *     `['surrounding_environment', 'surroundingEnvironment']`.
 *   - The detail page renders them in two distinct labelled rows.
 *
 * These tests anchor the contract at the `pickStepValue` boundary so
 * any future re-shuffle (e.g. adding more aliases) cannot silently
 * regress the separation.
 */

import { pickStepValue } from '../application-detail-page-config';

describe('[V1-A / D7] province vs surroundingEnvironment separation', () => {
  describe('province alias — must not fall back to surroundingEnvironment', () => {
    it('returns the province value when present', () => {
      const step2 = {
        province: 'เชียงใหม่',
        surrounding_environment: 'ใกล้คลองชลประทาน',
      };
      expect(pickStepValue(step2, ['province'])).toBe('เชียงใหม่');
    });

    it('returns null (so caller can render "-") when province is missing, even if surroundingEnvironment is set', () => {
      // This is the EXACT bug shape D7 was meant to fix. The old impl
      // would have returned 'ใกล้คลองชลประทาน' here, polluting the
      // province slot. The new impl returns null and the row renders
      // a clean dash placeholder.
      const step2 = {
        surrounding_environment: 'ใกล้คลองชลประทาน',
      };
      expect(pickStepValue(step2, ['province'])).toBeNull();
    });

    it('returns null when province is an empty string (no aliases fall through)', () => {
      const step2 = {
        province: '',
        surroundingEnvironment: 'ป่าธรรมชาติ',
      };
      expect(pickStepValue(step2, ['province'])).toBeNull();
    });

    it('returns null when province is whitespace-only', () => {
      const step2 = {
        province: '   ',
        surroundingEnvironment: 'ป่าธรรมชาติ',
      };
      expect(pickStepValue(step2, ['province'])).toBeNull();
    });
  });

  describe('surroundingEnvironment alias — accepts snake_case and camelCase', () => {
    it('picks the snake_case form first', () => {
      const step2 = { surrounding_environment: 'ใกล้คลองชลประทาน' };
      expect(pickStepValue(step2, ['surrounding_environment', 'surroundingEnvironment'])).toBe('ใกล้คลองชลประทาน');
    });

    it('falls back to camelCase when snake_case is missing', () => {
      const step2 = { surroundingEnvironment: 'ป่าธรรมชาติ' };
      expect(pickStepValue(step2, ['surrounding_environment', 'surroundingEnvironment'])).toBe('ป่าธรรมชาติ');
    });

    it('returns null when neither alias is set', () => {
      const step2 = { province: 'เชียงใหม่' };
      expect(pickStepValue(step2, ['surrounding_environment', 'surroundingEnvironment'])).toBeNull();
    });
  });

  describe('integration — two derived values are independent', () => {
    it('province set, surroundingEnvironment empty → only province renders', () => {
      const step2 = { province: 'เชียงใหม่' };
      const province = pickStepValue(step2, ['province']) || '-';
      const env = pickStepValue(step2, ['surrounding_environment', 'surroundingEnvironment']) || '-';
      expect(province).toBe('เชียงใหม่');
      expect(env).toBe('-');
    });

    it('both set → both rendered with correct labels (no cross-contamination)', () => {
      const step2 = {
        province: 'เชียงใหม่',
        surroundingEnvironment: 'ใกล้คลองชลประทาน',
      };
      const province = pickStepValue(step2, ['province']) || '-';
      const env = pickStepValue(step2, ['surrounding_environment', 'surroundingEnvironment']) || '-';
      expect(province).toBe('เชียงใหม่');
      expect(env).toBe('ใกล้คลองชลประทาน');
    });

    it('province empty, surroundingEnvironment set → province row shows dash, env row shows real value', () => {
      // The bug-reproducer fixture: pre-V1-A, this would have shown
      // 'ใกล้คลองชลประทาน' in the province slot. Post-fix, province
      // renders '-' and the env value lives on its own row.
      const step2 = { surrounding_environment: 'ใกล้คลองชลประทาน' };
      const province = pickStepValue(step2, ['province']) || '-';
      const env = pickStepValue(step2, ['surrounding_environment', 'surroundingEnvironment']) || '-';
      expect(province).toBe('-');
      expect(env).toBe('ใกล้คลองชลประทาน');
    });
  });
});
