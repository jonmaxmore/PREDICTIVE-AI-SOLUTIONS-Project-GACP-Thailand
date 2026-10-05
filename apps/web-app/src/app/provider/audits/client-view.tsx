"use client";

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from "react";
import ProviderLayout from "../components/provider-layout";
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives/tabs';

import { EmptyState } from '@/components/feature/empty-state';
import {
    KpiTile,
    KpiTileGrid,
    LaunchpadHeader,
    QueueSection,
} from '@/components/provider/launchpad';
import {
    AlertCircle,
    Calendar,
    CalendarClock,
    CheckCircle2,
    ClipboardList,
    Clock,
    RefreshCcw,
    ChevronRight,
    ListChecks,
    MapPin,
    Video,
    AlertTriangle,
} from "lucide-react";
import { notifications } from '@/lib/notifications';
import { providerApiPaths } from "@/lib/services/provider-api";
import { useLanguage } from '@/lib/i18n/language-context';
import {
    type AuditorDashboardData,
    EMPTY_DASHBOARD,
    PROVIDERRequest,
} from "./auditor-types";
import {
    statusTone,
    STATUS_BADGE_CLASSES,
} from "../applications/[id]/provider-application-detail-config";

export default function PROVIDERAuditorDashboardPage() {
    const { dict } = useLanguage();
    const aDict = dict.provider?.audits?.dashboard;
    const [isLoading, setIsLoading] = useState(true);
    const [isStarting, setIsStarting] = useState<string | null>(null);
    const [dashboard, setDashboard] = useState<AuditorDashboardData>(EMPTY_DASHBOARD);
    const [activeQueue, setActiveQueue] = useState("today");
    const fetchDashboard = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await PROVIDERRequest<AuditorDashboardData>(providerApiPaths.auditorDashboard("?limit=100"));
            if (result.success && result.data) {
                setDashboard(result.data);
            } else {
                setDashboard(EMPTY_DASHBOARD);
                notifications.show({
                    color: "red",
                    title: aDict?.loadFailedTitle || "Load failed",
                    message: result.error || aDict?.loadFailed || "Unable to load auditor dashboard",
                    icon: <AlertCircle size={16} />,
                });
            }
        } catch (error: unknown) {
            console.error("[auditor-dashboard] load failed:", error);
            setDashboard(EMPTY_DASHBOARD);
            notifications.show({
                color: "red",
                title: aDict?.loadFailedTitle || "Load failed",
                message: aDict?.loadFailed || "Unable to load auditor dashboard",
                icon: <AlertCircle size={16} />,
            });
        } finally {
            setIsLoading(false);
        }
    }, [aDict?.loadFailedTitle, aDict?.loadFailed]);

    useEffect(() => {
        fetchDashboard();
    }, [fetchDashboard]);

    const queueItems = useMemo(() => {
        if (activeQueue === "in_progress") {
            return dashboard.queues.inProgress.items;
        }
        if (activeQueue === "follow_ups") {
            return dashboard.queues.followUps.items;
        }
        return dashboard.queues.todayUpcoming.items;
    }, [activeQueue, dashboard]);

    const startInspection = async (applicationId: string) => {
        setIsStarting(applicationId);
        try {
            const result = await PROVIDERRequest(providerApiPaths.auditorStartInspection(applicationId), {
                method: "POST",
                body: JSON.stringify({ comment: aDict?.inspectionStartedComment || "Inspection started from auditor dashboard" }),
            });
            if (!result.success) {
                notifications.show({
                    color: "red",
                    title: aDict?.startFailedTitle || "Start failed",
                    message: result.error || aDict?.startFailed || "Unable to start inspection",
                    icon: <AlertCircle size={16} />,
                });
                return;
            }
            notifications.show({
                color: "teal",
                title: aDict?.startSuccessTitle || "Inspection started",
                message: aDict?.startSuccessMessage || "Application moved to in-progress queue",
            });
            await fetchDashboard();
        } catch (error: unknown) {
            console.error("[auditor-dashboard] start inspection failed:", error);
            notifications.show({
                color: "red",
                title: aDict?.startFailedTitle || "Start failed",
                message: aDict?.errorGeneric || "Unexpected error while starting inspection",
                icon: <AlertCircle size={16} />,
            });
        } finally {
            setIsStarting(null);
        }
    };

    if (isLoading) {
        return (
            <ProviderLayout title={aDict?.title || "ผู้ตรวจประเมิน"} subtitle={aDict?.description || "คิว, ปฏิทิน และ KPI"}>
                <div className="flex items-center justify-center">
                    <Spinner color="teal" />
                </div>
            </ProviderLayout>
        );
    }

    return (
        <ProviderLayout>
            <div className="animate-fade-in space-y-4">
                {/* B3 — Fiori launchpad header band (replaces the gov-gradient hero).
                    Greeting kicker + role title + a one-line summary, refresh action
                    right-aligned. Token-only, compact. */}
                <LaunchpadHeader
                    greeting={aDict?.eyebrow || "หน้าหลักผู้ตรวจประเมิน"}
                    title="ผู้ตรวจประเมิน"
                    subtitle={aDict?.description || "จัดการคิวการตรวจ ติดตามผล และดูปฏิทินงานของคุณในที่เดียว"}
                    actions={
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchDashboard()}
                            className="min-h-[44px] focus-visible:ring-2 focus-visible:ring-offset-2"
                            aria-label={aDict?.refreshAria || "รีเฟรชข้อมูล"}
                        >
                            <RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                            {aDict?.refresh || "รีเฟรชข้อมูล"}
                        </Button>
                    }
                />

                {/* B3 — KPI tile grid mapping the auditor-dashboard kpi fields. */}
                <KpiTileGrid>
                    <KpiTile
                        label={aDict?.metrics?.scheduledThisWeek || "นัดตรวจสัปดาห์นี้"}
                        value={dashboard.kpi?.scheduledThisWeek ?? 0}
                        tone="info"
                        icon={CalendarClock}
                    />
                    <KpiTile
                        label={aDict?.metrics?.pendingResults || "รอบันทึกผล"}
                        value={dashboard.kpi?.pendingResults ?? 0}
                        tone="warning"
                        icon={ClipboardList}
                    />
                    <KpiTile
                        label={aDict?.kpi?.todayCompleted || "ตรวจเสร็จวันนี้"}
                        value={dashboard.kpi?.auditedToday ?? 0}
                        tone="success"
                        icon={CheckCircle2}
                    />
                    <KpiTile
                        label="ติดตามแก้ไข (ย่อย)"
                        value={dashboard.kpi?.minorFollowups ?? 0}
                        tone="neutral"
                        icon={ListChecks}
                    />
                    <KpiTile
                        label="ต้องตรวจซ้ำ (สำคัญ)"
                        value={dashboard.kpi?.majorTriggers ?? 0}
                        tone="danger"
                        icon={AlertTriangle}
                    />
                    {/* P1-H (Wave-3): overdue onsite inspections — นัดที่เลยกำหนดแต่ยัง
                        ไม่ได้ตรวจ (AUDIT_CONFIRMED + scheduledDate < now). Danger tone. */}
                    <KpiTile
                        label="เลยกำหนดตรวจ"
                        value={dashboard.kpi?.overdue ?? 0}
                        tone="danger"
                        icon={AlertCircle}
                    />
                </KpiTileGrid>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <QueueSection
                        title={aDict?.title || "คิวการตรวจประเมิน"}
                        icon={<ClipboardList className="h-4 w-4" aria-hidden="true" />}
                        bodyClassName="p-4 sm:p-6"
                    >
                        <div className="mb-6">
                            <Tabs value={activeQueue} onValueChange={(value) => setActiveQueue(value || "today")} className="w-full">
                                {/* Minimal-redesign pass: the mint pill row with a
                                    bg-leaf + white active tab is gone. bg-leaf under
                                    white text is 2.64:1 (fails AA, contrast contract),
                                    and the pill read louder than the queue it labels.
                                    Now the primitive's plain segmented control: muted
                                    track, active tab on the card surface. */}
                                <TabsList className="grid w-full grid-cols-3 gap-1 rounded-lg">
                                    <TabsTrigger value="today" className="min-h-[44px] justify-center whitespace-normal rounded-md">
                                        {aDict?.tabs?.today || "วันนี้"} ({dashboard.queues.todayUpcoming.total})
                                    </TabsTrigger>
                                    <TabsTrigger value="in_progress" className="min-h-[44px] justify-center whitespace-normal rounded-md">
                                        {aDict?.tabs?.inProgress || "กำลังทำ"} ({dashboard.queues.inProgress.total})
                                    </TabsTrigger>
                                    <TabsTrigger value="follow_ups" className="min-h-[44px] justify-center whitespace-normal rounded-md">
                                        {aDict?.tabs?.followUps || "ติดตาม"} ({dashboard.queues.followUps.total})
                                    </TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </div>

                        <div className="space-y-3">
                            {queueItems.map((item) => (
                                <div
                                    className="group flex flex-col gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-muted/40 md:flex-row md:items-center md:justify-between"
                                    key={item.id}
                                >
                                    {/* Queue rows are hairline rows on the card, not filled
                                        mint boxes inside a card, and the identical per-row
                                        leaf badge (no information) is gone. */}
                                    <div className="flex min-w-0 items-start gap-3">
                                        <div className="min-w-0 space-y-1">
                                            <p className="text-[10px] font-bold tabular-nums text-muted-foreground">
                                                {item.applicationNumber}
                                            </p>
                                            <p className="font-bold text-foreground">{item.applicantName}</p>
                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                {(() => {
                                                    const { label, tone } = statusTone(item.workflowState);
                                                    return (
                                                        <span className={cn(
                                                            "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold",
                                                            STATUS_BADGE_CLASSES[tone],
                                                        )}>
                                                            {label}
                                                        </span>
                                                    );
                                                })()}
                                                {/* Inspection mode is a neutral fact, not a status —
                                                    it now reads as a plain outlined chip. The
                                                    leading dots duplicated the label text and
                                                    have been dropped from both chips. */}
                                                <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                                                    {item.inspectionMode === "ONLINE_MEET" ? (aDict?.actions?.online || "ออนไลน์") : (aDict?.actions?.onsite || "หน้างาน")}
                                                </span>
                                                {!item.receiptIssued && (
                                                    <span className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                                                        {aDict?.actions?.pendingReceipt || "ค้างใบเสร็จ"}
                                                    </span>
                                                )}
                                            </div>
                                            {item.scheduledDate && (() => {
                                                // P1-H (Wave-3): tint the scheduled date red when the
                                                // onsite is past due but still AUDIT_CONFIRMED (not yet
                                                // inspected) — mirrors the "เลยกำหนดตรวจ" KPI tile.
                                                const isRowOverdue = item.workflowState === 'AUDIT_CONFIRMED'
                                                    && new Date(item.scheduledDate).getTime() < Date.now();
                                                return (
                                                    <div
                                                        className={cn(
                                                            "mt-2 flex items-center gap-1.5 text-xs font-medium",
                                                            isRowOverdue ? "font-bold text-destructive" : "text-muted-foreground",
                                                        )}
                                                        data-testid={isRowOverdue ? "auditor-row-overdue" : undefined}
                                                    >
                                                        <Clock size={14} aria-hidden="true" />
                                                        {new Date(item.scheduledDate).toLocaleString('th-TH')}
                                                        {isRowOverdue && (
                                                            <span className="ml-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                                                                เลยกำหนด
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {item.inspectionMode === "ONLINE_MEET" && item.meetingLink && (
                                            <Button
                                                href={item.meetingLink}
                                                target="_blank"
                                                size="sm"
                                                variant="outline"
                                                className="min-h-[44px] whitespace-normal"
                                                aria-label={(aDict?.ariaLabels?.meetingLink || "Open meeting link for {id}").replace('{id}', item.applicationNumber)}
                                            >
                                                <Video size={16} className="mr-1.5" aria-hidden="true" />
                                                {aDict?.actions?.meeting || "Meeting"}
                                            </Button>
                                        )}
                                        {item.inspectionMode === "ONSITE" && item.mapLink && (
                                            <Button
                                                href={item.mapLink}
                                                target="_blank"
                                                size="sm"
                                                variant="outline"
                                                className="min-h-[44px] whitespace-normal"
                                                aria-label={(aDict?.ariaLabels?.mapLink || "Open map for {id}").replace('{id}', item.applicationNumber)}
                                            >
                                                <MapPin size={16} className="mr-1.5" aria-hidden="true" />
                                                {aDict?.actions?.map || "แผนที่"}
                                            </Button>
                                        )}
                                        {item.canStartInspection && (
                                            <Button
                                                size="sm"
                                                variant="primary"
                                                className="min-h-[44px] whitespace-normal"
                                                loading={isStarting === item.applicationId}
                                                onClick={() => startInspection(item.applicationId)}
                                            >
                                                {aDict?.actions?.start || "เริ่มงาน"}
                                            </Button>
                                        )}
                                        <Button
                                            href={`/provider/audits/${item.applicationId}`}
                                            size="sm"
                                            variant="secondary"
                                            className="min-h-[44px] whitespace-normal"
                                            aria-label={(aDict?.ariaLabels?.details || "Audit details for {id}").replace('{id}', item.applicationNumber)}
                                        >
                                            {aDict?.actions?.details || "รายละเอียด"}
                                            <ChevronRight size={16} className="ml-1" aria-hidden="true" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                            {queueItems.length === 0 && (
                                <EmptyState
                                    compact
                                    icon={AlertCircle}
                                    title={aDict?.empty?.queueTitle || "ไม่มีรายการในคิวนี้"}
                                    hint={aDict?.empty?.queueHint || "คิวว่างพอดี เปลี่ยนแท็บด้านบนเพื่อดูคิวอื่น หรือพักก่อน"}
                                />
                            )}

                        </div>
                    </QueueSection>

                    <div className="space-y-4">
                        <QueueSection
                            title={aDict?.schedule?.title || "กำหนดการตรวจ"}
                            icon={<Calendar className="h-4 w-4" aria-hidden="true" />}
                            count={dashboard.calendar.events.length}
                            bodyClassName="p-4 sm:p-6"
                        >
                            <div className="space-y-3">
                                {dashboard.calendar.events.slice(0, 5).map((event) => (
                                    <div className="flex items-start gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-muted/40" key={`${event.applicationId}-${event.scheduledDate}`}>
                                        {/* Date stamp: no nested card-in-card, no uppercase on
                                            the Thai month abbreviation, no font-black. */}
                                        <div className="flex min-w-[60px] flex-col items-center justify-center">
                                            <p className="text-[11px] text-muted-foreground">
                                                {event.scheduledDate ? new Date(event.scheduledDate).toLocaleDateString('th-TH', { month: 'short' }) : '-'}
                                            </p>
                                            <p className="text-xl font-semibold tabular-nums text-foreground">
                                                {event.scheduledDate ? new Date(event.scheduledDate).getDate() : '-'}
                                            </p>
                                        </div>
                                        <div className="flex-1 space-y-1">
                                            <p className="text-[10px] font-bold tabular-nums text-muted-foreground">
                                                {event.applicationNumber}
                                            </p>
                                            <p className="font-bold leading-tight text-foreground">{event.applicantName}</p>
                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                                    {event.inspectionMode === "ONLINE_MEET" ? (aDict?.schedule?.online || "ONLINE") : (aDict?.schedule?.onsite || "ONSITE")}
                                                </span>
                                                {event.canStartInspection && (
                                                    <span className="inline-flex items-center rounded-md bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                                                        {aDict?.schedule?.readyToStart || "พร้อมเริ่ม"}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <Button
                                            href={`/provider/audits/${event.applicationId}`}
                                            size="icon"
                                            variant="ghost"
                                            className="h-11 min-h-[44px] w-11 min-w-[44px] text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-8 sm:min-h-0 sm:w-8 sm:min-w-0"
                                            aria-label={(aDict?.ariaLabels?.details || "Audit details for {id}").replace('{id}', event.applicationNumber)}
                                        >
                                            <ChevronRight size={18} aria-hidden="true" />
                                        </Button>
                                    </div>
                                ))}
                                {dashboard.calendar.events.length === 0 && (
                                    <p className="py-8 text-center text-sm italic text-muted-foreground">
                                        {aDict?.schedule?.empty || "ไม่มีนัดตรวจที่จะถึง"}
                                    </p>
                                )}
                            </div>
                        </QueueSection>
                    </div>
                </div>
            </div>
        </ProviderLayout>
    );
}
