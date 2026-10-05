'use client';

/**
 * P0-C — staff notifications inbox (provider portal).
 *
 * Adapted from health/notifications/client-view.tsx (same GET /notifications
 * backend, same envelope) with the provider auth guard + staff eyebrow. Kept
 * as a sibling copy rather than a shared component so the LIVE applicant
 * surface carries zero regression risk; unification is a Wave-3 refactor
 * candidate once both portals' chrome settles.
 */

import { Container } from '@/components/ui/layout-utils';
import { ThemeIcon } from '@/components/ui/icon-buttons';
import { SegmentedControl } from '@/components/ui/data-components';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';

import { PageSkeleton } from '@/components/ui/page-skeleton';
import { EmptyState } from '@/components/feature/empty-state';
import { SummaryHeader } from '@/components/feature';
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient as api } from "@/lib/api";
import { AuthService } from "@/lib/services/auth-service";
import { useLanguage } from "@/lib/i18n/language-context";

import { IconCheck, IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import {
    rankOf, deadlineOf, retentionOf,
    type NotificationRank, type InboxRow,
} from '@/lib/notification-rank';
import { Bell, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/primitives/card';

interface Notification {
    id: string;
    title: string;
    message: string;
    // 33 EVENT names far more often than a severity word — this drives the WORDS
    // and the button, never the colour. See lib/notification-rank.ts.
    type: string;
    read: boolean;
    isRead?: boolean;
    createdAt: string;
    actionUrl?: string;
    actionLabel?: string;
    kind?: string | null;
    priority?: number | null;
    metadata?: unknown;
}

export default function ProviderNotificationsView() {
    const router = useRouter();
    const { dict, language } = useLanguage();
    const notifDict = dict.notifications;
    const dateLocale = language === 'en' ? 'en-US' : 'th-TH';
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [mounted, setMounted] = useState(false);
    const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
    const [fetchError, setFetchError] = useState<string | null>(null);

    useEffect(() => {
        setMounted(true);
        // Provider guard — the health twin redirects to the applicant login.
        if (!AuthService.getUser()) { router.push("/auth/provider/login"); return; }
        loadNotifications();
        // reason: mirrors health/notifications — loadNotifications captures only
        // stable setState handles; including it would force a useCallback that
        // refires on language toggle.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);

    const loadNotifications = async () => {
        setLoading(true);
        setFetchError(null);
        try {
            const result = await api.get<Notification[]>("/notifications");
            if (result.success && Array.isArray(result.data)) {
                setNotifications(result.data);
            } else {
                setFetchError(result.error || dict.common?.fetchError?.hint || 'Unable to load notifications');
                setNotifications([]);
            }
        } catch (err) {
            const message = err instanceof Error && err.message
                ? err.message
                : (dict.common?.fetchError?.hint || 'Unable to load notifications');
            setFetchError(message);
            setNotifications([]);
        }
        finally { setLoading(false); }
    };

    // M1: the backend serves PUT /notifications/:id/read + PUT
    // /notifications/mark-all-read (routes/api/system/notifications.js).
    // The old POST calls hit nonexistent routes (wrong method + an '/api/'
    // double-prefix the sibling GET does not have) — the catch{} +
    // optimistic setState hid it, so read-state never persisted and the
    // bell badge never cleared. Pinned by notifications-route-contract.test.ts.
    const markAsRead = async (id: string) => {
        try { await api.put<unknown>(`/notifications/${id}/read`, {}); } catch { }
        setNotifications(prev => prev.map(n => (n.id === id) ? { ...n, read: true } : n));
    };

    const markAllAsRead = async () => {
        try { await api.put<unknown>("/notifications/mark-all-read", {}); } catch { /* ignore */ }
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    const formatTime = (date: string) => {
        const diff = Date.now() - new Date(date).getTime();
        const mins = Math.floor(diff / 60000), hours = Math.floor(diff / 3600000), days = Math.floor(diff / 86400000);
        if (mins < 60) return dict.time.minutesAgo.replace('{n}', String(mins));
        if (hours < 24) return dict.time.hoursAgo.replace('{n}', String(hours));
        if (days < 7) return dict.time.daysAgo.replace('{n}', String(days));
        return new Date(date).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' });
    };

    if (!mounted) return null;

    const unreadCount = notifications.filter(n => !n.read && !n.isRead).length;
    const filteredNotifications = filter === 'UNREAD' ? notifications.filter(n => !n.read && !n.isRead) : notifications;

    // Rank, not `type` — the staff inbox carried the identical defect: the switch
    // waited for 'DANGER' while the back end writes 'ERROR', and every event-named
    // row fell through to blue. lib/notification-rank.ts carries the reasoning.
    const rankColor = (rank: NotificationRank) => {
        switch (rank) {
            case 'OFFICIAL_LETTER': return 'red';
            case 'ACTION_DUE': return 'yellow';
            default: return 'blue';
        }
    };

    const rankIcon = (rank: NotificationRank) => {
        switch (rank) {
            case 'OFFICIAL_LETTER': return <IconCheck size={20} />;
            case 'ACTION_DUE': return <IconAlertTriangle size={20} />;
            default: return <IconInfoCircle size={20} />;
        }
    };

    const formatDeadline = (date: Date) => date.toLocaleDateString(dateLocale, {
        year: 'numeric', month: 'long', day: 'numeric',
    });

    return (
        <Container size="full">
            <div className="flex flex-col gap-5">
                <SummaryHeader
                    eyebrow={dict.eyebrow.staffNotifications}
                    title={notifDict.title}
                    description={notifDict.subtitle}
                    metrics={[
                        { label: dict.common.all, value: notifications.length.toLocaleString(dateLocale), icon: '🔔' },
                        { label: notifDict.unread, value: unreadCount.toLocaleString(dateLocale), icon: '🆕' },
                    ]}
                    actions={
                        unreadCount > 0 ? (
                            <Button onClick={markAllAsRead}>
                                {notifDict.markAllRead}
                            </Button>
                        ) : undefined
                    }
                />

                <SegmentedControl
                    value={filter}
                    onChange={(v: string) => setFilter(v as 'ALL' | 'UNREAD')}
                    data={[
                        { label: `${dict.common.all} (${notifications.length})`, value: 'ALL' },
                        { label: `${notifDict.unread} (${unreadCount})`, value: 'UNREAD' },
                    ]}
                />

                {loading ? (
                    <PageSkeleton type="list" />
                ) : fetchError ? (
                    <Card
                        data-testid="notifications-fetch-error"
                        role="alert"
                        className="rounded-2xl border-2 border-rose-200 bg-rose-50/60 p-8 text-center"
                    >
                        <AlertCircle className="mx-auto mb-3 h-10 w-10 text-rose-500" aria-hidden="true" focusable="false" />
                        <h3 className="text-base font-bold text-rose-800">
                            {dict.common?.fetchError?.title || 'Unable to load data'}
                        </h3>
                        <p className="mt-1 text-sm text-rose-700">{fetchError}</p>
                        <Button
                            type="button"
                            variant="outline"
                            className="mt-4 rounded-full border-rose-300 text-rose-700 hover:bg-rose-100"
                            onClick={() => loadNotifications()}
                        >
                            {dict.common?.fetchError?.retry || 'Try again'}
                        </Button>
                    </Card>
                ) : filteredNotifications.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        {filteredNotifications.map(n => {
                            const isInert = !!(n.read || n.isRead);
                            const row = n as unknown as InboxRow;
                            const rank = rankOf(row);
                            const due = deadlineOf(row);
                            const retention = retentionOf(row);
                            const handleActivate = () => {
                                if (!isInert) markAsRead(n.id || '');
                            };
                            return (
                            <div
                                className={`rounded-lg bg-card p-3 shadow-sm transition-all duration-200 hover:bg-muted/30 hover:shadow-md sm:p-4 ${
                                    isInert
                                        ? 'cursor-default opacity-70'
                                        : 'cursor-pointer opacity-100'
                                }`}
                                key={n.id}
                                role="button"
                                tabIndex={isInert ? -1 : 0}
                                aria-disabled={isInert || undefined}
                                onClick={handleActivate}
                                onKeyDown={(e) => {
                                    if (isInert) return;
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        handleActivate();
                                    }
                                }}
                            >
                                <div className="flex flex-wrap items-center gap-4">
                                    <ThemeIcon
                                        size={44}
                                        color={rankColor(rank)}
                                    >
                                        {rankIcon(rank)}
                                    </ThemeIcon>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center justify-between">
                                            <p className="font-semibold text-foreground">{n.title}</p>
                                            <div className="flex flex-wrap items-center gap-2">
                                                {!n.read && !n.isRead && (
                                                    <Badge size="xs" color="green">{notifDict.new}</Badge>
                                                )}
                                                <p className="text-xs text-muted-foreground">{formatTime(n.createdAt)}</p>
                                            </div>
                                        </div>
                                        <p className="mb-3 text-sm text-muted-foreground">{n.message}</p>
                                        <div className="mb-3 flex flex-wrap items-center gap-2">
                                            {rank === 'OFFICIAL_LETTER' && (
                                                <>
                                                    <Badge size="xs" color="red">{notifDict.officialLetter}</Badge>
                                                    <span className="text-xs text-muted-foreground">
                                                        {notifDict.officialLetterKept}
                                                    </span>
                                                </>
                                            )}
                                            {rank !== 'OFFICIAL_LETTER' && due && (
                                                <Badge size="xs" color={due.getTime() < Date.now() ? 'red' : 'yellow'}>
                                                    {due.getTime() < Date.now()
                                                        ? notifDict.overdue
                                                        : notifDict.dueBy.replace('{date}', formatDeadline(due))}
                                                </Badge>
                                            )}
                                            {rank !== 'OFFICIAL_LETTER' && (
                                                <span className="text-xs text-muted-foreground">
                                                    {retention === 'THIRTY_DAYS_AFTER_READ'
                                                        ? notifDict.keptThirtyDays
                                                        : notifDict.keptUntilRead}
                                                </span>
                                            )}
                                        </div>
                                        {n.actionUrl && (
                                            <Button
                                                href={n.actionUrl}
                                                size="sm"
                                                color="green"
                                                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                            >
                                                {n.actionLabel || notifDict.viewDetails}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                ) : (
                    <EmptyState
                        title={filter === 'UNREAD' ? notifDict.noUnread : notifDict.empty}
                        hint={filter === 'UNREAD' ? notifDict.noUnreadDesc : notifDict.emptyDesc}
                        icon={Bell}
                    />
                )}
            </div>
        </Container>
    );
}
