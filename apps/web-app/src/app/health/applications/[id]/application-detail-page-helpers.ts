import { FEE_SERVICES_FALLBACK, SERVICE_NAME } from '@/lib/pricing/fee-services';
import {
  type ActionMeta,
  type ApplicationHistoryPayload,
  type WorkflowHistoryEntry,
  toThaiDateTime,
} from './application-detail-page-config';
import { formatBaht, type PublicFees } from '@/lib/pricing/public-fees';
import type { PaymentRecord } from '@/lib/services/payment-service';

/**
 * What the register billed THIS application per phase: the sum of its live
 * (not cancelled) invoices whose phase is read from the invoice itself. null
 * for a phase with no invoice yet. The payment card shows these instead of the
 * per-cultivation-type price (fix/fees-from-server round 1, 2026-10-03).
 */
export function invoiceTotalsByPhase(
  rows: ReadonlyArray<PaymentRecord>,
  applicationId: string,
): { PHASE_1: number | null; PHASE_2: number | null } {
  const totals: { PHASE_1: number | null; PHASE_2: number | null } = { PHASE_1: null, PHASE_2: null };
  for (const row of rows) {
    if (row.applicationId !== applicationId || row.isCancelled || row.type === 'QUOTATION') continue;
    if (row.phase !== 'PHASE_1' && row.phase !== 'PHASE_2') continue;
    totals[row.phase] = (totals[row.phase] ?? 0) + (Number(row.amount) || 0);
  }
  return totals;
}

export type TimelineItem = {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  actor: string;
  isCurrent?: boolean;
};

export type OfficerComment = {
  id: string;
  author: string;
  message: string;
  timestamp: string;
};

export function upper(value?: string | null): string {
  return String(value || '').trim().toUpperCase();
}

export function formatMoney(amount: number): string {
  return amount.toLocaleString('th-TH', { maximumFractionDigits: 0 });
}

export function formatActor(actorRole?: string | null, actorId?: string | null): string {
  const role = upper(actorRole);
  if (role.includes('HEALTH') || role === 'HEALTH') {
    return 'เกษตรกร';
  }
  if (role.includes('field_inspector') || role.includes('REVIEW')) {
    return 'ผู้ตรวจ';
  }
  if (role.includes('COORDINATOR') || role.includes('dispatcher')) {
    return 'ผู้ประสานงาน';
  }
  if (role.includes('HEAD')) {
    return 'หัวหน้าผู้ตรวจ';
  }
  if (role.includes('WEBHOOK') || role.includes('SYSTEM')) {
    return 'ระบบ';
  }
  if (role) {
    return role.toLowerCase();
  }
  return actorId ? `รหัส ${actorId.slice(0, 8)}` : 'ระบบ';
}

export function mapTimelineTitle(entry: WorkflowHistoryEntry): string {
  const action = upper(entry.action);
  const toStatus = upper(entry.toStatus);

  if (action === 'APPLICATION_PREPARED') return 'ร่าง';
  if (action === 'PHASE_1_PAYMENT_CREATED') return `รอชำระ${SERVICE_NAME.PHASE_1}`;
  if (action === 'APPLICATION_FINALIZED_AFTER_PHASE1_PAYMENT') return 'ยื่นแล้ว';
  if (action === 'WORKFLOW_AUTO_FINAL_APPROVED') return 'ผ่านการประเมิน';
  if (action === 'AUDIT_DECISION_RECORDED') return 'บันทึกผลการประเมิน';
  if (action === 'AUDIT_RESCHEDULED') return 'เลื่อนนัดหมายลงพื้นที่';

  if (toStatus === 'SUBMITTED') return 'ยื่นแล้ว';
  if (toStatus === 'IN_REVIEW' || toStatus === 'ASSIGNED_FOR_REVIEW') return 'กำลังตรวจเอกสาร';
  if (toStatus === 'DOCUMENT_APPROVED' || toStatus === 'DOC_APPROVED') return 'เอกสารผ่าน';
  // round 5: a renewal reaches PENDING_AUDIT_FEE too, and this history label has no
  // application at hand — so it names no instalment (operator 2026-10-03).
  if (toStatus === 'PAYMENT_2_PENDING' || toStatus === 'PENDING_AUDIT_FEE') return 'รอชำระค่าบริการ';
  if (toStatus === 'AWAITING_SCHEDULE' || toStatus === 'AUDIT_CONFIRMED' || toStatus === 'AUDIT_SCHEDULED') return 'นัดหมายลงพื้นที่';
  if (toStatus === 'AUDIT_IN_PROGRESS') return 'ประเมินหน้างาน';
  if (toStatus === 'CAR_PENDING') return 'ต้องแก้ไขข้อบกพร่อง';
  if (toStatus === 'CAR_REVIEWING') return 'กำลังตรวจการแก้ไขข้อบกพร่อง';
  if (toStatus === 'AUDITED' || toStatus === 'AUDIT_PASSED' || toStatus === 'APPROVED') return 'รอพิจารณาอนุมัติ';
  if (toStatus === 'CERTIFIED') return 'ได้รับใบรับรอง';

  if (action.startsWith('WORKFLOW_') && toStatus) {
    return toStatus.replace(/_/g, ' ').toLowerCase();
  }
  return action ? action.replace(/_/g, ' ').toLowerCase() : 'อัปเดตสถานะ';
}

