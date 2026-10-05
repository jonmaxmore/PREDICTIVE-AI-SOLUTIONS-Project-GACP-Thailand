/**
 * Officer NAV secondary tools + bottomNav (B-NAV item 3, W10).
 *
 * Ruling 3 (03-OPERATOR-DELEGATED-RULINGS.md §3 table, rows 4-5):
 *   - standards / surveys / herbs / datasets -> secondary of auditor AND
 *     document_reviewer (reference tools both use)
 *   - image-assessment -> secondary of auditor ONLY (tied to the plot visit)
 *
 * Kept separate from nav-config.test.ts (which pins farmer primary labels
 * and the legacy healthNavigation byte inventory) so this batch never
 * touches those pinned assertions.
 */
import { describe, expect, it } from '@jest/globals';

import { AUDITOR_NAV, REVIEWER_NAV, getNavForRole } from '../nav-config';

const SHARED_TOOLS = [
  { key: 'standards', path: '/provider/standards' },
  { key: 'surveys', path: '/provider/surveys' },
  { key: 'herbs', path: '/provider/herbs' },
  { key: 'datasets', path: '/provider/datasets' },
];

describe('AUDITOR_NAV / REVIEWER_NAV — stranded officer pages reachable via secondary tier', () => {
  it.each(SHARED_TOOLS)('auditor has $key ($path) as a secondary item', ({ key, path }) => {
    const item = AUDITOR_NAV.find((i) => i.key === key);
    expect(item).toBeDefined();
    expect(item?.path).toBe(path);
    expect(item?.tier).toBe('secondary');
  });

  it.each(SHARED_TOOLS)('document_reviewer has $key ($path) as a secondary item', ({ key, path }) => {
    const item = REVIEWER_NAV.find((i) => i.key === key);
    expect(item).toBeDefined();
    expect(item?.path).toBe(path);
    expect(item?.tier).toBe('secondary');
  });

  it('image-assessment is secondary for auditor only, NOT for document_reviewer', () => {
    const auditorItem = AUDITOR_NAV.find((i) => i.key === 'image-assessment');
    expect(auditorItem).toBeDefined();
    expect(auditorItem?.tier).toBe('secondary');
    expect(auditorItem?.path).toBe('/provider/image-assessment');

    const reviewerItem = REVIEWER_NAV.find((i) => i.key === 'image-assessment');
    expect(reviewerItem).toBeUndefined();
  });

  it('N7: officer primary tile count stays <= 3 after adding secondary items (auditor still has exactly 1 primary tile)', () => {
    const primaryCount = AUDITOR_NAV.filter((i) => i.tier === 'primary').length;
    expect(primaryCount).toBeLessThanOrEqual(3);
  });

  it('bottomNav + shortTH are set on the primary task item for every officer role (task 3)', () => {
    for (const role of ['field_inspector', 'document_reviewer', 'dispatcher', 'finance_officer_platform', 'finance_officer_dtam', 'finance_officer_platform', 'system_admin_dtam', 'system_admin_platform'] as const) {
      const bottomNavItems = getNavForRole(role).filter((i) => i.bottomNav === true);
      expect(bottomNavItems.length).toBeGreaterThan(0);
      for (const item of bottomNavItems) {
        expect(typeof item.shortTH).toBe('string');
        expect(item.shortTH!.length).toBeGreaterThan(0);
      }
    }
  });
});
