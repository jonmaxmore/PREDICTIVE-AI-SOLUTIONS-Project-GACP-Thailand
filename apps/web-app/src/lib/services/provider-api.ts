import { apiClient } from '@/lib/api/api-client';

export const providerApiPaths = {
    applicationsList: "/api/provider/applications",
    profileMe: "/api/auth/provider/me",
    plantingCycles: (query = "") => `/api/provider/planting-cycles${query}`,
    plantingCycleDetail: (cycleId: string) => `/api/provider/planting-cycles/${encodeURIComponent(cycleId)}`,
    plantingCycleActivities: (cycleId: string, query = "") => `/api/provider/planting-cycles/${encodeURIComponent(cycleId)}/activities${query}`,
    plantingCyclePlotQrs: (cycleId: string) => `/api/provider/planting-cycles/${encodeURIComponent(cycleId)}/plot-qrs`,
    reviewerDashboard: (query = "") => `/api/provider/reviewer/dashboard${query}`,
    schedulerDashboard: (query = "") => `/api/provider/scheduler/dashboard${query}`,
    schedulerAuditors: (query = "") => `/api/provider/scheduler/auditors${query}`,
    schedulerReviewers: (query = "") => `/api/provider/scheduler/reviewers${query}`,
    schedulerAssignReviewer: "/api/provider/scheduler/reviewer-assignments",
    schedulerAuditSchedules: "/api/provider/scheduler/audits/schedules",
    schedulerUrgentMonitor: (query = "") => `/api/provider/scheduler/urgent-monitor${query}`,
    schedulerAuditorWorkload: "/api/provider/scheduler/auditor-workload",
    schedulerSendReminder: (applicationId: string) => `/api/provider/scheduler/applications/${encodeURIComponent(applicationId)}/send-reminder`,
    auditorDashboard: (query = "") => `/api/provider/auditor/dashboard${query}`,
    auditorStartInspection: (applicationId: string) => `/api/provider/auditor/applications/${encodeURIComponent(applicationId)}/inspection-starts`,
    auditorDecision: (applicationId: string) => `/api/provider/auditor/applications/${encodeURIComponent(applicationId)}/audit-decisions`,
    auditorDecisionFile: (applicationId: string) => `/api/provider/auditor/applications/${encodeURIComponent(applicationId)}/decision-file`,
    auditorFinalApprovalQueue: "/api/provider/auditor/final-approval-queue",
    auditorFinalApproval: (applicationId: string) => `/api/provider/auditor/applications/${encodeURIComponent(applicationId)}/final-approvals`,
    auditorRejectToAuditor: (applicationId: string) => `/api/provider/auditor/applications/${encodeURIComponent(applicationId)}/reject-to-auditor`,
    // Audit Session (GPS/Evidence/Notes)
    auditorSession: (applicationId: string) => `/api/provider/auditor/applications/${encodeURIComponent(applicationId)}/session`,
    auditorSessionCheckIn: (applicationId: string) => `/api/provider/auditor/applications/${encodeURIComponent(applicationId)}/session/checkin`,
    auditorSessionEvidence: (applicationId: string) => `/api/provider/auditor/applications/${encodeURIComponent(applicationId)}/session/evidence`,
    auditorSessionNotes: (applicationId: string) => `/api/provider/auditor/applications/${encodeURIComponent(applicationId)}/session/notes`,
    applicationDetail: (applicationId: string) => `/api/provider/applications/${encodeURIComponent(applicationId)}`,
    applicationActivities: (applicationId: string) => `/api/provider/applications/${encodeURIComponent(applicationId)}/activities`,
    applicationWorkflowTransitions: (applicationId: string) => `/api/provider/applications/${encodeURIComponent(applicationId)}/workflow-transitions`,
    applicationAuditTimelines: (applicationId: string) => `/api/provider/applications/${encodeURIComponent(applicationId)}/audit-timelines`,
    applicationRevisionExpirations: (applicationId: string) => `/api/provider/applications/${encodeURIComponent(applicationId)}/revision-expirations`,
    certificatesDashboard: "/api/provider/certificates/dashboard",
    certificatesBulkNotify: "/api/provider/certificates/bulk-notify",
    // SOW (Scope of Work)
    sowByApplication: (applicationId: string) => `/api/provider/applications/${encodeURIComponent(applicationId)}/sow`,
    // Audit Checklist
    checklistByApplication: (applicationId: string) => `/api/provider/applications/${encodeURIComponent(applicationId)}/checklist`,
    // Document Templates (already in DB)
    documentTemplates: "/api/provider/documents/templates",
    // ADR-016 Phase 1A — BPMN-aligned unified work queue
    workMy: (query = "") => `/api/provider/work/my${query}`,
    workQueue: (query = "") => `/api/provider/work/queue${query}`,
    workDetail: (id: string) => `/api/provider/work/${encodeURIComponent(id)}`,
    workNextStates: (id: string) => `/api/provider/work/${encodeURIComponent(id)}/next-states`,
    workClaim: (id: string) => `/api/provider/work/${encodeURIComponent(id)}/claim`,
    workUnclaim: (id: string) => `/api/provider/work/${encodeURIComponent(id)}/unclaim`,
    workDone: (id: string) => `/api/provider/work/${encodeURIComponent(id)}/done`,
    // ADR-016 Phase 1D — admin work-config surfaces
    workConfig: "/api/provider/admin/work-config",
    workConfigStage: (id: string) => `/api/provider/admin/work-config/stage-configs/${encodeURIComponent(id)}`,
    workConfigStages: "/api/provider/admin/work-config/stage-configs",
    workConfigSla: (workType: string) => `/api/provider/admin/work-config/sla-policies/${encodeURIComponent(workType)}`,
    workConfigExport: "/api/provider/admin/work-config/export",
    workConfigImport: "/api/provider/admin/work-config/import",
    workKpis: (days = 30) => `/api/provider/analytics/work-kpis?days=${days}`,
    // ADR-016 Phase 1C/2 — user-group memberships (admin)
    userGroups: (userId: string) => `/api/provider/admin/user-groups/${encodeURIComponent(userId)}`,
    userGroupRemove: (userId: string, groupCode: string) =>
        `/api/provider/admin/user-groups/${encodeURIComponent(userId)}/${encodeURIComponent(groupCode)}`,
    // feat/backoffice-per-permission-grants — per-user permission GRANT/REVOKE
    // (admin). Mounted on the ADMIN router at /api/admin/user-permissions.
    userPermissions: (userId: string) => `/api/admin/user-permissions/${encodeURIComponent(userId)}`,
    userPermission: (userId: string, permission: string) =>
        `/api/admin/user-permissions/${encodeURIComponent(userId)}/${encodeURIComponent(permission)}`,
    // MFA — backend mounted at /api/mfa. The TOTP setup endpoints stay
    // provider-only; status/disable are authenticateAny (both portals). TOTP is
    // the only second factor since 2026-09-15 — the email-OTP enrol endpoints
    // no longer exist on the backend.
    mfaStatus: '/api/mfa/status',
    mfaSetup: '/api/mfa/setup',
    mfaVerifySetup: '/api/mfa/verify-setup',
    mfaDisable: '/api/mfa/disable',
};