export function buildTimeline(history?: ApplicationHistoryPayload | null): TimelineItem[] {
  const events = Array.isArray(history?.workflowHistory) ? history!.workflowHistory : [];
  if (events.length === 0) {
    return [];
  }

  return events
    .map((entry, index) => ({
      id: `${entry.index || index}-${entry.timestamp || index}`,
      title: mapTimelineTitle(entry),
      description: String(entry.comment || entry.reason || '').trim() || 'ไม่มีหมายเหตุเพิ่มเติม',
      timestamp: toThaiDateTime(entry.timestamp),
      actor: formatActor(entry.actorRole, entry.actorId),
      isCurrent: index === events.length - 1,
    }));
}

export function buildOfficerComments(history?: ApplicationHistoryPayload | null): OfficerComment[] {
  const workflowComments = (history?.workflowHistory || [])
    .filter((entry) => String(entry.comment || '').trim().length > 0)
    .map((entry, index) => ({
      id: `wf-${index}-${entry.timestamp || ''}`,
      author: formatActor(entry.actorRole, entry.actorId),
      message: String(entry.comment || '').trim(),
      timestamp: toThaiDateTime(entry.timestamp),
    }));

  const directComments = (history?.comments || [])
    .filter((entry) => String(entry.commentText || '').trim().length > 0)
    .map((entry) => ({
      id: `cm-${entry.id}`,
      author: formatActor(entry.type, entry.auditorId),
      message: String(entry.commentText || '').trim(),
      timestamp: toThaiDateTime(entry.createdAt),
    }));

  return [...directComments, ...workflowComments]
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, 8);
}

/** "<label> ฿6,420 ต่อขอบเขต" with the served amount, or the bare label without one. */
function withPerScopeAmount(label: string, amount: number | null): string {
  return amount === null ? label : `${label} ฿${formatBaht(amount)} ต่อขอบเขต`;
}

export function resolveActionTarget(
  actionKey: string,
  applicationId: string,
  actionMeta: ActionMeta,
  fees: PublicFees | null = null,
  renewal: { isRenewal?: boolean | undefined; amount?: number | null } = {},
): { href: string; label: string } | null {
  const key = upper(actionKey);
  // round 3 (operator 2026-10-03): a renewal's one charge is named as the renewal service
  // and carries THIS application's renewal amount (its invoice, else its quotation, else
  // the served renewal price × its cultivation types) — never the phase-2 per-type price.
  if (key === 'PAY_AUDIT_FEE' && renewal.isRenewal) {
    const label = `ชำระ${FEE_SERVICES_FALLBACK.RENEWAL.name}`;
    return {
      href: `/health/payments?app=${applicationId}&phase=PHASE_2`,
      label: typeof renewal.amount === 'number' ? `${label} ฿${formatBaht(renewal.amount)}` : label,
    };
  }
  if (key === 'PAY_DOC_FEE') {
    return {
      href: `/health/payments?app=${applicationId}&phase=PHASE_1`,
      label: withPerScopeAmount(actionMeta.buttonLabel || 'ชำระงวดที่ 1', fees ? fees.phase1TotalPerScope : null),
    };
  }
  if (key === 'PAY_AUDIT_FEE') {
    return {
      href: `/health/payments?app=${applicationId}&phase=PHASE_2`,
      // A known new filing names its instalment; unknown keeps the neutral meta label.
      label: withPerScopeAmount(renewal.isRenewal === false ? 'ชำระงวดที่ 2' : (actionMeta.buttonLabel || 'ชำระค่าบริการ'), fees ? fees.phase2TotalPerScope : null),
    };
  }
  if (key === 'SUBMIT_REVISION') {
    return { href: `/health/applications/${applicationId}/edit`, label: actionMeta.buttonLabel || 'แก้ไขและส่งข้อมูลใหม่' };
  }
  if (key === 'SUBMIT_CAR_EVIDENCE') {
    return { href: `/health/applications/${applicationId}/car`, label: actionMeta.buttonLabel || 'ส่งหลักฐาน CAR' };
  }
  if (key === 'DOWNLOAD_CERTIFICATE') {
    return { href: '/health/certificates', label: actionMeta.buttonLabel || 'ไปที่ใบรับรอง' };
  }
  // CONTINUE_DRAFT means: this user has an in-progress draft, send them
  // back to THIS specific draft via the edit page. Routing to /new (a
  // blank form) is the bug reported on 2026-05-02 — the user pressed
  // "ดำเนินการต่อ" expecting to resume APP-2569-MOOJ3HDI-CFF529 and
  // instead got an empty wizard.
  //
  // The edit page (apps/web-app/src/app/health/applications/[id]/edit/
  // client-view.tsx) handles DRAFT status (line 102 editableStatuses
  // already includes 'DRAFT') and hydrates the wizard store from
  // application data via handleStartEdit() before navigating to the
  // wizard. That's the path the user expects.
  if (key === 'CONTINUE_DRAFT') {
    return {
      href: `/health/applications/${applicationId}/edit`,
      label: actionMeta.buttonLabel || 'ดำเนินการต่อ',
    };
  }

  // REAPPLY is different — previous app is REJECTED / EXPIRED / CANCELLED,
  // so a new application makes sense (no draft to resume).
  if (key === 'REAPPLY') {
    return {
      href: '/health/applications/new',
      label: actionMeta.buttonLabel || 'ยื่นคำขอใหม่',
    };
  }
  return null;
}

