'use client';

import { useCallback, useEffect, useState } from 'react';
import { IconDownload, IconPrinter, IconRefresh, IconAlertTriangle } from '@tabler/icons-react';
import { Table } from '@/components/ui/primitives/table';
import { PageToolbar, FilterBar, FilterField } from '@/components/finance';
import { Button } from '@/components/ui/primitives/button';
import {
    AccountingService,
    formatTHB,
    todayIso,
    type TrialBalanceResponse,
    type AccountCategory,
} from '@/lib/services/accounting-service';

const CATEGORY_LABELS: Record<AccountCategory, string> = {
    ASSET: 'สินทรัพย์',
    LIABILITY: 'หนี้สิน',
    EQUITY: 'ส่วนของผู้ถือหุ้น',
    REVENUE: 'รายได้',
    EXPENSE: 'ค่าใช้จ่าย',
};

const CATEGORY_ORDER: AccountCategory[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

/**
 * งบทดลอง (Trial Balance) — list every account with its closing
 * debit / credit balance as of a given date. The two totals at
 * the bottom MUST match; a red warning is shown if they don't.
 */
export function TrialBalanceTable() {
    const [asOfDate, setAsOfDate] = useState<string>(todayIso());
    const [data, setData] = useState<TrialBalanceResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await AccountingService.getTrialBalance({ asOfDate });
            setData(res);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'ไม่สามารถโหลดงบทดลองได้ กรุณาลองอีกครั้ง',
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
        const url = AccountingService.trialBalanceCsvUrl({ asOfDate });
        window.location.href = url;
    };

    const handlePrint = () => {
        if (typeof window === 'undefined') return;
        window.print();
    };

    // Group rows by accounting category for readability.
    const grouped = data
        ? CATEGORY_ORDER.map((cat) => ({
              category: cat,
              rows: data.rows.filter((r) => r.category === cat),
          })).filter((g) => g.rows.length > 0)
        : [];

    const isBalanced = data?.totals.isBalanced ?? false;

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <PageToolbar
                eyebrow="รายงาน"
                title="งบทดลอง"
                subtitle={`Trial Balance · ณ วันที่ ${asOfDate}`}
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

            {/* Filter — date picker */}
            <FilterBar onApply={fetchData} applyDisabled={loading}>
                <FilterField label="ณ วันที่" htmlFor="tb-as-of-date">
                    <input
                        id="tb-as-of-date"
                        type="date"
                        value={asOfDate}
                        onChange={(e) => setAsOfDate(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </FilterField>
            </FilterBar>

            {/* Header for print */}
            <div className="hidden print:block">
                <h1 className="text-xl font-bold">งบทดลอง (Trial Balance)</h1>
                <p className="text-sm">ณ วันที่ {asOfDate}</p>
            </div>

            {/* Status panels */}
            {loading ? <LoadingSkeleton /> : null}
            {error ? <ErrorPanel message={error} onRetry={fetchData} /> : null}

            {!loading && !error && data && data.rows.length === 0 ? (
                <EmptyState />
            ) : null}

            {!loading && !error && data && data.rows.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                    {!isBalanced ? (
                        <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 print:bg-white">
                            <IconAlertTriangle size={18} />
                            ยอดเดบิตไม่เท่ากับยอดเครดิต กรุณาตรวจสอบรายการบัญชี
                        </div>
                    ) : null}

                    <div className="overflow-x-auto">
                        <Table>
                            <Table.Thead className="bg-muted/30">
                                <Table.Tr>
                                    <Table.Th className="font-bold">หมวดบัญชี</Table.Th>
                                    <Table.Th className="font-bold">รหัสบัญชี</Table.Th>
                                    <Table.Th className="font-bold">ชื่อบัญชี</Table.Th>
                                    <Table.Th className="text-right font-bold">เดบิต</Table.Th>
                                    <Table.Th className="text-right font-bold">เครดิต</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {grouped.map((group) => (
                                    <RowGroup
                                        key={group.category}
                                        categoryLabel={CATEGORY_LABELS[group.category]}
                                        rows={group.rows}
                                    />
                                ))}
                                <Table.Tr className="border-t-2 border-foreground/20 bg-muted/40 font-bold">
                                    <Table.Td colSpan={3} className="text-right">
                                        ยอดรวม
                                    </Table.Td>
                                    <Table.Td className="text-right tabular-nums">
                                        {formatTHB(data.totals.debit, false)}
                                    </Table.Td>
                                    <Table.Td className="text-right tabular-nums">
                                        {formatTHB(data.totals.credit, false)}
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

function RowGroup({
    categoryLabel,
    rows,
}: {
    categoryLabel: string;
    rows: Array<{
        accountCode: string;
        accountNameTh: string;
        debit: number;
        credit: number;
    }>;
}) {
    return (
        <>
            {rows.map((row, idx) => (
                <Table.Tr key={row.accountCode} className="hover:bg-muted/10">
                    <Table.Td className="text-sm text-muted-foreground">
                        {idx === 0 ? categoryLabel : ''}
                    </Table.Td>
                    <Table.Td className="font-mono text-xs">{row.accountCode}</Table.Td>
                    <Table.Td className="text-sm">{row.accountNameTh}</Table.Td>
                    <Table.Td className="text-right text-sm tabular-nums">
                        {row.debit > 0 ? formatTHB(row.debit, false) : '-'}
                    </Table.Td>
                    <Table.Td className="text-right text-sm tabular-nums">
                        {row.credit > 0 ? formatTHB(row.credit, false) : '-'}
                    </Table.Td>
                </Table.Tr>
            ))}
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
            <p className="mt-1 text-sm">เมื่อมีการบันทึกบัญชีในงวดนี้ ข้อมูลจะมาแสดงที่นี่</p>
        </div>
    );
}