// ─────────────────────────────────────────────────────────────────────────
// T&T — ชั้นพนักงานติดตาม (มติ operator 2026-09-05)
//
// docs/design/2026-09-05-tnt-loop-and-farmer-updates.md §3.3: พนักงานเห็น
// "ฟาร์มทุกแห่งทั้งประเทศ" ไม่ผูกกับการมอบหมายงาน จึงไม่มีพารามิเตอร์ใดใน
// ชั้นนี้ที่กรองด้วยผู้รับผิดชอบ และไม่มีตัวใดจะถูกเพิ่มทีหลังโดยเงียบ ๆ ได้
// เพราะ `TrackingCycleQuery` ระบุชุดพารามิเตอร์ที่ประตูหลังบ้านรับไว้ครบ
// (routes/api/provider/handlers/planting.js: page · limit · status · q · farmId)
//
// สิ่งที่ *ไม่มี* ในไฟล์นี้โดยตั้งใจ: ใบแจ้งหนี้ ค่าธรรมเนียม ใบเสนอราคา
// ตารางเดียวกันของมติเขียนไว้ว่าเรื่องเงิน "คนละหน้าที่ ไม่ได้อยู่ในคำว่าติดตาม"
// payload ของหลังบ้านก็ไม่มีให้ — การเติมเข้ามาที่ชั้นนี้จึงเป็นการฝืนมติ
//
// ทุกการเรียกประตูเหล่านี้ถูกบันทึกตาม PDPA ม.39 ที่หลังบ้าน
// (services/farm-access-audit.js ติดไว้ที่ router) — ฝั่งจอมีหน้าที่บอกผู้ใช้
// ว่ากำลังถูกบันทึก ดู components/feature/farm-access-notice.tsx
// ─────────────────────────────────────────────────────────────────────────

