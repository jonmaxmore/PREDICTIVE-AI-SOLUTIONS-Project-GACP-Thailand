'use client';

/**
 * Step 1 — ประเภทคำขอและผู้ยื่น (กทล.1's own first page).
 *
 * Three answers, and two of them are DIMENSIONS the requirement register matches
 * rules on. The vocabulary lives in step1-request-type-config.ts so the words this
 * screen writes are the same words the engine reads; a value spelled differently
 * does not error, it matches only the rules that bind everybody and the filing is
 * asked for almost nothing.
 *
 * The navigation bar (rendered once by application-step-page.tsx) and the route guard
 * share ONE predicate (`step1CanProceed`, reached through `isStepComplete`,
 * which is `isStepComplete(state, 1)` spelled once). Letting them disagree is how a
 * farmer gets a live button that bounces them back to the step they just left.
 */

import { useEffect, useState } from 'react';
import { useApplicationFlowStore } from '../hooks/use-application-flow-store';
import { Icons } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import { FALLBACK_PLANTS } from './plant-selection-config';
import {
    REQUEST_TYPE_OPTIONS,
    APPLICANT_TYPE_OPTIONS,
    needsCertScope,
    needsPreviousCertificate,
    SUCCEEDING_REQUEST_NOTE_TH,
    type Step1Option,
} from './step1-request-type-config';

/** One choice. A card, not a radio dot: the help line is part of the decision. */
function ChoiceCard<T extends string>({
    option, selected, onSelect,
}: { option: Step1Option<T>; selected: boolean; onSelect: (value: T) => void }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(option.value)}
            className={cn(
                'flex w-full flex-col items-start gap-1 rounded-xl border-2 p-4 text-left transition-all duration-200',
                selected
                    ? 'bg-leaf-soft border-leaf-700'
                    : 'border-muted bg-card hover:border-leaf-300',
            )}
        >
            <span className="text-sm font-semibold text-foreground">{option.labelTH}</span>
            <span className="text-xs leading-relaxed text-muted-foreground">{option.helpTH}</span>
        </button>
    );
}

function Question({ title, icon, children }: {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                {icon}
                {title}
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">{children}</div>
        </section>
    );
}

