'use client';

import { useCallback, useEffect, useState } from 'react';
import { IconDownload, IconPrinter, IconRefresh } from '@tabler/icons-react';
import { Button } from '@/components/ui/primitives/button';
import { Table } from '@/components/ui/primitives/table';
import { PageToolbar, FilterBar, FilterField } from '@/components/finance';
import {
    AccountingService,
    firstOfMonthIso,
    formatTHB,
    todayIso,
    type PLResponse,
} from '@/lib/services/accounting-service';

/**
 * งบกำไรขาดทุน (Profit and Loss Statement) — revenue minus
 * expenses for a given period. The bottom row "กำไร(ขาดทุน)สุทธิ"
 * is green when positive, red when negative.
 */
export function ProfitAndLossStatement() {
    const [from, setFrom] = useState<string>(firstOfMonthIso());
    const [to, setTo] = useState<string>(todayIso());
    const [data, setData] = useState<PLResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        if (!from || !to) return;
        setLoading(true);
        setError(null);
        try {
            const res = await AccountingService.getProfitAndLoss({ from, to });
            setData(res);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'ไม่สามารถโหลดงบกำไรขาดทุนได้ กรุณาลองอีกครั้ง',
            );
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [from, to]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleDownloadCsv = () => {
        if (typeof window === 'undefined') return;
        const url = AccountingService.profitAndLossCsvUrl({ from, to });
        window.location.href = url;
    };

    const handlePrint = () => {
        if (typeof window === 'undefined') return;
        window.print();
    };

    const isProfit = data && data.netProfit >= 0;

    return (
        <div className="space-y-4">
            <PageToolbar
                eyebrow="รายงาน"
                title="งบกำไรขาดทุน"
                subtitle={`Profit & Loss · งวด ${from} ถึง ${to}`}
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
                        description: 'พิมพ์ในรูปแบบ A4',
                        icon: <IconPrinter className="h-4 w-4" />,
                        onClick: handlePrint,
                        variant: 'outline',
                        disabled: !data || loading,
                    },
                ]}
            />

            <FilterBar onApply={fetchData} applyDisabled={loading}>
                <FilterField label="ตั้งแต่วันที่" htmlFor="pl-from">
                    <input
                        id="pl-from"
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </FilterField>
                <FilterField label="ถึงวันที่" htmlFor="pl-to">
                    <input
                        id="pl-to"
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </FilterField>
            </FilterBar>

            <div className="hidden print:block">
                <h1 className="text-xl font-bold">งบกำไรขาดทุน (Profit and Loss)</h1>
                <p className="text-sm">
                    สำหรับงวด {from} ถึง {to}
                </p>
            </div>

            {loading ? <LoadingSkeleton /> : null}
            {error ? <ErrorPanel message={error} onRetry={fetchData} /> : null}
            {!loading
            && !error
            && data
            && data.revenue.lines.length === 0
            && data.expenses.lines.length === 0 ? (
                <EmptyState />
            ) : null}

            {!loading && !error && data && (data.revenue.lines.length > 0 || data.expenses.lines.length > 0) ? (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <div className="overflow-x-auto">
                        <Table>
                            {/* รายได้ */}
                            <Table.Thead className="bg-leaf-soft/60">
                                <Table.Tr>
                                    <Table.Th
                                        colSpan={2}
                                        className="text-base font-bold text-leaf-700"
                                    >
                                        รายได้
                                    </Table.Th>
                                    <Table.Th className="text-right font-bold">จำนวนเงิน</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {data.revenue.lines.map((line) => (
                                    <Table.Tr key={line.accountCode} className="hover:bg-muted/10">
                                        <Table.Td className="font-mono text-xs">
                                            {line.accountCode}
                                        </Table.Td>
                                        <Table.Td>{line.accountNameTh}</Table.Td>
                                        <Table.Td className="text-right tabular-nums">
                                            {formatTHB(line.amount, false)}
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                                <Table.Tr className="border-t border-leaf-300 bg-leaf-soft/30 font-semibold">
                                    <Table.Td colSpan={2} className="text-right">
                                        รวมรายได้
                                    </Table.Td>
                                    <Table.Td className="text-right tabular-nums text-leaf-700">
                                        {formatTHB(data.revenue.total, false)}
                                    </Table.Td>
                                </Table.Tr>
                            </Table.Tbody>

                            {/* ค่าใช้จ่าย */}
                            <Table.Thead className="bg-rose-50/40">
                                <Table.Tr>
                                    <Table.Th
                                        colSpan={2}
                                        className="text-base font-bold text-rose-700"
                                    >
                                        ค่าใช้จ่าย
                                    </Table.Th>
                                    <Table.Th className="text-right font-bold">จำนวนเงิน</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {data.expenses.lines.map((line) => (
                                    <Table.Tr key={line.accountCode} className="hover:bg-muted/10">
                                        <Table.Td className="font-mono text-xs">
                                            {line.accountCode}
                                        </Table.Td>
                                        <Table.Td>{line.accountNameTh}</Table.Td>
                                        <Table.Td className="text-right tabular-nums">
                                            {formatTHB(line.amount, false)}
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                                <Table.Tr className="border-t border-rose-200 bg-rose-50/30 font-semibold">
                                    <Table.Td colSpan={2} className="text-right">
                                        รวมค่าใช้จ่าย
                                    </Table.Td>
                                    <Table.Td className="text-right tabular-nums text-rose-700">
                                        {formatTHB(data.expenses.total, false)}
                                    </Table.Td>
                                </Table.Tr>

                                {/* กำไร(ขาดทุน)สุทธิ */}
                                <Table.Tr
                                    className={`border-t-2 border-foreground/30 ${
                                        isProfit
                                            ? 'bg-leaf-soft text-leaf-onSoft'
                                            : 'bg-rose-50 text-rose-700'
                                    } font-bold`}
                                >
                                    <Table.Td colSpan={2} className="text-right text-base">
                                        กำไร(ขาดทุน)สุทธิ
                                    </Table.Td>
                                    <Table.Td className="text-right text-base tabular-nums">
                                        {formatTHB(data.netProfit, false)}
                                    </Table.Td>
                                </Table.Tr>
                            </Table.Tbody>
                        </Table>
                    </div>
                </div>
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
            <p className="mt-1 text-sm">เมื่อมีการบันทึกรายได้และค่าใช้จ่ายในงวดนี้ ข้อมูลจะมาแสดงที่นี่</p>
        </div>
    );
}
