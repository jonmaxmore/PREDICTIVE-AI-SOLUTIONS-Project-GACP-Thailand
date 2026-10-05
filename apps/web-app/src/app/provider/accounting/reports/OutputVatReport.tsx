'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconAlertTriangle, IconCheck, IconDownload, IconPrinter, IconRefresh } from '@tabler/icons-react';
import { Button } from '@/components/ui/primitives/button';
import { Table } from '@/components/ui/primitives/table';
import { PageToolbar, FilterBar, FilterField } from '@/components/finance';
import {
    AccountingService,
    formatTHB,
    formatThaiDate,
    type VATResponse,
} from '@/lib/services/accounting-service';

const THAI_MONTH_NAMES = [
    'มกราคม',
    'กุมภาพันธ์',
    'มีนาคม',
    'เมษายน',
    'พฤษภาคม',
    'มิถุนายน',
    'กรกฎาคม',
    'สิงหาคม',
    'กันยายน',
    'ตุลาคม',
    'พฤศจิกายน',
    'ธันวาคม',
];

/**
 * รายงานภาษีขาย (ภ.พ.30) — line-item Output VAT register for a
 * single calendar month. Period-closable indicator tells the
 * finance team whether the period is ready to close.
 * The yellow callout reminds them of the RD's 15th-of-next-month
 * filing deadline.
 */
