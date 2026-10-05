'use client';

import { useCallback, useEffect, useState } from 'react';
import { IconAlertTriangle, IconDownload, IconPrinter, IconRefresh } from '@tabler/icons-react';
import { Button } from '@/components/ui/primitives/button';
import { Table } from '@/components/ui/primitives/table';
import { PageToolbar, FilterBar, FilterField } from '@/components/finance';
import {
    AccountingService,
    formatTHB,
    todayIso,
    type BSResponse,
    type BSLineItem,
} from '@/lib/services/accounting-service';

/**
 * งบดุล (Balance Sheet) — Assets = Liabilities + Equity at a
 * point in time. We render three sections and the accounting
 * equation check at the bottom. A red warning is shown if the
 * equation doesn't hold.
 */
export function BalanceSheetStatement() {
    const [asOfDate, setAsOfDate] = useState<string>(todayIso());
    const [data, setData] = useState<BSResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await AccountingService.getBalanceSheet({ asOfDate });
            setData(res);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'ไม่สามารถโหลดงบดุลได้ กรุณาลองอีกครั้ง',
            );
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [asOfDate]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleDownloadCsv = () => {
        if (typeof window === 'undefined') return;
        const url = AccountingService.balanceSheetCsvUrl({ asOfDate });
        window.location.href = url;
    };

    const handlePrint = () => {
        if (typeof window === 'undefined') return;
        window.print();
    };

    const isBalanced = data?.isBalanced ?? false;

    return (
        <div className="space-y-4">
            <PageToolbar
                eyebrow="รายงาน"
                title="งบดุล"
                subtitle={`Balance Sheet · ณ วันที่ ${asOfDate}`}
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
                <FilterField label="ณ วันที่" htmlFor="bs-as-of-date">
                    <input
                        id="bs-as-of-date"
                        type="date"
                        value={asOfDate}
                        onChange={(e) => setAsOfDate(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </FilterField>
            </FilterBar>

            <div className="hidden print:block">
                <h1 className="text-xl font-bold">งบดุล (Balance Sheet)</h1>
                <p className="text-sm">ณ วันที่ {asOfDate}</p>
            </div>

            {loading ? <LoadingSkeleton /> : null}
            {error ? <ErrorPanel message={error} onRetry={fetchData} /> : null}
            {!loading
            && !error
            && data
            && data.assets.lines.length === 0
            && data.liabilities.lines.length === 0
            && data.equity.lines.length === 0 ? (
                <EmptyState />
            ) : null}

            {!loading && !error && data ? (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                    {!isBalanced ? (
                        <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 print:bg-white">
                            <IconAlertTriangle size={18} />
                            ยอดรวมหนี้สินและส่วนของผู้ถือหุ้นไม่เท่ากับยอดรวมสินทรัพย์
                        </div>
                    ) : null}

                    <div className="overflow-x-auto">
                        <Table>
                            <SectionRows
                                title="สินทรัพย์"
                                tone="indigo"
                                lines={data.assets.lines}
                                total={data.assets.total}
                                totalLabel="รวมสินทรัพย์"
                            />
                            <SectionRows
                                title="หนี้สิน"
                                tone="rose"
                                lines={data.liabilities.lines}
                                total={data.liabilities.total}
                                totalLabel="รวมหนี้สิน"
                            />
                            <SectionRows
                                title="ส่วนของผู้ถือหุ้น"
                                tone="teal"
                                lines={data.equity.lines}
                                total={data.equity.total}
                                totalLabel="รวมส่วนของผู้ถือหุ้น"
                            />
                            {/* Accounting equation footer */}
                            <Table.Tbody>
                                <Table.Tr
                                    className={`border-t-2 border-foreground/30 ${
                                        isBalanced
                                            ? 'bg-leaf-soft text-leaf-onSoft'
                                            : 'bg-rose-50 text-rose-700'
                                    } font-bold`}
                                >
                                    <Table.Td colSpan={2} className="text-right text-base">
                                        ยอดรวมหนี้สินและส่วนของผู้ถือหุ้น
                                    </Table.Td>
                                    <Table.Td className="text-right text-base tabular-nums">
                                        {formatTHB(data.totalLiabilitiesAndEquity, false)}
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

function SectionRows({
    title,
    tone,
    lines,
    total,
    totalLabel,
}: {
    title: string;
    tone: 'indigo' | 'rose' | 'teal';
    lines: BSLineItem[];
    total: number;
    totalLabel: string;
}) {
    const headerCls = {
        indigo: 'bg-indigo-50/60 text-indigo-700',
        rose: 'bg-rose-50/40 text-rose-700',
        teal: 'bg-muted/40 text-primary',
    }[tone];

    const footerCls = {
        indigo: 'border-t border-indigo-200 bg-indigo-50/30 text-indigo-700',
        rose: 'border-t border-rose-200 bg-rose-50/30 text-rose-700',
        teal: 'border-t border-border bg-muted/30 text-primary',
    }[tone];

    return (
        <>
            <Table.Thead className={headerCls}>
                <Table.Tr>
                    <Table.Th colSpan={2} className="text-base font-bold">
                        {title}
                    </Table.Th>
                    <Table.Th className="text-right font-bold">จำนวนเงิน</Table.Th>
                </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
                {lines.length > 0 ? (
                    lines.map((line) => (
                        <Table.Tr key={line.accountCode} className="hover:bg-muted/10">
                            <Table.Td className="font-mono text-xs">{line.accountCode}</Table.Td>
                            <Table.Td>{line.accountNameTh}</Table.Td>
                            <Table.Td className="text-right tabular-nums">
                                {formatTHB(line.amount, false)}
                            </Table.Td>
                        </Table.Tr>
                    ))
                ) : (
                    <Table.Tr>
                        <Table.Td colSpan={3} className="py-3 text-center text-sm text-muted-foreground">
                            ไม่มีรายการในหมวดนี้
                        </Table.Td>
                    </Table.Tr>
                )}
                <Table.Tr className={`${footerCls} font-semibold`}>
                    <Table.Td colSpan={2} className="text-right">
                        {totalLabel}
                    </Table.Td>
                    <Table.Td className="text-right tabular-nums">
                        {formatTHB(total, false)}
                    </Table.Td>
                </Table.Tr>
            </Table.Tbody>
        </>
    );
}

function LoadingSkeleton() {
    return (
        <div className="space-y-2 rounded-lg border border-border bg-card p-6 print:hidden">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
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
            <p className="mt-1 text-sm">เมื่อมีการบันทึกบัญชี ข้อมูลงบดุลจะมาแสดงที่นี่</p>
        </div>
    );
}
