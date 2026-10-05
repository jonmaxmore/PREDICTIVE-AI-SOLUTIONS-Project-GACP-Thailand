import { FEE_SERVICES_FALLBACK, SERVICE_NAME } from '@/lib/pricing/fee-services';

/**
 * Health Dashboard Stage — applicant-facing progress model.
 *
 * Maps the backend's canonical workflow states into user-friendly stages that
 * reflect the real GACP certification lifecycle.
 *
 * The old 5-stage model collapsed too many states together, making it impossible
 * for applicants to understand where they were in the process.
 *
 * Mirrors apps/backend/shared/health-dashboard-stage.js — the two normalizers
 * must agree, and both are pinned by tests against the workflow SSOT.
 */

/**
 * The stage union, declared once as data so tests and callers can iterate it.
 * Every copy table below is a `Record<HealthDashboardStage, …>`, so adding a
 * stage here is a compile error until every renderer handles it — this is the
 * exhaustiveness guarantee, not a convention.
 */
export const HEALTH_DASHBOARD_STAGES = [
  'DRAFT',
  'PENDING_FEE_PHASE1',
  'UNDER_DOCUMENT_REVIEW',
  'REVISION_REQUIRED',
  'PENDING_FEE_PHASE2',
  // จ่ายงวดที่ 2 แล้ว แต่ยังไม่มีใครนัดวัน — คนละขั้นกับการตรวจที่เกิดขึ้นจริง
  'PENDING_AUDIT_SCHEDULE',
  'UNDER_FIELD_AUDIT',
  'APPROVED',
  'CERTIFIED',
  // Terminal. REJECTED / EXPIRED / CANCEL_EXPIRED were in no classification
  // set below and fell through to the closing UNDER_DOCUMENT_REVIEW fallback,
  // so a rejected applicant was told their documents were under review.
  'CLOSED',
] as const;

export type HealthDashboardStage = (typeof HEALTH_DASHBOARD_STAGES)[number];

/**
 * Stages where the file is finished and the stepper no longer applies. Callers
 * must branch on this rather than on `getStepperIndex(...) === 0`, which DRAFT
 * also satisfies.
 */
const TERMINAL_STAGES = new Set<HealthDashboardStage>(['CLOSED']);

export function isTerminalStage(stage: HealthDashboardStage): boolean {
  return TERMINAL_STAGES.has(stage);
}


// ── Labels ──────────────────────────────────────────────────────────────────

export const STAGE_LABEL_TH: Record<HealthDashboardStage, string> = {
  DRAFT: 'ร่างคำขอ',
  PENDING_FEE_PHASE1: `รอชำระ${SERVICE_NAME.PHASE_1}`,
  UNDER_DOCUMENT_REVIEW: 'อยู่ระหว่างตรวจเอกสาร',
  REVISION_REQUIRED: 'แก้ไขเอกสารตามข้อเสนอแนะ',
  PENDING_FEE_PHASE2: 'รอชำระค่าบริการก่อนตรวจประเมินแปลง',
  PENDING_AUDIT_SCHEDULE: 'รอนัดวันตรวจประเมินแปลง',
  UNDER_FIELD_AUDIT: 'อยู่ระหว่างตรวจประเมินแปลง',
  APPROVED: 'ผ่านการอนุมัติ',
  CERTIFIED: 'ได้รับใบรับรอง GACP',
  CLOSED: 'คำขอปิดแล้ว',
};

export const STAGE_LABEL_EN: Record<HealthDashboardStage, string> = {
  DRAFT: 'Draft',
  PENDING_FEE_PHASE1: 'Instalment 1: document review service fee due',
  UNDER_DOCUMENT_REVIEW: 'Document Review',
  REVISION_REQUIRED: 'Revision Required',
  PENDING_FEE_PHASE2: 'Service fee due before the site assessment',
  PENDING_AUDIT_SCHEDULE: 'Awaiting Audit Appointment',
  UNDER_FIELD_AUDIT: 'Field Audit in Progress',
  APPROVED: 'Approved',
  CERTIFIED: 'GACP Certified',
  CLOSED: 'Closed',
};

