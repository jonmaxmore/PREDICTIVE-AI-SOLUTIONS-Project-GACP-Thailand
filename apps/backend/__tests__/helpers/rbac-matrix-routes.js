/**
 * V5-C — Route metadata for the cross-role RBAC matrix.
 *
 * This module declares the canonical (route, method, admit-set) table
 * the V5-C matrix iterates over. The table is the single source of truth
 * for what the system's backend + frontend route surface looks like
 * after Loop V iter 5 — every gated endpoint plus every gated
 * `/provider/*` and `/admin` prefix middleware decision.
 *
 * Why a separate module?
 *   - The test file (rbac-matrix-final.test.js) reads ROUTES at
 *     load time and iterates via `describe.each`. Extracting the
 *     table keeps the test file focused on the assertion shape and
 *     lets the coverage-report writer reuse the same data.
 *   - The frontend matrix (middleware-matrix-final.test.ts) only
 *     reads the FRONTEND_PREFIXES slice. Keeping ROUTES strictly
 *     backend-shape and FRONTEND_PREFIXES separate makes the two
 *     test files trivially aligned with the RFC's matrix table.
 *
 * Schema per ROUTES entry:
 *   - id                — stable kebab-case identifier
 *   - surface           — Health / DocReviewer / Scheduler / Auditor / Finance / Admin
 *   - method            — HTTP verb (uppercase)
 *   - path              — example concrete path (with :param resolved to a literal)
 *   - admitRoles        — canonical role values (subset of the 8 human roles)
 *                         that the gate accepts. ADMIN is included only when
 *                         the gate explicitly admits the role; the matrix
 *                         test does NOT auto-include ADMIN — it asserts the
 *                         RFC's expected admit-set verbatim.
 *   - denyStatusFor403  — expected denial status code (default 403)
 *   - mutationOrRead    — 'mutation' | 'read'. Negative cells additionally
 *                         assert the gate intercepted BEFORE any side-effect
 *                         (the matrix's load-bearing claim).
 *   - rfcSection        — pointer to the iter-V5 RFC §V5-C row
 *
 * The 8 canonical human roles per docs/handoffs/iter-V5/00-rfc.md §V5-C
 * (excluding non-human SYSTEM):
 *   ADMIN, SCHEDULER, DOCUMENT_REVIEWER, AUDITOR,
 *   ACCOUNT_DTAM, ACCOUNT_PLATFORM, ACCOUNT (legacy), HEALTH
 */

'use strict';

/**
 * บทบาทที่เมทริกซ์นี้ทดสอบทั้งด้านบวกและด้านลบ
 *
 * `system_admin_platform` **จงใจไม่อยู่ในรายการ** — `middleware/role-middleware.js:38-42`
 * ให้ทางลัดกับมันไว้ว่า "ผู้ปฏิบัติการข้ามองค์กร (root) ผ่านทุกข้อกำหนดบทบาทของเจ้าหน้าที่"
 * ⇒ ทุกเคส NEGATIVE ของมันจะได้ 200 ตามการออกแบบ ไม่ใช่เพราะประตูรั่ว
 * (ถ้าใส่กลับเข้ามา จะได้ 22 เคสแดงที่ไม่ได้บอกอะไรใหม่ — วัดแล้ว 2026-09-10)
 */
const HUMAN_ROLES = Object.freeze([
    'health',
    'document_reviewer',
    'dispatcher',
    'field_inspector',
    'certificate_approver',
    'finance_officer_dtam',
    'system_admin_dtam',
    'finance_officer_platform',
]);

