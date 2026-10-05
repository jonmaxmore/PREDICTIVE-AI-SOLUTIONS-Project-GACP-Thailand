"use client";

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import ProviderLayout from '../../components/provider-layout';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card } from '@/components/ui/primitives/card';
import { Spinner } from '@/components/ui/spinner';
import { SummaryHeader } from '@/components/feature';
import Link from 'next/link';
import {
    AlertCircle,
    Clock,
    Download,
    RefreshCcw,
    TrendingUp,
    Users,
    Inbox,
    Check,
} from 'lucide-react';
import { notifications } from '@/lib/notifications';
import { providerApiPaths } from '@/lib/services/provider-api';
import { apiClient } from '@/lib/api/api-client';
import { csvRow } from '@/lib/csv';

interface BucketRow {
    key: string;
    total: number;
    done: number;
    breached: number;
    avgCompletionHours: number | null;
    breachRate: number;
}

interface PerformerRow {
    userId: string;
    name: string;
    role: string | null;
    completed: number;
}

interface KpiPayload {
    window: { days: number; since: string; now: string };
    summary: {
        openCount: number;
        overdueCount: number;
        windowDone: number;
        avgCompletionHours: number | null;
    };
    byWorkType: BucketRow[];
    byGroup: BucketRow[];
    topPerformers: PerformerRow[];
    stateCounts: Record<string, number>;
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

const STATE_LABEL: Record<string, string> = {
    TODO: 'รอรับงาน',
    CLAIMED: 'รับงานแล้ว',
    IN_PROGRESS: 'กำลังดำเนินการ',
    DONE: 'เสร็จสิ้น',
    CANCELLED: 'ยกเลิก',
};

const apiPath = (full: string) => full.replace(/^\/api\//, '');

export default function WorkKpiClient() {
    const [data, setData] = useState<KpiPayload | null>(null);
    const [days, setDays] = useState(30);
    const [isLoading, setIsLoading] = useState(true);
    // M9: persistent error state so a failed fetch shows a retry card instead of a
    // perpetual spinner (the toast auto-dismisses, then the `!data` render gate hung
    // on the loader forever).
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await apiClient.get<KpiPayload>(apiPath(providerApiPaths.workKpis(days)));
            if (res.success && res.data) {
                setData(res.data);
            } else {
                setError(res.error || 'ไม่สามารถโหลดข้อมูล KPI ได้');
                notifications.show({
                    color: 'red',
                    title: 'โหลดไม่สำเร็จ',
                    message: res.error || '',
                    icon: <AlertCircle size={16} />,
                });
            }
        } catch (err) {
            // golden rule #3: surface the cause, don't swallow.
            console.error('[work-kpis] load failed:', err);
            setError(err instanceof Error ? err.message : 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
        } finally {
            setIsLoading(false);
        }
    }, [days]);

    useEffect(() => { fetchData(); }, [fetchData]);

    return (
        // Wave E.2-B: SummaryHeader replaces inline rounded-2xl card
        // header. Period selector + CSV/Refresh buttons collapse into
        // the actions slot.
        <ProviderLayout>
            <div className="space-y-4 p-4 sm:p-6">
                <SummaryHeader
                    eyebrow="ผู้ให้บริการ · สถิติ"
                    title="ตัวชี้วัดคิวงาน (KPI)"
                    description="ภาพรวมการทำงานของทีม งานที่เปิดอยู่ งานเลย SLA และปริมาณงานที่ปิดในช่วงเวลาที่เลือก"
                    actions={
                        <div className="flex flex-wrap items-center gap-2">
                            <select
                                value={days}
                                onChange={(e) => setDays(Number(e.target.value))}
                                aria-label="ช่วงเวลาที่แสดง (จำนวนวันล่าสุด)"
                                className="rounded-md border bg-background px-3 py-2 text-sm"
                            >
                                <option value={7}>7 วันล่าสุด</option>
                                <option value={30}>30 วันล่าสุด</option>
                                <option value={90}>90 วันล่าสุด</option>
                                <option value={365}>1 ปีล่าสุด</option>
                            </select>
                            <Button variant="outline" size="sm" onClick={() => downloadCsv(data)} disabled={!data}>
                                <Download size={14} className="mr-1" /> CSV
                            </Button>
                            <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading}>
                                <RefreshCcw size={14} className="mr-1" /> รีเฟรช
                            </Button>
                        </div>
                    }
                />

