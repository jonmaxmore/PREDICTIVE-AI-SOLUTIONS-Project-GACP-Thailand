'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    IconArrowLeft,
    IconCalendarStats,
    IconLockOpen,
    IconRefresh,
} from '@tabler/icons-react';
import ProviderLayout from '../../components/provider-layout';
import {
    DataTable,
    PageToolbar,
    StatusBadge,
    SummaryCard,
    type DataColumn,
    type StatusTone,
    type SummaryTotal,
} from '@/components/finance';
import { useAuth } from '@/lib/services/auth-provider';
import {
    normalizeRole,
    CANONICAL_ROLES,
    canViewAccounting,
    canWriteAccounting,
} from '@/lib/constants/canonical-roles';
import {
    PeriodCloseService,
    formatThaiDate,
    type PeriodCloseRecord,
    type PeriodCloseStatus,
} from '@/lib/services/finance-orphans-service';
import { toast } from 'sonner';
import { ClosePeriodModal } from './close-period-modal';
import { ReopenPeriodModal } from './reopen-period-modal';

const THAI_MONTH_SHORT = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const STATUS_TONE: Record<PeriodCloseStatus, StatusTone> = {
    OPEN: 'pending',
    CLOSED: 'paid',
    REOPENED: 'held',
};

const STATUS_LABEL: Record<PeriodCloseStatus, string> = {
    OPEN: 'เปิดอยู่',
    CLOSED: 'ปิดแล้ว',
    REOPENED: 'เปิดใหม่',
};

