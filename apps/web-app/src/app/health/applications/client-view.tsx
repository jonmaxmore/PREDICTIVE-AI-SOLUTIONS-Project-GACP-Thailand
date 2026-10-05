'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Leaf } from 'lucide-react';
import { ConfirmDialog, EmptyState, FilterBar, SummaryHeader } from '@/components/feature';
import { Button } from '@/components/ui/primitives/button';
import { Card } from '@/components/ui/primitives/card';
import { apiClient as api } from '@/lib/api/api-client';
import {
  type HealthDashboardStage,
  normalizeHealthDashboardStage,
  STAGE_BADGE_STYLE,
  stageLabelFor,
  stageNextActionFor,
  stageDescriptionFor,
  stepperStepsFor,
  stepperIndexFor,
} from '@/lib/health-dashboard-stage';
import { AuthService } from '@/lib/services/auth-service';
import { useLanguage } from '@/lib/i18n/language-context';
import { HolderFilterChips, HolderLine, useHolderFilter } from '@/components/holder/holder-list';

interface Application {
  /** round 3: from GET /applications/my — names a renewal's charge as the renewal. */
  isRenewal?: boolean;
  id: string;
  applicationNumber?: string;
  status: string;
  workflowState?: string;
  phase1Status?: string;
  phase2Status?: string;
  dashboardStage?: string;
  hasCertificate?: boolean;
  /** The holder entity the application is filed for. */
  entityId?: string | null;
  createdAt: string;
  plantType?: string;
  plantName?: string;
  farmName?: string;
  province?: string;
  // Phase 9: surfaced from formData by the listing handler so the list
  // can show a countdown badge for REVISION_REQUESTED.
  revisionDueAt?: string | null;
  // Phase 10: CAR deadline counterpart for CAR_PENDING.
  carDueAt?: string | null;
}

type FilterKey = 'ALL' | 'ACTION_REQUIRED' | 'IN_PROGRESS' | 'COMPLETED';

// W3-C: the filter labels are computed inside the component now via
// dict.applicationsList + dict.filters so they react to the language
// toggle. Keeping the FilterKey list immutable; the labels were
// extracted into buildFilterOptions(dict) below.

type StageFilterGroup = Exclude<FilterKey, 'ALL'>;

/**
 * Which filter chip each stage belongs to.
 *
 * A `Record` over the stage union rather than three hand-kept Sets: the Sets
 * were not a partition, and the stage a farmer sat in right after paying was in
 * none of them — their application vanished from all three chips and counted in
 * none of the tallies. A missing stage here is now a compile error.
 */
const FILTER_GROUP_BY_STAGE: Record<HealthDashboardStage, StageFilterGroup> = {
  DRAFT: 'ACTION_REQUIRED',
  PENDING_FEE_PHASE1: 'ACTION_REQUIRED',
  REVISION_REQUIRED: 'ACTION_REQUIRED',
  PENDING_FEE_PHASE2: 'ACTION_REQUIRED',
  // จ่ายงวดที่ 2 แล้ว รอเจ้าหน้าที่นัดวัน — ผู้ยื่นไม่มีอะไรต้องทำ จึงไม่ใช่ ACTION_REQUIRED
  PENDING_AUDIT_SCHEDULE: 'IN_PROGRESS',
  UNDER_DOCUMENT_REVIEW: 'IN_PROGRESS',
  UNDER_FIELD_AUDIT: 'IN_PROGRESS',
  APPROVED: 'COMPLETED',
  CERTIFIED: 'COMPLETED',
  // Not "completed" in the happy-path sense, but the file is finished and has
  // no next step — grouping it with the in-progress work would be worse.
  CLOSED: 'COMPLETED',
};

function stageFilterGroup(stage: HealthDashboardStage): StageFilterGroup {
  return FILTER_GROUP_BY_STAGE[stage];
}

/** Stages where the applicant must take action */
function isActionRequiredStage(stage: HealthDashboardStage): boolean {
  return stageFilterGroup(stage) === 'ACTION_REQUIRED';
}

