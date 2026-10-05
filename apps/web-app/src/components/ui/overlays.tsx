'use client';
/**
 * Overlay components: Modal, Menu, Popover, Accordion
 */
import React, { useState, useRef, useEffect } from 'react';
import {
    Dialog as RadixDialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/primitives/dialog';

// ───── Modal (wraps shadcn Dialog) ─────

interface ModalProps {
    children?: React.ReactNode;
    opened?: boolean;
    onClose?: () => void;
    title?: React.ReactNode;
    size?: string;
    className?: string;
    [key: string]: unknown;
}

export const Modal = ({ children, opened, onClose, title, size, className = '' }: ModalProps) => (
    <RadixDialog open={!!opened} onOpenChange={(open: boolean) => { if (!open) onClose?.(); }}>
        <DialogContent className={`${size === 'xl' ? 'max-w-4xl' : size === 'lg' ? 'max-w-2xl' : size === 'sm' ? 'max-w-sm' : 'max-w-md'} ${className}`}>
            {title && (
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription className="sr-only">{title}</DialogDescription>
                </DialogHeader>
            )}
            {children}
        </DialogContent>
    </RadixDialog>
);

// ───── Menu (real dropdown) ─────

interface MenuBaseProps {
    children?: React.ReactNode;
    className?: string;
    [key: string]: unknown;
}

export const Menu = ({ children, className = '' }: MenuBaseProps) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open]);

    return (
        <div className={`relative inline-block ${className}`} ref={ref}>
            {React.Children.map(children, (child) => {
                if (!React.isValidElement(child)) return child;
                const childType = (child as React.ReactElement & { type: unknown }).type;
                if (childType === Menu.Target) {
                    return React.cloneElement(child as React.ReactElement<{ onClick?: () => void }>, { onClick: () => setOpen(v => !v) });
                }
                if (childType === Menu.Dropdown) {
                    return open ? child : null;
                }
                return child;
            })}
        </div>
    );
};

interface MenuTargetProps { children?: React.ReactNode; onClick?: () => void;[key: string]: unknown; }
Menu.Target = function MenuTarget({ children, onClick }: MenuTargetProps) {
    return <div onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }} role="button" tabIndex={0} className="cursor-pointer">{children}</div>;
};

interface MenuDropdownProps { children?: React.ReactNode; className?: string;[key: string]: unknown; }
Menu.Dropdown = function MenuDropdown({ children, className = '' }: MenuDropdownProps) {
    return (
        <div className={`animate-in fade-in-0 zoom-in-95 absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-xl border border-border bg-card py-1 shadow-card ${className}`}>
            {children}
        </div>
    );
};

interface MenuItemProps { children?: React.ReactNode; onClick?: () => void; icon?: React.ReactNode; color?: string; className?: string;[key: string]: unknown; }
Menu.Item = function MenuItem({ children, onClick, icon, color, className = '' }: MenuItemProps) {
    return (
        <button type="button" onClick={onClick}
            className={`mx-0.5 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${color === 'red' ? 'text-destructive hover:bg-destructive/10' : ''} ${className}`}>
            {icon && <span className="h-4 w-4 flex-shrink-0">{icon}</span>}
            <span>{children}</span>
        </button>
    );
};

interface MenuLabelProps { children?: React.ReactNode; className?: string;[key: string]: unknown; }
Menu.Label = function MenuLabel({ children, className = '' }: MenuLabelProps) {
    return <div className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground ${className}`}>{children}</div>;
};
Menu.Divider = function MenuDivider() { return <hr className="my-1 border-border" />; };

// ───── Popover ─────

interface PopoverProps { children?: React.ReactNode; className?: string;[key: string]: unknown; }
export const Popover = ({ children, className = '' }: PopoverProps) => (
    <div className={`relative ${className}`}>{children}</div>
);

interface PopoverChildProps { children?: React.ReactNode; className?: string;[key: string]: unknown; }
Popover.Target = function PopoverTarget({ children }: PopoverChildProps) { return <>{children}</>; };
Popover.Dropdown = function PopoverDropdown({ children, className = '' }: PopoverChildProps) {
    return <div className={`absolute z-50 min-w-max rounded-xl border border-border bg-card p-2 shadow-card ${className}`}>{children}</div>;
};

// ───── Accordion (details/summary) ─────

interface AccordionChildProps { children?: React.ReactNode; className?: string;[key: string]: unknown; }

export const Accordion = ({ children, className = '' }: AccordionChildProps) => (
    <div className={`divide-y divide-slate-200 rounded-lg border border-border ${className}`}>{children}</div>
);
Accordion.Item = function AccordionItem({ children, className = '' }: AccordionChildProps) {
    return <details className={`group ${className}`}>{children}</details>;
};
Accordion.Control = function AccordionControl({ children, className = '' }: AccordionChildProps) {
    return (
        <summary className={`flex w-full cursor-pointer select-none list-none items-center justify-between px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 ${className}`}>
            {children}
            <svg className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </summary>
    );
};
Accordion.Panel = function AccordionPanel({ children, className = '' }: AccordionChildProps) {
    return <div className={`px-4 pb-3 text-sm text-muted-foreground ${className}`}>{children}</div>;
};
