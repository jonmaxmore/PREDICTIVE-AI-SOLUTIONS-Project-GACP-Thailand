'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Award, Download, ExternalLink, Loader2, RefreshCcw, Search } from 'lucide-react';

import {
    DataTable,
    FilterBar,
    FilterField,
    PageToolbar,
    SummaryCard,
    type DataColumn,
    type FilterChip,
} from '@/components/finance';
import { useAuth } from '@/lib/services/auth-provider';
import { CANONICAL_ROLES, normalizeRole } from '@/lib/constants/canonical-roles';
import {
    AdminService,
    type CertificateRow,
} from '@/lib/services/admin-service';
import {
    CertificateStatusBadge,
    applicationLabel,
    normalizeCertificateStatus,
    type CertificateStatusKey,
} from './certificate-display';
import { csvRow } from '@/lib/csv';

/**
 * /admin/certificates client view — R3-C.
 *
 * Renders the cross-tenant certificate roster behind an ADMIN-only
 * gate. Filtering by status (ALL / ACTIVE / EXPIRED / REVOKED) and
 * by free-text search are both performed in-memory because the
 * backend list endpoint at certificates.js:41-66 does NOT currently
 * support either query parameter — documented as a future server-side
 * enhancement if row counts grow beyond the 100-row default.
 *
 * The "View" action is a Link to /admin/certificates/{id}; that detail
 * page lands in R7-A (apps/web-app/src/app/admin/certificates/[id]/
 * page.tsx + detail-view.tsx) — so the link is functional and the
 * subtitle banner no longer warns about a 404.
 *
 * Trade-dress (I-010): reuses ONLY @/components/finance and primitives
 * — no corner triangles, no FlowAccount palette, mirrors the tone of
 * provider/accounting/wht/client-view.tsx so the admin surface stays
 * visually consistent with the rest of the platform.
 */

// Filter keys are the canonical lowercase vocabulary the shared mapper
// normalises to (F-G4-46) — the same key the chip renders from.
type StatusFilter = 'ALL' | Extract<CertificateStatusKey, 'active' | 'expired' | 'revoked'>;

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
    { value: 'ALL', label: 'ทั้งหมด' },
    { value: 'active', label: 'ใช้งานอยู่' },
    { value: 'expired', label: 'หมดอายุ' },
    { value: 'revoked', label: 'เพิกถอน' },
];

const THAI_MONTHS = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/**
 * Mirror of formatThaiDate from
 * apps/web-app/src/app/health/official-documents/client-view.tsx:64-72.
 * Inlined per build-agent instructions ("copy, don't import") so the
 * health page surface remains free of cross-cutting deps.
 */
function formatThaiDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '-';
    return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

/**
 * การใส่เครื่องหมายคำพูดแก้เรื่องตัวคั่น ไม่ได้แก้เรื่องสูตร — Excel ลอกคำพูดออกก่อน
 * แล้วประเมินช่องที่ขึ้นต้นด้วย = + - @ · ชื่อฟาร์มมาจากช่องที่ผู้ยื่นพิมพ์เอง จึงต้อง
 * ผ่าน lib/csv ซึ่งกันสูตรก่อนใส่คำพูด เหมือนที่ backend ทำอยู่แล้ว (audit C5-04)
 */
function toCsvRow(values: ReadonlyArray<string | number | null | undefined>): string {
    return csvRow([...values]);
}

/**
 * Build + trigger download of the CSV. BOM is the ASCII-escape
 * '\uFEFF' character (I-001) so the source file stays free of
 * literal U+FEFF bytes that no-irregular-whitespace flags.
 */
