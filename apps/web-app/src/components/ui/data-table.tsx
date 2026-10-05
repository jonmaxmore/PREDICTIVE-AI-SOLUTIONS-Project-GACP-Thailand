'use client';

/**
 * DataTable — Wave E.2-D.
 *
 * Reusable table component built on the existing `primitives/table.tsx`.
 * Adds sticky headers, sortable columns, density toggle, dense cell
 * padding, and (PR-2) optional client-side pagination + URL state sync.
 *
 * Design points:
 *
 * - Column definitions are declarative (`ColumnDef<T>[]`). Each column
 *   declares its key, header label, optional `render` callback, and
 *   whether it's sortable + numeric. The component handles the rest.
 *
 * - Sort state is local to the component (`useState`). For server-side
 *   pagination/sort, pass the sorted data in directly and disable
 *   `sortable` per column.
 *
 * - Density is local to the component (default "normal"). The toggle
 *   button is rendered in the top-right of the table card. "compact"
 *   tightens cell padding to 0.3/0.5rem (per the verified 33px/12px
 *   reference family — tight rows for high-density list views).
 *
 * - Sticky header uses `position: sticky; top: 0` on the header row.
 *   The Table.ScrollContainer parent already has overflow:auto, so
 *   stickiness works inside it.
 *
 * - Pagination is OPT-IN: pass `pageSize` to enable it. When unset, all
 *   rows render and the pagination footer is hidden — preserves the
 *   PR-1 behaviour for callers that don't need it.
 *
 * - URL state sync is OPT-IN: pass `urlStateKey` to push `?<key>_page=N`
 *   and `?<key>_sort=<col>-<dir>` to the URL on user interaction. The
 *   prefix isolates multiple tables on the same page. When unset, all
 *   state stays in component memory.
 */
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Rows3, Rows4 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives/table';

