'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  AlertCircle,
  CheckCircle2,
  RefreshCcw,
  Search,
  Activity,
  ShieldCheck,
  ChevronRight,
  ListChecks,
  Clock,
  AlertTriangle,
  Inbox,
  Sparkles,
  Hourglass,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select';
import { DataTable } from '@/components/ui/data-table';
import { providerApiPaths } from '@/lib/services/provider-api';
import { apiClient } from '@/lib/api/api-client';
import { providerLandingPath } from '@/lib/provider-role-config';
import ProviderLayout from '../components/provider-layout';
import { ProviderDashboardCharts } from '@/components/feature/dashboard-charts';
import {
  KpiTile,
  KpiTileGrid,
  LaunchpadHeader,
  QueueSection,
} from '@/components/provider/launchpad';
import {
  statusTone,
  STATUS_BADGE_CLASSES,
} from '../applications/[id]/provider-application-detail-config';
import {
  type ProviderUser,
  type QueueItem,
  type TraceItem,
  type DashboardMetrics,
  type DashboardQueues,
  type DashboardKpi,
  type QueuePayload,
  EMPTY_METRICS,
  normalizeProviderRole,
  formatDateTime,
  toQueueItem,
  toTraceItems,
  calculateFallbackMetrics,
} from './dashboard-utils';
import { CANONICAL_ROLES } from '@/lib/constants/canonical-roles';

// บทบาทที่เข้า /provider/applications ได้จริง (PROVIDER_ROUTE_ROLE_RULES) · ผู้อนุมัติ
// ใบรับรองไม่อยู่ในรายชื่อ: งานของเขาเข้าทางคิวอนุมัติ ไม่ใช่รายการคำขอทั้งหมด
const APPLICATIONS_READER_ROLES: string[] = [
  CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, CANONICAL_ROLES.DOCUMENT_REVIEWER, CANONICAL_ROLES.FIELD_INSPECTOR,
];

const EMPTY_REVIEWER_KPI: DashboardKpi = {
  pending: 0,
  dueIn48h: 0,
  overdueOrExpired: 0,
  reviewedToday: 0,
};

