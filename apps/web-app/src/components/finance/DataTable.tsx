'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * DataTable — FlowAccount-style finance data table.
 *
 * Thin wrapper over a plain HTML table that enforces:
 *   • column types (link/text/date/money/status/custom),
 *   • automatic right-alignment for money columns,
 *   • subtle hover row state,
 *   • a Thai empty state.
 *
 * The component intentionally stays presentational — sorting,
 * pagination, and filtering live in the page's state. This keeps
 * the contract simple for reuse across slip queue, invoice list,
 * AR aging, etc.
 */

export type DataColumnAlign = 'left' | 'right' | 'center';

export type DataColumn<T> = {
    /** Stable key used for React reconciliation. */
    key: string;
    /** Header text in Thai. */
    header: string;
    /** Column kind — controls default alignment and styling. */
    type?: 'link' | 'text' | 'date' | 'money' | 'status' | 'custom';
    /** Override alignment. Otherwise derived from `type`. */
    align?: DataColumnAlign;
    /** Cell renderer. Receives the row and returns JSX. */
    render: (row: T, idx: number) => React.ReactNode;
    /** Width hint passed to the th (e.g. "w-32"). */
    widthClass?: string;
    /** Hide on mobile (≤ md). */
    mobileHidden?: boolean;
    /** Optional header className override. */
    headerClassName?: string;
};

export interface DataTableProps<T> {
    columns: ReadonlyArray<DataColumn<T>>;
    rows: ReadonlyArray<T>;
    /** Unique key extractor. */
    getRowKey: (row: T, idx: number) => string;
    /** Optional row-level className. */
    rowClassName?: (row: T, idx: number) => string | undefined;
    /** Optional row click handler — makes the whole row clickable. */
    onRowClick?: (row: T) => void;
    /** Thai empty-state title. */
    emptyTitle?: string;
    /** Thai empty-state subtitle. */
    emptyDescription?: string;
    /** Optional empty-state icon. */
    emptyIcon?: React.ReactNode;
    /** Loading state — renders a skeleton. */
    loading?: boolean;
    /** Optional footer row content. */
    footer?: React.ReactNode;
    className?: string;
    /** Hide the surrounding card container — useful inside other containers. */
    plain?: boolean;
}

function alignFor<T>(col: DataColumn<T>): DataColumnAlign {
    if (col.align) return col.align;
    if (col.type === 'money') return 'right';
    return 'left';
}

