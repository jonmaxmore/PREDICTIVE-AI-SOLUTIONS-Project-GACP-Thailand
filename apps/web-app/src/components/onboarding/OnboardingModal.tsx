'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { usePricing } from '@/hooks/use-pricing';
import { FEE_SERVICES_FALLBACK } from '@/lib/pricing/fee-services';
import {
    feesNotice,
    formatBaht,
    vatPercentLabel,
    type FeesState,
} from '@/lib/pricing/public-fees';
import {
    CERTIFICATE_VALIDITY_TH,
    GACP_CERTIFICATE_VALIDITY_YEARS,
    PAYEE_TH,
    RENEWAL_REMINDER_DAYS_TH,
    RENEWAL_WINDOW_TH,
} from '@/constants/service-facts';
import { FARMER_NAV } from '@/lib/navigation/nav-config';
import { SUPPORT_EMAIL } from '@/constants/contact-emails';

/**
 * OnboardingModal — Iter 28 customer success first-run walkthrough.
 *
 * Presents the 5-step welcome tour for new applicants:
 *   1) ยินดีต้อนรับสู่ GACP THAILAND
 *   2) ขั้นตอนการขอรับรอง ตามลำดับของ state machine
 *   3) ค่าธรรมเนียม 2 งวด ต่อรูปแบบการปลูก (ยอดมาจาก GET /api/pricing/fees
 *      ผ่าน usePricing ไม่มีตัวเลขในไฟล์นี้ อ่านไม่ได้ = ไม่แสดงตัวเลข)
 *   4) อายุใบรับรองและการต่ออายุ (constants/service-facts.ts)
 *   5) ศูนย์ช่วยเหลือ
 *
 * Operator decision 6 (2026-09-17), audit UXUI-01: this tour used to call the
 * two instalments of one scope "scope เล็ก" and "scope ใหญ่", say the
 * certificate lasts 3 years (the backend issues for 1), put instalment 2 after
 * the farm inspection, and promise help "ได้ตลอดเวลา" beside "ในเวลาราชการ"
 * and an email address. Every fact below now comes from a record:
 *   - order of steps: services/workflow-transition-service.js (instalment 1
 *     before document review, instalment 2 after DOC_APPROVED and before
 *     AUDIT_CONFIRMED), quotation acceptance first (payment-terms v1.2 §3.3, §5.4);
 *   - amounts: GET /api/pricing/fees; payee: W14 (service-facts PAYEE_TH);
 *   - validity, reminder days, renewal window: service-facts, which the backend
 *     pins to CERTIFICATE.VALIDITY_YEARS and renewal-service REMINDER_DAYS;
 *   - help: the menu label is read from nav-config; the contact address and
 *     hours are the ones the help centre's contact page states
 *     (constants/contact-emails.ts SUPPORT_EMAIL, the help centre's อีเมลทั่วไป;
 *     app/help/contact/page.tsx: จันทร์ - ศุกร์ 08:30 - 16:30,
 *     i.e. ในเวลาราชการ). The first port of this change (2026-09-17) removed the
 *     email line under a no-email reading that the operator corrected on
 *     2026-09-26: email is not used for 2FA or password reset, and it stays as
 *     contact information. What stays removed is "ได้ตลอดเวลา", which the same
 *     card contradicted.
 *
 * The modal exposes Skip and Next buttons; on the final step Next
 * becomes "เริ่มใช้งาน" and calls onComplete. Both Skip and Complete
 * persist `onboardingCompleted = true` in localStorage so the modal
 * never reappears for the same browser profile. The real persistence
 * (sync to user.metadata) is handled by the caller via onComplete.
 */

export type OnboardingStep = {
    title: string;
    description: string;
    bullets?: ReadonlyArray<string>;
    illustration?: React.ReactNode;
    cta?: string;
};

const HELP_MENU_LABEL = FARMER_NAV.find((item) => item.key === 'help')?.labelTH ?? 'ช่วยเหลือ';

/**
 * The tour, with the fee lines taken from the served fees. While they load, or
 * when they cannot be read, each fee line becomes feesNotice(state) and no
 * number is shown: a remembered price is the one that goes stale.
 */
