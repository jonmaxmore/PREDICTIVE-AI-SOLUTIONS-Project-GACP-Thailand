'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    IconArrowLeft,
    IconPlus,
    IconReceiptTax,
    IconRefresh,
} from '@tabler/icons-react';
import ProviderLayout from '../../components/provider-layout';
import {
    DataTable,
    FilterBar,
    FilterField,
    PageToolbar,
    SummaryCard,
    type DataColumn,
} from '@/components/finance';
import { useAuth } from '@/lib/services/auth-provider';
import { normalizeRole, canViewAccounting, canWriteAccounting } from '@/lib/constants/canonical-roles';
import {
    WhtCertificateService,
    type WhtCertificateRecord,
} from '@/lib/services/finance-orphans-service';
import { toast } from 'sonner';
import { formatTHB } from '@/lib/format/thb';
import { StubScopeBanner } from './stub-scope-banner';
import { ApplicabilityProbe } from './applicability-probe';
import { RecordCertificateModal } from './record-certificate-modal';
import { THAI_TIME_ZONE, bangkokTodayIso, bangkokFirstOfMonthIso } from '@/lib/format/thai-date';

/**
 * WHT (ทบ.50 ทวิ) page client view.
 *
 * Capabilities:
 *   1. Always show the stub-scope banner at the top — owner directive
 *      ("ถ้าหัก 3% แล้วเสี่ยงผิดกฎหมาย หรือเราไม่ได้นำส่ง เอาออกก็ได้").
 *   2. Date-range filter (defaults to first-of-current-month → today)
 *      → GET /api/finance/wht/certificates.
 *   3. Applicability probe for ad-hoc invoice lookups.
 *   4. Record-certificate button + modal — write roles only
 *      (canWriteAccounting: finance_officer_platform / system_admin_dtam).
 *
 * Role gating — the one exported source in lib/constants/canonical-roles.ts,
 * which mirrors apps/backend/services/wht-service.js READ_ROLES / WRITE_ROLES:
 *   READ  = canViewAccounting — both finance roles + system_admin_dtam
 *           (operator 2026-09-11; field_inspector removed 2026-09-27)
 *   WRITE = canWriteAccounting — finance_officer_platform + system_admin_dtam;
 *           the DTAM finance role reads only (operator 2026-09-27 "กรมฯ ดูอย่างเดียว")
 */

const SHORT_DATE = new Intl.DateTimeFormat('th-TH', {
    timeZone: THAI_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
});

// X4-FIX-C H-5 — adopt the canonical formatTHB from @/lib/format/thb.
// The wht-context historically rendered "฿1,234.56" (prefix + 2dp);
// the canonical helper produces the same shape via `{ prefix: true,
// decimals: 2 }`. Preserve the `'—'` placeholder for null/undefined
// since the WHT row layout uses it as the visible "no data" cell.
function formatThb(amount: number | null | undefined): string {
    if (amount === null || amount === undefined || !Number.isFinite(amount)) {
        return '—';
    }
    return formatTHB(amount, { decimals: 2, prefix: true });
}

function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return SHORT_DATE.format(d);
}

function todayIso(): string {
    return bangkokTodayIso(); // today in Bangkok, not UTC
}

function firstOfMonthIso(): string {
    return bangkokFirstOfMonthIso();
}

