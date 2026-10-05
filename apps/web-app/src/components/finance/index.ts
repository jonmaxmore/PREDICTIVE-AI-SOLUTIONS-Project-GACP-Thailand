/**
 * Shared FlowAccount-style finance components — used by the
 * accounting dashboard, reports, AR aging, and customer
 * statement pages. See
 * docs/design/finance-dashboard-redesign-2026-05-16.md for
 * usage conventions and the FlowAccount-derived design language.
 */

export { PageToolbar } from './PageToolbar';
export type { PageToolbarAction, PageToolbarProps } from './PageToolbar';

export { FilterBar, FilterField } from './FilterBar';
export type { FilterBarProps, FilterChip } from './FilterBar';

export { SummaryCard } from './SummaryCard';
export type { SummaryCardProps, SummaryTotal, SummaryMeta } from './SummaryCard';

export { StatusBadge } from './StatusBadge';
export type { StatusBadgeProps, StatusTone } from './StatusBadge';

export { DataTable, TableFooter } from './DataTable';
export type { DataTableProps, DataColumn, DataColumnAlign } from './DataTable';

export { TabNav } from './TabNav';
export type { TabNavProps, TabItem } from './TabNav';