export function buildOnboardingSteps(state: FeesState): ReadonlyArray<OnboardingStep> {
    const fees = state.status === 'ready' ? state.fees : null;
    // Names: the server's catalogue when served, else the one web mirror (operator 2026-10-03).
    const services = fees?.services ?? FEE_SERVICES_FALLBACK;
    const notice = feesNotice(state);
    return [
    {
        title: 'ยินดีต้อนรับสู่ GACP THAILAND',
        description:
            'ระบบยื่นขอรับรองมาตรฐานการปฏิบัติทางการเกษตรที่ดีสำหรับพืชสมุนไพร ใบรับรองออกโดยกรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
        bullets: [
            'ยื่นคำขอและแนบเอกสารออนไลน์',
            'ติดตามสถานะคำขอได้ในระบบ',
            'รับใบรับรองดิจิทัลพร้อม QR Code',
        ],
        cta: 'ถัดไป',
    },
    {
        title: 'ขั้นตอนการขอรับรอง',
        description:
            'ตั้งแต่ยื่นคำขอ ชำระค่าบริการ ตรวจเอกสาร ตรวจประเมินฟาร์ม จนถึงออกใบรับรอง ติดตามได้ทุกขั้นในระบบ',
        bullets: [
            'ยื่นคำขอและแนบเอกสาร แล้วกดยอมรับใบเสนอราคา',
            'ชำระงวดที่ 1 แล้วเจ้าหน้าที่จึงเริ่มตรวจเอกสาร',
            'เมื่อเอกสารผ่าน ชำระงวดที่ 2 ก่อนนัดตรวจประเมินฟาร์ม',
            'ตรวจประเมินฟาร์มและแก้ไขข้อบกพร่องถ้ามี แล้วจึงออกใบรับรอง',
        ],
        cta: 'ถัดไป',
    },
    {
        title: 'ค่าบริการ (ชำระ 2 งวด)',
        description: fees
            ? `คิดตามจำนวนรูปแบบการปลูกในคำขอ ยอดด้านล่างคือค่าบริการต่อ 1 รูปแบบการปลูก รวม VAT ${vatPercentLabel(fees)} แล้ว`
            : 'คิดตามจำนวนรูปแบบการปลูกในคำขอ ยอดที่ต้องชำระจริงแสดงในใบเสนอราคาของคำขอ',
        bullets: [
            ...(fees
                ? [
                    `${services.PHASE_1.name} ${formatBaht(fees.phase1TotalPerScope)} บาท ชำระหลังยื่นคำขอ`,
                    `${services.PHASE_2.name} ${formatBaht(fees.phase2TotalPerScope)} บาท ชำระก่อนนัดตรวจ`,
                ]
                : [
                    `${services.PHASE_1.name} ชำระหลังยื่นคำขอ`,
                    `${services.PHASE_2.name} ชำระก่อนนัดตรวจ`,
                    notice,
                ]),
            `ชำระให้${PAYEE_TH}เพียงรายเดียว`,
            'ใบเสร็จออกให้อัตโนมัติเมื่อระบบยืนยันการชำระเงิน',
        ],
        cta: 'ถัดไป',
    },
    {
        title: `ใบรับรองมีอายุ ${GACP_CERTIFICATE_VALIDITY_YEARS} ปี`,
        description: `${CERTIFICATE_VALIDITY_TH} ต้องยื่นต่ออายุก่อนใบรับรองหมดอายุ`,
        bullets: [
            `มีการแจ้งเตือนในระบบล่วงหน้า ${RENEWAL_REMINDER_DAYS_TH} วันก่อนหมดอายุ`,
            RENEWAL_WINDOW_TH,
            fees
                ? `${services.RENEWAL.name} ${formatBaht(fees.renewalTotalPerScope)} บาท ต่อรูปแบบการปลูก ชำระครั้งเดียว ไม่มีการตรวจเอกสาร`
                : `${services.RENEWAL.name}คิดต่อรูปแบบการปลูก ชำระครั้งเดียว ไม่มีการตรวจเอกสาร ${notice}`,
        ],
        cta: 'ถัดไป',
    },
    {
        title: 'ศูนย์ช่วยเหลือ',
        description:
            'รวมคำตอบเรื่องการสมัคร การชำระเงิน การคืนเงิน และใบรับรอง',
        bullets: [
            'ค้นหาคำตอบในหน้าคำถามที่พบบ่อย',
            `เปิดได้จากเมนู "${HELP_MENU_LABEL}" ในแถบนำทาง`,
            `ติดต่อเจ้าหน้าที่ทางอีเมล ${SUPPORT_EMAIL} ในเวลาราชการ`,
        ],
        cta: 'เริ่มใช้งาน',
    },
    ];
}

export const ONBOARDING_STORAGE_KEY = 'gacp.onboardingCompleted';

export interface OnboardingModalProps {
    /** Controlled open state. When omitted the component manages itself. */
    open?: boolean;
    /** Steps to show. Defaults to the 5-step walkthrough built from the served fees. */
    steps?: ReadonlyArray<OnboardingStep>;
    /** Called when the user finishes the walkthrough successfully. */
    onComplete?: () => void;
    /** Called when the user skips. */
    onSkip?: () => void;
    /** Persist to localStorage on complete / skip. Default true. */
    persist?: boolean;
    /** Initial step index. */
    initialStep?: number;
}

/**
 * With `steps` the caller owns the content. Without, the modal reads the served
 * fees itself (usePricing) and builds the default tour from them. Two
 * components so the pricing request runs only when the modal needs it.
 */
export function OnboardingModal(props: OnboardingModalProps) {
    return props.steps ? <OnboardingModalView {...props} steps={props.steps} /> : <OnboardingModalWithServedFees {...props} />;
}

function OnboardingModalWithServedFees(props: OnboardingModalProps) {
    const { state } = usePricing();
    const steps = React.useMemo(() => buildOnboardingSteps(state), [state]);
    return <OnboardingModalView {...props} steps={steps} />;
}

