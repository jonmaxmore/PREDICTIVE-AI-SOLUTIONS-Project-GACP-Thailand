"use client";

// Right-rail context panel for the Coordinator dashboard. Renders alongside
// the queue table inside the main content area — NOT a navigation sidebar.
// Top-nav navigation lives in DashboardLayout (see provider-layout.tsx);
// this panel only holds dashboard-context content (urgent items, KPI tiles,
// auditor workload bars). Renamed from `coordinator-sidebar.tsx` 2026-04-30
// to remove the "sidebar" misnomer that confused the 2026-04-25 UX audit.

import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/primitives/badge";
import { KpiTile, KpiTileGrid } from "@/components/provider/launchpad";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  Clock,
  Flame,
  Users,
} from "lucide-react";
import type {
  AuditorWorkloadData,
  SchedulerDashboard,
  UrgentMonitorData,
} from "./coordinator-types";

interface CoordinatorContextPanelProps {
  data: SchedulerDashboard;
  urgent: UrgentMonitorData | null;
  workload: AuditorWorkloadData | null;
  /**
   * Whether the viewing role may open /provider/applications. The urgent-monitor
   * rows deep-link there; for roles that can't enter (scheduler — this panel's
   * primary consumer), rendering a <Link> bounces them to the dashboard (the
   * "เด่งไปเด่งมา" class). When false we keep the row visible but non-clickable.
   */
  canOpenApplications: boolean;
}

/**
 * Urgent-item row shell: a deep <Link> to the application when the role can open
 * it, otherwise a plain <div> (same look, no navigation) so the scheduler still
 * sees the urgent item without being bounced. Mirrors the guard used for the
 * coordinator queue's "รายละเอียด" link in client-view.tsx.
 */
const UrgentRow = ({
  canOpen,
  applicationId,
  className,
  children,
}: {
  canOpen: boolean;
  applicationId: string;
  className: string;
  children: ReactNode;
}) =>
  canOpen ? (
    <Link href={`/provider/applications/${applicationId}`} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );

const CoordinatorContextPanel = ({ data, urgent, workload, canOpenApplications }: CoordinatorContextPanelProps) => (
  <div className="space-y-6">
    {/* ── Urgent Monitor ── */}
    {urgent && (urgent.summary.totalStuck > 0 || urgent.summary.approachingDeadlines > 0) && (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 shadow-sm">
        {/* Minimal-redesign pass: the four right-rail cards each led with a
            40px tinted icon tile. They are now plain small icons beside the
            heading — the card's own tone already carries the meaning. */}
        <div className="mb-4 flex items-center gap-2">
          <Flame size={16} className="shrink-0 text-destructive" aria-hidden="true" focusable="false" />
          <div>
            <h3 className="font-bold text-foreground">เฝ้าระวังเร่งด่วน</h3>
            <p className="text-xs text-muted-foreground">
              {urgent.summary.critical > 0 && <span className="font-bold text-destructive">วิกฤต {urgent.summary.critical}</span>}
              {urgent.summary.critical > 0 && urgent.summary.warning > 0 && " · "}
              {urgent.summary.warning > 0 && <span className="font-bold text-warning">เตือน {urgent.summary.warning}</span>}
            </p>
          </div>
        </div>
        <div className="max-h-[300px] space-y-2 overflow-y-auto">
          {urgent.stuckItems.slice(0, 8).map((item) => (
            <UrgentRow
              key={item.id}
              canOpen={canOpenApplications}
              applicationId={item.id}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/80 p-3 transition-all hover:bg-card hover:shadow-sm"
            >
              {item.severity === "CRITICAL" ? (
                <AlertTriangle size={16} className="shrink-0 text-destructive" aria-hidden="true" focusable="false" />
              ) : (
                <AlertCircle size={16} className="shrink-0 text-warning" aria-hidden="true" focusable="false" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-foreground">{item.applicationNumber}</p>
                <p className="truncate text-[10px] text-muted-foreground">{item.applicantName}</p>
              </div>
              <Badge
                variant={item.severity === "CRITICAL" ? "destructive" : "secondary"}
                className="shrink-0 rounded-md text-[10px]"
              >
                {item.hoursStuck}ชม.
              </Badge>
            </UrgentRow>
          ))}
          {urgent.deadlineItems.slice(0, 4).map((item) => (
            <UrgentRow
              key={`dl-${item.id}`}
              canOpen={canOpenApplications}
              applicationId={item.id}
              className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 transition-all hover:bg-warning/20"
            >
              <Clock size={16} className="shrink-0 text-warning" aria-hidden="true" focusable="false" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-foreground">{item.applicationNumber}</p>
                <p className="text-[10px] text-warning">Deadline เหลือ {item.hoursLeft} ชม.</p>
              </div>
            </UrgentRow>
          ))}
        </div>
      </div>
    )}

    {/* ── Upcoming Calendar Events ── */}
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Calendar size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" focusable="false" />
        <h3 className="font-semibold text-foreground">กำหนดการลงพื้นที่</h3>
      </div>
      <div className="space-y-3">
        {data.calendar.events.slice(0, 5).map((event) => (
          <div key={`${event.applicationId}-${event.scheduledDate}`} className="flex items-start gap-3 rounded-lg border border-border p-3">
            {/* Date stamp: no card-in-card-in-card, no uppercase on the Thai
                month abbreviation, no font-black. */}
            <div className="flex min-w-[50px] flex-col items-center justify-center">
              <p className="text-[11px] text-muted-foreground">
                {event.scheduledDate ? new Date(event.scheduledDate).toLocaleDateString("th-TH", { month: "short" }) : "-"}
              </p>
              <p className="text-lg font-semibold tabular-nums text-foreground">
                {event.scheduledDate ? new Date(event.scheduledDate).getDate() : "-"}
              </p>
            </div>
            <div className="flex-1 space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground">{event.applicationNumber}</p>
              <p className="text-sm font-bold leading-tight text-foreground">{event.applicantName}</p>
              {event.auditorName && (
                <p className="text-xs text-muted-foreground">ผู้ตรวจ: {event.auditorName}</p>
              )}
            </div>
          </div>
        ))}
        {data.calendar.events.length === 0 && (
          <p className="py-6 text-center text-sm italic text-muted-foreground">ไม่มีกำหนดการ</p>
        )}
      </div>
    </div>

    {/* ── KPI — B2: shared KpiTiles (token-only) replacing the raw
        blue/amber/emerald metric cards. ── */}
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Clock size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" focusable="false" />
        <h3 className="font-semibold text-foreground">สรุปภาพรวม (KPI)</h3>
      </div>
      <KpiTileGrid className="grid-cols-2 md:grid-cols-2 xl:grid-cols-2">
        <KpiTile label="นัดวันนี้" value={data.kpi.scheduledToday} tone="primary" />
        <KpiTile label="สัปดาห์นี้" value={data.kpi.scheduledThisWeek} tone="info" />
        <KpiTile label="ออนไลน์" value={data.kpi.onlineVsOnsite.online} tone="warning" />
        <KpiTile label="หน้างาน" value={data.kpi.onlineVsOnsite.onsite} tone="success" />
      </KpiTileGrid>
    </div>

    {/* ── Auditor Workload ── */}
    {workload && workload.auditors.length > 0 && (
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Users size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" focusable="false" />
          <div>
            <h3 className="font-semibold text-foreground">ภาระงานผู้ตรวจ</h3>
            <p className="text-xs text-muted-foreground">
              ว่าง {workload.summary.available} · ยุ่ง {workload.summary.busy} · เต็ม {workload.summary.full}
            </p>
          </div>
        </div>
        <div className="space-y-3">
          {workload.auditors.map((a) => {
            const barColor =
              a.availability === "FULL"
                ? "bg-destructive"
                : a.availability === "BUSY"
                  ? "bg-warning"
                  : "bg-success";
            return (
              <div key={a.id} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-foreground">{a.name}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {a.activeAssignments}/{a.capacity}
                    </span>
                    <Badge
                      variant={a.availability === "FULL" ? "destructive" : a.availability === "BUSY" ? "secondary" : "outline"}
                      className="rounded-md text-[10px]"
                    >
                      {a.availability === "FULL" ? "เต็ม" : a.availability === "BUSY" ? "ยุ่ง" : "ว่าง"}
                    </Badge>
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${a.utilizationPct}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  เสร็จ 30 วัน: {a.completedLast30Days} งาน
                </p>
              </div>
            );
          })}
        </div>
      </div>
    )}
  </div>
);

export default CoordinatorContextPanel;