function Step1RequestTypeComponent() {
    const { state, updateState } = useApplicationFlowStore();
    const [previousCert, setPreviousCert] = useState<string>(state?.previousCertificateNumber ?? '');

    const requestType = state?.requestType ?? null;
    const applicantType = state?.applicantType ?? null;
    const plantId = state?.plantId ?? null;
    // Only the plants whose law is actually filed can be chosen; the register decides,
    // the screen only shows what it holds.
    const openPlants = FALLBACK_PLANTS.filter((p) => p.enabled);

    // Do not ask a question that has one answer. Today the register holds filed law
    // for exactly one plant, so the screen showed a single card in a three-column
    // grid, left two columns empty, and refused ถัดไป until the applicant clicked
    // the only thing there (evidence/apple-qa-audit-2026-09-07). The value still has
    // to reach the store — it is what the requirement engine matches on — so it is
    // written, not skipped. The moment a second plant opens, the effect stops firing
    // and the cards come back with no code change.
    const onlyPlantCode = openPlants.length === 1 ? openPlants[0]?.code ?? null : null;
    useEffect(() => {
        // Gated on requestType, and not only for tidiness: writing on bare mount makes
        // merely LOOKING at step 1 persist to the store (and, in jsdom, reach for an
        // IndexedDB that is not there — application-step-page-single-indicator.test.tsx
        // caught it). The plant question is not even rendered until a request type is
        // chosen, so this now fires at the same moment the question would have appeared.
        if (requestType === null) return;
        if (onlyPlantCode && plantId !== onlyPlantCode) {
            updateState({ plantId: onlyPlantCode });
        }
    }, [requestType, onlyPlantCode, plantId, updateState]);

    const chooseRequestType = (value: typeof REQUEST_TYPE_OPTIONS[number]['value']) => {
        // Changing the request type retires the answers that only its old value asked
        // for. Leaving a stale certScope on a renewal would hand the engine a scope the
        // applicant was never shown a control for.
        updateState({
            requestType: value,
            // Scope is no longer a question (operator, 2026-09-06): a NEW request IS
            // a planting filing, so the answer is written here, silently — the engine,
            // the fee and the generated กทล.1 all still read a real certScope.
            ...(needsCertScope(value) ? { certScope: 'PLANTING' } : { certScope: null }),
            ...(needsPreviousCertificate(value) ? {} : { previousCertificateNumber: null }),
        });
        if (!needsPreviousCertificate(value)) { setPreviousCert(''); }
    };

    const handlePreviousCert = (value: string) => {
        setPreviousCert(value);
        updateState({ previousCertificateNumber: value.trim() === '' ? null : value.trim() });
    };

    return (
        <div className="space-y-6">
            <Question title="ประเภทคำขอ" icon={<Icons.FileCheck size={16} className="text-leaf-700" />}>
                {REQUEST_TYPE_OPTIONS.map((option) => (
                    <ChoiceCard
                        key={option.value}
                        option={option}
                        selected={requestType === option.value}
                        onSelect={chooseRequestType}
                    />
                ))}
            </Question>

            {needsPreviousCertificate(requestType) && (
                <section className="space-y-3">
                    <p role="status" className="rounded-xl border border-leaf-onSoft bg-leaf-soft px-4 py-3 text-xs leading-relaxed text-foreground">
                        {SUCCEEDING_REQUEST_NOTE_TH}
                    </p>
                    <label className="block text-sm font-semibold text-foreground" htmlFor="previous-certificate-number">
                        เลขที่ใบรับรองเดิม
                    </label>
                    <input
                        id="previous-certificate-number"
                        type="text"
                        value={previousCert}
                        onChange={(e) => handlePreviousCert(e.target.value)}
                        placeholder="เช่น TH-GACP 87/2568"
                        className="w-full rounded-xl border-2 border-muted bg-card px-4 py-2.5 text-sm text-foreground focus:border-leaf-700 focus:outline-none"
                    />
                    <p className="text-xs text-muted-foreground">
                        กรอกเลขที่บนใบรับรองฉบับเดิม เพื่อให้เจ้าหน้าที่ทราบว่าคำขอนี้ต่อจากฉบับใด
                    </p>
                </section>
            )}

            {/* "ขอรับรองในขั้นตอนใด" is retired (operator, 2026-09-06: "ส่วนนี้ไม่ต้องมี") —
                the platform issues PLANTING permits, so choosing ขอใหม่ writes
                certScope:'PLANTING' silently in the requestType handler above. The
                CERT_SCOPE vocabulary stays in config: the engine's certScope dimension
                and the register's processing rows are real, for the day that flow returns. */}

            <Question title="ผู้ยื่นคำขอ" icon={<Icons.User size={16} className="text-leaf-700" />}>
                {APPLICANT_TYPE_OPTIONS.map((option) => (
                    <ChoiceCard
                        key={option.value}
                        option={option}
                        selected={applicantType === option.value}
                        onSelect={(value) => updateState({ applicantType: value })}
                    />
                ))}
            </Question>

            {/* ชนิดพืช — ย้ายมาจากขั้น 4 (F-QA-04, มติ operator 2026-09-06). กฎหมายยื่นเป็นรายพืช
                และกติกาเอกสารทั้งหมดห้อยจากพืช ถ้าไม่ถามตรงนี้ ขั้น 2-3 จะไม่มีเอกสารให้แนบเลย */}
            {(requestType === null || needsCertScope(requestType)) && (
                <Question title="ชนิดพืชที่ขอรับรอง" icon={<Icons.Leaf size={16} className="text-leaf-700" />}>
                    {onlyPlantCode ? (
                        // One open plant: state it as a fact the system already knows,
                        // not as a question with one answer.
                        <p className="rounded-xl border border-leaf-300 bg-leaf-soft px-4 py-3 text-sm text-foreground">
                            <span className="font-semibold">{openPlants[0]?.nameTH}</span>
                            <span className="ms-2 text-xs text-muted-foreground">
                                เอกสารที่ต้องแนบถูกกำหนดตามพืชนี้ · ขณะนี้เปิดรับคำขอเฉพาะพืชชนิดนี้
                            </span>
                        </p>
                    ) : openPlants.map((plant) => (
                        <button
                            key={plant.code}
                            type="button"
                            aria-pressed={plantId === plant.code}
                            onClick={() => updateState({ plantId: plant.code })}
                            className={cn(
                                'flex w-full flex-col items-start gap-1 rounded-xl border-2 p-4 text-left transition-all duration-200',
                                plantId === plant.code
                                    ? 'bg-leaf-soft border-leaf-700'
                                    : 'border-muted bg-card hover:border-leaf-300',
                            )}
                        >
                            <span className="text-sm font-semibold text-foreground">{plant.nameTH}</span>
                            <span className="text-xs leading-relaxed text-muted-foreground">
                                เอกสารที่ต้องแนบจะถูกกำหนดตามพืชที่เลือก
                            </span>
                        </button>
                    ))}
                </Question>
            )}

            {/* ปุ่มนำทางย้ายไปอยู่ที่หน้าห่อของ wizard (application-step-page.tsx) แล้ว
                เพราะ "ให้แต่ละขั้นเรนเดอร์ปุ่มของตัวเอง" ทำให้ขั้น 2-6 กลายเป็นทางตัน:
                ไม่มีใครลืมได้อีกเมื่อมันถูกเรนเดอร์ที่เดียวให้ทุกขั้น · เงื่อนไข canProceed
                ของขั้นนี้ยังเป็นตัวเดิม (step1CanProceed ผ่าน isStepComplete) */}
        </div>
    );
}

export const Step1RequestType = Step1RequestTypeComponent;
export default Step1RequestType;
