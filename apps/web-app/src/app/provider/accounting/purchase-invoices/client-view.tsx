'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    IconArrowLeft,
    IconCircleCheck,
    IconCirclePlus,
    IconRefresh,
    IconReceiptTax,
} from '@tabler/icons-react';
import ProviderLayout from '../../components/provider-layout';
import {
    DataTable,
    PageToolbar,
    StatusBadge,
    SummaryCard,
    type DataColumn,
} from '@/components/finance';
import { useAuth } from '@/lib/services/auth-provider';
import { canViewAccounting, canWriteAccounting } from '@/lib/constants/canonical-roles';
import {
    PurchaseInvoiceService,
    type PurchaseInvoice,
    type PurchaseInvoiceStatus,
} from '@/lib/services/finance-orphans-service';
import { toast } from 'sonner';
import { formatTHB as formatTHBCanonical } from '@/lib/format/thb';
import { CreateInvoiceModal } from './create-invoice-modal';
import { ReviewActions } from './review-actions';
import type { StatusFilter } from './types';

const FILTER_CHIPS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
    { id: 'ALL', label: 'ทั้งหมด' },
    { id: 'PENDING_REVIEW', label: 'รอตรวจ' },
    { id: 'APPROVED', label: 'อนุมัติแล้ว' },
    { id: 'REJECTED', label: 'ปฏิเสธ' },
];

const STATUS_LABEL_TH: Record<PurchaseInvoiceStatus, string> = {
    PENDING_REVIEW: 'รอตรวจ',
    APPROVED: 'อนุมัติ',
    REJECTED: 'ปฏิเสธ',
};

// X4-FIX-C H-5 — adopt the canonical formatTHB. The original local
// helper produced "฿1,234.56" via Intl.NumberFormat currency style;
// formatTHBCanonical with `{ decimals: 2, prefix: true }` matches.
function formatTHB(amount: number | string | null | undefined): string {
    return formatTHBCanonical(amount, { decimals: 2, prefix: true });
}

function formatThaiDate(value: string | Date | null | undefined): string {
    if (!value) return '—';
    try {
        return new Date(value).toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    } catch {
        return '—';
    }
}

/**
 * Client view for /provider/accounting/purchase-invoices.
 *
 * Gates:
 *   - read: canViewAccounting — both finance roles see the same list
 *     (operator 2026-09-11); anyone else gets the rose forbidden callout
 *   - write (create / approve / reject / mark paid): canWriteAccounting —
 *     finance_officer_platform + system_admin_dtam, mirroring the backend
 *     purchase-invoice-service WRITE_ROLES. The DTAM finance role reads only
 *     (operator 2026-09-27 "กรมฯ ดูอย่างเดียว") — its buttons are not rendered.
 */
