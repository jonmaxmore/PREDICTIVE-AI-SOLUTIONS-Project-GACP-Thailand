'use client';
import { SERVICE_NAME } from '@/lib/pricing/fee-services';

import * as React from 'react';
import {
    PageToolbar,
    FilterBar,
    FilterField,
    SummaryCard,
    DataTable,
    StatusBadge,
    type DataColumn,
} from '@/components/finance';
import { AssignAuditorModal } from '@/components/audit/AssignAuditorModal';
import {
    AuditService,
    type SchedulingQueueItem,
    type SchedulingQueueSummary,
    type SchedulingQueueFilters,
} from '@/lib/services/audit-service';
import { notifications } from '@/lib/notifications';
import { csvRow } from '@/lib/csv';

/**
 * SchedulerQueueClient — Iter 25 step 2 client island.
 *
 * Owns the filter state, fetches the queue from the
 * audit-scheduling-service (B25-A), and renders the queue using the
 * shared batch-22 finance components so we keep visual parity with
 * the rest of the DTAM dashboards (PageToolbar / FilterBar /
 * SummaryCard / DataTable / StatusBadge).
 *
 * Clicking "จัดตาราง" on a row opens the AssignAuditorModal, which
 * handles the date/auditor selection and submission.
 */

const REGIONS = [
    { value: '', label: 'ทุกภาค' },
    { value: 'NORTH', label: 'ภาคเหนือ' },
    { value: 'NORTHEAST', label: 'ภาคตะวันออกเฉียงเหนือ' },
    { value: 'CENTRAL', label: 'ภาคกลาง' },
    { value: 'EAST', label: 'ภาคตะวันออก' },
    { value: 'WEST', label: 'ภาคตะวันตก' },
    { value: 'SOUTH', label: 'ภาคใต้' },
];

// P1-J (Wave-3): the audit-phase status set the scheduler works across.
// Previously the filter only offered AUDIT_FEE_PAID + "all", which made the
// dropdown useless for anything past the initial scheduling step. Labels
// mirror STATUS_LABELS (workflow-states.ts). AUDIT_FEE_PAID stays the default.
const SCHEDULER_QUEUE_STATUSES: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'AUDIT_FEE_PAID', label: 'ชำระแล้ว รอนัดตรวจ' },
    { value: 'AUDIT_CONFIRMED', label: 'นัดตรวจแล้ว' },
    { value: 'CAR_PENDING', label: 'รอผู้สมัครแก้ไขข้อบกพร่อง' },
    { value: 'CAR_REVIEWING', label: 'ตรวจการแก้ไขข้อบกพร่อง' },
    { value: 'AUDIT_PASSED', label: 'ตรวจผ่าน' },
    { value: '', label: 'ทุกสถานะ' },
];

