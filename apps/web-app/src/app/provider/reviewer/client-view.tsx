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
  EMPTY_METRICS,
  formatDateTime,
  toQueueItem,
  toTraceItems,
} from '../dashboard/dashboard-utils';

const EMPTY_REVIEWER_KPI: DashboardKpi = {
  pending: 0,
  dueIn48h: 0,
  overdueOrExpired: 0,
  reviewedToday: 0,
};

/**
 * B5 — DOCUMENT_REVIEWER dedicated launchpad (`/provider/reviewer`).
 *
 * Owner directive "different people / different departments → different
 * pages": the document reviewer now lands on its OWN URL instead of the
 * shared generic `/provider/dashboard`. This view is the reviewer branch
 * of dashboard/page.tsx, narrowed to the reviewer role only — it always
 * fetches `/api/provider/reviewer/dashboard` and renders the reviewer
 * KPIs + queues with the shared launchpad components (LaunchpadHeader /
 * KpiTileGrid / QueueSection / DataTable + statusTone). The generic
 * dashboard's reviewer branch stays as a harmless fallback.
 *
 * The route gate (provider-role-config.ts) admits ONLY [ADMIN,
 * DOCUMENT_REVIEWER] here; ADMIN may open it by URL but keeps its
 * post-login landing on /provider/dashboard. Token-only colors.
 */
