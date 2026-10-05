'use client';

/**
 * Step 2 — ตัวตนผู้ยื่นคำขอ (กทล.1 ส่วนที่ ๑).
 *
 * Two halves, and each takes its shape from a different authority:
 *
 *   the FIELDS come from the applicant type chosen in step 1, through the catalog in
 *   step2-identity-config.ts, because the paper asks each type for different facts;
 *
 *   the DOCUMENT CARDS come from the SERVER's requirements payload, intersected with
 *   the six papers this step owns. The engine has already scoped that payload by holder
 *   type, so this screen never decides which qualification papers a filing owes — it
 *   only decides where they are shown. A fixed list here would ask a sole trader for a
 *   company registration the law never demanded.
 *
 * Presentational on purpose: the step page owns fetching and persisting, so this file
 * can be rendered in a test without a store, a router or a network.
 */


import { useApplicationFlowStore } from '../hooks/use-application-flow-store';
import { useRequirementSlots, SLOTS_LOADING_TH, SLOTS_PENDING_TH } from '../hooks/use-requirement-slots';
import { identityFieldsFor, STEP2_COPY_TH, type IdentityField } from './step2-identity-config';
import { step2QualificationSlots } from './requirement-slot-card-state';
import { RequirementSlotCard } from './requirement-slot-card';
import type { ApplicantHolderType } from '../hooks/use-application-flow-store.state-types';
import type { RequirementSlot } from '@/lib/services/application-requirements';

export interface Step2IdentityProps {
    applicantType: ApplicantHolderType | null;
    applicantData: Record<string, unknown>;
    /** The server's answer for this filing. Never a list this screen keeps. */
    slots: readonly RequirementSlot[];
    appId: string;
    onChange: (key: string, value: string) => void;
    /** Re-read the server's answer after an upload. */
    onChanged: () => void;
    /** The server's word that this filing still takes document writes (delete control). */
    editable?: boolean;
}

function FieldInput({ field, value, onChange }: {
    field: IdentityField;
    value: string;
    onChange: (key: string, value: string) => void;
}) {
    const inputId = `identity-${field.key}`;
    return (
        <div className="space-y-1">
            <label htmlFor={inputId} className="block text-sm font-medium text-foreground">
                {field.labelTH}
                {field.required && <span aria-hidden className="ml-1 text-destructive">*</span>}
                {field.required && <span className="sr-only"> (บังคับ)</span>}
            </label>
            <input
                id={inputId}
                type={field.kind === 'email' ? 'email' : field.kind === 'tel' ? 'tel' : 'text'}
                // A national ID is digits, but never `type="number"`: a leading zero is
                // significant and a spinner on an identity number is nonsense.
                inputMode={field.kind === 'nationalId' || field.kind === 'tel' ? 'numeric' : undefined}
                value={value}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="w-full rounded-xl border-2 border-muted bg-card px-4 py-2.5 text-sm text-foreground focus:border-leaf-700 focus:outline-none"
            />
            {field.helpTH && <p className="text-xs text-muted-foreground">{field.helpTH}</p>}
        </div>
    );
}

export function Step2Identity({
    applicantType, applicantData, slots, appId, onChange, onChanged, editable = false,
}: Step2IdentityProps) {
    const fields = identityFieldsFor(applicantType);

    if (fields.length === 0) {
        // Not an error — step 1 simply has not been answered yet. Say which step, so
        // the way out is in the message rather than in the applicant's memory.
        return (
            <div role="status" className="rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800">
                {STEP2_COPY_TH.noApplicantType}
            </div>
        );
    }

    const qualificationSlots = step2QualificationSlots(slots);

    return (
        <div className="space-y-8">
            <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">{STEP2_COPY_TH.identityHeading}</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                    {fields.map((field) => (
                        <FieldInput
                            key={field.key}
                            field={field}
                            value={String(applicantData[field.key] ?? '')}
                            onChange={onChange}
                        />
                    ))}
                </div>
            </section>

            {qualificationSlots.length > 0 && (
                <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">{STEP2_COPY_TH.documentsHeading}</h3>
                    <p className="text-xs text-muted-foreground">{STEP2_COPY_TH.documentsHelp}</p>
                    <div className="space-y-3">
                        {qualificationSlots.map((slot) => (
                            <RequirementSlotCard
                                key={slot.slotId}
                                slot={slot}
                                appId={appId}
                                onChanged={onChanged}
                                editable={editable}
                                stepKey="identity"
                            />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

export default Step2Identity;

/**
 * The routed step. Separated from the presentational half above so that half can be
 * rendered in a test without a store, a router or a network — and so the fetching
 * lives in exactly one place.
 *
 * It ASKS THE SERVER for the requirement payload and re-asks after every upload. It
 * never marks a card satisfied locally: the server is the only thing that decides
 * whether a slot is filled, and a browser that answers that question for itself is how
 * a farmer was told ครบ on one screen and ไม่ครบ on the next.
 */
export function Step2IdentityStep() {
    const { state, setApplicantData } = useApplicationFlowStore();
    const appId = state.applicationId ?? '';
    // Honest states (2026-09-06): a missing appId or an in-flight read must never
    // render this step's slot section as empty-because-nothing-owed.
    const { slots, loading, error: loadError, pending, editable, reload } = useRequirementSlots(appId);

    const applicantData = (state.applicantData ?? {}) as unknown as Record<string, unknown>;

    return (
        <div className="space-y-4">
            {loading && (
                <p role="status" className="rounded-xl border-2 border-muted bg-card px-4 py-3 text-center text-sm text-muted-foreground">
                    {SLOTS_LOADING_TH}
                </p>
            )}
            {!loading && pending && (
                <p role="status" className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                    {SLOTS_PENDING_TH}
                </p>
            )}
            {!loading && !pending && loadError && (
                <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {loadError}
                    <button
                        type="button"
                        onClick={() => { void reload(); }}
                        className="ms-2 font-semibold underline underline-offset-2"
                    >
                        ลองใหม่
                    </button>
                </p>
            )}
            <Step2Identity
                applicantType={state.applicantType}
                applicantData={applicantData}
                slots={[...slots]}
                editable={editable}
                appId={appId}
                onChange={(key, value) => {
                    setApplicantData({ ...applicantData, [key]: value } as never);
                }}
                onChanged={() => { void reload(); }}
            />
        </div>
    );
}
