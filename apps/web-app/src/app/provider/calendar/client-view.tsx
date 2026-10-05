"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from '@/components/ui/primitives/button';
import { Card } from '@/components/ui/primitives/card';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives/tabs';

import {
    IconAlertCircle,
    IconCalendar,
    IconClock,
    IconRefresh,
    IconVideo,
    IconMapPin,
    IconCalendarStats} from "@tabler/icons-react";
import { notifications } from '@/lib/notifications';
import ProviderLayout from "../components/provider-layout";
import { SummaryHeader } from '@/components/feature/summary-header';
import { apiClient as api } from "@/lib/api";
import { providerApiPaths } from "@/lib/services/provider-api";
import { formatThaiDate, thaiDayOfMonth } from "@/lib/format/thai-date";
import { getStatusLabel } from "@/lib/constants/workflow-states";

import {
    type SchedulerQueueItem,
    type SchedulerDashboardData,
    type AuditorOption,
    EMPTY_DASHBOARD,
} from "./calendar-types";
import { ScheduleModal } from "./schedule-modal";
import { evidenceWarningFrom, type ScheduleAnswer } from "./schedule-evidence";

export default function PROVIDERCalendarPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [dashboard, setDashboard] = useState<SchedulerDashboardData>(EMPTY_DASHBOARD);
    const [auditors, setAuditors] = useState<AuditorOption[]>([]);
    const [activeQueue, setActiveQueue] = useState<string>("ready");
    const [opened, setOpened] = useState(false);
    const [selectedItem, setSelectedItem] = useState<SchedulerQueueItem | null>(null);
    const [scheduleDate, setScheduleDate] = useState<Date | null>(new Date());
    const [scheduleTime, setScheduleTime] = useState("09:00");
    // Default to the visit that can lead to a certificate. ONLINE_MEET arms no evidence chain
    // (backend services/audit/arm-onsite-evidence.js), so a booking made by default on it had
    // no path to a certificate.
    const [inspectionMode, setInspectionMode] = useState<"ONLINE_MEET" | "ONSITE">("ONSITE");
    // The backend's answer to a booking says whether the visit can lead to a certificate
    // (canLeadToCertificate / evidenceNote). Kept on the page until dismissed.
    const [evidenceWarning, setEvidenceWarning] = useState<string | null>(null);
    const [meetingLink, setMeetingLink] = useState("");
    const [mapLink, setMapLink] = useState("");
    const [location, setLocation] = useState("");
    const [auditorId, setAuditorId] = useState<string | null>(null);
    const [notes, setNotes] = useState("");
    const [estimatedDuration, setEstimatedDuration] = useState<number>(120);

    const fetchDashboard = useCallback(async () => {
        setIsLoading(true);
        try {
            const [dashboardResponse, auditorResponse] = await Promise.all([
                api.get<SchedulerDashboardData>(providerApiPaths.schedulerDashboard("?limit=100")),
                api.get<AuditorOption[]>(providerApiPaths.schedulerAuditors()),
            ]);

            if (dashboardResponse.success && dashboardResponse.data) {
                setDashboard(dashboardResponse.data);
            } else {
                setDashboard(EMPTY_DASHBOARD);
            }

            if (auditorResponse.success && Array.isArray(auditorResponse.data)) {
                setAuditors(auditorResponse.data);
            } else {
                setAuditors([]);
            }
        } catch (error: unknown) {
            console.error("[scheduler-dashboard] load failed", error);
            setDashboard(EMPTY_DASHBOARD);
            setAuditors([]);
            notifications.show({
                color: "red",
                title: "โหลดไม่สำเร็จ",
                message: "ไม่สามารถโหลดข้อมูลแดชบอร์ดจัดตารางได้",
                icon: <IconAlertCircle size={16} />,
            });
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboard();
    }, [fetchDashboard]);

    const queueItems = useMemo(() => {
        if (activeQueue === "scheduled") {
            return dashboard.queues.scheduledUpcoming.items;
        }
        if (activeQueue === "reschedule") {
            return dashboard.queues.rescheduleRequired.items;
        }
        return dashboard.queues.readyToSchedule.items;
    }, [activeQueue, dashboard]);

    const auditorOptions = useMemo(
        () => auditors.map((auditor) => ({
            value: auditor.id,
            label: `${auditor.fullName}${auditor.providerId ? ` (${auditor.providerId})` : ""}`,
        })),
        [auditors],
    );

    const openScheduleModal = (item: SchedulerQueueItem) => {
        const eventDate = item.scheduledDate ? new Date(item.scheduledDate) : new Date();
        setSelectedItem(item);
        setScheduleDate(eventDate);
        setScheduleTime(item.scheduledDate
            ? `${String(eventDate.getHours()).padStart(2, "0")}:${String(eventDate.getMinutes()).padStart(2, "0")}`
            : "09:00");
        setInspectionMode(item.inspectionMode || "ONSITE");
        setMeetingLink(item.meetingLink || "");
        setMapLink(item.mapLink || "");
        setLocation(item.location || "");
        setAuditorId(item.auditorId || null);
        setNotes(item.notes || "");
        setEstimatedDuration(item.estimatedDuration || 120);
        setOpened(true);
    };

    const submitSchedule = async () => {
        if (!selectedItem || !scheduleDate || !scheduleTime || !auditorId) {
            return;
        }

        const datePart = scheduleDate.toISOString().split("T")[0];
        const scheduledAt = new Date(`${datePart}T${scheduleTime}:00`);
        if (Number.isNaN(scheduledAt.getTime())) {
            notifications.show({ color: "red", title: "วันที่ไม่ถูกต้อง", message: "กรุณาเลือกวันและเวลาที่ถูกต้อง" });
            return;
        }

        if (inspectionMode === "ONLINE_MEET" && !meetingLink.trim()) {
            notifications.show({ color: "red", title: "ยังไม่มีลิงก์ประชุม", message: "การตรวจแบบออนไลน์ต้องระบุลิงก์ประชุม" });
            return;
        }
        if (inspectionMode === "ONSITE" && !mapLink.trim() && !location.trim()) {
            notifications.show({ color: "red", title: "ยังไม่มีสถานที่", message: "การตรวจหน้างานต้องระบุลิงก์แผนที่หรือสถานที่" });
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await api.post<ScheduleAnswer>(providerApiPaths.schedulerAuditSchedules, {
                applicationId: selectedItem.applicationId,
                auditorId,
                scheduledDate: scheduledAt.toISOString(),
                inspectionMode,
                meetingLink: inspectionMode === "ONLINE_MEET" ? meetingLink.trim() : undefined,
                mapLink: inspectionMode === "ONSITE" ? mapLink.trim() || undefined : undefined,
                location: inspectionMode === "ONSITE" ? location.trim() || undefined : undefined,
                notes: notes.trim() || undefined,
                estimatedDuration,
            });

            if (!response.success) {
                notifications.show({ color: "red", title: "บันทึกนัดหมายไม่สำเร็จ", message: response.error || "ไม่สามารถบันทึกนัดหมายได้" });
                return;
            }

            notifications.show({
                color: "teal",
                title: selectedItem.scheduledDate ? "เลื่อนนัดตรวจแล้ว" : "นัดหมายการตรวจแล้ว",
                message: `อัปเดตคำขอ ${selectedItem.applicationNumber} แล้ว`,
            });
            setEvidenceWarning(evidenceWarningFrom(response.data, selectedItem.applicationNumber));
            setOpened(false);
            await fetchDashboard();
        } catch (error: unknown) {
            console.error("[scheduler-dashboard] submit failed", error);
            notifications.show({ color: "red", title: "บันทึกนัดหมายไม่สำเร็จ", message: "เกิดข้อผิดพลาดระหว่างบันทึกนัดหมาย กรุณาลองใหม่อีกครั้ง" });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <ProviderLayout title="แดชบอร์ดนัดตรวจ" subtitle="คิว, ปฏิทิน และ KPI">
                <div className="flex items-center justify-center">
                    <Spinner color="teal" />
                </div>
            </ProviderLayout>
        );
    }

    return (
        <ProviderLayout>
            <div className="space-y-6">
                {/* ui_kit reskin (Wave, 2026-06-09): two-column Calendar/Agenda
                    layout, leaf-icon rows, status chips. Data/logic/i18n unchanged.

                    Minimal-redesign pass (2026-07-24): the header was a full-bleed
                    dark-green gradient hero with shadow-xl (the X3-FIX-B H-8 brand
                    cue). It is now the same plain hairline card the COORDINATOR
                    (B2) and AUDITS (B3) landings already use — the KPI strip
                    stays, the gradient and drop shadow go. */}
                {evidenceWarning && (
                    <div
                        role="alert"
                        data-testid="schedule-evidence-warning"
                        className="flex items-start justify-between gap-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
                    >
                        <p className="min-w-0 flex-1 font-semibold">{evidenceWarning}</p>
                        <Button size="sm" variant="outline" onClick={() => setEvidenceWarning(null)}>
                            รับทราบ
                        </Button>
                    </div>
                )}
                <SummaryHeader
                    eyebrow="SCHEDULING"
                    title="แดชบอร์ดนัดตรวจ"
                    description="จัดการนัดหมายการตรวจประเมิน GACP ทั้งออนไลน์และหน้างาน"
                    metrics={[
                        { label: "นัดวันนี้", value: (dashboard.kpi?.scheduledToday ?? 0).toString(), icon: "📌" },
                        { label: "นัดสัปดาห์นี้", value: (dashboard.kpi?.scheduledThisWeek ?? 0).toString(), icon: "🗓️" },
                        { label: "รอจัดตาราง", value: (dashboard.kpi?.pendingScheduling ?? 0).toString(), icon: "📋" },
                        { label: "รอนัดใหม่", value: (dashboard.kpi?.rescheduleBacklog ?? 0).toString(), icon: "🔄" },
                    ]}
                    actions={
                        <Button
                            variant="outline"
                            onClick={() => fetchDashboard()}
                        >
                            <IconRefresh className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" />
                            รีเฟรช
                        </Button>
                    }
                />

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <Card className="p-5 sm:p-6">
                        <div className="mb-6">
                            <Tabs value={activeQueue} onValueChange={(value) => setActiveQueue(value || "ready")} className="w-full">
                                {/* Plain segmented control (primitive defaults):
                                    muted track, hairline-radius, active tab on the
                                    card surface — not a mint pill row. */}
                                <TabsList className="grid w-full grid-cols-3 rounded-lg">
                                    <TabsTrigger value="ready" className="justify-center rounded-md">
                                        รอนัด ({dashboard.queues.readyToSchedule.total})
                                    </TabsTrigger>
                                    <TabsTrigger value="scheduled" className="justify-center rounded-md">
                                        นัดแล้ว ({dashboard.queues.scheduledUpcoming.total})
                                    </TabsTrigger>
                                    <TabsTrigger value="reschedule" className="justify-center rounded-md">
                                        เลื่อนนัด ({dashboard.queues.rescheduleRequired.total})
                                    </TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </div>

                        <div className="space-y-3">
                            {queueItems.map((item) => (
                                <div
                                    className="group flex flex-col gap-3 rounded-lg border border-border p-4 transition-colors hover:bg-muted/40 md:flex-row md:items-center md:justify-between"
                                    key={item.id}
                                >
                                    {/* The per-row leaf badge carried no information — every
                                        row showed the same glyph — so the row now leads with
                                        the application number. */}
                                    <div className="flex min-w-0 flex-1 items-start gap-3">
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <p className="text-[11px] font-semibold text-muted-foreground">
                                                {item.applicationNumber}
                                            </p>
                                            <p className="font-bold text-foreground">{item.applicantName}</p>
                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                {/* Minimal-redesign pass: raw slate/sky/red pill
                                                    fills + leading status dots removed. The dot
                                                    duplicated the label beside it, and the fills
                                                    were off-token. Only the overdue chip keeps a
                                                    tint, because that one is the exception. */}
                                                <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                                                    {getStatusLabel(item.workflowState)}
                                                </span>
                                                <span className="inline-flex items-center rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                                                    {item.inspectionMode === "ONLINE_MEET" ? "ตรวจออนไลน์" : "ตรวจที่ฟาร์ม"}
                                                </span>
                                                {item.overdueDays > 0 && (
                                                    <span className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                                                        เกินกำหนด {item.overdueDays} วัน
                                                    </span>
                                                )}
                                            </div>
                                            {item.scheduledDate && (
                                                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                                    <IconClock size={14} aria-hidden="true" focusable="false" />
                                                    {new Date(item.scheduledDate).toLocaleString('th-TH')}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <Button
                                        size="sm"
                                        className="shrink-0"
                                        onClick={() => openScheduleModal(item)}
                                    >
                                        {item.scheduledDate ? "เลื่อนนัด" : "จัดคู่นัดตรวจ"}
                                    </Button>
                                </div>
                            ))}
                            {queueItems.length === 0 && (
                                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground">
                                    <span className="mb-3 text-muted-foreground">
                                        <IconCalendar size={24} aria-hidden="true" focusable="false" />
                                    </span>
                                    <p className="text-sm">ไม่มีรายการในคิวนี้</p>
                                </div>
                            )}
                        </div>
                    </Card>

                    <div className="space-y-6">
                        <Card className="p-5 sm:p-6">
                            {/* Section heading: plain small icon + label, not a 40px
                                tinted icon tile. */}
                            <div className="mb-6 flex items-center gap-2">
                                <IconCalendar size={16} className="text-muted-foreground" aria-hidden="true" focusable="false" />
                                <h3 className="font-semibold text-foreground">ปฏิทินนัดตรวจ</h3>
                            </div>

                            <div className="space-y-3">
                                {dashboard.calendar.events.slice(0, 8).map((event) => (
                                    <div className="flex items-start gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-muted/40" key={`${event.applicationId}-${event.scheduledDate}`}>
                                        {/* Date stamp: no nested white card / shadow inside the
                                            row, no uppercase on the Thai month abbreviation, and
                                            no font-black. Plain type hierarchy. */}
                                        <div className="flex min-w-[60px] flex-col items-center justify-center">
                                            <p className="text-[11px] text-muted-foreground">
                                                {formatThaiDate(event.scheduledDate, { month: 'short' }, '—')}
                                            </p>
                                            <p className="text-xl font-semibold tabular-nums text-foreground">
                                                {thaiDayOfMonth(event.scheduledDate)}
                                            </p>
                                        </div>
                                        <div className="flex-1 space-y-1">
                                            <p className="text-[11px] font-semibold text-muted-foreground">
                                                {event.applicationNumber}
                                            </p>
                                            <p className="font-bold leading-tight text-foreground">{event.applicantName}</p>
                                            <p className="text-xs text-muted-foreground">
                                                ผู้ตรวจ: {event.auditorName || '-'}
                                            </p>
                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                {event.inspectionMode === "ONLINE_MEET" && event.meetingLink && (
                                                    // X3-FIX-C H-10: bump 28px → 44px tap target for tablet field
                                                    // use (WCAG 2.5.5). Keep visual layout via min-h/min-w so
                                                    // labels still fit on small screens.
                                                    <Button href={event.meetingLink} target="_blank" size="sm" variant="light" className="min-h-[44px] min-w-[44px] text-xs">
                                                        <IconVideo size={12} className="mr-1" aria-hidden="true" focusable="false" /> เข้าประชุม
                                                    </Button>
                                                )}
                                                {event.inspectionMode === "ONSITE" && event.mapLink && (
                                                    <Button href={event.mapLink} target="_blank" size="sm" variant="white" className="min-h-[44px] min-w-[44px] text-xs">
                                                        <IconMapPin size={12} className="mr-1" aria-hidden="true" focusable="false" /> แผนที่
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {dashboard.calendar.events.length === 0 && (
                                    <p className="py-8 text-center text-sm italic text-muted-foreground">
                                        ไม่มีรายการนัดตรวจ
                                    </p>
                                )}
                            </div>
                        </Card>

                        <Card className="p-5 sm:p-6">
                            <div className="mb-6 flex items-center gap-2">
                                <IconCalendarStats size={16} className="text-muted-foreground" aria-hidden="true" focusable="false" />
                                <h3 className="font-semibold text-foreground">สัดส่วนการตรวจ</h3>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">ตรวจออนไลน์</span>
                                    <span className="font-semibold tabular-nums text-foreground">{dashboard.kpi.onlineVsOnsite.online} รายการ</span>
                                </div>
                                <div className="h-[7px] w-full overflow-hidden rounded-full bg-mint-bg">
                                    <div
                                        className="h-full rounded-full bg-leaf transition-all"
                                        style={{ width: `${(dashboard.kpi.onlineVsOnsite.online / (dashboard.kpi.onlineVsOnsite.online + dashboard.kpi.onlineVsOnsite.onsite || 1)) * 100}%` }}
                                    />
                                </div>
                                <div className="flex items-center justify-between pt-2 text-sm">
                                    <span className="text-muted-foreground">ตรวจที่ฟาร์ม</span>
                                    <span className="font-semibold tabular-nums text-foreground">{dashboard.kpi.onlineVsOnsite.onsite} รายการ</span>
                                </div>
                            </div>
                        </Card>
                    </div>
                </div>
            </div>

            <ScheduleModal
                opened={opened}
                setOpened={setOpened}
                selectedItem={selectedItem}
                scheduleDate={scheduleDate}
                setScheduleDate={setScheduleDate}
                scheduleTime={scheduleTime}
                setScheduleTime={setScheduleTime}
                auditorId={auditorId}
                setAuditorId={setAuditorId}
                auditorOptions={auditorOptions}
                inspectionMode={inspectionMode}
                setInspectionMode={setInspectionMode}
                meetingLink={meetingLink}
                setMeetingLink={setMeetingLink}
                mapLink={mapLink}
                setMapLink={setMapLink}
                location={location}
                setLocation={setLocation}
                notes={notes}
                setNotes={setNotes}
                estimatedDuration={estimatedDuration}
                setEstimatedDuration={setEstimatedDuration}
                submitSchedule={submitSchedule}
                isSubmitting={isSubmitting}
            />
        </ProviderLayout>
    );
}

