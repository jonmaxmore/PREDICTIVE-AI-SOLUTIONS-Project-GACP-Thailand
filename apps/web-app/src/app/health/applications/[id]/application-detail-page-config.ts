import { SERVICE_NAME } from '@/lib/pricing/fee-services';
import {
  getStatusLabel,
  STATUS_COLORS,
  WORKFLOW_STATES,
  type WorkflowState,
} from '@/lib/constants/workflow-states';
import { AREA_UNIT_LABEL, formatAreaSqm, legacyAreaToSqm } from '@/lib/area';
// The pay CTA labels carry no price here. The amount is appended by
// resolveActionTarget from the served fees (GET /api/pricing/fees), per
// cultivation scope, because an application with several scopes owes a
// multiple. It used to be read from constants (F-G4-64 T9), which would have
// kept naming the old price after a fee changed in the fee engine
// (apps/backend/config/business-rules.js, served by /api/pricing/fees).
import { THAI_TIME_ZONE } from '@/lib/format/thai-date';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export type StatusMeta = {
  label: string;
  tone: BadgeTone;
};

/**
 * Maps canonical Tailwind CSS badge classes to BadgeTone values.
 */
const tailwindToTone: Record<string, BadgeTone> = {
  'bg-zinc-100 text-zinc-600': 'neutral',
  'bg-blue-50 text-blue-700': 'info',
  'bg-amber-50 text-amber-700': 'warning',
  'bg-leaf-soft text-leaf-700': 'success',
  'bg-indigo-50 text-indigo-700': 'info',
  'bg-red-50 text-red-700': 'danger',
  'bg-green-50 text-green-700': 'success',
  'bg-teal-50 text-teal-700': 'success',
  'bg-orange-50 text-orange-700': 'warning',
  'bg-yellow-50 text-yellow-700': 'warning',
  'bg-green-100 text-green-800': 'success',
  'bg-primary text-white': 'success',
  'bg-red-100 text-red-800': 'danger',
  'bg-gray-100 text-gray-500': 'neutral',
  'bg-sky-50 text-sky-700': 'info',
};

function canonicalTone(state: string): BadgeTone {
  const tw = STATUS_COLORS[state as WorkflowState];
  return tw ? (tailwindToTone[tw] ?? 'neutral') : 'neutral';
}

// Build STATUS_META from canonical source + display-only aliases
const _canonicalMeta: Record<string, StatusMeta> = {};
for (const state of WORKFLOW_STATES) {
  _canonicalMeta[state] = {
    label: getStatusLabel(state),
    tone: canonicalTone(state),
  };
}

export const STATUS_META: Record<string, StatusMeta> = {
  ..._canonicalMeta,
  // Display-only aliases not in canonical workflow states
  REGISTERED: { label: 'ร่าง', tone: 'neutral' },
  DOC_REVIEWING: { label: 'กำลังตรวจเอกสาร', tone: 'info' },
  PAYMENT_2_PENDING: { label: 'รอชำระค่าบริการ', tone: 'warning' },
  AUDIT_SCHEDULING: { label: 'รอนัดหมายลงพื้นที่', tone: 'info' },
  AUDIT_IN_PROGRESS: { label: 'กำลังประเมินหน้างาน', tone: 'info' },
  FINAL_REVIEW: { label: 'รอพิจารณาอนุมัติ', tone: 'info' },
};

export type ActionMeta = {
  title: string;
  hint: string;
  buttonLabel?: string;
};

