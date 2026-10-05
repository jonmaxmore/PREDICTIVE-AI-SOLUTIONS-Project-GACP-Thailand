import { apiClient } from '@/lib/api/api-client';

export type InspectionMode = "ONLINE_MEET" | "ONSITE";

export interface AuditorQueueItem {
    id: string;
    applicationId: string;
    applicationNumber: string;
    applicantName: string;
    status: string;
    workflowState: string;
    phase2Paid: boolean;
    receiptIssued: boolean;
    scheduledDate: string | null;
    inspectionMode: InspectionMode;
    meetingLink: string | null;
    mapLink: string | null;
    location: string | null;
    canStartInspection: boolean;
    canSubmitDecision: boolean;
    isMinorFollowup: boolean;
    isMajorRescheduleRequired: boolean;
}

export interface AuditorCalendarEvent {
    applicationId: string;
    applicationNumber: string;
    applicantName: string;
    scheduledDate: string | null;
    inspectionMode: InspectionMode;
    meetingLink: string | null;
    mapLink: string | null;
    location: string | null;
    canStartInspection: boolean;
}

export interface AuditorDashboardData {
    queues: {
        todayUpcoming: { total: number; items: AuditorQueueItem[] };
        inProgress: { total: number; items: AuditorQueueItem[] };
        followUps: { total: number; items: AuditorQueueItem[] };
    };
    calendar: { events: AuditorCalendarEvent[] };
    kpi: {
        // Must match the key the backend auditor-dashboard-handler.js emits
        // (`auditedToday`). A global AUDIT_PASSED rename once drifted this to
        // `AUDIT_PASSEDToday`, so the tile silently rendered 0 (never matched BE).
        auditedToday: number;
        scheduledThisWeek: number;
        pendingResults: number;
        minorFollowups: number;
        majorTriggers: number;
        // P1-H (Wave-3): past-due onsite inspections (scheduled < now, still
        // AUDIT_CONFIRMED). Surfaced as a danger-tone KPI tile.
        overdue: number;
    };
}

export interface FinalApprovalItem {
    id: string;
    applicationNumber: string;
    applicantName: string;
    status: string;
    updatedAt: string;
    createdAt: string;
}

export const EMPTY_DASHBOARD: AuditorDashboardData = {
    queues: {
        todayUpcoming: { total: 0, items: [] },
        inProgress: { total: 0, items: [] },
        followUps: { total: 0, items: [] },
    },
    calendar: { events: [] },
    kpi: {
        auditedToday: 0,
        scheduledThisWeek: 0,
        pendingResults: 0,
        minorFollowups: 0,
        majorTriggers: 0,
        overdue: 0,
    },
};

export async function PROVIDERRequest<T>(path: string, init?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> {
    const cleanPath = path.startsWith('/api/') ? path.slice(4) : path;

    if (init?.method === 'POST') {
        const body = init.body ? JSON.parse(init.body as string) : undefined;
        return apiClient.post<T>(cleanPath, body);
    }

    return apiClient.get<T>(cleanPath);
}

export const _getStatusColor = (workflowState: string): string => {
    const state = String(workflowState || "").toUpperCase();
    if (state === "AUDIT_CONFIRMED" || state === "CAR_REVIEWING") {
        return "orange";
    }
    if (state === "AUDIT_PASSED" || state === "APPROVED" || state === "CERTIFIED") {
        return "teal";
    }
    if (state === "AUDIT_FEE_PAID" || state === "CAR_PENDING") {
        return "red";
    }
    return "blue";
};
