'use client';

export const dynamic = 'force-dynamic';

import * as React from 'react';
import { Search, Download, RefreshCcw, ShieldCheck, X as XIcon } from 'lucide-react';

import { AdminPageShell, TermTooltip } from '@/components/admin';
import {
    AdminB28Service,
    type AuditLogRow,
    type AuditLogFilters,
} from '@/lib/services/admin-service-b28';
import {
    DataTable,
    FilterBar,
    FilterField,
    SummaryCard,
    StatusBadge,
    type DataColumn,
} from '@/components/finance';

/**
 * /admin/audit-log — Iter 28 admin viewer for the AUDIT_LOG table.
 *
 * Mirrors the /provider/admin/audit-log page (which uses Mantine
 * primitives + ProviderLayout) using the finance design system so
 * the admin console feels consistent with /admin/users and
 * /admin/dashboard.
 *
 * Filters: actor, category, severity, from/to. CSV export hits the
 * server's `/export.csv` endpoint with the same query string, then
 * `window.open` is used to let the browser stream the file.
 */

const CATEGORY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: '', label: 'ทุกหมวดหมู่' },
    { value: 'AUTHENTICATION', label: 'การเข้าใช้ระบบ' },
    { value: 'APPLICATION', label: 'คำขอใบรับรอง' },
    { value: 'PAYMENT', label: 'การชำระเงิน' },
    { value: 'CERTIFICATE', label: 'ใบรับรอง' },
    { value: 'system_admin_dtam', label: 'การจัดการระบบ' },
    { value: 'SECURITY', label: 'ความปลอดภัย' },
    { value: 'SYSTEM', label: 'ระบบ' },
    { value: 'AUDIT', label: 'การตรวจประเมิน' },
];

const SEVERITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: '', label: 'ทุกระดับ' },
    { value: 'INFO', label: 'ทั่วไป (INFO)' },
    { value: 'WARNING', label: 'เตือน (WARNING)' },
    { value: 'ERROR', label: 'ข้อผิดพลาด (ERROR)' },
    { value: 'CRITICAL', label: 'วิกฤติ (CRITICAL)' },
];