function downloadCsv(rows: ReadonlyArray<CertificateRow>) {
    const header = toCsvRow([
        'certificateNumber',
        'farmName',
        'cropType',
        'status',
        'issuedDate',
        'expiryDate',
    ]);
    const body = rows.map((r) =>
        toCsvRow([
            r.certificateNumber,
            r.farmName,
            r.cropType,
            r.status,
            r.issuedDate,
            r.expiryDate,
        ]),
    );
    const csv = '\uFEFF' + [header, ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `certificates-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

export default function ClientView() {
    const { user, isLoading: authLoading } = useAuth();
    const role = normalizeRole(user?.role);
    const isAdmin = role === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM;

    const [rows, setRows] = useState<CertificateRow[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [query, setQuery] = useState<string>('');

    const load = useCallback(async () => {
        if (!isAdmin) return;
        setLoading(true);
        setError(null);
        try {
            const data = await AdminService.listCertificates({ take: 100 });
            setRows(data);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'โหลดรายการใบรับรองไม่สำเร็จ';
            setError(message);
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [isAdmin]);

    useEffect(() => {
        void load();
    }, [load]);

    const filteredRows = useMemo<ReadonlyArray<CertificateRow>>(() => {
        const q = query.trim().toLowerCase();
        return rows.filter((row) => {
            if (statusFilter !== 'ALL') {
                if (normalizeCertificateStatus(row.status) !== statusFilter) {
                    return false;
                }
            }
            if (q) {
                // The application handle a person sees on the row is
                // searchable too; the raw id stays matchable for a pasted uuid.
                const haystack = [
                    row.certificateNumber,
                    row.farmName,
                    row.cropType,
                    row.applicationId,
                    applicationLabel(null, row.applicationId),
                ]
                    .join(' ')
                    .toLowerCase();
                if (!haystack.includes(q)) return false;
            }
            return true;
        });
    }, [rows, statusFilter, query]);

    const counters = useMemo(() => {
        const active = rows.filter((r) => normalizeCertificateStatus(r.status) === 'active').length;
        const expired = rows.filter((r) => normalizeCertificateStatus(r.status) === 'expired').length;
        const revoked = rows.filter((r) => normalizeCertificateStatus(r.status) === 'revoked').length;
        return { total: rows.length, active, expired, revoked };
    }, [rows]);

    const columns = useMemo<ReadonlyArray<DataColumn<CertificateRow>>>(
        () => [
            {
                key: 'certificateNumber',
                header: 'เลขที่ใบรับรอง',
                type: 'text',
                render: (row) => (
                    <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold text-slate-900">
                            {row.certificateNumber}
                        </p>
                        {/* The application as a person reads it (F-G4-47): the
                            list route carries no applicationNumber, so this is
                            the shared #last-6 handle, never the uuid. */}
                        <p className="font-mono text-[11px] text-muted-foreground">
                            {applicationLabel(null, row.applicationId)}
                        </p>
                    </div>
                ),
            },
            {
                key: 'farmName',
                header: 'ฟาร์ม',
                type: 'text',
                render: (row) => (
                    <span className="text-sm text-slate-800">{row.farmName || '—'}</span>
                ),
            },
            {
                key: 'cropType',
                header: 'พืช',
                type: 'text',
                mobileHidden: true,
                render: (row) => (
                    <span className="text-sm text-slate-700">{row.cropType || '—'}</span>
                ),
            },
            {
                key: 'status',
                header: 'สถานะ',
                type: 'status',
                render: (row) => <CertificateStatusBadge status={row.status} />,
            },
            {
                key: 'issuedDate',
                header: 'วันที่ออก',
                type: 'date',
                mobileHidden: true,
                render: (row) => (
                    <span className="text-sm text-slate-700">{formatThaiDate(row.issuedDate)}</span>
                ),
            },
            {
                key: 'expiryDate',
                header: 'วันหมดอายุ',
                type: 'date',
                mobileHidden: true,
                render: (row) => (
                    <span className="text-sm text-slate-700">{formatThaiDate(row.expiryDate)}</span>
                ),
            },
            {
                key: 'actions',
                header: 'การจัดการ',
                type: 'custom',
                align: 'right',
                // R7-A re-enabled: /admin/certificates/[id] now exists, so the
                // disabled <span> placeholder from R3 Phase F is replaced with
                // a functional <Link>. The link target is reachable because
                // R7-A also added the provider-role branch in the GET /:id
                // route at apps/backend/routes/api/certificates/certificates.js.
                render: (row) => (
                    <Link
                        href={`/admin/certificates/${encodeURIComponent(row.id)}`}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        aria-label={`ดูใบรับรอง ${row.certificateNumber}`}
                    >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        ดูรายละเอียด
                    </Link>
                ),
            },
        ],
        [],
    );

    // Auth session loads post-mount (AuthProvider W1-HYDRATION), so the
    // role is unknown while isLoading — show a loading state instead of
    // flashing the 403 card at legitimately authorized admins.
    if (authLoading) {
        return (
            <div className="mx-auto max-w-2xl p-6">
                <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600 shadow-sm"
                >
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    กำลังตรวจสอบสิทธิ์การเข้าถึง…
                </div>
            </div>
        );
    }

    // Non-ADMIN gate — render the Thai 403 callout and stop.
    if (!isAdmin) {
        return (
            <div className="mx-auto max-w-2xl p-6">
                <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-8 text-center">
                    <h2 className="text-xl font-bold text-rose-900">ไม่มีสิทธิ์เข้าถึง</h2>
                    <p className="mt-3 text-sm text-rose-800">
                        หน้านี้สำหรับผู้ดูแลระบบ (ADMIN) เท่านั้น
                        บัญชีของคุณ (<span className="font-mono">{role || 'unknown'}</span>) ไม่มีสิทธิ์ดูใบรับรองทั้งระบบ
                    </p>
                    <Link
                        href="/admin/dashboard"
                        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800"
                    >
                        กลับไปหน้าผู้ดูแลระบบ
                    </Link>
                </div>
            </div>
        );
    }

    const chips: ReadonlyArray<FilterChip> = [
        statusFilter !== 'ALL'
            ? {
                  key: 'status',
                  label: `สถานะ: ${
                      STATUS_FILTERS.find((s) => s.value === statusFilter)?.label || statusFilter
                  }`,
                  tone: 'info' as const,
                  onRemove: () => setStatusFilter('ALL'),
              }
            : null,
        query.trim()
            ? {
                  key: 'q',
                  label: `ค้นหา: ${query.trim()}`,
                  onRemove: () => setQuery(''),
              }
            : null,
    ].filter(Boolean) as ReadonlyArray<FilterChip>;

    return (
        <div className="space-y-5 p-4 md:p-6">
            {/* X5-FIX-B H-11: gov-gradient brand cue on ADMIN header. */}
            <PageToolbar
                eyebrow="ผู้ดูแลระบบ · ใบรับรอง"
                title="ใบรับรอง GACP ทั้งระบบ"
                subtitle="แสดง 100 รายการล่าสุด กรองตามสถานะหรือค้นหาตามเลขที่/ฟาร์ม/พืช · กดดูรายละเอียดเพื่อเปิดหน้าใบรับรอง"
                actions={[
                    {
                        key: 'csv',
                        label: 'ดาวน์โหลด CSV',
                        icon: <Download className="h-4 w-4" aria-hidden="true" />,
                        variant: 'primary',
                        onClick: () => downloadCsv(filteredRows),
                        disabled: filteredRows.length === 0,
                    },
                    {
                        key: 'refresh',
                        label: 'รีเฟรช',
                        icon: <RefreshCcw className="h-4 w-4" aria-hidden="true" />,
                        variant: 'outline',
                        onClick: () => void load(),
                    },
                ]}
                className="gov-gradient border-none shadow-xl shadow-primary/20"
            />

            <SummaryCard
                contextPill={loading ? 'กำลังโหลด…' : `แสดง ${filteredRows.length} จาก ${rows.length} รายการ`}
                totals={[
                    {
                        label: 'ทั้งหมด',
                        value: counters.total.toLocaleString('th-TH'),
                        emphasis: 'primary',
                    },
                    {
                        label: 'ใช้งานอยู่',
                        value: counters.active.toLocaleString('th-TH'),
                    },
                    {
                        label: 'หมดอายุ',
                        value: counters.expired.toLocaleString('th-TH'),
                    },
                    {
                        label: 'เพิกถอน',
                        value: counters.revoked.toLocaleString('th-TH'),
                    },
                ]}
                meta={[
                    { label: 'ขอบเขต', value: 'ทุก tenant (cross-tenant ADMIN view)' },
                    { label: 'แหล่งข้อมูล', value: 'GET /api/certificates/?take=100' },
                    { label: 'การกรอง', value: 'กรองฝั่งหน้าจอ (เซิร์ฟเวอร์ยังไม่รองรับ)' },
                ]}
            />

            <FilterBar chips={chips}>
                <FilterField label="ค้นหา (เลขที่ / ฟาร์ม / พืช / รหัสใบสมัคร)" htmlFor="admin-certs-q">
                    <div className="relative">
                        <Search
                            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
                            aria-hidden="true"
                        />
                        <input
                            id="admin-certs-q"
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="พิมพ์เพื่อค้นหา..."
                            className="h-10 w-64 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                        />
                    </div>
                </FilterField>
                <FilterField label="สถานะ" htmlFor="admin-certs-status">
                    <div
                        id="admin-certs-status"
                        role="group"
                        aria-label="กรองตามสถานะ"
                        className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-300 bg-white p-1"
                    >
                        {STATUS_FILTERS.map((opt) => {
                            const active = statusFilter === opt.value;
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setStatusFilter(opt.value)}
                                    aria-pressed={active}
                                    className={
                                        active
                                            ? 'inline-flex h-8 items-center rounded-md bg-leaf-800 px-3 text-xs font-semibold text-white'
                                            : 'inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-slate-700 hover:bg-slate-50'
                                    }
                                >
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </FilterField>
            </FilterBar>

            {error ? (
                <div
                    role="alert"
                    className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"
                >
                    {error}
                </div>
            ) : null}

            <DataTable<CertificateRow>
                columns={columns}
                rows={filteredRows}
                getRowKey={(row) => row.id}
                loading={loading}
                emptyTitle="ไม่พบใบรับรองที่ตรงกับเงื่อนไข"
                emptyDescription="ลองเปลี่ยนสถานะหรือคำค้นหา ระบบดึงมาทีละ 100 รายการล่าสุด"
                emptyIcon={<Award className="h-8 w-8" aria-hidden="true" />}
            />
        </div>
    );
}