export default function ProviderDashboardPage() {
  const router = useRouter();
  const { dict } = useLanguage();
  const [user, setUser] = useState<ProviderUser | null>(null);
  const [loading, setLoading] = useState(true);
  // X2-FIX-C / H-6 — explicit fetch-error state matching X1-FIX-C health
  // pattern. Before X2-FIX-C the catch block silently reset KPIs to
  // defaults; a network outage rendered zeroed metric tiles + an empty
  // queue indistinguishable from a brand-new staff account with no work.
  // Reviewers had no retry CTA and would either guess or bounce. We now
  // surface a rose Card with the underlying error message and a retry
  // button that re-runs `loadDashboard` (pattern: health/dashboard +
  // health/notifications + health/payments client-views, X1-FIX-C).
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [traceItems, setTraceItems] = useState<TraceItem[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  // B1 launchpad: when the source is the reviewer-dashboard endpoint we keep
  // the richer raw KPI object (pending / dueIn48h / overdueOrExpired /
  // reviewedToday) so the document-reviewer tiles can surface dueIn48h —
  // a field the generic DashboardMetrics shape does not carry. `null` =
  // the reviewer endpoint was not the source (admin / applications-list
  // fallback) → render the computed-metric tiles instead.
  const [reviewerKpi, setReviewerKpi] = useState<DashboardKpi | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>('-');

  const loadDashboard = useCallback(async (currentUser: ProviderUser) => {
    setLoading(true);
    setFetchError(null);
    const role = normalizeProviderRole(currentUser.canonicalRole || currentUser.role);

    const endpointOrder: string[] = [];
    if (role === 'document_reviewer') endpointOrder.push(providerApiPaths.reviewerDashboard('?limit=100'));
    if (role === CANONICAL_ROLES.DISPATCHER) endpointOrder.push(providerApiPaths.schedulerDashboard('?limit=100'));
    if (role === CANONICAL_ROLES.FIELD_INSPECTOR) {
      endpointOrder.push(providerApiPaths.auditorDashboard('?limit=100'));
      endpointOrder.push(providerApiPaths.reviewerDashboard('?limit=100'));
    }
    endpointOrder.push(`${providerApiPaths.applicationsList}?limit=100`);

    try {
      let sourceEndpoint = '';
      let sourceData: Record<string, unknown> | null = null;

      for (const endpoint of endpointOrder) {
        const response = await apiClient.get<Record<string, unknown>>(endpoint);
        if (response.success && response.data && typeof response.data === 'object') {
          sourceEndpoint = endpoint;
          sourceData = response.data;
          break;
        }
      }

      if (!sourceData) throw new Error('Unable to load dashboard data');

      let mappedItems: QueueItem[] = [];
      let mappedMetrics: DashboardMetrics = EMPTY_METRICS;
      let nextReviewerKpi: DashboardKpi | null = null;

      if (sourceEndpoint.includes('/reviewer/dashboard')) {
        const pending = ((sourceData.queues as DashboardQueues)?.pendingReview?.items) || [];
        const revision = ((sourceData.queues as DashboardQueues)?.awaitingRevision?.items) || [];
        const approved = ((sourceData.queues as DashboardQueues)?.approvedWaitingPhase2?.items) || [];
        mappedItems = [...pending, ...revision, ...approved].map(toQueueItem);
        const kpi = (sourceData.kpi as DashboardKpi) || {};
        nextReviewerKpi = {
          pending: Number(kpi.pending || 0),
          dueIn48h: Number(kpi.dueIn48h || 0),
          overdueOrExpired: Number(kpi.overdueOrExpired || 0),
          reviewedToday: Number(kpi.reviewedToday || 0),
        };
        mappedMetrics = {
          newToday: Number(kpi.reviewedToday || 0),
          slaBreached: Number(kpi.overdueOrExpired || 0),
          awaitingResponse: Number(kpi.pending || 0),
          totalQueue: mappedItems.length,
        };
      } else {
        const applications = (sourceData.applications as QueuePayload[]) || [];
        mappedItems = applications.map(toQueueItem);
        mappedMetrics = calculateFallbackMetrics(mappedItems);
      }

      setQueueItems(mappedItems);
      setTraceItems(toTraceItems(mappedItems));
      setReviewerKpi(nextReviewerKpi);
      setMetrics(mappedMetrics.totalQueue > 0 ? mappedMetrics : calculateFallbackMetrics(mappedItems));
      setLastSyncedAt(formatDateTime(new Date().toISOString()));
    } catch (err) {
      // X2-FIX-C / H-6 — surface the error to the user (was: silent fall
      // through with zeroed KPIs that looked like a clean queue).
      const message = err instanceof Error && err.message
        ? err.message
        : (dict.common?.fetchError?.hint || 'Unable to load provider dashboard data at this time');
      setFetchError(message);
      setQueueItems([]);
      setTraceItems([]);
      setReviewerKpi(null);
      setMetrics(EMPTY_METRICS);
      setLastSyncedAt('-');
    } finally {
      setLoading(false);
    }
  // dict is captured at render time; loadDashboard is keyed by user.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const init = async () => {
      const meRes = await apiClient.get<ProviderUser>('/auth/provider/me');
      if (!meRes.success || !meRes.data) {
        router.replace('/auth/provider/login');
        return;
      }
      const normalized: ProviderUser = {
        ...meRes.data,
        canonicalRole: meRes.data.canonicalRole || meRes.data.role,
      };
      // Role-specific post-login landing — now driven by the single source of
      // truth (provider-role-config.ts), which guarantees each role is sent only
      // to a route it can actually enter (landing-route-coherence.test.ts). This
      // replaces the hardcoded switch that was the untested 3rd role-config source.
      //   scheduler → /provider/coordinator; auditor → /provider/audits;
      //   document_reviewer → /provider/reviewer (B5 — its own launchpad);
      //   both finance roles → /provider/accounting (one view — operator 2026-09-11).
      //   admin / legacy account → /provider/home (Task 7, N1 — tile home
      //     replaces this page as the universal landing). unknown → null →
      //     stay on the generic dashboard.
      const landing = providerLandingPath(normalized.canonicalRole || normalized.role);
      if (landing) {
        router.replace(landing);
        return;
      }
      setUser(normalized);
      void loadDashboard(normalized);
    };
    void init();
  }, [loadDashboard, router]);

  const normalizedRole = normalizeProviderRole(user?.canonicalRole || user?.role);
  const isReviewer = normalizedRole === 'document_reviewer';

  const roleLabel = useMemo(() => {
    const labels = dict.provider?.dashboard?.reviewer?.roleLabels;
    if (normalizedRole === 'document_reviewer') return labels?.document_reviewer || 'Document Reviewer';
    if (normalizedRole === CANONICAL_ROLES.DISPATCHER) return labels?.scheduler || 'Dispatcher';
    if (normalizedRole === CANONICAL_ROLES.FIELD_INSPECTOR) return labels?.auditor || 'Field Inspector';
    // ผู้อนุมัติใบรับรอง — บทบาทใหม่ 2026-09-10 (F-CERT-SOD) · ไม่มีคีย์ในไฟล์แปลภาษา
    // จึงยังไม่ดึงจาก dict; ป้ายไทยตัวจริงอยู่ที่ ROLE_LABELS_TH ใน role-utils.ts
    if (normalizedRole === CANONICAL_ROLES.CERTIFICATE_APPROVER) return 'Certificate Approver';
    if (normalizedRole === 'finance_officer_platform') return labels?.account || 'Accountant';
    if (normalizedRole === 'system_admin_dtam') return labels?.admin || 'Admin';
    return labels?.fallback || 'Provider Operations';
  }, [normalizedRole, dict.provider?.dashboard?.reviewer?.roleLabels]);

  // L5: only [admin, document_reviewer, auditor] are admitted to /provider/applications
  // (PROVIDER_ROUTE_ROLE_RULES). Legacy ACCOUNT lands on this generic dashboard but every
  // applications-targeting link silently bounced it back here (dead-end loop). Gate them.
  const canOpenApplications = useMemo(
    () => APPLICATIONS_READER_ROLES.includes(normalizedRole),
    [normalizedRole],
  );

  // B1 launchpad: only emit a KPI-tile drill-down href for roles that can
  // actually open the applications list (otherwise the link loops back here).
  const tileHref = useCallback(
    (status?: string) => {
      if (!canOpenApplications) return undefined;
      return status ? `/provider/applications?status=${status}` : '/provider/applications';
    },
    [canOpenApplications],
  );

  const filteredItems = useMemo(() => {
    return queueItems.filter((item) => {
      if (priorityFilter !== 'ALL' && item.priorityLabel.toLowerCase() !== priorityFilter.toLowerCase()) return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return [item.applicationNumber, item.applicantName, item.stageLabel, item.priorityLabel].some((value) =>
        value.toLowerCase().includes(q),
      );
    });
  }, [priorityFilter, query, queueItems]);

  const reviewerDict = dict.provider?.dashboard?.reviewer;
  const kpi = reviewerKpi ?? EMPTY_REVIEWER_KPI;

  // KPI tiles — document_reviewer surfaces the reviewer-dashboard kpi
  // (pending / dueIn48h / overdueOrExpired / reviewedToday); admin + the
  // applications-list fallback surface the computed metrics.
  const kpiTiles = useMemo(() => {
    if (isReviewer && reviewerKpi) {
      // Reviewer KPI tiles use dedicated labels (the generic reviewer.metrics
      // dict keys — งานทั้งหมด / รอตอบ — don't read correctly for the
      // pending / due-soon / overdue / reviewed-today reviewer signals).
      return [
        {
          label: 'รอตรวจ',
          value: kpi.pending ?? 0,
          tone: 'info' as const,
          hint: 'คำขอที่รอการตรวจเอกสาร',
          href: tileHref('ASSIGNED_FOR_REVIEW'),
          icon: ListChecks,
        },
        {
          label: 'ครบกำหนดใน 48 ชม.',
          value: kpi.dueIn48h ?? 0,
          tone: 'warning' as const,
          hint: 'งานที่ใกล้ถึงกำหนด SLA',
          href: tileHref('REVISION_REQUESTED'),
          icon: Clock,
        },
        {
          label: 'เกินกำหนด/หมดอายุ',
          value: kpi.overdueOrExpired ?? 0,
          tone: 'danger' as const,
          hint: 'งานที่เกินกำหนดหรือหมดอายุ',
          href: tileHref(),
          icon: AlertTriangle,
        },
        {
          label: 'ตรวจแล้ววันนี้',
          value: kpi.reviewedToday ?? 0,
          tone: 'success' as const,
          hint: 'จำนวนที่ตัดสินใจแล้ววันนี้',
          href: undefined,
          icon: CheckCircle2,
        },
      ];
    }
    const m = reviewerDict?.metrics;
    return [
      {
        label: m?.totalQueue || 'งานทั้งหมด',
        value: metrics.totalQueue,
        tone: 'neutral' as const,
        hint: undefined,
        href: tileHref(),
        icon: Inbox,
      },
      {
        label: m?.newToday || 'ใหม่วันนี้',
        value: metrics.newToday,
        tone: 'info' as const,
        hint: undefined,
        href: tileHref('SUBMITTED'),
        icon: Sparkles,
      },
      {
        label: m?.awaiting || 'รอตอบ',
        value: metrics.awaitingResponse,
        tone: 'warning' as const,
        hint: undefined,
        href: tileHref('REVISION_REQUESTED'),
        icon: Hourglass,
      },
      {
        label: m?.slaRisk || 'เสี่ยง SLA',
        value: metrics.slaBreached,
        tone: 'danger' as const,
        hint: undefined,
        href: tileHref(),
        icon: AlertTriangle,
      },
    ];
  }, [isReviewer, reviewerKpi, kpi, metrics, reviewerDict?.metrics, tileHref]);

  // One-line launchpad summary: pending count for reviewers, total queue
  // otherwise, plus the last-synced timestamp for context.
  const pendingForSummary = isReviewer && reviewerKpi ? (kpi.pending ?? 0) : metrics.totalQueue;
  const summary = `งานรอดำเนินการ ${pendingForSummary} รายการ · ${reviewerDict?.refresh ? 'ซิงค์ล่าสุด' : 'Last synced'} ${lastSyncedAt}`;

  return (
    <ProviderLayout title={reviewerDict?.layoutTitle || 'Officer Dashboard'} subtitle={reviewerDict?.layoutSubtitle || 'Work queue and SLA oversight'}>
      <div className="animate-fade-in space-y-4">

        {/* B1 — Fiori launchpad header band (replaces the gov-gradient hero).
            Greeting kicker + role title + a one-line work summary, with the
            refresh / view-all actions right-aligned. Token-only. */}
        <LaunchpadHeader
          greeting={`${reviewerDict?.welcome || 'ยินดีต้อนรับกลับ'}, ${user?.firstName || reviewerDict?.officer || 'เจ้าหน้าที่'}`}
          title={roleLabel}
          subtitle={summary}
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => user && void loadDashboard(user)}
              >
                <RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true" /> {reviewerDict?.refresh || 'รีเฟรช'}
              </Button>
              {canOpenApplications && (
                <Button asChild size="sm">
                  <Link href="/provider/applications">{reviewerDict?.viewAll || 'ดูทั้งหมด'}</Link>
                </Button>
              )}
            </>
          }
        />

        {/* X2-FIX-C / H-6 — rose fetch-error card with retry CTA.
            Replaces the previous amber-only alert that didn't expose a
            retry path. data-testid pins the regression guard at
            __tests__/dashboard-fetch-error.test.tsx. */}
        {fetchError && (
          <Card
            data-testid="dashboard-fetch-error"
            className="rounded-xl border border-destructive/30 bg-card p-4"
            role="alert"
            aria-live="polite"
          >
            <CardContent className="flex items-start gap-3 p-0">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" focusable="false" />
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold text-destructive">
                  {dict.common?.fetchError?.title || 'Unable to load data'}
                </h3>
                <p className="text-sm text-muted-foreground">{fetchError}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => user && void loadDashboard(user)}
                >
                  {dict.common?.fetchError?.retry || 'Try again'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* B1 — KPI tile grid. Role-aware: reviewer kpi vs computed metrics. */}
        <KpiTileGrid>
          {kpiTiles.map((tile) => (
            <KpiTile
              key={tile.label}
              label={tile.label}
              value={tile.value}
              tone={tile.tone}
              {...(tile.hint !== undefined ? { hint: tile.hint } : {})}
              {...(tile.href !== undefined ? { href: tile.href } : {})}
              icon={tile.icon}
            />
          ))}
        </KpiTileGrid>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

          {/* Main Queue */}
          <div className="space-y-4 lg:col-span-2">
            <ProviderDashboardCharts metrics={metrics} />

            {/* B1 — Priority Work Queue inside a launchpad QueueSection, with
                the search + priority filter as the section action and the
                shared DataTable (compact density) rendering the rows. The
                status badge reuses statusTone + STATUS_BADGE_CLASSES so the
                queue renders identically to the applications list + detail
                header; getSlaAgingBadge surfaces "ค้าง N วัน" inline. */}
            <QueueSection
              title={reviewerDict?.queue?.title || 'คิวงานสำคัญ'}
              count={filteredItems.length}
              icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
              action={
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <div className="relative w-full sm:max-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <label htmlFor="provider-queue-search" className="sr-only">{reviewerDict?.queue?.searchLabel || 'ค้นหารายการในคิว'}</label>
                    <Input
                      id="provider-queue-search"
                      placeholder={reviewerDict?.queue?.searchPlaceholder || 'ค้นหา...'}
                      className="h-9 rounded-md border-border bg-card pl-8 text-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                    <SelectTrigger
                      aria-label={reviewerDict?.queue?.filterLabel || 'กรองตามความสำคัญ'}
                      className="h-9 w-full rounded-md border-border bg-card text-sm font-normal sm:w-[130px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">{reviewerDict?.queue?.priorityAll || 'ทั้งหมด'}</SelectItem>
                      <SelectItem value="High">{reviewerDict?.queue?.priorityHigh || 'สูง'}</SelectItem>
                      <SelectItem value="Medium">{reviewerDict?.queue?.priorityMedium || 'ปานกลาง'}</SelectItem>
                      <SelectItem value="Normal">{reviewerDict?.queue?.priorityNormal || 'ปกติ'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              }
            >
              {loading ? (
                <div className="p-12 text-center" role="status" aria-live="polite">
                  <RefreshCcw className="mx-auto h-8 w-8 animate-spin text-primary/30" aria-hidden="true" />
                  <span className="sr-only">{reviewerDict?.queue?.loadingLabel || 'กำลังโหลดคิว'}</span>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-3 h-6 w-6 opacity-40" aria-hidden="true" />
                  {reviewerDict?.queue?.noMatch || 'ไม่มีรายการที่ตรงกับตัวกรอง'}
                </div>
              ) : (
                <DataTable<QueueItem>
                  data={filteredItems}
                  rowKey="id"
                  defaultDensity="compact"
                  hideDensityToggle
                  pageSize={25}
                  defaultSort={{ key: 'submittedDate', dir: 'desc' }}
                  columns={[
                    {
                      key: 'applicationNumber',
                      header: reviewerDict?.queue?.columns?.application || 'คำขอ',
                      sortable: true,
                      render: (item) => (
                        <>
                          <p className="text-sm font-semibold text-foreground">{item.applicationNumber}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{item.submittedDate}</p>
                          {/* The dashboard queue payload (QueueItem) carries only a
                              formatted submittedDate string + an `isOverdue` flag —
                              not a raw ISO date — so getSlaAgingBadge (which needs a
                              parseable createdAt + the ASSIGNED_FOR_REVIEW state)
                              cannot run here. Surface the SLA signal the item DOES
                              carry: the overdue flag, in the same warning-token chip
                              vocabulary as the applications-list aging badge. */}
                          {item.isOverdue && (
                            <Badge
                              variant="outline"
                              className="mt-1 inline-flex items-center gap-1 rounded-md border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning"
                              data-testid="dashboard-sla-aging-badge"
                            >
                              <AlertTriangle size={10} className="text-warning" aria-hidden="true" />
                              {reviewerDict?.queue?.priorityHigh || 'เกินกำหนด'}
                            </Badge>
                          )}
                        </>
                      ),
                      getSortValue: (item) => item.submittedDate,
                    },
                    {
                      key: 'applicantName',
                      header: reviewerDict?.queue?.columns?.applicant || 'ผู้ยื่น',
                      sortable: true,
                      render: (item) => <span className="text-sm text-foreground">{item.applicantName}</span>,
                      getSortValue: (item) => item.applicantName,
                    },
                    {
                      key: 'submittedDate',
                      header: reviewerDict?.queue?.columns?.stage || 'ขั้นตอน',
                      sortable: true,
                      render: (item) => {
                        const tone = statusTone(item.stageCode);
                        return (
                          <span
                            className={cn(
                              'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold',
                              STATUS_BADGE_CLASSES[tone.tone],
                            )}
                          >
                            {item.stageLabel}
                          </span>
                        );
                      },
                      getSortValue: (item) => item.submittedDate,
                    },
                    {
                      key: 'actions',
                      header: reviewerDict?.queue?.columns?.action || 'ดำเนินการ',
                      align: 'right',
                      render: (item) =>
                        // L5: hide the open-application affordance for roles that
                        // /provider/applications bounces (e.g. legacy ACCOUNT) — the
                        // link would silently loop back to the dashboard.
                        canOpenApplications ? (
                          <Button asChild variant="ghost" size="sm" className="h-11 min-h-[44px] w-11 min-w-[44px] p-0 text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:h-8 sm:min-h-0 sm:w-8 sm:min-w-0">
                            <Link href={item.actionHref} aria-label={`${reviewerDict?.queue?.openAria || 'เปิดคำขอ'} ${item.applicationNumber}`}>
                              <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            </Link>
                          </Button>
                        ) : null,
                    },
                  ]}
                />
              )}
            </QueueSection>
          </div>

          {/* Activity Timeline + Secure Access */}
          <div className="space-y-4">
            <QueueSection
              title={reviewerDict?.actions?.title || 'การดำเนินการล่าสุด'}
              icon={<Activity className="h-4 w-4" aria-hidden="true" />}
              bodyClassName="p-4"
            >
              {traceItems.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  {reviewerDict?.queue?.noMatch || 'ไม่มีรายการ'}
                </p>
              ) : (
                <div className="relative space-y-4 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-border">
                  {traceItems.map((item) => (
                    <div key={item.id} className="relative pl-6">
                      {/* One quiet neutral marker on the rail — the former
                          ringed primary dot with a second dot inside it was
                          decoration repeated once per row. */}
                      <div className="absolute left-1.5 top-2 z-10 h-2 w-2 rounded-full bg-muted-foreground/40 ring-2 ring-card" />
                      <div>
                        <p className="text-sm font-medium leading-snug text-foreground">{item.event}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.actor} • {item.occurredAt}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </QueueSection>

            <Card className="rounded-xl border border-border bg-card p-4">
              <div className="flex gap-3">
                {/* The icon sits on the card itself — the tinted rounded box
                    behind it was a card-in-a-card with nothing to say. */}
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{reviewerDict?.secureAccess?.title || 'เข้าใช้งานอย่างปลอดภัย'}</h4>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {reviewerDict?.secureAccess?.description || 'คุณกำลังเข้าถึงพอร์ทัลของรัฐบาลที่มีระบบรักษาความปลอดภัย ทุกเซสชันถูกบันทึกผ่าน Audit Trail'}
                  </p>
                </div>
              </div>
            </Card>
          </div>

        </div>
      </div>
    </ProviderLayout>
  );
}