function classifyDashboardStage(app: Application): HealthDashboardStage {
  return normalizeHealthDashboardStage({
    status: app.status,
    ...(app.workflowState !== undefined ? { workflowState: app.workflowState } : {}),
    ...(app.phase1Status !== undefined ? { phase1Status: app.phase1Status } : {}),
    ...(app.phase2Status !== undefined ? { phase2Status: app.phase2Status } : {}),
    ...(app.dashboardStage !== undefined ? { dashboardStage: app.dashboardStage } : {}),
    ...(app.hasCertificate !== undefined ? { hasCertificate: app.hasCertificate } : {}),
  });
}

function formatThaiDate(dateValue: string, locale: string = 'th-TH'): string {
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: '2-digit' });
}

interface DeadlineDictionary {
  overdueBy: string;
  timeLeftHours: string;
  timeLeftDays: string;
}

/**
 * Phase 9: countdown badge for revision/CAR deadlines on the list view.
 * Returns null when there's no deadline; otherwise a label + urgency tone.
 * Critical = within 24h, warning = within 48h, info = beyond.
 *
 * W3-C: label templates now come from the dictionary so the badge
 * localizes with the rest of the listing instead of hard-coding the
 * Thai phrasing.
 */
function formatRevisionCountdown(iso: string | null | undefined, deadlineDict: DeadlineDictionary): { label: string; urgency: 'critical' | 'warning' | 'info' } | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const msLeft = due.getTime() - now.getTime();
  const hoursLeft = Math.round(msLeft / (60 * 60 * 1000));
  if (hoursLeft < 0) {
    const daysOver = Math.ceil(Math.abs(hoursLeft) / 24);
    return { label: deadlineDict.overdueBy.replace('{n}', String(daysOver)), urgency: 'critical' };
  }
  if (hoursLeft <= 24) return { label: deadlineDict.timeLeftHours.replace('{n}', String(hoursLeft)), urgency: 'critical' };
  if (hoursLeft <= 48) return { label: deadlineDict.timeLeftDays.replace('{n}', String(Math.ceil(hoursLeft / 24))), urgency: 'warning' };
  return { label: deadlineDict.timeLeftDays.replace('{n}', String(Math.ceil(hoursLeft / 24))), urgency: 'info' };
}

function stageMatchesFilter(stage: HealthDashboardStage, filter: FilterKey): boolean {
  if (filter === 'ALL') return true;
  return stageFilterGroup(stage) === filter;
}

// ── Stepper Sub-Component ───────────────────────────────────────────────────

