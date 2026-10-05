'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * FilterBar — FlowAccount-style inline filter row.
 *
 * Renders arbitrary filter inputs (passed as children), a primary
 * "แสดงผล" apply button, and a wrap-line of active filter chips
 * that can be removed with their × button.
 *
 * On mobile (≤ md) the filter inputs stack vertically while chips
 * stay on a separate scroll-row to keep them visible.
 */

export type FilterChip = {
    /** Stable key for React reconciliation. */
    key: string;
    /** Visible label, e.g. "สถานะเอกสารขาย: รอดำเนินการ". */
    label: string;
    /** Removal callback — receives the chip key. */
    onRemove?: (key: string) => void;
    /** Optional tone for the chip surface. Defaults to neutral. */
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
};

export interface FilterBarProps {
    /** Filter inputs (dropdowns, selects, etc.) — rendered inline. */
    children?: React.ReactNode;
    /** Active chips. Hidden when empty. */
    chips?: ReadonlyArray<FilterChip>;
    /** "แสดงผล" / Apply handler. Renders an Apply button when set. */
    onApply?: () => void;
    /** Apply button label — defaults to "แสดงผล". */
    applyLabel?: string;
    /** Apply button disabled state. */
    applyDisabled?: boolean;
    /** Right-aligned secondary action slot. */
    secondaryAction?: React.ReactNode;
    className?: string;
}

const chipTones: Record<NonNullable<FilterChip['tone']>, string> = {
    neutral: 'bg-muted text-foreground border-border',
    info: 'bg-sky-50 text-sky-800 border-sky-200',
    success: 'bg-leaf-soft text-leaf-onSoft border-leaf-300',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    danger: 'bg-rose-50 text-rose-800 border-rose-200',
};

export function FilterBar({
    children,
    chips = [],
    onApply,
    applyLabel = 'แสดงผล',
    applyDisabled = false,
    secondaryAction,
    className,
}: FilterBarProps) {
    return (
        <div
            className={cn(
                'space-y-3 rounded-lg border border-border bg-card p-4 print:hidden',
                className,
            )}
        >
            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-3">
                <div className="flex flex-1 flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-3">
                    {children}
                </div>
                <div className="flex items-center gap-2">
                    {onApply ? (
                        <button
                            type="button"
                            onClick={onApply}
                            disabled={applyDisabled}
                            className="inline-flex h-10 items-center justify-center rounded-lg bg-leaf-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-leaf-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-leaf-300"
                        >
                            {applyLabel}
                        </button>
                    ) : null}
                    {secondaryAction}
                </div>
            </div>
            {chips.length > 0 ? (
                <div
                    className="flex flex-wrap items-center gap-2"
                    role="list"
                    aria-label="ตัวกรองที่ใช้งาน"
                >
                    {chips.map((chip) => (
                        <span
                            key={chip.key}
                            role="listitem"
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                                chipTones[chip.tone || 'neutral'],
                            )}
                        >
                            {chip.label}
                            {chip.onRemove ? (
                                <button
                                    type="button"
                                    onClick={() => chip.onRemove?.(chip.key)}
                                    className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-black/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current"
                                    aria-label={`ลบตัวกรอง ${chip.label}`}
                                >
                                    <span aria-hidden="true">×</span>
                                </button>
                            ) : null}
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

/**
 * FilterField — convenience wrapper to label and render a control
 * inside the FilterBar. Use for date pickers, selects, etc.
 */
export function FilterField({
    label,
    htmlFor,
    children,
    className,
}: {
    label: string;
    htmlFor?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('flex flex-col gap-1', className)}>
            <label
                htmlFor={htmlFor}
                className="text-xs font-medium text-muted-foreground"
            >
                {label}
            </label>
            {children}
        </div>
    );
}

export default FilterBar;
