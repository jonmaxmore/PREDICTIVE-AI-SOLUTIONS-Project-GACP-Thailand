'use client';

import { Skeleton } from '@/components/ui/skeleton';
interface PageSkeletonProps {
    type?: 'dashboard' | 'list' | 'detail' | 'form' | 'table';
}

/**
 * X1-FIX-D / M-15 — a11y shell for ALL PageSkeleton variants.
 *
 * Wraps every variant in a `role="status" aria-live="polite"
 * aria-busy="true"` container with a visually hidden Thai label so
 * screen readers announce "กำลังโหลด..." when any loading skeleton
 * mounts. The visual layout is unchanged (the inline-block wrapper
 * + `sr-only` label add no pixels in the document flow).
 *
 * WCAG 4.1.2 Name, Role, Value AA — prior to this fix, screen-reader
 * users heard nothing during dashboard/list/detail loading; with `aria-busy`
 * AT's announce the loading state and can suppress the inner skeleton
 * content from being read aloud.
 */
function LoadingShell({ children }: { children: React.ReactNode }) {
    return (
        <div role="status" aria-live="polite" aria-busy="true">
            <span className="sr-only">กำลังโหลด...</span>
            {children}
        </div>
    );
}

export function PageSkeleton({ type = 'dashboard' }: PageSkeletonProps) {
    if (type === 'dashboard') {
        return (
            <LoadingShell>
                <div className="mx-auto w-full px-4">
                    {/* Header */}
                    <div className="mb-6 flex flex-wrap items-center">
                        <Skeleton height={56} width={56} circle />
                        <div className="flex flex-col gap-2" style={{ flex: 1 }}>
                            <Skeleton height={28} width="40%" />
                            <Skeleton height={16} width="60%" />
                        </div>
                    </div>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-2 gap-4">
                        {[1, 2, 3, 4].map((i) => (
                            <div className="rounded-lg bg-card p-4 shadow-sm" key={i}>
                                <div className="mb-2 flex flex-wrap items-center">
                                    <Skeleton height={20} width="50%" />
                                    <Skeleton height={32} width={32} circle />
                                </div>
                                <Skeleton height={32} width="40%" />
                                <Skeleton height={12} width="70%" />
                            </div>
                        ))}
                    </div>

                    {/* Main Content */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-lg bg-card p-5 shadow-sm">
                            <Skeleton height={24} width="40%" />
                            <div className="flex flex-col gap-3">
                                {[1, 2, 3].map((i) => (
                                    <div className="flex flex-wrap items-center gap-3" key={i}>
                                        <Skeleton height={40} width={40} circle />
                                        <div className="flex flex-col" style={{ flex: 1 }}>
                                            <Skeleton height={16} width="60%" />
                                            <Skeleton height={12} width="40%" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="rounded-lg bg-card p-5 shadow-sm">
                            <Skeleton height={24} width="40%" />
                            <Skeleton height={200} />
                        </div>
                    </div>
                </div>
            </LoadingShell>
        );
    }

    if (type === 'list') {
        return (
            <LoadingShell>
                <div className="mx-auto w-full px-4">
                    {/* Header */}
                    <div className="mb-6 flex flex-wrap items-center">
                        <div className="flex flex-col gap-2">
                            <Skeleton height={32} width={200} />
                            <Skeleton height={16} width={300} />
                        </div>
                        <Skeleton height={40} width={120} />
                    </div>

                    {/* Filters */}
                    <div className="mb-5 flex flex-wrap items-center">
                        <Skeleton height={36} width={200} />
                        <Skeleton height={36} width={150} />
                    </div>

                    {/* List Items */}
                    <div className="flex flex-col gap-4">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div className="rounded-lg bg-card p-4 shadow-sm" key={i}>
                                <div className="flex flex-wrap items-center">
                                    <div className="flex flex-wrap items-center gap-4">
                                        <Skeleton height={48} width={48} />
                                        <div className="flex flex-col">
                                            <Skeleton height={18} width={200} />
                                            <Skeleton height={14} width={150} />
                                        </div>
                                    </div>
                                    <Skeleton height={24} width={80} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </LoadingShell>
        );
    }

    if (type === 'detail') {
        return (
            <LoadingShell>
                <div className="mx-auto w-full px-4">
                    {/* Back Button */}
                    <Skeleton height={36} width={100} />

                    {/* Header */}
                    <div className="mb-5 rounded-lg bg-card p-6 shadow-sm">
                        <div className="mb-5 flex flex-wrap items-center">
                            <Skeleton height={64} width={64} circle />
                            <div className="flex flex-col gap-2" style={{ flex: 1 }}>
                                <Skeleton height={28} width="50%" />
                                <div className="flex flex-wrap items-center gap-2">
                                    <Skeleton height={20} width={80} />
                                    <Skeleton height={16} width={120} />
                                </div>
                            </div>
                        </div>
                        <Skeleton height={1} />
                        <div className="grid grid-cols-2 gap-4">
                            {[1, 2, 3, 4].map((i) => (
                                <div className="flex flex-col" key={i}>
                                    <Skeleton height={12} width="30%" />
                                    <Skeleton height={20} width="70%" />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Content Sections */}
                    {[1, 2].map((i) => (
                        <div className="mb-5 rounded-lg bg-card p-5 shadow-sm" key={i}>
                            <Skeleton height={24} width="30%" />
                            <div className="flex flex-col gap-3">
                                <Skeleton height={16} width="100%" />
                                <Skeleton height={16} width="90%" />
                                <Skeleton height={16} width="80%" />
                            </div>
                        </div>
                    ))}
                </div>
            </LoadingShell>
        );
    }

    if (type === 'form') {
        return (
            <LoadingShell>
                <div className="mx-auto w-full px-4">
                    <div className="rounded-lg bg-card p-6 shadow-sm">
                        <Skeleton height={32} width="50%" />
                        <div className="flex flex-col gap-5">
                            {[1, 2, 3, 4].map((i) => (
                                <div className="flex flex-col" key={i}>
                                    <Skeleton height={14} width="20%" />
                                    <Skeleton height={42} width="100%" />
                                </div>
                            ))}
                            <div className="mt-4 flex flex-wrap items-center">
                                <Skeleton height={40} width={100} />
                                <Skeleton height={40} width={120} />
                            </div>
                        </div>
                    </div>
                </div>
            </LoadingShell>
        );
    }

    if (type === 'table') {
        return (
            <LoadingShell>
                <div className="mx-auto w-full px-4">
                    {/* Header */}
                    <div className="mb-6 flex flex-wrap items-center">
                        <Skeleton height={32} width={200} />
                        <Skeleton height={40} width={120} />
                    </div>

                    {/* Table */}
                    <div className="rounded-lg bg-card shadow-sm" style={{ overflow: 'hidden' }}>
                        {/* Table Header */}
                        <div className="p-4">
                            <div className="flex flex-wrap items-center">
                                {[1, 2, 3, 4, 5].map((i) => (
                                    <Skeleton key={i} height={16} width={`${100 / 5}%`} />
                                ))}
                            </div>
                        </div>
                        {/* Table Rows */}
                        <div className="flex flex-col">
                            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                                <div className="border-b border-mantine-gray-2 p-4" key={i}>
                                    <div className="flex flex-wrap items-center">
                                        {[1, 2, 3, 4, 5].map((j) => (
                                            <Skeleton key={j} height={14} width={`${100 / 5}%`} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </LoadingShell>
        );
    }

    return null;
}

// Card Skeleton for reuse
export function CardSkeleton() {
    return (
        <div className="animate-pulse rounded-lg bg-card p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center">
                <Skeleton height={20} width="60%" />
                <Skeleton height={24} width={24} circle />
            </div>
            <Skeleton height={40} width="40%" />
            <Skeleton height={12} width="80%" />
        </div>
    );
}

// List Item Skeleton
export function ListItemSkeleton() {
    return (
        <div className="rounded-lg bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center">
                <Skeleton height={48} width={48} />
                <div className="flex flex-col" style={{ flex: 1 }}>
                    <Skeleton height={18} width="50%" />
                    <Skeleton height={14} width="30%" />
                </div>
                <Skeleton height={24} width={60} />
            </div>
        </div>
    );
}

// Stats Card Skeleton
export function StatsCardSkeleton() {
    return (
        <div className="rounded-lg bg-card p-4 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center">
                <Skeleton height={16} width="40%" />
                <Skeleton height={32} width={32} circle />
            </div>
            <Skeleton height={28} width="30%" />
            <Skeleton height={12} width="60%" />
        </div>
    );
}

export default PageSkeleton;