function formatThaiDate(iso: string): string {
    if (!iso) return '-';
    try {
        const d = new Date(iso);
        return d.toLocaleString('th-TH', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

export default function AdminAuditLogPage() {
    const [rows, setRows] = React.useState<AuditLogRow[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    const [actorId, setActorId] = React.useState('');
    const [category, setCategory] = React.useState('');
    const [severity, setSeverity] = React.useState('');
    const [from, setFrom] = React.useState('');
    const [to, setTo] = React.useState('');
    // V5-D UX-C1: structured filters introduced by the Iter 28 endpoint.
    const [applicationId, setApplicationId] = React.useState('');
    const [organizationId, setOrganizationId] = React.useState('');
    const [advancedOpen, setAdvancedOpen] = React.useState(false);
    const [page, setPage] = React.useState(1);
    const [totalPages, setTotalPages] = React.useState(1);
    const [total, setTotal] = React.useState(0);

    /**
     * X5-FIX-C / H-4 (AL-1) — audit-log row expansion.
     *
     * Pre-X5 the audit-log table had no `onRowClick`, so the `metadata`
     * JSON blob lived in the data model but was unreachable from the UI.
     * Forensics required CSV export → grep. Per X5-A §5 AL-1 this was
     * the biggest UX hole on the audit-log surface.
     *
     * Click-to-expand renders a side panel (rendered inline below the
     * DataTable) showing the full audit row including the
     * pretty-printed metadata JSON. Press the row again to collapse or
     * the X button to close.
     */
    const [expandedRow, setExpandedRow] = React.useState<AuditLogRow | null>(null);

    const filters: AuditLogFilters = React.useMemo(
        () => ({
            actorId,
            category,
            severity,
            applicationId,
            organizationId,
            from,
            to,
            page,
            limit: 50,
        }),
        [actorId, category, severity, applicationId, organizationId, from, to, page],
    );

    const load = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await AdminB28Service.listAuditLog(filters);
            // Backend nests { rows, pagination } inside `data`, which apiClient
            // preserves as res.data — so pagination survives the envelope-collapse.
            if (res.success && res.data && Array.isArray(res.data.rows)) {
                setRows(res.data.rows);
                setTotal(res.data.pagination?.total ?? res.data.rows.length);
                setTotalPages(res.data.pagination?.totalPages ?? 1);
            } else {
                setRows([]);
                setError(res.error || 'ไม่สามารถโหลด audit log ได้');
            }
        } catch (err) {
            console.error('[admin/audit-log] load failed:', err);
            setRows([]);
            setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
        } finally {
            setLoading(false);
        }
    }, [filters]);

    React.useEffect(() => {
        void load();
    }, [load]);

    const handleExport = () => {
        const url = AdminB28Service.auditLogExportUrl({
            actorId,
            category,
            severity,
            applicationId,
            organizationId,
            from,
            to,
        });
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const resetFilters = () => {
        setActorId('');
        setCategory('');
        setSeverity('');
        setApplicationId('');
        setOrganizationId('');
        setFrom('');
        setTo('');
        setPage(1);
    };

    const chips = React.useMemo(() => {
        return [
            actorId
                ? { key: 'actorId', label: `ผู้กระทำ: ${actorId}`, onRemove: () => setActorId('') }
                : null,
            category
                ? {
                      key: 'category',
                      label: `หมวด: ${
                          CATEGORY_OPTIONS.find((c) => c.value === category)?.label || category
                      }`,
                      onRemove: () => setCategory(''),
                  }
                : null,
            severity
                ? {
                      key: 'severity',
                      label: `ระดับ: ${
                          SEVERITY_OPTIONS.find((s) => s.value === severity)?.label || severity
                      }`,
                      onRemove: () => setSeverity(''),
                  }
                : null,
            applicationId
                ? {
                      key: 'applicationId',
                      label: `คำขอ: ${applicationId}`,
                      onRemove: () => setApplicationId(''),
                  }
                : null,
            organizationId
                ? {
                      key: 'organizationId',
                      label: `องค์กร: ${organizationId}`,
                      onRemove: () => setOrganizationId(''),
                  }
                : null,
            from
                ? { key: 'from', label: `ตั้งแต่: ${from}`, onRemove: () => setFrom('') }
                : null,
            to ? { key: 'to', label: `ถึง: ${to}`, onRemove: () => setTo('') } : null,
        ].filter(Boolean) as Array<{
            key: string;
            label: string;
            onRemove: () => void;
        }>;
    }, [actorId, category, severity, applicationId, organizationId, from, to]);

    const columns = React.useMemo<ReadonlyArray<DataColumn<AuditLogRow>>>(
        () => [
            {
                key: 'time',
                header: 'เวลา',
                type: 'date',
                render: (r) => (
                    <div className="min-w-0">
                        <p className="font-mono text-xs text-slate-700">
                            {formatThaiDate(r.createdAt)}
                        </p>
                        <p className="text-[10px] text-slate-500">#{r.sequenceNumber}</p>
                    </div>
                ),
            },
            {
                key: 'category',
                header: 'หมวดหมู่',
                type: 'text',
                mobileHidden: true,
                render: (r) => (
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
                        {r.category}
                    </span>
                ),
            },
            {
                key: 'action',
                header: 'การกระทำ',
                type: 'text',
                render: (r) => (
                    <span className="font-mono text-xs text-slate-700">{r.action}</span>
                ),
            },
            {
                key: 'severity',
                header: 'ระดับ',
                type: 'status',
                render: (r) => {
                    const tone =
                        r.severity === 'CRITICAL' || r.severity === 'HIGH'
                            ? 'overdue'
                            : r.severity === 'ERROR' || r.severity === 'WARNING'
                              ? 'pending'
                              : r.severity === 'INFO'
                                ? 'info'
                                : 'draft';
                    return <StatusBadge status={r.severity} label={r.severity} tone={tone} />;
                },
            },
            {
                key: 'actor',
                header: 'ผู้กระทำ',
                type: 'text',
                mobileHidden: true,
                render: (r) => (
                    <div className="min-w-0">
                        <p className="truncate text-xs">{r.actorEmail || r.actorId || '-'}</p>
                        {r.actorRole ? (
                            <p className="text-[10px] text-slate-500">{r.actorRole}</p>
                        ) : null}
                    </div>
                ),
            },
            {
                key: 'resource',
                header: 'ทรัพยากร',
                type: 'text',
                mobileHidden: true,
                render: (r) => (
                    <div className="min-w-0">
                        <p className="text-xs">{r.resourceType}</p>
                        <p className="truncate font-mono text-[10px] text-slate-500">
                            {r.resourceId}
                        </p>
                    </div>
                ),
            },
            {
                key: 'result',
                header: 'ผลลัพธ์',
                type: 'status',
                render: (r) => (
                    <div className="min-w-0">
                        <StatusBadge
                            status={r.result}
                            label={r.result === 'SUCCESS' ? 'สำเร็จ' : 'ล้มเหลว'}
                            tone={r.result === 'SUCCESS' ? 'paid' : 'overdue'}
                        />
                        {r.errorMessage ? (
                            <p className="mt-1 text-[10px] text-rose-700">{r.errorMessage}</p>
                        ) : null}
                    </div>
                ),
            },
        ],
        [],
    );

    return (
        <AdminPageShell
            eyebrow="ผู้ดูแลระบบ · บันทึกการใช้งาน"
            title="บันทึกการใช้งานระบบ (Audit Log)"
            subtitle="บันทึกการใช้งานระบบทั้งหมด ใช้สำหรับตรวจสอบย้อนหลัง"
            actions={[
                {
                    label: 'รีเฟรช',
                    variant: 'outline',
                    onClick: () => void load(),
                    icon: <RefreshCcw className="h-4 w-4" aria-hidden="true" />,
                },
                {
                    label: 'ส่งออก CSV',
                    variant: 'primary',
                    onClick: handleExport,
                    icon: <Download className="h-4 w-4" aria-hidden="true" />,
                },
            ]}
        >
            <SummaryCard
                org="ผลการค้นหาบันทึกการใช้งาน"
                contextPill={
                    totalPages > 1 ? `หน้า ${page} / ${totalPages}` : 'ผลลัพธ์ทั้งหมด'
                }
                totals={[
                    {
                        label: 'รายการที่ตรงเงื่อนไข',
                        value: total.toLocaleString('th-TH'),
                        emphasis: 'primary',
                    },
                    {
                        label: 'แสดงในหน้านี้',
                        value: rows.length.toLocaleString('th-TH'),
                    },
                    {
                        label: 'หน้า',
                        value: `${page} / ${totalPages}`,
                    },
                ]}
            />

            <p className="text-xs text-slate-600">
                <TermTooltip term="Audit Log" /> เป็นบันทึกถาวร ใช้ติดตามการเปลี่ยนแปลงและตรวจสอบย้อนหลังตามมาตรฐานข้อมูลภาครัฐ
            </p>

            <FilterBar
                chips={chips}
                onApply={() => {
                    setPage(1);
                    void load();
                }}
                secondaryAction={
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                        ล้างตัวกรอง
                    </button>
                }
            >
                <FilterField label="ผู้กระทำ (Actor ID)" htmlFor="al-actor">
                    <div className="relative">
                        <Search
                            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
                            aria-hidden="true"
                        />
                        <input
                            id="al-actor"
                            type="search"
                            value={actorId}
                            onChange={(e) => setActorId(e.target.value)}
                            placeholder="UUID ของผู้กระทำ"
                            className="h-10 w-64 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                        />
                    </div>
                </FilterField>
                <FilterField label="หมวดหมู่" htmlFor="al-category">
                    <select
                        id="al-category"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="h-10 w-48 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    >
                        {CATEGORY_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </FilterField>
                <FilterField label="ระดับความสำคัญ" htmlFor="al-severity">
                    <select
                        id="al-severity"
                        value={severity}
                        onChange={(e) => setSeverity(e.target.value)}
                        className="h-10 w-48 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    >
                        {SEVERITY_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </FilterField>
                <FilterField label="ตั้งแต่" htmlFor="al-from">
                    <input
                        id="al-from"
                        type="datetime-local"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        className="h-10 w-52 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    />
                </FilterField>
                <FilterField label="ถึง" htmlFor="al-to">
                    <input
                        id="al-to"
                        type="datetime-local"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="h-10 w-52 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    />
                </FilterField>
            </FilterBar>

            {/* V5-D UX-C1: structured filters — applicationId + organizationId. */}
            <details
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm"
                open={advancedOpen}
                onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
            >
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                    ตัวกรองขั้นสูง (Application / Organisation)
                </summary>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div className="flex flex-col">
                        <label
                            htmlFor="al-application-id"
                            className="mb-1 text-xs font-semibold text-slate-600"
                        >
                            รหัสคำขอ (Application ID)
                        </label>
                        <input
                            id="al-application-id"
                            type="search"
                            value={applicationId}
                            onChange={(e) => setApplicationId(e.target.value)}
                            placeholder="UUID ของคำขอ"
                            className="h-10 w-64 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                        />
                    </div>
                    <div className="flex flex-col">
                        <label
                            htmlFor="al-organization-id"
                            className="mb-1 text-xs font-semibold text-slate-600"
                        >
                            รหัสองค์กร (Organisation ID)
                        </label>
                        <input
                            id="al-organization-id"
                            type="search"
                            value={organizationId}
                            onChange={(e) => setOrganizationId(e.target.value)}
                            placeholder="UUID ขององค์กร / tenant"
                            className="h-10 w-64 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setPage(1);
                            void load();
                        }}
                        className="inline-flex h-10 items-center justify-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800"
                    >
                        ค้นหา
                    </button>
                </div>
            </details>

            {error ? (
                <div
                    role="alert"
                    className="flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"
                >
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    {error}
                </div>
            ) : null}

            <DataTable<AuditLogRow>
                columns={columns}
                rows={rows}
                getRowKey={(r) => r.id}
                loading={loading}
                emptyTitle="ไม่พบบันทึกในช่วงนี้"
                emptyDescription="ลองปรับช่วงวันที่ หรือล้างตัวกรอง"
                onRowClick={(row) => {
                    // X5-FIX-C / H-4 (AL-1) — toggle expand on row click.
                    setExpandedRow((prev) => (prev?.id === row.id ? null : row));
                }}
            />

            {/* X5-FIX-C / H-4 (AL-1) — row-click expansion panel showing
                the full audit row including the pretty-printed metadata
                JSON. Before this fix the `metadata` blob existed in the
                data model but was unreachable from the UI — forensics
                required CSV-export → grep. */}
            {expandedRow ? (
                <div
                    data-testid="audit-log-row-expand"
                    role="region"
                    aria-label="รายละเอียดบันทึก audit log"
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                    <div className="mb-3 flex items-start justify-between gap-2">
                        <div>
                            <p className="text-xs font-bold text-slate-500">
                                รายละเอียด Audit Log
                            </p>
                            <p className="font-mono text-sm text-slate-700">
                                #{expandedRow.sequenceNumber} · {expandedRow.id}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setExpandedRow(null)}
                            aria-label="ปิดรายละเอียด"
                            data-testid="audit-log-row-expand-close"
                            className="inline-flex h-8 min-h-[44px] w-8 min-w-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 sm:min-h-0 sm:min-w-0"
                        >
                            <XIcon className="h-4 w-4" aria-hidden="true" />
                        </button>
                    </div>

                    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                        <div>
                            <dt className="text-xs font-bold text-slate-600">เวลา</dt>
                            <dd className="font-mono text-slate-800">
                                {formatThaiDate(expandedRow.createdAt)}
                            </dd>
                            <dd className="text-[10px] text-slate-500">
                                ISO: {expandedRow.createdAt}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs font-bold text-slate-600">ผู้กระทำ</dt>
                            <dd className="text-slate-800">
                                {expandedRow.actorEmail || expandedRow.actorId || '-'}
                            </dd>
                            {expandedRow.actorRole ? (
                                <dd className="text-[10px] text-slate-500">
                                    บทบาท: {expandedRow.actorRole}
                                </dd>
                            ) : null}
                        </div>
                        <div>
                            <dt className="text-xs font-bold text-slate-600">หมวด · การกระทำ</dt>
                            <dd className="font-mono text-slate-800">
                                {expandedRow.category} · {expandedRow.action}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs font-bold text-slate-600">ทรัพยากร</dt>
                            <dd className="text-slate-800">{expandedRow.resourceType}</dd>
                            <dd className="break-all font-mono text-[10px] text-slate-500">
                                {expandedRow.resourceId}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs font-bold text-slate-600">ระดับ · ผลลัพธ์</dt>
                            <dd className="text-slate-800">
                                {expandedRow.severity} ·{' '}
                                {expandedRow.result === 'SUCCESS' ? 'สำเร็จ' : 'ล้มเหลว'}
                            </dd>
                            {expandedRow.errorMessage ? (
                                <dd className="text-[11px] text-rose-700">
                                    {expandedRow.errorCode ? `[${expandedRow.errorCode}] ` : ''}
                                    {expandedRow.errorMessage}
                                </dd>
                            ) : null}
                        </div>
                        <div>
                            <dt className="text-xs font-bold text-slate-600">หมายเลข IP</dt>
                            <dd className="font-mono text-slate-800">
                                {expandedRow.ipAddress || '-'}
                            </dd>
                        </div>
                    </dl>

                    <div className="mt-4">
                        <p className="text-xs font-bold text-slate-600">
                            ข้อมูลประกอบ (JSON)
                        </p>
                        <pre
                            data-testid="audit-log-metadata-json"
                            className="mt-1 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100"
                        >
                            {expandedRow.metadata
                                ? JSON.stringify(expandedRow.metadata, null, 2)
                                : '(ไม่มี metadata)'}
                        </pre>
                    </div>
                </div>
            ) : null}

            {totalPages > 1 ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
                    <p className="text-slate-700">
                        หน้า {page} จาก {totalPages}
                    </p>
                    <div className="flex items-center gap-2">
                        {/* X5-FIX-D M-2: pagination buttons bumped from h-9 (36px) to
                            min-h-[44px] min-w-[44px] to meet WCAG 2.5.5 Target Size. */}
                        <button
                            type="button"
                            disabled={page === 1 || loading}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            className="inline-flex min-h-[44px] min-w-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            data-testid="audit-log-pagination-prev"
                        >
                            ก่อนหน้า
                        </button>
                        <button
                            type="button"
                            disabled={page === totalPages || loading}
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            className="inline-flex min-h-[44px] min-w-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            data-testid="audit-log-pagination-next"
                        >
                            ถัดไป
                        </button>
                    </div>
                </div>
            ) : null}
        </AdminPageShell>
    );
}