export interface ColumnDef<T> {
  /** Stable key — used for React reconciliation + sort tracking. */
  key: string;
  /** Header label rendered in <TableHead>. */
  header: React.ReactNode;
  /** Whether to show the sort affordance + sort by this column. */
  sortable?: boolean;
  /** Cell alignment. Defaults to 'left'. */
  align?: 'left' | 'center' | 'right';
  /** Render callback for the cell. Receives the row. */
  render: (row: T) => React.ReactNode;
  /** When true, the column gets `tabular-nums` for clean number alignment. */
  numeric?: boolean;
  /** Optional getter when sortable — defaults to `(row as any)[key]`. */
  getSortValue?: (row: T) => string | number | null | undefined;
  /** Optional CSS width (e.g., '120px', '20%'). */
  width?: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  /** How to derive a unique key per row. */
  rowKey: keyof T | ((row: T) => string);
  /** Default sort state. */
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  /** Density toggle default. */
  defaultDensity?: 'compact' | 'normal';
  /** Hide the density toggle button (e.g., when row count is small). */
  hideDensityToggle?: boolean;
  /** Empty state node rendered when data.length === 0. */
  emptyState?: React.ReactNode;
  /** Click-row callback — when set, rows get hover cursor. */
  onRowClick?: (row: T) => void;
  /** Outer className passed to the scroll container. */
  className?: string;
  /** Optional caption shown above the table (right-aligned with density toggle). */
  caption?: React.ReactNode;
  /**
   * When set, enables client-side pagination at this row count per page.
   * Leaving this undefined disables pagination entirely (renders all rows).
   */
  pageSize?: number;
  /** Default starting page (1-indexed). Defaults to 1. */
  defaultPage?: number;
  /**
   * When set, sort state and current page are reflected in the URL as
   * `?<key>_sort=<col>-<dir>` and `?<key>_page=N`. Reading the URL on
   * mount restores those values (so links are shareable / bookmarkable).
   *
   * Pick a short, page-unique prefix when there is more than one table
   * on the page — e.g. `urlStateKey="planting"`. When unset, no URL
   * traffic happens.
   */
  urlStateKey?: string;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function parseSortParam(raw: string | null): SortState {
  // Accept "<col>-asc" / "<col>-desc". Anything else → null (use default).
  if (!raw) return null;
  const idx = raw.lastIndexOf('-');
  if (idx <= 0 || idx === raw.length - 1) return null;
  const dir = raw.slice(idx + 1);
  if (dir !== 'asc' && dir !== 'desc') return null;
  return { key: raw.slice(0, idx), dir };
}

function formatSortParam(sort: SortState): string | null {
  if (!sort) return null;
  return `${sort.key}-${sort.dir}`;
}

function parsePageParam(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export function DataTable<T>({
  data,
  columns,
  rowKey,
  defaultSort,
  defaultDensity = 'normal',
  hideDensityToggle = false,
  emptyState,
  onRowClick,
  className,
  caption,
  pageSize,
  defaultPage = 1,
  urlStateKey,
}: DataTableProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL → state initialiser (only when urlStateKey is set; otherwise we
  // ignore the URL completely and behave as in PR-1).
  const sortParamKey = urlStateKey ? `${urlStateKey}_sort` : null;
  const pageParamKey = urlStateKey ? `${urlStateKey}_page` : null;

  const initialSort: SortState = React.useMemo(() => {
    if (sortParamKey) {
      const parsed = parseSortParam(searchParams?.get(sortParamKey) ?? null);
      if (parsed) return parsed;
    }
    return defaultSort ?? null;
    // We intentionally only read the URL on mount; subsequent navigations
    // come through router.replace from this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialPage: number = React.useMemo(() => {
    if (pageParamKey) {
      return parsePageParam(searchParams?.get(pageParamKey) ?? null, defaultPage);
    }
    return defaultPage;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [sort, setSort] = React.useState<SortState>(initialSort);
  const [density, setDensity] = React.useState<'compact' | 'normal'>(defaultDensity);
  const [page, setPage] = React.useState<number>(initialPage);

  // Mirror state into the URL. We only touch our two prefixed params;
  // unrelated query string entries are preserved.
  React.useEffect(() => {
    if (!urlStateKey || !sortParamKey || !pageParamKey || !pathname) return;
    const params = new URLSearchParams(searchParams?.toString() ?? '');

    const sortVal = formatSortParam(sort);
    if (sortVal) params.set(sortParamKey, sortVal); else params.delete(sortParamKey);

    if (pageSize && page > 1) params.set(pageParamKey, String(page));
    else params.delete(pageParamKey);

    const next = params.toString();
    const current = searchParams?.toString() ?? '';
    if (next === current) return;

    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    // pathname/searchParams are stable refs from Next.js; we rely on them
    // for read-back but don't want to retrigger when only sort/page change
    // through our own update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, page, urlStateKey, pageSize]);

  const sortedData = React.useMemo(() => {
    if (!sort) return data;
    const col = columns.find(c => c.key === sort.key);
    if (!col || !col.sortable) return data;
    const getValue = col.getSortValue ?? ((row: T) => (row as Record<string, unknown>)[sort.key]);
    const next = [...data];
    next.sort((a, b) => {
      const cmp = compare(getValue(a), getValue(b));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return next;
  }, [data, columns, sort]);

  const pageCount = pageSize ? Math.max(1, Math.ceil(sortedData.length / pageSize)) : 1;

  // If page number falls outside the current page range (because data
  // shrank, sort changed list shape, etc.), clamp it back into range.
  React.useEffect(() => {
    if (!pageSize) return;
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount, pageSize]);

  const visibleData = React.useMemo(() => {
    if (!pageSize) return sortedData;
    const start = (page - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, page, pageSize]);

  function toggleSort(key: string) {
    setSort(prev => {
      let nextSort: SortState;
      if (!prev || prev.key !== key) nextSort = { key, dir: 'asc' };
      else if (prev.dir === 'asc') nextSort = { key, dir: 'desc' };
      else nextSort = null;
      // Reset to page 1 — sorting changes which rows land on page 1, so
      // staying on a deep page is rarely what the user means.
      if (pageSize) setPage(1);
      return nextSort;
    });
  }

  const cellPaddingY = density === 'compact' ? 'py-1.5' : 'py-3';
  const cellPaddingX = density === 'compact' ? 'px-3' : 'px-4';
  const headPaddingY = density === 'compact' ? 'py-1.5' : 'py-3';

  // Pagination footer visible when explicitly enabled.
  const showPagination = Boolean(pageSize);
  const rangeStart = sortedData.length === 0 ? 0 : (page - 1) * (pageSize ?? sortedData.length) + 1;
  const rangeEnd = Math.min(sortedData.length, page * (pageSize ?? sortedData.length));

  return (
    <div className={cn('rounded-2xl border border-border bg-card', className)}>
      {(!hideDensityToggle || caption) && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <div className="text-xs text-muted-foreground">{caption}</div>
          {!hideDensityToggle && (
            <button
              type="button"
              onClick={() => setDensity(d => (d === 'compact' ? 'normal' : 'compact'))}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40"
              aria-label={density === 'compact' ? 'ขยายแถว' : 'บีบแถว'}
              title={density === 'compact' ? 'ขยายแถว' : 'บีบแถว'}
            >
              {density === 'compact' ? <Rows3 className="h-3.5 w-3.5" /> : <Rows4 className="h-3.5 w-3.5" />}
              {density === 'compact' ? 'แบบบีบ' : 'แบบปกติ'}
            </button>
          )}
        </div>
      )}

      <div className="max-h-[70vh] w-full overflow-auto">
        <Table className="min-w-full">
          <TableHeader className="sticky top-0 z-10">
            <TableRow>
              {columns.map(col => {
                const isSorted = sort?.key === col.key;
                const align = col.align ?? (col.numeric ? 'right' : 'left');
                const justify =
                  align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
                // X4-FIX-B (X4-C primitive a11y win): wire aria-sort on
                // every sortable column header so screen readers know
                // the current sort state. WCAG 4.1.2 + WAI-ARIA
                // Authoring Practices for sortable tables. Columns that
                // aren't sortable get aria-sort="none" omitted (no
                // attribute) — the empty value would mislead SRs.
                const ariaSort: 'ascending' | 'descending' | 'none' | undefined = col.sortable
                  ? isSorted
                    ? sort?.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                  : undefined;
                return (
                  <TableHead
                    key={col.key}
                    style={col.width ? { width: col.width } : undefined}
                    aria-sort={ariaSort}
                    className={cn(
                      headPaddingY,
                      align === 'right' && 'text-right',
                      align === 'center' && 'text-center',
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'inline-flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] hover:text-primary-foreground/80',
                          justify,
                        )}
                      >
                        <span>{col.header}</span>
                        {isSorted ? (
                          sort?.dir === 'asc' ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>

          <TableBody>
            {visibleData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                  {emptyState ?? 'ไม่พบข้อมูล'}
                </TableCell>
              </TableRow>
            ) : (
              visibleData.map(row => {
                const key = typeof rowKey === 'function' ? rowKey(row) : String((row as Record<string, unknown>)[rowKey as string]);
                return (
                  <TableRow
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={onRowClick ? 'cursor-pointer' : undefined}
                  >
                    {columns.map(col => {
                      const align = col.align ?? (col.numeric ? 'right' : 'left');
                      return (
                        <TableCell
                          key={col.key}
                          className={cn(
                            cellPaddingY,
                            cellPaddingX,
                            col.numeric && 'tabular-nums',
                            align === 'right' && 'text-right',
                            align === 'center' && 'text-center',
                          )}
                        >
                          {col.render(row)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {showPagination && sortedData.length > 0 && (
        <div className="flex flex-col items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground sm:flex-row">
          <span className="tabular-nums">
            แสดง {rangeStart.toLocaleString('th-TH')}–{rangeEnd.toLocaleString('th-TH')} จาก {sortedData.length.toLocaleString('th-TH')}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="หน้าก่อน"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              ก่อน
            </button>
            <span className="px-2 tabular-nums">
              หน้า {page.toLocaleString('th-TH')} / {pageCount.toLocaleString('th-TH')}
            </span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="หน้าถัดไป"
            >
              ถัดไป
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
