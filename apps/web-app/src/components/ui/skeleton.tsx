"use client";

import { cn } from '@/lib/utils';

interface CustomSkeletonProps {
    circle?: boolean;
    visible?: boolean;
    animate?: boolean;
    width?: string | number;
    height?: string | number;
    borderRadius?: string | number;
    className?: string;
    style?: React.CSSProperties;
    animated?: boolean;
}

export function Skeleton({
    width = "100%",
    height = 20,
    className = "",
    style = {},
    circle, visible: _visible, animate: _animate,
}: CustomSkeletonProps) {
    return (
        <div
            className={cn("animate-pulse rounded-md bg-slate-200", className)}
            style={{ width: circle ? height : width, height, borderRadius: circle ? "50%" : undefined, ...style }}
        />
    );
}

export function DashboardSkeleton() {
    return (
        <div style={{ padding: "32px 40px", maxWidth: "1440px" }}>
            <Skeleton height={50} width={300} style={{ marginBottom: 30 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 30 }}>
                <Skeleton height={120} />
                <Skeleton height={120} />
                <Skeleton height={120} />
                <Skeleton height={120} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
                <Skeleton height={400} />
                <Skeleton height={400} />
            </div>
        </div>
    );
}

export function CardSkeleton() {
    return (
        <div className="rounded-2xl border border-slate-200 p-5">
            <Skeleton width="60%" height={24} style={{ marginBottom: 12 }} />
            <Skeleton width="100%" height={12} style={{ marginBottom: 8 }} />
            <Skeleton width="80%" height={12} />
        </div>
    );
}

export default Skeleton;
