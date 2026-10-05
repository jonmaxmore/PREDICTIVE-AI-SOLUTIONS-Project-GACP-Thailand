/**
 * Role-Based Access Control (RBAC)
 *
 * Centralized role and permission helpers for web route guards.
 * Delegates to canonical-roles.ts for normalization — single source of truth.
 */

import {
    CANONICAL_ROLES,
    normalizeRole,
    isProviderRole,
    type CanonicalRole,
} from './constants/canonical-roles';
import {
    HEALTH_LOGIN_ROUTE,
    LEGACY_HEALTH_LOGIN_ROUTE,
    PROVIDER_LOGIN_ROUTE,
    REGISTER_ROUTE,
} from './constants/auth-routes';

// Re-export canonical utilities so consumers don't need two imports
export { CANONICAL_ROLES, normalizeRole, isProviderRole };
export type { CanonicalRole };

// LEGACY ROLE CONSTANTS (match database/JWT wire format — uppercase)

/** Legacy uppercase role values as stored in the database / JWT. */
export const ROLES = {
    HEALTH: 'HEALTH',
    REVIEWER_AUDITOR: 'REVIEWER_AUDITOR',
    SCHEDULER: 'SCHEDULER',
    ACCOUNTANT: 'ACCOUNTANT',
    ADMIN: 'ADMIN',
    SUPER_ADMIN: 'SUPER_ADMIN',
} as const;

export type LegacyRole = typeof ROLES[keyof typeof ROLES];

// Provider roles for access control (legacy uppercase)
export const PROVIDER_ROLES: LegacyRole[] = [
    ROLES.REVIEWER_AUDITOR,
    ROLES.SCHEDULER,
    ROLES.ACCOUNTANT,
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
];

// Admin roles (can manage other provider roles)
export const ADMIN_ROLES: LegacyRole[] = [
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
];

// PERMISSION DEFINITIONS