/**
 * Optional canonical phase status that the backend now returns alongside
 * application detail. When present, these are the SOURCE OF TRUTH for
 * "did the applicant already pay phase 1 / phase 2?". Falls back to
 * workflow-history inference for older payloads that don't carry these.
 */
export interface PaymentFactsCanonical {
  phase1Status?: string | null;
  phase1PaidAt?: string | null;
  phase2Status?: string | null;
  phase2PaidAt?: string | null;
}

export function resolvePaymentFacts(
  status: string,
  history?: ApplicationHistoryPayload | null,
  canonical?: PaymentFactsCanonical | null,
) {
  // Prefer canonical phase columns from the DB when the backend included them.
  // Fixes the case (real prod 2026-04-28) where status=REGISTERED but
  // phase1Status=PAID — workflow-history inference alone said docPaid=false
  // and the application detail page rendered the wrong action card.
  if (canonical?.phase1Status || canonical?.phase2Status) {
    const docPaidByColumn = upper(canonical.phase1Status || '') === 'PAID';
    const auditPaidByColumn = upper(canonical.phase2Status || '') === 'PAID';
    return {
      docPaid: docPaidByColumn,
      auditPaid: auditPaidByColumn,
      docPaidAt: canonical.phase1PaidAt || null,
      auditPaidAt: canonical.phase2PaidAt || null,
    };
  }

  // Fallback: infer from workflow text. Older API responses without the
  // canonical columns still need to render correctly.
  const allStatuses = new Set<string>([upper(status)]);
  for (const row of history?.workflowHistory || []) {
    if (row.fromStatus) allStatuses.add(upper(row.fromStatus));
    if (row.toStatus) allStatuses.add(upper(row.toStatus));
  }

  const docPaidMarkers = new Set([
    'DOC_FEE_PAID',
    'SUBMITTED',
    'ASSIGNED_FOR_REVIEW',
    'REVISION_REQUESTED',
    'DOC_APPROVED',
    'PENDING_AUDIT_FEE',
    'PAYMENT_2_PENDING',
    'AUDIT_FEE_PAID',
    'AWAITING_SCHEDULE',
    'AUDIT_CONFIRMED',
    'AUDIT_IN_PROGRESS',
    'AUDIT_PASSED',
    'AUDITED',
    'APPROVED',
    'CERTIFIED',
    'DOCUMENT_APPROVED',
    'IN_REVIEW',
  ]);

  const auditPaidMarkers = new Set([
    'AUDIT_FEE_PAID',
    'AWAITING_SCHEDULE',
    'AUDIT_CONFIRMED',
    'AUDIT_SCHEDULED',
    'AUDIT_IN_PROGRESS',
    'CAR_PENDING',
    'CAR_REVIEWING',
    'AUDIT_PASSED',
    'AUDITED',
    'APPROVED',
    'CERTIFIED',
  ]);

  const docPaid = [...allStatuses].some((item) => docPaidMarkers.has(item));
  const auditPaid = [...allStatuses].some((item) => auditPaidMarkers.has(item));

  const docPaidEvent = (history?.workflowHistory || []).find((entry) => {
    const action = upper(entry.action);
    const toStatus = upper(entry.toStatus);
    return action === 'APPLICATION_FINALIZED_AFTER_PHASE1_PAYMENT' || toStatus === 'DOC_FEE_PAID' || toStatus === 'SUBMITTED';
  });

  const auditPaidEvent = (history?.workflowHistory || []).find((entry) => {
    const action = upper(entry.action);
    const toStatus = upper(entry.toStatus);
    return action === 'PHASE_2_PAYMENT_CREATED' || toStatus === 'AUDIT_FEE_PAID' || toStatus === 'AWAITING_SCHEDULE';
  });

  return {
    docPaid,
    auditPaid,
    docPaidAt: docPaidEvent?.timestamp || null,
    auditPaidAt: auditPaidEvent?.timestamp || null,
  };
}
