'use client';
/**
 * Action elements: ThemeIcon, ActionIcon, UnstyledButton, CloseButton, Burger, NavLink, Anchor
 *
 * `ThemeIcon` and `ActionIcon` accept `size` and `color` props (Mantine-style
 * names retained for caller compatibility — the surrounding ~33 sites still
 * pass them). Both props are functional now:
 *
 *   size  → numeric pixel value, or one of xs/sm/md/lg/xl presets
 *   color → maps to a Mantine-palette tinted Tailwind className (filled
 *           bg + matching text). 'primary' / 'success' / 'info' / 'warning' /
 *           'error' are accepted aliases. Unknown / dynamic values fall
 *           back to the default `bg-muted text-muted-foreground` chrome.
 *
 * The `variant` prop has been dropped from the public API — its previous
 * meaning ("light" / "destructive" / etc) was never honored, and consumers
 * relied on the default chrome anyway.
 */
import React from 'react';

const SIZE_PRESETS: Record<string, number> = {
    xs: 16,
    sm: 20,
    md: 28,
    lg: 36,
    xl: 48,
};

function resolveSize(size: string | number | undefined, fallback: number): number {
    if (typeof size === 'number') return size;
    if (typeof size === 'string') {
        const preset = SIZE_PRESETS[size];
        if (preset !== undefined) return preset;
    }
    return fallback;
}

/**
 * Mantine-palette color name → Tailwind class string. Mapping picks shade-1
 * background + shade-9 text so the icon retains contrast in both light and
 * dark mode (the mantine-* tokens are theme-agnostic by design — see
 * tailwind.config.cjs `colors.mantine` namespace).
 *
 * Aliases: 'primary'/'success'/'info'/'warning'/'error'/'white' map onto
 * project semantics so the legacy Mantine prop stays expressive.
 */
const COLOR_CLASSES: Record<string, string> = {
    gray: 'bg-mantine-gray-1 text-mantine-gray-9',
    red: 'bg-mantine-red-1 text-mantine-red-9',
    green: 'bg-mantine-green-1 text-mantine-green-9',
    blue: 'bg-mantine-blue-1 text-mantine-blue-9',
    teal: 'bg-mantine-teal-1 text-mantine-teal-9',
    yellow: 'bg-mantine-yellow-1 text-mantine-yellow-9',
    orange: 'bg-mantine-orange-1 text-mantine-orange-9',
    indigo: 'bg-mantine-indigo-1 text-mantine-indigo-9',
    violet: 'bg-mantine-violet-1 text-mantine-violet-9',
    grape: 'bg-mantine-grape-2 text-foreground',
    white: 'bg-white text-mantine-gray-9',
    primary: 'bg-primary/10 text-primary',
    success: 'bg-mantine-green-1 text-mantine-green-9',
    info: 'bg-mantine-blue-1 text-mantine-blue-9',
    warning: 'bg-mantine-yellow-1 text-mantine-yellow-9',
    error: 'bg-mantine-red-1 text-mantine-red-9',
};

const DEFAULT_COLOR_CLASS = 'bg-muted text-muted-foreground';

function resolveColorClass(color: string | undefined): string {
    if (!color) return DEFAULT_COLOR_CLASS;
    const key = String(color).toLowerCase();
    return COLOR_CLASSES[key] ?? DEFAULT_COLOR_CLASS;
}

// ThemeIcon

interface ThemeIconProps extends React.HTMLAttributes<HTMLDivElement> {
    children?: React.ReactNode;
    className?: string;
    /**
     * Visual color tint. Accepts Mantine palette names (gray/red/green/blue/
     * teal/yellow/orange/indigo/violet/grape/white) or semantic aliases
     * (primary/success/info/warning/error). Unknown / dynamic values fall
     * back to the default muted chrome.
     */
    color?: string;
    /** Box dimension. Numeric = pixels; string presets: xs(16) sm(20) md(28) lg(36) xl(48). Default 32. */
    size?: string | number;
}

