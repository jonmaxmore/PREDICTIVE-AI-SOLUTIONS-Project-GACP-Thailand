import { STATUS_LABELS as WORKFLOW_STATUS_LABELS } from '@/lib/constants/workflow-states';
import { normalizeRole } from '@/lib/constants/canonical-roles';
import { THAI_TIME_ZONE } from '@/lib/format/thai-date';

export interface ProviderUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  canonicalRole?: string | null;
}

export interface QueuePayload {
  id: string;
  applicationId?: string;
  applicationNumber?: string;
  applicantName?: string;
  applicant?: { firstName?: string; lastName?: string };
  health?: { firstName?: string; lastName?: string };
  workflowState?: string;
  status?: string;
  priorityLevel?: string;
  sla?: { isOverdue?: boolean };
  createdAt?: string;
  submittedAt?: string;
  scheduledDate?: string;
  updatedAt?: string;
  dueAt?: string;
  reviewerName?: string;
  auditorName?: string;
  // C3 ("งานนี้พาสไปที่ใคร"): who assigned this case to the reviewer (display
  // name resolved server-side), so the reviewer queue can show the job's origin.
  assignedByName?: string | null;
  evidenceCount?: number;
  inspectionMode?: string;
  overdue?: boolean;
}

export interface QueueItem {
  id: string;
  applicationNumber: string;
  applicantName: string;
  stageCode: string;
  stageLabel: string;
  priorityLabel: string;
  submittedDate: string;
  updatedDate: string;
  actionHref: string;
  isOverdue: boolean;
  // C3 ("งานนี้พาสไปที่ใคร"): display name of whoever assigned the case (null
  // when unknown / not applicable), surfaced on the reviewer queue rows.
  assignedByName?: string | null;
}

export interface TraceItem {
  id: string;
  event: string;
  actor: string;
  occurredAt: string;
  evidenceCount: number;
}

export interface DashboardMetrics {
  newToday: number;
  slaBreached: number;
  awaitingResponse: number;
  totalQueue: number;
}

export const EMPTY_METRICS: DashboardMetrics = {
  newToday: 0,
  slaBreached: 0,
  awaitingResponse: 0,
  totalQueue: 0,
};

export interface DashboardQueues {
  pendingReview?: { items: QueuePayload[] };
  awaitingRevision?: { items: QueuePayload[] };
  approvedWaitingPhase2?: { items: QueuePayload[] };
}

export interface DashboardKpi {
  reviewedToday?: number;
  overdueOrExpired?: number;
  pending?: number;
  // B1 launchpad: the reviewer-dashboard endpoint also returns dueIn48h
  // (awaitingRevision items whose SLA is due soon) — surfaced as a
  // dedicated warning KPI tile. Kept optional so the fallback path (admin /
  // applications list) which never populates it stays type-safe.
  dueIn48h?: number;
}

// V-02 (audit 2026-06-10): the provider dashboard queue rendered ENGLISH status
// labels because this module defined its OWN English STATUS_LABELS that shadowed the
// canonical Thai map — and it was missing REJECTED/EXPIRED states (so
// REJECTED fell through to the raw enum). Use the canonical Thai labels from
// workflow-states.ts (single source of truth, Thai-first). Re-exported under the same
// name so any caller keeps working; widened to Record<string,string> for string lookup.
export const STATUS_LABELS: Record<string, string> = WORKFLOW_STATUS_LABELS;

/**
 * ชื่อบทบาทตามคำศัพท์กลาง
 *
 * เดิมฟังก์ชันนี้เป็น **สำเนาที่สาม** ของตารางแปลชื่อ (backend หนึ่ง, lib/constants หนึ่ง,
 * ที่นี่อีกหนึ่ง) และมันเพี้ยนจากตัวจริงไปแล้วจริง ๆ: มันยุบ approver/final_approver เข้า
 * 'field_inspector' ตามมติ 2026-06-05 ที่ถูกกลับไปแล้วเมื่อ 2026-09-10 · การรีเนมรอบนี้จึงทำให้
 * หน้าแดชบอร์ดเรียก endpoint ผิดเงียบ ๆ เพราะมันตอบคำเดิมที่ไม่มีใครเทียบด้วยอีกแล้ว
 *
 * เหลือแหล่งเดียว: อ่านจาก canonical-roles.ts ตรง ๆ · ค่าที่แปลไม่ออกคืนคำเดิมแบบตัวพิมพ์
 * เล็ก เหมือนพฤติกรรมเดิม เพื่อให้ผู้เรียกที่เทียบค่าที่ยังไม่รู้จักไม่พังกะทันหัน
 */
