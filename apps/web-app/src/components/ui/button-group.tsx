'use client';

import { cn } from '@/lib/utils';

/* ─── types ─────────────────────────────────────────────── */
export interface ButtonGroupOption {
    value: string;
    label: string;
    icon?: string;        // emoji or short text
    description?: string; // optional helper text below label
}

interface ButtonGroupProps {
    options: ButtonGroupOption[];
    value?: string | undefined;
    onChange: (value: string) => void;
    label?: string | undefined;
    description?: string | undefined;
    required?: boolean | undefined;
    error?: string | undefined;
    /** 'wrap' (default) wraps items; 'grid' uses CSS grid with equal widths */
    layout?: 'wrap' | 'grid' | undefined;
    /** Number of columns for grid layout (default: auto-fit) */
    columns?: number | undefined;
    className?: string | undefined;
}

/* ─── component ─────────────────────────────────────────── */
export function ButtonGroup({
    options,
    value,
    onChange,
    label,
    description,
    required,
    error,
    layout = 'wrap',
    columns,
    className,
}: ButtonGroupProps) {
    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            {label && (
                <label className="text-sm font-medium text-foreground">
                    {label}
                    {required && <span className="ml-0.5 text-red-500">*</span>}
                </label>
            )}
            {description && (
                <p className="text-xs text-muted-foreground">{description}</p>
            )}
            <div
                className={cn(
                    layout === 'grid'
                        ? 'grid gap-2'
                        : 'flex flex-wrap gap-2',
                )}
                style={
                    layout === 'grid' && columns
                        ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
                        : layout === 'grid'
                            ? { gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }
                            : undefined
                }
            >
                {options.map((opt) => {
                    const selected = value === opt.value;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => onChange(opt.value)}
                            className={cn(
                                'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-all',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-600 focus-visible:ring-offset-1',
                                selected
                                    ? 'border-leaf-700 bg-leaf-soft text-leaf-onSoft ring-1 ring-leaf-600'
                                    : 'border-border bg-card text-foreground hover:border-slate-400 hover:bg-slate-50',
                            )}
                        >
                            {opt.icon && <span className="text-base">{opt.icon}</span>}
                            <span>{opt.label}</span>
                        </button>
                    );
                })}
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
    );
}

export default ButtonGroup;
