/**
 * Health Dashboard Stage — Enterprise Stage Model
 *
 * Maps the backend's 20 canonical workflow states into 10 user-friendly stages.
 * Aligned with frontend `lib/health-dashboard-stage.ts`.
 *
 * Source of truth: services/workflow-transition-service.js (canonical workflow)
 * This file: projection layer for health-side dashboard UX.
 */

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toUpper(value) {
  return String(value || '').trim().toUpperCase();
}

// ── 10 canonical dashboard stages ────────────────────────────────────────────
const HEALTH_DASHBOARD_STAGES = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_FEE_PHASE1: 'PENDING_FEE_PHASE1',
  UNDER_DOCUMENT_REVIEW: 'UNDER_DOCUMENT_REVIEW',
  REVISION_REQUIRED: 'REVISION_REQUIRED',
  PENDING_FEE_PHASE2: 'PENDING_FEE_PHASE2',
  // จ่ายงวดที่ 2 แล้ว แต่ยังไม่มีใครนัดวัน — ก่อนใบนี้ AUDIT_FEE_PAID ถูกนับรวมกับ
  // "อยู่ระหว่างตรวจประเมินแปลง" ทั้งที่ยังไม่มีผู้ตรวจและไม่มีวัน ผู้ยื่นจึงถูกบอกว่า
  // การตรวจกำลังเกิดขึ้น แล้วรอเก้อ · ผู้จัดสรรงานเป็นคนเปลี่ยนสถานะนี้ต่อ
  // (AUDIT_FEE_PAID → AUDIT_CONFIRMED, audit-scheduling-service.js:7)
  PENDING_AUDIT_SCHEDULE: 'PENDING_AUDIT_SCHEDULE',
  UNDER_FIELD_AUDIT: 'UNDER_FIELD_AUDIT',
  APPROVED: 'APPROVED',
  CERTIFIED: 'CERTIFIED',
  // Terminal. REJECTED / EXPIRED / CANCEL_EXPIRED matched no set below and
  // fell through every branch to the closing UNDER_DOCUMENT_REVIEW fallback,
  // so an applicant whose file had been rejected — or auto-cancelled for
  // missing the 5-working-day revision deadline — was told on their dashboard
  // that their documents were being reviewed, and waited for a result that
  // was never coming.
  CLOSED: 'CLOSED',
});

// ── Thai labels ─────────────────────────────────────────────────────────────
// PENDING_FEE_PHASE2 is shared by a renewal (its one charge) and a new filing's second
// instalment. This map has no application, so its wording is true for both (round 3,
// operator 2026-10-03); a screen with the application names which (web stageLabelFor).
const STAGE_LABEL_TH = Object.freeze({
  DRAFT: 'ร่างคำขอ',
  PENDING_FEE_PHASE1: 'รอชำระงวดที่ 1 ค่าบริการตรวจสอบเอกสาร',
  UNDER_DOCUMENT_REVIEW: 'อยู่ระหว่างตรวจเอกสาร',
  REVISION_REQUIRED: 'แก้ไขเอกสารตามข้อเสนอแนะ',
  PENDING_FEE_PHASE2: 'รอชำระค่าบริการก่อนตรวจประเมินแปลง',
  PENDING_AUDIT_SCHEDULE: 'รอนัดวันตรวจประเมินแปลง',
  UNDER_FIELD_AUDIT: 'อยู่ระหว่างตรวจประเมินแปลง',
  APPROVED: 'ผ่านการอนุมัติ',
  CERTIFIED: 'ได้รับใบรับรอง GACP',
  CLOSED: 'คำขอปิดแล้ว',
});

// ── English labels ──────────────────────────────────────────────────────────
const STAGE_LABEL_EN = Object.freeze({
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
});

// ── Next action (tells user what TO DO) ─────────────────────────────────────
const STAGE_NEXT_ACTION_TH = Object.freeze({
  DRAFT: 'กรอกข้อมูลและยื่นคำขอ',
  PENDING_FEE_PHASE1: 'ชำระงวดที่ 1 ค่าบริการตรวจสอบเอกสาร',
  UNDER_DOCUMENT_REVIEW: 'รอผลตรวจเอกสาร',
  REVISION_REQUIRED: 'อัปโหลดเอกสารที่แก้ไข',
  PENDING_FEE_PHASE2: 'ชำระค่าบริการก่อนตรวจประเมินแปลง',
  PENDING_AUDIT_SCHEDULE: 'รอเจ้าหน้าที่นัดวันเข้าตรวจแปลง',
  UNDER_FIELD_AUDIT: 'รอผลตรวจประเมินแปลง',
  APPROVED: 'รอออกใบรับรอง',
  CERTIFIED: 'ดาวน์โหลดใบรับรอง',
  CLOSED: 'ยื่นคำขอใหม่',
});

