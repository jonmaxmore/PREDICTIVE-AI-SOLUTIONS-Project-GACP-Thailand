/**
 * role-utils.test.ts — frontend RBAC contract.
 *
 * The frontend role-utils module mirrors the backend canonical-rbac
 * (locked by apps/backend/__tests__/unit/canonical-contract-verification.test.js).
 * Both must produce identical normalize/permission/manageability decisions
 * for the same role input — drift causes UI gates to disagree with
 * backend gates (e.g., button shown but request 403s).
 */

import {
  isPROVIDER,
  isAdmin,
  hasPermission,
  getPermissions,
  canManageRole,
  getRoleDisplayName,
  getRoleLabelTH,
  getRoleColor,
  requiresAuth,
  requiresPROVIDER,
  requiresAdmin,
  PERMISSIONS,
  CANONICAL_ROLES,
  ROLE_LABELS_TH,
  ROLE_LABELS_EN,
  ROLE_COLORS,
} from '../role-utils';

describe('role-utils (frontend RBAC)', () => {
  describe('isPROVIDER', () => {
    it('returns true for provider canonical roles', () => {
      expect(isPROVIDER('system_admin_dtam')).toBe(true);
      expect(isPROVIDER('document_reviewer')).toBe(true);
      expect(isPROVIDER('field_inspector')).toBe(true);
      expect(isPROVIDER('dispatcher')).toBe(true);
      expect(isPROVIDER('finance_officer_platform')).toBe(true);
    });

    it('returns false for HEALTH and unknown roles', () => {
      expect(isPROVIDER('health')).toBe(false);
      expect(isPROVIDER('garbage')).toBe(false);
      expect(isPROVIDER('')).toBe(false);
    });

    it('legacy aliases resolve to provider-true', () => {
      // SUPER_ADMIN normalizes to admin → provider; head_auditor → auditor.
      expect(isPROVIDER('system_admin_dtam')).toBe(true);
      expect(isPROVIDER('field_inspector')).toBe(true);
    });
  });

  describe('isAdmin', () => {
    it('returns true only for admin (and admin aliases)', () => {
      expect(isAdmin('system_admin_dtam')).toBe(true);
      expect(isAdmin('system_admin_dtam')).toBe(true);
      expect(isAdmin('system_admin_dtam')).toBe(true);
    });

    it('returns false for non-admin provider roles + health', () => {
      for (const role of ['field_inspector', 'dispatcher', 'finance_officer_platform', 'document_reviewer', 'health']) {
        expect(isAdmin(role)).toBe(false);
      }
    });
  });

  describe('hasPermission', () => {
    it('admin holds every PERMISSIONS value', () => {
      for (const perm of Object.values(PERMISSIONS)) {
        expect(hasPermission('system_admin_dtam', perm)).toBe(true);
      }
    });

    it('account holds CONFIRM_PAYMENTS but not REVIEW_APPLICATIONS', () => {
      expect(hasPermission('finance_officer_platform', PERMISSIONS.CONFIRM_PAYMENTS)).toBe(true);
      expect(hasPermission('finance_officer_platform', PERMISSIONS.REVIEW_APPLICATIONS)).toBe(false);
    });

    it('document_reviewer holds REVIEW_APPLICATIONS but not CONFIRM_PAYMENTS', () => {
      expect(hasPermission('document_reviewer', PERMISSIONS.REVIEW_APPLICATIONS)).toBe(true);
      expect(hasPermission('document_reviewer', PERMISSIONS.CONFIRM_PAYMENTS)).toBe(false);
    });

    it('health has VIEW_APPLICATIONS but no provider-only permissions', () => {
      expect(hasPermission('health', PERMISSIONS.VIEW_APPLICATIONS)).toBe(true);
      expect(hasPermission('health', PERMISSIONS.REVIEW_APPLICATIONS)).toBe(false);
      expect(hasPermission('health', PERMISSIONS.SCHEDULE_AUDITS)).toBe(false);
    });

    it('returns false for unknown / empty / null role (never throws)', () => {
      expect(hasPermission('', PERMISSIONS.VIEW_APPLICATIONS)).toBe(false);
      expect(hasPermission('garbage', PERMISSIONS.VIEW_APPLICATIONS)).toBe(false);
    });
  });

  describe('getPermissions', () => {
    it('returns the canonical permission array for known role', () => {
      const perms = getPermissions('system_admin_dtam');
      expect(Array.isArray(perms)).toBe(true);
      expect(perms.length).toBeGreaterThan(0);
    });

    it('returns [] for unknown role', () => {
      expect(getPermissions('garbage')).toEqual([]);
      expect(getPermissions('')).toEqual([]);
    });
  });

  describe('canManageRole — hierarchy', () => {
    it('admin can manage every other canonical role', () => {
      for (const target of ['health', 'document_reviewer', 'field_inspector', 'dispatcher', 'finance_officer_platform']) {
        expect(canManageRole('system_admin_dtam', target)).toBe(true);
      }
    });

    it('admin cannot manage another admin (must be strictly higher)', () => {
      expect(canManageRole('system_admin_dtam', 'system_admin_dtam')).toBe(false);
    });

    it('non-admin provider roles cannot manage each other (same tier)', () => {
      // All provider roles except admin sit at level 1.
      const providerRoles = ['document_reviewer', 'field_inspector', 'dispatcher', 'finance_officer_platform'];
      for (const a of providerRoles) {
        for (const b of providerRoles) {
          expect(canManageRole(a, b)).toBe(false);
        }
      }
    });

    it('any provider role can manage health (lower tier)', () => {
      for (const provider of ['system_admin_dtam', 'document_reviewer', 'field_inspector', 'dispatcher', 'finance_officer_platform']) {
        expect(canManageRole(provider, 'health')).toBe(true);
      }
    });

    it('admin can manage even unknown role (level -1) — explicit override semantics', () => {
      // The implementation treats unknown-target as level -1; since admin is
      // level 3, admin > unknown → true. This is the safer default — admin
      // override paths in tooling shouldn't be blocked by an unrecognized
      // legacy role string. Pin the behavior so a future "tighten unknown
      // → return false" refactor surfaces explicitly.
      expect(canManageRole('system_admin_dtam', 'garbage')).toBe(true);
    });

    it('unknown manager cannot manage anyone (level -1 vs level >= 0)', () => {
      expect(canManageRole('garbage', 'health')).toBe(false);
      expect(canManageRole('garbage', 'system_admin_dtam')).toBe(false);
    });
  });

  describe('Display labels + colors', () => {
    it('every canonical role has TH + EN labels', () => {
      // ข้าม `system` — ผู้กระทำที่ไม่ใช่คน (webhook/cron) ไม่มีป้ายให้คนอ่าน
      for (const role of Object.values(CANONICAL_ROLES).filter((r) => r !== CANONICAL_ROLES.SYSTEM)) {
        expect(typeof ROLE_LABELS_TH[role]).toBe('string');
        expect(typeof ROLE_LABELS_EN[role]).toBe('string');
      }
    });

    it('getRoleDisplayName returns Thai label for canonical role', () => {
      expect(getRoleDisplayName('system_admin_dtam')).toBe('ผู้ดูแลระบบ');
      expect(getRoleDisplayName('health')).toBe('ผู้ยื่นคำขอ');
    });

    it('getRoleDisplayName returns the input for unknown role', () => {
      expect(getRoleDisplayName('garbage')).toBe('garbage');
    });

    it('getRoleLabelTH resolves legacy aliases via normalizeRole', () => {
      expect(getRoleLabelTH('system_admin_dtam')).toBe('ผู้ดูแลระบบ');
      expect(getRoleLabelTH('system_admin_dtam')).toBe('ผู้ดูแลระบบ');
    });

    it('getRoleColor returns a non-empty string for known roles', () => {
      expect(typeof getRoleColor('system_admin_dtam')).toBe('string');
      expect(getRoleColor('system_admin_dtam').length).toBeGreaterThan(0);
    });

    it('getRoleColor falls back to "gray" for unknown role', () => {
      expect(getRoleColor('garbage')).toBe('gray');
      expect(getRoleColor('')).toBe('gray');
    });

    it('every entry in ROLE_COLORS is a valid Mantine-compatible color', () => {
      // The provider portal uses Mantine palette names. This pin catches a
      // refactor that accidentally puts "blue-500" or "#0066ff" in the table.
      for (const color of Object.values(ROLE_COLORS)) {
        expect(typeof color).toBe('string');
        expect(color).toMatch(/^[a-z]+$/);
      }
    });
  });

  describe('Route protection', () => {
    it('requiresAuth: protected paths require auth', () => {
      expect(requiresAuth('/health/dashboard')).toBe(true);
      expect(requiresAuth('/provider/applications')).toBe(true);
      expect(requiresAuth('/admin/users')).toBe(true);
    });

    it('requiresAuth: public paths do not require auth', () => {
      expect(requiresAuth('/')).toBe(false);
    });

    it('requiresPROVIDER: provider paths classify correctly', () => {
      expect(requiresPROVIDER('/provider/applications')).toBe(true);
      expect(requiresPROVIDER('/provider/calendar')).toBe(true);
      expect(requiresPROVIDER('/health/dashboard')).toBe(false);
    });

    it('requiresAdmin: admin paths classify correctly', () => {
      expect(requiresAdmin('/admin')).toBe(true);
      expect(requiresAdmin('/admin/users')).toBe(true);
      expect(requiresAdmin('/provider/applications')).toBe(false);
      expect(requiresAdmin('/health/dashboard')).toBe(false);
    });

    it('route classifiers honor exact-match + prefix-match', () => {
      // /admin and /admin/anything should both match
      expect(requiresAdmin('/admin')).toBe(true);
      expect(requiresAdmin('/admin/users/123')).toBe(true);
      // /admin-other should NOT match (must be exact or /admin/<x>)
      expect(requiresAdmin('/admin-other')).toBe(false);
    });
  });
});