// ── Descriptions (tells user what's happening) ──────────────────────────────

export const STAGE_DESCRIPTION_TH: Record<HealthDashboardStage, string> = {
  DRAFT: 'คำขอยังไม่ได้ส่ง กรุณากรอกข้อมูลให้ครบถ้วนแล้วกดยื่นคำขอ',
  PENDING_FEE_PHASE1: `กรุณาชำระ${SERVICE_NAME.PHASE_1} เพื่อเข้าสู่ขั้นตอนตรวจเอกสาร`,
  UNDER_DOCUMENT_REVIEW: 'เจ้าหน้าที่กำลังตรวจสอบเอกสารของท่าน กรุณารอผลการตรวจ',
  REVISION_REQUIRED: 'เจ้าหน้าที่แจ้งให้แก้ไขเอกสาร กรุณาอัปโหลดเอกสารที่แก้ไขภายในกำหนด',
  PENDING_FEE_PHASE2: 'กรุณาชำระค่าบริการ เพื่อนัดวันตรวจประเมินแปลง',
  PENDING_AUDIT_SCHEDULE: 'ชำระค่าบริการแล้ว รอเจ้าหน้าที่นัดวันเข้าตรวจแปลง',
  UNDER_FIELD_AUDIT: 'เจ้าหน้าที่กำลังดำเนินการตรวจประเมินแปลง กรุณารอผลการตรวจ',
  APPROVED: 'คำขอได้รับการอนุมัติแล้ว อยู่ระหว่างจัดทำใบรับรอง GACP',
  CERTIFIED: 'ท่านได้รับใบรับรอง GACP แล้ว สามารถดาวน์โหลดได้จากหน้าใบรับรอง',
  CLOSED: 'คำขอนี้ปิดแล้ว (ไม่อนุมัติ หรือหมดเวลาดำเนินการ) ท่านสามารถยื่นคำขอใหม่ได้',
};

// ── Next Action (tells user what TO DO) ──────────────────────────────────────

export const STAGE_NEXT_ACTION_TH: Record<HealthDashboardStage, string> = {
  DRAFT: 'กรอกข้อมูลและยื่นคำขอ',
  PENDING_FEE_PHASE1: 'ชำระงวดที่ 1',
  UNDER_DOCUMENT_REVIEW: 'รอผลตรวจเอกสาร',
  REVISION_REQUIRED: 'อัปโหลดเอกสารที่แก้ไข',
  PENDING_FEE_PHASE2: 'ชำระค่าบริการ',
  PENDING_AUDIT_SCHEDULE: 'รอเจ้าหน้าที่นัดวันเข้าตรวจแปลง',
  UNDER_FIELD_AUDIT: 'รอผลตรวจประเมินแปลง',
  APPROVED: 'รอออกใบรับรอง',
  CERTIFIED: 'ดาวน์โหลดใบรับรอง',
  CLOSED: 'ยื่นคำขอใหม่',
};

// ── With the application at hand (round 3, operator 2026-10-03) ───────────────
//
// PENDING_FEE_PHASE2 is a renewal's one charge AND a new filing's second instalment. The
// maps above have no application, so they say what is true for both. A screen that has
// the application (`isRenewal` from the backend payloads) names which; `undefined` falls
// back to the neutral map. Names are the catalogue's (constants/fee-service-catalogue.json).

export interface RenewalContext { isRenewal?: boolean | null | undefined }

const P2_NAME = FEE_SERVICES_FALLBACK.PHASE_2.name;
const RENEWAL_NAME = FEE_SERVICES_FALLBACK.RENEWAL.name;