// ── Classification sets ─────────────────────────────────────────────────────

// Note: a `_CERTIFIED_STATES` Set was previously declared here but never
// referenced. The classification for "certified-equivalent" states is handled
// inline in `normalizeHealthDashboardStage()` (lines 116, 121) where the
// CERTIFIED/APPROVED/FINAL_APPROVED checks live next to the hasCertificate
// gate. Removed in 2026-05-04 cleanup.

// PR 2c: the "// Legacy" halves of these sets are gone. Every one of them was
// a spelling no writer can produce (PR 2b) and no row holds (the column is
// canonical), so they could never match — dead entries that read like a live
// requirement and invited new code to copy the pattern.
// จ่ายงวดที่ 2 แล้ว รอผู้จัดสรรงานนัดวัน — ยังไม่มีผู้ตรวจและยังไม่มีวัน
const AUDIT_SCHEDULE_STATES = new Set(['AUDIT_FEE_PAID']);

// นัดแล้วหรือกำลังตรวจ — AUDIT_FEE_PAID เคยอยู่ในชุดนี้ด้วย ทำให้จอบอกว่า
// "อยู่ระหว่างตรวจประเมิน" ตั้งแต่เงินเข้า ก่อนที่จะมีใครนัดจริง
const AUDIT_STATES = new Set([
  'AUDIT_CONFIRMED', 'AUDIT_PASSED', 'CAR_PENDING', 'CAR_REVIEWING',
]);

const PHASE2_FEE_STATES = new Set(['DOC_APPROVED', 'PENDING_AUDIT_FEE']);

const REVISION_STATES = new Set(['REVISION_REQUESTED']);

// PENDING_REVIEW / IN_REVIEW / UNDER_REVIEW were in this set. They are not
// Application statuses at all — they belonged to the slip flow and to
// PurchaseInvoice. Two unrelated domains shared one string, so a payment status
// classified an application. The slip flow itself is gone (Stripe settles by
// webhook; nobody reviews a payment), so the lesson outlives its example: a
// status word is owned by one domain, and sharing the spelling couples them.
const DOC_REVIEW_STATES = new Set(['DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW']);

const PHASE1_FEE_STATES = new Set(['SUBMITTED', 'PENDING_DOC_FEE']);

const CLOSED_STATES = new Set(['REJECTED', 'EXPIRED', 'CANCEL_EXPIRED']);

// ── Normalization function ──────────────────────────────────────────────────

function normalizeHealthDashboardStage(application, options = {}) {
  const app = asObject(application);
  const formData = asObject(app.formData);

  const status = toUpper(app.status);
  const workflowState = toUpper(app.workflowState || formData.workflowState);
  const hasCertificate = options.hasCertificate === true
    || Number(options.certificateCount || 0) > 0
    || app.hasCertificate === true;

  // ── Terminal: Certified ──
  if (hasCertificate && (workflowState === 'CERTIFIED' || status === 'CERTIFIED')) {
    return HEALTH_DASHBOARD_STAGES.CERTIFIED;
  }

  // ── Terminal: Closed ──
  // Ahead of every "in progress" branch. A closed file must never be reported
  // as still moving, and REJECTED in particular has to beat the closing
  // UNDER_DOCUMENT_REVIEW fallback that used to swallow it.
  if (CLOSED_STATES.has(workflowState) || CLOSED_STATES.has(status)) {
    return HEALTH_DASHBOARD_STAGES.CLOSED;
  }

  // ── Approved (waiting cert issuance) ──
  if (workflowState === 'APPROVED' || status === 'APPROVED') {
    if (hasCertificate) {return HEALTH_DASHBOARD_STAGES.CERTIFIED;}
    return HEALTH_DASHBOARD_STAGES.APPROVED;
  }

  // ── Audit Passed (waiting final approval) ──
  if (workflowState === 'AUDIT_PASSED' || status === 'AUDIT_PASSED') {
    return HEALTH_DASHBOARD_STAGES.APPROVED;
  }

  // ── Field Audit phase ──
  if (AUDIT_STATES.has(workflowState) || AUDIT_STATES.has(status)) {
    return HEALTH_DASHBOARD_STAGES.UNDER_FIELD_AUDIT;
  }

  // ── Paid งวดที่ 2, waiting for an appointment ──
  // ก่อนสาขาค่าธรรมเนียม: เงินเข้าแล้ว การพากลับไปหน้าชำระเงินชวนให้จ่ายซ้ำ
  if (AUDIT_SCHEDULE_STATES.has(workflowState) || AUDIT_SCHEDULE_STATES.has(status)) {
    return HEALTH_DASHBOARD_STAGES.PENDING_AUDIT_SCHEDULE;
  }

  // ── Pending Phase 2 Fee ──
  if (PHASE2_FEE_STATES.has(workflowState) || PHASE2_FEE_STATES.has(status)) {
    return HEALTH_DASHBOARD_STAGES.PENDING_FEE_PHASE2;
  }

  // ── Revision Required ──
  if (REVISION_STATES.has(workflowState) || REVISION_STATES.has(status)) {
    return HEALTH_DASHBOARD_STAGES.REVISION_REQUIRED;
  }

  // ── Under Document Review ──
  if (DOC_REVIEW_STATES.has(workflowState) || DOC_REVIEW_STATES.has(status)) {
    return HEALTH_DASHBOARD_STAGES.UNDER_DOCUMENT_REVIEW;
  }

  // ── Pending Phase 1 Fee ──
  if (PHASE1_FEE_STATES.has(workflowState) || PHASE1_FEE_STATES.has(status)) {
    return HEALTH_DASHBOARD_STAGES.PENDING_FEE_PHASE1;
  }

  // ── Draft ──
  if (status === 'DRAFT' || !status) {
    return HEALTH_DASHBOARD_STAGES.DRAFT;
  }

  // Fallback for unknown states
  return HEALTH_DASHBOARD_STAGES.UNDER_DOCUMENT_REVIEW;
}

