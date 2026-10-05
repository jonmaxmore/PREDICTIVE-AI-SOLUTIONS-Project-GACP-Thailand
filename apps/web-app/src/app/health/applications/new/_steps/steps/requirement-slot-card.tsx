'use client';

/**
 * The wizard's ONE upload surface.
 *
 * Every step that needs a paper renders this card, and every fact on it comes from the
 * server's answer (`GET /applications/:id/requirements`) — the label, whether it is
 * required, why it is required, and whether the server can already see a file. The
 * browser keeping its own copy of the required set is exactly how a farmer was told
 * ครบ on one screen and ไม่ครบ on the next; a card that renders the server's row
 * cannot drift from it.
 *
 * The second upload door (a separate "documents" step listing everything at the end)
 * was retired for the same reason: two surfaces, two answers.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { uploadDraftDocument } from '@/lib/services/draft-document-upload';
import { Icons } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import {
    acknowledgePrecheck, ACKNOWLEDGE_PRECHECK_FAILED_TH, deleteDraftDocument, DELETE_DOCUMENT_COPY_TH,
    type RequirementSlot,
} from '@/lib/services/application-requirements';
import {
    slotCardState, openSlotDocument, requiredReasonBadge, SLOT_CARD_COPY_TH,
    isPrecheckState, precheckObservations, PRECHECK_COPY_TH,
} from './requirement-slot-card-state';

export interface RequirementSlotCardProps {
    slot: RequirementSlot;
    /** The draft this upload belongs to. */
    appId: string;
    /** Ask the step to re-read the server's answer — never patch it locally. */
    onChanged: () => void;
    /** Which wizard step the upload came from; the server files documents by step. */
    stepKey?: string;
    /**
     * The server's word (GET /requirements `editable`) that this filing still takes
     * document writes. Defaults to false: without an answer the delete control is
     * shown disabled rather than offered to a filing the door would refuse.
     */
    editable?: boolean;
}

