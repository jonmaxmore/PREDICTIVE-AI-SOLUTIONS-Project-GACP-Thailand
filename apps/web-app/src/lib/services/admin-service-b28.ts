/**
 * Admin Service (B28-A integration — V5-D Iter 28 endpoint rewires).
 *
 * Frontend wrapper for the admin tooling endpoints. V5-D rewires the
 * four URLs that used to point at the LEGACY `/provider/admin/*`
 * surface (which 404s for those paths) so they hit the Iter 28
 * `/admin/*` endpoints actually implemented in
 * `apps/backend/routes/api/admin/*`.
 *
 * Endpoints (all gated by ADMIN role on the server):
 *   GET    /admin/users                                   — list/search users
 *   PATCH  /admin/users/:id/disable                       — disable account (reason ≥ 5)
 *   PATCH  /admin/users/:id/enable                        — re-enable account
 *   PATCH  /admin/users/:id/change-role                   — role change (reason ≥ 10)
 *   GET    /admin/audit-log                               — paginated audit log (structured filters)
 *   GET    /admin/audit-log/export.csv                    — CSV export
 *   POST   /admin/applications/:id/force-status           — emergency override (reason ≥ 10, reasonCode)
 *   POST   /admin/applications/:id/revert-last-transition — undo last transition (reason ≥ 10)
 *
 * Legacy notes:
 *   - V5-D removes calls to `/provider/admin/users/:id` (never existed)
 *     and `/provider/admin/status-override` (B5-era handler with old
 *     payload shape).
 *   - The new audit-log endpoint accepts STRUCTURED filters
 *     (`actorId`, `applicationId`, `organizationId`, `action`) rather
 *     than the legacy substring `actor` / `severity`.
 */

import { apiClient } from '@/lib/api/api-client';

// ── User management ────────────────────────────────────────────────

export interface AdminUserRow {
    id: string;
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    isLocked?: boolean;
    twoFactorEnabled?: boolean;
    lastLoginAt?: string | null;
    createdAt: string;
}

