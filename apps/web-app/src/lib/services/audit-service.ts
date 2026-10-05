/**
 * audit-service.ts — Iter 25 client for the audit-scheduling and
 * audit-onsite backend services (B25-A, B25-B).
 *
 * Surfaces consumed by:
 *   • apps/web-app/src/app/provider/scheduler/queue (queue + assign)
 *   • apps/web-app/src/app/provider/audits/[id]/inspect (field-app)
 *
 * Conventions follow the existing `application-service.ts` shape —
 * thin wrappers over `apiClient` returning `ApiResponse<T>`. All
 * endpoints are unprefixed (the apiClient adds `/api` automatically).
 */

import { apiClient, type ApiResponse } from '@/lib/api/api-client';

// ── Scheduling queue types ────────────────────────────────────────────

export interface SchedulingQueueFilters {
    organizationId?: string;
    fromDate?: string;
    toDate?: string;
    status?: string;
    region?: string;
}

export interface SchedulingQueueItem {
    applicationId: string;
    applicationNumber: string;
    applicantName: string;
    applicantNameMasked: string;
    // Optional: the backend queue does not currently carry an exact audit-fee
    // payment date / planting scope / plant type (would need an invoice + formData
    // join). The table renders '-' when absent. ageDays is a queue-wait proxy.
    paymentDate?: string;
    region?: string;
    scope?: string;
    plantType?: string;
    ageDays: number;
    status: string;
    farmAddress?: string;
}

export interface SchedulingQueueSummary {
    totalPending: number;
    byRegion: Array<{ region: string; count: number }>;
    oldestPendingDays: number;
}

export interface SchedulingQueueResponse {
    items: SchedulingQueueItem[];
    summary: SchedulingQueueSummary;
}

export interface AuditorBusySlot {
    applicationId: string;
    applicationNumber: string;
    status: string;
    scheduledDate: string | null;
    estimatedDuration?: number;
}

export interface AuditorOverCapDay {
    day: string;
    count: number;
}

export interface AuditorAvailability {
    auditorId: string;
    auditorName?: string;
    dateRange?: { from: string; to: string };
    /**
     * Busy slots returned by the audit-scheduling-service. Each entry is
     * the application currently scheduled for the auditor on the given
     * date — useful for the modal's 14-day calendar widget.
     */
    busySlots: AuditorBusySlot[];
    /**
     * The service-side per-day cap (e.g. 2 audits/day). Surface in the
     * UI when an OVER_CAP shading appears so the scheduler understands
     * the threshold.
     */
    cap?: number;
    /**
     * Days where the auditor's bookings hit or exceed `cap`. These are
     * the high-risk days the SCHEDULER should AVOID double-booking.
     * V2-C surfaces these with amber shading on the calendar.
     */
    overCapDays: AuditorOverCapDay[];
}

export interface AssignAuditorPayload {
    applicationId: string;
    auditorId: string;
    scheduledDate: string; // YYYY-MM-DD
    scheduledSlot: 'AM' | 'PM';
    location: string;
    notes?: string;
}

// ── Onsite inspection types ───────────────────────────────────────────

export interface GpsPayload {
    latitude: number;
    longitude: number;
    accuracy: number;
    capturedAt: string;
}

export type ChecklistAnswer = 'YES' | 'NO' | 'NA';

export interface ChecklistItemPayload {
    itemId: string;
    answer: ChecklistAnswer;
    notes?: string;
    photoIds?: string[];
}

/** Single canonicalization point: UI answer -> BE checklist response vocab. */
const ANSWER_TO_RESPONSE: Record<ChecklistAnswer, 'PASS' | 'FAIL' | 'NA'> = {
    YES: 'PASS',
    NO: 'FAIL',
    NA: 'NA',
};
export const responseToAnswer: Record<'PASS' | 'FAIL' | 'NA', ChecklistAnswer> = {
    PASS: 'YES',
    FAIL: 'NO',
    NA: 'NA',
};

export type AuditDecisionValue = 'PASS' | 'FAIL' | 'NEEDS_REVIEW';

export interface AuditDecisionPayload {
    decision: AuditDecisionValue;
    summary: string;
    criticalFindings?: string[];
}

export interface AuditPhotoMetadata {
    itemId?: string;
    caption?: string;
    gps?: GpsPayload;
}

// ── API client ────────────────────────────────────────────────────────

