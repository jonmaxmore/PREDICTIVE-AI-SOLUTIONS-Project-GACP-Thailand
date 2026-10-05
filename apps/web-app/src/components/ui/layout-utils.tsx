'use client';
/**
 * Layout primitives: Container, SimpleGrid, Grid, AppShell, ScrollArea, Collapse
 */
import React from 'react';

// Container

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
    children?: React.ReactNode;
    className?: string;
    size?: string;
    [key: string]: unknown;
}

export const Container = ({ children, className = '', size, ...props }: ContainerProps) => {
    // `size="full"` = no cap → fills the layout's single max-w-7xl width standard
    // (2026-06-11). In-shell page wrappers use this so every page shares one width.
    const maxW = size === 'full' ? '' : size === 'xl' ? 'max-w-6xl' : size === 'lg' ? 'max-w-4xl' : size === 'md' ? 'max-w-2xl' : 'max-w-lg';
    return <div className={`w-full ${maxW} mx-auto px-4 ${className}`.replace(/\s+/g, ' ').trim()} {...props}>{children}</div>;
};

// SimpleGrid

interface SimpleGridProps extends React.HTMLAttributes<HTMLDivElement> {
    children?: React.ReactNode;
    className?: string;
    cols?: number | { base?: number; sm?: number; md?: number; lg?: number; xl?: number };
    spacing?: string;
    [key: string]: unknown;
}

export const SimpleGrid = ({ children, className = '', cols = 2, spacing: _sp, ...props }: SimpleGridProps) => {
    const c = typeof cols === 'number' ? cols : (cols.sm ?? cols.base ?? 2);
    const colClass = c === 1 ? 'grid-cols-1'
        : c === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
            : c === 4 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
                : 'grid-cols-1 sm:grid-cols-2';
    return <div className={`grid gap-4 ${colClass} ${className}`} {...props}>{children}</div>;
};

// Grid

interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
    children?: React.ReactNode;
    className?: string;
    [key: string]: unknown;
}

export const Grid = ({ children, className = '', ...props }: GridProps) => (
    <div className={`grid gap-4 ${className}`} {...props}>{children}</div>
);

interface GridColProps extends React.HTMLAttributes<HTMLDivElement> {
    children?: React.ReactNode;
    className?: string;
    span?: number;
    [key: string]: unknown;
}

Grid.Col = function GridCol({ children, className = '', span, ...props }: GridColProps) {
    const spanClass = span ? `col-span-${Math.min(span, 12)}` : '';
    return <div className={`${spanClass} ${className}`} {...props}>{children}</div>;
};

// AppShell

interface AppShellProps { children?: React.ReactNode; className?: string;[key: string]: unknown; }

export const AppShell = ({ children, className = '' }: AppShellProps) => (
    <div className={`flex min-h-screen ${className}`}>{children}</div>
);

interface AppShellNavbarProps { children?: React.ReactNode; className?: string; width?: number | { base?: number };[key: string]: unknown; }
AppShell.Navbar = function AppShellNavbar({ children, className = '', width }: AppShellNavbarProps) {
    const w = typeof width === 'object' ? (width?.base ?? 250) : (width ?? 250);
    return <nav className={`flex flex-col border-r border-border bg-card ${className}`} style={{ width: w }}>{children}</nav>;
};

interface AppShellChildProps { children?: React.ReactNode; className?: string;[key: string]: unknown; }
AppShell.Main = function AppShellMain({ children, className = '' }: AppShellChildProps) {
    return <main className={`flex-1 overflow-auto ${className}`}>{children}</main>;
};
AppShell.Section = function AppShellSection({ children, className = '' }: AppShellChildProps) {
    return <div className={className as string}>{children}</div>;
};
AppShell.Header = function AppShellHeader({ children, className = '' }: AppShellChildProps) {
    return <header className={`border-b border-border bg-card ${className}`}>{children}</header>;
};

// ScrollArea

export const ScrollArea = ({ children, className = '' }: AppShellChildProps) => (
    <div className={`overflow-auto ${className}`}>{children}</div>
);

// Collapse

interface CollapseProps { children?: React.ReactNode; in?: boolean;[key: string]: unknown; }
export const Collapse = ({ children, in: isOpen }: CollapseProps) => (
    <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">{children}</div>
    </div>
);