export function OutputVatReport() {
    const now = useMemo(() => new Date(), []);
    const [year, setYear] = useState<number>(now.getFullYear());
    const [month, setMonth] = useState<number>(now.getMonth() + 1);
    const [data, setData] = useState<VATResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await AccountingService.getOutputVatReport({ year, month });
            setData(res);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'ไม่สามารถโหลดรายงานภาษีขายได้ กรุณาลองอีกครั้ง',
            );
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [year, month]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleDownloadCsv = () => {
        if (typeof window === 'undefined') return;
        const url = AccountingService.outputVatCsvUrl({ year, month });
        window.location.href = url;
    };

    const handlePrint = () => {
        if (typeof window === 'undefined') return;
        window.print();
    };

    // Year options: current year and the four years prior.
    const yearOptions: number[] = [];
    for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y -= 1) {
        yearOptions.push(y);
    }

    return (
        <div className="space-y-4">
            <PageToolbar
                eyebrow="รายงานภาษีขาย"
                title="รายงานภาษีขาย (ภ.พ.30)"
                subtitle={`Output VAT · เดือน ${THAI_MONTH_NAMES[month - 1]} ${year}`}
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
                        description: 'พิมพ์ในรูปแบบ A4 (สำหรับยื่นกรมสรรพากร)',
                        icon: <IconPrinter className="h-4 w-4" />,
                        onClick: handlePrint,
                        variant: 'outline',
                        disabled: !data || loading,
                    },
                ]}
            />

            <FilterBar onApply={fetchData} applyDisabled={loading}>
                <FilterField label="เดือน" htmlFor="vat-month">
                    <select
                        id="vat-month"
                        value={month}
                        onChange={(e) => setMonth(Number(e.target.value))}
                        className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                        {THAI_MONTH_NAMES.map((name, idx) => (
                            <option key={idx + 1} value={idx + 1}>
                                {name}
                            </option>
                        ))}
                    </select>
                </FilterField>
                <FilterField label="ปี (ค.ศ.)" htmlFor="vat-year">
                    <select
                        id="vat-year"
                        value={year}
                        onChange={(e) => setYear(Number(e.target.value))}
                        className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                        {yearOptions.map((y) => (
                            <option key={y} value={y}>
                                {y}
                            </option>
                        ))}
                    </select>
                </FilterField>
            </FilterBar>

            {/* Compliance reminder — always visible. */}
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 print:bg-white">
                <p className="text-sm font-bold text-amber-900">
                    ต้องยื่นภายในวันที่ ๑๕ ของเดือนถัดไป
                </p>
                <p className="mt-1 text-xs text-amber-800">
                    ตามมาตรา ๘๓ แห่งประมวลรัษฎากร ผู้ประกอบการต้องยื่นแบบ ภ.พ.๓๐ ภายในวันที่ ๑๕ ของเดือนถัดจากเดือนภาษี
                </p>
            </div>

            <div className="hidden print:block">
                <h1 className="text-xl font-bold">รายงานภาษีขาย (ภ.พ.30)</h1>
                <p className="text-sm">
                    เดือน {THAI_MONTH_NAMES[month - 1]} {year}
                </p>
            </div>

            {loading ? <LoadingSkeleton /> : null}
            {error ? <ErrorPanel message={error} onRetry={fetchData} /> : null}

            {!loading && !error && data ? (
                <>
                    {/* Period-closable badge */}
                    <div
                        className={`flex items-start gap-2 rounded-lg border p-4 ${
                            data.periodClosable
                                ? 'border-leaf-300 bg-leaf-soft text-leaf-onSoft'
                                : 'border-amber-200 bg-amber-50 text-amber-800'
                        } print:bg-white`}
                    >
                        {data.periodClosable ? (
                            <IconCheck size={20} className="mt-0.5" />
                        ) : (
                            <IconAlertTriangle size={20} className="mt-0.5" />
                        )}
                        <div className="flex-1">
                            <p className="text-sm font-bold">
                                {data.periodClosable ? 'ปิดงวดได้' : 'ยังมีรายการค้าง'}
                            </p>
                            {data.warnings.length > 0 ? (
                                <ul className="mt-1 list-disc pl-5 text-xs">
                                    {data.warnings.map((w, idx) => (
                                        <li key={idx}>{w}</li>
                                    ))}
                                </ul>
                            ) : null}
                        </div>
                    </div>

                    {data.lines.length === 0 ? (
                        <EmptyState />
                    ) : (
                        <div className="overflow-hidden rounded-lg border border-border bg-card">
                            <div className="overflow-x-auto">
                                <Table>
                                    <Table.Thead className="bg-muted/30">
                                        <Table.Tr>
                                            <Table.Th className="font-bold">วันที่</Table.Th>
                                            <Table.Th className="font-bold">เลขที่ใบกำกับ</Table.Th>
                                            <Table.Th className="font-bold">ผู้ซื้อ</Table.Th>
                                            <Table.Th className="font-bold">
                                                เลขผู้เสียภาษีผู้ซื้อ
                                            </Table.Th>
                                            <Table.Th className="text-right font-bold">
                                                มูลค่าสินค้า/บริการ
                                            </Table.Th>
                                            <Table.Th className="text-right font-bold">
                                                จำนวนภาษี
                                            </Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {data.lines.map((line, idx) => (
                                            <Table.Tr
                                                key={`${line.taxInvoiceNo}-${idx}`}
                                                className="hover:bg-muted/10"
                                            >
                                                <Table.Td className="text-sm">
                                                    {formatThaiDate(line.date)}
                                                </Table.Td>
                                                <Table.Td className="font-mono text-xs">
                                                    {line.taxInvoiceNo}
                                                </Table.Td>
                                                <Table.Td className="text-sm">
                                                    {line.buyerName}
                                                </Table.Td>
                                                <Table.Td className="font-mono text-xs">
                                                    {line.buyerTaxId || '-'}
                                                </Table.Td>
                                                <Table.Td className="text-right text-sm tabular-nums">
                                                    {formatTHB(line.netAmount, false)}
                                                </Table.Td>
                                                <Table.Td className="text-right text-sm tabular-nums">
                                                    {formatTHB(line.vatAmount, false)}
                                                </Table.Td>
                                            </Table.Tr>
                                        ))}
                                        <Table.Tr className="border-t-2 border-foreground/20 bg-muted/40 font-bold">
                                            <Table.Td colSpan={4} className="text-right">
                                                ยอดรวม
                                            </Table.Td>
                                            <Table.Td className="text-right tabular-nums">
                                                {formatTHB(data.totals.netAmount, false)}
                                            </Table.Td>
                                            <Table.Td className="text-right tabular-nums">
                                                {formatTHB(data.totals.vatAmount, false)}
                                            </Table.Td>
                                        </Table.Tr>
                                    </Table.Tbody>
                                </Table>
                            </div>
                        </div>
                    )}
                </>
            ) : null}
        </div>
    );
}

function LoadingSkeleton() {
    return (
        <div className="space-y-2 rounded-lg border border-border bg-card p-6 print:hidden">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        </div>
    );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-6 text-rose-700 print:hidden">
            <p className="text-sm font-semibold">{message}</p>
            <Button variant="outline" size="sm" onClick={onRetry} className="rounded-xl">
                ลองอีกครั้ง
            </Button>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-10 text-center text-muted-foreground">
            <p className="text-lg font-medium">ยังไม่มีรายการในช่วงเวลานี้</p>
            <p className="mt-1 text-sm">เมื่อมีใบกำกับภาษีในเดือนที่เลือก ข้อมูลจะมาแสดงที่นี่</p>
        </div>
    );
}