export function DataTable<T>({
    columns,
    rows,
    getRowKey,
    rowClassName,
    onRowClick,
    emptyTitle = 'ไม่พบข้อมูล',
    emptyDescription = 'ยังไม่มีรายการในมุมมองนี้',
    emptyIcon,
    loading = false,
    footer,
    className,
    plain = false,
}: DataTableProps<T>) {
    const colSpan = columns.length;
    const wrapperCls = plain
        ? cn('overflow-x-auto', className)
        : cn(
              'overflow-hidden rounded-lg border border-border bg-card',
              className,
          );

    return (
        <div className={wrapperCls}>
            <div className="overflow-x-auto">
                <table className="min-w-full table-auto text-sm">
                    <thead className="bg-muted/40">
                        <tr className="border-b border-border">
                            {columns.map((col) => {
                                const align = alignFor(col);
                                return (
                                    <th
                                        key={col.key}
                                        className={cn(
                                            // Thai headers: no uppercase / letter-spacing.
                                            'px-4 py-3 text-xs font-semibold text-muted-foreground',
                                            align === 'right' && 'text-right',
                                            align === 'center' && 'text-center',
                                            align === 'left' && 'text-left',
                                            col.mobileHidden && 'hidden md:table-cell',
                                            col.widthClass,
                                            col.headerClassName,
                                        )}
                                        scope="col"
                                    >
                                        {col.header}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {loading ? (
                            <SkeletonRows colSpan={colSpan} />
                        ) : rows.length === 0 ? (
                            <tr>
                                <td colSpan={colSpan} className="py-16 text-center">
                                    <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                        {emptyIcon ? (
                                            <div className="text-muted-foreground/50">{emptyIcon}</div>
                                        ) : null}
                                        <p className="text-sm font-semibold text-foreground">
                                            {emptyTitle}
                                        </p>
                                        <p className="text-sm">{emptyDescription}</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            rows.map((row, idx) => {
                                const extra = rowClassName?.(row, idx);
                                // B4-01 (audit 2026-06-10): a clickable row must be keyboard-
                                // operable (WCAG 2.1.1, Level A). When onRowClick is set, make the
                                // row focusable + activatable by Enter/Space, with a focus ring
                                // (2.4.7). Props are spread so non-clickable rows stay fully inert
                                // (no role/tabIndex/handlers).
                                const interactiveProps = onRowClick
                                    ? {
                                          role: 'button' as const,
                                          tabIndex: 0,
                                          onClick: () => onRowClick(row),
                                          onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                  e.preventDefault();
                                                  onRowClick(row);
                                              }
                                          },
                                      }
                                    : {};
                                return (
                                    <tr
                                        key={getRowKey(row, idx)}
                                        {...interactiveProps}
                                        className={cn(
                                            'transition-colors hover:bg-muted/40',
                                            onRowClick
                                                && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                                            extra,
                                        )}
                                    >
                                        {columns.map((col) => {
                                            const align = alignFor(col);
                                            return (
                                                <td
                                                    key={col.key}
                                                    className={cn(
                                                        'px-4 py-3 align-middle text-sm text-foreground',
                                                        col.type === 'money'
                                                            && 'font-medium tabular-nums',
                                                        align === 'right' && 'text-right',
                                                        align === 'center' && 'text-center',
                                                        align === 'left' && 'text-left',
                                                        col.mobileHidden && 'hidden md:table-cell',
                                                    )}
                                                >
                                                    {col.render(row, idx)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                    {footer ? (
                        <tfoot className="bg-muted/40">{footer}</tfoot>
                    ) : null}
                </table>
            </div>
        </div>
    );
}

function SkeletonRows({ colSpan }: { colSpan: number }) {
    return (
        <>
            {[0, 1, 2, 3].map((row) => (
                <tr key={row} className="border-b border-border">
                    {Array.from({ length: colSpan }).map((_, c) => (
                        <td key={c} className="px-4 py-3">
                            <div className="h-3 w-full animate-pulse rounded bg-muted" />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

/**
 * TableFooter — FlowAccount-style row-count + subtotal footer.
 *
 * Left: row-count selector. Right: subtotal pairs (label + value).
 */
export function TableFooter({
    rowCountOptions = [10, 20, 50, 100],
    rowCount,
    onRowCountChange,
    subtotals = [],
    children,
    className,
}: {
    rowCountOptions?: ReadonlyArray<number>;
    rowCount?: number;
    onRowCountChange?: (next: number) => void;
    subtotals?: ReadonlyArray<{ label: string; value: string }>;
    children?: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                'flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm md:flex-row md:items-center md:justify-between',
                className,
            )}
        >
            <div className="flex items-center gap-2 text-muted-foreground">
                {onRowCountChange ? (
                    <>
                        <span>แสดง</span>
                        <select
                            value={rowCount}
                            onChange={(e) => onRowCountChange(Number(e.target.value))}
                            className="h-8 rounded-lg border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            aria-label="จำนวนแถวต่อหน้า"
                        >
                            {rowCountOptions.map((opt) => (
                                <option key={opt} value={opt}>
                                    {opt}
                                </option>
                            ))}
                        </select>
                        <span>รายการ</span>
                    </>
                ) : (
                    children
                )}
            </div>
            {subtotals.length > 0 ? (
                <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1">
                    {subtotals.map((s, idx) => (
                        <span
                            key={`${s.label}-${idx}`}
                            className="text-xs font-medium text-muted-foreground"
                        >
                            {s.label}{' '}
                            <span className="ml-1 text-sm font-semibold tabular-nums text-foreground">
                                {s.value}
                            </span>
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

export default DataTable;
