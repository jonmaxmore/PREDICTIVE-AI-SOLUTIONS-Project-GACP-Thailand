"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import ProviderLayout from "../components/provider-layout";
import { Badge } from "@/components/ui/primitives/badge";
import { Button } from "@/components/ui/primitives/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/primitives/tabs";
import { Spinner } from "@/components/ui/spinner";
import {
  KpiTile,
  KpiTileGrid,
  LaunchpadHeader,
  QueueSection,
} from "@/components/provider/launchpad";
import {
  AlertCircle,
  ArrowLeftRight,
  BarChart3,
  Bell,
  Calendar,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Clock,
  FileCheck,
  ListChecks,
  MapPin,
  RefreshCcw,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { KpiTileTone } from "@/components/provider/launchpad";
import { notifications } from "@/lib/notifications";
import { providerApiPaths } from "@/lib/services/provider-api";
import { apiClient } from "@/lib/api/api-client";
import { useAuth } from "@/lib/services/auth-provider";
import { providerRoleCanOpen } from "@/lib/provider-role-config";
import type {
  AuditorWorkloadData,
  ReviewerOption,
  SchedulerDashboard,
  SchedulerQueueItem,
  UrgentMonitorData,
} from "./coordinator-types";
import { EMPTY } from "./coordinator-types";
import CoordinatorContextPanel from "./coordinator-context-panel";
import { getStatusLabel } from "@/lib/constants/workflow-states";

/* ────────────────────────── Scheduler tools ────────────────────────── */

/**
 * P1-F — the 4 built + route-gated scheduler tools. Rendered as guarded
 * quick-link tiles on the coordinator landing (each wrapped in
 * providerRoleCanOpen). `value` is a short Thai call-to-action (these are
 * navigation tiles, not metrics). Tokens-only tones via KpiTile.
 */
const SCHEDULER_TOOLS: ReadonlyArray<{
  href: string;
  label: string;
  value: string;
  hint: string;
  tone: KpiTileTone;
  icon: LucideIcon;
}> = [
  {
    href: "/provider/scheduler/queue",
    label: "คิวจัดสรรงาน",
    value: "เปิด",
    hint: "จัดคิวและมอบหมายงานตรวจ",
    tone: "primary",
    icon: ListChecks,
  },
  {
    href: "/provider/scheduler/workload",
    label: "ภาระงานทีม",
    value: "เปิด",
    hint: "ดูปริมาณงานที่จ่ายให้แต่ละคน",
    tone: "info",
    icon: BarChart3,
  },
  {
    href: "/provider/scheduler/reassign",
    label: "สลับผู้ตรวจประเมิน",
    value: "เปิด",
    hint: "เปลี่ยนผู้ตรวจประเมิน (auditor)",
    tone: "warning",
    icon: ArrowLeftRight,
  },
  {
    href: "/provider/scheduler/reviewer-reassign",
    label: "สลับผู้ตรวจเอกสาร",
    value: "เปิด",
    hint: "เปลี่ยนผู้ตรวจเอกสาร (reviewer)",
    tone: "neutral",
    icon: UserCheck,
  },
];

/* ────────────────────────── Page ────────────────────────── */

export default function CoordinatorDashboardPage() {
  const { user } = useAuth();
  // The scheduler (this page's primary role) cannot enter /provider/applications
  // ([admin, document_reviewer, auditor] only) — linking there bounced it back here
  // (self-loop). Only render the detail link for roles that can actually open it.
  const canOpenApplications = providerRoleCanOpen(user?.role, "/provider/applications");
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<SchedulerDashboard>(EMPTY);
  const [urgent, setUrgent] = useState<UrgentMonitorData | null>(null);
  const [workload, setWorkload] = useState<AuditorWorkloadData | null>(null);
  const [activeTab, setActiveTab] = useState("review");
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [reviewers, setReviewers] = useState<ReviewerOption[]>([]);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<SchedulerQueueItem | null>(null);
  const [selectedReviewerId, setSelectedReviewerId] = useState("");
  const [assigning, setAssigning] = useState(false);
  // W5-C: stable ids for label/control association + ARIA modal labelling.
  const reviewerSelectId = useId();
  const reviewerModalTitleId = useId();

  const sendReminder = async (applicationId: string) => {
    setSendingReminder(applicationId);
    try {
      const res = await apiClient.post(
        providerApiPaths.schedulerSendReminder(applicationId),
        {},
      );
      if (res.success) {
        notifications.show({
          color: "green",
          title: "ส่งแจ้งเตือนสำเร็จ",
          message: "ส่งแจ้งเตือนไปยังเกษตรกรเรียบร้อยแล้ว",
        });
      } else {
        notifications.show({
          color: "red",
          title: "ส่งแจ้งเตือนไม่สำเร็จ",
          message: res.error || "ไม่สามารถส่งแจ้งเตือนได้",
          icon: <AlertCircle size={16} />,
        });
      }
    } catch {
      notifications.show({
        color: "red",
        title: "เกิดข้อผิดพลาด",
        message: "ไม่สามารถส่งแจ้งเตือนได้ กรุณาลองอีกครั้ง",
        icon: <AlertCircle size={16} />,
      });
    } finally {
      setSendingReminder(null);
    }
  };

  const openAssignModal = (item: SchedulerQueueItem) => {
    setAssignTarget(item);
    setSelectedReviewerId("");
    setAssignModalOpen(true);
  };

  // X3-FIX-C M-9: hand-rolled reviewer modal is NOT Radix-backed, so it lacks
  // the Dialog primitive's built-in Esc handling. Wire a window-level keydown
  // listener that closes when Escape is pressed while the modal is open. This
  // matches the W3C ARIA Authoring Practices Guide dialog pattern.
  useEffect(() => {
    if (!assignModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setAssignModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [assignModalOpen]);

  const assignReviewer = async () => {
    if (!assignTarget || !selectedReviewerId) return;
    setAssigning(true);
    try {
      const res = await apiClient.post(providerApiPaths.schedulerAssignReviewer, {
        applicationId: assignTarget.applicationId,
        reviewerId: selectedReviewerId,
      });
      if (res.success) {
        notifications.show({ color: "green", title: "จ่ายงานสำเร็จ", message: `จ่ายงานตรวจเอกสาร ${assignTarget.applicationNumber} เรียบร้อยแล้ว` });
        setAssignModalOpen(false);
        load();
      } else {
        notifications.show({ color: "red", title: "จ่ายงานไม่สำเร็จ", message: res.error || "ไม่สามารถจ่ายงานได้", icon: <AlertCircle size={16} /> });
      }
    } catch {
      notifications.show({ color: "red", title: "เกิดข้อผิดพลาด", message: "ไม่สามารถจ่ายงานได้ กรุณาลองอีกครั้ง", icon: <AlertCircle size={16} /> });
    } finally {
      setAssigning(false);
    }
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get<SchedulerDashboard>(
        providerApiPaths.schedulerDashboard("?limit=100"),
      );
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setData(EMPTY);
        notifications.show({
          color: "red",
          title: "โหลดข้อมูลล้มเหลว",
          message: res.error || "ไม่สามารถโหลด Coordinator Dashboard ได้",
          icon: <AlertCircle size={16} />,
        });
      }
    } catch {
      setData(EMPTY);
    }

    // Fetch urgent monitor data (non-blocking)
    try {
      const urgentRes = await apiClient.get<UrgentMonitorData>(
        providerApiPaths.schedulerUrgentMonitor(),
      );
      if (urgentRes.success && urgentRes.data) {
        setUrgent(urgentRes.data);
      }
    } catch {
      // non-fatal
    }

    // Fetch auditor workload (non-blocking)
    try {
      const wlRes = await apiClient.get<AuditorWorkloadData>(
        providerApiPaths.schedulerAuditorWorkload,
      );
      if (wlRes.success && wlRes.data) {
        setWorkload(wlRes.data);
      }
    } catch {
      // non-fatal
    }

    // Fetch reviewers list for assignment modal
    try {
      const rvRes = await apiClient.get<ReviewerOption[]>(
        providerApiPaths.schedulerReviewers(),
      );
      if (rvRes.success && rvRes.data) {
        setReviewers(rvRes.data);
      }
    } catch {
      // non-fatal
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const queueItems = useMemo(() => {
    if (activeTab === "review") return data.queues.readyForReview.items;
    if (activeTab === "upcoming") return data.queues.scheduledUpcoming.items;
    if (activeTab === "reschedule") return data.queues.rescheduleRequired.items;
    return data.queues.readyToSchedule.items;
  }, [activeTab, data]);

  if (isLoading) {
    return (
      <ProviderLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <Spinner color="teal" />
        </div>
      </ProviderLayout>
    );
  }

  return (
    <ProviderLayout>
      <div className="space-y-6">
        {/* ── B2 — Fiori launchpad header band (replaces the gov-gradient
            SummaryHeader hero). Greeting kicker + role title + one-line
            summary, with the refresh action right-aligned. Token-only. ── */}
        <LaunchpadHeader
          greeting="ศูนย์ควบคุมการจัดสรรงาน"
          title="ผู้ประสานงาน (จัดคิว/มอบหมาย)"
          subtitle="จัดสรรผู้ตรวจ นัดหมายลงพื้นที่ และเฝ้าระวัง SLA ในที่เดียว"
          actions={
            <Button variant="outline" onClick={load}>
              <RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" /> รีเฟรช
            </Button>
          }
        />

        {/* ── B2 — KPI tile grid. Drives off the scheduler-dashboard fields
            already fetched (queue totals + kpi). Tiles are informational —
            the tabs below are the in-page navigation (no URL-routable queue
            target exists), so no drill-down href is emitted. ── */}
        <KpiTileGrid>
          <KpiTile
            label="รอมอบหมายผู้ตรวจ"
            value={data.queues.readyForReview.total}
            tone="info"
            hint="คำขอที่รอจ่ายงานตรวจเอกสาร"
            icon={ClipboardList}
          />
          <KpiTile
            label="รอจัดคิวตรวจประเมิน"
            value={data.queues.readyToSchedule.total}
            tone="primary"
            hint="คำขอที่รอจัดคิวลงพื้นที่"
            icon={FileCheck}
          />
          <KpiTile
            label="นัดวันนี้"
            value={data.kpi.scheduledToday}
            tone="warning"
            hint="นัดหมายตรวจประเมินวันนี้"
            icon={CalendarClock}
          />
          <KpiTile
            label="นัดสัปดาห์นี้"
            value={data.kpi.scheduledThisWeek}
            tone="neutral"
            hint="นัดหมายตรวจประเมินสัปดาห์นี้"
            icon={CalendarDays}
          />
          <KpiTile
            label="ออนไลน์ / หน้างาน"
            value={`${data.kpi.onlineVsOnsite.online} / ${data.kpi.onlineVsOnsite.onsite}`}
            tone="info"
            hint="สัดส่วนรูปแบบการตรวจประเมิน"
            icon={Users}
          />
          {/* P1-H (Wave-3): SLA visibility for the scheduler — งานในคิวที่เลย
              กำหนด/ผิด SLA (work activities overdue หรือ breached). Danger tone. */}
          <KpiTile
            label="งานเลยกำหนด / ผิด SLA"
            value={data.kpi.overdue ?? 0}
            tone="danger"
            hint="งานในคิวผู้ประสานงานที่เลยกำหนดหรือผิด SLA"
            icon={AlertCircle}
          />
        </KpiTileGrid>

        {/* ── P1-F — scheduler tool launchpad. The 4 built+gated scheduler
            tools had ZERO inbound links from this landing (reachable only by
            typing the URL). Surface them as guarded tool tiles. Each link is
            wrapped in providerRoleCanOpen(role, path) — a role that can't open
            the target renders NOTHING (the "เด่งไปเด่งมา" guard). Scheduler +
            admin can open all four, so they show. ── */}
        {SCHEDULER_TOOLS.some((tool) => providerRoleCanOpen(user?.role, tool.href)) && (
          <QueueSection
            title="เครื่องมือจัดตาราง"
            icon={<CalendarClock className="h-4 w-4" aria-hidden="true" focusable="false" />}
            bodyClassName="p-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {SCHEDULER_TOOLS.filter((tool) => providerRoleCanOpen(user?.role, tool.href)).map((tool) => (
                <KpiTile
                  key={tool.href}
                  label={tool.label}
                  value={tool.value}
                  tone={tool.tone}
                  hint={tool.hint}
                  href={tool.href}
                  icon={tool.icon}
                />
              ))}
            </div>
          </QueueSection>
        )}

        {/* ── Main Grid ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Queue Panel (2 cols) */}
          <div className="space-y-4 lg:col-span-2">
            <QueueSection title="คิวจัดสรรงาน" icon={<ClipboardList className="h-4 w-4" aria-hidden="true" focusable="false" />} bodyClassName="p-6">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
                <TabsList className="grid w-full grid-cols-4 rounded-xl bg-muted/50 p-1">
                  <TabsTrigger value="review" className="rounded-lg text-xs">
                    <FileCheck size={14} className="mr-1" aria-hidden="true" focusable="false" />
                    รอจ่ายงาน ({data.queues.readyForReview.total})
                  </TabsTrigger>
                  <TabsTrigger value="ready" className="rounded-lg text-xs">
                    <UserCheck size={14} className="mr-1" aria-hidden="true" focusable="false" />
                    รอจัดสรร ({data.queues.readyToSchedule.total})
                  </TabsTrigger>
                  <TabsTrigger value="upcoming" className="rounded-lg text-xs">
                    <Calendar size={14} className="mr-1" aria-hidden="true" focusable="false" />
                    นัดแล้ว ({data.queues.scheduledUpcoming.total})
                  </TabsTrigger>
                  <TabsTrigger value="reschedule" className="rounded-lg text-xs">
                    <AlertCircle size={14} className="mr-1" aria-hidden="true" focusable="false" />
                    นัดใหม่ ({data.queues.rescheduleRequired.total})
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="space-y-3">
                {queueItems.map((item) => (
                  <div
                    key={item.applicationId}
                    className="group flex flex-col gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-muted/40 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-muted-foreground">
                        {item.applicationNumber}
                      </p>
                      <p className="font-bold text-foreground">{item.applicantName}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="rounded-md font-bold">
                          {getStatusLabel(item.workflowState)}
                        </Badge>
                        <Badge variant="outline" className="rounded-md border-primary/20 bg-primary/5 text-primary">
                          {item.inspectionMode === "ONLINE_MEET" ? "ออนไลน์" : "หน้างาน"}
                        </Badge>
                        {item.auditorName && (
                          <Badge variant="outline" className="rounded-md">
                            <Users size={10} className="mr-1" aria-hidden="true" focusable="false" />
                            {item.auditorName}
                          </Badge>
                        )}
                        {/* C3 ("งานนี้พาสไปที่ใคร"): show the assigned reviewer on
                            already-assigned rows so the scheduler sees who it passed
                            the doc-review job to. */}
                        {item.reviewerName && (
                          <Badge variant="outline" className="rounded-md border-info/20 bg-info/5 text-info">
                            <UserCheck size={10} className="mr-1" aria-hidden="true" focusable="false" />
                            ผู้ตรวจ: {item.reviewerName}
                          </Badge>
                        )}
                        {item.isRescheduleRequired && (
                          <Badge variant="destructive" className="rounded-md">ต้องนัดใหม่</Badge>
                        )}
                      </div>
                      {item.scheduledDate && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock size={14} aria-hidden="true" focusable="false" />
                          {new Date(item.scheduledDate).toLocaleString("th-TH")}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {activeTab === "review" && (
                        <Button
                          size="sm"
                          className="bg-primary text-primary-foreground hover:bg-primary/90"
                          onClick={() => openAssignModal(item)}
                        >
                          <UserCheck size={14} className="mr-1.5" aria-hidden="true" focusable="false" /> จ่ายงานตรวจ
                        </Button>
                      )}
                      {/* Minimal-redesign pass: the row toolbar had four buttons in
                          four different colours (primary + two warning-tinted +
                          secondary). Only the one primary action keeps a fill; the
                          rest are plain outline buttons at the token radius. */}
                      {item.location && (
                        <Button size="sm" variant="outline">
                          <MapPin size={16} className="mr-1.5" aria-hidden="true" focusable="false" /> แผนที่
                        </Button>
                      )}
                      {activeTab !== "review" && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/provider/calendar`}>
                            <Calendar size={16} className="mr-1.5" aria-hidden="true" focusable="false" /> ตารางนัด
                          </Link>
                        </Button>
                      )}
                      {canOpenApplications && (
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/provider/applications/${item.applicationId}`}>
                            รายละเอียด <ChevronRight size={16} className="ml-1" aria-hidden="true" focusable="false" />
                          </Link>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={sendingReminder === item.applicationId}
                        onClick={() => sendReminder(item.applicationId)}
                      >
                        <Bell size={14} className={`mr-1.5 ${sendingReminder === item.applicationId ? 'animate-pulse' : ''}`} aria-hidden="true" focusable="false" />
                        {sendingReminder === item.applicationId ? 'กำลังส่ง...' : 'แจ้งเตือน'}
                      </Button>
                    </div>
                  </div>
                ))}
                {queueItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="mb-2 rounded-full bg-muted p-3">
                      <AlertCircle className="h-6 w-6 text-muted-foreground" aria-hidden="true" focusable="false" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">ไม่มีรายการในคิวนี้</p>
                  </div>
                )}
              </div>
            </QueueSection>
          </div>

          {/* Right-rail context panel (urgent items, KPI, auditor workload) */}
          <CoordinatorContextPanel data={data} urgent={urgent} workload={workload} canOpenApplications={canOpenApplications} />
        </div>
      </div>

      {/* ── Reviewer Assignment Modal ── */}
      {assignModalOpen && assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* W5-C: backdrop is a real <button> so click+keyboard close work
              without divs-with-onClick. Inner panel uses role="dialog" with
              aria-modal so screen readers announce the modal correctly. */}
          <button
            type="button"
            aria-label="ปิดหน้าต่าง"
            className="absolute inset-0 cursor-default bg-black/50"
            onClick={() => setAssignModalOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={reviewerModalTitleId}
            className="relative mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 id={reviewerModalTitleId} className="text-lg font-bold text-foreground">จ่ายงานตรวจเอกสาร</h3>
              <button type="button" onClick={() => setAssignModalOpen(false)} className="rounded-lg p-1 hover:bg-muted" aria-label="ปิด">
                <X size={18} aria-hidden="true" focusable="false" />
              </button>
            </div>

            <div className="mb-4 rounded-xl border border-border/50 bg-muted/20 p-3">
              <p className="text-[10px] font-bold text-muted-foreground">{assignTarget.applicationNumber}</p>
              <p className="font-bold text-foreground">{assignTarget.applicantName}</p>
            </div>

            <label htmlFor={reviewerSelectId} className="mb-2 block text-sm font-bold text-foreground">เลือกผู้ตรวจเอกสาร</label>
            <select
              id={reviewerSelectId}
              className="mb-4 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              value={selectedReviewerId}
              onChange={(e) => setSelectedReviewerId(e.target.value)}
              // X3-FIX-C H-11: focus the reviewer select when the modal opens so
              // keyboard users don't need to tab past the close icon. Mounted only
              // when assignModalOpen is true, so autoFocus fires once per open.
              // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG (see X2-FIX-A M-13).
              autoFocus
            >
              <option value="">เลือกผู้ตรวจ</option>
              {reviewers.map((rv) => (
                <option key={rv.id} value={rv.id}>{rv.fullName} ({rv.canonicalRole})</option>
              ))}
            </select>

            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setAssignModalOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                className="rounded-xl"
                disabled={!selectedReviewerId || assigning}
                onClick={assignReviewer}
              >
                {assigning ? "กำลังจ่ายงาน..." : "ยืนยันจ่ายงาน"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ProviderLayout>
  );
}
