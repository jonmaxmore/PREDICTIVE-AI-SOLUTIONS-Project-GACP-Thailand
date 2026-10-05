import type React from 'react';
import { Icons } from '@/components/ui/icons';

/* ── Step Types ── */
export interface FlowStep {
    stepNumber: number;
    key: string;
    label: string;
    titleTH: string;
    description: string;
    icon: React.ComponentType<{ className?: string | undefined; size?: number | undefined }>;
    isRequired: boolean;
    // Optional English translations (opt-in i18n; Thai remains canonical default)
    labelEN?: string;
    titleEN?: string;
    descriptionEN?: string;
}

export interface PaymentStep {
    stepNumber: number;
    key: string;
    label: string;
    titleTH: string;
    isRequired: boolean;
    // Optional English translations
    labelEN?: string;
    titleEN?: string;
}

/* ──────────────────────────────────────────────
   Main Application Steps — SIX, in กทล.1's own order (v2, 2026-09-05)
   ──────────────────────────────────────────────
   The v1 list had nine entries and two holes: slot 3 was left vacant when
   "วัตถุประสงค์" folded into plant_selection, and slot 11 when quote folded into
   invoice, both so old deep links kept resolving. A number that means nothing is
   how a stepper and a URL come to disagree, so v2 renumbers 1..6 with no gaps and
   lets the KEY carry the meaning. `/step/7|8|9` redirect to `/step/6`.

   The order is the form's own: who is asking and for what (1), who they are (2),
   where the land is (3), what they grow and why (4), the plans and the papers (5),
   and last the server's own account of the filing (6) — never the browser's.

   Y1-FIX-A: every FlowStep carries `labelEN`/`titleEN`/`descriptionEN`. Consumers
   call `resolveStepLabel(step, language)` rather than reaching into these fields,
   so Thai stays canonical and a missing translation falls back instead of blanking.
   ────────────────────────────────────────────── */
export const FLOW_STEPS: FlowStep[] = [
    {
        stepNumber: 1,
        key: 'request-type',
        label: 'ประเภทคำขอ',
        titleTH: 'ประเภทคำขอและผู้ยื่น',
        description: 'เลือกว่าขอใหม่ ต่ออายุ หรือขอใบแทน และผู้ยื่นเป็นใคร',
        labelEN: 'Request type',
        titleEN: 'Request Type & Applicant',
        descriptionEN: 'Choose a new, renewal or replacement request, and who is applying.',
        icon: Icons.ShieldCheck,
        isRequired: true,
    },
    {
        stepNumber: 2,
        key: 'identity',
        label: 'ตัวตนผู้ยื่น',
        titleTH: 'ตัวตนผู้ยื่นคำขอ',
        description: 'กรอกข้อมูลตามกทล.1 ส่วนที่ ๑ และแนบเอกสารแสดงคุณสมบัติ',
        labelEN: 'Identity',
        titleEN: 'Applicant Identity',
        descriptionEN: 'Fill in the กทล.1 part 1 fields and attach the qualifying documents.',
        icon: Icons.User,
        isRequired: true,
    },
    {
        stepNumber: 3,
        key: 'site-land',
        label: 'สถานที่และที่ดิน',
        titleTH: 'สถานที่ปลูกและสิทธิในที่ดิน',
        description: 'ที่ตั้งแปลง ลักษณะพื้นที่ และเอกสารสิทธิในที่ดิน',
        labelEN: 'Site & land',
        titleEN: 'Growing Site & Land Rights',
        descriptionEN: 'Plot location, area type, and the land-rights papers.',
        icon: Icons.MapPin,
        isRequired: true,
    },
    {
        stepNumber: 4,
        key: 'variety-purpose',
        label: 'พันธุ์และวัตถุประสงค์',
        titleTH: 'ชนิดพืช สายพันธุ์ และวัตถุประสงค์',
        description: 'ระบุชนิดพืชที่ขอรับรอง สายพันธุ์ ปริมาณ และวัตถุประสงค์การผลิต',
        labelEN: 'Variety & purpose',
        titleEN: 'Plant, Strain & Purpose',
        descriptionEN: 'The plant certified, its strain and quantity, and the production purpose.',
        icon: Icons.Leaf,
        isRequired: true,
    },
    {
        stepNumber: 5,
        key: 'plans-docs',
        label: 'แผนและเอกสาร',
        titleTH: 'แผนการผลิตและเอกสารประกอบ',
        description: 'แผนการผลิต แผนรักษาความปลอดภัย และเอกสารที่กฎหมายกำหนด',
        labelEN: 'Plans & documents',
        titleEN: 'Production Plans & Documents',
        descriptionEN: 'Production plan, security plan, and the documents the law requires.',
        icon: Icons.FileText,
        isRequired: true,
    },
    {
        stepNumber: 6,
        key: 'review',
        label: 'ตรวจทาน',
        titleTH: 'ตรวจทานและส่งคำขอ',
        description: 'ตรวจสอบสิ่งที่เซิร์ฟเวอร์บันทึกไว้ก่อนยืนยันส่ง',
        labelEN: 'Review',
        titleEN: 'Review & Submit',
        descriptionEN: 'Check what the server recorded before confirming submission.',
        icon: Icons.Upload,
        isRequired: true,
    },
];