export default function ReviewerDashboardClientView() {
  const router = useRouter();
  const { dict } = useLanguage();
  const [user, setUser] = useState<ProviderUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Explicit fetch-error state (mirrors the generic dashboard X2-FIX-C
  // pattern): a network outage rendered zeroed KPIs + an empty queue
  // indistinguishable from a brand-new reviewer with no work. Surface a
  // destructive Card with the error + a retry CTA.
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [traceItems, setTraceItems] = useState<TraceItem[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  const [reviewerKpi, setReviewerKpi] = useState<DashboardKpi | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>('-');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setFetchError(null);

    try {
      const response = await apiClient.get<Record<string, unknown>>(
        providerApiPaths.reviewerDashboard('?limit=100'),
      );
      if (!response.success || !response.data || typeof response.data !== 'object') {
        throw new Error('Unable to load reviewer dashboard data');
      }
      const sourceData = response.data;

      const pending = ((sourceData.queues as DashboardQueues)?.pendingReview?.items) || [];
      const revision = ((sourceData.queues as DashboardQueues)?.awaitingRevision?.items) || [];
      const approved = ((sourceData.queues as DashboardQueues)?.approvedWaitingPhase2?.items) || [];
      const mappedItems = [...pending, ...revision, ...approved].map(toQueueItem);

      const kpi = (sourceData.kpi as DashboardKpi) || {};
      const nextReviewerKpi: DashboardKpi = {
        pending: Number(kpi.pending || 0),
        dueIn48h: Number(kpi.dueIn48h || 0),
        overdueOrExpired: Number(kpi.overdueOrExpired || 0),
        reviewedToday: Number(kpi.reviewedToday || 0),
      };
      const mappedMetrics: DashboardMetrics = {
        newToday: Number(kpi.reviewedToday || 0),
        slaBreached: Number(kpi.overdueOrExpired || 0),
        awaitingResponse: Number(kpi.pending || 0),
        totalQueue: mappedItems.length,
      };

      setQueueItems(mappedItems);
      setTraceItems(toTraceItems(mappedItems));
      setReviewerKpi(nextReviewerKpi);
      setMetrics(mappedMetrics);
      setLastSyncedAt(formatDateTime(new Date().toISOString()));
    } catch (err) {
      const message = err instanceof Error && err.message
        ? err.message
        : (dict.common?.fetchError?.hint || 'Unable to load reviewer dashboard data at this time');
      setFetchError(message);
      setQueueItems([]);
      setTraceItems([]);
      setReviewerKpi(null);
      setMetrics(EMPTY_METRICS);
      setLastSyncedAt('-');
    } finally {
      setLoading(false);
    }
  // dict is captured at render time.
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
      setUser(normalized);
      void loadDashboard();
    };
    void init();
  }, [loadDashboard, router]);

  const reviewerDict = dict.provider?.dashboard?.reviewer;
  const roleLabel = reviewerDict?.roleLabels?.document_reviewer || 'Document Reviewer';
  const kpi = reviewerKpi ?? EMPTY_REVIEWER_KPI;

  // ADMIN may open this page by URL; everyone admitted here can open the
  // applications list (route gate = [ADMIN, DOCUMENT_REVIEWER], both of
  // which are admitted to /provider/applications), so the drill-down links
  // never bounce.
  const tileHref = useCallback(
    (status?: string) =>
      status ? `/provider/applications?status=${status}` : '/provider/applications',
    [],
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

  // Reviewer KPI tiles — pending / dueIn48h / overdueOrExpired /
  // reviewedToday (dedicated reviewer labels per the brief).
  const kpiTiles = useMemo(
    () => [
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
    ],
    [kpi, tileHref],
  );

  const pendingForSummary = kpi.pending ?? 0;
  const summary = `งานรอดำเนินการ ${pendingForSummary} รายการ · ${reviewerDict?.refresh ? 'ซิงค์ล่าสุด' : 'Last synced'} ${lastSyncedAt}`;

  return (
    <ProviderLayout
      title={reviewerDict?.layoutTitle || 'Officer Dashboard'}
      subtitle={reviewerDict?.layoutSubtitle || 'Work queue and SLA oversight'}
    >
      <div className="animate-fade-in space-y-4">

        <LaunchpadHeader
          greeting={`${reviewerDict?.welcome || 'ยินดีต้อนรับกลับ'}, ${user?.firstName || reviewerDict?.officer || 'เจ้าหน้าที่'}`}
          title={roleLabel}
          subtitle={summary}
          actions={
            <>
              {/* Minimal-redesign pass: plain buttons at the token radius —
                  pill-shaped chrome read louder than the data below it. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadDashboard()}
              >
                <RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true" /> {reviewerDict?.refresh || 'รีเฟรช'}
              </Button>
              <Button asChild size="sm">
                <Link href="/provider/applications">{reviewerDict?.viewAll || 'ดูทั้งหมด'}</Link>
              </Button>
            </>
          }
        />

        {fetchError && (
          <Card
            data-testid="reviewer-dashboard-fetch-error"
            className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
            role="alert"
            aria-live="polite"
          >
            <CardContent className="flex flex-col items-center gap-3 p-0">
              <AlertCircle className="h-10 w-10 text-destructive" aria-hidden="true" focusable="false" />
              <h3 className="text-base font-bold text-destructive">
                {dict.common?.fetchError?.title || 'Unable to load data'}
              </h3>
              <p className="text-sm text-muted-foreground">{fetchError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void loadDashboard()}
              >
                {dict.common?.fetchError?.retry || 'Try again'}
              </Button>
            </CardContent>
          </Card>
        )}

        <KpiTileGrid>
          {kpiTiles.map((tile) => (
            <KpiTile
              key={tile.label}
              label={tile.label}
              value={tile.value}
              tone={tile.tone}
              hint={tile.hint}
              {...(tile.href !== undefined ? { href: tile.href } : {})}
              icon={tile.icon}
            />
          ))}
        </KpiTileGrid>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

          {/* Main Queue */}
          <div className="space-y-4 lg:col-span-2">
            <ProviderDashboardCharts metrics={metrics} />

            <QueueSection
              title={reviewerDict?.queue?.title || 'คิวงานสำคัญ'}
              count={filteredItems.length}
              icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
              action={
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <div className="relative w-full sm:max-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <label htmlFor="reviewer-queue-search" className="sr-only">{reviewerDict?.queue?.searchLabel || 'ค้นหารายการในคิว'}</label>
                    <Input
                      id="reviewer-queue-search"
                      placeholder={reviewerDict?.queue?.searchPlaceholder || 'ค้นหา...'}
                      className="h-8 border-border bg-card pl-8 text-xs focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                    <SelectTrigger
                      aria-label={reviewerDict?.queue?.filterLabel || 'กรองตามความสำคัญ'}
                      className="h-8 w-full border-border bg-card text-[11px] font-semibold sm:w-[120px]"
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
                <div className="py-16 text-center font-medium text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-4 h-12 w-12 opacity-30" aria-hidden="true" />
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
                          <p className="text-sm font-bold tracking-tight text-foreground">{item.applicationNumber}</p>
                          <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{item.submittedDate}</p>
                          {item.isOverdue && (
                            <Badge
                              variant="outline"
                              className="mt-1 inline-flex items-center gap-1 rounded-md border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold text-warning"
                              data-testid="reviewer-sla-aging-badge"
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
                      render: (item) => (
                        <div>
                          <span className="text-sm font-semibold text-foreground">{item.applicantName}</span>
                          {/* C3 ("งานนี้พาสไปที่ใคร"): show the job's origin so the
                              reviewer knows who assigned it. */}
                          {item.assignedByName && (
                            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                              มอบหมายโดย {item.assignedByName}
                            </p>
                          )}
                        </div>
                      ),
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
                      render: (item) => (
                        <div className="flex items-center justify-end gap-2">
                          {/* กทล.๑ ส่วน จนท. ข้อ ๑.๑ — ตรวจเอกสารทีละรายการ. Without this
                              link the per-slot screen exists and nobody can reach it,
                              which is the same defect as a job nobody registers. */}
                          <Button asChild variant="outline" size="sm" className="h-11 min-h-[44px] px-3 sm:h-8 sm:min-h-0">
                            <Link
                              href={`/provider/reviewer/${item.id}/document-check`}
                              aria-label={`ตรวจเอกสารตาม กทล.1 ${item.applicationNumber}`}
                            >
                              ตรวจเอกสารตาม กทล.1
                            </Link>
                          </Button>
                          <Button asChild variant="ghost" size="sm" className="h-11 min-h-[44px] w-11 min-w-[44px] rounded-full p-0 transition-all hover:bg-primary hover:text-white focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:h-8 sm:min-h-0 sm:w-8 sm:min-w-0">
                            <Link href={item.actionHref} aria-label={`${reviewerDict?.queue?.openAria || 'เปิดคำขอ'} ${item.applicationNumber}`}>
                              <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            </Link>
                          </Button>
                        </div>
                      ),
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
                      <div className="absolute left-0 top-1.5 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-primary bg-card">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                      </div>
                      <div>
                        <p className="text-xs font-bold leading-tight text-foreground">{item.event}</p>
                        <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                          {item.actor} • {item.occurredAt}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </QueueSection>

            <Card className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">{reviewerDict?.secureAccess?.title || 'เข้าใช้งานอย่างปลอดภัย'}</h4>
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
