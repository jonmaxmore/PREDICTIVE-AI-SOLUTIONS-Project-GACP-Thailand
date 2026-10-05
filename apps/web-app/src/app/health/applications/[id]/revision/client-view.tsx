'use client';

/**
 * แก้ไขเอกสารตามที่เจ้าหน้าที่ขอ — the applicant's end of the per-slot loop.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────────
 * A filing used to come back as "แก้ไข" with one note, and the applicant
 * re-uploaded everything because they could not tell which paper was wrong. This
 * page shows ONLY the papers the officer asked for, each with the officer's own
 * words and a due date, and nothing else — the papers already accepted are not
 * on this screen at all, because re-sending them is exactly the work being
 * removed.
 *
 * ── THE RULES ARE NOT HERE ────────────────────────────────────────────────────
 * `revision-state.ts` holds whether a paper counts as replaced and whether the
 * filing may be sent back, mirroring the server. The screen may be LESS
 * permissive than the door, never more.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { apiClient as api } from '@/lib/api';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import {
    REVISION_COPY_TH as COPY,
    isReplaced,
    submitState,
    daysUntil,
    type RequestedDocument,
} from './revision-state';

interface RequirementSlot {
    slotId: string;
    labelTH: string;
    uploadedAt: string | null;
}
interface RequirementsPayload {
    slots: RequirementSlot[];
    /** null means the ask could not be read — never "nothing was asked". */
    requestedDocuments: Array<{
        slotId: string; reason: string | null; dueDate: string | null; requestedAt: string;
    }> | null;
}

/** Thai date, Buddhist era — the form a farmer reads on every other screen. */
function thaiDate(value: string | null): string {
    if (!value) { return '—'; }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) { return '—'; }
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function ClientView() {
    const params = useParams();
    const router = useRouter();
    const id = String((params as Record<string, string | string[] | undefined>)?.id || '');

    const [docs, setDocs] = useState<RequestedDocument[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sending, setSending] = useState(false);

    const load = useCallback(async () => {
        if (!id) { return; }
        const res = await api.get<RequirementsPayload>(`/api/applications/${id}/requirements?includeReviews=1`);
        if (!res.success || !res.data) {
            setError(COPY.reviewsUnavailable);
            return;
        }
        if (res.data.requestedDocuments === null) {
            // Reported, not faked as an empty list. "Nothing was asked of you" is
            // the one thing a failed read must not say on this screen.
            setError(COPY.reviewsUnavailable);
            return;
        }
        const bySlot = new Map(res.data.slots.map((s) => [s.slotId, s]));
        setDocs(res.data.requestedDocuments.map((r) => ({
            slotId: r.slotId,
            // The paper's own name. Nobody outside the codebase knows what
            // `sop_manual` is, and this is the screen where it matters most.
            labelTH: bySlot.get(r.slotId)?.labelTH || r.slotId,
            reason: r.reason,
            dueDate: r.dueDate,
            requestedAt: r.requestedAt,
            uploadedAt: bySlot.get(r.slotId)?.uploadedAt || null,
        })));
        setError(null);
    }, [id]);

    useEffect(() => { void load(); }, [load]);

    const state = useMemo(() => submitState(docs || []), [docs]);

    async function sendBack() {
        setSending(true);
        setError(null);
        const res = await api.post(`/api/applications/${id}/revision-resubmit`, {});
        setSending(false);
        if (!res.success) {
            setError((res as { messageTh?: string; error?: string }).messageTh
                || res.error || 'ส่งกลับให้เจ้าหน้าที่ไม่สำเร็จ');
            await load();
            return;
        }
        router.push(`/health/applications/${id}`);
    }

    if (error && !docs) {
        return (
            <div className="mx-auto max-w-3xl p-6">
                <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {error}
                </p>
            </div>
        );
    }
    if (!docs) { return <PageSkeleton />; }

    return (
        <div className="mx-auto max-w-3xl space-y-6 p-6">
            <header className="space-y-1">
                <h1 className="text-xl font-semibold text-foreground">{COPY.title}</h1>
                <p className="text-sm text-muted-foreground">{COPY.intro}</p>
            </header>

            {error && (
                <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {error}
                </p>
            )}

            {docs.length === 0 && (
                <p role="status" className="rounded-xl border-2 border-muted bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                    {COPY.nothingRequested}
                </p>
            )}

            {docs.map((doc) => {
                const replaced = isReplaced(doc);
                const left = daysUntil(doc.dueDate);
                return (
                    <section
                        key={doc.slotId}
                        className={`space-y-2 rounded-2xl border bg-card p-4 ${replaced ? 'border-muted' : 'border-amber-400'}`}
                    >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2 className="text-sm font-medium text-foreground">{doc.labelTH}</h2>
                            <Badge className={replaced ? 'bg-leaf-soft text-leaf-800' : 'bg-amber-100 text-amber-900'}>
                                {replaced ? COPY.replaced : COPY.stillNeeded}
                            </Badge>
                        </div>

                        {doc.reason && (
                            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                <span className="font-medium">{COPY.reasonLabel}: </span>{doc.reason}
                            </p>
                        )}

                        <p className="text-xs text-muted-foreground">
                            {COPY.dueLabel} {thaiDate(doc.dueDate)}
                            {left !== null && left < 0 && <span className="ml-2 text-destructive">เลยกำหนดแล้ว</span>}
                            {left !== null && left >= 0 && <span className="ml-2">(อีก {left} วัน)</span>}
                        </p>

                        <Button asChild variant="outline">
                            <a href={`/health/applications/new/step/5?slot=${encodeURIComponent(doc.slotId)}&app=${encodeURIComponent(id)}`}>
                                {COPY.replaceCta}
                            </a>
                        </Button>
                    </section>
                );
            })}

            <section className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-2xl border border-muted bg-card p-4">
                <Button
                    type="button"
                    className="bg-leaf-700 text-white hover:bg-leaf-800 disabled:bg-leaf-300"
                    disabled={!state.canSubmit || sending}
                    onClick={() => void sendBack()}
                >
                    {COPY.submit}
                </Button>
                {state.blockedReason && (
                    <p className="text-xs text-muted-foreground">{state.blockedReason}</p>
                )}
            </section>
        </div>
    );
}