const ROUTES = Object.freeze([
    // ── Health surface ──────────────────────────────────────────────────
    {
        id: 'health.draft.create',
        surface: 'Health',
        method: 'POST',
        path: '/api/applications/draft',
        admitRoles: ['health'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Health',
    },
    {
        id: 'health.applications.my',
        surface: 'Health',
        method: 'GET',
        path: '/api/applications/my',
        admitRoles: ['health'],
        denyStatusFor403: 403,
        mutationOrRead: 'read',
        rfcSection: 'V5-C / Health',
    },

    // ── Doc-reviewer surface ────────────────────────────────────────────
    {
        id: 'doc-rev.workflow-transitions',
        surface: 'DocReviewer',
        method: 'POST',
        path: '/api/provider/applications/app-1/workflow-transitions',
        admitRoles: ['document_reviewer', 'field_inspector', 'system_admin_dtam', 'dispatcher'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Doc-rev',
    },
    {
        id: 'doc-rev.dashboard',
        surface: 'DocReviewer',
        method: 'GET',
        path: '/api/provider/reviewer/dashboard',
        admitRoles: ['document_reviewer', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'read',
        rfcSection: 'V5-C / Doc-rev',
    },
    {
        id: 'doc-rev.save-progress',
        surface: 'DocReviewer',
        method: 'PATCH',
        path: '/api/provider/reviewer/app-1/progress',
        admitRoles: ['document_reviewer', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Doc-rev',
    },

    // ── Scheduler surface ───────────────────────────────────────────────
    {
        id: 'sched.queue',
        surface: 'Scheduler',
        method: 'GET',
        path: '/api/audit/scheduling/queue',
        admitRoles: ['dispatcher', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'read',
        rfcSection: 'V5-C / Scheduler',
    },
    {
        id: 'sched.assign',
        surface: 'Scheduler',
        method: 'POST',
        path: '/api/audit/scheduling/assign',
        admitRoles: ['dispatcher', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Scheduler',
    },
    {
        id: 'sched.auditors',
        surface: 'Scheduler',
        method: 'GET',
        path: '/api/provider/scheduler/auditors',
        admitRoles: ['dispatcher', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'read',
        rfcSection: 'V5-C / Scheduler',
    },
    {
        id: 'sched.dashboard',
        surface: 'Scheduler',
        method: 'GET',
        path: '/api/provider/scheduler/dashboard',
        admitRoles: ['dispatcher', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'read',
        rfcSection: 'V5-C / Scheduler',
    },

    // ── Auditor surface ─────────────────────────────────────────────────
    {
        id: 'auditor.dashboard',
        surface: 'Auditor',
        method: 'GET',
        path: '/api/provider/auditor/dashboard',
        admitRoles: ['field_inspector', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'read',
        rfcSection: 'V5-C / Auditor',
    },
    {
        id: 'auditor.audit-decisions',
        surface: 'Auditor',
        method: 'POST',
        path: '/api/provider/auditor/applications/app-1/audit-decisions',
        admitRoles: ['field_inspector', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Auditor',
    },
    {
        id: 'auditor.onsite-start',
        surface: 'Auditor',
        method: 'POST',
        path: '/api/audit/onsite/aud-1/start',
        admitRoles: ['field_inspector', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Auditor',
    },
    {
        id: 'auditor.final-approvals',
        surface: 'Auditor',
        method: 'POST',
        path: '/api/provider/auditor/applications/app-1/final-approvals',
        admitRoles: ['field_inspector', 'system_admin_dtam', 'dispatcher', 'document_reviewer'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Auditor',
    },

    // ── Finance surface ─────────────────────────────────────────────────
    // V4-A widening + Tier 16 ACCOUNT split.
    {
        id: 'finance.slips.pending',
        surface: 'Finance',
        method: 'GET',
        path: '/api/finance/payment-slips/pending',
        admitRoles: ['finance_officer_dtam', 'finance_officer_platform', 'finance_officer_platform', 'system_admin_dtam', 'field_inspector'],
        denyStatusFor403: 403,
        mutationOrRead: 'read',
        rfcSection: 'V5-C / Finance',
    },
    {
        id: 'finance.slips.approve',
        surface: 'Finance',
        method: 'POST',
        path: '/api/finance/payment-slips/slip-1/approve',
        admitRoles: ['finance_officer_dtam', 'finance_officer_platform', 'finance_officer_platform', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Finance',
    },
    {
        id: 'finance.period-close.create',
        surface: 'Finance',
        method: 'POST',
        path: '/api/finance/period-close',
        admitRoles: ['finance_officer_platform', 'finance_officer_platform', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Finance',
    },
    {
        id: 'finance.period-close.reopen',
        surface: 'Finance',
        method: 'POST',
        path: '/api/finance/period-close/pc-1/reopen',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Finance',
    },
    {
        id: 'finance.manual-je.create',
        surface: 'Finance',
        method: 'POST',
        path: '/api/finance/manual-journal-entries',
        admitRoles: ['finance_officer_platform', 'finance_officer_platform', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Finance',
    },
    {
        id: 'finance.manual-je.approve',
        surface: 'Finance',
        method: 'POST',
        path: '/api/finance/manual-journal-entries/je-1/approve',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Finance',
    },
    {
        id: 'finance.refunds.initiate',
        surface: 'Finance',
        method: 'POST',
        path: '/api/finance/refunds/inv-1/initiate',
        admitRoles: ['finance_officer_platform', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Finance',
    },
    {
        id: 'finance.refunds.cancel',
        surface: 'Finance',
        method: 'POST',
        path: '/api/finance/refunds/ref-1/cancel',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Finance',
    },
    {
        id: 'finance.purchase-invoices.create',
        surface: 'Finance',
        method: 'POST',
        path: '/api/finance/purchase-invoices',
        admitRoles: ['finance_officer_platform', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Finance',
    },
    {
        id: 'finance.wht.certificate',
        surface: 'Finance',
        method: 'POST',
        path: '/api/finance/wht/certificate',
        admitRoles: ['finance_officer_platform', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Finance',
    },
    {
        id: 'finance.bank-accounts.create',
        surface: 'Finance',
        method: 'POST',
        path: '/api/finance/bank-accounts',
        admitRoles: ['finance_officer_dtam', 'finance_officer_platform', 'finance_officer_platform', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Finance',
    },
    // finance.payments.list (GET /api/payments) left the matrix in Wave 0:
    // the route was removed — both clients list invoices via GET /invoices/my.
    {
        id: 'finance.slip-queue.summary',
        surface: 'Finance',
        method: 'GET',
        path: '/api/finance/accounting/slip-queue-summary',
        admitRoles: ['finance_officer_dtam', 'finance_officer_platform', 'finance_officer_platform', 'system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'read',
        rfcSection: 'V5-C / Finance',
    },

    // ── Admin surface (Iter 28) ─────────────────────────────────────────
    {
        id: 'admin.users.list',
        surface: 'Admin',
        method: 'GET',
        path: '/api/admin/users',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'read',
        rfcSection: 'V5-C / Admin',
    },
    {
        id: 'admin.users.disable',
        surface: 'Admin',
        method: 'PATCH',
        path: '/api/admin/users/u-1/disable',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Admin',
    },
    {
        id: 'admin.users.enable',
        surface: 'Admin',
        method: 'PATCH',
        path: '/api/admin/users/u-1/enable',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Admin',
    },
    {
        id: 'admin.users.change-role',
        surface: 'Admin',
        method: 'PATCH',
        path: '/api/admin/users/u-1/change-role',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Admin',
    },
    {
        id: 'admin.applications.force-status',
        surface: 'Admin',
        method: 'POST',
        path: '/api/admin/applications/app-1/force-status',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Admin',
    },
    {
        id: 'admin.applications.revert-last-transition',
        surface: 'Admin',
        method: 'POST',
        path: '/api/admin/applications/app-1/revert-last-transition',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Admin',
    },
    {
        id: 'admin.audit-log.list',
        surface: 'Admin',
        method: 'GET',
        path: '/api/admin/audit-log',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'read',
        rfcSection: 'V5-C / Admin',
    },
    {
        id: 'admin.audit-log.export',
        surface: 'Admin',
        method: 'GET',
        path: '/api/admin/audit-log/export.csv',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'read',
        rfcSection: 'V5-C / Admin',
    },
    {
        id: 'admin.plants.create',
        surface: 'Admin',
        method: 'POST',
        path: '/api/admin/plants',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Admin',
    },
    {
        id: 'admin.config.update',
        surface: 'Admin',
        method: 'PATCH',
        path: '/api/admin/config/pricing',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'mutation',
        rfcSection: 'V5-C / Admin',
    },
    {
        id: 'admin.planting-cycles.list',
        surface: 'Admin',
        method: 'GET',
        path: '/api/admin/planting-cycles',
        admitRoles: ['system_admin_dtam'],
        denyStatusFor403: 403,
        mutationOrRead: 'read',
        rfcSection: 'V5-C / Admin',
    },
]);

/**
 * Frontend `/provider/*` and `/admin` prefix rules per
 * `apps/web-app/src/middleware.ts:26-50`. Each row is the canonical
 * (prefix, admitRoles) decision the middleware enforces via
 * `decideProviderRouteAccess()`. The V5-C frontend matrix iterates
 * 5 prefixes × 8 roles = 40 cells.
 *
 * Note: `/admin` is special — only ADMIN is in the admit set, so 7
 * roles redirect for that prefix.
 */
const FRONTEND_PREFIXES = Object.freeze([
    {
        id: 'fe.admin',
        prefix: '/admin',
        samplePath: '/admin/users',
        admitRoles: ['system_admin_dtam'],
    },
    {
        id: 'fe.provider.applications',
        prefix: '/provider/applications',
        samplePath: '/provider/applications/app-1',
        admitRoles: ['system_admin_dtam', 'document_reviewer', 'field_inspector'],
    },
    {
        id: 'fe.provider.accounting',
        prefix: '/provider/accounting',
        samplePath: '/provider/accounting/dashboard',
        admitRoles: ['system_admin_dtam', 'finance_officer_dtam', 'finance_officer_platform', 'finance_officer_platform', 'field_inspector'],
    },
    {
        id: 'fe.provider.audits',
        prefix: '/provider/audits',
        samplePath: '/provider/audits/queue',
        admitRoles: ['system_admin_dtam', 'field_inspector'],
    },
    {
        id: 'fe.provider.scheduler',
        prefix: '/provider/scheduler',
        samplePath: '/provider/scheduler/dashboard',
        admitRoles: ['system_admin_dtam', 'dispatcher'],
    },
]);

/**
 * For a given route entry, compute the negative role set —
 * HUMAN_ROLES minus admitRoles. Returned as a frozen array so the
 * test cannot accidentally mutate the canonical RFC matrix.
 */
function negativeRolesFor(route) {
    const admit = new Set(route.admitRoles);
    return Object.freeze(HUMAN_ROLES.filter((role) => !admit.has(role)));
}

module.exports = {
    HUMAN_ROLES,
    ROUTES,
    FRONTEND_PREFIXES,
    negativeRolesFor,
};