/** ฟาร์มเจ้าของรอบปลูก เท่าที่ประตูติดตามส่งออกมา */
export interface TrackingFarmRef {
    id: string;
    farmName?: string | null;
    district?: string | null;
    province?: string | null;
}

export interface TrackingPagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

/** หนึ่งแถวของรายการรอบปลูก (handler: providerPlantingCyclesList) */
export interface TrackingCycleListItem {
    id: string;
    cycleName: string;
    status: string;
    startDate: string | null;
    expectedHarvestDate: string | null;
    farm?: TrackingFarmRef | null;
    plotCount: number;
    cultivationMethods: string[];
    totalAreaSqm: number;
    counts?: {
        activities?: number;
        batches?: number;
        lots?: number;
    };
}

export interface TrackingCyclePlot {
    id: string;
    plotId: string;
    allocatedAreaSqm: number;
    plannedPlantCount: number;
    plot?: {
        id: string;
        name?: string | null;
        areaSqm?: number | null;
        solarSystem?: string | null;
    } | null;
}

/**
 * รายละเอียดรอบปลูก (handler: providerPlantingCycleDetail)
 *
 * ไม่ประกาศ `integrity` และไม่ประกาศจำนวนต้นรายต้น: R8
 * (design note 2026-08-20-planting-tnt-design) ปิดการติดตามรายต้น
 * ไปแล้ว 2026-08-25 ประกาศฟิลด์ที่เซิร์ฟเวอร์ส่งไม่ได้ไว้ = เชิญให้มีคนมา "กู้คืน"
 */
export interface TrackingCycleDetail {
    id: string;
    cycleName: string;
    cycleNumber?: number | null;
    status: string;
    startDate: string | null;
    expectedHarvestDate: string | null;
    actualHarvestDate?: string | null;
    varietyName?: string | null;
    cultivationType?: string | null;
    seedSource?: string | null;
    soilType?: string | null;
    irrigationType?: string | null;
    actualYield?: number | null;
    notes?: string | null;
    farm?: TrackingFarmRef | null;
    plantSpecies?: {
        id: string;
        code?: string | null;
        nameTH?: string | null;
        nameEN?: string | null;
    } | null;
    cyclePlots?: TrackingCyclePlot[];
    _count?: {
        cultivationLogs?: number;
        batches?: number;
        lots?: number;
    };
}

/** หนึ่งบันทึกกิจกรรม (handler: providerPlantingCycleActivities) */
export interface TrackingActivity {
    id: string;
    logDate: string | null;
    scope: string;
    logType: string;
    productName?: string | null;
    quantity?: number | null;
    unit?: string | null;
    method?: string | null;
    notes?: string | null;
    recordedBy?: string | null;
    plot?: { id: string; name?: string | null } | null;
}

/** หนึ่งแถว QR ประจำแปลง (services/plot-qr-row.js) */
export interface TrackingPlotQr {
    cyclePlotId: string;
    plotId: string | null;
    plotName: string | null;
    plotCode: string | null;
    qrIssuedAt: string | null;
    qrRevokedAt: string | null;
    qrCode: string | null;
    seasonalQrCode: string | null;
    trackingUrl: string | null;
    status?: string;
    cultivationMethod: string;
    allocatedAreaSqm: number;
    plannedPlantCount: number;
}