export function RequirementSlotCard({ slot, appId, onChanged, stepKey, editable = false }: RequirementSlotCardProps) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const cancelRef = useRef<HTMLButtonElement | null>(null);
    const idBase = useId();
    /** The in-page "are you sure" for delete (walk D3) — never window.confirm. */
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** The acknowledgement the server just recorded, until the re-read brings it back. */
    const [acknowledgedId, setAcknowledgedId] = useState<string | null>(null);
    const [acknowledging, setAcknowledging] = useState(false);

    const state = slotCardState(slot);
    const reasonBadge = requiredReasonBadge(slot);
    // The four pre-check states are all an attached file; they add a line, not a colour.
    const attached = state === 'attached' || isPrecheckState(state);
    const precheck = slot.precheck ?? null;
    const acknowledged = Boolean(precheck?.acknowledgedAt) || (precheck !== null && acknowledgedId === precheck.id);
    const documentId = slot.documentId ?? null;
    const canOfferDelete = attached && documentId !== null;
    const lockedHintId = `${idBase}-delete-locked`;
    const deleteQuestionId = `${idBase}-delete-question`;

    // Focus lands on the safe choice when the question opens, so a keyboard user is
    // never one Enter away from deleting.
    useEffect(() => {
        if (confirmingDelete) { cancelRef.current?.focus(); }
    }, [confirmingDelete]);

    const handleDelete = async () => {
        if (!documentId) { return; }
        setDeleting(true);
        setError(null);
        try {
            await deleteDraftDocument(appId, documentId);
            setConfirmingDelete(false);
            // The server decides what the slot looks like now: re-read it.
            onChanged();
        } catch (err) {
            setError(err instanceof Error && err.message ? err.message : DELETE_DOCUMENT_COPY_TH.failed);
            setConfirmingDelete(false);
        } finally {
            setDeleting(false);
        }
    };

    const handleAcknowledge = async () => {
        if (!precheck) { return; }
        setAcknowledging(true);
        setError(null);
        try {
            await acknowledgePrecheck(appId, precheck.id);
            setAcknowledgedId(precheck.id);
            // The server's answer is still the one that counts: re-read it.
            onChanged();
        } catch {
            // Always the card's own Thai sentence: a transport failure's message is
            // English ("Failed to fetch") and says nothing the applicant can act on.
            setError(ACKNOWLEDGE_PRECHECK_FAILED_TH);
        } finally {
            setAcknowledging(false);
        }
    };

    const handleFile = async (file: File | undefined) => {
        if (!file) { return; }
        setBusy(true);
        setError(null);
        const result = await uploadDraftDocument({
            file,
            slotId: slot.slotId,
            applicationId: appId,
            ...(stepKey ? { stepKey } : {}),
        });
        setBusy(false);
        if (result.error) {
            setError(result.error);
            return;
        }
        // Re-ask the server rather than marking this card done locally. The server is
        // the only thing that decides whether a slot is satisfied.
        onChanged();
    };

    return (
        <div
            className={cn(
                'rounded-xl border-2 p-4 transition-colors duration-200',
                attached && 'border-leaf-300 bg-leaf-soft',
                // Themed tokens: stock amber-50 kept a light ground in dark (walk D2).
                state === 'missing' && 'border-caution-edge bg-caution-soft',
                // An optional gap is NOT a problem: it never counts toward completeness,
                // so it must not wear the same amber as a paper the law demands.
                state === 'optional-missing' && 'border-muted bg-card',
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                        {slot.labelTH}
                        {slot.required && <span aria-hidden className="ml-1 text-destructive">*</span>}
                        {slot.required && <span className="sr-only"> (บังคับ)</span>}
                    </p>
                    {reasonBadge && (
                        <p className="mt-1 text-xs font-medium text-leaf-onSoft">{reasonBadge}</p>
                    )}
                    {slot.description && (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{slot.description}</p>
                    )}
                    {slot.sourceHint && (
                        <p className="mt-1 text-xs text-muted-foreground">
                            {SLOT_CARD_COPY_TH.sourceLabel} {slot.sourceHint}
                        </p>
                    )}
                </div>
                {!slot.required && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {SLOT_CARD_COPY_TH.optionalBadge}
                    </span>
                )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
                {attached ? (
                    <>
                        <span className="inline-flex items-center gap-1 text-xs text-foreground">
                            <Icons.FileCheck size={14} className="text-leaf-700" />
                            {slot.fileName || SLOT_CARD_COPY_TH.attached}
                        </span>
                        {/* A BUTTON, never an anchor at the file. /uploads is served
                            Content-Disposition: attachment, so a link would drop a copy of a
                            national-ID scan onto the reader's disk. */}
                        <button
                            type="button"
                            onClick={() => { void openSlotDocument(slot); }}
                            className="hover:bg-leaf-soft rounded-lg border border-leaf-300 px-2.5 py-1 text-xs text-leaf-onSoft"
                        >
                            {SLOT_CARD_COPY_TH.view}
                        </button>
                        {/* On checked-flags the same action is offered as "อัปโหลดไฟล์ใหม่"
                            next to the observations; two buttons for one action would read
                            as two different things. */}
                        {state !== 'checked-flags' && (
                            <button
                                type="button"
                                onClick={() => inputRef.current?.click()}
                                disabled={busy}
                                className="rounded-lg border border-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                            >
                                {SLOT_CARD_COPY_TH.replace}
                            </button>
                        )}
                        {/* Delete (walk D3): the door also retires the file's pre-check.
                            Disabled, with the reason, once the server says the filing no
                            longer takes document writes. */}
                        {canOfferDelete && !confirmingDelete && (
                            <button
                                type="button"
                                onClick={() => { setError(null); setConfirmingDelete(true); }}
                                disabled={!editable || busy || deleting}
                                aria-describedby={editable ? undefined : lockedHintId}
                                className="rounded-lg border border-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {DELETE_DOCUMENT_COPY_TH.delete}
                            </button>
                        )}
                        {canOfferDelete && !editable && (
                            <span id={lockedHintId} className="sr-only">{DELETE_DOCUMENT_COPY_TH.locked}</span>
                        )}
                    </>
                ) : (
                    <>
                        <span role="status" className="text-xs text-muted-foreground">
                            {SLOT_CARD_COPY_TH.missing}
                        </span>
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            disabled={busy}
                            className="rounded-lg bg-leaf-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-leaf-800 disabled:bg-leaf-300"
                        >
                            {SLOT_CARD_COPY_TH.upload}
                        </button>
                    </>
                )}
            </div>

            {/* The document pre-check. Warn-only: it informs, the officer decides, and
                nothing here touches whether the filing may be submitted. Surfaces are
                the card's own (bg-leaf-soft flips in .dark); text uses the foreground
                tokens so it flips with them. */}
            {state === 'checking' && (
                <p role="status" data-precheck="checking" className="mt-2 text-xs text-muted-foreground">
                    {PRECHECK_COPY_TH.checking}
                </p>
            )}
            {state === 'checked-ok' && (
                <p role="status" data-precheck="checked-ok" className="mt-2 text-xs text-foreground">
                    {PRECHECK_COPY_TH.checkedOk}
                </p>
            )}
            {state === 'check-failed' && (
                <p role="status" data-precheck="check-failed" className="mt-2 text-xs text-muted-foreground">
                    {PRECHECK_COPY_TH.checkFailed}
                </p>
            )}
            {state === 'checked-flags' && (
                <div data-precheck="checked-flags" className="mt-3 border-l-4 border-amber-400 pl-3">
                    <p className="text-xs font-semibold text-foreground">{PRECHECK_COPY_TH.observations}</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-foreground">
                        {precheckObservations(precheck).map((flag, i) => (
                            <li key={`${flag.check}-${i}`}>{flag.reasonTH}</li>
                        ))}
                    </ul>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            disabled={busy}
                            className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
                        >
                            {PRECHECK_COPY_TH.uploadNew}
                        </button>
                        <button
                            type="button"
                            onClick={() => { void handleAcknowledge(); }}
                            disabled={acknowledged || acknowledging}
                            // Disabled paints muted tokens: white on leaf-300 was 1.7:1 and
                            // stayed that way after acknowledging (walk D6).
                            className="rounded-lg bg-leaf-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-leaf-800 disabled:bg-muted disabled:text-muted-foreground"
                        >
                            {PRECHECK_COPY_TH.confirm}
                        </button>
                        {acknowledged && (
                            <span role="status" className="text-xs font-medium text-leaf-onSoft">
                                {PRECHECK_COPY_TH.acknowledged}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {confirmingDelete && (
                <div
                    role="alertdialog"
                    aria-labelledby={deleteQuestionId}
                    className="mt-3 rounded-lg border border-border bg-card p-3"
                >
                    <p id={deleteQuestionId} className="text-xs leading-relaxed text-foreground">
                        {DELETE_DOCUMENT_COPY_TH.question}
                        {slot.fileName && <span className="mt-1 block font-semibold">{slot.fileName}</span>}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => { void handleDelete(); }}
                            disabled={deleting}
                            className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-60"
                        >
                            {DELETE_DOCUMENT_COPY_TH.confirm}
                        </button>
                        <button
                            ref={cancelRef}
                            type="button"
                            onClick={() => setConfirmingDelete(false)}
                            disabled={deleting}
                            className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60"
                        >
                            {DELETE_DOCUMENT_COPY_TH.cancel}
                        </button>
                    </div>
                </div>
            )}

            {error && (
                <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>
            )}

            <input
                ref={inputRef}
                type="file"
                className="hidden"
                onChange={(e) => { void handleFile(e.target.files?.[0]); }}
            />
        </div>
    );
}

export default RequirementSlotCard;
