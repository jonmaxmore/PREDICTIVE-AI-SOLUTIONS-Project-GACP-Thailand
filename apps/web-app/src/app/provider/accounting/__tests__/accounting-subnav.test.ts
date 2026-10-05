/**
 * H4 — accounting sub-nav + active-tab matching.
 *
 * The per-side tab filter (visibleAccountingTabs: DTAM saw only ar-aging) was
 * removed — operator 2026-09-11 "finance ต้องเห็นเหมือนกัน". This file now pins
 * the one tab set every viewer gets, and the active-tab matcher.
 */
import { describe, expect, it } from '@jest/globals';

import * as tabsModule from '../accounting-tabs';

const { ACCOUNTING_TABS, isAccountingTabActive } = tabsModule;

describe('[H4] ACCOUNTING_TABS — one set, no side filter', () => {
  it('lists all six accounting tabs', () => {
    expect(ACCOUNTING_TABS.map((t) => t.href)).toEqual([
      '/provider/accounting/ar-aging',
      '/provider/accounting/reports',
      '/provider/accounting/wht',
      '/provider/accounting/purchase-invoices',
      '/provider/accounting/manual-journal-entries',
      '/provider/accounting/period-close',
    ]);
  });

  it('no longer exports a side-based visibility filter', () => {
    expect((tabsModule as Record<string, unknown>).visibleAccountingTabs).toBeUndefined();
  });
});

describe('[H4] isAccountingTabActive', () => {
  it('index tab is active ONLY on the exact /provider/accounting path', () => {
    expect(isAccountingTabActive('/provider/accounting', '/provider/accounting')).toBe(true);
    // must NOT light up on a sub-route (would double-highlight with the sub-tab)
    expect(isAccountingTabActive('/provider/accounting', '/provider/accounting/ar-aging')).toBe(false);
  });

  it('sub-tabs are active by path prefix', () => {
    expect(isAccountingTabActive('/provider/accounting/ar-aging', '/provider/accounting/ar-aging')).toBe(true);
    expect(isAccountingTabActive('/provider/accounting/wht', '/provider/accounting')).toBe(false);
    expect(isAccountingTabActive('/provider/accounting/period-close', null)).toBe(false);
  });
});