export function stageLabelFor(stage: HealthDashboardStage, ctx: RenewalContext = {}): string {
  if (stage === 'PENDING_FEE_PHASE2' && typeof ctx.isRenewal === 'boolean') {
    return ctx.isRenewal ? `รอชำระ${RENEWAL_NAME}` : `รอชำระ${P2_NAME}`;
  }
  return STAGE_LABEL_TH[stage];
}

export function stageDescriptionFor(stage: HealthDashboardStage, ctx: RenewalContext = {}): string {
  if (stage === 'PENDING_FEE_PHASE2' && typeof ctx.isRenewal === 'boolean') {
    return ctx.isRenewal
      ? `กรุณาชำระ${RENEWAL_NAME} เพื่อนัดวันตรวจประเมินแปลง`
      : `เอกสารผ่านการตรวจสอบแล้ว กรุณาชำระ${P2_NAME}`;
  }
  if (stage === 'PENDING_AUDIT_SCHEDULE' && typeof ctx.isRenewal === 'boolean') {
    return `ชำระ${ctx.isRenewal ? RENEWAL_NAME : P2_NAME}แล้ว รอเจ้าหน้าที่นัดวันเข้าตรวจแปลง`;
  }
  return STAGE_DESCRIPTION_TH[stage];
}

export function stageNextActionFor(stage: HealthDashboardStage, ctx: RenewalContext = {}): string {
  if (stage === 'PENDING_FEE_PHASE2' && typeof ctx.isRenewal === 'boolean') {
    return ctx.isRenewal ? `ชำระ${RENEWAL_NAME}` : 'ชำระงวดที่ 2';
  }
  return STAGE_NEXT_ACTION_TH[stage];
}

// ── Badge Colors ────────────────────────────────────────────────────────────

