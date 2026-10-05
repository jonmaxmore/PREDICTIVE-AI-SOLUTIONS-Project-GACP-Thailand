export interface SchedulerQueueItem {
    id: string;
    applicationId: string;
    applicationNumber: string;
    applicantName: string;
    status: string;
    workflowState: string;
    phase2Paid: boolean;
    receiptIssued: boolean;
    auditorId: string | null;
    auditorName: string | null;
    scheduledDate: string | null;
    inspectionMode: "ONLINE_MEET" | "ONSITE";
    meetingLink: string | null;
    mapLink: string | null;
    location: string | null;
    notes: string | null;
    estimatedDuration: number;
    isRescheduleRequired: boolean;
    overdueDays: number;
}

export interface SchedulerCalendarEvent {
    applicationId: string;
    applicationNumber: string;
    applicantName: string;
    scheduledDate: string;
    inspectionMode: "ONLINE_MEET" | "ONSITE";
    auditorName: string | null;
    meetingLink: string | null;
    mapLink: string | null;
    location: string | null;
}

export interface SchedulerDashboardData {
    queues: {
        readyToSchedule: { total: number; items: SchedulerQueueItem[] };
        scheduledUpcoming: { total: number; items: SchedulerQueueItem[] };
        rescheduleRequired: { total: number; items: SchedulerQueueItem[] };
    };
    calendar: {
        events: SchedulerCalendarEvent[];
    };
    kpi: {
        scheduledToday: number;
        scheduledThisWeek: number;
        // Must match the key the backend scheduler-dashboard-handler.js emits
        // (`pendingScheduling`). A global AUDIT_FEE_PAID rename once drifted this
        // to `pendingAUDIT_FEE_PAID`, so the tile silently rendered 0. The sibling
        // /coordinator page already reads the correct `pendingScheduling`.
        pendingScheduling: number;
        rescheduleBacklog: number;
        onlineVsOnsite: {
            online: number;
            onsite: number;
            ratio: number;
        };
    };
}

export interface AuditorOption {
    id: string;
    providerId: string | null;
    fullName: string;
}

export const EMPTY_DASHBOARD: SchedulerDashboardData = {
    queues: {
        readyToSchedule: { total: 0, items: [] },
        scheduledUpcoming: { total: 0, items: [] },
        rescheduleRequired: { total: 0, items: [] },
    },
    calendar: { events: [] },
    kpi: {
        scheduledToday: 0,
        scheduledThisWeek: 0,
        pendingScheduling: 0,
        rescheduleBacklog: 0,
        onlineVsOnsite: { online: 0, onsite: 0, ratio: 0 },
    },
};
