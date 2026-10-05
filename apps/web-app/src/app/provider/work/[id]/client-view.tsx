"use client";

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ProviderLayout from '../../components/provider-layout';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/primitives/textarea';
import {
    AlertCircle,
    ArrowLeft,
    ArrowRight,
    CheckCircle2,
    Clock,
    Hand,
    UserMinus,
    ExternalLink,
    Calendar,
    User as UserIcon,
} from 'lucide-react';
import { notifications } from '@/lib/notifications';
import { providerApiPaths } from '@/lib/services/provider-api';
import { apiClient } from '@/lib/api/api-client';
import { getStatusLabel } from '@/lib/constants/workflow-states';
import { useAuth } from '@/lib/services/auth-provider';
import { providerRoleCanOpen } from '@/lib/provider-role-config';
import { cn } from '@/lib/utils';
import {
    statusTone,
    STATUS_BADGE_CLASSES,
} from '../../applications/[id]/provider-application-detail-config';

type ActivityState = 'TODO' | 'CLAIMED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

interface WorkActivityDetail {
    id: string;
    applicationId: string;
    applicationNumber: string | null;
    applicationStatus: string | null;
    applicantName: string | null;
    applicantEmail: string | null;
    workType: string;
    candidateGroup: string;
    state: ActivityState;
    assignedUserId: string | null;
    assignedUserName: string | null;
    completedByName: string | null;
    triggeredAtStage: string;
    dueAt: string | null;
    warningAt: string | null;
    claimedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    note: string | null;
    createdAt: string;
    isOverdue: boolean;
}

const WORK_TYPE_LABEL: Record<string, string> = {
    SCHEDULING: 'จัดคิว/มอบหมาย',
    DOC_REVIEW: 'ตรวจเอกสาร',
    FIELD_AUDIT: 'ตรวจประเมินภาคสนาม',
    CAR_REVIEW: 'ตรวจ CAR',
    FINAL_APPROVAL: 'อนุมัติออกใบรับรอง',
    // RECEIPT_ISSUE omitted — issuance is automatic (auto-issue + auto-sign on
    // settlement), never a spawned work-activity, so the label is unreachable.
};

const STATE_LABEL: Record<ActivityState, string> = {
    TODO: 'รอรับงาน',
    CLAIMED: 'รับงานแล้ว',
    IN_PROGRESS: 'กำลังดำเนินการ',
    DONE: 'เสร็จสิ้น',
    CANCELLED: 'ยกเลิก',
};

function stateBadgeColor(state: ActivityState, isOverdue: boolean): 'red' | 'yellow' | 'blue' | 'green' | 'gray' {
    if (isOverdue && ['TODO', 'CLAIMED', 'IN_PROGRESS'].includes(state)) return 'red';
    if (state === 'DONE') return 'green';
    if (state === 'CANCELLED') return 'gray';
    if (state === 'CLAIMED' || state === 'IN_PROGRESS') return 'blue';
    return 'yellow';
}

