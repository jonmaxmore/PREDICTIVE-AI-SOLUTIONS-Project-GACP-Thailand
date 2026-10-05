'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * PageToolbar — GACP government dashboard top bar.
 *
 * Renders a page title on the left and a single primary action on
 * the right. Secondary actions (download, print, etc.) collapse into
 * an "การจัดการ" (Actions) dropdown menu — explicitly NOT the
 * "ดาวน์โหลด Excel + พิมพ์รายงาน" 2-button row that some Thai SME
 * accounting SaaS products use. We avoid that exact dress to keep
 * our visual identity government-leaning (ราชการ, not FinTech).
 *
 * Layout rules:
 *   - Mobile (≤ md): title stack on top, actions row below
 *   - Tablet+ (md+): title left, primary button + Actions menu right
 *
 * Backward compatibility: the existing `actions` prop API is
 * preserved. The first `variant: 'primary'` action becomes the
 * standalone primary button; the rest fall into the dropdown menu.
 * If no action is `primary`, every action goes into the menu.
 */
export type PageToolbarAction = {
    /** Visible label in Thai. */
    label: string;
    /** Tabler icon element. */
    icon?: React.ReactNode;
    /**
     * Button variant. Only the FIRST `primary` action surfaces as a
     * standalone button; everything else (incl. extra `primary`) is
     * grouped into the dropdown menu.
     */
    variant?: 'primary' | 'outline' | 'ghost' | 'destructive';
    /** Click handler. */
    onClick?: () => void;
    /** Optional href — if provided, renders as an anchor. */
    href?: string;
    /** Disabled state. */
    disabled?: boolean;
    /** Optional key when rendered in a list. */
    key?: string;
    /** Accessible label override for icon-only states. */
    ariaLabel?: string;
    /** Optional sub-text shown inside the dropdown menu only. */
    description?: string;
};

export interface PageToolbarProps {
    title: string;
    subtitle?: string;
    actions?: ReadonlyArray<PageToolbarAction>;
    /** Optional eyebrow text rendered above the title. */
    eyebrow?: string;
    className?: string;
    sticky?: boolean;
}

const primaryBtnCls =
    'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-leaf-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-leaf-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-2 disabled:bg-leaf-300 disabled:pointer-events-none';

const menuBtnCls =
    'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-2 disabled:opacity-50';

export function PageToolbar({
    title,
    subtitle,
    actions = [],
    eyebrow,
    className,
    sticky = false,
}: PageToolbarProps) {
    // Split actions:
    //   primary  -> first primary-variant action (standalone button)
    //   menu     -> everything else (in the "การจัดการ" dropdown)
    const primaryIdx = actions.findIndex((a) => a.variant === 'primary');
    const primary = primaryIdx >= 0 ? actions[primaryIdx] : null;
    const menuActions = actions.filter((_, idx) => idx !== primaryIdx);
    const hasMenu = menuActions.length > 0;

    const [open, setOpen] = React.useState(false);
    const menuRef = React.useRef<HTMLDivElement>(null);

    // Close the menu on outside click / Escape — standard a11y.
    React.useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div
            className={cn(
                // Minimal redesign: plain hairline card, no elevation. The
                // page header is a label, not a hero.
                'flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-4 md:flex-row md:items-center md:justify-between md:gap-4 md:px-6 md:py-5 print:hidden',
                sticky && 'sticky top-0 z-20',
                className,
            )}
        >
            <div className="min-w-0 flex-1">
                {eyebrow ? (
                    <p className="text-xs font-medium text-muted-foreground">
                        {eyebrow}
                    </p>
                ) : null}
                <h1 className="truncate text-lg font-semibold text-foreground md:text-xl">
                    {title}
                </h1>
                {subtitle ? (
                    <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
                ) : null}
            </div>
            {actions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                    {primary ? renderPrimary(primary) : null}
                    {hasMenu ? (
                        <div className="relative" ref={menuRef}>
                            <button
                                type="button"
                                onClick={() => setOpen((v) => !v)}
                                className={menuBtnCls}
                                aria-haspopup="menu"
                                aria-expanded={open}
                                aria-label="เมนูการจัดการเพิ่มเติม"
                            >
                                <ChevronIcon className="h-4 w-4" />
                                <span>การจัดการ</span>
                            </button>
                            {open ? (
                                <div
                                    role="menu"
                                    className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-card shadow-md"
                                >
                                    {menuActions.map((action, idx) =>
                                        renderMenuItem(action, idx, () => setOpen(false)),
                                    )}
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function renderPrimary(action: PageToolbarAction) {
    const labelEl = (
        <>
            {action.icon ? (
                <span aria-hidden="true" className="inline-flex">
                    {action.icon}
                </span>
            ) : null}
            <span>{action.label}</span>
        </>
    );
    if (action.href) {
        return (
            <a
                key={action.key || action.label}
                href={action.href}
                className={primaryBtnCls}
                aria-label={action.ariaLabel || action.label}
            >
                {labelEl}
            </a>
        );
    }
    return (
        <button
            key={action.key || action.label}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className={primaryBtnCls}
            aria-label={action.ariaLabel || action.label}
        >
            {labelEl}
        </button>
    );
}

function renderMenuItem(
    action: PageToolbarAction,
    idx: number,
    close: () => void,
) {
    const isDestructive = action.variant === 'destructive';
    const itemCls = cn(
        'flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50',
        isDestructive ? 'text-rose-700 hover:bg-rose-50 focus-visible:bg-rose-50' : 'text-foreground',
    );
    const content = (
        <>
            {action.icon ? (
                <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 text-muted-foreground">
                    {action.icon}
                </span>
            ) : null}
            <span className="min-w-0 flex-1">
                <span className="block font-medium">{action.label}</span>
                {action.description ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">{action.description}</span>
                ) : null}
            </span>
        </>
    );
    const onSelect = () => {
        close();
        action.onClick?.();
    };
    if (action.href) {
        return (
            <a
                key={action.key || `${action.label}-${idx}`}
                href={action.href}
                role="menuitem"
                className={itemCls}
                onClick={close}
            >
                {content}
            </a>
        );
    }
    return (
        <button
            key={action.key || `${action.label}-${idx}`}
            type="button"
            role="menuitem"
            onClick={onSelect}
            disabled={action.disabled}
            className={itemCls}
        >
            {content}
        </button>
    );
}

function ChevronIcon({ className }: { className?: string }) {
    return (
        <svg
            className={className}
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

export default PageToolbar;
