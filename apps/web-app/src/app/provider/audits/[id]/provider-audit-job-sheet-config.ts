import { PURPOSE_LICENCE_DOCUMENTS } from '@/lib/certification-purposes';
export type InspectionMode = "ONLINE_MEET" | "ONSITE";
export type AuditDecision = "PASS" | "MINOR" | "MAJOR" | "REJECT";

export interface ApplicationData {
    id: string;
    applicationNumber: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    health?: {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
    };
    applicant?: {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
    };
    formData?: Record<string, unknown>;
    workflowHistory?: Array<Record<string, unknown>>;
}

export interface AuditLogItem {
    id: string;
    action: string;
    actorId?: string;
    actorRole?: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
}

export interface AuditTimelineData {
    application: {
        id: string;
        applicationNumber: string;
        status: string;
        workflowState: string;
    };
    workflowHistory: Array<Record<string, unknown>>;
    auditLogs: AuditLogItem[];
}

export interface AuditorQueueItem {
    id: string;
    applicationId: string;
    applicationNumber: string;
    status: string;
    workflowState: string;
    scheduledDate: string | null;
    inspectionMode: InspectionMode;
    meetingLink: string | null;
    mapLink: string | null;
    location: string | null;
    receiptIssued: boolean;
    canStartInspection: boolean;
    canSubmitDecision: boolean;
}

export interface AuditorDashboardData {
    queues: {
        todayUpcoming: { total: number; items: AuditorQueueItem[] };
        inProgress: { total: number; items: AuditorQueueItem[] };
        followUps: { total: number; items: AuditorQueueItem[] };
    };
}

export interface AuditEvidenceFile {
    file: File;
    id: string;
    originalSize: number;
    compressedSize: number;
}

import { apiClient } from '@/lib/api/api-client';
import { THAI_TIME_ZONE, bangkokDateParts } from '@/lib/format/thai-date';

export async function providerRequest<T>(path: string, init?: RequestInit): Promise<{ success: boolean; data?: T; error?: string }> {
    // Use apiClient for canonical cookie-based auth
    // The path from providerApiPaths already includes /api/ prefix, strip it for apiClient
    const cleanPath = path.startsWith('/api/') ? path.slice(4) : path;

    if (init?.method === 'POST') {
        const body = init.body ? JSON.parse(init.body as string) : undefined;
        return apiClient.post<T>(cleanPath, body);
    }

    return apiClient.get<T>(cleanPath);
}

// X3-FIX-A / H-2 — Thai-localised date format. Previously this helper
// returned `date.toLocaleString()` which fell back to the browser's
// default locale; on the SCHEDULER/AUDITOR pages that meant English
// (en-US/en-GB) text inside an otherwise Thai surface. Pinning the
// locale to 'th-TH' aligns the job-sheet with the rest of the auditor
// shell (queue rows already use 'th-TH'). No snapshot tests pin the
// old format.
export function toDateText(value: string | null | undefined): string {
    if (!value) {
        return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }
    // Epoch-sentinel guard: an unset date often arrives as the Unix epoch
    // ("1970-01-01" → "1/1/2513" BE) rather than null — a valid Date object,
    // so the NaN check above lets it through. No GACP date predates the 2025
    // platform launch, so treat anything before year 2000 as "no date" (same
    // spirit as the guarded formatThaiDate in lib/format/thai-date.ts). Seen
    // on the auditor job-sheet header for a CAR app with no scheduledDate.
    if ((bangkokDateParts(date)?.year ?? 0) < 2000) {
        return "-";
    }
    return date.toLocaleString('th-TH', { timeZone: THAI_TIME_ZONE });
}

export function getApplicantName(application: ApplicationData | null): string {
    if (!application) {
        return "-";
    }
    const profile = application.health || application.applicant;
    const firstName = String(profile?.firstName || "").trim();
    const lastName = String(profile?.lastName || "").trim();
    const fullName = `${firstName} ${lastName}`.trim();
    return fullName || "-";
}

export function getRevisionDue(formData: Record<string, unknown> | undefined): string | null {
    if (!formData) {
        return null;
    }
    // P0-1: the CAR path stamps `carDueAt`/`car_due_at` (auditor-audit-decision-
    // handler.js) — NOT revisionDueAt — so the auditor's job-sheet countdown read
    // null for every CAR and the 5-working-day SLA clock was invisible on the
    // surface that owns it. Fall back to the CAR keys (the applicant side already
    // reads `carDueAt`, so it is the canonical key).
    const direct = formData.revisionDueAt || formData.revision_due_at
        || formData.carDueAt || formData.car_due_at;
    return typeof direct === "string" ? direct : null;
}

export function getRevisionCountdownLabel(revisionDueAt: string | null): { text: string; color: string } | null {
    if (!revisionDueAt) {
        return null;
    }
    const dueDate = new Date(revisionDueAt);
    if (Number.isNaN(dueDate.getTime())) {
        return null;
    }
    const diffMs = dueDate.getTime() - Date.now();
    const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    // X3-FIX-A / H-2 — Thai badge copy. The surrounding job-sheet
    // surface is Thai; the countdown label was the lone English string.
    if (diffDays < 0) {
        return { text: `เกินกำหนด ${Math.abs(diffDays)} วัน`, color: "red" };
    }
    if (diffDays <= 2) {
        return { text: `ครบกำหนดภายใน ${diffDays} วัน`, color: "orange" };
    }
    return { text: `ครบกำหนดภายใน ${diffDays} วัน`, color: "teal" };
}

// X3-FIX-A / H-2 — Thai labels for the AUDITOR document list. These
// labels render in the "เอกสารประกอบ" panel of the application tab.
// The three licence rows (ภ.ท. 09/10/11, the issued licence behind each application
// purpose) come from lib/certification-purposes.ts, code included, for DTAM compliance staff.
export const ATTACHMENT_KEYS: Array<{ key: string; label: string }> = [
    { key: "idCardDoc", label: "บัตรประชาชน" },
    { key: "houseRegDoc", label: "ทะเบียนบ้าน" },
    { key: "criminalBgDoc", label: "ใบรับรองประวัติอาชญากร" },
    ...PURPOSE_LICENCE_DOCUMENTS.map(({ key, name }) => ({ key, label: name })),
    { key: "LAND_TITLE", label: "เอกสารสิทธิ์ที่ดิน" },
    { key: "SITE_MAP", label: "แผนผังพื้นที่" },
    { key: "WATER_TEST", label: "ผลตรวจน้ำ" },
    { key: "SOIL_TEST", label: "ผลตรวจดิน" },
    { key: "SOP_MANUAL", label: "คู่มือ SOP" },
    { key: "GACP_CERTIFICATE", label: "ใบรับรอง GACP" },
];