export const AuditService = {
    /**
     * Step 2 — Scheduler queue. Lists applications that have paid the
     * audit fee and are awaiting auditor assignment.
     */
    getSchedulingQueue: async (
        filters: SchedulingQueueFilters = {},
    ): Promise<ApiResponse<SchedulingQueueResponse>> => {
        const params = new URLSearchParams();
        if (filters.organizationId) params.set('organizationId', filters.organizationId);
        if (filters.fromDate) params.set('fromDate', filters.fromDate);
        if (filters.toDate) params.set('toDate', filters.toDate);
        if (filters.status) params.set('status', filters.status);
        if (filters.region) params.set('region', filters.region);
        const qs = params.toString();
        return apiClient.get<SchedulingQueueResponse>(
            `/audit/scheduling/queue${qs ? `?${qs}` : ''}`,
        );
    },

    /**
     * Step 3 — Auditor availability for the AssignAuditorModal calendar.
     *
     * Backend (apps/backend/routes/api/audit/scheduling.js:139-152) reads
     * `req.query.from` / `req.query.to`, NOT `fromDate`/`toDate`. The
     * previous param names silently returned 400 (VALIDATION_ERROR) and
     * left the calendar blank — V2-C aligns the query keys.
     */
    getAuditorAvailability: async (
        auditorId: string,
        fromDate: string,
        toDate: string,
    ): Promise<ApiResponse<AuditorAvailability>> => {
        const params = new URLSearchParams({ from: fromDate, to: toDate });
        return apiClient.get<AuditorAvailability>(
            `/audit/scheduling/auditor-availability/${encodeURIComponent(auditorId)}?${params.toString()}`,
        );
    },

    /**
     * Step 3 — Submit the assignment.
     */
    assignAuditor: async (
        payload: AssignAuditorPayload,
    ): Promise<ApiResponse<{ inspectionId: string }>> => {
        return apiClient.post<{ inspectionId: string }>(
            '/audit/scheduling/assign',
            payload,
        );
    },

    /**
     * List of auditors available for the AssignAuditorModal dropdown.
     *
     * V2-C SC-1 (production bug): the previous path
     * `/audit/scheduling/auditors` does NOT exist on the backend — the
     * scheduling router at `apps/backend/routes/api/audit/scheduling.js`
     * only exposes `/queue`, `/assign`, `/:applicationId/reschedule`,
     * `/:rescheduleId/approve`, and `/auditor-availability/:auditorId`.
     * The fetch silently 404'd and the modal's auditor select was always
     * empty → SCHEDULER queue effectively non-functional.
     *
     * Fix: route to the existing working endpoint
     * `/api/provider/scheduler/auditors` whose handler lives at
     * `apps/backend/routes/api/provider/handlers/scheduler-auditors-handler.js`.
     * The handler returns
     * `{ id, providerId, role, canonicalRole, firstName, lastName, fullName }`
     * objects — we surface `fullName` so callers can render the Thai name
     * directly without re-concatenating.
     */
    getAuditors: async (): Promise<
        ApiResponse<
            Array<{
                id: string;
                fullName: string;
                firstName?: string;
                lastName?: string;
                role?: string;
                canonicalRole?: string;
                providerId?: string;
            }>
        >
    > => {
        return apiClient.get<
            Array<{
                id: string;
                fullName: string;
                firstName?: string;
                lastName?: string;
                role?: string;
                canonicalRole?: string;
                providerId?: string;
            }>
        >('/provider/scheduler/auditors');
    },

    /**
     * Step 4.1 — Start the onsite inspection (records GPS check-in).
     */
    startInspection: async (
        auditId: string,
        gps: GpsPayload,
    ): Promise<ApiResponse<{ sessionId: string; startedAt: string }>> => {
        return apiClient.post<{ sessionId: string; startedAt: string }>(
            `/audit/onsite/${encodeURIComponent(auditId)}/start`,
            { gps },
        );
    },

    /**
     * Step 4.1b — physical-presence fraud check (haversine vs farm coords).
     * GETs `/audit/onsite/:auditId/gps-verify?lat=&lng=` (matches
     * `onsite.js` route `GET /:auditId/gps-verify`, which forwards to
     * `audit-onsite-service.js` `verifyGpsAgainstFarm`). Advisory
     * telemetry — callers should surface a warning on
     * `!withinTolerance`, never block on `unknownFarmLocation` or a
     * failed call (fixes B8).
     */
    verifyGps: async (
        auditId: string,
        lat: number,
        lng: number,
    ): Promise<ApiResponse<{
        withinTolerance: boolean;
        distanceMeters: number | null;
        farmLatitude: number | null;
        farmLongitude: number | null;
        toleranceMeters: number;
        unknownFarmLocation: boolean;
    }>> => {
        const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
        return apiClient.get(`/audit/onsite/${encodeURIComponent(auditId)}/gps-verify?${params.toString()}`);
    },

    /**
     * Step 4.2 — Persist a checklist row (save-draft pattern; backend
     * upserts by itemId).
     */
    submitChecklistItem: async (
        auditId: string,
        item: ChecklistItemPayload,
    ): Promise<ApiResponse<{ ok: true }>> => {
        const entry: { itemCode: string; response: 'PASS' | 'FAIL' | 'NA'; notes?: string; photoIds?: string[] } = {
            itemCode: item.itemId,
            response: ANSWER_TO_RESPONSE[item.answer],
        };
        if (item.notes) entry.notes = item.notes;
        if (item.photoIds && item.photoIds.length > 0) entry.photoIds = item.photoIds;
        return apiClient.post<{ ok: true }>(
            `/audit/onsite/${encodeURIComponent(auditId)}/checklist`,
            { items: [entry] },
        );
    },

    /**
     * Step 4.3 — Multipart photo upload. Returns a stable photoId the
     * caller can attach to the checklist item.
     */
    uploadPhoto: async (
        auditId: string,
        file: File,
        metadata: AuditPhotoMetadata = {},
    ): Promise<ApiResponse<{ photoId: string; url: string }>> => {
        const form = new FormData();
        form.append('photo', file);
        if (metadata.itemId) form.append('itemId', metadata.itemId);
        if (metadata.caption) form.append('caption', metadata.caption);
        if (metadata.gps) form.append('gps', JSON.stringify(metadata.gps));
        return apiClient.post<{ photoId: string; url: string }>(
            `/audit/onsite/${encodeURIComponent(auditId)}/photo`,
            form,
        );
    },

    /**
     * Step 4.5 — Submit the auditor's decision (PASS / FAIL /
     * NEEDS_REVIEW). Backend triggers downstream notifications.
     */
    submitDecision: async (
        auditId: string,
        decision: AuditDecisionPayload,
    ): Promise<ApiResponse<{ ok: true }>> => {
        return apiClient.post<{ ok: true }>(
            `/audit/onsite/${encodeURIComponent(auditId)}/decision`,
            decision,
        );
    },

    /* ── DECISION VOCABULARY (V3-C / DI-2) ───────────────────────────
     * Two coexisting auditor decision endpoints with DIFFERENT vocab.
     * Future iterations will consolidate; today both surfaces ship.
     *
     *   1) `POST /audit/onsite/:auditId/decision` (this file, below)
     *      vocab: `'PASS' | 'FAIL' | 'NEEDS_REVIEW'`
     *      caller: `apps/web-app/.../audits/[id]/inspect/client-view.tsx`
     *      backend: `apps/backend/services/audit-onsite-service.js`
     *      workflow target:
     *         PASS         → AUDIT_PASSED
     *         FAIL         → CAR_PENDING
     *         NEEDS_REVIEW → no state transition (review-in-place)
     *
     *   2) `POST /api/provider/auditor/applications/:id/audit-decisions`
     *      vocab: `'PASS' | 'MINOR' | 'MAJOR'`
     *      caller: `apps/web-app/.../audits/[id]/page.tsx`
     *               via `AuditDecisionModal`
     *      backend: `apps/backend/.../auditor-audit-decision-handler.js`
     *      workflow target:
     *         PASS           → AUDIT_PASSED
     *         MINOR | MAJOR  → CAR_PENDING (legacy path also runs the
     *                          GACP score gate at handler:78-98)
     *
     * Both flows produce equivalent workflow states for FAIL / CAR
     * cases, but only the legacy flow (#2) currently runs the
     * gacp-scoring-service gate. Plan: sunset #2 once the inspect flow
     * (#1) gains feature parity (GACP score gate, CAR findings UI,
     * final-approval handshake).
     *
     * Do NOT cross-call the two endpoints from the wrong surface — the
     * vocabularies are not aliases and the backend reject codes differ.
     * ──────────────────────────────────────────────────────────────── */

    /**
     * Field-app step list. Provided by B25-B as the canonical GACP
     * criteria for this audit (scope-dependent). The field-app caches
     * the response locally to avoid re-fetching mid-inspection.
     *
     * The route `[id]` the inspect page holds is the applicationId, NOT
     * an auditId (see client-view.tsx). This resolves the current onsite
     * AuditChecklist server-side and returns the real `audit.id` that
     * every subsequent write (start/checklist/photo/decision) must key
     * off (fixes B2 write-side — spec Task 4/5).
     */
    getOnsiteContext: async (
        applicationId: string,
    ): Promise<
        ApiResponse<{
            audit: {
                id: string;
                applicationId: string;
                applicationNumber: string;
                applicantName: string;
                farmAddress: string;
                farmLat?: number;
                farmLng?: number;
                scope?: string;
            };
            checklist: Array<{
                itemId: string;
                title: string;
                description: string;
                category?: string;
                required?: boolean;
            }>;
            startedAt?: string;
            savedAnswers?: Array<{
                itemId: string;
                answer: ChecklistAnswer;
                notes?: string;
                photoIds?: string[];
            }>;
        }>
    > => {
        const res = await apiClient.get<{
            audit: { id: string; applicationId: string; applicationNumber: string; applicantName: string; farmAddress: string; farmLat?: number; farmLng?: number; scope?: string; };
            checklist: Array<{ itemId: string; title: string; description: string; category?: string; required?: boolean; }>;
            startedAt?: string;
            savedAnswers?: Array<{ itemId: string; response: 'PASS' | 'FAIL' | 'NA'; notes?: string | null; photoIds?: string[] }>;
        }>(`/audit/onsite/application/${encodeURIComponent(applicationId)}/context`);
        if (res.success && res.data?.savedAnswers) {
            const mapped = res.data.savedAnswers.map((s) => {
                const entry: { itemId: string; answer: ChecklistAnswer; notes?: string; photoIds?: string[] } = {
                    itemId: s.itemId,
                    answer: responseToAnswer[s.response],
                    photoIds: s.photoIds ?? [],
                };
                if (s.notes) entry.notes = s.notes;
                return entry;
            });
            return { ...res, data: { ...res.data, savedAnswers: mapped } };
        }
        return res as ApiResponse<any>;
    },
};

export default AuditService;