function OnboardingModalView({
    open: openProp,
    steps,
    onComplete,
    onSkip,
    persist = true,
    initialStep = 0,
}: OnboardingModalProps & { steps: ReadonlyArray<OnboardingStep> }) {
    const [internalOpen, setInternalOpen] = React.useState<boolean>(true);
    const [stepIndex, setStepIndex] = React.useState<number>(initialStep);

    const isControlled = typeof openProp === 'boolean';
    const open = isControlled ? Boolean(openProp) : internalOpen;
    const step = steps[stepIndex];
    const isLast = stepIndex === steps.length - 1;

    const close = React.useCallback(() => {
        if (!isControlled) setInternalOpen(false);
    }, [isControlled]);

    const writeFlag = React.useCallback(() => {
        if (!persist) return;
        try {
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
            }
        } catch {
            // ignore storage errors (private mode, etc.)
        }
    }, [persist]);

    const handleSkip = React.useCallback(() => {
        writeFlag();
        onSkip?.();
        close();
    }, [writeFlag, onSkip, close]);

    const handleNext = React.useCallback(() => {
        if (isLast) {
            writeFlag();
            onComplete?.();
            close();
            return;
        }
        setStepIndex((s) => Math.min(s + 1, steps.length - 1));
    }, [isLast, writeFlag, onComplete, close, steps.length]);

    const handleBack = React.useCallback(() => {
        setStepIndex((s) => Math.max(s - 1, 0));
    }, []);

    // Lock body scroll while open so the dialog truly modals over content.
    React.useEffect(() => {
        if (!open || typeof document === 'undefined') return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [open]);

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
            aria-describedby="onboarding-desc"
            data-testid="onboarding-modal"
            className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-4 md:items-center"
        >
            <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                    <span className="text-xs font-semibold uppercase text-leaf-700">
                        เริ่มต้นใช้งาน · GACP THAILAND
                    </span>
                    <span className="text-xs font-medium tabular-nums text-slate-500">
                        ขั้นที่ {stepIndex + 1} / {steps.length}
                    </span>
                </div>

                {/* Progress bar */}
                <div className="h-1 w-full bg-slate-100" aria-hidden="true">
                    <div
                        className="h-full bg-leaf-700 transition-all"
                        style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
                    />
                </div>

                <div className="px-5 py-6 md:px-7 md:py-8">
                    {/* Illustration placeholder */}
                    <div className="mb-5 flex h-32 items-center justify-center rounded-xl bg-gradient-to-br from-leaf-soft via-white to-leaf-soft">
                        {step?.illustration ?? <StepGlyph index={stepIndex} />}
                    </div>

                    <h2 id="onboarding-title" className="text-lg font-bold text-slate-900 md:text-xl">
                        {step?.title}
                    </h2>
                    <p id="onboarding-desc" className="mt-2 text-sm leading-relaxed text-slate-600">
                        {step?.description}
                    </p>

                    {step?.bullets && step.bullets.length > 0 ? (
                        <ul className="mt-4 space-y-2 text-sm text-slate-700">
                            {step.bullets.map((b, i) => (
                                <li key={i} className="flex items-start gap-2">
                                    <CheckDot />
                                    <span className="min-w-0 flex-1">{b}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 md:px-7 md:py-4">
                    <button
                        type="button"
                        onClick={handleSkip}
                        data-testid="onboarding-skip"
                        className={cn(
                            'inline-flex h-10 items-center justify-center rounded-lg px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100',
                        )}
                    >
                        ข้าม
                    </button>
                    <div className="flex items-center gap-2">
                        {stepIndex > 0 ? (
                            <button
                                type="button"
                                onClick={handleBack}
                                data-testid="onboarding-back"
                                className={cn(
                                    'inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50',
                                )}
                            >
                                ย้อนกลับ
                            </button>
                        ) : null}
                        <button
                            type="button"
                            onClick={handleNext}
                            data-testid="onboarding-next"
                            className={cn(
                                'inline-flex h-10 items-center justify-center rounded-lg bg-leaf-700 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-leaf-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-2',
                            )}
                        >
                            {step?.cta ?? (isLast ? 'เริ่มใช้งาน' : 'ถัดไป')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function CheckDot() {
    return (
        <span
            aria-hidden="true"
            className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-leaf-soft text-leaf-onSoft"
        >
            <svg viewBox="0 0 20 20" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={3}>
                <path d="M4 10l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </span>
    );
}

function StepGlyph({ index }: { index: number }) {
    const map = ['สวัสดี', 'ขั้นตอน', '฿฿', `${GACP_CERTIFICATE_VALIDITY_YEARS} ปี`, 'ช่วยเหลือ'];
    return (
        <span
            aria-hidden="true"
            className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-leaf-700 text-base font-bold text-white shadow-sm"
        >
            {map[index] ?? `ขั้น ${index + 1}`}
        </span>
    );
}

/** Reads the persisted onboarding flag (browser-only). */
export function hasCompletedOnboarding(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

export default OnboardingModal;