export interface AdminUserListResponse {
    // C4-01 (audit 2026-06-10): backend `GET /admin/users` nests the array under
    // `users` (not `data`) inside the {success,data} envelope; apiClient collapses
    // the envelope so res.data IS this object. The field was mistyped as `data`,
    // which made the admin users table read undefined → always empty.
    users: AdminUserRow[];
    pagination?: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

export interface AdminUserListParams {
    q?: string;
    role?: string;
    status?: 'ACTIVE' | 'DISABLED' | 'LOCKED' | 'ALL';
    page?: number;
    limit?: number;
}

// ── Audit log ──────────────────────────────────────────────────────

export interface AuditLogRow {
    id: string;
    logId: string;
    sequenceNumber: number;
    createdAt: string;
    category: string;
    action: string;
    severity: string;
    actorId: string | null;
    actorEmail: string | null;
    actorRole: string | null;
    resourceType: string;
    resourceId: string;
    ipAddress: string | null;
    metadata: Record<string, unknown> | null;
    result: string;
    errorCode: string | null;
    errorMessage: string | null;
}

export interface AuditLogListResponse {
    data: AuditLogRow[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

/**
 * Shape of `res.data` after apiClient's envelope-collapse for `/admin/audit-log`.
 * The backend nests rows + pagination INSIDE `data` (mirroring /admin/users) so
 * pagination is not lost when apiClient keeps only `body.data` on success.
 */
export interface AuditLogListEnvelope {
    rows: AuditLogRow[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

/**
 * V5-D UX-C1: the Iter 28 `/admin/audit-log` endpoint accepts
 * structured filters. The legacy `actor` substring + `severity`
 * fields are NOT accepted by the new endpoint; pages must use
 * `actorId` (exact UUID) and may filter by `category` only.
 *
 * `severity` is forwarded as a query parameter and is ENFORCED server-side
 * (audit-trail.js buildAdminFilterWhere) for both the table and the CSV export.
 * It was not, until 2026-09-07 — the screen rendered an active
 * "ระดับ: ข้อผิดพลาด (ERROR)" chip while the rows and the export came back
 * unfiltered. That is the opposite of harmless: an admin reading a security log
 * believed they were looking at errors only.
 */
export interface AuditLogFilters {
    /** Exact actor id (UUID). Replaces the legacy `actor` substring filter. */
    actorId?: string;
    /** Filter by audit category (e.g. ADMIN, APPLICATION, PAYMENT). */
    category?: string;
    /** Filter by specific action string (e.g. USER_DISABLED). */
    action?: string;
    /** Scope audit rows to a single application. */
    applicationId?: string;
    /** Scope audit rows to a single organisation / tenant. */
    organizationId?: string;
    /** ISO date string (inclusive lower bound). */
    from?: string;
    /** ISO date string (inclusive upper bound). */
    to?: string;
    /** Forwarded as-is for forward-compat; ignored by the current backend. */
    severity?: string;
    page?: number;
    limit?: number;
}

// ── Force-status override (V5-D UX-B1) ─────────────────────────────

/**
 * Force-status reason codes accepted by the Iter 28
 * `/admin/applications/:id/force-status` endpoint. Mirrors the
 * backend's `FORCE_STATUS_REASON_CODES` const so a code rename on
 * one side trips TypeScript on the other.
 */
export type ForceStatusReasonCode =
    | 'DATA_CORRECTION'
    | 'COMPLIANCE_ESCALATION'
    | 'LEGAL_ORDER'
    | 'SYSTEM_RECOVERY'
    | 'MANUAL_REVIEW_EXCEPTION';

export const FORCE_STATUS_REASON_CODES: ReadonlyArray<{
    value: ForceStatusReasonCode;
    label: string;
}> = [
    { value: 'DATA_CORRECTION', label: 'แก้ไขข้อมูล (Data correction)' },
    { value: 'COMPLIANCE_ESCALATION', label: 'การยกระดับด้าน Compliance' },
    { value: 'LEGAL_ORDER', label: 'คำสั่งทางกฎหมาย' },
    { value: 'SYSTEM_RECOVERY', label: 'กู้คืนสถานะระบบ' },
    { value: 'MANUAL_REVIEW_EXCEPTION', label: 'ตรวจสอบโดยบุคคล (ค่าเริ่มต้น)' },
];

export interface ForceStatusPayload {
    applicationId: string;
    /** New status value — sent as `toStatus` in the Iter 28 payload. */
    toStatus: string;
    /** Required reason code — one of FORCE_STATUS_REASON_CODES. */
    reasonCode: ForceStatusReasonCode;
    /** Free-text reason — minimum 10 characters per backend gate. */
    reason: string;
}

// ── Service ────────────────────────────────────────────────────────

function buildQueryString(params: Record<string, unknown>): string {
    const search = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
        if (val === undefined || val === null || val === '' || val === 'ALL') continue;
        search.set(key, String(val));
    }
    const q = search.toString();
    return q ? `?${q}` : '';
}

export const AdminB28Service = {
    // --- Users ---
    async listUsers(params: AdminUserListParams = {}) {
        const qs = buildQueryString({
            q: params.q,
            role: params.role,
            status: params.status,
            page: params.page ?? 1,
            limit: params.limit ?? 25,
        });
        return await apiClient.get<AdminUserListResponse>(
            `/admin/users${qs}`,
        );
    },

    /**
     * V5-D UX-A1: re-pointed from the non-existent
     * `PATCH /provider/admin/users/:id` to the Iter 28
     * `PATCH /admin/users/:id/disable` endpoint.
     */
    async disableUser(userId: string, reason: string) {
        return await apiClient.patch<AdminUserRow>(
            `/admin/users/${userId}/disable`,
            { reason },
        );
    },

    /**
     * V5-D UX-A1: re-pointed to the Iter 28
     * `PATCH /admin/users/:id/enable` endpoint.
     */
    async enableUser(userId: string) {
        return await apiClient.patch<AdminUserRow>(
            `/admin/users/${userId}/enable`,
            {},
        );
    },

    /**
     * V5-D UX-A3: re-pointed to the Iter 28
     * `PATCH /admin/users/:id/change-role` endpoint which requires a
     * reason ≥ 10 chars and emits a before/after audit row.
     */
    async changeRole(userId: string, newRole: string, reason: string) {
        return await apiClient.patch<AdminUserRow>(
            `/admin/users/${userId}/change-role`,
            { newRole, reason },
        );
    },

    // No forceResetMfa: POST /admin/users/:id/force-reset-mfa was removed
    // 2026-09-26 (operator "ถอดทั้งสองประตู" — no one clears another account's
    // 2FA; 2FA recovery belongs to หมอพร้อม).

    // --- Audit log ---
    /**
     * V5-D UX-C1: re-pointed to `/admin/audit-log` with structured
     * filters (actorId, action, applicationId, organizationId).
     */
    async listAuditLog(filters: AuditLogFilters = {}) {
        const qs = buildQueryString({
            actorId: filters.actorId,
            category: filters.category,
            action: filters.action,
            applicationId: filters.applicationId,
            organizationId: filters.organizationId,
            severity: filters.severity,
            from: filters.from,
            to: filters.to,
            page: filters.page ?? 1,
            limit: filters.limit ?? 50,
        });
        return await apiClient.get<AuditLogListEnvelope>(
            `/admin/audit-log${qs}`,
        );
    },

    /**
     * V5-D UX-C1: re-pointed to `/api/admin/audit-log/export.csv`.
     * Caller is expected to `window.open` the URL so the browser
     * handles the file download natively.
     */
    auditLogExportUrl(filters: AuditLogFilters = {}): string {
        const qs = buildQueryString({
            actorId: filters.actorId,
            category: filters.category,
            action: filters.action,
            applicationId: filters.applicationId,
            organizationId: filters.organizationId,
            severity: filters.severity,
            from: filters.from,
            to: filters.to,
        });
        return `/api/admin/audit-log/export.csv${qs}`;
    },

    // --- Force status (emergency override) ---
    /**
     * V5-D UX-B1: re-pointed from the legacy
     * `POST /provider/admin/status-override` (B5-era handler with old
     * `{ applicationId, newStatus, reason }` shape) to the Iter 28
     * `POST /admin/applications/:id/force-status` endpoint, which
     * expects `{ toStatus, reasonCode, reason }` and validates
     * `reason.length >= 10`.
     */
    async forceStatus(payload: ForceStatusPayload) {
        return await apiClient.post<{
            applicationId: string;
            applicationNumber?: string;
            previousStatus: string;
            nextStatus: string;
        }>(
            `/admin/applications/${payload.applicationId}/force-status`,
            {
                toStatus: payload.toStatus,
                reasonCode: payload.reasonCode,
                reason: payload.reason,
            },
        );
    },

    /**
     * V5-D UX-B2: NEW frontend exposure for the Iter 28
     * `POST /admin/applications/:id/revert-last-transition` endpoint.
     * Rolls back the most recent workflow transition; reason ≥ 10
     * chars; admin-only on the server.
     */
    async revertLastTransition(applicationId: string, reason: string) {
        return await apiClient.post<{
            applicationId: string;
            applicationNumber?: string;
            previousStatus: string;
            nextStatus: string;
        }>(
            `/admin/applications/${applicationId}/revert-last-transition`,
            { reason },
        );
    },
};

export default AdminB28Service;
