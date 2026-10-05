'use client';


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
    rankOf, deadlineOf, retentionOf, readAtOf,
    type NotificationRank, type InboxRow,
} from '@/lib/notification-rank';
import { Bell, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/primitives/card';

interface Notification {
    id: string;
    title: string;
    message: string;
    // The back end writes one of 33 EVENT names here far more often than it writes a
    // severity word, so this drives the WORDS and the button — never the colour.
    type: string;
    read: boolean;
    isRead?: boolean;
    createdAt: string;
    actionUrl?: string;
    actionLabel?: string;
    // Already written on every row and already on the wire — the door returns whole
    // rows with no `select`. See lib/notification-rank.ts for why rank reads these.
    kind?: string | null;
    priority?: number | null;
    metadata?: unknown;
}


export default function NotificationsPage() {
    const router = useRouter();
    const { dict, language } = useLanguage();
    const notifDict = dict.notifications;
    const dateLocale = language === 'en' ? 'en-US' : 'th-TH';
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [mounted, setMounted] = useState(false);
    const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
    // X1-FIX-C / H-2 — explicit fetch-error state.
    //
    // Previously both the envelope-level !success branch and the catch
    // handler reset notifications to [] without surfacing why, so an
    // outage rendered the "no notifications" EmptyState — applicants
    // missed status updates during incidents and assumed all was quiet.
    // We now record the message and render a rose error card with retry
    // (pattern: health/payments + health/certificates).
    const [fetchError, setFetchError] = useState<string | null>(null);

    useEffect(() => {
        setMounted(true);
    if (!AuthService.getUser()) { router.push("/auth/health/login"); return; }
        loadNotifications();
        // reason: loadNotifications is defined below in the same render scope; it captures
        // only stable setState handles + the static `dict.common.fetchError.hint` fallback
        // string. Including it in deps would require useCallback wrap that re-fires on
        // every dict reference change (i.e. every language toggle), causing a refetch we
        // don't want on language switch. Pre-X1-FIX-C this useEffect didn't trigger the
        // exhaustive-deps warning because loadNotifications was inlined; X1-FIX-C extracted
        // it to add fetchError state. Suppression here is the surgical fix.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router]);

    const loadNotifications = async () => {
        setLoading(true);
        setFetchError(null);
        try {
            const result = await api.get<Notification[]>("/notifications");
            // apiClient already unwraps one envelope level (api-client.ts:410)
            // and the backend returns single-level `{ success, data: [...] }`
            // (system/notifications.js:33) — so `result.data` IS the array.
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
    // bell badge never cleared. Pinned by notifications-route-contract.test.ts
    // (provider/notifications/__tests__ — covers BOTH portal twins).
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

    // Colour and icon come from the RANK, not from `type`.
    //
    // `type` is an open vocabulary of 33 event names and grows with every feature; the
    // switch that used to live here waited for 'SUCCESS' | 'WARNING' | 'DANGER', which
    // the back end writes at only 17 call sites, so every event-named row rendered as
    // the same blue info line — and 'ERROR', which IS written, fell through too because
    // the switch spelled it 'DANGER'. lib/notification-rank.ts carries the reasoning.
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
                {/* Wave E.2-B: SummaryHeader replaces inline header.
                    Unread count moves from inline Badge into the metrics
                    grid; "mark all as read" stays as the action button. */}
                <SummaryHeader
                    eyebrow={dict.eyebrow.applicantNotifications}
                    title={notifDict.title}
                    description={`${notifDict.subtitle} · ${notifDict.retentionNote}`}
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

                {/* Filter Tabs */}
                <SegmentedControl
                    value={filter}
                    onChange={(v: string) => setFilter(v as 'ALL' | 'UNREAD')}
                    data={[
                        { label: `${dict.common.all} (${notifications.length})`, value: 'ALL' },
                        { label: `${notifDict.unread} (${unreadCount})`, value: 'UNREAD' },
                    ]}
                />

                {/* Notifications List
                    X1-FIX-C / H-2 — when the fetch failed we surface a
                    distinct rose card with retry rather than falling
                    through to the EmptyState (which historically masked
                    outages as a "clean inbox"). */}
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
                            const openedAt = readAtOf(row);
                            const due = deadlineOf(row);
                            const retention = retentionOf(row);
                            const handleActivate = () => {
                                if (!isInert) markAsRead(n.id || '');
                            };
                            // X6-B: notification card contains a nested Button (action link)
                            // so we can't promote the row itself to <button>. Instead we
                            // keep <div> + add keyboard handlers + role="button" so SRs
                            // announce activation. Nested Button's onClick stopPropagation
                            // already prevents double-firing. tabIndex=-1 when inert
                            // removes it from tab order for already-read notifications.
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
                                        {/* What the row IS, said out loud: an official letter is a
                                            permanent legal record — the back end already exempts it
                                            from a PDPA erasure request and from the weekly sweep —
                                            and a due date is a date, not a sentence buried in prose. */}
                                        <div className="mb-3 flex flex-wrap items-center gap-2">
                                            {rank === 'OFFICIAL_LETTER' && (
                                                <>
                                                    <Badge size="xs" color="red">{notifDict.officialLetter}</Badge>
                                                    <span className="text-xs text-muted-foreground">
                                                        {notifDict.officialLetterKept}
                                                    </span>
                                                    {/* N6 — a letter is a legal record, and a deadline counted from
                                                        delivery is only defensible if the platform can say when
                                                        delivery was acknowledged. The stamp was always stored and
                                                        always sent; nothing had ever shown it. Unread letters show
                                                        no line at all rather than an empty one. */}
                                                    {openedAt && (
                                                        <span className="text-xs text-muted-foreground">
                                                            {notifDict.letterOpenedAt.replace('{date}', formatDeadline(openedAt))}
                                                        </span>
                                                    )}
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
