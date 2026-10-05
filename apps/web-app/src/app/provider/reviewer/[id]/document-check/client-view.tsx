'use client';

/**
 * กทล.๑ ส่วนสำหรับเจ้าหน้าที่ — ตรวจเอกสารทีละรายการ
 *
 * ── WHAT THIS SCREEN REPLACES ─────────────────────────────────────────────────
 * An officer used to accept or reject a whole filing with one free-text note, so
 * a filing with nine papers and one problem went back as "แก้ไข" and the applicant
 * guessed which paper — usually by re-uploading everything, which also lost the
 * officer's place. This is a line per document, which is how the ministry's own
 * form works.
 *
 * ── THE RULES ARE NOT HERE ────────────────────────────────────────────────────
 * Which button is enabled and what a row looks like live in
 * `document-check-state.ts`, tested without rendering, and mirror the server's
 * own refusals. This file is markup, fetching and optimism. The screen may be
 * LESS permissive than the door, never more: a disabled button explains better
 * than a 409, but the door is what actually decides.
 *
 * ── VIEWING A DOCUMENT ────────────────────────────────────────────────────────
 * Always through DocumentViewerModal, never `window.open(fileUrl)`. `/uploads`
 * serves `Content-Disposition: attachment` on purpose (PDPA posture), so a raw
 * link downloads an applicant's identity document onto the officer's machine
 * instead of showing it in the page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { apiClient as api } from '@/lib/api';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { DocumentViewerModal, type DocumentViewerFile } from '@/components/feature/document-viewer-modal';
import {
    DOCUMENT_CHECK_COPY_TH as COPY,
    canSubmitRequest,
    decisionState,
    rowState,
    type SlotRow,
    type OfficerPrecheck,
    canAcceptSlot,
    ACCEPT_BLOCKED_TH,
    precheckFlagLine,
    precheckConfidence,
    PRECHECK_OFFICER_COPY_TH as PRECHECK,
} from './document-check-state';

interface CheckPayload {
    round: number;
    slots: SlotRow[];
    officerChecklist: { scope: string; qualification: string; overall: string };
}

const STATE_BADGE: Record<string, { label: string; className: string }> = {
    ACCEPTED: { label: 'รับแล้ว', className: 'bg-officer-soft text-officer-800' },
    REQUESTED: { label: 'ขอเพิ่ม', className: 'bg-amber-100 text-amber-900' },
    PENDING: { label: 'กำลังดู', className: 'bg-muted text-muted-foreground' },
};

/**
 * The document pre-check under a row: what the machine noticed, how sure it was, and
 * whether the applicant has stood by the file. Information only — the verdict buttons
 * below it are unchanged and the officer's word is the only one that counts.
 */