function MiniStepper({ stage, isRenewal }: { stage: HealthDashboardStage; isRenewal?: boolean | undefined }) {
  const currentIdx = stepperIndexFor(stage, { isRenewal });
  // Show condensed 8-step stepper
  return (
    <div className="flex items-center gap-0.5">
      {stepperStepsFor({ isRenewal }).map((step, idx) => {
        const isComplete = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        return (
          <div key={step.stage} className="flex items-center">
            <div
              className={`h-2 w-2 rounded-full transition-all ${
                isComplete ? 'bg-leaf' : isCurrent ? 'scale-125 bg-leaf ring-2 ring-leaf/30' : 'bg-slate-200'
              }`}
              title={step.label}
            />
            {idx < stepperStepsFor({ isRenewal }).length - 1 && (
              <div className={`h-0.5 w-3 ${isComplete ? 'bg-leaf/50' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function ApplicationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { dict, language } = useLanguage();
  const listDict = dict.applicationsList;
  const dateLocale = language === 'en' ? 'en-US' : 'th-TH';

  // W3-C: filter labels mirror the dict.filters keys so the segmented
  // control localizes alongside the rest of the page.
  const filterOptions = useMemo<Array<{ key: FilterKey; label: string }>>(() => [
    { key: 'ALL', label: dict.common.all },
    { key: 'ACTION_REQUIRED', label: dict.filters.actionRequired },
    { key: 'IN_PROGRESS', label: dict.filters.inProgress },
    { key: 'COMPLETED', label: dict.filters.completed },
  ], [dict]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterKey>('ALL');
  const holder = useHolderFilter();
  const holderSelectedId = holder.selectedId;
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest');
  // Wave E.3-C follow-up: ConfirmDialog state for "cancel draft".
  // Stores the draft id awaiting confirmation; null when no dialog is open.
  const [pendingDeleteDraftId, setPendingDeleteDraftId] = useState<string | null>(null);
  const [isDeletingDraft, setIsDeletingDraft] = useState(false);

  useEffect(() => {
    const user = AuthService.getUser();
    if (!user) {
      router.replace('/auth/health/login');
      return;
    }

    const requestedStatus = (searchParams.get('status') || 'ALL').toUpperCase() as FilterKey;
    if (filterOptions.some((item) => item.key === requestedStatus)) {
      setStatusFilter(requestedStatus);
    }
    setSearchQuery(searchParams.get('q') || '');
    void loadApplications();
    // filterOptions only swaps display labels (keys are stable), so omit
    // it from deps to avoid re-loading the listing on every language
    // toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, searchParams]);

  const loadApplications = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api.get<Application[]>('/applications/my');
      if (!result.success || !result.data) {
        setLoadError(result.error || listDict.loadError);
        setApplications([]);
      } else {
        const list = Array.isArray(result.data)
          ? result.data
          : ((result.data as unknown as { data?: Application[] }).data || []);
        setApplications(list);
      }
    } catch {
      setLoadError(listDict.loadErrorRetry);
      setApplications([]);
    } finally {
      setLoading(false);
    }
  };

  // Phase 9: cancel a DRAFT row in place. Backend endpoint exists since
  // 2026-04-29 (DELETE /api/applications/draft/:id) but had no UI before.
  // Wave E.3-C follow-up: confirmation moved from window.confirm to
  // ConfirmDialog (state-driven, i18n-aware).
  async function performDeleteDraft(id: string) {
    setIsDeletingDraft(true);
    try {
      const res = await api.delete<{ deleted: boolean }>(`/applications/draft/${encodeURIComponent(id)}`);
      if (!res.success) {
        setLoadError(res.error || listDict.deleteDraftError);
        return;
      }
      await loadApplications();
    } catch {
      setLoadError(listDict.deleteDraftErrorGeneric);
    } finally {
      setIsDeletingDraft(false);
      setPendingDeleteDraftId(null);
    }
  }

  const stageMap = useMemo(() => new Map(applications.map((app) => [app.id, classifyDashboardStage(app)])), [applications]);

  const stats = useMemo(() => {
    let actionRequired = 0;
    let inProgress = 0;
    let completed = 0;
    applications.forEach((app) => {
      const stage = stageMap.get(app.id)!;
      const group = stageFilterGroup(stage);
      if (group === 'ACTION_REQUIRED') actionRequired++;
      else if (group === 'IN_PROGRESS') inProgress++;
      else completed++;
    });
    return { total: applications.length, actionRequired, inProgress, completed };
  }, [applications, stageMap]);

  const tabCount = useMemo(() => {
    const counts: Record<FilterKey, number> = { ALL: 0, ACTION_REQUIRED: 0, IN_PROGRESS: 0, COMPLETED: 0 };
    applications.forEach((app) => {
      const stage = stageMap.get(app.id)!;
      counts.ALL++;
      counts[stageFilterGroup(stage)]++;
    });
    return counts;
  }, [applications, stageMap]);

  const filteredApplications = useMemo(() => {
    return applications
      .filter((app) => stageMatchesFilter(stageMap.get(app.id)!, statusFilter))
      .filter((app) => holderSelectedId === null || app.entityId === holderSelectedId)
      .filter((app) => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return true;
        return [app.applicationNumber, app.id, app.farmName, app.plantName, app.plantType, app.province]
          .some((field) => String(field || '').toLowerCase().includes(query));
      })
      .sort((a, b) => {
        if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [applications, searchQuery, sortBy, stageMap, statusFilter, holderSelectedId]);

  const listRows = filteredApplications.map((app) => {
    const stage = stageMap.get(app.id)!;
    // Phase 10: pick the right deadline for the applicable stage. REVISION_REQUIRED
    // → revisionDueAt; CAR_PENDING (audit-side) → carDueAt. CAR_PENDING bucketizes
    // into UNDER_FIELD_AUDIT in the dashboard stage, so we look at the raw status
    // to pick the carDueAt path.
    const rawStatus = String(app.status || '').toUpperCase();
    const rawWorkflow = String(app.workflowState || '').toUpperCase();
    const isCarPending = rawStatus === 'CAR_PENDING' || rawWorkflow === 'CAR_PENDING';
    const deadlineCountdown =
      stage === 'REVISION_REQUIRED' ? formatRevisionCountdown(app.revisionDueAt, dict.deadline)
        : isCarPending ? formatRevisionCountdown(app.carDueAt, dict.deadline)
        : null;

    return {
      id: app.id,
      code: app.applicationNumber || `APP-${app.id.slice(-6).toUpperCase()}`,
      farmName: app.farmName || '-',
      holderName: holder.holderOf(app),
      stage,
      stageLabel: stageLabelFor(stage, { isRenewal: app.isRenewal }),
      dateLabel: `${dict.common.submitDate} ${formatThaiDate(app.createdAt, dateLocale)}`,
      actionLabel: stageNextActionFor(stage, { isRenewal: app.isRenewal }),
      isRenewal: app.isRenewal,
      // Pending-fee stages get an explicit, separate "pay" button on the card
      // (the rest of the card navigates to the status page — matching the
      // dashboard). 2026-06-25: previously the WHOLE card linked to /payments,
      // so the applicant could never open the status page from the list.
      isPaymentStage: stage === 'PENDING_FEE_PHASE1' || stage === 'PENDING_FEE_PHASE2',
      deadlineCountdown,
      isCarPending,
    };
  });

  return (
    <div className="flow-stack-lg animate-fade-in-up" role="main">
      <SummaryHeader
        eyebrow={dict.eyebrow.applicantApplications}
        title={listDict.title}
        description={listDict.subtitle}
        metrics={[
          // The list below already refuses its empty state while `loadError` is set.
          // These four tiles are the same claim as a number: '0 คำขอทั้งหมด' over a
          // failed read tells an applicant they have filed nothing.
          { label: listDict.metricTotal, value: loadError ? '—' : stats.total.toLocaleString(dateLocale) },
          { label: listDict.metricActionRequired, value: loadError ? '—' : stats.actionRequired.toLocaleString(dateLocale) },
          { label: listDict.metricInProgress, value: loadError ? '—' : stats.inProgress.toLocaleString(dateLocale) },
          { label: listDict.metricCompleted, value: loadError ? '—' : stats.completed.toLocaleString(dateLocale) },
        ]}
        actions={
          // h-11 below sm:, h-9 from sm: up — 44px for a thumb, compact for a mouse.
          <Button asChild variant="secondary" size="sm" className="h-11 sm:h-9">
            <Link href="/health/applications/new" className="no-underline" aria-label={dict.common.newApplication}>
              {listDict.newApplicationBtn}
            </Link>
          </Button>
        }
      />

      <HolderFilterChips entities={holder.entities} selectedId={holder.selectedId} onSelect={holder.setSelectedId} />

      <FilterBar
        query={searchQuery}
        onQueryChange={setSearchQuery}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        activeFilter={statusFilter}
        onFilterChange={(value) => setStatusFilter(value as FilterKey)}
        options={filterOptions.map((option) => ({
          key: option.key,
          label: option.label,
          count: tabCount[option.key],
        }))}
      />

      {/* X1-FIX-C / H-2 — upgraded error surface.
          The previous one-liner destructive card was easy to scroll past
          and lacked a retry CTA, so applicants whose backend was down
          saw an EmptyState below ("no applications match this filter")
          and assumed they had to use the wizard. Now we render a
          prominent rose-bordered card with title + body + retry,
          mirroring the pattern from certificates/client-view.tsx
          (data-testid="cert-list-error") so users get one consistent
          recovery affordance across HEALTH pages. */}
      {loadError ? (
        <Card
          data-testid="applications-list-error"
          role="alert"
          className="rounded-[1.375rem] border-2 border-rose-200 bg-rose-50/60 p-8 text-center"
        >
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-rose-500" aria-hidden="true" focusable="false" />
          <h3 className="text-base font-bold text-rose-800">
            {dict.common?.fetchError?.title || 'Unable to load data'}
          </h3>
          <p className="mt-1 text-sm text-rose-700">{loadError}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 border-rose-300 text-rose-700 hover:bg-rose-100"
            onClick={() => loadApplications()}
          >
            {dict.common?.fetchError?.retry || 'Try again'}
          </Button>
        </Card>
      ) : null}

      {/* Application Cards with Mini Stepper */}
      <section className="flow-stack-md" aria-label={listDict.listHeading}>
        <div className="flex flex-col flex-wrap items-start justify-between gap-2 sm:flex-row sm:items-center">
          <h2 className="text-base font-semibold text-foreground sm:text-lg lg:text-xl">{listDict.listHeading}</h2>
          <p className="text-sm text-muted-foreground">{listRows.length.toLocaleString(dateLocale)} {listDict.itemCount}</p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton h-28 rounded-[1.375rem]" />)}
          </div>
        ) : loadError ? null : listRows.length === 0 ? (
          <EmptyState
            title={listDict.emptyTitle}
            hint={listDict.emptyHint}
          />
        ) : (
          <div className="space-y-3">
            {listRows.map((row) => {
              const badge = STAGE_BADGE_STYLE[row.stage];
              const isActionRequired = isActionRequiredStage(row.stage);
              const deadline = row.deadlineCountdown;
              return (
                <div
                  key={row.id}
                  className="group rounded-[1.375rem] border border-mint-bg bg-card shadow-leaf-card transition-all hover:shadow-leaf-card-hover"
                >
                {/* Card body → the status/detail page, via a stretched link
                    BEHIND the content (matches how the dashboard links an app).
                    The pay button (pending-fee) opts back into pointer events so
                    clicking it goes to /payments, while clicking anywhere else on
                    the card opens the status page. (2026-06-25 — previously the
                    WHOLE card linked to /payments, so the status page was
                    unreachable from the list.) */}
                <div className="relative p-4 active:scale-[0.995] sm:p-5">
                  <Link
                    href={`/health/applications/${row.id}`}
                    aria-label={`${row.code} — ${row.stageLabel}`}
                    className="absolute inset-0 z-0 rounded-[1.375rem] no-underline"
                  />
                  <div className="pointer-events-none relative z-10">
                  {/* Top row: Code + Badge + Date.
                      Mobile: code/badge/date stack vertically and the
                      CTA pill wraps onto its own row below — this stops
                      long Thai action labels (e.g.
                      "ชำระเงินงวดที่ 1") from squeezing the
                      application number into 2-3 chars at 360px. */}
                  <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between">
                    {/* ui_kit reskin (Wave 3, 2026-06-09): leaf-icon row + pill
                        status chip, matching the ref applications table + the
                        verified dashboard. Functionality (filters/stepper/
                        deadline/draft) is unchanged. */}
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                        <Leaf className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-foreground">{row.code}</span>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.text}`}>
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                            {row.stageLabel}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{row.farmName} · {row.dateLabel}</p>
                        <HolderLine name={row.holderName} />
                      </div>
                    </div>
                    {/* CTA. Pending-fee → a SEPARATE pay Link (pointer-events
                        re-enabled) so it routes to /payments while the rest of
                        the card opens the status page. Other stages render a
                        non-interactive label — the card's stretched link carries
                        the click to the status page. */}
                    <div className={`w-full shrink-0 sm:w-auto ${row.isPaymentStage ? 'pointer-events-auto' : ''}`}>
                      {row.isPaymentStage ? (
                        <Link
                          href={`/health/payments?app=${row.id}`}
                          className="relative z-10 inline-flex min-h-[44px] w-full items-center justify-center gap-1 whitespace-normal rounded-full bg-leaf px-4 py-2 text-xs font-semibold text-white no-underline shadow-leaf-btn transition-colors hover:bg-leaf-600 sm:min-h-0 sm:w-auto sm:py-2"
                        >
                          {row.actionLabel}
                          <span className="transition-transform group-hover:translate-x-0.5">→</span>
                        </Link>
                      ) : (
                        <span className={`inline-flex min-h-[44px] w-full items-center justify-center gap-1 whitespace-normal rounded-full px-4 py-2 text-xs font-semibold transition-colors sm:min-h-0 sm:w-auto sm:py-2 ${
                          isActionRequired
                            ? 'bg-leaf text-white shadow-leaf-btn group-hover:bg-leaf-600'
                            : 'bg-leaf-soft text-leaf-onSoft group-hover:bg-leaf-soft/70'
                        }`}>
                          {row.actionLabel}
                          <span className="transition-transform group-hover:translate-x-0.5">→</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Progress stepper */}
                  <div className="mt-3 flex items-center justify-between">
                    <MiniStepper stage={row.stage} isRenewal={row.isRenewal} />
                    {stepperIndexFor(row.stage, { isRenewal: row.isRenewal }) >= 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {listDict.stepLabel
                          .replace('{current}', String(stepperIndexFor(row.stage, { isRenewal: row.isRenewal }) + 1))
                          .replace('{total}', String(stepperStepsFor({ isRenewal: row.isRenewal }).length))}
                      </span>
                    )}
                  </div>

                  {/* Description overlay for action-required items */}
                  {isActionRequired && (
                    <div className="mt-2 rounded-xl bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
                      {stageDescriptionFor(row.stage, { isRenewal: row.isRenewal })}
                    </div>
                  )}

                  {/* Deadline countdown — Phase 9 (revision) + Phase 10 (CAR).
                      Same urgency tones; copy switches based on which deadline
                      applies. */}
                  {deadline ? (
                    <div
                      className={`mt-2 rounded-xl px-3 py-1.5 text-[11px] font-semibold ${
                        deadline.urgency === 'critical'
                          ? 'bg-red-50 text-red-700'
                          : deadline.urgency === 'warning'
                          ? 'bg-orange-50 text-orange-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {deadline.label}{' '}
                      {deadline.urgency === 'critical'
                        ? (row.isCarPending ? dict.deadline.carUrgent : dict.deadline.revisionUrgent)
                        : (row.isCarPending ? dict.deadline.beforeCarDeadline : dict.deadline.beforeRevisionDeadline)}
                    </div>
                  ) : null}
                  </div>
                </div>
                {/* Draft footer — continue/delete actions. Both outside
                    the Link so the click doesn't propagate. The
                    detail-page CTA (CONTINUE_DRAFT in
                    application-detail-page-helpers) routes to the same
                    edit page; mirroring it here saves the farmer one
                    extra click — they reported having to drill through
                    the detail page to find the resume button. */}
                {row.stage === 'DRAFT' ? (
                  <div className="flex items-center justify-between border-t border-mint-bg px-4 py-1 sm:px-5">
                    <Link
                      href={`/health/applications/${row.id}/edit`}
                      className="inline-flex min-h-[44px] items-center text-xs font-semibold text-leaf-700 hover:underline"
                    >
                      {listDict.continueDraft}
                    </Link>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteDraftId(row.id)}
                      className="inline-flex min-h-[44px] items-center text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
                    >
                      {listDict.deleteDraft}
                    </button>
                  </div>
                ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Wave E.3-C follow-up: replacement for window.confirm() on the
          delete-draft button. Caller-controlled state pattern preserves
          the per-row context (we know which row is being deleted via
          pendingDeleteDraftId). */}
      <ConfirmDialog
        open={pendingDeleteDraftId !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingDraft) setPendingDeleteDraftId(null);
        }}
        onConfirm={() => {
          if (pendingDeleteDraftId) performDeleteDraft(pendingDeleteDraftId);
        }}
        title={listDict.deleteDraftTitle}
        description={listDict.deleteDraftDesc}
        confirmLabel={listDict.deleteDraftConfirm}
        variant="destructive"
      />
    </div>
  );
}