export default function ClientView() {
    const { user, isLoading: authLoading } = useAuth();
    const canRead = canViewAccounting(user?.role);
    // Backend WRITE_ROLES = system_admin_dtam ∪ finance_officer_platform.
    // Read-only roles never see the write controls (not even disabled).
    const canWrite = canWriteAccounting(user?.role);

    const [rows, setRows] = useState<PurchaseInvoice[]>([]);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [createOpen, setCreateOpen] = useState(false);

    // R5-D: mountedRef sentinel guards refresh-button + modal-callback paths
    // that the R3-A useEffect-local `cancelled` flag could not reach.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const fetchRows = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const list = await PurchaseInvoiceService.list(
                statusFilter === 'ALL' ? {} : { status: statusFilter },
            );
            if (!mountedRef.current) return;
            setRows(list);
        } catch (err: unknown) {
            if (!mountedRef.current) return;
            setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดรายการได้');
            setRows([]);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        // Skip data fetch entirely when the user is not allowed to see this page —
        // the early-return blocks below mean the table never renders anyway.
        if (!canRead) return;
        // R3-A: cancelled-flag guard avoids "setState on unmounted component"
        // when the user navigates away mid-fetch (R1 review M-2).
        let cancelled = false;
        void (async () => {
            setLoading(true);
            setError(null);
            try {
                const list = await PurchaseInvoiceService.list(
                    statusFilter === 'ALL' ? {} : { status: statusFilter },
                );
                if (cancelled) return;
                setRows(list);
            } catch (err: unknown) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดรายการได้');
                setRows([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [canRead, statusFilter]);

    // Counts per status — used by the chip labels and the summary card.
    const counts = useMemo(() => {
        const acc = { ALL: rows.length, PENDING_REVIEW: 0, APPROVED: 0, REJECTED: 0 };
        for (const row of rows) {
            if (row.status === 'PENDING_REVIEW') acc.PENDING_REVIEW += 1;
            else if (row.status === 'APPROVED') acc.APPROVED += 1;
            else if (row.status === 'REJECTED') acc.REJECTED += 1;
        }
        return acc;
    }, [rows]);

    const totals = useMemo(() => {
        let totalAmount = 0;
        let inputVat = 0;
        for (const row of rows) {
            totalAmount += Number(row.totalAmount ?? 0);
            if (row.status === 'APPROVED') {
                inputVat += Number(row.vat ?? 0);
            }
        }
        return { totalAmount, inputVat };
    }, [rows]);

    // ── Auth-loading gate ──────────────────────────────────────────────────
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

    // ── Read gate ──────────────────────────────────────────────────────────
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

    const columns: ReadonlyArray<DataColumn<PurchaseInvoice>> = [
        {
            key: 'invoiceNumber',
            header: 'เลขที่ใบกำกับ',
            type: 'text',
            render: (row) => (
                <div className="min-w-0">
                    <p className="font-semibold text-foreground">{row.invoiceNumber}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {row.id.slice(0, 8)}
                    </p>
                </div>
            ),
        },
        {
            key: 'supplier',
            header: 'ผู้ขาย / TIN',
            type: 'text',
            render: (row) => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{row.supplierName}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{row.supplierTaxId}</p>
                </div>
            ),
        },
        {
            key: 'invoiceDate',
            header: 'วันที่ใบกำกับ',
            type: 'date',
            mobileHidden: true,
            render: (row) => (
                <p className="text-sm text-foreground">{formatThaiDate(row.invoiceDate)}</p>
            ),
        },
        {
            key: 'category',
            header: 'หมวด',
            type: 'text',
            mobileHidden: true,
            render: (row) => (
                <span className="inline-flex rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
                    {row.category}
                </span>
            ),
        },
        {
            key: 'subtotal',
            header: 'ก่อน VAT',
            type: 'money',
            mobileHidden: true,
            render: (row) => <span>{formatTHB(row.subtotal)}</span>,
        },
        {
            key: 'vat',
            header: 'VAT 7%',
            type: 'money',
            mobileHidden: true,
            render: (row) => <span>{formatTHB(row.vat)}</span>,
        },
        {
            key: 'totalAmount',
            header: 'ยอดรวม',
            type: 'money',
            render: (row) => <span className="font-semibold">{formatTHB(row.totalAmount)}</span>,
        },
        {
            key: 'status',
            header: 'สถานะ',
            type: 'status',
            render: (row) => (
                <StatusBadge
                    status={row.status}
                    label={STATUS_LABEL_TH[row.status] || row.status}
                />
            ),
        },
        {
            key: 'paidAt',
            header: 'ชำระแล้ว',
            type: 'date',
            mobileHidden: true,
            render: (row) =>
                row.paidAt ? (
                    <span className="text-xs font-semibold text-leaf-700">
                        {formatThaiDate(row.paidAt)}
                    </span>
                ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                ),
        },
        {
            key: 'actions',
            header: 'การดำเนินการ',
            type: 'custom',
            align: 'center',
            render: (row) => (
                <ReviewActions invoice={row} canWrite={canWrite} onUpdated={fetchRows} />
            ),
        },
    ];

    return (
        <ProviderLayout>
            <div className="space-y-5 p-4 md:p-6">
                <PageToolbar
                    eyebrow="บัญชี · ใบกำกับภาษีซื้อ"
                    title="ใบกำกับภาษีซื้อ (Input VAT)"
                    subtitle="บันทึก / อนุมัติ / ปฏิเสธ / บันทึกชำระเงินใบกำกับภาษีซื้อตามมาตรฐาน ป.รัษฎากร ม.86/4 และ ม.83/8 รองรับการรวมในรายงาน ภ.พ.30"
                    actions={[
                        ...(canWrite
                            ? [{
                                key: 'create',
                                label: 'บันทึกใบกำกับใหม่',
                                description: 'เพิ่มใบกำกับภาษีซื้อในสถานะ PENDING_REVIEW',
                                icon: <IconCirclePlus className="h-4 w-4" />,
                                onClick: () => setCreateOpen(true),
                                variant: 'primary' as const,
                            }]
                            : []),
                        {
                            key: 'refresh',
                            label: 'รีเฟรชรายการ',
                            description: 'โหลดรายการใบกำกับล่าสุดอีกครั้ง',
                            icon: <IconRefresh className="h-4 w-4" />,
                            onClick: () => fetchRows(),
                            variant: 'outline',
                        },
                        {
                            key: 'back',
                            label: 'กลับไปบัญชีและใบเสร็จ',
                            href: '/provider/accounting',
                            icon: <IconArrowLeft className="h-4 w-4" />,
                            variant: 'ghost',
                        },
                    ]}
                />

                <SummaryCard
                    org="ใบกำกับภาษีซื้อฝั่งแพลตฟอร์ม"
                    contextPill={`ตัวกรอง: ${
                        FILTER_CHIPS.find((c) => c.id === statusFilter)?.label || statusFilter
                    }`}
                    totals={[
                        {
                            label: 'จำนวนใบกำกับในมุมมอง',
                            value: `${rows.length}`,
                            emphasis: 'primary',
                            hint: `ทั้งหมด ${counts.ALL} ใบ (รอตรวจ ${counts.PENDING_REVIEW} / อนุมัติ ${counts.APPROVED} / ปฏิเสธ ${counts.REJECTED})`,
                        },
                        {
                            label: 'ยอดรวมในมุมมอง',
                            value: formatTHB(totals.totalAmount),
                            hint: 'รวม VAT แล้ว',
                        },
                        {
                            label: 'Input VAT ที่อนุมัติแล้ว',
                            value: formatTHB(totals.inputVat),
                            hint: 'หักล้าง Output VAT บน ภ.พ.30',
                        },
                    ]}
                    meta={[
                        { label: 'เกณฑ์งวด', value: 'invoiceDate ตาม ม.83/8' },
                        { label: 'อ้างอิงกฎหมาย', value: 'ป.รัษฎากร ม.86/4 + ม.82/3' },
                    ]}
                />

                {/* Status filter chips — mirror apps/web-app/src/app/provider/accounting/client-view.tsx:474-501 */}
                <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card px-4 py-3 print:hidden">
                    {FILTER_CHIPS.map((chip) => {
                        const count = chip.id === 'ALL' ? counts.ALL : counts[chip.id];
                        const active = statusFilter === chip.id;
                        return (
                            <button
                                type="button"
                                key={chip.id}
                                onClick={() => setStatusFilter(chip.id)}
                                className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                                    active
                                        ? 'border-primary/40 bg-muted font-semibold text-foreground'
                                        : 'border-border bg-card text-muted-foreground hover:bg-muted'
                                }`}
                                aria-pressed={active}
                            >
                                {chip.label} ({count})
                            </button>
                        );
                    })}
                </div>

                {error ? (
                    <div
                        role="alert"
                        className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
                    >
                        ไม่สามารถโหลดรายการได้: {error}
                    </div>
                ) : null}

                <DataTable<PurchaseInvoice>
                    columns={columns}
                    rows={rows}
                    getRowKey={(row) => row.id}
                    loading={loading}
                    emptyTitle="ยังไม่มีใบกำกับภาษีซื้อในมุมมองนี้"
                    emptyDescription="กดปุ่ม 'บันทึกใบกำกับใหม่' ที่มุมขวาบนเพื่อสร้างรายการแรก"
                    emptyIcon={<IconReceiptTax size={36} />}
                />

                {rows.length > 0 && !loading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <IconCircleCheck size={14} className="text-leaf-700" />
                        <span>ข้อมูลเรียงลำดับตามวันที่ใบกำกับ (invoiceDate) ใหม่สุดก่อน</span>
                    </div>
                ) : null}
            </div>

            {canWrite ? (<CreateInvoiceModal
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreated={(row) => {
                    setCreateOpen(false);
                    // X4-FIX-C / M-2 — uniform success toast across mutate flows.
                    toast.success(
                        `บันทึกใบกำกับซื้อ ${row.invoiceNumber || row.id.slice(0, 8)} เรียบร้อยแล้ว`,
                    );
                    // After successful create the new row is PENDING_REVIEW;
                    // bounce the filter to that bucket so the user sees their
                    // newly-created row immediately rather than searching for it.
                    setStatusFilter('PENDING_REVIEW');
                    fetchRows();
                }}
            />) : null}
        </ProviderLayout>
    );
}
