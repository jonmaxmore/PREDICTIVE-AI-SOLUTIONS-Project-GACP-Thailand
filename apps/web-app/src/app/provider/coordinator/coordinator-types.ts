/* ────────────────────────── Coordinator Types ────────────────────────── */

export interface SchedulerQueueItem {
  applicationId: string;
  applicationNumber: string;
  applicantName: string;
  status: string;
  workflowState: string;
  auditorId: string | null;
  auditorName: string | null;
  // C3 ("งานนี้พาสไปที่ใคร"): the assigned document reviewer (null until assigned),
  // so the coordinator can see who an already-assigned case was passed to.
  reviewerId: string | null;
  reviewerName: string | null;
  scheduledDate: string | null;
  inspectionMode: "ONLINE_MEET" | "ONSITE";
  meetingLink: string | null;
  mapLink: string | null;
  location: string | null;
  phase2Paid: boolean;
  receiptIssued: boolean;
  isRescheduleRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEvent {
  applicationId: string;
  applicationNumber: string;
  applicantName: string;
  scheduledDate: string | null;
  inspectionMode: "ONLINE_MEET" | "ONSITE";
  auditorName: string | null;
  location: string | null;
}

export interface SchedulerDashboard {
  queues: {
    readyForReview: { total: number; items: SchedulerQueueItem[] };
    readyToSchedule: { total: number; items: SchedulerQueueItem[] };
    scheduledUpcoming: { total: number; items: SchedulerQueueItem[] };
    rescheduleRequired: { total: number; items: SchedulerQueueItem[] };
  };
  pipeline: {
    submitted: number;
    pendingDocFee: number;
    docFeePaid: number;
    assignedForReview: number;
    docApproved: number;
    pendingAuditFee: number;
    auditFeePaid: number;
    auditConfirmed: number;
  };
  calendar: { events: CalendarEvent[] };
  kpi: {
    scheduledToday: number;
    scheduledThisWeek: number;
    pendingScheduling: number;
    rescheduleBacklog: number;
    // P1-H (Wave-3): scheduler-group work activities that are overdue
    // (dueAt < now) or breached (breachedAt != null). Danger-tone tile.
    overdue: number;
    onlineVsOnsite: { online: number; onsite: number };
  };
}

export interface ReviewerOption {
  id: string;
  fullName: string;
  role: string;
  canonicalRole: string;
}

export interface UrgentItem {
  id: string;
  applicationNumber: string;
  applicantName: string;
  status: string;
  hoursStuck: number;
  severity: "CRITICAL" | "WARNING" | "INFO";
}

export interface UrgentMonitorData {
  stuckItems: UrgentItem[];
  deadlineItems: Array<UrgentItem & { hoursLeft: number; deadlineDue: string }>;
  summary: {
    totalStuck: number;
    critical: number;
    warning: number;
    approachingDeadlines: number;
  };
}

export interface AuditorWorkloadItem {
  id: string;
  name: string;
  role: string;
  activeAssignments: number;
  completedLast30Days: number;
  capacity: number;
  utilizationPct: number;
  availability: "AVAILABLE" | "BUSY" | "FULL";
}

export interface AuditorWorkloadData {
  auditors: AuditorWorkloadItem[];
  summary: {
    totalAuditors: number;
    available: number;
    busy: number;
    full: number;
    totalActiveAssignments: number;
  };
}

export const EMPTY: SchedulerDashboard = {
  queues: {
    readyForReview: { total: 0, items: [] },
    readyToSchedule: { total: 0, items: [] },
    scheduledUpcoming: { total: 0, items: [] },
    rescheduleRequired: { total: 0, items: [] },
  },
  pipeline: {
    submitted: 0, pendingDocFee: 0, docFeePaid: 0, assignedForReview: 0,
    docApproved: 0, pendingAuditFee: 0, auditFeePaid: 0, auditConfirmed: 0,
  },
  calendar: { events: [] },
  kpi: {
    scheduledToday: 0,
    scheduledThisWeek: 0,
    pendingScheduling: 0,
    rescheduleBacklog: 0,
    overdue: 0,
    onlineVsOnsite: { online: 0, onsite: 0 },
  },
};