export const ThemeIcon = ({ children, className = '', color, size, ...props }: ThemeIconProps) => {
    const px = resolveSize(size, 32);
    const colorCls = resolveColorClass(color);
    return (
        <div
            className={`flex flex-shrink-0 items-center justify-center rounded-lg ${colorCls} ${className}`}
            style={{ width: px, height: px, ...(props.style ?? {}) }}
            {...props}
        >
            {children}
        </div>
    );
};

// ActionIcon

interface ActionIconProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children?: React.ReactNode;
    className?: string;
    /**
     * Visual color tint. Same palette as ThemeIcon. The button's hover
     * state still uses the muted ring; only the resting tint changes.
     */
    color?: string;
    /** Button dimension. Numeric = pixels; string presets: xs(16) sm(20) md(28) lg(36) xl(48). Default 36. */
    size?: string | number;
}

export const ActionIcon = ({ children, className = '', onClick, disabled, 'aria-label': ariaLabel, color, size, ...props }: ActionIconProps) => {
    const px = resolveSize(size, 36);
    const colorCls = color ? resolveColorClass(color) : '';
    return (
        <button type="button"
            className={`inline-flex flex-shrink-0 items-center justify-center rounded-lg transition-colors ${colorCls} hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
            style={{ width: px, height: px, ...(props.style ?? {}) }}
            onClick={onClick} disabled={disabled} aria-label={ariaLabel} {...props}
        >{children}</button>
    );
};

// UnstyledButton

interface UnstyledButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children?: React.ReactNode;
    className?: string;
    [key: string]: unknown;
}

export const UnstyledButton = ({ children, className = '', onClick, ...rest }: UnstyledButtonProps) => (
    <button type="button" className={`cursor-pointer border-none bg-transparent p-0 text-inherit ${className}`} onClick={onClick} {...rest}>{children}</button>
);

// CloseButton

interface CloseButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    className?: string;
    [key: string]: unknown;
}

export const CloseButton = ({ onClick, className = '', 'aria-label': ariaLabel, ...props }: CloseButtonProps) => (
    <button type="button" onClick={onClick}
        aria-label={(ariaLabel as string) || 'ปิด'}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${className}`}
        {...props}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
    </button>
);

// Burger

interface BurgerProps {
    opened?: boolean;
    onClick?: () => void;
    className?: string;
    [key: string]: unknown;
}

export const Burger = ({ opened, onClick, className = '' }: BurgerProps) => (
    <button type="button" className={`rounded-lg p-2 hover:bg-muted ${className}`} onClick={onClick} aria-label="เปิด/ปิดเมนู">
        <div className="flex w-5 flex-col gap-1">
            <span className={`h-0.5 bg-current transition-all ${opened ? 'translate-y-1.5 rotate-45' : ''}`} />
            <span className={`h-0.5 bg-current transition-all ${opened ? 'opacity-0' : ''}`} />
            <span className={`h-0.5 bg-current transition-all ${opened ? '-translate-y-1.5 -rotate-45' : ''}`} />
        </div>
    </button>
);

// NavLink

interface NavLinkProps {
    children?: React.ReactNode;
    label?: React.ReactNode;
    icon?: React.ReactNode;
    active?: boolean;
    onClick?: () => void;
    className?: string;
    [key: string]: unknown;
}

export const NavLink = ({ children, label, icon, active, onClick, className = '' }: NavLinkProps) => (
    <button type="button"
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'} ${className}`}
        onClick={onClick}>
        {icon && <span className="flex-shrink-0">{icon}</span>}
        <span className="flex-1 text-sm">{label || children}</span>
    </button>
);

// Anchor

interface AnchorProps {
    children?: React.ReactNode;
    href?: string;
    className?: string;
    [key: string]: unknown;
}

export const Anchor = ({ children, href, className = '' }: AnchorProps) => (
    <a href={href} className={`text-primary hover:underline ${className}`}>{children}</a>
);