export const ACTION_META: Record<string, ActionMeta> & { WAITING: ActionMeta } = {
  CONTINUE_DRAFT: {
    title: 'ดำเนินการต่อ',
    hint: 'ข้อมูลยังเป็นแบบร่าง กรุณากรอกและยืนยันส่งข้อมูลให้ครบ',
    buttonLabel: 'ดำเนินการต่อ',
  },
  PAY_DOC_FEE: {
    title: 'ดำเนินการต่อ',
    hint: `เอกสารถูกส่งแล้ว กรุณาชำระ${SERVICE_NAME.PHASE_1} เพื่อเริ่มกระบวนการ`,
    buttonLabel: 'ชำระงวดที่ 1',
  },
  SUBMIT_REVISION: {
    title: 'ดำเนินการต่อ',
    hint: 'มีคำสั่งแก้ไขจากผู้ตรวจ กรุณาแก้ไขและส่งกลับภายในเวลาที่กำหนด',
    buttonLabel: 'แก้ไขและส่งข้อมูลใหม่',
  },
  PAY_AUDIT_FEE: {
    title: 'ดำเนินการต่อ',
    hint: 'กรุณาชำระค่าบริการ เพื่อนัดวันตรวจประเมินแปลง',
    buttonLabel: 'ชำระค่าบริการ',
  },
  SUBMIT_CAR_EVIDENCE: {
    title: 'ดำเนินการต่อ',
    hint: 'พบข้อบกพร่องจากการลงพื้นที่ กรุณาส่งหลักฐานการแก้ไข',
    buttonLabel: 'ส่งหลักฐานการแก้ไข',
  },
  DOWNLOAD_CERTIFICATE: {
    title: 'ได้รับใบรับรอง GACP แล้ว',
    hint: 'ดาวน์โหลดใบรับรอง แล้วเริ่มส่งรายงานรายเดือน (ภ.ท.27/28) ตามเงื่อนไขใบรับรอง',
    buttonLabel: 'ดาวน์โหลดใบรับรอง',
  },
  REAPPLY: {
    title: 'ต้องเริ่มคำขอใหม่',
    hint: 'คำขอหมดเวลาแก้ไขและถูกยกเลิก กรุณาเริ่มคำขอใหม่',
    buttonLabel: 'ยื่นคำขอใหม่',
  },
  WAITING: {
    title: 'รอดำเนินการจากระบบ',
    hint: 'คำขออยู่ระหว่างกระบวนการของเจ้าหน้าที่',
  },
  WAIT_SCHEDULE: {
    title: 'รอนัดหมายลงพื้นที่',
    hint: 'เจ้าหน้าที่จัดคิวกำลังกำหนดวันนัดตรวจที่ฟาร์มของคุณ',
  },
};

export interface ApplicationCommentEntry {
  id: string;
  type?: string | null;
  commentText?: string | null;
  createdAt?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  auditorId?: string | null;
  attachments?: unknown[];
}

/** The booked inspection (server sends it only while the visit is booked). */
export interface AuditScheduleView {
  scheduledDate: string;
  inspectionMode: 'ONSITE' | 'ONLINE_MEET';
  auditorName: string | null;
  meetingLink: string | null;
}

export interface ApplicationDetailPayload {
  id: string;
  applicationId: string;
  /** round 3: a renewal (one charge) vs a new filing (two instalments). */
  isRenewal?: boolean;
  /** The stored cultivation-type count the quotation priced; null when unknown. */
  cultivationScopeCount?: number | null;
  /** round 4: the engine's renewal price for this application (renewals only, else null). */
  renewalPriceEstimate?: number | null;
  applicationNumber?: string;
  healthId?: string;
  serviceType?: string;
  areaType?: string;
  status: string;
  workflowState?: string | null;
  workflowStateUpdatedAt?: string | null;
  submittedAt?: string | null;
  /** When and who, while the inspection is booked; null otherwise. */
  auditSchedule?: AuditScheduleView | null;
  // Canonical phase status — source of truth for payment state. Backend
  // started returning these on 2026-04-28 to fix the case where an app
  // sits in REGISTERED + phase1Status=PAID and the page can't infer
  // "phase 1 done" from workflow text alone.
  phase1Status?: string | null;
  phase1PaidAt?: string | null;
  phase2Status?: string | null;
  phase2PaidAt?: string | null;
  createdAt: string;
  updatedAt: string;
  steps?: Record<string, Record<string, unknown>>;
  // The wizard's FLAT formData (whitelisted by buildApplicationDetailPayload). This
  // is the real source of the application content for apps whose formData.steps is
  // empty (the current flat-save path) — used as the fallback in deriveApplicationSummary.
  formData?: {
    applicantData?: Record<string, unknown>;
    farmData?: Record<string, unknown>;
    plots?: Array<Record<string, unknown>>;
    plantId?: string | null;
    [key: string]: unknown;
  };
  metadata?: {
    lastDraftStep?: number | null;
    lastDraftSavedAt?: string | null;
    revisionDueAt?: string | null;
    carDueAt?: string | null;
    workflowHistoryCount?: number;
    commentsCount?: number;
  };
  comments?: ApplicationCommentEntry[];
}

export interface TrackingStepPayload {
  step: number;
  key: string;
  label: string;
  active: boolean;
  completed: boolean;
}

export interface DeadlinePayload {
  type: string;
  dueAt: string;
  remainingHours: number;
  remainingWorkingDays: number;
  isOverdue: boolean;
}

