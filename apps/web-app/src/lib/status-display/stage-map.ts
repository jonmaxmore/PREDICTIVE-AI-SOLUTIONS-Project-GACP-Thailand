import { SERVICE_NAME } from '@/lib/pricing/fee-services';
/**
 * stage-map.ts — THE single mapping from the 20-state workflow vocabulary
 * to the 5 display steps shown on /health/status (N8, tile-home-redesign).
 * No copies anywhere else — import `mapStatusToDisplay` instead of
 * re-deriving this table.
 *
 * Vocabulary source (task-6 pre-flight ruling): the brief presumed
 * `import { ALL_WORKFLOW_STATUSES } from '@/lib/workflow-status'` — that
 * module does not exist in this FE. The real canonical FE status list is
 * `WORKFLOW_STATES` / `WorkflowState` in `@/lib/constants/workflow-states.ts`
 * (20 states, mirrors the backend SSOT at
 * apps/backend/services/workflow-transition-service.js:18-39) — already the
 * import used by application-detail-page-config.ts, provider dashboard-
 * utils.ts, etc. Do NOT import from apps/backend.
 *
 * Derivation of the 5-step collapse. The repo has no S0-S6 table anywhere
 * (confirmed at reports/role-workflow-auditor/2026-08-06-reviewer.md:11);
 * the closest documented frame is that report's own 7-stage read of the
 * 20-state machine (:13-21):
 *   S0 ยื่นคำขอ                    DRAFT, SUBMITTED
 *   S1 ชำระค่าธรรมเนียมเอกสาร        PENDING_DOC_FEE, DOC_FEE_PAID
 *   S2 ตรวจเอกสาร                   ASSIGNED_FOR_REVIEW, REVISION_REQUESTED, DOC_APPROVED
 *   S3 ชำระค่าตรวจประเมิน            PENDING_AUDIT_FEE, AUDIT_FEE_PAID
 *   S4 จัดตารางตรวจประเมิน           AUDIT_CONFIRMED
 *   S5 ตรวจภาคสนาม/ตัดสิน           CAR_PENDING, CAR_REVIEWING, AUDIT_PASSED, APPROVED
 *   S6 ออกใบรับรอง                  CERTIFIED
 *
 * Collapsed 7 -> 5 per this task's fixed step labels (ยื่นคำขอ / ตรวจเอกสาร /
 * ชำระค่าตรวจ / ตรวจแปลง / ออกใบรับรอง — only ONE payment step is named):
 *   step 1 ยื่นคำขอ    = S0
 *   step 2 ตรวจเอกสาร  = S1 + S2   (doc-fee gate folds into the document
 *                                    phase — DOC_FEE_PAID feeds straight
 *                                    into review, so the applicant
 *                                    experiences it as one phase, unlike
 *                                    the audit fee below)
 *   step 3 ชำระค่าตรวจ = S3         (kept as its own step — a materially
 *                                    larger fee, see ACTION_META
 *                                    .PAY_AUDIT_FEE vs .PAY_DOC_FEE in
 *                                    application-detail-page-config.ts,
 *                                    gating a separate on-site visit)
 *   step 4 ตรวจแปลง    = S4 + CAR_PENDING/CAR_REVIEWING of S5
 *   step 5 ออกใบรับรอง = AUDIT_PASSED/APPROVED of S5 + S6  (once the field
 *                                    audit itself has passed, everything
 *                                    left is administrative issuance — no
 *                                    further applicant action)
 * Cross-checked against the two worked examples in the task brief:
 * PENDING_AUDIT_FEE -> step 3, needsUserAction true; AUDIT_PASSED -> step 5,
 * needsUserAction false; REVISION_REQUESTED -> step 2, needsUserAction true.
 *
 * Terminal/negative states (REJECTED, EXPIRED, CANCEL_EXPIRED) carry
 * `terminal: true` and have no slot among the 5 happy-path steps — callers
 * MUST NOT render their `step` as an active/current-step marker (see
 * `terminal` doc on `StatusDisplay` below).
 *
 * REJECTED has a single origin in the transition table
 * (workflow-transition-service.js, documented in the gacp-workflow-rules
 * skill): AUDIT_CONFIRMED -> REJECTED, so step 4 is an accurate "how far it
 * got" value even though it's terminal.
 *
 * EXPIRED does NOT have a single origin — four edges land on it:
 * PENDING_DOC_FEE->EXPIRED, REVISION_REQUESTED->EXPIRED (both step 2),
 * PENDING_AUDIT_FEE->EXPIRED (step 3), CAR_PENDING->EXPIRED (step 4). Which
 * one applies is not recoverable from the status string alone on the list
 * endpoint (`/applications/my` returns only `status`, not workflow
 * history) — fix-round-1 correction: an earlier version of this file
 * claimed REVISION_REQUESTED was EXPIRED's "most-cited origin" with no
 * evidence for that claim; there is no basis to prefer one of the four
 * co-equal edges. EXPIRED (and its deprecated alias CANCEL_EXPIRED — no
 * code path writes it any more, kept only for legacy rows) are pinned to
 * step 2 as a documented *minimum-known-progress* floor (every origin is
 * step >= 2), used ONLY as a sort key if a caller wants one — never
 * surfaced as "you are currently at step 2". The client renders these
 * cards with the progress bar muted/inactive and no current-step dot; see
 * `apps/web-app/src/app/health/status/client-view.tsx`.
 *
 * All three terminal states reuse ACTION_META.REAPPLY's existing Thai
 * wording ('ยื่นคำขอใหม่') from application-detail-page-config.ts rather
 * than inventing new copy.
 */