export default function ClientView() {
    const { user, isLoading: authLoading } = useAuth();
    const canRead = canViewAccounting(user?.role);
    const canonical = normalizeRole(user?.role);
    const isAdmin = canonical === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM;
    // Backend CLOSE_ROLES = system_admin_dtam ∪ finance_officer_platform. The
    // DTAM finance role and inspectors read only — the close button is not
    // rendered for them (operator 2026-09-27 "กรมฯ ดูอย่างเดียว").
    const canClose = canWriteAccounting(user?.role);

    const [records, setRecords] = useState<PeriodCloseRecord[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [closeOpen, setCloseOpen] = useState<boolean>(false);
    const [reopenTarget, setReopenTarget] = useState<PeriodCloseRecord | null>(null);

    // R5-D: mountedRef sentinel guards refresh-button + modal-callback paths
    // that the R3-A useEffect-local `cancelled` flag could not reach.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const fetchList = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const data = await PeriodCloseService.listPeriodCloses();
            if (!mountedRef.current) return;
            setRecords(data);
        } catch (err) {
            if (!mountedRef.current) return;
            const e = err as Error;
            setLoadError(e.message || 'โหลดข้อมูลการปิดงวดไม่สำเร็จ');
            setRecords([]);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, []);

    // Initial fetch — only for viewers who can read (the gate below renders
    // the forbidden callout for everyone else).
    // R3-A: cancelled-flag guard avoids "setState on unmounted component"
    // when the user navigates away mid-fetch (R1 review M-2).
    useEffect(() => {
        if (!canRead) return;
        let cancelled = false;
        void (async () => {
            setLoading(true);
            setLoadError(null);
            try {
                const data = await PeriodCloseService.listPeriodCloses();
                if (cancelled) return;
                setRecords(data);
            } catch (err) {
                if (cancelled) return;
                const e = err as Error;
                setLoadError(e.message || 'โหลดข้อมูลการปิดงวดไม่สำเร็จ');
                setRecords([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [canRead]);

    const totals = useMemo<SummaryTotal[]>(() => {
        const closed = records.filter((r) => r.status === 'CLOSED').length;
        const reopened = records.filter((r) => r.status === 'REOPENED').length;
        return [
            {
                label: 'จำนวนงวดที่ปิดแล้ว',
                value: String(closed),
                emphasis: 'primary',
                hint: 'นับเฉพาะสถานะ CLOSED',
            },
            {
                label: 'งวดที่เคยเปิดใหม่',
                value: String(reopened),
                hint: 'REOPENED มี audit trail',
            },
            {
                label: 'รายการทั้งหมด',
                value: String(records.length),
            },
        ];
    }, [records]);

    // ─── Auth-loading gate ─────────────────────────────────────────
    // Auth session loads post-mount (AuthProvider W1-HYDRATION), so the
    // role is unknown while isLoading — show a loading state instead of
    // flashing the 403 callout at legitimately authorized finance staff.
    if (authLoading) {
        return (
            <ProviderLayout>
                <div className="mx-auto max-w-2xl p-6">
                    <p
                        role="status"
                        aria-live="polite"
                        className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground"
                    >
                        กำลังตรวจสอบสิทธิ์การเข้าถึง...
                    </p>
                </div>
            </ProviderLayout>
        );
    }

    // ─── Read gate — both finance roles see the same list ───────────
    if (!canRead) {
        return (
            <ProviderLayout>
                <div className="mx-auto max-w-2xl p-6">
                    <div className="rounded-lg border border-rose-300 bg-rose-50 p-8 text-center">
                        <h2 className="text-xl font-bold text-rose-900">
                            ไม่มีสิทธิ์เข้าถึง
                        </h2>
                        <p className="mt-3 text-sm text-rose-800">
                            หน้านี้สำหรับเจ้าหน้าที่การเงินเท่านั้น
                        </p>
                    </div>
                </div>
            </ProviderLayout>
        );
    }

    // ─── Main view ─────────────────────────────────────────────────
    const columns: ReadonlyArray<DataColumn<PeriodCloseRecord>> = [
        {
            key: 'period',
            header: 'งวด',
            type: 'text',
            render: (row) => (
                <div>
                    <p className="font-mono font-semibold text-foreground">
                        {row.year}-{String(row.month).padStart(2, '0')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {THAI_MONTH_SHORT[row.month - 1]} {row.year}
                    </p>
                </div>
            ),
        },
        {
            key: 'status',
            header: 'สถานะ',
            type: 'status',
            render: (row) => (
                <StatusBadge
                    status={row.status}
                    tone={STATUS_TONE[row.status] || 'draft'}
                    label={STATUS_LABEL[row.status] || row.status}
                />
            ),
        },
        {
            key: 'closedAt',
            header: 'ปิดเมื่อ',
            type: 'date',
            mobileHidden: true,
            render: (row) => (
                <span className="text-foreground">{formatThaiDate(row.closedAt)}</span>
            ),
        },
        {
            key: 'closedBy',
            header: 'ปิดโดย',
            type: 'text',
            mobileHidden: true,
            render: (row) => (
                <span className="font-mono text-xs text-muted-foreground">
                    {row.closedBy || '-'}
                </span>
            ),
        },
        {
            key: 'reopened',
            header: 'เปิดใหม่',
            type: 'text',
            mobileHidden: true,
            render: (row) => {
                if (!row.reopenedAt) return <span className="text-muted-foreground">-</span>;
                return (
                    <div>
                        <p className="text-xs text-amber-800">
                            {formatThaiDate(row.reopenedAt)}
                        </p>
                        {row.reopenReason ? (
                            <p
                                className="mt-0.5 max-w-[16rem] truncate text-[11px] text-muted-foreground"
                                title={row.reopenReason}
                            >
                                {row.reopenReason}
                            </p>
                        ) : null}
                    </div>
                );
            },
        },
        {
            key: 'actions',
            header: 'การจัดการ',
            type: 'custom',
            align: 'right',
            render: (row) => {
                if (row.status !== 'CLOSED') {
                    return <span className="text-xs text-muted-foreground">—</span>;
                }
                if (!isAdmin) {
                    return (
                        <span
                            className="text-xs text-muted-foreground"
                            title="เฉพาะผู้ดูแลระบบ (ADMIN) เท่านั้น"
                        >
                            ADMIN เท่านั้น
                        </span>
                    );
                }
                return (
                    <button
                        type="button"
                        onClick={() => setReopenTarget(row)}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                    >
                        <IconLockOpen size={14} />
                        เปิดงวด
                    </button>
                );
            },
        },
    ];

    return (
        <ProviderLayout>
            <div className="space-y-5 p-4 md:p-6">
                <PageToolbar
                    eyebrow="บัญชี · ปิดงวดบัญชี"
                    title="ปิดงวดบัญชีรายเดือน"
                    subtitle="ปิดงวดเมื่อสิ้นเดือนเพื่อล็อกการบันทึกบัญชีในงวดนั้น (TFRS for NPAEs ch.5) รองรับการเปิดงวดใหม่โดย ADMIN เฉพาะเมื่อจำเป็น"
                    actions={[
                        ...(canClose
                            ? [{
                                key: 'close',
                                label: 'ปิดงวดใหม่',
                                variant: 'primary' as const,
                                icon: <IconCalendarStats size={16} />,
                                onClick: () => setCloseOpen(true),
                            }]
                            : []),
                        {
                            key: 'refresh',
                            label: 'รีเฟรช',
                            icon: <IconRefresh size={16} />,
                            onClick: () => void fetchList(),
                        },
                        {
                            key: 'back',
                            label: 'กลับไปบัญชีและใบเสร็จ',
                            href: '/provider/accounting',
                            icon: <IconArrowLeft size={16} />,
                        },
                    ]}
                />

                <SummaryCard
                    org="ระบบบัญชีฝั่งแพลตฟอร์ม"
                    contextPill={`รายการทั้งหมด ${records.length}`}
                    totals={totals}
                    meta={[
                        { label: 'มาตรฐาน', value: 'TFRS for NPAEs บทที่ 5 และบทที่ 2' },
                        { label: 'การควบคุม', value: 'ผู้ปิดงวด ≠ ผู้เปิดงวด (SoD)' },
                        { label: 'จัดทำสำหรับ', value: 'ภ.พ.30 (รายเดือน)' },
                    ]}
                />

                {loadError ? (
                    <div
                        role="alert"
                        className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800"
                    >
                        <p className="font-semibold">โหลดข้อมูลไม่สำเร็จ</p>
                        <p className="mt-1">{loadError}</p>
                        <button
                            type="button"
                            onClick={() => void fetchList()}
                            className="mt-3 inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-card px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        >
                            <IconRefresh size={14} />
                            ลองอีกครั้ง
                        </button>
                    </div>
                ) : null}

                <DataTable<PeriodCloseRecord>
                    columns={columns}
                    rows={records}
                    getRowKey={(row) => row.id}
                    loading={loading}
                    emptyTitle="ยังไม่มีรายการปิดงวด"
                    emptyDescription='กดปุ่ม "ปิดงวดใหม่" เพื่อเริ่มต้น (งวดต้องผ่านพ้นไปแล้วทั้งเดือน)'
                    emptyIcon={<IconCalendarStats size={36} />}
                />
            </div>

            {canClose ? (<ClosePeriodModal
                open={closeOpen}
                onClose={() => setCloseOpen(false)}
                onClosed={(result) => {
                    setCloseOpen(false);
                    // X4-FIX-C / M-2 — uniform success toast across mutate flows.
                    // Period close was silent before; users had to infer success
                    // from the row appearing in the table. Follow the uniform
                    // pattern (toast on every successful mutate).
                    toast.success(
                        `ปิดงวด ${result.year}/${String(result.month).padStart(2, '0')} เรียบร้อยแล้ว`,
                    );
                    void fetchList();
                }}
            />) : null}

            <ReopenPeriodModal
                open={reopenTarget !== null}
                record={reopenTarget}
                currentUserId={user?.id ?? null}
                onClose={() => setReopenTarget(null)}
                onReopened={(record) => {
                    setReopenTarget(null);
                    // X4-FIX-C / M-2 — toast on reopen success.
                    toast.success(
                        `เปิดงวด ${record.year}/${String(record.month).padStart(2, '0')} อีกครั้งเรียบร้อยแล้ว`,
                    );
                    void fetchList();
                }}
            />
        </ProviderLayout>
    );
}
