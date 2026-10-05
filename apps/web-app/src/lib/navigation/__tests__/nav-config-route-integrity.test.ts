/**
 * nav-config route integrity guard (B-NAV item 4, W10).
 *
 * The class of bug this guards against: Task 7's nav-integrity fix
 * (see nav-config.ts's AUDITOR_NAV/REVIEWER_NAV/ADMIN_NAV comments) found
 * THREE nav items pointing at routes that never existed
 * (/provider/appointments, /provider/audit-history, /provider/review,
 * /admin/reports) — caught only by manual inspection, not by any test.
 * `scripts/system-integrity-check.js` §8b checks this too (text-parsing
 * nav-config.ts, run as a pre-commit/CI script) — this jest test covers
 * the same property so it also runs in the normal `jest` suite and fails
 * loudly with a stack trace instead of a console script's exit code.
 *
 * Two properties, for EVERY canonical role nav-config knows about:
 *   1. every {key, path} resolves to a real Next.js page file under src/app
 *   2. the role's nav array is never empty
 */
import { describe, expect, it } from '@jest/globals';
import { existsSync } from 'fs';
import { join } from 'path';

import {
  ALL_NAV_ARRAYS,
  getNavForRole,
  type NavItem,
} from '../nav-config';

// src/app lives at ../../../app relative to this test file
// (src/lib/navigation/__tests__/ -> src/app).
const APP_DIR = join(__dirname, '..', '..', '..', 'app');
const PAGE_FILENAMES = ['page.tsx', 'page.ts', 'page.jsx', 'page.js'];

function pageExistsFor(navPath: string): boolean {
  const rel = navPath.replace(/^\//, '');
  const base = join(APP_DIR, ...rel.split('/'));
  return PAGE_FILENAMES.some((f) => existsSync(join(base, f)));
}

const KNOWN_ROLES = [
  'health',
  'field_inspector',
  'document_reviewer',
  'dispatcher',
  'finance_officer_platform',
  'finance_officer_dtam',
  'finance_officer_platform',
  'system_admin_dtam',
  'system_admin_platform',
] as const;

describe('nav-config route integrity (B-NAV item 4)', () => {
  it('every {key, path} across every NAV array resolves to a real page.tsx under src/app', () => {
    const allItems: NavItem[] = ALL_NAV_ARRAYS.flat();
    expect(allItems.length).toBeGreaterThan(0);

    const missing = allItems
      .filter((item) => !pageExistsFor(item.path))
      .map((item) => `${item.key} -> ${item.path}`);

    expect(missing).toEqual([]);
  });

  it('every known role resolves to a non-empty nav array', () => {
    const empty = KNOWN_ROLES.filter((role) => getNavForRole(role).length === 0);
    expect(empty).toEqual([]);
  });

  it('an unrecognized role still resolves to [] (not an error) — sanity check the emptiness test above is not vacuous', () => {
    expect(getNavForRole('not_a_real_role')).toEqual([]);
    expect(getNavForRole(null)).toEqual([]);
    expect(getNavForRole(undefined)).toEqual([]);
  });
});