export default function ClientView() {
    const { user, isLoading: authLoading } = useAuth();
    const role = normalizeRole(user?.role) || '';
    const canRead = canViewAccounting(role);
    const canWrite = canWriteAccounting(role);

    const [startDate, setStartDate] = useState<string>(firstOfMonthIso);
    const [endDate, setEndDate] = useState<string>(todayIso);
    const [appliedStart, setAppliedStart] = useState<string>(startDate);
    const [appliedEnd, setAppliedEnd] = useState<string>(endDate);

    const [rows, setRows] = useState<WhtCertificateRecord[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [recordOpen, setRecordOpen] = useState<boolean>(false);

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
        if (!canRead) return;
        setLoading(true);
        setError(null);
        try {
            const data = await WhtCertificateService.listCertificates({
                startDate: appliedStart,
                endDate: appliedEnd,
            });
            if (!mountedRef.current) return;
            setRows(data.certificates);
        } catch (err) {
            if (!mountedRef.current) return;
            const message = err instanceof Error ? err.message : 'โหลดรายการไม่สำเร็จ';
            setError(message);
            setRows([]);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [canRead, appliedStart, appliedEnd]);

    useEffect(() => {
        if (!canRead) return;
        // R3-A: cancelled-flag guard avoids "setState on unmounted component"
        // when the user navigates away mid-fetch (R1 review M-2).
        let cancelled = false;
        void (async () => {
            setLoading(true);
            setError(null);
            try {
                const data = await WhtCertificateService.listCertificates({
                    startDate: appliedStart,
                    endDate: appliedEnd,
                });
                if (cancelled) return;
                setRows(data.certificates);
            } catch (err) {
                if (cancelled) return;
                const message = err instanceof Error ? err.message : 'โหลดรายการไม่สำเร็จ';
                setError(message);
                setRows([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [canRead, appliedStart, appliedEnd]);

    const totalWht = useMemo(
        () =>
            rows.reduce((acc, r) => acc + (Number.isFinite(r.whtAmount) ? r.whtAmount : 0), 0),
        [rows],
    );

    const columns: ReadonlyArray<DataColumn<WhtCertificateRecord>> = useMemo(
        () => [
            {
                key: 'certificateNumber',
                header: 'เลขที่ ทบ.50 ทวิ',
                type: 'text',
                render: (row) => (
                    <span className="font-mono text-sm font-semibold text-foreground">
                        {row.certificateNumber}
                    </span>
                ),
            },
            {
                key: 'invoiceNumber',
                header: 'ใบกำกับภาษี',
                type: 'text',
                render: (row) => (
                    <div className="min-w-0">
                        <p className="font-mono text-sm text-foreground">{row.invoiceNumber}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{row.invoiceId}</p>
                    </div>
                ),
            },
            {
                key: 'issuedByName',
                header: 'ผู้ออก (นิติบุคคล)',
                type: 'text',
                mobileHidden: true,
                render: (row) => (
                    <div className="min-w-0">
                        <p className="text-sm text-foreground">{row.issuedByName}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                            TIN: {row.issuedByTaxId}
                        </p>
                    </div>
                ),
            },
            {
                key: 'certificateDate',
                header: 'วันที่หนังสือ',
                type: 'date',
                mobileHidden: true,
                render: (row) => (
                    <span className="text-sm text-foreground">
                        {formatDate(row.certificateDate)}
                    </span>
                ),
            },
            {
                key: 'whtAmount',
                header: 'WHT (THB)',
                type: 'money',
                render: (row) => (
                    <span className="font-mono text-sm font-semibold text-leaf-800">
                        {formatThb(row.whtAmount)}
                    </span>
                ),
            },
            {
                key: 'invoiceSubtotal',
                header: 'Subtotal ใบกำกับ',
                type: 'money',
                mobileHidden: true,
                render: (row) => (
                    <span className="font-mono text-sm text-muted-foreground">
                        {formatThb(row.invoiceSubtotal)}
                    </span>
                ),
            },
            {
                key: 'recordedAt',
                header: 'บันทึกเมื่อ',
                type: 'date',
                mobileHidden: true,
                render: (row) => (
                    <span className="text-xs text-muted-foreground">{formatDate(row.recordedAt)}</span>
                ),
            },
        ],
        [],
    );

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

    // Non-finance users get the rose forbidden callout.
    if (!canRead) {
        return (
            <ProviderLayout>
                <div className="mx-auto max-w-2xl p-6">
                    <div className="rounded-lg border border-rose-300 bg-rose-50 p-8 text-center">
                        <h2 className="text-xl font-bold text-rose-900">ไม่มีสิทธิ์เข้าถึง</h2>
                        <p className="mt-3 text-sm text-rose-800">
                            หน้านี้สำหรับเจ้าหน้าที่การเงิน / ผู้ตรวจสอบ / ผู้ดูแลระบบเท่านั้น
                        </p>
                    </div>
                </div>
            </ProviderLayout>
        );
    }

    return (
        <ProviderLayout>
            <div className="space-y-5 p-4 md:p-6">
                <PageToolbar
                    eyebrow="บัญชี · ภาษีหัก ณ ที่จ่าย"
                    title="หนังสือรับรองการหักภาษี ณ ที่จ่าย (ทบ.50 ทวิ)"
                    subtitle="บันทึกและตรวจสอบ ทบ.50 ทวิ ที่ผู้ซื้อนิติบุคคลส่งกลับมาให้ฝ่ายการเงินของแพลตฟอร์ม"
                    actions={[
                        ...(canWrite
                            ? [
                                {
                                    key: 'record',
                                    label: 'บันทึก ทบ.50 ทวิ ใหม่',
                                    icon: <IconPlus size={16} />,
                                    variant: 'primary' as const,
                                    onClick: () => setRecordOpen(true),
                                },
                            ]
                            : []),
                        {
                            key: 'back',
                            label: 'กลับไปบัญชีและใบเสร็จ',
                            href: '/provider/accounting',
                            icon: <IconArrowLeft size={16} />,
                            variant: 'ghost',
                        },
                    ]}
                />

                {/* Stub-scope banner ALWAYS visible — per task requirement */}
                <StubScopeBanner />

                {/* Read-only notice for viewers without write power (DTAM finance, inspector) */}
                {!canWrite ? (
                    <div data-role-notice className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground">
                        บัญชีของคุณมีสิทธิ์ดูเท่านั้น การบันทึก ทบ.50 ทวิ ทำโดยฝ่ายการเงินของบริษัท
                    </div>
                ) : null}

                <SummaryCard
                    contextPill={`${formatDate(appliedStart)} → ${formatDate(appliedEnd)}`}
                    totals={[
                        {
                            label: 'จำนวน ทบ.50 ทวิ ในช่วง',
                            value: rows.length.toLocaleString('th-TH'),
                            emphasis: 'primary',
                        },
                        {
                            label: 'WHT รวม (THB)',
                            value: formatThb(totalWht),
                        },
                    ]}
                    meta={[
                        { label: 'ขอบเขต', value: 'ใบกำกับภาษีฝั่งแพลตฟอร์ม (ยอดก่อน VAT × 3%)' },
                        { label: 'ฐานข้อมูล', value: 'บันทึกในระบบใบแจ้งหนี้ (ระบบบันทึกอย่างเดียว)' },
                        { label: 'ภ.ง.ด.53', value: 'ไม่อยู่ในขอบเขตของระบบ' },
                    ]}
                    primaryColorClass="text-primary"
                />

                <ApplicabilityProbe />

                <FilterBar
                    onApply={() => {
                        setAppliedStart(startDate);
                        setAppliedEnd(endDate);
                    }}
                    applyLabel="แสดงผล"
                    secondaryAction={
                        <button
                            type="button"
                            onClick={() => fetchRows()}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
                        >
                            <IconRefresh size={16} aria-hidden="true" />
                            รีเฟรช
                        </button>
                    }
                >
                    <FilterField label="วันที่เริ่ม" htmlFor="wht-start-date">
                        <input
                            id="wht-start-date"
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                    </FilterField>
                    <FilterField label="วันที่สิ้นสุด" htmlFor="wht-end-date">
                        <input
                            id="wht-end-date"
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                    </FilterField>
                </FilterBar>

                {error ? (
                    <div
                        role="alert"
                        className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800"
                    >
                        {error}
                    </div>
                ) : null}

                <DataTable<WhtCertificateRecord>
                    columns={columns}
                    rows={rows}
                    getRowKey={(row) => `${row.invoiceId}-${row.certificateNumber}`}
                    loading={loading}
                    emptyTitle="ยังไม่มี ทบ.50 ทวิ ในช่วงนี้"
                    emptyDescription="เมื่อผู้ซื้อนิติบุคคลส่งหนังสือรับรองกลับมา ฝ่ายการเงินสามารถกด ‘บันทึก ทบ.50 ทวิ ใหม่’ เพื่อบันทึก"
                    emptyIcon={<IconReceiptTax size={32} aria-hidden="true" />}
                />
            </div>

            {canWrite ? (
                <RecordCertificateModal
                    open={recordOpen}
                    onClose={() => setRecordOpen(false)}
                    onRecorded={() => {
                        // X4-FIX-C / M-2 — uniform success toast (was silent).
                        toast.success('บันทึกใบรับรองหัก ณ ที่จ่าย (ทบ.50 ทวิ) เรียบร้อยแล้ว');
                        void fetchRows();
                    }}
                />
            ) : null}
        </ProviderLayout>
    );
}