export interface TrackingStatusPayload {
  applicationId: string;
  /** round 3: which charge PENDING_AUDIT_FEE is for this application. */
  isRenewal?: boolean;
  applicationNumber?: string;
  status: string;
  displayStatus?: string;
  tracking?: {
    currentStep: number;
    totalSteps: number;
    steps: TrackingStepPayload[];
  };
  actionCard?: {
    key: string;
    title: string;
    enabled: boolean;
  };
  deadline?: DeadlinePayload | null;
}

export interface WorkflowHistoryEntry {
  index: number;
  timestamp?: string | null;
  action?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  step?: number | null;
  reason?: string | null;
  comment?: string | null;
}

export interface HistoryCommentEntry {
  id: string;
  createdAt?: string | null;
  type?: string | null;
  commentText?: string | null;
  auditorId?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
}

export interface ApplicationHistoryPayload {
  applicationId: string;
  applicationNumber?: string;
  status: string;
  workflowHistory: WorkflowHistoryEntry[];
  comments: HistoryCommentEntry[];
  revisions?: Array<Record<string, unknown>>;
  rejections?: Array<Record<string, unknown>>;
}

export function resolveStatusMeta(status?: string | null): StatusMeta {
  const key = String(status || '').trim().toUpperCase();
  return STATUS_META[key] || { label: key || '-', tone: 'neutral' };
}

export function resolveActionMeta(actionKey?: string | null): ActionMeta {
  const key = String(actionKey || '').trim().toUpperCase();
  return ACTION_META[key] || ACTION_META.WAITING;
}

