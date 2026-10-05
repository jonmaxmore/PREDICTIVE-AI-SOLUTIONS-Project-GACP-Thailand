'use client';

import { useCallback, useEffect, useState } from 'react';
import { IconDownload, IconPrinter, IconRefresh } from '@tabler/icons-react';
import { Button } from '@/components/ui/primitives/button';
import { Table } from '@/components/ui/primitives/table';
import { PageToolbar, FilterBar, FilterField } from '@/components/finance';
import {
    AccountingService,
    FALLBACK_CHART_OF_ACCOUNTS,
    firstOfMonthIso,
    formatTHB,
    formatThaiDate,
    todayIso,
    type AccountSummary,
    type GLResponse,
} from '@/lib/services/accounting-service';

/**
 * สมุดบัญชีแยกประเภท (General Ledger) — every posting against
 * one account in date order, with a running balance after each
 * entry. The account selector is populated from the chart of
 * accounts; if the backend endpoint isn't ready we fall back to
 * the hardcoded list shipped with accounting-service.ts.
 */
export function GeneralLedgerViewer() {
    const [accounts, setAccounts] = useState<AccountSummary[]>(FALLBACK_CHART_OF_ACCOUNTS);
    const [accountCode, setAccountCode] = useState<string>(
        FALLBACK_CHART_OF_ACCOUNTS[0]?.accountCode || '',
    );
    const [from, setFrom] = useState<string>(firstOfMonthIso());
    const [to, setTo] = useState<string>(todayIso());
    const [data, setData] = useState<GLResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch chart of accounts once on mount — falls back silently.
    useEffect(() => {
        let cancelled = false;
        AccountingService.getChartOfAccounts()
            .then((rows) => {
                if (!cancelled && rows.length > 0) {
                    setAccounts(rows);
                    // Keep the existing selection if it's still in the list.
                    const firstAccount = rows[0];
                    if (firstAccount && !rows.find((r) => r.accountCode === accountCode)) {
                        setAccountCode(firstAccount.accountCode);
                    }
                }
            })
            .catch(() => {
                /* fallback list already loaded */
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchData = useCallback(async () => {
        if (!accountCode || !from || !to) return;
        setLoading(true);
        setError(null);
        try {
            const res = await AccountingService.getGeneralLedger({ accountCode, from, to });
            setData(res);
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'ไม่สามารถโหลดสมุดบัญชีแยกประเภทได้ กรุณาลองอีกครั้ง',
            );
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [accountCode, from, to]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleDownloadCsv = () => {
        if (typeof window === 'undefined') return;
        const url = AccountingService.generalLedgerCsvUrl({ accountCode, from, to });
        window.location.href = url;
    };

    const handlePrint = () => {
        if (typeof window === 'undefined') return;
        window.print();
    };

    return (
        <div className="space-y-4">
            <PageToolbar
                eyebrow="รายงาน"
                title="สมุดบัญชีแยกประเภท"
                subtitle={`General Ledger · บัญชี ${accountCode} · ${from} ถึง ${to}`}
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
                <FilterField label="บัญชี" htmlFor="gl-account">
                    <select
                        id="gl-account"
                        value={accountCode}
                        onChange={(e) => setAccountCode(e.target.value)}
                        className="h-10 min-w-[260px] rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                        {accounts.map((acc) => (
                            <option key={acc.accountCode} value={acc.accountCode}>
                                {acc.accountCode} — {acc.accountNameTh}
                            </option>
                        ))}
                    </select>
                </FilterField>
                <FilterField label="ตั้งแต่" htmlFor="gl-from">
                    <input
                        id="gl-from"
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </FilterField>
                <FilterField label="ถึง" htmlFor="gl-to">
                    <input
                        id="gl-to"
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        className="h-10 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </FilterField>
            </FilterBar>

            <div className="hidden print:block">
                <h1 className="text-xl font-bold">สมุดบัญชีแยกประเภท</h1>
                <p className="text-sm">
                    บัญชี {accountCode} {data?.accountNameTh ?? ''}
                </p>
                <p className="text-sm">
                    ตั้งแต่ {from} ถึง {to}
                </p>
            </div>

            {loading ? <LoadingSkeleton /> : null}
            {error ? <ErrorPanel message={error} onRetry={fetchData} /> : null}
            {!loading && !error && data && data.entries.length === 0 ? <EmptyState /> : null}

            {!loading && !error && data && data.entries.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                    <div className="border-b border-border bg-muted/20 px-4 py-3 text-sm">
                        <span className="font-semibold">บัญชี {data.accountCode}</span>
                        <span className="mx-2 text-muted-foreground">|</span>
                        <span>{data.accountNameTh}</span>
                        <span className="mx-2 text-muted-foreground">|</span>
                        <span
                            title="ยอดยกมา (Opening Balance) = ยอดคงเหลือของบัญชีก่อนวันที่เริ่มต้นของช่วงเวลานี้"
                            className="cursor-help"
                        >
                            ยอดยกมา (Opening):{' '}
                            <span className="font-mono tabular-nums">
                                {formatTHB(data.openingBalance, false)}
                            </span>
                        </span>
                    </div>
                    <div className="overflow-x-auto">
                        <Table>
                            <Table.Thead className="bg-muted/30">
                                <Table.Tr>
                                    <Table.Th className="font-bold">วันที่</Table.Th>
                                    <Table.Th className="font-bold">เลขที่อ้างอิง</Table.Th>
                                    <Table.Th className="font-bold">รายละเอียด</Table.Th>
                                    <Table.Th className="text-right font-bold">เดบิต</Table.Th>
                                    <Table.Th className="text-right font-bold">เครดิต</Table.Th>
                                    <Table.Th className="text-right font-bold">ยอดคงเหลือ</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {data.entries.map((entry, idx) => (
                                    <Table.Tr
                                        key={`${entry.date}-${entry.referenceNo}-${idx}`}
                                        className="hover:bg-muted/10"
                                    >
                                        <Table.Td className="text-sm">
                                            {formatThaiDate(entry.date)}
                                        </Table.Td>
                                        <Table.Td className="font-mono text-xs">
                                            {entry.referenceNo}
                                        </Table.Td>
                                        <Table.Td className="text-sm">{entry.description}</Table.Td>
                                        <Table.Td className="text-right text-sm tabular-nums">
                                            {entry.debit > 0 ? formatTHB(entry.debit, false) : '-'}
                                        </Table.Td>
                                        <Table.Td className="text-right text-sm tabular-nums">
                                            {entry.credit > 0
                                                ? formatTHB(entry.credit, false)
                                                : '-'}
                                        </Table.Td>
                                        <Table.Td className="text-right text-sm font-medium tabular-nums">
                                            {formatTHB(entry.balance, false)}
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                                <Table.Tr className="border-t-2 border-foreground/20 bg-muted/40 font-bold">
                                    <Table.Td
                                        colSpan={5}
                                        className="text-right"
                                        title="ยอดคงเหลือยกไป (Closing Balance) = ยอดสุทธิหลังบันทึกรายการในช่วงนี้ทั้งหมด ซึ่งจะกลายเป็นยอดยกมาของงวดถัดไป"
                                    >
                                        ยอดคงเหลือยกไป (Closing)
                                    </Table.Td>
                                    <Table.Td className="text-right tabular-nums">
                                        {formatTHB(data.closingBalance, false)}
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
            <p className="mt-1 text-sm">ลองเลือกบัญชีอื่นหรือขยายช่วงวันที่</p>
        </div>
    );
}
