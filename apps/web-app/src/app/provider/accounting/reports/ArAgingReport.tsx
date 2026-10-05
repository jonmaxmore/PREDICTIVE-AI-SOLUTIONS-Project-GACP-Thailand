'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    IconDownload,
    IconPrinter,
    IconRefresh,
    IconAlertTriangle,
    IconMail,
    IconCheck,
} from '@tabler/icons-react';
import { PageToolbar, FilterBar, FilterField } from '@/components/finance';
import { useAuth } from '@/lib/services/auth-provider';
import { canViewAccounting } from '@/lib/constants/canonical-roles';
import {
    AccountingService,
    formatTHB,
    todayIso,
    type ArAgingResponse,
    type ArAgingBucket,
} from '@/lib/services/accounting-service';

const BUCKET_ORDER: ArAgingBucket[] = [
    'NOT_YET_DUE',
    '0_30',
    '31_60',
    '61_90',
    'OVER_90',
];

const BUCKET_LABEL: Record<ArAgingBucket, string> = {
    NOT_YET_DUE: 'ยังไม่ครบกำหนด',
    '0_30': 'ค้าง 0-30 วัน',
    '31_60': 'ค้าง 31-60 วัน',
    '61_90': 'ค้าง 61-90 วัน',
    OVER_90: 'ค้างเกิน 90 วัน',
};

const BUCKET_TONE: Record<ArAgingBucket, string> = {
    NOT_YET_DUE: 'bg-muted text-foreground border-border',
    '0_30': 'bg-amber-50 text-amber-800 border-amber-200',
    '31_60': 'bg-orange-50 text-orange-800 border-orange-200',
    '61_90': 'bg-rose-50 text-rose-800 border-rose-200',
    OVER_90: 'bg-red-100 text-red-900 border-red-300',
};

/**
 * AR Aging Report (รายงานลูกหนี้ค้างชำระ) — B20-D, 2026-05-16.
 *
 * Buckets PENDING invoices by (asOfDate − dueDate). The book side is a
 * filter the VIEWER chooses (DTAM = legacy state-fee invoices, PLATFORM =
 * service fee) — never forced by role. Both finance roles get the same
 * selector and the same default (operator 2026-09-11 "finance ต้องเห็นเหมือนกัน");
 * the backend already returns both sides to both roles
 * (customer-reports.js resolveViewerSides).
 *
 * Applicant healthId is masked at the service boundary per PDPA ม.6
 * (data minimisation); this UI never sees the full 13-digit ID.
 */
const BOOK_SIDES: ReadonlyArray<'DTAM' | 'PLATFORM'> = ['PLATFORM', 'DTAM'];