export const PERMISSIONS = {
    VIEW_APPLICATIONS: 'view_applications',
    REVIEW_APPLICATIONS: 'review_applications',
    APPROVE_APPLICATIONS: 'approve_applications',
    VIEW_CALENDAR: 'view_calendar',
    MANAGE_CALENDAR: 'manage_calendar',
    SCHEDULE_AUDITS: 'schedule_audits',
    VIEW_INVOICES: 'view_invoices',
    CREATE_INVOICES: 'create_invoices',
    CONFIRM_PAYMENTS: 'confirm_payments',
    VIEW_CERTIFICATES: 'view_certificates',
    ISSUE_CERTIFICATES: 'issue_certificates',
    VIEW_REPORTS: 'view_reports',
    EXPORT_REPORTS: 'export_reports',
    VIEW_USERS: 'view_users',
    MANAGE_USERS: 'manage_users',
    MANAGE_PROVIDER: 'manage_PROVIDER',
    VIEW_AUDIT_LOGS: 'view_audit_logs',
    SYSTEM_SETTINGS: 'system_settings',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// ROLE-PERMISSION MAPPING (uses canonical roles internally)

const CANONICAL_ROLE_PERMISSIONS: Record<string, Permission[]> = {
    [CANONICAL_ROLES.HEALTH]: [
        PERMISSIONS.VIEW_APPLICATIONS,
        PERMISSIONS.VIEW_INVOICES,
        PERMISSIONS.VIEW_CERTIFICATES,
    ],
    [CANONICAL_ROLES.DOCUMENT_REVIEWER]: [
        PERMISSIONS.VIEW_APPLICATIONS,
        PERMISSIONS.REVIEW_APPLICATIONS,
        PERMISSIONS.VIEW_CALENDAR,
        PERMISSIONS.VIEW_CERTIFICATES,
        PERMISSIONS.VIEW_REPORTS,
    ],
    [CANONICAL_ROLES.DISPATCHER]: [
        PERMISSIONS.VIEW_APPLICATIONS,
        PERMISSIONS.VIEW_CALENDAR,
        PERMISSIONS.MANAGE_CALENDAR,
        PERMISSIONS.SCHEDULE_AUDITS,
    ],
    [CANONICAL_ROLES.FIELD_INSPECTOR]: [
        PERMISSIONS.VIEW_APPLICATIONS,
        PERMISSIONS.REVIEW_APPLICATIONS,
        PERMISSIONS.VIEW_CALENDAR,
        PERMISSIONS.VIEW_CERTIFICATES,
        PERMISSIONS.VIEW_REPORTS,
    ],
    [CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]: [
        PERMISSIONS.VIEW_APPLICATIONS,
        PERMISSIONS.VIEW_INVOICES,
        PERMISSIONS.CREATE_INVOICES,
        PERMISSIONS.CONFIRM_PAYMENTS,
        PERMISSIONS.VIEW_REPORTS,
        PERMISSIONS.EXPORT_REPORTS,
    ],
    // Tier 16 (B16-B): both split roles inherit the same UI-level
    // permissions; the per-side gate happens server-side. From the
    // web app's perspective both roles can see the accounting
    // dashboard — they just see different data inside it.
    [CANONICAL_ROLES.FINANCE_OFFICER_DTAM]: [
        PERMISSIONS.VIEW_APPLICATIONS,
        PERMISSIONS.VIEW_INVOICES,
        PERMISSIONS.CREATE_INVOICES,
        PERMISSIONS.CONFIRM_PAYMENTS,
        PERMISSIONS.VIEW_REPORTS,
        PERMISSIONS.EXPORT_REPORTS,
    ],
    [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]: [
        ...Object.values(PERMISSIONS),
    ],
};

// UTILITY FUNCTIONS

export function isPROVIDER(role: string): boolean {
    return isProviderRole(role);
}

export function isAdmin(role: string): boolean {
    const canonical = normalizeRole(role);
    return canonical === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM;
}

export function hasPermission(role: string, permission: Permission): boolean {
    const canonical = normalizeRole(role);
    if (!canonical) return false;
    const perms = CANONICAL_ROLE_PERMISSIONS[canonical];
    return perms ? perms.includes(permission) : false;
}

export function getPermissions(role: string): Permission[] {
    const canonical = normalizeRole(role);
    if (!canonical) return [];
    return CANONICAL_ROLE_PERMISSIONS[canonical] || [];
}

export function canManageRole(managerRole: string, targetRole: string): boolean {
    const hierarchy: Record<string, number> = {
        [CANONICAL_ROLES.HEALTH]: 0,
        [CANONICAL_ROLES.DOCUMENT_REVIEWER]: 1,
        [CANONICAL_ROLES.FIELD_INSPECTOR]: 1,
        [CANONICAL_ROLES.DISPATCHER]: 1,
        // Tier 16: both split accounting roles + legacy ACCOUNT sit
        // at the same staff level.
        [CANONICAL_ROLES.FINANCE_OFFICER_DTAM]: 1,
        [CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]: 1,
        [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]: 3,
    };

    const managerCanonical = normalizeRole(managerRole);
    const targetCanonical = normalizeRole(targetRole);
    const managerLevel = managerCanonical ? (hierarchy[managerCanonical] ?? -1) : -1;
    const targetLevel = targetCanonical ? (hierarchy[targetCanonical] ?? -1) : -1;

    return managerLevel > targetLevel;
}

export function getRoleDisplayName(role: string): string {
    const names: Record<string, string> = {
        [CANONICAL_ROLES.HEALTH]: 'ผู้ยื่นคำขอ',
        [CANONICAL_ROLES.DOCUMENT_REVIEWER]: 'ผู้ตรวจเอกสาร/ตรวจประเมิน',
        [CANONICAL_ROLES.FIELD_INSPECTOR]: 'ผู้ตรวจประเมิน',
        [CANONICAL_ROLES.DISPATCHER]: 'ผู้จัดตาราง',
        // Tier 16 split — Thai labels match the org-chart used by
        // DTAM accounting (กรมการแพทย์แผนไทยฯ) and the platform's
        // commercial accounting team.
        [CANONICAL_ROLES.FINANCE_OFFICER_DTAM]: 'บัญชี DTAM',
        [CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]: 'บัญชี Platform',
        [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]: 'ผู้ดูแลระบบ',
    };
    const canonical = normalizeRole(role);
    return canonical ? (names[canonical] || role) : role;
}

// ROUTE PROTECTION HELPERS

export const PROTECTED_ROUTES = {
    provider: [
        '/provider',
        '/provider/dashboard',
        '/provider/applications',
        '/provider/calendar',
        '/provider/accounting',
        '/provider/analytics',
    ],
    admin: [
        '/admin',
        '/provider/dashboard/admin',
    ],
    health: [
        '/health/dashboard',
        '/health/applications',
        '/health/certificates',
        '/health/payments',
        '/health/profile',
        '/health/establishments',
    ],
    public: [
        '/',
        HEALTH_LOGIN_ROUTE,
        LEGACY_HEALTH_LOGIN_ROUTE,
        REGISTER_ROUTE,
        PROVIDER_LOGIN_ROUTE,
    ],
} as const;

export function requiresAuth(path: string): boolean {
    return !PROTECTED_ROUTES.public.some((route) => path === route || path.startsWith(`${route}/`));
}

export function requiresPROVIDER(path: string): boolean {
    return PROTECTED_ROUTES.provider.some((route) => path === route || path.startsWith(`${route}/`));
}

export function requiresAdmin(path: string): boolean {
    return PROTECTED_ROUTES.admin.some((route) => path === route || path.startsWith(`${route}/`));
}

// SHARED ROLE DISPLAY LABELS & COLORS

/** Thai display labels for canonical roles — use via normalizeRole() lookup. */
export const ROLE_LABELS_TH: Record<string, string> = {
    // ป้ายไทยชุดนี้เองก็เป็นต้นเหตุความสับสนที่ operator รายงาน 2026-09-10:
    // document_reviewer เคยเขียนว่า "ผู้ตรวจเอกสาร/ตรวจประเมิน" ซึ่งกินความของ
    // ผู้ลงพื้นที่ไปด้วย แล้ว auditor ก็เขียนว่า "ผู้ตรวจประเมิน" เฉย ๆ — สองบทบาท
    // คนละงานกันแต่ป้ายทับกัน · แยกให้ขาด: คนหนึ่งอ่านเอกสาร อีกคนเดินเข้าแปลง
    [CANONICAL_ROLES.HEALTH]: 'ผู้ยื่นคำขอ',
    [CANONICAL_ROLES.DOCUMENT_REVIEWER]: 'ผู้ตรวจเอกสาร',
    [CANONICAL_ROLES.FIELD_INSPECTOR]: 'ผู้ตรวจประเมินแปลง',
    [CANONICAL_ROLES.CERTIFICATE_APPROVER]: 'ผู้อนุมัติใบรับรอง',
    [CANONICAL_ROLES.DISPATCHER]: 'ผู้จัดสรรงานและคิวตรวจ',
    [CANONICAL_ROLES.FINANCE_OFFICER_DTAM]: 'บัญชี DTAM',
    [CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]: 'บัญชี Platform',
    [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]: 'ผู้ดูแลระบบ',
    [CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM]: 'ผู้ดูแลแพลตฟอร์ม',
};

/** English display labels for canonical roles. */
export const ROLE_LABELS_EN: Record<string, string> = {
    [CANONICAL_ROLES.HEALTH]: 'Applicant',
    [CANONICAL_ROLES.DOCUMENT_REVIEWER]: 'Document Reviewer',
    [CANONICAL_ROLES.FIELD_INSPECTOR]: 'Field Inspector',
    [CANONICAL_ROLES.CERTIFICATE_APPROVER]: 'Certificate Approver',
    [CANONICAL_ROLES.DISPATCHER]: 'Dispatcher',
    [CANONICAL_ROLES.FINANCE_OFFICER_DTAM]: 'DTAM Accountant',
    [CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]: 'Platform Accountant',
    [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]: 'System Administrator',
    [CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM]: 'Platform Administrator',
};

/** Thai labels with icon emoji — for dashboard badges / cards. */
export const ROLE_LABELS_WITH_ICON: Record<string, { label: string; icon: string }> = {
    [CANONICAL_ROLES.DOCUMENT_REVIEWER]: { label: 'ผู้ตรวจเอกสาร', icon: '📋' },
    [CANONICAL_ROLES.DISPATCHER]: { label: 'ผู้จัดสรรงานและคิวตรวจ', icon: '📆' },
    [CANONICAL_ROLES.CERTIFICATE_APPROVER]: { label: 'ผู้อนุมัติใบรับรอง', icon: '🏅' },
    [CANONICAL_ROLES.FINANCE_OFFICER_DTAM]: { label: 'บัญชี DTAM', icon: '🏛️' },
    [CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]: { label: 'บัญชี Platform', icon: '💼' },
    [CANONICAL_ROLES.FIELD_INSPECTOR]: { label: 'ผู้ตรวจประเมินแปลง', icon: '🔍' },
    [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]: { label: 'ผู้ดูแลระบบ', icon: '⚙️' },
    [CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM]: { label: 'ผู้ดูแลแพลตฟอร์ม', icon: '🛡️' },
};

/** Badge color mapping for canonical roles. */
export const ROLE_COLORS: Record<string, string> = {
    [CANONICAL_ROLES.SYSTEM_ADMIN_DTAM]: 'red',
    [CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM]: 'violet',
    [CANONICAL_ROLES.DOCUMENT_REVIEWER]: 'blue',
    [CANONICAL_ROLES.FIELD_INSPECTOR]: 'cyan',
    [CANONICAL_ROLES.CERTIFICATE_APPROVER]: 'teal',
    [CANONICAL_ROLES.DISPATCHER]: 'grape',
    // Tier 16: distinguish the two accounting sides by color so the
    // role-badge in the topbar tells finance staff at a glance which
    // queue they are working in.
    [CANONICAL_ROLES.FINANCE_OFFICER_DTAM]: 'orange',
    [CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM]: 'teal',
};

/** Look up role label (TH) from any role string. */
export function getRoleLabelTH(role: string): string {
    const canonical = normalizeRole(role);
    return canonical ? (ROLE_LABELS_TH[canonical] || role) : role;
}

/** Look up role color from any role string. */
export function getRoleColor(role: string): string {
    const canonical = normalizeRole(role);
    return canonical ? (ROLE_COLORS[canonical] || 'gray') : 'gray';
}

const roleUtils = {
    ROLES,
    CANONICAL_ROLES,
    PERMISSIONS,
    isPROVIDER,
    isAdmin,
    hasPermission,
    getPermissions,
    canManageRole,
    getRoleDisplayName,
    requiresAuth,
    requiresPROVIDER,
    requiresAdmin,
    PROTECTED_ROUTES,
};

export default roleUtils;