// ── Process counting ────────────────────────────────────────────────────────

function buildHealthProcessCounts(applications) {
  const counts = {
    draft: 0,
    pendingFeePhase1: 0,
    underDocumentReview: 0,
    revisionRequired: 0,
    pendingAuditSchedule: 0,
    pendingFeePhase2: 0,
    underFieldAudit: 0,
    approved: 0,
    certified: 0,
    closed: 0,
  };

  for (const app of applications || []) {
    const stage = normalizeHealthDashboardStage(app, {
      hasCertificate: app?.hasCertificate === true,
      certificateCount: app?.certificateCount || 0,
    });

    switch (stage) {
      case HEALTH_DASHBOARD_STAGES.DRAFT:
        counts.draft += 1;
        break;
      case HEALTH_DASHBOARD_STAGES.PENDING_FEE_PHASE1:
        counts.pendingFeePhase1 += 1;
        break;
      case HEALTH_DASHBOARD_STAGES.UNDER_DOCUMENT_REVIEW:
        counts.underDocumentReview += 1;
        break;
      case HEALTH_DASHBOARD_STAGES.REVISION_REQUIRED:
        counts.revisionRequired += 1;
        break;
      case HEALTH_DASHBOARD_STAGES.PENDING_FEE_PHASE2:
        counts.pendingFeePhase2 += 1;
        break;
      case HEALTH_DASHBOARD_STAGES.PENDING_AUDIT_SCHEDULE:
        counts.pendingAuditSchedule += 1;
        break;
      case HEALTH_DASHBOARD_STAGES.UNDER_FIELD_AUDIT:
        counts.underFieldAudit += 1;
        break;
      case HEALTH_DASHBOARD_STAGES.APPROVED:
        counts.approved += 1;
        break;
      case HEALTH_DASHBOARD_STAGES.CERTIFIED:
        counts.certified += 1;
        break;
      case HEALTH_DASHBOARD_STAGES.CLOSED:
        counts.closed += 1;
        break;
      default:
        // Unreachable while normalizeHealthDashboardStage only returns declared
        // stages — the JS stand-in for an exhaustiveness `never` check. A new
        // stage added without a counter lands here loudly instead of vanishing
        // from every dashboard total.
        throw new Error(`[health-dashboard-stage] uncounted dashboard stage: ${stage}`);
    }
  }

  // Backward compatibility: provide old keys too
  counts.waitingDocumentReview = counts.underDocumentReview + counts.revisionRequired;
  counts.waitingPayment = counts.pendingFeePhase1 + counts.pendingFeePhase2;
  counts.waitingAudit = counts.pendingAuditSchedule + counts.underFieldAudit + counts.approved;

  return counts;
}

module.exports = {
  HEALTH_DASHBOARD_STAGES,
  STAGE_LABEL_TH,
  STAGE_LABEL_EN,
  STAGE_NEXT_ACTION_TH,
  normalizeHealthDashboardStage,
  buildHealthProcessCounts,
};