function formatThaiDate(iso?: string): string {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

export default function SchedulerQueueClient() {
    const [items, setItems] = React.useState<SchedulingQueueItem[]>([]);
    const [summary, setSummary] = React.useState<SchedulingQueueSummary | null>(null);
    const [loading, setLoading] = React.useState(true);
    // V2-C — explicit error state surfaced inline so the scheduler isn't
    // stuck on a blank table after a backend failure. Previously the
    // only feedback was the transient toast; this keeps the failure
    // visible until the next successful load.
    const [loadError, setLoadError] = React.useState<string | null>(null);
    const [filters, setFilters] = React.useState<SchedulingQueueFilters>({
        status: 'AUDIT_FEE_PAID',
    });
    const [selected, setSelected] = React.useState<SchedulingQueueItem | null>(null);

    const load = React.useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await AuditService.getSchedulingQueue(filters);
            if (res.success && res.data) {
                setItems(res.data.items || []);
                setSummary(res.data.summary || null);
            } else {
                setItems([]);
                setSummary(null);
                const errorMessage = res.error || 'ไม่สามารถโหลดคิวได้';
                setLoadError(errorMessage);
                notifications.show({
                    title: 'โหลดข้อมูลไม่สำเร็จ',
                    message: errorMessage,
                    color: 'red',
                });
            }
        } catch (err) {
            setItems([]);
            setSummary(null);
            const message = err instanceof Error ? err.message : 'ไม่สามารถโหลดคิวได้';
            setLoadError(message);
            notifications.show({
                title: 'โหลดข้อมูลไม่สำเร็จ',
                message,
                color: 'red',
            });
        } finally {
            setLoading(false);
        }
    }, [filters]);

    React.useEffect(() => {
        load();
    }, [load]);

    const handleAssigned = () => {
        // The row that was just scheduled should disappear from the
        // queue, so refresh.
        load();
    };

    const handleExportCsv = React.useCallback(() => {
        if (items.length === 0) {
            notifications.show({
                title: 'ไม่มีข้อมูลให้ส่งออก',
                message: 'คิวจัดตารางว่างอยู่ ไม่มีรายการให้ดาวน์โหลด',
                color: 'yellow',
            });
            return;
        }
        // RFC-4180 escape: wrap a cell in quotes when it holds a comma / quote /
        // newline and double any internal quote. Thai applicant names + free-text
        // scope can contain commas, so a naive comma-join would corrupt columns.
        // ชื่อผู้สมัครและขอบเขตเป็นข้อความอิสระ ต้องกันทั้งตัวคั่นและสูตร — lib/csv
        // ทำตามลำดับที่ถูก (กันสูตรก่อน แล้วค่อยใส่คำพูด)
        const headers = ['เลขที่คำขอ', 'ผู้สมัคร', 'ประเภทพืช', 'วันที่ชำระ', 'ภาค', 'ขอบเขต', 'รอ (วัน)'];
        const rows = items.map((it) => [
            it.applicationNumber,
            // PDPA: mirror the on-screen value — prefer the masked name when present.
            it.applicantNameMasked || it.applicantName || '',
            it.plantType || '',
            formatThaiDate(it.paymentDate),
            it.region || '',
            it.scope || '',
            it.ageDays,
        ]);
        const csv = [headers, ...rows].map((r) => csvRow(r)).join('\r\n');
        // UTF-8 BOM so Excel renders the Thai headers/values correctly.
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `gacp-scheduler-queue-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        notifications.show({
            title: 'ส่งออกสำเร็จ',
            message: `ดาวน์โหลดคิว ${items.length} รายการเป็นไฟล์ CSV แล้ว`,
            color: 'green',
        });
    }, [items]);

    const columns: ReadonlyArray<DataColumn<SchedulingQueueItem>> = [
        {
            key: 'appNo',
            header: 'เลขที่คำขอ',
            type: 'link',
            render: (row) => (
                <span className="font-mono text-sm font-semibold text-slate-900">
                    {row.applicationNumber}
                </span>
            ),
        },
        {
            key: 'applicant',
            header: 'ผู้สมัคร',
            render: (row) => (
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                        {row.applicantNameMasked || row.applicantName}
                    </p>
                    {row.plantType ? (
                        <p className="truncate text-xs text-slate-500">{row.plantType}</p>
                    ) : null}
                </div>
            ),
        },
        {
            key: 'paymentDate',
            header: 'วันที่ชำระ',
            type: 'date',
            mobileHidden: true,
            render: (row) => (
                <span className="text-sm text-slate-700">
                    {formatThaiDate(row.paymentDate)}
                </span>
            ),
        },
        {
            key: 'region',
            header: 'ภาค',
            mobileHidden: true,
            render: (row) => (
                <span className="text-sm text-slate-700">{row.region || '-'}</span>
            ),
        },
        {
            key: 'scope',
            header: 'ขอบเขต',
            mobileHidden: true,
            render: (row) => (
                <span className="text-sm text-slate-700">{row.scope || '-'}</span>
            ),
        },
        {
            key: 'age',
            header: 'รอ (วัน)',
            type: 'custom',
            align: 'right',
            render: (row) => (
                <StatusBadge
                    status={row.ageDays > 7 ? 'OVERDUE' : 'PENDING'}
                    label={`${row.ageDays} วัน`}
                />
            ),
        },
        {
            key: 'action',
            header: 'การดำเนินการ',
            type: 'custom',
            align: 'right',
            render: (row) => (
                <button
                    type="button"
                    onClick={() => setSelected(row)}
                    className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
                >
                    จัดตาราง
                </button>
            ),
        },
    ];

    return (
        <>
            <PageToolbar
                eyebrow="DTAM Scheduler"
                title="คิวจัดตารางตรวจฟาร์ม"
                subtitle={`คำขอที่ชำระงวดที่ 2 หรือ${SERVICE_NAME.RENEWAL}แล้ว และรอจัดตารางผู้ตรวจ`}
                actions={[
                    {
                        key: 'refresh',
                        label: 'รีเฟรช',
                        variant: 'primary',
                        onClick: load,
                    },
                    {
                        key: 'export',
                        label: 'ดาวน์โหลดรายงาน',
                        description: 'ดาวน์โหลดคิวเป็นไฟล์ CSV',
                        onClick: handleExportCsv,
                    },
                ]}
            />

            <SummaryCard
                org="กรมการแพทย์แผนไทยและการแพทย์ทางเลือก (DTAM)"
                {...(summary?.oldestPendingDays
                    ? { contextPill: `รอเก่าสุด ${summary.oldestPendingDays} วัน` }
                    : {})}
                totals={[
                    {
                        label: 'คิวรอจัดตาราง',
                        value: summary ? String(summary.totalPending) : '—',
                        emphasis: 'primary',
                    },
                    {
                        label: 'รอเก่าสุด',
                        value: summary
                            ? `${summary.oldestPendingDays} วัน`
                            : '—',
                    },
                    {
                        label: 'จำนวนภาค',
                        value: summary ? String(summary.byRegion.length) : '—',
                    },
                ]}
                meta={
                    summary?.byRegion.slice(0, 6).map((r) => ({
                        label: r.region,
                        value: `${r.count} คำขอ`,
                    })) || []
                }
            />

            <FilterBar
                onApply={load}
                applyLabel="แสดงผล"
                applyDisabled={loading}
            >
                <FilterField label="ภาค" htmlFor="filter-region">
                    <select
                        id="filter-region"
                        value={filters.region || ''}
                        onChange={(e) =>
                            setFilters((f) => {
                                const next = { ...f };
                                if (e.target.value) next.region = e.target.value;
                                else delete next.region;
                                return next;
                            })
                        }
                        className="h-10 min-w-[140px] rounded-lg border border-slate-300 px-3 text-sm"
                    >
                        {REGIONS.map((r) => (
                            <option key={r.value} value={r.value}>
                                {r.label}
                            </option>
                        ))}
                    </select>
                </FilterField>
                <FilterField label="ตั้งแต่วันที่" htmlFor="filter-from">
                    <input
                        id="filter-from"
                        type="date"
                        value={filters.fromDate || ''}
                        onChange={(e) =>
                            setFilters((f) => {
                                const next = { ...f };
                                if (e.target.value) next.fromDate = e.target.value;
                                else delete next.fromDate;
                                return next;
                            })
                        }
                        className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
                    />
                </FilterField>
                <FilterField label="ถึงวันที่" htmlFor="filter-to">
                    <input
                        id="filter-to"
                        type="date"
                        value={filters.toDate || ''}
                        onChange={(e) =>
                            setFilters((f) => {
                                const next = { ...f };
                                if (e.target.value) next.toDate = e.target.value;
                                else delete next.toDate;
                                return next;
                            })
                        }
                        className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
                    />
                </FilterField>
                <FilterField label="สถานะ" htmlFor="filter-status">
                    {/* P1-J (Wave-3): the scheduler works cases across the whole
                        audit phase, not just AUDIT_FEE_PAID. Populate the filter
                        from the audit-phase state set so it's actually usable —
                        the backend /queue endpoint already threads any ?status
                        straight into the WHERE (audit/scheduling.js). */}
                    <select
                        id="filter-status"
                        value={filters.status || 'AUDIT_FEE_PAID'}
                        onChange={(e) =>
                            setFilters((f) => {
                                const next = { ...f };
                                if (e.target.value) next.status = e.target.value;
                                else delete next.status;
                                return next;
                            })
                        }
                        className="h-10 min-w-[180px] rounded-lg border border-slate-300 px-3 text-sm"
                    >
                        {SCHEDULER_QUEUE_STATUSES.map((s) => (
                            <option key={s.value || 'all'} value={s.value}>
                                {s.label}
                            </option>
                        ))}
                    </select>
                </FilterField>
            </FilterBar>

            {loadError ? (
                <div
                    role="alert"
                    data-testid="scheduler-queue-load-error"
                    className="flex flex-col gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between"
                >
                    <div>
                        <p className="font-semibold">โหลดคิวไม่สำเร็จ</p>
                        <p className="text-xs">{loadError}</p>
                    </div>
                    <button
                        type="button"
                        onClick={load}
                        disabled={loading}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60"
                    >
                        ลองโหลดอีกครั้ง
                    </button>
                </div>
            ) : null}

            <DataTable
                columns={columns}
                rows={items}
                getRowKey={(row) => row.applicationId}
                loading={loading}
                emptyTitle="ไม่มีคำขอรอจัดตาราง"
                emptyDescription={`คำขอจะปรากฏที่นี่หลังผู้สมัครชำระงวดที่ 2 หรือ${SERVICE_NAME.RENEWAL}`}
            />

            <AssignAuditorModal
                open={!!selected}
                application={selected}
                onClose={() => setSelected(null)}
                onAssigned={handleAssigned}
            />
        </>
    );
}
