'use client';


import Link from 'next/link';
import { Table } from '@/components/ui/primitives/table';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Spinner as Loader } from '@/components/ui/spinner';
import { formatThaiDate } from '@/lib/format/thai-date';
import { useEffect, useState, useCallback } from "react";
import ProviderLayout from "../components/provider-layout";
import { apiClient } from '@/lib/api/api-client';
import {
    FilterBar,
    SummaryCard,
    TabNav,
    StatusBadge as FlowStatusBadge,
    type FilterChip,
} from '@/components/finance';
import {
    LaunchpadHeader,
} from '@/components/provider/launchpad';
import {
    IconFileText,
    IconCoin,
    IconDownload,
    IconEye,
    IconRefresh,
    IconCheck,
    IconChevronDown,
    IconPrinter,
} from "@tabler/icons-react";

import {
    type InvoiceItem,
    type PaymentSummary,
    type RevenueSummary,
    type RawInvoice,
    type PaymentException,
    DEFAULT_SUMMARY,
    DEFAULT_REVENUE,
    normalizeInvoiceStatus
} from "./accounting-types";
import { InvoiceDetailModal } from "./invoice-detail-modal";
import { useAuth } from '@/lib/services/auth-provider';
import { canHoldInvoice, canWriteAccounting } from '@/lib/constants/canonical-roles';
import { formatTHB } from '@/lib/format/thb';
import { csvRow } from '@/lib/csv';

// Thai display labels for the dashboard tab ids — used by the sr-only
// "current view" announcement so screen readers hear the Thai tab name
// instead of the raw enum value.
const TAB_LABELS: Record<string, string> = {
    pending_receipt: 'รอยืนยัน',
    receipt_issued: 'ออกใบเสร็จแล้ว',
    exceptions: 'รายการผิดพลาด',
};

// Thai display labels for exception severity enums (raw values stay
// unchanged in data / API payloads).
const SEVERITY_LABELS: Record<string, string> = {
    ERROR: 'ข้อผิดพลาด',
    WARNING: 'คำเตือน',
};

/**
 * The accounting dashboard at /provider/accounting — one view for everyone
 * who can open it.
 *
 * operator 2026-09-11: "finance ต้องเห็นเหมือนกัน หรือว่าตัวเลขที่ต้องมากระทบยอด ต้องเท่ากัน
 * เพื่อแสดงความโปร่งใส" — both finance roles get the same title, figures, lists
 * and exports (the backend returns the same rows to both). operator 2026-09-27:
 * "กรมฯ ดูอย่างเดียว" — the DTAM finance role has no write power, so the
 * per-invoice write buttons (hold/release, refund) render only for the roles
 * the backend lets write (canHoldInvoice / canWriteAccounting).
 */
