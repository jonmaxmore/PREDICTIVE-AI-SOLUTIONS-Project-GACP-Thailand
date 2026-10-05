'use client';
/**
 * Data display components: Avatar, Timeline, Stepper, Progress, RingProgress,
 * Rating, Indicator, Pagination, List, Image, LoadingOverlay, Card (compat), SegmentedControl
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';

type AnyProps = Record<string, any>;

export const Avatar = ({ children, className = '', src, alt, ...props }: AnyProps) => (
    src
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt={alt || ''} className={`inline-block h-10 w-10 rounded-full object-cover ${className}`} />
        : <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 font-semibold text-muted-foreground ${className}`} {...props}>{children}</span>
);

export const Timeline = ({ children, className = '' }: AnyProps) => (
    <ol className={`relative ml-3 flex flex-col gap-4 border-l-2 border-border ${className}`}>{children}</ol>
);
Timeline.Item = function TimelineItem({ children, className = '', bullet, title }: AnyProps) {
    return (
        <li className={`relative ml-4 ${className}`}>
            <span className="absolute -left-5 flex h-6 w-6 items-center justify-center rounded-full bg-teal-100 text-teal-600 ring-4 ring-white">{bullet}</span>
            {title && <p className="mb-1 text-sm font-semibold">{title}</p>}
            {children}
        </li>
    );
};

export const Stepper = ({ children, active = 0, className = '' }: AnyProps) => (
    <div className={`flex flex-col gap-4 ${className}`} data-active={active}>{children}</div>
);
Stepper.Step = function StepperStep({ children, className = '', label, description }: AnyProps) {
    return (
        <div className={`flex items-start gap-3 ${className}`}>
            <div className="flex flex-col gap-1">
                {label && <p className="text-sm font-medium">{label}</p>}
                {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </div>
            <div className="flex-1">{children}</div>
        </div>
    );
};
Stepper.Completed = function StepperCompleted({ children, className = '' }: AnyProps) {
    return <div className={`py-4 text-center ${className}`}>{children}</div>;
};

export const Progress = ({ value = 0, className = '' }: AnyProps) => (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-muted ${className}`}>
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
);

export const RingProgress = ({ sections = [], label, size = 100, thickness = 8, className = '' }: AnyProps) => {
    const value = sections[0]?.value || 0;
    return (
        <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <circle cx={size / 2} cy={size / 2} r={(size - thickness) / 2} fill="none" stroke="currentColor" className="text-muted" strokeWidth={thickness} />
                <circle cx={size / 2} cy={size / 2} r={(size - thickness) / 2}
                    fill="none" stroke="currentColor" className="text-primary" strokeWidth={thickness}
                    strokeDasharray={`${2 * Math.PI * (size - thickness) / 2}`}
                    strokeDashoffset={`${2 * Math.PI * (size - thickness) / 2 * (1 - value / 100)}`}
                    strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
            </svg>
            {label && <div className="absolute inset-0 flex items-center justify-center">{label}</div>}
        </div>
    );
};

export const Rating = ({ value = 0, onChange, max = 5, className = '' }: AnyProps) => (
    <div className={`flex gap-0.5 ${className}`}>
        {Array.from({ length: max }, (_, i) => (
            <button key={i} type="button" onClick={() => onChange?.(i + 1)}
                className={`text-xl transition-colors ${i < value ? 'text-amber-400' : 'text-slate-300 hover:text-amber-300'}`}>★</button>
        ))}
    </div>
);

export const Indicator = ({ children, label, disabled, className = '' }: AnyProps) => (
    <div className={`relative inline-flex ${className}`}>
        {children}
        {!disabled && <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{label}</span>}
    </div>
);

export const Pagination = ({ total, value, onChange, className = '' }: AnyProps) => {
    const current = value || 1;
    const pages = Math.max(total || 1, 1);
    const range: (number | '...')[] = [];
    for (let i = 1; i <= pages; i++) {
        if (i === 1 || i === pages || (i >= current - 1 && i <= current + 1)) range.push(i);
        else if (range[range.length - 1] !== '...') range.push('...');
    }
    return (
        <div className={`flex items-center gap-1 ${className}`}>
            <button type="button" onClick={() => onChange?.(Math.max(1, current - 1))} disabled={current <= 1}
                className="rounded-lg border border-border px-2 py-1.5 text-sm transition hover:bg-muted disabled:opacity-40">‹</button>
            {range.map((p, i) => p === '...'
                ? <span key={`e${i}`} className="px-1.5 text-muted-foreground">…</span>
                : <button key={p} type="button" onClick={() => onChange?.(p)}
                    className={`min-w-[32px] rounded-lg border py-1.5 text-sm transition ${current === p ? 'border-primary bg-primary font-semibold text-primary-foreground' : 'border-border hover:bg-muted'}`}>{p}</button>
            )}
            <button type="button" onClick={() => onChange?.(Math.min(pages, current + 1))} disabled={current >= pages}
                className="rounded-lg border border-border px-2 py-1.5 text-sm transition hover:bg-muted disabled:opacity-40">›</button>
        </div>
    );
};

export const List = ({ children, className = '', withPadding }: AnyProps) => (
    <ul className={`space-y-1 ${withPadding ? 'pl-4' : ''} ${className}`}>{children}</ul>
);
List.Item = function ListItem({ children, className = '', icon }: AnyProps) {
    return (
        <li className={`flex items-start gap-2 text-sm ${className}`}>
            {icon && <span className="mt-0.5 flex-shrink-0">{icon}</span>}
            <span>{children}</span>
        </li>
    );
};

 
export const Image = ({ src, alt = '', width, height, className = '' }: AnyProps) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={width} height={height} className={`rounded ${className}`} />
);

export const LoadingOverlay = ({ visible = false, className = '' }: AnyProps) => visible ? (
    <div className={`absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-card/80 ${className}`}>
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-muted border-t-primary" />
    </div>
) : null;

export const SegmentedControl = ({ value, onChange, data = [], className = '' }: AnyProps) => (
    <div className={`flex gap-1 rounded-xl bg-muted p-1 ${className}`}>
        {data.map((item: any) => {
            const val = typeof item === 'string' ? item : item.value;
            const label = typeof item === 'string' ? item : item.label;
            return (
                <button key={val} type="button"
                    className={`flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${value === val ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => onChange?.(val)}
                >{label}</button>
            );
        })}
    </div>
);
