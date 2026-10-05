"use client";

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import ProviderLayout from "../components/provider-layout";
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/primitives/tabs';
import { SummaryHeader } from '@/components/feature/summary-header';
import { EmptyState } from '@/components/feature/empty-state';
import {
    AlertCircle,
    CheckCircle2,
    Clock,
    Inbox,
    RefreshCcw,
    Hand,
    UserMinus,
    Calendar as CalendarIcon,
    ClipboardList,
    X,
} from 'lucide-react';
import { notifications } from '@/lib/notifications';
import { providerApiPaths } from '@/lib/services/provider-api';
import { apiClient } from '@/lib/api/api-client';
import { formatThaiDate } from '@/lib/format/thai-date';
import { useAuth } from '@/lib/services/auth-provider';
import { cn } from '@/lib/utils';
import {
    statusTone,
    STATUS_BADGE_CLASSES,
} from '../applications/[id]/provider-application-detail-config';

type ActivityState = 'TODO' | 'CLAIMED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

interface WorkActivityRow {
    id: string;
    applicationId: string;
    applicationNumber: string | null;
    applicationStatus: string | null;
    applicantName: string | null;
    workType: string;
    candidateGroup: string;
    state: ActivityState;
    assignedUserId: string | null;
    assignedUserName: string | null;
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

interface MyResponse {
    data: WorkActivityRow[];
    counts: { total: number; claimed: number; unclaimed: number; overdue: number };
}

interface QueueResponse {
    data: WorkActivityRow[];
    meta: { group: string; count: number };
}

// Pre-existing crash guard (NOT part of the ui_kit reskin): apiClient.get unwraps the
// response envelope to its `data` field (api-client.ts:384 `body.data ?? body`), which
// DISCARDS sibling envelope fields. /work/my and /work/queue return counts/meta as
// SIBLINGS of data, so res.data arrives as a bare rows array → `my.counts`/`queue.meta`
// would be undefined → render crash ("Cannot read properties of undefined"). Normalize:
// accept either the full object or a bare rows array, deriving counts/meta from the rows.
function normalizeMy(payload: MyResponse | WorkActivityRow[]): MyResponse {
    const rows: WorkActivityRow[] = Array.isArray(payload) ? payload : (payload?.data ?? []);
    if (!Array.isArray(payload) && payload?.counts) {
        return { data: rows, counts: payload.counts };
    }
    return {
        data: rows,
        counts: {
            total: rows.length,
            claimed: rows.filter((r) => r.state === 'CLAIMED' || r.state === 'IN_PROGRESS').length,
            unclaimed: rows.filter((r) => r.state === 'TODO').length,
            overdue: rows.filter((r) => r.isOverdue).length,
        },
    };
}

function normalizeQueue(payload: QueueResponse | WorkActivityRow[]): QueueResponse {
    const rows: WorkActivityRow[] = Array.isArray(payload) ? payload : (payload?.data ?? []);
    if (!Array.isArray(payload) && payload?.meta) {
        return { data: rows, meta: payload.meta };
    }
    return { data: rows, meta: { group: '', count: rows.length } };
}

const WORK_TYPE_LABEL: Record<string, string> = {
    SCHEDULING: 'จัดคิว/มอบหมาย',
    DOC_REVIEW: 'ตรวจเอกสาร',
    FIELD_AUDIT: 'ตรวจประเมินภาคสนาม',
    CAR_REVIEW: 'ตรวจ CAR',
    FINAL_APPROVAL: 'อนุมัติออกใบรับรอง',
    // RECEIPT_ISSUE removed — receipt issuance is automatic (auto-issue +
    // auto-sign on settlement); no human work-activity is ever spawned for
    // it (no stage_activity_configs row), so the label was an unreachable
    // orphan. A missing key renders the raw code anyway (Record<string,string>).
};

const STATE_LABEL: Record<ActivityState, string> = {
    TODO: 'รอรับงาน',
    CLAIMED: 'รับงานแล้ว',
    IN_PROGRESS: 'กำลังดำเนินการ',
    DONE: 'เสร็จสิ้น',
    CANCELLED: 'ยกเลิก',
};

function stateColor(state: ActivityState, isOverdue: boolean): 'red' | 'yellow' | 'blue' | 'green' | 'gray' {
    if (isOverdue && ['TODO', 'CLAIMED', 'IN_PROGRESS'].includes(state)) return 'red';
    if (state === 'DONE') return 'green';
    if (state === 'CANCELLED') return 'gray';
    if (state === 'CLAIMED' || state === 'IN_PROGRESS') return 'blue';
    return 'yellow';
}

// Fiori restyle (Phase A): map the existing stateColor tones to semantic
// design tokens (soft fill + text + leading dot), so the activity-state chip
// shares the success/warning/info/destructive/muted vocabulary used by the
// object-page status badge. Presentation only — the underlying stateColor
// logic is untouched.
const STATE_CHIP_STYLE: Record<'red' | 'yellow' | 'blue' | 'green' | 'gray', { bg: string; text: string; dot: string }> = {
    red: { bg: 'bg-destructive/10', text: 'text-destructive', dot: 'bg-destructive' },
    yellow: { bg: 'bg-warning/10', text: 'text-warning', dot: 'bg-warning' },
    blue: { bg: 'bg-info/10', text: 'text-info', dot: 'bg-info' },
    green: { bg: 'bg-success/10', text: 'text-success', dot: 'bg-success' },
    gray: { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
};

function formatRelative(iso: string | null): string {
    if (!iso) return '-';
    const date = new Date(iso);
    const ms = date.getTime() - Date.now();
    const hours = Math.round(ms / (60 * 60 * 1000));
    if (Math.abs(hours) < 1) return 'ภายใน 1 ชม.';
    if (hours < 0) return `เลย ${Math.abs(hours)} ชม.`;
    if (hours < 48) return `อีก ${hours} ชม.`;
    return `อีก ${Math.round(hours / 24)} วัน`;
}

export default function ProviderWorkPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { user } = useAuth();

    // URL-driven filters: deep links from KPI dashboard / notifications
    // / SLA emails should land on a pre-filtered queue.
    const filterWorkType = searchParams.get('workType') || '';
    const filterState = searchParams.get('state') || '';
    const filterGroup = searchParams.get('group') || '';
    const initialTab = searchParams.get('tab') === 'queue' || filterWorkType || filterState || filterGroup ? 'queue' : 'my';

    const [activeTab, setActiveTab] = useState<'my' | 'queue'>(initialTab as 'my' | 'queue');
    const [isLoading, setIsLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [my, setMy] = useState<MyResponse>({ data: [], counts: { total: 0, claimed: 0, unclaimed: 0, overdue: 0 } });
    const [queue, setQueue] = useState<QueueResponse>({ data: [], meta: { group: '', count: 0 } });

    const queryString = useMemo(() => {
        const parts: string[] = [];
        if (filterWorkType) parts.push(`workType=${encodeURIComponent(filterWorkType)}`);
        if (filterState) parts.push(`state=${encodeURIComponent(filterState)}`);
        if (filterGroup) parts.push(`group=${encodeURIComponent(filterGroup)}`);
        return parts.length > 0 ? `?${parts.join('&')}` : '';
    }, [filterWorkType, filterState, filterGroup]);

    const fetchMy = useCallback(async () => {
        // /my honours workType filter so a notification deep-linking to
        // a specific workType narrows the user's todo list too.
        const myQuery = filterWorkType ? `?workType=${encodeURIComponent(filterWorkType)}` : '';
        const res = await apiClient.get<MyResponse | WorkActivityRow[]>(providerApiPaths.workMy(myQuery).replace(/^\/api\//, ''));
        if (res.success && res.data) {
            setMy(normalizeMy(res.data));
        }
    }, [filterWorkType]);

    const fetchQueue = useCallback(async () => {
        const res = await apiClient.get<QueueResponse | WorkActivityRow[]>(providerApiPaths.workQueue(queryString).replace(/^\/api\//, ''));
        if (res.success && res.data) {
            setQueue(normalizeQueue(res.data));
        }
    }, [queryString]);

    function clearFilters() {
        router.replace('/provider/work');
    }

    const refresh = useCallback(async () => {
        setIsLoading(true);
        try {
            await Promise.all([fetchMy(), fetchQueue()]);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'ไม่สามารถโหลดงานได้';
            notifications.show({ color: 'red', title: 'โหลดไม่สำเร็จ', message, icon: <AlertCircle size={16} /> });
        } finally {
            setIsLoading(false);
        }
    }, [fetchMy, fetchQueue]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    async function callAction(action: 'claim' | 'unclaim' | 'done', id: string, note?: string) {
        setBusyId(id);
        try {
            const path =
                action === 'claim'
                    ? providerApiPaths.workClaim(id)
                    : action === 'unclaim'
                    ? providerApiPaths.workUnclaim(id)
                    : providerApiPaths.workDone(id);
            const res = await apiClient.post<{ data: WorkActivityRow }>(
                path.replace(/^\/api\//, ''),
                action === 'done' && note ? { note } : {},
            );
            if (!res.success) {
                notifications.show({
                    color: 'red',
                    title: 'การทำรายการล้มเหลว',
                    message: res.error || 'Unknown error',
                    icon: <AlertCircle size={16} />,
                });
                return;
            }
            notifications.show({
                color: 'teal',
                title: 'สำเร็จ',
                message:
                    action === 'claim'
                        ? 'รับงานเรียบร้อย'
                        : action === 'unclaim'
                        ? 'คืนงานกลับเข้าคิว'
                        : 'ปิดงานเรียบร้อย',
            });
            await refresh();
        } finally {
            setBusyId(null);
        }
    }

    const myCounts = my.counts;

    const metrics = useMemo(
        () => [
            { label: 'งานทั้งหมด', value: String(myCounts.total) },
            { label: 'รับแล้ว', value: String(myCounts.claimed) },
            { label: 'รอรับ', value: String(myCounts.unclaimed) },
            { label: 'เลย SLA', value: String(myCounts.overdue), ...(myCounts.overdue > 0 ? { icon: '⚠️' } : {}) },
        ],
        [myCounts],
    );

    function renderRow(row: WorkActivityRow, showAssignee: boolean = false) {
        // A pre-assigned activity (e.g. DOC_REVIEW handed to the reviewer the
        // scheduler chose) arrives already CLAIMED + assigned to this user — the
        // "รับงาน" claim step is redundant, so flag it as theirs instead.
        // "รับงาน" stays only for genuinely unclaimed TODO work (the pull queue
        // for the other roles), hence the empty-assignee gate.
        const isMine = !!row.assignedUserId && row.assignedUserId === user?.id
            && (row.state === 'CLAIMED' || row.state === 'IN_PROGRESS');
        const canClaim = row.state === 'TODO' && !row.assignedUserId;
        const canUnclaim = row.state === 'CLAIMED' || row.state === 'IN_PROGRESS';
        const canDone = ['CLAIMED', 'IN_PROGRESS', 'TODO'].includes(row.state);

        const chip = STATE_CHIP_STYLE[stateColor(row.state, row.isOverdue)];

        return (
            // Fiori restyle (Phase A): dense queue row — flat card (border +
            // card surface), leaf-icon avatar, pill-dot activity-state chip +
            // the shared semantic application-status badge. Layout, claim/
            // unclaim/complete handlers and all data are unchanged.
            <div
                key={row.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
            >
                <Link
                    href={`/provider/work/${row.id}`}
                    className="flex min-w-0 flex-1 items-start gap-3 no-underline hover:opacity-90"
                >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-leaf-soft text-leaf-onSoft">
                        <ClipboardList className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-foreground">
                                {row.applicationNumber || row.applicationId}
                            </span>
                            <span className="inline-flex items-center rounded-md bg-mint-soft px-2 py-0.5 text-[11px] font-semibold text-leaf-700">
                                {WORK_TYPE_LABEL[row.workType] || row.workType}
                            </span>
                            <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold', chip.bg, chip.text)}>
                                <span className={cn('inline-block h-1.5 w-1.5 rounded-full', chip.dot)} aria-hidden="true" />
                                {row.isOverdue && row.state !== 'DONE' && row.state !== 'CANCELLED'
                                    ? `เลย SLA · ${STATE_LABEL[row.state]}`
                                    : STATE_LABEL[row.state]}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            {row.applicantName ? <span>{row.applicantName}</span> : null}
                            {row.applicationStatus ? (
                                // Reuse the object-page semantic status badge so the
                                // application workflow status reads the same Thai label
                                // + tone here, in the list, and on the detail page.
                                <span
                                    className={cn(
                                        'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold',
                                        STATUS_BADGE_CLASSES[statusTone(row.applicationStatus).tone],
                                    )}
                                >
                                    {statusTone(row.applicationStatus).label}
                                </span>
                            ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            {row.dueAt ? (
                                <span className="inline-flex items-center gap-1">
                                    <Clock size={12} aria-hidden="true" /> ครบกำหนด {formatRelative(row.dueAt)}
                                </span>
                            ) : null}
                            {showAssignee && row.assignedUserName ? (
                                <span className="inline-flex items-center gap-1">
                                    <UserMinus size={12} aria-hidden="true" /> {row.assignedUserName}
                                </span>
                            ) : null}
                            <span className="inline-flex items-center gap-1">
                                <CalendarIcon size={12} aria-hidden="true" /> สร้างเมื่อ{' '}
                                {formatThaiDate(row.createdAt)}
                            </span>
                        </div>
                    </div>
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                    {isMine ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                            <CheckCircle2 size={12} aria-hidden="true" /> งานของคุณ
                        </span>
                    ) : null}
                    {canClaim ? (
                        <Button
                            size="sm"
                            variant="secondary"
                            className="min-h-[44px] whitespace-normal"
                            disabled={busyId === row.id}
                            onClick={() => callAction('claim', row.id)}
                        >
                            <Hand size={14} className="mr-1" aria-hidden="true" /> รับงาน
                        </Button>
                    ) : null}
                    {canUnclaim ? (
                        <Button
                            size="sm"
                            variant="subtle"
                            className="min-h-[44px] whitespace-normal"
                            disabled={busyId === row.id}
                            onClick={() => callAction('unclaim', row.id)}
                        >
                            <UserMinus size={14} className="mr-1" aria-hidden="true" /> คืนงาน
                        </Button>
                    ) : null}
                    {canDone ? (
                        <Button
                            size="sm"
                            variant="primary"
                            className="min-h-[44px] whitespace-normal"
                            disabled={busyId === row.id}
                            onClick={() => callAction('done', row.id)}
                        >
                            <CheckCircle2 size={14} className="mr-1" aria-hidden="true" /> ปิดงาน
                        </Button>
                    ) : null}
                </div>
            </div>
        );
    }

    return (
        <ProviderLayout>
            <div className="space-y-4 p-4 sm:p-6">
                <SummaryHeader
                    eyebrow="คิวงาน"
                    title="งานของฉัน"
                    description="รายการงานที่ต้องดำเนินการ รับงาน ปิดงาน และติดตาม SLA แบบรวมศูนย์"
                    metrics={metrics}
                    actions={
                        <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading} aria-label="รีเฟรชรายการงาน">
                            <RefreshCcw size={14} className="mr-1" aria-hidden="true" /> รีเฟรช
                        </Button>
                    }
                />

                {/* Minimal-redesign pass: the active-filter bar was a mint-filled
                    rounded-2xl block. Hairline row on the page surface instead. */}
                {(filterWorkType || filterState || filterGroup) ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3" role="region" aria-label="ตัวกรองที่ใช้อยู่">
                        <span className="text-xs font-semibold text-muted-foreground">
                            กรองเฉพาะ:
                        </span>
                        {filterWorkType ? (
                            <Badge color="blue">
                                ประเภท: {WORK_TYPE_LABEL[filterWorkType] || filterWorkType}
                            </Badge>
                        ) : null}
                        {filterState ? <Badge color="blue">สถานะ: {STATE_LABEL[filterState as ActivityState] || filterState}</Badge> : null}
                        {filterGroup ? <Badge color="blue">กลุ่ม: {filterGroup}</Badge> : null}
                        <Button size="sm" variant="ghost" onClick={clearFilters} aria-label="ล้างตัวกรองทั้งหมด">
                            <X size={14} className="mr-1" aria-hidden="true" /> ล้างตัวกรอง
                        </Button>
                    </div>
                ) : null}

                {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <Spinner />
                    </div>
                ) : (
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'my' | 'queue')}>
                        <TabsList>
                            <TabsTrigger value="my">งานของฉัน ({my.counts.total})</TabsTrigger>
                            <TabsTrigger value="queue">งานในคิว ({queue.meta.count})</TabsTrigger>
                        </TabsList>

                        <TabsContent value="my">
                            {my.data.length === 0 ? (
                                <EmptyState
                                    icon={Inbox}
                                    title="ยังไม่มีงานในคิวของคุณ"
                                    hint="เมื่อมีงานใหม่ระบบจะส่งเข้ามาที่นี่อัตโนมัติ"
                                />
                            ) : (
                                <div className="space-y-3">{my.data.map((row) => renderRow(row, false))}</div>
                            )}
                        </TabsContent>

                        <TabsContent value="queue">
                            {queue.data.length === 0 ? (
                                <EmptyState
                                    icon={Inbox}
                                    title="ไม่มีงานในคิวของกลุ่มคุณ"
                                    hint={`กลุ่ม: ${queue.meta.group || '-'}`}
                                />
                            ) : (
                                <div className="space-y-3">{queue.data.map((row) => renderRow(row, true))}</div>
                            )}
                        </TabsContent>
                    </Tabs>
                )}
            </div>
        </ProviderLayout>
    );
}