                {isLoading ? (
                    <div className="flex items-center justify-center py-20"><Spinner /></div>
                ) : !data ? (
                    <Card role="alert" aria-live="polite" className="rounded-lg border-destructive/40 bg-destructive/5 p-8 text-center shadow-none">
                        <AlertCircle className="mx-auto mb-3 h-6 w-6 text-destructive" aria-hidden="true" />
                        <h3 className="text-sm font-medium text-foreground">ไม่สามารถโหลดข้อมูลได้</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{error || 'เกิดข้อผิดพลาดในการโหลด KPI'}</p>
                        <Button variant="outline" size="sm" className="mt-4 min-h-[44px]" onClick={fetchData}>
                            <RefreshCcw size={14} className="mr-1" /> ลองอีกครั้ง
                        </Button>
                    </Card>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                            <KpiCard
                                icon={<Inbox size={20} />}
                                label="งานที่เปิดอยู่"
                                value={data.summary.openCount}
                                hint="TODO + CLAIMED + IN_PROGRESS"
                            />
                            <KpiCard
                                icon={<AlertCircle size={20} />}
                                label="เลย SLA ตอนนี้"
                                value={data.summary.overdueCount}
                                hint="dueAt < now (still open)"
                                highlight={data.summary.overdueCount > 0}
                            />
                            <KpiCard
                                icon={<Check size={20} />}
                                label={`ปิดใน ${data.window.days} วัน`}
                                value={data.summary.windowDone}
                            />
                            <KpiCard
                                icon={<Clock size={20} />}
                                label="เวลาเฉลี่ยที่ใช้ปิดงาน"
                                value={data.summary.avgCompletionHours != null ? `${data.summary.avgCompletionHours} ชม.` : '-'}
                                hint="created → completed"
                            />
                        </div>

                        <Card className="rounded-lg border-border bg-card p-6 shadow-none">
                            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                                <TrendingUp size={14} /> แยกตามประเภทงาน (Work Type)
                            </h2>
                            <BucketTable rows={data.byWorkType} labelMap={WORK_TYPE_LABEL} drillKey="workType" />
                        </Card>

                        <Card className="rounded-lg border-border bg-card p-6 shadow-none">
                            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                                <Users size={14} /> แยกตามกลุ่มผู้รับผิดชอบ (Candidate Group)
                            </h2>
                            <BucketTable rows={data.byGroup} drillKey="group" />
                        </Card>

                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <Card className="rounded-lg border-border bg-card p-6 shadow-none">
                                <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                                    <TrendingUp size={14} /> Top 10 ปิดงานเยอะสุด
                                </h2>
                                {data.topPerformers.length === 0 ? (
                                    <p className="text-sm italic text-muted-foreground">
                                        ยังไม่มีคนปิดงานใน window นี้
                                    </p>
                                ) : (
                                    <ol className="space-y-2">
                                        {data.topPerformers.map((p, idx) => (
                                            <li key={p.userId} className="flex items-center justify-between rounded-lg border bg-background p-3">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-sm tabular-nums text-muted-foreground">#{idx + 1}</span>
                                                    <div>
                                                        <p className="font-medium">{p.name}</p>
                                                        <p className="text-xs text-muted-foreground">{p.role || '-'}</p>
                                                    </div>
                                                </div>
                                                <Badge color="green">{p.completed} งาน</Badge>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </Card>

                            <Card className="rounded-lg border-border bg-card p-6 shadow-none">
                                <h2 className="mb-4 text-sm font-medium text-foreground">
                                    การกระจายตาม State (ตอนนี้)
                                </h2>
                                <div className="space-y-2">
                                    {Object.entries(data.stateCounts)
                                        .sort((a, b) => b[1] - a[1])
                                        .map(([state, count]) => (
                                            <div key={state} className="flex items-center justify-between rounded-lg border bg-background p-3 text-sm">
                                                <span className="font-medium">{STATE_LABEL[state] || state}</span>
                                                <Badge>{count}</Badge>
                                            </div>
                                        ))}
                                </div>
                            </Card>
                        </div>
                    </>
                )}
            </div>
        </ProviderLayout>
    );
}

function KpiCard({
    icon,
    label,
    value,
    hint,
    highlight,
}: {
    icon: React.ReactNode;
    label: string;
    value: number | string;
    hint?: string;
    highlight?: boolean;
}) {
    return (
        <div
            className={
                'rounded-lg border border-border bg-card p-4 ' +
                (highlight ? 'border-warning/50' : '')
            }
        >
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                {icon}
                <span className="text-xs">{label}</span>
            </div>
            <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
            {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
    );
}

function BucketTable({
    rows,
    labelMap,
    drillKey,
}: {
    rows: BucketRow[];
    labelMap?: Record<string, string>;
    /** Which URL param key to use when the row is clicked. */
    drillKey: 'workType' | 'group';
}) {
    if (rows.length === 0) {
        return <p className="text-sm italic text-muted-foreground">ไม่มีข้อมูลใน window นี้</p>;
    }
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead className="bg-muted/40">
                    <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2">ประเภท</th>
                        <th className="px-3 py-2 text-right">รวม</th>
                        <th className="px-3 py-2 text-right">เสร็จ</th>
                        <th className="px-3 py-2 text-right">เลย SLA</th>
                        <th className="px-3 py-2 text-right">% Breach</th>
                        <th className="px-3 py-2 text-right">เวลาเฉลี่ย (ชม.)</th>
                        <th className="px-3 py-2 text-right">ดูรายละเอียด</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.key} className="border-t hover:bg-muted/30">
                            <td className="px-3 py-2">
                                <span className="font-medium">{labelMap?.[r.key] || r.key}</span>
                                <p className="font-mono text-[10px] text-muted-foreground">{r.key}</p>
                            </td>
                            <td className="px-3 py-2 text-right">{r.total}</td>
                            <td className="px-3 py-2 text-right">{r.done}</td>
                            <td className="px-3 py-2 text-right">
                                {r.breached > 0 ? (
                                    <Link
                                        href={`/provider/work?${drillKey}=${encodeURIComponent(r.key)}&state=TODO,CLAIMED,IN_PROGRESS`}
                                        className="hover:underline"
                                    >
                                        <Badge color="red">{r.breached}</Badge>
                                    </Link>
                                ) : (
                                    <span className="text-muted-foreground">0</span>
                                )}
                            </td>
                            <td className="px-3 py-2 text-right">
                                <Badge color={r.breachRate > 10 ? 'red' : r.breachRate > 0 ? 'yellow' : 'green'}>
                                    {r.breachRate}%
                                </Badge>
                            </td>
                            <td className="px-3 py-2 text-right">
                                {r.avgCompletionHours != null ? r.avgCompletionHours : '-'}
                            </td>
                            <td className="px-3 py-2 text-right">
                                <Link
                                    href={`/provider/work?${drillKey}=${encodeURIComponent(r.key)}`}
                                    className="text-xs text-primary hover:underline"
                                >
                                    เปิด →
                                </Link>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function downloadCsv(data: KpiPayload | null) {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`# Work KPIs — ${data.window.days} days from ${data.window.since.slice(0, 10)} to ${data.window.now.slice(0, 10)}`);
    lines.push('');
    lines.push('# Summary');
    lines.push('metric,value');
    lines.push(`openCount,${data.summary.openCount}`);
    lines.push(`overdueCount,${data.summary.overdueCount}`);
    lines.push(`windowDone,${data.summary.windowDone}`);
    lines.push(`avgCompletionHours,${data.summary.avgCompletionHours ?? ''}`);
    lines.push('');
    lines.push('# By Work Type');
    lines.push('workType,total,done,breached,breachRatePct,avgCompletionHours');
    for (const r of data.byWorkType) {
        lines.push(`${r.key},${r.total},${r.done},${r.breached},${r.breachRate},${r.avgCompletionHours ?? ''}`);
    }
    lines.push('');
    lines.push('# By Candidate Group');
    lines.push('candidateGroup,total,done,breached,breachRatePct,avgCompletionHours');
    for (const r of data.byGroup) {
        lines.push(`${r.key},${r.total},${r.done},${r.breached},${r.breachRate},${r.avgCompletionHours ?? ''}`);
    }
    lines.push('');
    lines.push('# Top Performers');
    lines.push('userId,name,role,completed');
    for (const p of data.topPerformers) {
        // ชื่อคนเป็นข้อความอิสระ ต้องกันทั้งตัวคั่นและสูตร
        lines.push(csvRow([p.userId, p.name || '', p.role || '', p.completed]));
    }
    lines.push('');
    lines.push('# State Counts (right now)');
    lines.push('state,count');
    for (const [state, count] of Object.entries(data.stateCounts)) {
        lines.push(`${state},${count}`);
    }

    // BOM so Excel opens UTF-8 Thai correctly.
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `work-kpis-${data.window.days}d-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