function fmt(iso: string | null): string {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('th-TH', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

interface NextStateOption {
    toState: string;
    requiresComment: boolean;
}

interface NextStatesResponse {
    currentStatus: string;
    options: NextStateOption[];
}

const STATE_LABEL_TH: Record<string, string> = {
    DOC_APPROVED: 'อนุมัติเอกสาร',
    REVISION_REQUESTED: 'ขอให้แก้ไขเอกสาร',
    PENDING_AUDIT_FEE: 'ส่งไปรอชำระค่าบริการ',
    AUDIT_CONFIRMED: 'ยืนยันคิวตรวจประเมิน',
    AUDIT_PASSED: 'ผ่านการตรวจประเมิน',
    CAR_PENDING: 'รอ CAR จากผู้สมัคร',
    REJECTED: 'ปฏิเสธคำขอ',
    APPROVED: 'อนุมัติออกใบรับรอง',
    CERTIFIED: 'ออกใบรับรองแล้ว',
    DOC_FEE_PAID: 'ยืนยันชำระค่าเอกสาร',
    PENDING_DOC_FEE: 'ส่งกลับไปชำระเงินใหม่',
    AUDIT_FEE_PAID: 'ยืนยันการชำระค่าบริการ',
    PENDING_AUDIT_FEE_FALLBACK: 'ส่งกลับไปชำระเงินใหม่',
    ASSIGNED_FOR_REVIEW: 'มอบหมายผู้ตรวจ',
};

interface Props {
    activityId: string;
}

export default function WorkActivityDetailView({ activityId }: Props) {
    const router = useRouter();
    const { user } = useAuth();
    // The unified work-inbox serves every staff role, but /provider/applications
    // only admits [admin, document_reviewer, auditor]. For scheduler / account roles
    // the app-number link bounced. Render it as a link only when the role can enter.
    const canOpenApplications = providerRoleCanOpen(user?.role, '/provider/applications');
    // X2-FIX-C / H-11 (P-NEW-1) — useId gives a stable per-render unique id
    // for the next-state native <select> so its associated <label
    // htmlFor=...> wires up correctly for screen readers (WCAG 1.3.1 +
    // 3.3.2). useId is hydration-safe (matches across SSR/CSR) and the
    // only viable strategy here because this client page can re-mount in
    // the same route session (claim/unclaim/done refetch cycle).
    const nextStateSelectId = useId();
    const [activity, setActivity] = useState<WorkActivityDetail | null>(null);
    const [nextStates, setNextStates] = useState<NextStatesResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    const [selectedNextState, setSelectedNextState] = useState<string>('');
    const [transitionComment, setTransitionComment] = useState('');

    const fetchActivity = useCallback(async () => {
        setIsLoading(true);
        try {
            const [detailRes, nextRes] = await Promise.all([
                apiClient.get<WorkActivityDetail>(
                    providerApiPaths.workDetail(activityId).replace(/^\/api\//, ''),
                ),
                apiClient.get<NextStatesResponse>(
                    providerApiPaths.workNextStates(activityId).replace(/^\/api\//, ''),
                ),
            ]);
            if (detailRes.success && detailRes.data) {
                setActivity(detailRes.data);
                setNote(detailRes.data.note || '');
            } else {
                notifications.show({
                    color: 'red',
                    title: 'โหลดไม่สำเร็จ',
                    message: detailRes.error || 'ไม่สามารถโหลดรายละเอียดงาน',
                    icon: <AlertCircle size={16} />,
                });
            }
            if (nextRes.success && nextRes.data) {
                setNextStates(nextRes.data);
            }
        } finally {
            setIsLoading(false);
        }
    }, [activityId]);

    useEffect(() => { fetchActivity(); }, [fetchActivity]);

    async function action(kind: 'claim' | 'unclaim' | 'done') {
        setBusy(true);
        try {
            const path =
                kind === 'claim'
                    ? providerApiPaths.workClaim(activityId)
                    : kind === 'unclaim'
                    ? providerApiPaths.workUnclaim(activityId)
                    : providerApiPaths.workDone(activityId);
            const res = await apiClient.post<{ data: WorkActivityDetail }>(
                path.replace(/^\/api\//, ''),
                kind === 'done' && note.trim() ? { note: note.trim() } : {},
            );
            if (!res.success) {
                notifications.show({
                    color: 'red',
                    title: 'ดำเนินการล้มเหลว',
                    message: res.error || 'Unknown error',
                    icon: <AlertCircle size={16} />,
                });
                return;
            }
            notifications.show({
                color: 'teal',
                title: 'สำเร็จ',
                message:
                    kind === 'claim' ? 'รับงานเรียบร้อย' :
                    kind === 'unclaim' ? 'คืนงานกลับเข้าคิว' : 'ปิดงานเรียบร้อย',
            });
            await fetchActivity();
        } finally {
            setBusy(false);
        }
    }

    async function doneAndAdvance() {
        if (!selectedNextState) return;
        const opt = nextStates?.options.find((o) => o.toState === selectedNextState);
        if (opt?.requiresComment && !transitionComment.trim()) {
            notifications.show({
                color: 'red',
                title: 'ต้องระบุเหตุผล',
                message: `การเลื่อนไป ${selectedNextState} ต้องมี comment`,
                icon: <AlertCircle size={16} />,
            });
            return;
        }
        setBusy(true);
        try {
            const res = await apiClient.post<{
                activity: WorkActivityDetail;
                application?: { id: string; status: string };
            }>(
                providerApiPaths.workDone(activityId).replace(/^\/api\//, ''),
                {
                    note: note.trim() || undefined,
                    advanceStatus: {
                        toState: selectedNextState,
                        comment: transitionComment.trim() || undefined,
                    },
                },
            );
            if (!res.success) {
                notifications.show({
                    color: 'red',
                    title: 'เลื่อนสถานะล้มเหลว',
                    message: res.error || 'Unknown error',
                    icon: <AlertCircle size={16} />,
                });
                return;
            }
            notifications.show({
                color: 'teal',
                title: 'ปิดงาน + เลื่อนสถานะเรียบร้อย',
                message: `คำขออยู่ที่สถานะ ${res.data?.application?.status || selectedNextState}`,
            });
            setSelectedNextState('');
            setTransitionComment('');
            await fetchActivity();
        } finally {
            setBusy(false);
        }
    }

    if (isLoading) {
        return (
            <ProviderLayout>
                <div className="flex items-center justify-center py-20"><Spinner /></div>
            </ProviderLayout>
        );
    }

    if (!activity) {
        return (
            <ProviderLayout>
                <div className="p-6 text-center text-muted-foreground">ไม่พบข้อมูลงานนี้</div>
            </ProviderLayout>
        );
    }

    // A pre-assigned activity (e.g. DOC_REVIEW handed to the reviewer the
    // scheduler chose) arrives already CLAIMED + assigned to this user, so the
    // "รับงาน" claim step is redundant — show it as theirs instead. "รับงาน"
    // stays only for genuinely unclaimed TODO work (the pull queue for other
    // roles), so it is gated on an empty assignee.
    const isMine = !!activity.assignedUserId && activity.assignedUserId === user?.id
        && (activity.state === 'CLAIMED' || activity.state === 'IN_PROGRESS');
    const canClaim = activity.state === 'TODO' && !activity.assignedUserId;
    const canUnclaim = activity.state === 'CLAIMED' || activity.state === 'IN_PROGRESS';
    const canDone = ['CLAIMED', 'IN_PROGRESS', 'TODO'].includes(activity.state);

    return (
        <ProviderLayout>
            <div className="space-y-4 p-4 sm:p-6">
                <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => router.push('/provider/work')}>
                        <ArrowLeft size={14} className="mr-1" /> กลับไปงานของฉัน
                    </Button>
                </div>

                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2">
                        <h1 className="text-xl font-bold tracking-tight md:text-2xl">
                            {WORK_TYPE_LABEL[activity.workType] || activity.workType}
                        </h1>
                        <Badge color={stateBadgeColor(activity.state, activity.isOverdue)}>
                            {activity.isOverdue && !['DONE', 'CANCELLED'].includes(activity.state)
                                ? `เลย SLA · ${STATE_LABEL[activity.state]}`
                                : STATE_LABEL[activity.state]}
                        </Badge>
                        {activity.applicationStatus ? (
                            // Reuse the object-page semantic status badge for the
                            // related application's workflow status (same tone +
                            // Thai label as the list and detail page).
                            <span
                                className={cn(
                                    'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold',
                                    STATUS_BADGE_CLASSES[statusTone(activity.applicationStatus).tone],
                                )}
                            >
                                {statusTone(activity.applicationStatus).label}
                            </span>
                        ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                            <Calendar size={14} /> สร้างเมื่อ {fmt(activity.createdAt)}
                        </span>
                        {activity.dueAt ? (
                            <span className="inline-flex items-center gap-1">
                                <Clock size={14} /> ครบกำหนด {fmt(activity.dueAt)}
                            </span>
                        ) : null}
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <div className="space-y-4 lg:col-span-2">
                        <section className="rounded-xl border border-border bg-card p-4">
                            <h2 className="mb-3 text-sm font-bold text-muted-foreground">
                                คำขอที่เกี่ยวข้อง
                            </h2>
                            <div className="space-y-2 text-sm">
                                <div>
                                    <span className="font-medium">เลขคำขอ:</span>{' '}
                                    {canOpenApplications ? (
                                        <Link
                                            href={`/provider/applications/${activity.applicationId}`}
                                            className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                                        >
                                            {activity.applicationNumber || activity.applicationId.slice(0, 8)}
                                            <ExternalLink size={12} />
                                        </Link>
                                    ) : (
                                        <span className="font-mono">
                                            {activity.applicationNumber || activity.applicationId.slice(0, 8)}
                                        </span>
                                    )}
                                </div>
                                {activity.applicantName ? (
                                    <div><span className="font-medium">ผู้สมัคร:</span> {activity.applicantName}</div>
                                ) : null}
                                {activity.applicantEmail ? (
                                    <div className="text-muted-foreground">{activity.applicantEmail}</div>
                                ) : null}
                                <div>
                                    <span className="font-medium">สถานะคำขอ:</span>{' '}
                                    {/* Thai workflow-state label (not the raw enum). */}
                                    <span className="font-semibold text-foreground">
                                        {activity.applicationStatus ? statusTone(activity.applicationStatus).label : '-'}
                                    </span>
                                </div>
                                <div>
                                    <span className="font-medium">เกิดจากขั้นตอน:</span>{' '}
                                    <span className="font-mono text-xs">{activity.triggeredAtStage}</span>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-xl border border-border bg-card p-4">
                            <h2 className="mb-3 text-sm font-bold text-muted-foreground">
                                ประวัติการดำเนินการ
                            </h2>
                            <ul className="space-y-2 text-sm">
                                <li className="flex items-center gap-2">
                                    <Calendar size={14} className="text-muted-foreground" />
                                    สร้างงานเมื่อ {fmt(activity.createdAt)}
                                </li>
                                {activity.claimedAt ? (
                                    <li className="flex items-center gap-2">
                                        <Hand size={14} className="text-muted-foreground" />
                                        รับงานโดย {activity.assignedUserName || '-'} เมื่อ {fmt(activity.claimedAt)}
                                    </li>
                                ) : null}
                                {activity.startedAt ? (
                                    <li className="flex items-center gap-2">
                                        <Clock size={14} className="text-muted-foreground" />
                                        เริ่มเมื่อ {fmt(activity.startedAt)}
                                    </li>
                                ) : null}
                                {activity.completedAt ? (
                                    <li className="flex items-center gap-2">
                                        <CheckCircle2 size={14} className="text-muted-foreground" />
                                        ปิดงานโดย {activity.completedByName || '-'} เมื่อ {fmt(activity.completedAt)}
                                    </li>
                                ) : null}
                                {activity.cancelledAt ? (
                                    <li className="flex items-center gap-2 text-muted-foreground">
                                        <UserMinus size={14} />
                                        ยกเลิกเมื่อ {fmt(activity.cancelledAt)}
                                        {activity.cancelReason ? ` — ${activity.cancelReason}` : ''}
                                    </li>
                                ) : null}
                            </ul>
                        </section>

                        {activity.note ? (
                            <section className="rounded-xl border border-border bg-card p-4">
                                <h2 className="mb-2 text-sm font-bold text-muted-foreground">
                                    บันทึก
                                </h2>
                                <p className="whitespace-pre-line text-sm">{activity.note}</p>
                            </section>
                        ) : null}
                    </div>

                    <div className="space-y-4">
                        <section className="rounded-xl border border-border bg-card p-4">
                            <h2 className="mb-3 text-sm font-bold text-muted-foreground">
                                ผู้รับผิดชอบ
                            </h2>
                            <div className="text-sm">
                                {activity.assignedUserName ? (
                                    <div className="flex items-center gap-2">
                                        <UserIcon size={14} /> {activity.assignedUserName}
                                    </div>
                                ) : (
                                    <div className="text-muted-foreground">ยังไม่มีผู้รับงาน</div>
                                )}
                                <div className="mt-1 text-xs text-muted-foreground">
                                    กลุ่ม: {activity.candidateGroup}
                                </div>
                            </div>
                        </section>

                        {canDone ? (
                            <section className="rounded-xl border border-border bg-card p-4">
                                <h2 className="mb-3 text-sm font-bold text-muted-foreground">
                                    บันทึกการปิดงาน (ไม่บังคับ)
                                </h2>
                                <Textarea
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder="บันทึกสั้น ๆ เกี่ยวกับงานนี้ (เช่น ผลลัพธ์, ขั้นตอนถัดไป, ข้อสังเกต)"
                                    rows={4}
                                    maxLength={1000}
                                />
                            </section>
                        ) : null}

                        <section className="rounded-xl border border-border bg-card p-4">
                            <h2 className="mb-3 text-sm font-bold text-muted-foreground">
                                การดำเนินการ
                            </h2>
                            {isMine ? (
                                <div className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                                    <CheckCircle2 size={14} aria-hidden="true" /> งานของคุณ
                                </div>
                            ) : null}
                            <div className="flex flex-col gap-2">
                                {canClaim ? (
                                    <Button onClick={() => action('claim')} disabled={busy}>
                                        <Hand size={14} className="mr-1" /> รับงานนี้
                                    </Button>
                                ) : null}
                                {canUnclaim ? (
                                    <Button variant="outline" onClick={() => action('unclaim')} disabled={busy}>
                                        <UserMinus size={14} className="mr-1" /> คืนงานกลับเข้าคิว
                                    </Button>
                                ) : null}
                                {canDone ? (
                                    <Button variant="outline" onClick={() => action('done')} disabled={busy}>
                                        <CheckCircle2 size={14} className="mr-1" /> ปิดงาน (ไม่เลื่อนสถานะ)
                                    </Button>
                                ) : null}
                                {!canClaim && !canUnclaim && !canDone ? (
                                    <div className="text-sm text-muted-foreground">
                                        งานนี้อยู่ในสถานะ {STATE_LABEL[activity.state]} แล้ว
                                    </div>
                                ) : null}
                            </div>
                        </section>

                        {canDone && nextStates && nextStates.options.length > 0 ? (
                            <section className="rounded-xl border border-primary/40 bg-primary/5 p-4">
                                <h2 className="mb-1 text-sm font-bold text-primary">
                                    ปิดงาน + เลื่อนสถานะคำขอ
                                </h2>
                                <p className="mb-3 text-xs text-muted-foreground">
                                    ตอนนี้คำขออยู่ที่:{' '}
                                    <span className="font-mono text-foreground">{getStatusLabel(nextStates.currentStatus)}</span>
                                </p>
                                {/* X2-FIX-C / H-11 (P-NEW-1) — sr-only label
                                    wired via htmlFor/id so screen readers
                                    announce the field purpose (WCAG 1.3.1 +
                                    3.3.2). The visible context above the
                                    select ("ตอนนี้คำขออยู่ที่...") is
                                    informational; the actionable control
                                    itself was previously orphaned. */}
                                <label htmlFor={nextStateSelectId} className="sr-only">
                                    เลือกสถานะถัดไปของคำขอ
                                </label>
                                <select
                                    id={nextStateSelectId}
                                    data-testid="next-state-select"
                                    value={selectedNextState}
                                    onChange={(e) => {
                                        setSelectedNextState(e.target.value);
                                        setTransitionComment('');
                                    }}
                                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                                >
                                    <option value="">เลือกสถานะถัดไป</option>
                                    {nextStates.options.map((opt) => (
                                        <option key={opt.toState} value={opt.toState}>
                                            → {STATE_LABEL_TH[opt.toState] || opt.toState}
                                            {opt.requiresComment ? ' (ต้องระบุเหตุผล)' : ''}
                                        </option>
                                    ))}
                                </select>
                                {selectedNextState && nextStates.options.find((o) => o.toState === selectedNextState)?.requiresComment ? (
                                    <Textarea
                                        value={transitionComment}
                                        onChange={(e) => setTransitionComment(e.target.value)}
                                        placeholder="ระบุเหตุผล / รายละเอียด"
                                        rows={3}
                                        maxLength={1000}
                                        className="mt-2"
                                    />
                                ) : null}
                                <Button
                                    className="mt-3 w-full"
                                    onClick={doneAndAdvance}
                                    disabled={busy || !selectedNextState}
                                >
                                    <CheckCircle2 size={14} className="mr-1" />
                                    ปิดงาน + เลื่อน
                                    <ArrowRight size={14} className="ml-1" />
                                </Button>
                                <p className="mt-3 text-xs text-muted-foreground">
                                    ปิดงาน activity นี้พร้อมกับเลื่อนสถานะคำขอในขั้นตอนเดียว atomic, จะ rollback ถ้ามี error
                                </p>
                            </section>
                        ) : null}
                    </div>
                </div>
            </div>
        </ProviderLayout>
    );
}
