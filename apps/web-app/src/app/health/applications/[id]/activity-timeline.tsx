"use client";

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/primitives/badge';
import { Spinner } from '@/components/ui/spinner';
import { IconClock, IconCheck, IconLoader, IconAlertCircle } from '@tabler/icons-react';
import { apiClient as api } from '@/lib/api';
import { useLanguage } from '@/lib/i18n/language-context';

type ActivityStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';

interface ActivityEntry {
    id: string;
    workType: string;
    workTypeLabel: string;
    status: ActivityStatus;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
    isOverdue: boolean;
}

function statusColor(status: ActivityStatus, isOverdue: boolean) {
    if (status === 'done') return 'green' as const;
    if (status === 'cancelled') return 'gray' as const;
    if (isOverdue) return 'red' as const;
    if (status === 'in_progress') return 'blue' as const;
    return 'yellow' as const;
}

function StatusIcon({ status, isOverdue }: { status: ActivityStatus; isOverdue: boolean }) {
    if (status === 'done') return <IconCheck size={16} className="text-leaf-700" />;
    if (status === 'cancelled') return <IconAlertCircle size={16} className="text-slate-400" />;
    if (isOverdue) return <IconAlertCircle size={16} className="text-red-600" />;
    if (status === 'in_progress') return <IconLoader size={16} className="animate-spin text-blue-600" />;
    return <IconClock size={16} className="text-amber-600" />;
}

function fmt(iso: string | null, language: 'th' | 'en') {
    if (!iso) return '-';
    return new Date(iso).toLocaleString(language === 'en' ? 'en-US' : 'th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

interface Props {
    applicationId: string;
}

export function HealthActivityTimeline({ applicationId }: Props) {
    const { dict, language } = useLanguage();
    const timelineCopy = dict.health.timeline;
    const [activities, setActivities] = useState<ActivityEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let aborted = false;
        setIsLoading(true);
        api.get<ActivityEntry[]>(`/applications/${encodeURIComponent(applicationId)}/activities`)
            .then((res) => {
                if (aborted) return;
                if (res.success && Array.isArray(res.data)) {
                    setActivities(res.data);
                } else {
                    setActivities([]);
                }
            })
            .finally(() => {
                if (!aborted) setIsLoading(false);
            });
        return () => { aborted = true; };
    }, [applicationId]);

    if (isLoading) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-card p-6 text-center">
                <Spinner />
            </div>
        );
    }

    if (activities.length === 0) {
        return null; // Hide the section entirely when there are no activities yet
    }

    const open = activities.filter((a) => a.status === 'pending' || a.status === 'in_progress');
    const done = activities.filter((a) => a.status === 'done' || a.status === 'cancelled');

    return (
        <div className="rounded-2xl border border-slate-200 bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
                <IconClock size={18} className="text-leaf-700" />
                <h2 className="text-lg font-bold tracking-tight text-foreground">{timelineCopy.heading}</h2>
            </div>

            {open.length > 0 ? (
                <div className="mb-5">
                    <h3 className="mb-2 text-xs font-bold text-muted-foreground">
                        {timelineCopy.inProgress} ({open.length})
                    </h3>
                    <ul className="space-y-2">
                        {open.map((a) => (
                            <li
                                key={a.id}
                                className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3"
                            >
                                <StatusIcon status={a.status} isOverdue={a.isOverdue} />
                                <div className="flex-1 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium">{a.workTypeLabel}</span>
                                        <Badge color={statusColor(a.status, a.isOverdue)}>
                                            {a.isOverdue ? `${timelineCopy.status.overdue} · ${timelineCopy.status[a.status]}` : timelineCopy.status[a.status]}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {timelineCopy.startedAt} {fmt(a.createdAt, language)}
                                        {a.startedAt ? <span> · {timelineCopy.officerAccepted} {fmt(a.startedAt, language)}</span> : null}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {done.length > 0 ? (
                <div>
                    <h3 className="mb-2 text-xs font-bold text-muted-foreground">
                        {timelineCopy.done} ({done.length})
                    </h3>
                    <ul className="space-y-2">
                        {done.map((a) => (
                            <li
                                key={a.id}
                                className="flex items-start gap-3 rounded-lg border border-slate-100 bg-card p-3"
                            >
                                <StatusIcon status={a.status} isOverdue={false} />
                                <div className="flex-1 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium">{a.workTypeLabel}</span>
                                        <Badge color={statusColor(a.status, false)}>
                                            {timelineCopy.status[a.status]}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {a.completedAt ? `${timelineCopy.completedAt} ${fmt(a.completedAt, language)}` :
                                         a.cancelledAt ? `${timelineCopy.cancelledAt} ${fmt(a.cancelledAt, language)}` :
                                         `${timelineCopy.updated} ${fmt(a.createdAt, language)}`}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <p className="mt-4 text-[11px] italic text-muted-foreground">
                {timelineCopy.footnote}
            </p>
        </div>
    );
}