function PrecheckBlock({ precheck }: { precheck: OfficerPrecheck }) {
    const confidence = precheck.status === 'DONE' ? precheckConfidence(precheck) : null;
    return (
        <div data-precheck className="mt-3 space-y-2 border-l-4 border-muted pl-3">
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-foreground">{PRECHECK.heading}</p>
                {confidence && (
                    <span className="text-xs text-muted-foreground">{PRECHECK.confidence} {confidence}</span>
                )}
                {precheck.acknowledgedAt && (
                    <Badge className="bg-officer-soft text-officer-onSoft">{PRECHECK.acknowledged}</Badge>
                )}
            </div>
            {/* Once per block, directly below the heading (review M1, fix round 1). */}
            <p className="text-xs text-muted-foreground">{PRECHECK.officerDecides}</p>
            {precheck.status === 'PENDING' && (
                <p className="text-xs text-muted-foreground">{PRECHECK.checking}</p>
            )}
            {precheck.status === 'FAILED' && (
                <p className="text-xs text-muted-foreground">{PRECHECK.failed}</p>
            )}
            {precheck.status === 'DONE' && (
                <ul className="space-y-1.5">
                    {precheck.flags.map((flag, i) => {
                        const line = precheckFlagLine(flag);
                        return (
                            <li key={`${flag.check}-${i}`} className="text-xs leading-relaxed text-foreground">
                                <span className={line.observation || line.manual ? 'font-semibold' : 'text-muted-foreground'}>
                                    {line.manual
                                        ? PRECHECK.manualTag
                                        : line.observation ? PRECHECK.observation : PRECHECK.nothingNoticed}
                                    {' · '}
                                </span>
                                <span className={line.manual ? 'font-semibold' : undefined}>{line.text}</span>
                                {line.snippet && (
                                    <span className="mt-0.5 block text-muted-foreground">
                                        {PRECHECK.snippet}: &ldquo;{line.snippet}&rdquo;
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

export default function ClientView() {
    const params = useParams();
    const router = useRouter();
    const id = String((params as Record<string, string | string[] | undefined>)?.id || '');

    const [data, setData] = useState<CheckPayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busySlot, setBusySlot] = useState<string | null>(null);
    const [deciding, setDeciding] = useState(false);
    const [viewing, setViewing] = useState<DocumentViewerFile | null>(null);

    /** The open per-slot "ขอเอกสารเพิ่ม" form, if any. */
    const [form, setForm] = useState<{ slotId: string; reason: string; dueDate: string } | null>(null);

    const load = useCallback(async () => {
        if (!id) { return; }
        const res = await api.get<CheckPayload>(`/api/provider/applications/${id}/document-check`);
        if (!res.success || !res.data) {
            // Never fall back to an empty checklist: on THIS screen an empty list
            // reads as "nothing to check", which is the one thing a failed read
            // must not say to someone about to accept a filing.
            setError(res.error || 'ระบบอ่านรายการเอกสารของคำขอนี้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
            return;
        }
        setData(res.data);
        setError(null);
    }, [id]);

    useEffect(() => { void load(); }, [load]);

    const decision = useMemo(() => decisionState(data?.slots || []), [data]);

    async function recordVerdict(slotId: string, verdict: 'ACCEPTED' | 'MORE_REQUESTED', reason?: string, dueDate?: string) {
        setBusySlot(slotId);
        setError(null);
        const res = await api.post(`/api/provider/applications/${id}/document-reviews`, {
            slotId, verdict, reason, dueDate,
        });
        setBusySlot(null);
        if (!res.success) {
            setError((res as { messageTh?: string; error?: string }).messageTh
                || res.error || 'บันทึกผลการตรวจไม่สำเร็จ');
            return;
        }
        setForm(null);
        await load();   // refetch: the server's answer is the one that counts
    }

    async function decide(action: 'ACCEPT_ALL' | 'REQUEST_MORE') {
        setDeciding(true);
        setError(null);
        const res = await api.post(`/api/provider/applications/${id}/document-decision`, { action });
        setDeciding(false);
        if (!res.success) {
            setError((res as { messageTh?: string; error?: string }).messageTh
                || res.error || 'ดำเนินการไม่สำเร็จ');
            return;
        }
        const payload = (res.data || {}) as { notified?: boolean };
        if (action === 'REQUEST_MORE' && payload.notified === false) {
            // Reported, not hidden: the officer can follow up instead of
            // assuming the applicant was told.
            setError('ส่งคำขอเอกสารเพิ่มแล้ว แต่แจ้งเตือนผู้ยื่นไม่สำเร็จ กรุณาติดต่อผู้ยื่นโดยตรง');
        }
        router.refresh();
        await load();
    }

    if (error && !data) {
        return (
            <div className="mx-auto max-w-3xl p-6">
                <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {error}
                </p>
            </div>
        );
    }
    if (!data) { return <PageSkeleton />; }

    return (
        <div className="mx-auto max-w-4xl space-y-6 p-6">
            <header className="space-y-1">
                <h1 className="text-xl font-semibold text-foreground">{COPY.title}</h1>
                <p className="text-sm text-muted-foreground">รอบการตรวจที่ {data.round}</p>
            </header>

            {error && (
                <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {error}
                </p>
            )}

            <section className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground">{COPY.sectionSlots}</h2>

                {data.slots.map((slot) => {
                    const state = rowState(slot);
                    const badge = STATE_BADGE[state]!;
                    const blocking = decision.blockingSlotIds.includes(slot.slotId);
                    return (
                        <div
                            key={slot.slotId}
                            data-slot-row={slot.slotId}
                            className={`rounded-2xl border bg-card p-4 ${blocking ? 'border-amber-400' : 'border-muted'}`}
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-foreground">{slot.labelTH}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {slot.required ? '' : `${COPY.optional} · `}
                                        {slot.satisfied ? (slot.fileName || 'แนบแล้ว') : COPY.notAttached}
                                    </p>
                                </div>
                                <Badge className={badge.className}>{badge.label}</Badge>
                            </div>

                            {slot.verdict === 'MORE_REQUESTED' && slot.reviewReason && (
                                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                    {slot.reviewReason}
                                </p>
                            )}

                            {slot.precheck && <PrecheckBlock precheck={slot.precheck} />}

                            <div className="mt-3 flex flex-wrap gap-2">
                                {slot.fileUrl && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setViewing({ url: slot.fileUrl!, name: slot.fileName || slot.labelTH })}
                                    >
                                        {COPY.view}
                                    </Button>
                                )}
                                <Button
                                    type="button"
                                    className="bg-officer-700 text-white hover:bg-officer-800"
                                    disabled={busySlot === slot.slotId || !canAcceptSlot(slot)}
                                    title={canAcceptSlot(slot) ? undefined : ACCEPT_BLOCKED_TH}
                                    onClick={() => void recordVerdict(slot.slotId, 'ACCEPTED')}
                                >
                                    {COPY.accept}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={busySlot === slot.slotId}
                                    onClick={() => setForm({ slotId: slot.slotId, reason: '', dueDate: '' })}
                                >
                                    {COPY.requestMore}
                                </Button>
                            </div>

                            {form?.slotId === slot.slotId && (
                                <div className="mt-3 space-y-2 rounded-xl bg-muted/40 p-3">
                                    <label className="block text-xs text-muted-foreground" htmlFor={`reason-${slot.slotId}`}>
                                        {COPY.reasonLabel} — {COPY.reasonHint}
                                    </label>
                                    <textarea
                                        id={`reason-${slot.slotId}`}
                                        className="w-full rounded-lg border border-muted bg-card p-2 text-sm"
                                        rows={3}
                                        value={form.reason}
                                        onChange={(e) => setForm({ ...form, reason: e.target.value })}
                                    />
                                    <label className="block text-xs text-muted-foreground" htmlFor={`due-${slot.slotId}`}>
                                        {COPY.dueLabel} — {COPY.dueHint}
                                    </label>
                                    <input
                                        id={`due-${slot.slotId}`}
                                        type="date"
                                        className="rounded-lg border border-muted bg-card p-2 text-sm"
                                        value={form.dueDate}
                                        onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                                    />
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            className="bg-officer-700 text-white hover:bg-officer-800"
                                            disabled={!canSubmitRequest(form.reason, form.dueDate) || busySlot === slot.slotId}
                                            onClick={() => void recordVerdict(slot.slotId, 'MORE_REQUESTED', form.reason, form.dueDate)}
                                        >
                                            {COPY.requestMore}
                                        </Button>
                                        <Button type="button" variant="outline" onClick={() => setForm(null)}>ยกเลิก</Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </section>

            <section className="rounded-2xl border border-muted bg-card p-4">
                <h2 className="mb-2 text-sm font-semibold text-foreground">ผลตรวจเบื้องต้น (ข้อ 1.2–1.4)</h2>
                <dl className="grid grid-cols-3 gap-3 text-sm">
                    <div><dt className="text-xs text-muted-foreground">ขอบข่าย</dt><dd>{data.officerChecklist.scope}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">คุณสมบัติ</dt><dd>{data.officerChecklist.qualification}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">สรุป</dt><dd>{data.officerChecklist.overall}</dd></div>
                </dl>
            </section>

            <section className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-2xl border border-muted bg-card p-4">
                <Button
                    type="button"
                    className="bg-officer-700 text-white hover:bg-officer-800 disabled:bg-muted"
                    disabled={!decision.canAccept || deciding}
                    onClick={() => void decide('ACCEPT_ALL')}
                >
                    {COPY.decisionAccept}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    disabled={!decision.canRequestMore || deciding}
                    onClick={() => void decide('REQUEST_MORE')}
                >
                    {COPY.decisionRequest}
                </Button>
                {decision.acceptBlockedReason && (
                    <p className="text-xs text-muted-foreground">{decision.acceptBlockedReason}</p>
                )}
            </section>

            <DocumentViewerModal file={viewing} onClose={() => setViewing(null)} />
        </div>
    );
}