import type { WorkflowState } from '@/lib/constants/workflow-states';

export type DisplayStep = 1 | 2 | 3 | 4 | 5;

export interface StatusDisplay {
  step: DisplayStep;
  stepLabelTH: string;
  /** Full Thai sentence naming the actor + what's being awaited. */
  actorTH: string;
  needsUserAction: boolean;
  actionTH?: string;
  /**
   * True only for REJECTED / EXPIRED / CANCEL_EXPIRED. The file terminated —
   * `step` is NOT a claim about where the application currently sits (for
   * EXPIRED/CANCEL_EXPIRED it can't be recovered from the status string
   * alone, see the module doc above); it exists only as a sort-key /
   * minimum-known-progress value. Callers MUST render terminal cards
   * without an active-step marker on the 5-step bar.
   */
  terminal?: true;
}

/** The 5 display steps, single source for their Thai labels. */
export const STEP_LABEL_TH: Record<DisplayStep, string> = {
  1: 'ยื่นคำขอ',
  2: 'ตรวจเอกสาร',
  3: 'ชำระค่าบริการ',
  4: 'ตรวจแปลง',
  5: 'ออกใบรับรอง',
};

type StatusEntry = Omit<StatusDisplay, 'stepLabelTH'>;

const STATUS_ENTRIES: Record<WorkflowState, StatusEntry> = {
  DRAFT: {
    step: 1,
    needsUserAction: true,
    actionTH: 'ดำเนินการต่อ',
    actorTH: 'คุณยังไม่ได้ส่งคำขอ กรุณากรอกข้อมูลให้ครบแล้วยื่นคำขอ',
  },
  SUBMITTED: {
    step: 1,
    needsUserAction: false,
    actorTH: 'ระบบได้รับคำขอของคุณแล้ว กำลังนำเข้าสู่ขั้นตอนถัดไปโดยอัตโนมัติ',
  },
  PENDING_DOC_FEE: {
    step: 2,
    needsUserAction: true,
    actionTH: 'ชำระเงินตอนนี้',
    actorTH: `คุณต้องชำระ${SERVICE_NAME.PHASE_1} เพื่อเริ่มการตรวจสอบ`,
  },
  DOC_FEE_PAID: {
    step: 2,
    needsUserAction: false,
    actorTH: 'ระบบยืนยันการชำระเงินแล้ว กำลังส่งต่อให้เจ้าหน้าที่ตรวจเอกสาร',
  },
  ASSIGNED_FOR_REVIEW: {
    step: 2,
    needsUserAction: false,
    actorTH: 'เจ้าหน้าที่กำลังตรวจเอกสารของคุณ',
  },
  REVISION_REQUESTED: {
    step: 2,
    needsUserAction: true,
    actionTH: 'แก้ไขและส่งข้อมูลใหม่',
    actorTH: 'ผู้ตรวจขอให้คุณแก้ไขเอกสาร กรุณาแก้ไขและส่งกลับภายในเวลาที่กำหนด',
  },
  DOC_APPROVED: {
    step: 2,
    needsUserAction: false,
    actorTH: 'เอกสารของคุณผ่านการตรวจแล้ว ระบบกำลังเปิดขั้นตอนชำระงวดที่ 2',
  },
  PENDING_AUDIT_FEE: {
    step: 3,
    needsUserAction: true,
    actionTH: 'ชำระเงินตอนนี้',
    actorTH: 'คุณต้องชำระค่าบริการ เพื่อนัดหมายวันตรวจแปลง',
  },
  AUDIT_FEE_PAID: {
    step: 3,
    needsUserAction: false,
    actorTH: 'ระบบยืนยันการชำระเงินแล้ว กำลังส่งต่อให้เจ้าหน้าที่นัดหมายวันตรวจแปลง',
  },
  AUDIT_CONFIRMED: {
    step: 4,
    needsUserAction: false,
    actorTH: 'เจ้าหน้าที่นัดหมายวันตรวจแปลงของคุณแล้ว กรุณารอถึงวันนัด',
  },
  CAR_PENDING: {
    step: 4,
    needsUserAction: true,
    actionTH: 'ส่งหลักฐาน CAR',
    actorTH: 'ผู้ตรวจพบข้อบกพร่องจากการลงพื้นที่ กรุณาส่งหลักฐานการแก้ไขของคุณ',
  },
  CAR_REVIEWING: {
    step: 4,
    needsUserAction: false,
    actorTH: 'ผู้ตรวจกำลังพิจารณาหลักฐาน CAR ที่คุณส่ง',
  },
  AUDIT_PASSED: {
    step: 5,
    needsUserAction: false,
    actorTH: 'คุณผ่านการตรวจแปลงแล้ว ระบบกำลังดำเนินการออกใบรับรอง',
  },
  APPROVED: {
    step: 5,
    needsUserAction: false,
    actorTH: 'คำขอของคุณได้รับอนุมัติแล้ว กำลังรอออกใบรับรอง',
  },
  CERTIFIED: {
    step: 5,
    needsUserAction: false,
    actorTH: 'คุณได้รับใบรับรอง GACP แล้ว',
  },
  REJECTED: {
    step: 4,
    needsUserAction: true,
    actionTH: 'ยื่นคำขอใหม่',
    actorTH: 'คำขอของคุณถูกปฏิเสธจากผลการตรวจแปลง กรุณายื่นคำขอใหม่หากต้องการดำเนินการต่อ',
    terminal: true,
  },
  EXPIRED: {
    step: 2,
    needsUserAction: true,
    actionTH: 'ยื่นคำขอใหม่',
    actorTH: 'คำขอของคุณหมดเวลาดำเนินการแล้ว กรุณายื่นคำขอใหม่',
    terminal: true,
  },
  CANCEL_EXPIRED: {
    step: 2,
    needsUserAction: true,
    actionTH: 'ยื่นคำขอใหม่',
    actorTH: 'คำขอของคุณถูกยกเลิกเนื่องจากหมดเวลาดำเนินการ กรุณายื่นคำขอใหม่',
    terminal: true,
  },
};

/**
 * Map a canonical workflow status to its 5-step display. Throws on any
 * status outside `WorkflowState` — callers own normalizing/validating raw
 * strings before calling this (see `WORKFLOW_STATES`/`getStatusLabel` in
 * ./constants/workflow-states.ts for the equivalent fail-loud pattern).
 */
export function mapStatusToDisplay(status: WorkflowState): StatusDisplay {
  const entry = STATUS_ENTRIES[status];
  if (!entry) {
    throw new Error(`mapStatusToDisplay: unmapped workflow status "${String(status)}"`);
  }
  return { ...entry, stepLabelTH: STEP_LABEL_TH[entry.step] };
}
