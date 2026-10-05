'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * TabNav — FlowAccount-style tab navigation.
 *
 * Renders an underlined tab strip with optional counts in
 * parentheses (e.g. "เอกสารขาย (10)"). Active tab gets the primary
 * underline and semibold weight — no pill fill, no card chrome.
 *
 * On mobile (≤ md) the tabs become horizontally scrollable so
 * long Thai labels don't break the layout.
 */

export type TabItem<T extends string = string> = {
    id: T;
    label: string;
    /** Optional count rendered in parentheses. */
    count?: number;
    /** Optional Tabler icon element. */
    icon?: React.ReactNode;
    /** Disabled state — renders the tab dimmed and non-interactive. */
    disabled?: boolean;
};

export interface TabNavProps<T extends string = string> {
    tabs: ReadonlyArray<TabItem<T>>;
    activeId: T;
    onChange: (id: T) => void;
    className?: string;
    ariaLabel?: string;
}

export function TabNav<T extends string = string>({
    tabs,
    activeId,
    onChange,
    className,
    ariaLabel = 'แท็บ',
}: TabNavProps<T>) {
    return (
        <div
            role="tablist"
            aria-label={ariaLabel}
            className={cn(
                // Minimal redesign: a plain underlined strip on the page
                // background — no card, no radius, no elevation. The active
                // tab is carried by the underline + text colour alone.
                'flex gap-1 overflow-x-auto border-b border-border print:hidden',
                className,
            )}
        >
            {tabs.map((tab) => {
                const active = tab.id === activeId;
                return (
                    <button
                        type="button"
                        role="tab"
                        key={tab.id}
                        aria-selected={active}
                        aria-controls={`tabpanel-${tab.id}`}
                        id={`tab-${tab.id}`}
                        disabled={tab.disabled}
                        onClick={() => !tab.disabled && onChange(tab.id)}
                        className={cn(
                            '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            active
                                ? 'border-b-2 border-primary font-semibold text-primary'
                                : 'border-b-2 border-transparent font-medium text-muted-foreground hover:text-foreground',
                            tab.disabled && 'pointer-events-none opacity-40',
                        )}
                    >
                        {tab.icon ? (
                            <span aria-hidden="true" className="inline-flex">
                                {tab.icon}
                            </span>
                        ) : null}
                        <span>{tab.label}</span>
                        {typeof tab.count === 'number' ? (
                            <span
                                className={cn(
                                    'tabular-nums',
                                    active ? 'text-primary' : 'text-muted-foreground',
                                )}
                            >
                                ({tab.count})
                            </span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}

export default TabNav;
