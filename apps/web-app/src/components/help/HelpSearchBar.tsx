'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * HelpSearchBar — search input wrapper used on /help and /help/faq.
 *
 * Wraps a single text input with a magnifying-glass icon on the left
 * and a "clear" affordance on the right. The wrapper handles only
 * presentational concerns — filtering logic lives in the parent so
 * server-rendered pages can pre-filter via the search params.
 */

export interface HelpSearchBarProps {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    className?: string;
    ariaLabel?: string;
    /** Optional ID for input — useful for label associations. */
    id?: string;
}

export function HelpSearchBar({
    value,
    onChange,
    placeholder = 'ค้นหาคำถาม เช่น เอกสาร ค่าบริการ การตรวจฟาร์ม',
    className,
    ariaLabel = 'ค้นหาในศูนย์ช่วยเหลือ',
    id = 'help-search',
}: HelpSearchBarProps) {
    return (
        <div
            className={cn(
                'flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm focus-within:border-leaf-600 focus-within:ring-2 focus-within:ring-leaf-600',
                className,
            )}
            data-testid="help-search-bar"
        >
            <SearchIcon className="h-5 w-5 shrink-0 text-slate-400" />
            <input
                id={id}
                type="search"
                inputMode="search"
                autoComplete="off"
                value={value}
                onChange={(e) => onChange(e.currentTarget.value)}
                placeholder={placeholder}
                aria-label={ariaLabel}
                className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            {value ? (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    aria-label="ล้างคำค้น"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600"
                >
                    <CloseIcon className="h-3.5 w-3.5" />
                </button>
            ) : null}
        </div>
    );
}

function SearchIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <circle cx="9" cy="9" r="6" />
            <path d="M14 14l3.5 3.5" strokeLinecap="round" />
        </svg>
    );
}

function CloseIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
    );
}

export default HelpSearchBar;