/* ── Payment Phase Steps ──
   UX consolidation (2026-05-16): the previous "quote" step (slot 10)
   and "invoice" step (slot 11) were merged into a single payment step
   to reduce the 12-step wizard's "where am I" dropout pattern flagged
   by the 5-agent UX audit. Slot 11 is intentionally left vacant so
   existing deep links to /step/12 keep resolving; a static redirect at
   /step/11/page.tsx forwards stale bookmarks to /step/10. Same pattern
   as the prior step 3 → step 2 merge. */
export const PAYMENT_STEPS: PaymentStep[] = [
    {
        stepNumber: 10,
        key: 'invoice',
        label: 'การชำระเงิน',
        titleTH: 'ใบเสนอราคาและใบแจ้งหนี้',
        labelEN: 'Payment',
        titleEN: 'Quotation & Invoice',
        isRequired: true,
    },
    // Slot 11 ("ใบแจ้งหนี้") was merged into slot 10 (payment). Kept vacant
    // so /step/12 → success bookmarks don't shift.
    {
        stepNumber: 12,
        key: 'success',
        label: 'ยื่นสำเร็จ',
        titleTH: 'สำเร็จ',
        labelEN: 'Submitted',
        titleEN: 'Success',
        isRequired: true,
    },
];

/* ── All Steps Combined ── */
export const ALL_STEPS = [...FLOW_STEPS, ...PAYMENT_STEPS];

/* ── Helpers ── */
export function getStepByNumber(stepNumber: number) {
    return ALL_STEPS.find(s => s.stepNumber === stepNumber);
}

export function getStepByKey(key: string) {
    return ALL_STEPS.find(s => s.key === key);
}

/** Step descriptions for rich header rendering (canonical Thai). */
export const STEP_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
    FLOW_STEPS.map(s => [s.key, s.description])
);

/**
 * Y1-FIX-A — language-aware step descriptions for the wizard step
 * header. The TH defaults remain canonical (per the language-context
 * fallback policy) and English descriptions are pulled from
 * `descriptionEN` when present.
 */
export function getStepDescriptions(language: StepLanguage): Record<string, string> {
    return Object.fromEntries(
        FLOW_STEPS.map(s => [s.key, resolveStepDescription(s, language)])
    );
}

/* ──────────────────────────────────────────────
   i18n label/title/description resolvers
   Pure functions — Thai is canonical default,
   English is opt-in via `language='en'` AND a
   non-empty *EN field. Empty strings fall back.
   ────────────────────────────────────────────── */
export type StepLanguage = 'th' | 'en';

/**
 * Resolve the user-visible short label for a step in the requested language.
 * Thai (`label`) is the canonical default; `labelEN` only wins when it is a
 * non-empty string AND language === 'en'.
 */
export function resolveStepLabel(
    step: Pick<FlowStep, 'label' | 'labelEN'> | Pick<PaymentStep, 'label' | 'labelEN'>,
    language: StepLanguage
): string {
    if (language === 'en' && typeof step.labelEN === 'string' && step.labelEN.length > 0) {
        return step.labelEN;
    }
    return step.label;
}

/**
 * Resolve the long Thai title (`titleTH`) or its English counterpart (`titleEN`).
 * EN only wins when `language === 'en'` and `titleEN` is a non-empty string.
 */
export function resolveStepTitle(
    step: Pick<FlowStep, 'titleTH' | 'titleEN'> | Pick<PaymentStep, 'titleTH' | 'titleEN'>,
    language: StepLanguage
): string {
    if (language === 'en' && typeof step.titleEN === 'string' && step.titleEN.length > 0) {
        return step.titleEN;
    }
    return step.titleTH;
}

/**
 * Resolve the step description (FlowStep only — PaymentStep has no description).
 * Thai `description` is canonical; `descriptionEN` only wins for `language='en'`
 * when non-empty.
 */
export function resolveStepDescription(
    step: Pick<FlowStep, 'description' | 'descriptionEN'>,
    language: StepLanguage
): string {
    if (
        language === 'en' &&
        typeof step.descriptionEN === 'string' &&
        step.descriptionEN.length > 0
    ) {
        return step.descriptionEN;
    }
    return step.description;
}
