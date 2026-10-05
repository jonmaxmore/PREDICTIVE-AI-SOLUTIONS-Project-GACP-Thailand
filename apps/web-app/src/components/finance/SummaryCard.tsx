'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * SummaryCard — GACP government dashboard hero metric strip.
 *
 * Layout (intentionally distinct from the org-name-top + right-side-
 * stacked-totals card used by some Thai accounting SaaS products):
 *
 *   1) Optional eyebrow row with org name on the LEFT and a context
 *      pill (asOfDate / period) on the RIGHT — single line.
 *   2) Horizontal metric strip (1/2/3+ columns auto, equal width).
 *      Each cell stacks big number on TOP, small label BELOW it.
 *      The first total (or `emphasis: 'primary'`) gets a colored
 *      number to indicate it is the headline KPI.
 *   3) Optional meta footer: label/value pairs in compact grid.
 *
 * On mobile (≤ md), the metric strip becomes a 2-col grid so the
 * numbers stay legible at a glance.
 */

export type SummaryTotal = {
    /** Label shown BELOW the figure, e.g. "ยอดรวมทั้งสิ้น". */
    label: string;
    /** Pre-formatted Thai Baht value, e.g. "22,000.00". */
    value: string;
    /** Visual emphasis. "primary" = colored & largest. */
    emphasis?: 'primary' | 'muted';
    /** Optional sub-text rendered below the label, e.g. "งวดปัจจุบัน". */
    hint?: string;
};

export type SummaryMeta = {
    /** Meta label, e.g. "ณ วันที่". */
    label: string;
    /** Plain value text. */
    value: string;
};

export interface SummaryCardProps {
    /** Organisation/entity name shown in the top-left context row. */
    org?: string;
    /** Meta items rendered in the compact footer grid. */
    meta?: ReadonlyArray<SummaryMeta>;
    /** Totals — rendered as a horizontal metric strip at the top. */
    totals: ReadonlyArray<SummaryTotal>;
    /** Optional accent colour for the primary number. */
    primaryColorClass?: string;
    /** Optional context pill (e.g. period / as-of date) — top-right. */
    contextPill?: string;
    className?: string;
}

export function SummaryCard({
    org,
    meta = [],
    totals,
    primaryColorClass = 'text-primary',
    contextPill,
    className,
}: SummaryCardProps) {
    const totalsCount = totals.length;
    // Grid templates by total count — keep things equal-width and
    // legible across breakpoints.
    const stripCols =
        totalsCount === 1
            ? 'grid-cols-1'
            : totalsCount === 2
                ? 'grid-cols-2'
                : totalsCount === 3
                    ? 'grid-cols-2 md:grid-cols-3'
                    : 'grid-cols-2 md:grid-cols-4';

    return (
        <section
            className={cn(
                'space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6',
                className,
            )}
            aria-label="สรุปยอด"
        >
            {/* Row 1 — context line (org left, period pill right) */}
            {org || contextPill ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                    {org ? (
                        <p className="text-sm font-semibold text-slate-800">{org}</p>
                    ) : <span aria-hidden="true" />}
                    {contextPill ? (
                        <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                            {contextPill}
                        </span>
                    ) : null}
                </div>
            ) : null}

            {/* Row 2 — horizontal metric strip. Minimal redesign: the numbers
                sit directly on the card (no grey inner fill box) separated
                only by a hairline when a context row precedes them, so the
                summary reads as one calm surface rather than a card-in-card. */}
            {totals.length > 0 ? (
                <dl
                    className={cn(
                        'grid gap-4 md:gap-6',
                        org || contextPill ? 'border-t border-slate-100 pt-4' : '',
                        stripCols,
                    )}
                >
                    {totals.map((total, idx) => {
                        const isPrimary =
                            total.emphasis === 'primary'
                            || (idx === 0 && !total.emphasis);
                        return (
                            <div
                                key={`${total.label}-${idx}`}
                                className="flex flex-col gap-1"
                            >
                                <dd
                                    className={cn(
                                        'tabular-nums leading-tight',
                                        isPrimary
                                            ? cn('text-2xl font-bold md:text-3xl', primaryColorClass)
                                            : 'text-lg font-semibold text-slate-700 md:text-xl',
                                    )}
                                >
                                    {total.value}
                                </dd>
                                <dt
                                    className={cn(
                                        'text-xs font-medium',
                                        isPrimary ? 'text-slate-700' : 'text-slate-500',
                                    )}
                                >
                                    {total.label}
                                </dt>
                                {total.hint ? (
                                    <p className="text-[11px] text-slate-500">{total.hint}</p>
                                ) : null}
                            </div>
                        );
                    })}
                </dl>
            ) : null}

            {/* Row 3 — meta footer */}
            {meta.length > 0 ? (
                <dl className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 md:grid-cols-3">
                    {meta.map((item) => (
                        <div key={item.label} className="min-w-0">
                            <dt className="text-[11px] font-semibold text-slate-500">
                                {item.label}
                            </dt>
                            <dd className="mt-0.5 truncate text-sm font-medium text-slate-800">
                                {item.value}
                            </dd>
                        </div>
                    ))}
                </dl>
            ) : null}
        </section>
    );
}

export default SummaryCard;