export function toThaiDate(isoLike?: string | null): string {
  if (!isoLike) {
    return '-';
  }
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString('th-TH', { timeZone: THAI_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
}

export function toThaiDateTime(isoLike?: string | null): string {
  if (!isoLike) {
    return '-';
  }
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString('th-TH', {
    timeZone: THAI_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function pickStepValue(
  step: Record<string, unknown> | undefined,
  aliases: string[],
): string | null {
  if (!step || typeof step !== 'object') {
    return null;
  }
  for (const alias of aliases) {
    const value = (step as Record<string, unknown>)[alias];
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

export interface ApplicationSummary {
  operatorName: string;
  operatorType: string;
  plantName: string;
  plotName: string;
  province: string;
  surroundingEnvironment: string;
  areaText: string;
}

// Code→label maps PER LANGUAGE (mirror the auth/wizard applicant-type dictionaries +
// domain-types PLANTS). These localise the enum CODES only — user-entered values
// (names, province, plot names) are shown as the applicant typed them.
const APPLICANT_TYPE_LABELS: Record<string, Record<string, string>> = {
  th: { INDIVIDUAL: 'บุคคลธรรมดา', JURISTIC: 'นิติบุคคล', COMMUNITY: 'วิสาหกิจชุมชน', ENTERPRISE: 'วิสาหกิจชุมชน' },
  en: { INDIVIDUAL: 'Individual', JURISTIC: 'Juristic Person', COMMUNITY: 'Community Enterprise', ENTERPRISE: 'Community Enterprise' },
};
const PLANT_LABELS: Record<string, Record<string, string>> = {
  th: { cannabis: 'กัญชา', kratom: 'กระท่อม', turmeric: 'ขมิ้นชัน', ginger: 'ขิง', black_galangal: 'กระชายดำ', plai: 'ไพล' },
  en: { cannabis: 'Cannabis', kratom: 'Kratom', turmeric: 'Turmeric', ginger: 'Ginger', black_galangal: 'Black Galangal', plai: 'Plai' },
};
// Look up CODE → label in the UI language; unknown codes / already-localised values
// pass through unchanged.
function localizedLabel(maps: Record<string, Record<string, string>>, code: string | null, language: string): string | null {
  if (!code) { return code; }
  const map = maps[language] || maps.th || {};
  const k = code.trim();
  return map[k] || map[k.toUpperCase()] || map[k.toLowerCase()] || code;
}

/**
 * Build the "คำขอ" summary for the applicant detail page. Prefers the canonical
 * wizard-step shape (formData.steps['1'..'3']) but FALLS BACK to the wizard's flat
 * formData (applicantData / farmData / plots) when steps is empty.
 *
 * Why: the current wizard's flat-save path stores the application content in
 * top-level formData fields and leaves formData.steps = {} (bug 2026-06-24). The
 * applicant detail "คำขอ" section reads steps, so it rendered blank even though the
 * data is present — and the provider review + edit flows (which read flat formData)
 * show it fine. This makes the applicant view read the same source.
 */
export function deriveApplicationSummary(detail: ApplicationDetailPayload | null, language: string = 'th'): ApplicationSummary {
  const steps = detail?.steps || {};
  const step1 = steps['1'] || {};
  const step2 = steps['2'] || {};
  const step3 = steps['3'] || {};

  const asRec = (v: unknown): Record<string, unknown> => (
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  );
  const fd = detail?.formData || {};
  const applicant = asRec(fd.applicantData);
  const farm = asRec(fd.farmData);
  const plots = Array.isArray(fd.plots) ? fd.plots : [];
  const plot0 = asRec(plots[0]);

  const flatOperatorName = pickStepValue(applicant, ['name'])
    || [pickStepValue(applicant, ['firstName']), pickStepValue(applicant, ['lastName'])].filter(Boolean).join(' ').trim();

  const operatorName = pickStepValue(step1, ['operator_name', 'operatorName']) || flatOperatorName || '-';
  // ประเภทผู้ยื่น — localise the enum code in the UI language (INDIVIDUAL → บุคคลธรรมดา / Individual).
  const operatorType = localizedLabel(APPLICANT_TYPE_LABELS,
    pickStepValue(step1, ['operator_type', 'operatorType']) || pickStepValue(applicant, ['applicantType']), language) || '-';
  // พืชที่ยื่นขอ — localise the plant code (cannabis → กัญชา / Cannabis).
  const plantName = localizedLabel(PLANT_LABELS,
    pickStepValue(step3, ['botanical_name', 'botanicalName', 'strain_name', 'strainName', 'herb_type_id', 'herbTypeId'])
    || pickStepValue(fd as Record<string, unknown>, ['plantName', 'plantId']), language) || '-';
  // ชื่อแปลงปลูก — when there is more than one plot, list ALL plot names
  // (e.g. "แปลงที่ 1, แปลงที่ 2"); fall back to the farm name.
  const flatPlotNames = plots.map((p) => pickStepValue(asRec(p), ['name'])).filter((n): n is string => Boolean(n));
  const plotName = pickStepValue(step2, ['plot_name', 'plotName'])
    || (flatPlotNames.length > 0 ? flatPlotNames.join(', ') : '')
    || pickStepValue(farm, ['farmName']) || '-';
  // province reads ONLY the province alias (V1-A/D7) — flat fallback is farmData.province.
  const province = pickStepValue(step2, ['province']) || pickStepValue(farm, ['province']) || '-';
  const surroundingEnvironment = pickStepValue(step2, ['surrounding_environment', 'surroundingEnvironment'])
    || pickStepValue(farm, ['waterSourceDetail']) || '-';

  // Area, always in square metres.
  //
  // Two shapes reach this function. The older one recorded rai, งาน and ตร.ว.
  // in three separate fields and printed all three; it is summed into one
  // number, so an application from before the switch and one from after read
  // the same on the same screen. The newer one is a single size in whatever
  // unit that submission recorded.
  const stepAreaRai = pickStepValue(step2, ['area_rai', 'areaRai']);
  let areaText: string;
  if (stepAreaRai !== null) {
    const ngan = pickStepValue(step2, ['area_ngan', 'areaNgan']) || '0';
    const sqWa = pickStepValue(step2, ['area_sq_wa', 'areaSqWa']) || '0';
    const totalSqm = legacyAreaToSqm(stepAreaRai, 'rai')
      + legacyAreaToSqm(ngan, 'ngan')
      + legacyAreaToSqm(sqWa, 'sqwa');
    areaText = `${formatAreaSqm(totalSqm)} ${AREA_UNIT_LABEL}`;
  } else {
    // Multi-plot: sum every plot's areaSize (one unit across the submission);
    // else the farm total.
    const unit = pickStepValue(plot0, ['areaUnit']) || pickStepValue(farm, ['totalAreaUnit']);
    const plotTotal = plots.reduce((sum, p) => sum + (Number(pickStepValue(asRec(p), ['areaSize']) || 0) || 0), 0);
    const size = plotTotal > 0 ? String(plotTotal) : pickStepValue(farm, ['totalAreaSize']);
    areaText = size ? `${formatAreaSqm(legacyAreaToSqm(size, unit))} ${AREA_UNIT_LABEL}` : '-';
  }

  return { operatorName, operatorType, plantName, plotName, province, surroundingEnvironment, areaText };
}
