'use client';

/**
 * Step 5 — แผนงาน เอกสาร และใบอนุญาต.
 *
 * The last step that can ask for a paper, and therefore the one that has to account for
 * EVERY slot the server returned which no earlier step owns. A required slot shown by
 * nobody is one the submit gate refuses the filing for while the applicant cannot see
 * what to do — so `otherRequired` is a remainder, not a hand-written list, and a rule
 * filed tomorrow appears here without a code change.
 *
 * Optional papers sit behind a fold. They never count toward completeness
 * (review-completeness.ts is law), so they are offered, not demanded.
 */

import { useState } from 'react';
import { useApplicationFlowStore } from '../hooks/use-application-flow-store';
import { useRequirementSlots, SLOTS_LOADING_TH, SLOTS_PENDING_TH } from '../hooks/use-requirement-slots';
import { RequirementSlotCard } from './requirement-slot-card';
import { step5Groups, STEP5_COPY_TH } from './step5-plans-docs-config';
import type { RequirementSlot } from '@/lib/services/application-requirements';

export interface Step5PlansDocsProps {
    slots: readonly RequirementSlot[];
    appId: string;
    onChanged: () => void;
    /** The server's word that this filing still takes document writes (delete control). */
    editable?: boolean;
}

export function Step5PlansDocs({ slots, appId, onChanged, editable = false }: Step5PlansDocsProps) {
    const [optionalOpen, setOptionalOpen] = useState(false);
    const { lead, otherRequired, optional } = step5Groups(slots);

    const cards = (group: RequirementSlot[]) => group.map((slot) => (
        <RequirementSlotCard key={slot.slotId} slot={slot} appId={appId} onChanged={onChanged} editable={editable} stepKey="plans-docs" />
    ));

    const nothingAtAll = lead.length === 0 && otherRequired.length === 0 && optional.length === 0;

    return (
        <div className="space-y-8">
            {nothingAtAll && (
                <p role="status" className="rounded-xl border-2 border-muted bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                    {STEP5_COPY_TH.nothingRequired}
                </p>
            )}

            {lead.length > 0 && (
                <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">{STEP5_COPY_TH.plansHeading}</h3>
                    <div className="space-y-3">{cards(lead)}</div>
                </section>
            )}

            {otherRequired.length > 0 && (
                <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">{STEP5_COPY_TH.otherHeading}</h3>
                    <div className="space-y-3">{cards(otherRequired)}</div>
                </section>
            )}

            {optional.length > 0 && (
                <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">{STEP5_COPY_TH.optionalHeading}</h3>
                    <p className="text-xs text-muted-foreground">{STEP5_COPY_TH.optionalHelp}</p>
                    <button
                        type="button"
                        aria-expanded={optionalOpen}
                        onClick={() => setOptionalOpen((open) => !open)}
                        className="rounded-lg border border-muted px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                    >
                        {optionalOpen ? STEP5_COPY_TH.optionalHide : STEP5_COPY_TH.optionalShow}
                    </button>
                    {optionalOpen && <div className="space-y-3">{cards(optional)}</div>}
                </section>
            )}
        </div>
    );
}

export default Step5PlansDocs;

/** The routed step. */
export function Step5PlansDocsStep() {
    const { state } = useApplicationFlowStore();
    const appId = state.applicationId ?? '';
    // Honest states (2026-09-06): a missing appId or an in-flight read must never
    // render as "คุณไม่ต้องแนบอะไร" — that is exactly what the operator saw on demo.
    const { slots, loading, error, pending, editable, reload } = useRequirementSlots(appId);

    return (
        <div className="space-y-4">
            {loading && (
                <p role="status" className="rounded-xl border-2 border-muted bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                    {SLOTS_LOADING_TH}
                </p>
            )}
            {!loading && pending && (
                <p role="status" className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                    {SLOTS_PENDING_TH}
                </p>
            )}
            {!loading && !pending && error && (
                <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {error}
                    <button
                        type="button"
                        onClick={() => { void reload(); }}
                        className="ms-2 font-semibold underline underline-offset-2"
                    >
                        ลองใหม่
                    </button>
                </p>
            )}
            {/* `pending` must gate this too: with no application id the slot list is
                empty for a reason that is NOT "nothing is owed", and Step5PlansDocs
                renders exactly that claim — the one sentence this file's own header
                says a failed-or-unasked read must never make. */}
            {!loading && !error && !pending && (
                <Step5PlansDocs slots={[...slots]} appId={appId} editable={editable} onChanged={() => { void reload(); }} />
            )}
        </div>
    );
}