/**
 * ผลของการอ่านหนึ่งครั้ง
 *
 * `ok` แยก "อ่านไม่สำเร็จ" ออกจาก "อ่านสำเร็จแล้วไม่มีข้อมูล" อย่างชัดเจน
 * หน้าจอที่รวมสองอย่างนี้เข้าด้วยกันจะแสดงตารางว่างเมื่อ API ล่ม ซึ่งอ่านได้ว่า
 * "ไม่มีฟาร์ม" — เป็นการรายงานเท็จต่อผู้ใช้
 */
export type TrackingReadResult<T> =
    | { ok: true; data: T; pagination: TrackingPagination | null }
    | { ok: false; error: string };

const TRACKING_READ_FAILED_TH = 'อ่านข้อมูลจากระบบไม่สำเร็จ';

function toPagination(meta: Record<string, unknown> | undefined): TrackingPagination | null {
    const raw = meta && (meta.pagination as Record<string, unknown> | undefined);
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    return {
        page: Number(raw.page || 1),
        limit: Number(raw.limit || 0),
        total: Number(raw.total || 0),
        totalPages: Number(raw.totalPages || 1),
    };
}

/** พารามิเตอร์ที่ประตูรายการรับจริง ไม่มีตัวกรอง "งานที่ได้รับมอบหมาย" ตามมติ */
export interface TrackingCycleQuery {
    page?: number;
    limit?: number;
    /** สถานะรอบปลูก (PLANNING · PLANTED · GROWING · READY_HARVEST · HARVESTED · COMPLETED) */
    status?: string | null;
    /** ค้นจากชื่อรอบปลูกหรือชื่อฟาร์ม */
    q?: string | null;
    farmId?: string | null;
}

export interface TrackingActivityQuery {
    page?: number;
    limit?: number;
    scope?: string | null;
    activityType?: string | null;
}

function toQueryString(params: Record<string, string | number | null | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === '') {
            continue;
        }
        search.set(key, String(value));
    }
    const query = search.toString();
    return query ? `?${query}` : '';
}

function asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

export const providerTrackingApi = {
    /** รอบปลูกของฟาร์มทุกแห่งทั้งประเทศ (ไม่กรองตามการมอบหมาย — มติ 2026-09-05) */
    async listCycles(query: TrackingCycleQuery = {}): Promise<TrackingReadResult<TrackingCycleListItem[]>> {
        const result = await apiClient.get<TrackingCycleListItem[]>(
            providerApiPaths.plantingCycles(toQueryString({
                page: query.page,
                limit: query.limit,
                status: query.status,
                q: query.q,
                farmId: query.farmId,
            })),
        );
        if (!result.success) {
            return { ok: false, error: result.error || TRACKING_READ_FAILED_TH };
        }
        return {
            ok: true,
            data: asArray<TrackingCycleListItem>(result.data),
            pagination: toPagination(result.meta),
        };
    },

    async getCycle(cycleId: string): Promise<TrackingReadResult<TrackingCycleDetail>> {
        const result = await apiClient.get<TrackingCycleDetail>(providerApiPaths.plantingCycleDetail(cycleId));
        if (!result.success || !result.data) {
            return { ok: false, error: result.error || TRACKING_READ_FAILED_TH };
        }
        return { ok: true, data: result.data, pagination: null };
    },

    async listActivities(
        cycleId: string,
        query: TrackingActivityQuery = {},
    ): Promise<TrackingReadResult<TrackingActivity[]>> {
        const result = await apiClient.get<TrackingActivity[]>(
            providerApiPaths.plantingCycleActivities(cycleId, toQueryString({
                page: query.page,
                limit: query.limit,
                scope: query.scope,
                activityType: query.activityType,
            })),
        );
        if (!result.success) {
            return { ok: false, error: result.error || TRACKING_READ_FAILED_TH };
        }
        return {
            ok: true,
            data: asArray<TrackingActivity>(result.data),
            pagination: toPagination(result.meta),
        };
    },

    async listPlotQrs(cycleId: string): Promise<TrackingReadResult<TrackingPlotQr[]>> {
        const result = await apiClient.get<TrackingPlotQr[]>(providerApiPaths.plantingCyclePlotQrs(cycleId));
        if (!result.success) {
            return { ok: false, error: result.error || TRACKING_READ_FAILED_TH };
        }
        return { ok: true, data: asArray<TrackingPlotQr>(result.data), pagination: null };
    },
};
