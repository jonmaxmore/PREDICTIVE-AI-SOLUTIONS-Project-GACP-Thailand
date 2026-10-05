'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { PageToolbar, type PageToolbarAction } from '@/components/finance';

/**
 * AdminPageShell — minimum-touch parity wrapper for admin/provider pages
 * that still use bespoke headers. Wraps the finance PageToolbar with a
 * consistent vertical rhythm (space-y-5) so any page that swaps in this
 * shell instantly gains the same toolbar contract as the accounting
 * surface.
 *
 * It deliberately does NOT take over content rendering — child pages
 * keep their own grid + cards.
 *
 * X5-FIX-B H-11: the wrapped PageToolbar carries the same `gov-gradient
 * border-none shadow-xl shadow-primary/20` brand cue used by SCHEDULER
 * (X3-FIX-B) and ACCOUNT (X4-FIX-B) headers so the ADMIN surface stops
 * being the 0% gov-gradient role. Callers can override via
 * `toolbarClassName` for the rare page that needs a different chrome.
 */

export interface AdminPageShellProps {
    title: string;
    subtitle?: string;
    eyebrow?: string;
    actions?: ReadonlyArray<PageToolbarAction>;
    children: React.ReactNode;
    className?: string;
    /**
     * Optional override of the className applied to the inner PageToolbar.
     * Defaults to the canonical ADMIN brand-cue cluster
     * `gov-gradient border-none shadow-xl shadow-primary/20`.
     */
    toolbarClassName?: string;
}

const DEFAULT_TOOLBAR_CLASSNAME =
    'gov-gradient border-none shadow-xl shadow-primary/20';

export function AdminPageShell({
    title,
    subtitle,
    eyebrow,
    actions,
    children,
    className,
    toolbarClassName,
}: AdminPageShellProps) {
    return (
        <div className={cn('space-y-5', className)}>
            <PageToolbar
                title={title}
                {...(subtitle !== undefined ? { subtitle } : {})}
                {...(eyebrow !== undefined ? { eyebrow } : {})}
                {...(actions !== undefined ? { actions } : {})}
                className={cn(DEFAULT_TOOLBAR_CLASSNAME, toolbarClassName)}
            />
            {children}
        </div>
    );
}

export default AdminPageShell;