export function AccountingDashboardClient() {
    const { user } = useAuth();
    const canRefund = canWriteAccounting(user?.role);

    const [summary, setSummary] = useState<PaymentSummary>(DEFAULT_SUMMARY);
    // B4: the /invoices/revenue-summary fetch is preserved (data fetching
    // unchanged) but the read binding is intentionally discarded so the
    // network call + error path stay intact.
    const [, setRevenue] = useState<RevenueSummary>(DEFAULT_REVENUE);
    const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
    const [exceptions, setExceptions] = useState<PaymentException[]>([]);
    const [activeTab, setActiveTab] = useState<"pending_receipt" | "receipt_issued" | "exceptions">("pending_receipt");
    const [isLoading, setIsLoading] = useState(true);
    // M10: if any of the 3 PRIMARY fetches (summary/invoices/exceptions) fails, a
    // 500/403 would otherwise silently fall back to zeroed financials + an empty
    // invoice list — indistinguishable from a real empty period on a reconciliation
    // surface. Track it and show a banner so the accountant doesn't trust bad zeros.
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [showExportMenu, setShowExportMenu] = useState(false);

    const [selectedInvoice, setSelectedInvoice] = useState<InvoiceItem | null>(null);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setFetchError(null);
        try {
            const [summaryRes, invoicesRes, exceptionsRes, revenueRes] = await Promise.all([
                apiClient.get<PaymentSummary>('/invoices/summary'),
                apiClient.get<{ invoices: RawInvoice[] }>('/invoices'),
                apiClient.get<{ exceptions: PaymentException[] }>('/invoices/receipts/exceptions?limit=100'),
                apiClient.get<RevenueSummary>('/invoices/revenue-summary').catch(() => null),
            ]);

            if (summaryRes?.success && summaryRes?.data) {
                setSummary(summaryRes.data as PaymentSummary);
            } else {
                setSummary(DEFAULT_SUMMARY);
            }

            if (invoicesRes?.success && invoicesRes?.data && Array.isArray((invoicesRes.data as Record<string, unknown>)?.invoices)) {
                const mapped = ((invoicesRes.data as Record<string, unknown>).invoices as RawInvoice[]).map((inv) => ({
                    id: inv.id,
                    invoiceNumber: inv.invoiceNumber,
                    applicationNumber: inv.application?.applicationNumber || inv.applicationNumber || "-",
                    healthName: `${(inv.health || inv.applicant)?.firstName || ""} ${(inv.health || inv.applicant)?.lastName || ""}`.trim()
                        || (inv.health || inv.applicant)?.companyName
                        || "-",
                    amount: Number(inv.totalAmount || 0),
                    status: inv.status,
                    ...(inv.erpStatus !== undefined ? { erpStatus: inv.erpStatus } : {}),
                    dueDate: inv.dueDate,
                    ...(inv.paidAt !== undefined ? { paidAt: inv.paidAt } : {}),
                    createdAt: inv.createdAt,
                    ...(inv.notes !== undefined ? { notes: inv.notes } : {}),
                    items: inv.items,
                    ...(inv.issuerSide !== undefined ? { issuerSide: inv.issuerSide } : {}),
                }));
                setInvoices(mapped);
            } else {
                setInvoices([]);
            }

            if (exceptionsRes?.success && exceptionsRes?.data && Array.isArray((exceptionsRes.data as Record<string, unknown>)?.exceptions)) {
                setExceptions((exceptionsRes.data as Record<string, unknown>).exceptions as PaymentException[]);
            } else {
                setExceptions([]);
            }

            if (revenueRes?.success && revenueRes?.data) {
                setRevenue(revenueRes.data as RevenueSummary);
            }

            // M10: any PRIMARY call failing → warn the accountant the figures are
            // incomplete (not a real empty period). Secondaries above are non-blocking.
            if (!(summaryRes?.success && invoicesRes?.success && exceptionsRes?.success)) {
                setFetchError('ไม่สามารถโหลดข้อมูลการเงินบางส่วนได้ ตัวเลขสรุปและรายการใบแจ้งหนี้ที่แสดงอาจไม่ครบถ้วน กรุณาลองใหม่');
            }
        } catch (error: unknown) {
            console.error("Failed to fetch accounting data:", error);
            setSummary(DEFAULT_SUMMARY);
            setInvoices([]);
            setExceptions([]);
            setFetchError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อโหลดข้อมูลการเงินได้ กรุณาลองใหม่');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // X4-FIX-C H-5 — adopt the canonical formatTHB. The original used
    // Intl.NumberFormat currency style (prefix `฿` + 0dp grouping)
    // — `{ decimals: 0, prefix: true }` reproduces that shape exactly.
    const formatCurrency = (amt: number) =>
        formatTHB(amt, { decimals: 0, prefix: true });

    // P1-3: guarded — null/invalid dates rendered Buddhist epoch "1/1/2513"
    // (incl. into the exported financial CSV below). Returns '-' instead.
    const formatDate = (value?: string | null) =>
        formatThaiDate(value, { year: "numeric", month: "short", day: "numeric" });

    const getStatusBadge = (status: string) => (
        <FlowStatusBadge status={status} />
    );



    const handleExportCSV = () => {
        const headers = ['เลขที่ใบแจ้งหนี้', 'เลขที่คำขอ', 'ผู้สมัคร', 'จำนวนเงิน (บาท)', 'สถานะ', 'วันครบกำหนด', 'วันที่ชำระ', 'วันที่สร้าง'];
        const rows = invoices.map((inv) => [
            inv.invoiceNumber,
            inv.applicationNumber,
            inv.healthName,
            inv.amount,
            normalizeInvoiceStatus(inv),
            formatDate(inv.dueDate),
            formatDate(inv.paidAt),
            formatDate(inv.createdAt),
        ]);
        // เดิม r.join(',') เปล่า ๆ — ไม่มีแม้แต่การใส่เครื่องหมายคำพูด ลูกน้ำในชื่อ
        // ผู้ยื่นทำคอลัมน์เลื่อนทั้งไฟล์ และช่องที่ขึ้นต้นด้วย = ถูก Excel ประเมินเป็นสูตร
        const csvContent = [csvRow(headers), ...rows.map((r) => csvRow(r))].join('\n');
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `gacp-accounting-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleFinancialExport = async (reportType: string) => {
        try {
            const now = new Date();
            const month = now.getMonth() + 1;
            const year = now.getFullYear();
            const blob = await apiClient.getBlob(`/invoices/export?type=${reportType}&month=${month}&year=${year}`);
            if (!blob) { throw new Error('Export failed'); }
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const names: Record<string, string> = { tax: 'tax_report', monthly: 'monthly_revenue' };
            link.download = `${names[reportType] || reportType}_${year}_${String(month).padStart(2, '0')}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Export failed:', error);
        }
        setShowExportMenu(false);
    };

    const filteredInvoices = invoices.filter((invoice) => {
        const status = normalizeInvoiceStatus(invoice);
        if (activeTab === "pending_receipt") return status === "PAID_PENDING_RECEIPT";
        if (activeTab === "receipt_issued") return status === "RECEIPT_ISSUED";
        return false;
    });

    // Active filter chips for the FilterBar — populated based on
    // current tab + phase filter so finance staff can see and remove
    // them. Each chip has its own remove handler.
    const activeChips: FilterChip[] = [];

    // One neutral title for every viewer — no per-side lane (operator 2026-09-11).
    const pageTitle = 'บัญชีและใบเสร็จ';
    const pageDescription = 'รายรับ สถานะการชำระเงิน เลขที่คำขอ และใบเสร็จรับเงิน ชุดเดียวกันสำหรับฝ่ายการเงินทุกคน';
    const launchpadGreeting = 'บัญชีการเงิน';

    if (isLoading && invoices.length === 0 && exceptions.length === 0) {
        return (
            <ProviderLayout title={pageTitle} subtitle="กำลังโหลด...">
                <div className="flex items-center justify-center"><Loader color="primary" /></div>
            </ProviderLayout>
        );
    }

    // B4 — launchpad header actions. Every button here is a read/export.
    const headerActions = (
        <>
            <Button variant="primary" onClick={() => fetchData()}>
                <IconRefresh className="mr-2 h-4 w-4" />
                รีเฟรช
            </Button>
            <Button asChild variant="outline">
                <Link href="/provider/accounting/reports">
                    <IconFileText className="mr-2 h-4 w-4" />
                    รายงานบัญชี
                </Link>
            </Button>
            <Button variant="outline" onClick={handleExportCSV}>
                <IconDownload className="mr-2 h-4 w-4" />
                ดาวน์โหลด CSV
            </Button>
            <Button
                variant="outline"
                onClick={() => typeof window !== 'undefined' && window.print()}
            >
                <IconPrinter className="mr-2 h-4 w-4" />
                พิมพ์
            </Button>
        </>
    );

    return (
        <ProviderLayout>
            <div className="space-y-5">
                {/* B4 — SAP-Fiori launchpad header band. Replaces the
                    X4-FIX-B H-6 gov-gradient PageToolbar hero. Token-only. */}
                <LaunchpadHeader
                    greeting={launchpadGreeting}
                    title={pageTitle}
                    subtitle={pageDescription}
                    actions={headerActions}
                />

                {fetchError && (
                    <div role="alert" aria-live="polite" className="flex flex-col items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-center sm:flex-row sm:justify-between sm:text-left">
                        <p className="text-sm text-rose-800">{fetchError}</p>
                        <button
                            type="button"
                            onClick={() => { void fetchData(); }}
                            className="min-h-[44px] shrink-0 rounded-lg border border-rose-300 px-4 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100"
                        >
                            ลองอีกครั้ง
                        </button>
                    </div>
                )}

                <SummaryCard
                    org="ภาพรวมการเงิน GACP"
                    contextPill={`ณ ${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}`}
                    totals={[
                        {
                            label: 'รายรับรวม',
                            value: formatCurrency(summary.totalRevenue),
                            emphasis: 'primary',
                            hint: `${summary.invoiceCount.paid} ใบแจ้งหนี้ชำระแล้ว`,
                        },
                        {
                            label: 'รอดำเนินการ',
                            value: formatCurrency(summary.pendingAmount),
                            emphasis: 'muted',
                            hint: `${summary.invoiceCount.pending} รายการ`,
                        },
                        {
                            label: 'เกินกำหนด',
                            value: formatCurrency(summary.overdueAmount),
                            emphasis: 'muted',
                            hint: `${summary.invoiceCount.overdue} รายการ`,
                        },
                        {
                            label: 'รายรับเดือนนี้',
                            value: formatCurrency(summary.monthlyRevenue),
                            emphasis: 'muted',
                            hint: 'งวดปัจจุบัน',
                        },
                    ]}
                    meta={[
                        { label: 'จำนวนเอกสารทั้งหมด', value: `${invoices.length} ใบ` },
                        { label: 'รายการผิดพลาด', value: `${exceptions.length} รายการ` },
                    ]}
                />

                {/*
                  ── รายงานที่ส่งออกได้ (operator 2026-09-11) ─────────────────────
                  เดิมเมนูนี้แยกตามฝั่ง: รายงานภาษีขายเห็นเฉพาะฝั่งบริษัท (เพราะ
                  ค่าธรรมเนียมรัฐยกเว้น VAT) และรายงานนำส่งเงินกรมเห็นเฉพาะฝั่งกรม
                  ตอนนี้ไม่มีสองฝั่งแล้ว และไม่มีการนำส่งเงินให้กรมผ่านระบบนี้:
                    · "finance ต้องเห็นเหมือนกัน ... เพื่อแสดงความโปร่งใส"
                    · "เราไม่มี wallet A/B แล้ว"
                  ⇒ เหลือสองรายงาน และทั้งสองบทบาทเห็นเหมือนกัน
                */}
                <div className="relative print:hidden" data-testid="accounting-export-dropdown">
                    <Button
                        variant="outline"
                        onClick={() => setShowExportMenu(!showExportMenu)}
                    >
                        <IconDownload className="mr-2 h-4 w-4" />
                        ส่งออกรายงานการเงิน
                        <IconChevronDown className="ml-1 h-4 w-4" />
                    </Button>
                    {showExportMenu && (
                        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-card shadow-md">
                            <button
                                data-testid="export-btn-monthly"
                                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted"
                                onClick={() => handleFinancialExport('monthly')}
                            >
                                <IconCoin size={16} className="text-leaf-600" />
                                <div>
                                    <p className="font-semibold">สรุปรายได้ประจำเดือน</p>
                                    <p className="text-xs text-muted-foreground">แยกตามงวด</p>
                                </div>
                            </button>
                            <button
                                data-testid="export-btn-tax"
                                className="flex w-full items-center gap-3 border-t border-border px-4 py-3 text-left text-sm hover:bg-muted"
                                onClick={() => handleFinancialExport('tax')}
                            >
                                <IconFileText size={16} className="text-sky-500" />
                                <div>
                                    <p className="font-semibold">รายงานภาษีขาย</p>
                                    <p className="text-xs text-muted-foreground">สำหรับสรรพากร (VAT 7%)</p>
                                </div>
                            </button>
                        </div>
                    )}
                </div>

                <TabNav
                    tabs={[
                        { id: 'pending_receipt', label: 'รอยืนยัน', count: invoices.filter((i) => normalizeInvoiceStatus(i) === 'PAID_PENDING_RECEIPT').length },
                        { id: 'receipt_issued', label: 'ออกใบเสร็จแล้ว', count: invoices.filter((i) => normalizeInvoiceStatus(i) === 'RECEIPT_ISSUED').length },
                        { id: 'exceptions', label: 'รายการผิดพลาด', count: exceptions.length },
                    ]}
                    activeId={activeTab}
                    onChange={(id) => setActiveTab(id as typeof activeTab)}
                    ariaLabel="แท็บข้อมูลบัญชี"
                />

                {activeChips.length > 0 ? (
                    <FilterBar chips={activeChips} />
                ) : null}

                <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <div className="sr-only">
                        <p>มุมมองปัจจุบัน: {TAB_LABELS[activeTab] ?? activeTab}</p>
                    </div>


                    <div className="overflow-x-auto">
                        <Table>
                            <Table.Thead className="bg-muted/30">
                                <Table.Tr>
                                    {activeTab === "exceptions" ? (
                                        <>
                                            <Table.Th className="font-bold">รหัสการดำเนินการ</Table.Th>
                                            <Table.Th className="font-bold">ระดับความรุนแรง</Table.Th>
                                            <Table.Th className="font-bold">ใบแจ้งหนี้</Table.Th>
                                            <Table.Th className="font-bold">รายละเอียด</Table.Th>
                                            <Table.Th className="font-bold">เมื่อ</Table.Th>
                                        </>
                                    ) : (
                                        <>
                                            <Table.Th className="font-bold">เลขที่ใบแจ้งหนี้</Table.Th>
                                            <Table.Th className="font-bold">ผู้สมัคร</Table.Th>
                                            <Table.Th className="text-right font-bold">จำนวนเงิน</Table.Th>
                                            <Table.Th className="font-bold">สถานะ</Table.Th>
                                            <Table.Th className="font-bold">วันครบกำหนด</Table.Th>
                                            <Table.Th className="text-center font-bold">การดำเนินการ</Table.Th>
                                        </>
                                    )}
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {activeTab === "exceptions" ? (
                                    exceptions.length > 0 ? (
                                        exceptions.map((item) => (
                                            <Table.Tr key={item.id} className="hover:bg-muted/20">
                                                <Table.Td className="font-semibold text-foreground">{item.action}</Table.Td>
                                                <Table.Td>
                                                    <Badge variant="secondary" className={item.severity === "ERROR" ? "border-rose-100 bg-rose-50 text-rose-600" : "border-amber-100 bg-amber-50 text-amber-600"}>
                                                        {SEVERITY_LABELS[item.severity] ?? item.severity}
                                                    </Badge>
                                                </Table.Td>
                                                <Table.Td className="text-muted-foreground">{item.invoiceId || "-"}</Table.Td>
                                                <Table.Td className="max-w-xs truncate text-sm">{item.message || "-"}</Table.Td>
                                                <Table.Td className="text-sm text-muted-foreground">{formatDate(item.createdAt)}</Table.Td>
                                            </Table.Tr>
                                        ))
                                    ) : (
                                        <Table.Tr>
                                            <Table.Td colSpan={5} className="py-16 text-center">
                                                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                                                    <IconCheck size={36} className="text-leaf-600 opacity-60" />
                                                    <p className="text-sm font-semibold text-foreground">ไม่มีรายการผิดพลาด</p>
                                                    <p className="text-sm">ระบบทำงานปกติ</p>
                                                </div>
                                            </Table.Td>
                                        </Table.Tr>
                                    )
                                ) : filteredInvoices.length > 0 ? (
                                    filteredInvoices.map((invoice) => (
                                        <Table.Tr key={invoice.id} className="hover:bg-muted/10">
                                            <Table.Td>
                                                <p className="font-bold leading-tight text-foreground">{invoice.invoiceNumber}</p>
                                                <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">{invoice.applicationNumber}</p>
                                            </Table.Td>
                                            <Table.Td className="text-sm font-medium">{invoice.healthName}</Table.Td>
                                            <Table.Td className="text-right font-semibold tabular-nums text-foreground">{formatCurrency(invoice.amount)}</Table.Td>
                                            <Table.Td>{getStatusBadge(normalizeInvoiceStatus(invoice))}</Table.Td>
                                            <Table.Td>
                                                <p className="text-sm font-medium">{formatDate(invoice.dueDate)}</p>
                                                {invoice.paidAt && <p className="text-[10px] font-bold text-leaf-700">ชำระเมื่อ: {formatDate(invoice.paidAt)}</p>}
                                            </Table.Td>
                                            <Table.Td className="text-center">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => setSelectedInvoice(invoice)}
                                                    aria-label="ดูรายละเอียดใบแจ้งหนี้"
                                                    // X4-FIX-D H-10 — invoice ดู (eye) icon-button bumped from
                                                    // 32×32 to 44×44 per WCAG 2.5.5.
                                                    className="min-h-[44px] min-w-[44px] rounded-lg p-0"
                                                >
                                                    <IconEye size={18} />
                                                </Button>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))
                                ) : (
                                    <Table.Tr>
                                        <Table.Td colSpan={6} className="py-20 text-center">
                                            <div className="flex flex-col items-center justify-center text-muted-foreground">
                                                <IconFileText size={48} className="mb-4 opacity-20" />
                                                <p className="text-sm font-semibold text-foreground">ยังไม่มีรายการในช่วงนี้</p>
                                                <p className="text-sm">ลองเปลี่ยนแท็บด้านบนหรือรีเฟรชข้อมูล</p>
                                            </div>
                                        </Table.Td>
                                    </Table.Tr>
                                )}
                            </Table.Tbody>
                        </Table>
                    </div>
                </div>
            </div>

            <InvoiceDetailModal
                invoice={selectedInvoice}
                onClose={() => setSelectedInvoice(null)}
                onRefresh={fetchData}
                formatCurrency={formatCurrency}
                formatDate={formatDate}
                getStatusBadge={getStatusBadge}
                // hold/release: RECEIPT_ISSUE + the backend side guard — P cannot
                // touch a legacy state-fee invoice (fix round 1, 2026-09-27)
                canHold={canHoldInvoice(user?.role, selectedInvoice?.issuerSide)}
                canRefund={canRefund}
            />

        </ProviderLayout>
    );
}
