'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * FaqAccordion — Iter 28 help center accordion.
 *
 * Renders a Thai-first FAQ list as keyboard-accessible disclosure
 * widgets. Each entry can be expanded independently; click on the
 * question button toggles its `open` state.
 *
 * Server-rendering safe: the accordion's open state is local React
 * state, but the markup is also valid when collapsed which is the
 * SSR default. Tests assert `aria-expanded` flips on click.
 *
 * Note: We intentionally do NOT depend on the global Accordion
 * primitive (`@/components/ui/overlays`) because we want the FAQ
 * accordion to render plain semantic `<button>` + `<section>` so
 * the help center stays usable without JS hydration (PWA offline).
 */

export type FaqItem = {
    /** Stable identifier — used for keys + anchor targets. */
    id: string;
    /** Question text (Thai). */
    question: string;
    /** Answer text (Thai, plain text or short paragraphs). */
    answer: string;
    /** Optional secondary keywords used by parent search filters. */
    keywords?: ReadonlyArray<string>;
};

export interface FaqAccordionProps {
    items: ReadonlyArray<FaqItem>;
    /** Optional className applied to the root list element. */
    className?: string;
    /** Optional heading id passed via aria-labelledby. */
    ariaLabelledBy?: string;
    /** Optional default-open id. */
    defaultOpenId?: string;
}

export function FaqAccordion({
    items,
    className,
    ariaLabelledBy,
    defaultOpenId,
}: FaqAccordionProps) {
    const [openIds, setOpenIds] = React.useState<Set<string>>(() =>
        defaultOpenId ? new Set([defaultOpenId]) : new Set(),
    );

    if (items.length === 0) {
        return (
            <div
                className={cn(
                    'rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center text-sm text-slate-500',
                    className,
                )}
                role="status"
            >
                ไม่พบคำถามที่ตรงกับเงื่อนไข
            </div>
        );
    }

    const toggle = (id: string) => {
        setOpenIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <ul
            className={cn('divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white', className)}
            aria-labelledby={ariaLabelledBy}
            data-testid="faq-accordion"
        >
            {items.map((item) => {
                const open = openIds.has(item.id);
                const buttonId = `faq-q-${item.id}`;
                const panelId = `faq-a-${item.id}`;
                return (
                    <li key={item.id} className="px-4 py-2 md:px-5">
                        <h3 className="m-0">
                            <button
                                id={buttonId}
                                type="button"
                                aria-expanded={open}
                                aria-controls={panelId}
                                onClick={() => toggle(item.id)}
                                data-testid={`faq-toggle-${item.id}`}
                                className={cn(
                                    'flex w-full items-start justify-between gap-3 py-3 text-left text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600',
                                    open ? 'text-leaf-700' : 'text-slate-900',
                                )}
                            >
                                <span className="min-w-0 flex-1 leading-relaxed">{item.question}</span>
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs text-slate-600 transition-transform',
                                        open && 'rotate-180 border-leaf-300 bg-leaf-soft text-leaf-onSoft',
                                    )}
                                >
                                    <ChevronDown />
                                </span>
                            </button>
                        </h3>
                        {open ? (
                            // W5-C: <section> already has an implicit ARIA role of "region";
                            // explicit role="region" is redundant per jsx-a11y/no-redundant-roles.
                            <section
                                id={panelId}
                                aria-labelledby={buttonId}
                                className="pb-4 pr-9 text-sm leading-relaxed text-slate-700"
                                data-testid={`faq-panel-${item.id}`}
                            >
                                {item.answer.split('\n').map((line, idx) => (
                                    <p key={idx} className="mb-2 last:mb-0">
                                        {line}
                                    </p>
                                ))}
                            </section>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}

function ChevronDown() {
    return (
        <svg
            width={12}
            height={12}
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
        >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 8l5 5 5-5" />
        </svg>
    );
}

export default FaqAccordion;