export function ArAgingReport() {
    const { user, isLoading: authLoading } = useAuth();
    const canRead = canViewAccounting(user?.role);

    // Default = PLATFORM (the one service fee); DTAM stays selectable for the
    // legacy state-fee invoices that predate the one-fee ruling.
    const [bookSide, setBookSide] = useState<'DTAM' | 'PLATFORM'>('PLATFORM');
    const [asOfDate, setAsOfDate] = useState<string>(todayIso());
    const [data, setData] = useState<ArAgingResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        if (!canRead) { return; }
        setLoading(true);
        setError(null);
        try {
            const res = await AccountingService.getArAging({ bookSide, asOfDate });
            setData(res);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'ไม่สามารถโหลดรายงานลูกหนี้ค้างชำระได้ กรุณาลองอีกครั้ง',
            );
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [asOfDate, bookSide, canRead]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    const handleDownloadCsv = () => {
        if (typeof window === 'undefined') return;
        const url = AccountingService.arAgingCsvUrl({ bookSide, asOfDate });
        window.location.href = url;
    };

    const handlePrint = () => {
        if (typeof window === 'undefined') return;
        window.print();
    };

    // Auth session loads post-mount (AuthProvider W1-HYDRATION), so the
    // role is unknown while isLoading — show a loading state instead of
    // flashing the 403 callout at legitimately authorized finance staff.
    if (authLoading) {
        return (
            <p
                role="status"
                aria-live="polite"
                className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground"
            >
                กำลังตรวจสอบสิทธิ์การเข้าถึง...
            </p>
        );
    }

    if (!canRead) {
        return (
            <div className="rounded-lg border border-rose-300 bg-rose-50 p-6 text-center">
                <IconAlertTriangle size={32} className="mx-auto mb-2 text-rose-700" />
                <h3 className="text-base font-bold text-rose-900">ไม่มีสิทธิ์เข้าถึง</h3>
                <p className="mt-1 text-sm text-rose-800">
                    หน้ารายงานลูกหนี้ค้างชำระสำหรับเจ้าหน้าที่บัญชีและผู้ตรวจสอบเท่านั้น
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <PageToolbar
                eyebrow="รายงาน"
                title="รายงานลูกหนี้ค้างชำระ"
                subtitle={`ฝั่ง ${bookSide === 'DTAM' ? 'DTAM (ค่าธรรมเนียมรัฐ)' : 'PLATFORM (ค่าบริการ)'} · ณ วันที่ ${asOfDate}`}
                actions={[
                    {
                        key: 'refresh',
                        label: 'รีเฟรชข้อมูล',
                        description: 'โหลดข้อมูลล่าสุดจากระบบ',
                        icon: <IconRefresh className="h-4 w-4" />,
                        onClick: fetchData,
                        variant: 'primary',
                        disabled: loading,
                    },
                    {
                        key: 'csv',
                        label: 'ดาวน์โหลด CSV',
                        description: 'รายงาน CSV เปิดได้ด้วย Excel',
                        icon: <IconDownload className="h-4 w-4" />,
                        onClick: handleDownloadCsv,
                        variant: 'outline',
                        disabled: !data || loading,
                    },
                    {
                        key: 'print',
                        label: 'พิมพ์รายงาน',
                        description: 'พิมพ์ในรูปแบบ A4 แนวนอน',
                        icon: <IconPrinter className="h-4 w-4" />,
                        onClick: handlePrint,
                        variant: 'outline',
                        disabled: !data || loading,
                    },
                ]}
            />

            <FilterBar onApply={fetchData} applyDisabled={loading}>
                <FilterField label="ฝั่งบัญชี" htmlFor="ar-book-side">
                    <select
                        id="ar-book-side"
                        value={bookSide}
                        onChange={(e) => setBookSide(e.target.value as 'DTAM' | 'PLATFORM')}
                        className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                        {BOOK_SIDES.map((side) => (
                            <option key={side} value={side}>
                                {side === 'DTAM' ? 'DTAM (ค่าธรรมเนียมรัฐ)' : 'PLATFORM (ค่าบริการ)'}
                            </option>
                        ))}
                    </select>
                </FilterField>
                <FilterField label="ณ วันที่" htmlFor="ar-as-of-date">
                    <input
                        id="ar-as-of-date"
                        type="date"
                        value={asOfDate}
                        onChange={(e) => setAsOfDate(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </FilterField>
            </FilterBar>

            {error ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                    {error}
                </div>
            ) : null}

            {loading ? (
                <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                    กำลังโหลดรายงาน...
                </p>
            ) : null}

            {data && !loading ? (
                <>
                    {/* Bucket totals — FlowAccount-style summary cards. */}
                    <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
                        {BUCKET_ORDER.map((bucket) => {
                            const totals = data.totalsByBucket[bucket] || { amount: 0, count: 0 };
                            return (
                                <div
                                    key={bucket}
                                    className={`rounded-lg border p-4  ${BUCKET_TONE[bucket]}`}
                                >
                                    <p className="text-[11px] font-bold">{BUCKET_LABEL[bucket]}</p>
                                    <p className="mt-2 text-lg font-bold tabular-nums md:text-xl">
                                        {formatTHB(totals.amount)}
                                    </p>
                                    <p className="mt-0.5 text-xs">{totals.count} ใบ</p>
                                </div>
                            );
                        })}
                    </section>

                    {/* Grand total — plain hairline card, no accent fill. */}
                    <div className="rounded-lg border border-border bg-card p-5">
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">
                                    ยอดค้างชำระรวม ({bookSide === 'DTAM' ? 'ฝั่งรัฐ' : 'ฝั่งแพลตฟอร์ม'})
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {data.rowCount} ใบแจ้งหนี้
                                </p>
                            </div>
                            <p className="text-2xl font-semibold tabular-nums text-foreground">
                                {formatTHB(data.totalOutstanding)}
                            </p>
                        </div>
                    </div>

                    {/* Detail table — FlowAccount-style with hover row + monospaced doc numbers. */}
                    <div className="overflow-hidden rounded-lg border border-border bg-card">
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-border text-sm">
                                <thead className="bg-muted/40 text-xs text-muted-foreground">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-bold">เลขที่ INV</th>
                                        <th className="px-4 py-3 text-left font-bold">คำขอ</th>
                                        <th className="px-4 py-3 text-left font-bold">เลขประจำตัว (masked)</th>
                                        <th className="px-4 py-3 text-left font-bold">ผู้สมัคร (masked)</th>
                                        <th className="px-4 py-3 text-left font-bold">วันครบกำหนด</th>
                                        <th className="px-4 py-3 text-right font-bold">วันค้าง</th>
                                        <th className="px-4 py-3 text-left font-bold">ช่วงอายุ</th>
                                        <th className="px-4 py-3 text-right font-bold">จำนวนเงิน</th>
                                        <th className="px-4 py-3 text-center font-bold print:hidden">การติดตามหนี้</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {data.rows.length === 0 ? (
                                        <tr>
                                            <td colSpan={9} className="px-4 py-16 text-center text-muted-foreground">
                                                <p className="text-base font-semibold text-foreground">ไม่มีรายการลูกหนี้ค้างชำระ</p>
                                                <p className="mt-1 text-sm">ไม่พบใบแจ้งหนี้ค้างชำระในช่วงเวลานี้</p>
                                            </td>
                                        </tr>
                                    ) : (
                                        data.rows.map((row) => (
                                            <tr key={row.invoiceId} className="transition-colors hover:bg-muted">
                                                <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{row.invoiceNumber}</td>
                                                <td className="px-4 py-3 text-xs">{row.applicationNumber || '-'}</td>
                                                <td className="px-4 py-3 font-mono text-xs">
                                                    {row.applicantHealthIdMasked || '-'}
                                                </td>
                                                <td className="px-4 py-3 text-xs">{row.applicantNameMasked || '-'}</td>
                                                <td className="px-4 py-3 text-xs">
                                                    {row.dueDate ? new Date(row.dueDate).toLocaleDateString('th-TH') : '-'}
                                                </td>
                                                <td className="px-4 py-3 text-right tabular-nums">
                                                    {row.daysOverdue >= 0 ? row.daysOverdue : 0}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span
                                                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${BUCKET_TONE[row.bucket]}`}
                                                    >
                                                        {BUCKET_LABEL[row.bucket]}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right font-medium tabular-nums">
                                                    {formatTHB(row.amount)}
                                                </td>
                                                {/*
                                                  X4-FIX-C / H-3 — collection-action affordance.
                                                  DTAM finance staff need at least 2 path-forward
                                                  buttons per overdue row: send-reminder + mark-collected.
                                                  Backend endpoints (POST /invoices/:id/reminder,
                                                  POST /invoices/:id/mark-collected) are pending
                                                  the X4.5 follow-up — buttons are rendered disabled
                                                  with a Thai-language tooltip so DTAM can see the
                                                  workflow shape ahead of the API landing.
                                                */}
                                                <td className="px-4 py-3 text-center print:hidden">
                                                    <div className="inline-flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            data-testid={`ar-action-remind-${row.invoiceId}`}
                                                            disabled
                                                            title="ฟีเจอร์นี้จะเปิดใช้งานเร็ว ๆ นี้ (X4.5)"
                                                            aria-label={`ส่งใบทวงถาม ${row.invoiceNumber}`}
                                                            className="inline-flex h-9 min-h-[36px] items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 opacity-60 disabled:cursor-not-allowed"
                                                        >
                                                            <IconMail size={14} />
                                                            ส่งใบทวงถาม
                                                        </button>
                                                        <button
                                                            type="button"
                                                            data-testid={`ar-action-mark-collected-${row.invoiceId}`}
                                                            disabled
                                                            title="ฟีเจอร์นี้จะเปิดใช้งานเร็ว ๆ นี้ (X4.5)"
                                                            aria-label={`ทำเครื่องหมายว่าเก็บเงินแล้ว ${row.invoiceNumber}`}
                                                            className="inline-flex h-9 min-h-[36px] items-center gap-1 rounded-lg border border-leaf-300 bg-leaf-soft px-2.5 text-xs font-semibold text-leaf-onSoft opacity-60 disabled:cursor-not-allowed"
                                                        >
                                                            <IconCheck size={14} />
                                                            ทำเครื่องหมายว่าเก็บเงินแล้ว
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            ) : null}
        </div>
    );
}