export function normalizeProviderRole(role: string | undefined): string {
  return normalizeRole(role) ?? String(role || '').trim().toLowerCase();
}

export function formatDateTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('th-TH', {
    timeZone: THAI_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateShort(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('th-TH', { timeZone: THAI_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });
}

export function getApplicantName(payload: QueuePayload): string {
  if (payload.applicantName) return payload.applicantName;
  const applicantName = [payload.applicant?.firstName, payload.applicant?.lastName].filter(Boolean).join(' ').trim();
  if (applicantName) return applicantName;
  const healthName = [payload.health?.firstName, payload.health?.lastName].filter(Boolean).join(' ').trim();
  if (healthName) return healthName;
  return '-';
}

export function getPriorityLabel(payload: QueuePayload): string {
  const priorityFromApi = String(payload.priorityLevel || '').trim();
  if (priorityFromApi) return priorityFromApi;
  if (payload.sla?.isOverdue || payload.overdue) return 'High';
  const stageCode = String(payload.workflowState || payload.status || '').toUpperCase();
  if (stageCode === 'REVISION_REQUESTED' || stageCode === 'CAR_PENDING') return 'Medium';
  return 'Normal';
}

export function toQueueItem(payload: QueuePayload): QueueItem {
  const applicationId = String(payload.id || payload.applicationId || '');
  const stageCode = String(payload.workflowState || payload.status || '').toUpperCase();
  const stageLabel = STATUS_LABELS[stageCode] || stageCode || '-';
  const applicationNumber =
    String(payload.applicationNumber || '').trim() ||
    (applicationId ? `APP-${applicationId.slice(-6).toUpperCase()}` : '-');
  const submittedDateSource = payload.submittedAt || payload.createdAt || payload.scheduledDate || payload.updatedAt;
  const updatedDateSource = payload.updatedAt || payload.scheduledDate || payload.createdAt || payload.submittedAt;

  return {
    id: applicationId || applicationNumber,
    applicationNumber,
    applicantName: getApplicantName(payload),
    stageCode,
    stageLabel,
    priorityLabel: getPriorityLabel(payload),
    submittedDate: formatDateShort(submittedDateSource),
    updatedDate: formatDateShort(updatedDateSource),
    actionHref: applicationId ? `/provider/applications/${applicationId}` : '/provider/applications',
    isOverdue: Boolean(payload.sla?.isOverdue || payload.overdue),
    assignedByName: payload.assignedByName ?? null,
  };
}

export function toTraceItems(items: QueueItem[]): TraceItem[] {
  return items.slice(0, 8).map((item, index) => ({
    id: `${item.id}-${index}`,
    event: `${item.applicationNumber} - ${item.stageLabel}`,
    actor: item.applicantName || '-',
    occurredAt: item.updatedDate,
    evidenceCount: item.isOverdue ? 2 : 1,
  }));
}

export function calculateFallbackMetrics(items: QueueItem[]): DashboardMetrics {
  // Today's Bangkok day, in the SAME format as submittedDate (formatDateShort);
  // the old bare toLocaleDateString('th-TH') never matched it.
  const today = formatDateShort(new Date().toISOString());
  const newToday = items.filter((item) => item.submittedDate === today).length;
  const awaitingResponse = items.filter((item) => item.stageCode === 'REVISION_REQUESTED' || item.stageCode === 'CAR_REVIEWING').length;
  const slaBreached = items.filter((item) => item.isOverdue || item.priorityLabel.toLowerCase() === 'high').length;
  return {
    newToday,
    awaitingResponse,
    slaBreached,
    totalQueue: items.length,
  };
}