export const STAGE_BADGE_STYLE: Record<HealthDashboardStage, { bg: string; text: string; dot: string }> = {
  DRAFT: { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' },
  PENDING_FEE_PHASE1: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  UNDER_DOCUMENT_REVIEW: { bg: 'bg-sky-50', text: 'text-sky-700', dot: 'bg-sky-500' },
  REVISION_REQUIRED: { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
  PENDING_FEE_PHASE2: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  PENDING_AUDIT_SCHEDULE: { bg: 'bg-sky-50', text: 'text-sky-700', dot: 'bg-sky-500' },
  UNDER_FIELD_AUDIT: { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },
  APPROVED: { bg: 'bg-leaf-soft', text: 'text-leaf-700', dot: 'bg-leaf-600' },
  CERTIFIED: { bg: 'bg-leaf-soft', text: 'text-leaf-800', dot: 'bg-leaf-700' },
  CLOSED: { bg: 'bg-slate-100', text: 'text-slate-500', dot: 'bg-slate-400' },
};

// ── Stepper Configuration ───────────────────────────────────────────────────

// CLOSED is deliberately absent: it is not a rung, it is the end of the road.
export const STEPPER_STEPS: Array<{
  stage: Exclude<HealthDashboardStage, 'CLOSED'>;
  label: string;
  shortLabel: string;
  icon: string;
}> = [
  { stage: 'DRAFT', label: 'ร่างคำขอ', shortLabel: 'ร่าง', icon: 'FileEdit' },
  { stage: 'PENDING_FEE_PHASE1', label: `ชำระ${SERVICE_NAME.PHASE_1}`, shortLabel: 'งวดที่ 1', icon: 'CreditCard' },
  { stage: 'UNDER_DOCUMENT_REVIEW', label: 'ตรวจเอกสาร', shortLabel: 'ตรวจเอกสาร', icon: 'FileSearch' },
  { stage: 'REVISION_REQUIRED', label: 'แก้ไขเอกสาร', shortLabel: 'แก้ไข', icon: 'FilePen' },
  { stage: 'PENDING_FEE_PHASE2', label: `ชำระ${SERVICE_NAME.PHASE_2}`, shortLabel: 'งวดที่ 2', icon: 'CreditCard' },
  { stage: 'PENDING_AUDIT_SCHEDULE', label: 'รอนัดวันตรวจแปลง', shortLabel: 'รอนัด', icon: 'CalendarClock' },
  { stage: 'UNDER_FIELD_AUDIT', label: 'ตรวจประเมินแปลง', shortLabel: 'ตรวจแปลง', icon: 'ClipboardCheck' },
  { stage: 'APPROVED', label: 'อนุมัติ', shortLabel: 'อนุมัติ', icon: 'CheckCircle' },
  { stage: 'CERTIFIED', label: 'ออกใบรับรอง', shortLabel: 'ใบรับรอง', icon: 'Award' },
];

// ── Stepper index (for progress %) ──────────────────────────────────────────

/**
 * The stepper for one application. A renewal (round 5, mirroring the mobile
 * trackingStepsFor) pays ONE charge and skips document review: no instalment-1 step,
 * no review/revision steps, and its payment step is named by the RENEWAL catalogue
 * entry. A new filing keeps STEPPER_STEPS.
 */
const RENEWAL_SKIPS: ReadonlySet<HealthDashboardStage> = new Set(['PENDING_FEE_PHASE1', 'UNDER_DOCUMENT_REVIEW', 'REVISION_REQUIRED']);
export function stepperStepsFor(ctx: RenewalContext = {}): typeof STEPPER_STEPS {
  if (ctx.isRenewal !== true) return STEPPER_STEPS;
  return STEPPER_STEPS
    .filter((step) => !RENEWAL_SKIPS.has(step.stage))
    .map((step) => (step.stage === 'PENDING_FEE_PHASE2'
      ? { ...step, label: `ชำระ${RENEWAL_NAME}`, shortLabel: 'ต่ออายุ' }
      : step));
}

/** getStepperIndex / getProgressPercent for one application's own stepper. */
export function stepperIndexFor(stage: HealthDashboardStage, ctx: RenewalContext = {}): number {
  const steps = stepperStepsFor(ctx);
  const idx = steps.findIndex((s) => s.stage === stage);
  if (idx >= 0) return idx;
  return isTerminalStage(stage) ? -1 : 0;
}
export function progressPercentFor(stage: HealthDashboardStage, ctx: RenewalContext = {}): number {
  const idx = stepperIndexFor(stage, ctx);
  if (idx < 0) return 0;
  return Math.round((idx / (stepperStepsFor(ctx).length - 1)) * 100);
}

export function getStepperIndex(stage: HealthDashboardStage): number {
  // REVISION_REQUIRED goes back to index 2 (document review area) on the stepper
  // but we treat it as its own visual step for clarity.
  //
  // Terminal stages return -1 — "not on the ladder". Collapsing them to 0 (the
  // old behaviour for any stage the stepper did not know) rendered a closed
  // file as a fresh draft sitting on step 1 of 9.
  const idx = STEPPER_STEPS.findIndex((s) => s.stage === stage);
  if (idx >= 0) return idx;
  return isTerminalStage(stage) ? -1 : 0;
}

export function getProgressPercent(stage: HealthDashboardStage): number {
  const idx = getStepperIndex(stage);
  if (idx < 0) return 0;
  return Math.round((idx / (STEPPER_STEPS.length - 1)) * 100);
}

// ── State Normalization ─────────────────────────────────────────────────────

type StageLikeApplication = {
  status?: string | null;
  workflowState?: string | null;
  phase1Status?: string | null;
  phase2Status?: string | null;
  formData?: { workflowState?: string | null } | null;
  dashboardStage?: string | null;
  hasCertificate?: boolean | null;
};

function toUpper(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

export function normalizeHealthDashboardStage(
  app: StageLikeApplication,
): HealthDashboardStage {
  const status = toUpper(app?.status);
  const workflowState = toUpper(app?.workflowState || app?.formData?.workflowState);
  const hasCertificate = app?.hasCertificate === true;

  // ── Terminal: Certified ──
  if (hasCertificate && (workflowState === 'CERTIFIED' || status === 'CERTIFIED')) {
    return 'CERTIFIED';
  }

  // ── Terminal: Closed ──
  // Ahead of every "in progress" branch — a closed file must never be reported
  // as still moving, and REJECTED in particular has to beat the closing
  // UNDER_DOCUMENT_REVIEW fallback that used to swallow it.
  const CLOSED_STATES = new Set(['REJECTED', 'EXPIRED', 'CANCEL_EXPIRED']);
  if (CLOSED_STATES.has(workflowState) || CLOSED_STATES.has(status)) {
    return 'CLOSED';
  }

  // ── Approved (waiting cert issuance) ──
  if (workflowState === 'APPROVED' || status === 'APPROVED') {
    if (hasCertificate) return 'CERTIFIED';
    return 'APPROVED';
  }

  // ── Field Audit phase ──
  // AUDIT_FEE_PAID อยู่ในชุดนี้ไม่ได้: เงินเข้าแล้วแต่ผู้จัดสรรงานยังไม่ได้นัดวัน
  // และยังไม่มีผู้ตรวจ · จอที่บอกว่า "กำลังตรวจ" ตั้งแต่จุดนั้นทำให้ผู้ยื่นรอเก้อ
  const AUDIT_STATES = new Set([
    'AUDIT_CONFIRMED', 'CAR_PENDING', 'CAR_REVIEWING', 'AUDIT_PASSED',
  ]);
  if (AUDIT_STATES.has(workflowState) || AUDIT_STATES.has(status)) {
    return 'UNDER_FIELD_AUDIT';
  }

  // ── Paid งวดที่ 2, waiting for an appointment ──
  const AUDIT_SCHEDULE_STATES = new Set(['AUDIT_FEE_PAID']);
  if (AUDIT_SCHEDULE_STATES.has(workflowState) || AUDIT_SCHEDULE_STATES.has(status)) {
    return 'PENDING_AUDIT_SCHEDULE';
  }

  // ── Pending Phase 2 Fee ──
  const PHASE2_FEE_STATES = new Set(['DOC_APPROVED', 'PENDING_AUDIT_FEE']);
  if (PHASE2_FEE_STATES.has(workflowState) || PHASE2_FEE_STATES.has(status)) {
    return 'PENDING_FEE_PHASE2';
  }

  // ── Revision Required ──
  const REVISION_STATES = new Set(['REVISION_REQUESTED']);
  if (REVISION_STATES.has(workflowState) || REVISION_STATES.has(status)) {
    return 'REVISION_REQUIRED';
  }

  // ── Under Document Review ──
  // PENDING_REVIEW / IN_REVIEW / UNDER_REVIEW belonged to other domain models,
  // not to Application — two domains sharing one string would let one model's
  // status classify an application. Only the canonical Application states below.
  const DOC_REVIEW_STATES = new Set(['DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW']);
  if (DOC_REVIEW_STATES.has(workflowState) || DOC_REVIEW_STATES.has(status)) {
    return 'UNDER_DOCUMENT_REVIEW';
  }

  // ── Pending Phase 1 Fee ──
  const PHASE1_FEE_STATES = new Set(['SUBMITTED', 'PENDING_DOC_FEE']);
  if (PHASE1_FEE_STATES.has(workflowState) || PHASE1_FEE_STATES.has(status)) {
    return 'PENDING_FEE_PHASE1';
  }

  // ── Draft ──
  if (status === 'DRAFT' || !status) {
    return 'DRAFT';
  }

  // Fallback for unknown states - show as under review
  return 'UNDER_DOCUMENT_REVIEW';
}

// NOTE: Legacy exports (HEALTH_STAGE_LABEL_TH, HEALTH_STAGE_BADGE_COLOR) removed.
// All consumers should import STAGE_LABEL_TH and STAGE_BADGE_STYLE directly.
