'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import {
  FileText, Leaf, ArrowRight, AlertCircle, CreditCard, FileEdit,
  MapPin, BadgeCheck, XCircle, AlertTriangle, CheckCircle, Clock, CalendarDays,
} from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { apiClient as api } from '@/lib/api/api-client';
import { normalizeHealthDashboardStage, type HealthDashboardStage, STAGE_LABEL_EN, stageLabelFor } from '@/lib/health-dashboard-stage';
import { AuthService, AuthUser } from '@/lib/services/auth-service';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { Card } from '@/components/ui/primitives/card';
import { getStatusInfo, isUserActionRequired } from '@/lib/status-mapping';
import { getStatusLabel } from '@/lib/constants/workflow-states';
import { useLanguage } from '@/lib/i18n/language-context';

/* ── Types ── */
interface ApplicationRecord {
  id: string;
  /** round 3: from GET /applications/my — names a renewal's charge as the renewal. */
  isRenewal?: boolean;
  applicationNumber?: string;
  farmName?: string;
  plantName?: string;
  submittedAt?: string;
  createdAt?: string;
  status?: string;
  stage?: string;
}

/* ── ui_kit redesign (Wave 2, 2026-06-08) — matches the GACP Thailand Design
   System reference dashboard: gradient hero banner · funnel KPI card · recent-
   applications table with progress bars · right-rail status donut + next-action.
   Friendly leaf-green + mint surfaces; deep forest for depth/text. Real data. ── */

// Status → friendly tone (matches the ref STATUS map: colour + word).
const STAGE_TONE: Record<HealthDashboardStage, { bar: string; dot: string; chip: string }> = {
  DRAFT: { bar: 'bg-slate-300', dot: 'bg-slate-400', chip: 'bg-muted text-muted-foreground' },
  PENDING_FEE_PHASE1: { bar: 'bg-amber-400', dot: 'bg-amber-400', chip: 'bg-amber-50 text-amber-700' },
  UNDER_DOCUMENT_REVIEW: { bar: 'bg-amber-400', dot: 'bg-amber-400', chip: 'bg-amber-50 text-amber-700' },
  REVISION_REQUIRED: { bar: 'bg-red-500', dot: 'bg-red-500', chip: 'bg-red-50 text-red-700' },
  PENDING_FEE_PHASE2: { bar: 'bg-amber-400', dot: 'bg-amber-400', chip: 'bg-amber-50 text-amber-700' },
  // จ่ายแล้ว รอเจ้าหน้าที่นัด — โทนเดียวกับ "กำลังดำเนินการ" ไม่ใช่โทน "ต้องทำอะไร"
  PENDING_AUDIT_SCHEDULE: { bar: 'bg-sky-500', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700' },
  UNDER_FIELD_AUDIT: { bar: 'bg-sky-500', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700' },
  APPROVED: { bar: 'bg-leaf', dot: 'bg-leaf', chip: 'bg-leaf-soft text-leaf-onSoft' },
  CERTIFIED: { bar: 'bg-leaf', dot: 'bg-leaf', chip: 'bg-leaf-soft text-leaf-onSoft' },
  // Terminal — greyed out, and the bar is deliberately neutral so a closed file
  // never reads as "still going".
  CLOSED: { bar: 'bg-slate-300', dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-500' },
};
const STAGE_PCT: Record<HealthDashboardStage, number> = {
  DRAFT: 5, PENDING_FEE_PHASE1: 15, UNDER_DOCUMENT_REVIEW: 30, REVISION_REQUIRED: 40,
  PENDING_FEE_PHASE2: 55, PENDING_AUDIT_SCHEDULE: 62, UNDER_FIELD_AUDIT: 70, APPROVED: 90, CERTIFIED: 100,
  // No progress claim for a closed file.
  CLOSED: 0,
};

// Conic-gradient donut stops — chart-only CSS color strings (the donut renders a
// single `background` value, not className tokens). `done` reuses the design-system
// --leaf var; the others mirror the same Tailwind palette weights as the legend
// dots below (amber-400 / sky-500 / slate-400) so the chart + legend stay in sync.
const DONUT_COLOR = {
  review: 'rgb(251 191 36)', // amber-400 — matches the bg-amber-400 legend dot
  audit: 'rgb(14 165 233)',  // sky-500   — matches the bg-sky-500 legend dot
  done: 'var(--leaf)',       // leaf      — matches the bg-leaf legend dot
  draft: 'rgb(148 163 184)', // slate-400 — matches the bg-slate-400 legend dot
} as const;

// Donut from real stage counts (conic-gradient, like the ref Donut).
function StatusDonut({ segments, total, label }: { segments: { pct: number; color: string }[]; total: number; label: string }) {
  let acc = 0;
  const stops = segments.length
    ? segments.map((s) => { const from = acc; acc += s.pct; return `${s.color} ${from}% ${acc}%`; }).join(', ')
    : 'rgb(var(--mint-bg)) 0% 100%';
  return (
    <div className="relative mx-auto h-[168px] w-[168px]">
      <div className="h-full w-full rounded-full" style={{ background: `conic-gradient(${stops})` }} />
      <div className="absolute inset-[22px] flex flex-col items-center justify-center rounded-full bg-card">
        <div className="text-[11.5px] text-muted-foreground">{label}</div>
        <div className="text-3xl font-bold tabular-nums text-foreground">{total}</div>
      </div>
    </div>
  );
}

export default function HealthDashboardPage() {
  const router = useRouter();
  const { dict, language } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ applications: ApplicationRecord[]; user: AuthUser | null }>({ applications: [], user: null });
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const loadDashboard = async () => {
      try {
        const user = AuthService.getUser();
        if (!user) { router.replace('/auth/health/login'); return; }
        setFetchError(null);
        const appsRes = await api.get<ApplicationRecord[]>('/api/applications/my');
        if (cancelled) return;
        if (appsRes.success === false) {
          setFetchError(appsRes.error || dict.common?.fetchError?.hint || 'Unable to load data');
          setData((prev) => ({ applications: [], user: (user as AuthUser) || prev.user }));
          return;
        }
        setData({ applications: Array.isArray(appsRes.data) ? appsRes.data : [], user: user as AuthUser });
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load dashboard:', error);
        const message = error instanceof Error && error.message ? error.message : (dict.common?.fetchError?.hint || 'Unable to load data');
        setFetchError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadDashboard();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, retryToken]);

  const stageList = useMemo(() => data.applications.map((app) => normalizeHealthDashboardStage(app)), [data]);

  const stats = useMemo(() => ({
    total: stageList.length,
    docReview: stageList.filter((s) => ['UNDER_DOCUMENT_REVIEW', 'REVISION_REQUIRED', 'PENDING_FEE_PHASE1'].includes(s)).length,
    audit: stageList.filter((s) => ['UNDER_FIELD_AUDIT', 'PENDING_FEE_PHASE2'].includes(s)).length,
    approved: stageList.filter((s) => ['CERTIFIED', 'APPROVED'].includes(s)).length,
    inProgress: stageList.filter((s) => !['CERTIFIED', 'APPROVED', 'DRAFT'].includes(s)).length,
  }), [stageList]);

  // Donut segments from real stage counts, grouped into the friendly tone buckets.
  const donutSegments = useMemo(() => {
    const total = stageList.length || 1;
    const buckets: { key: string; n: number; color: string }[] = [
      { key: 'review', n: stats.docReview, color: DONUT_COLOR.review },
      { key: 'audit', n: stats.audit, color: DONUT_COLOR.audit },
      { key: 'done', n: stats.approved, color: DONUT_COLOR.done },
      { key: 'draft', n: stageList.filter((s) => s === 'DRAFT').length, color: DONUT_COLOR.draft },
    ];
    return buckets.filter((b) => b.n > 0).map((b) => ({ pct: (b.n / total) * 100, color: b.color }));
  }, [stageList, stats]);

  if (loading) return <PageSkeleton type="dashboard" />;

  if (fetchError) {
    return (
      <div className="space-y-6" role="main">
        <Card data-testid="dashboard-fetch-error" className="rounded-[1.375rem] border border-rose-200 bg-rose-50/60 p-12 text-center">
          <AlertCircle className="mx-auto mb-4 h-12 w-12 text-rose-500" aria-hidden="true" focusable="false" />
          <h3 className="text-lg font-bold text-rose-800">{dict.common?.fetchError?.title || 'Unable to load data'}</h3>
          <p className="mt-1 text-sm text-rose-700">{fetchError}</p>
          <Button type="button" variant="outline" className="mt-6 border-rose-300 text-rose-700 hover:bg-rose-100"
            onClick={() => { setLoading(true); setRetryToken((t) => t + 1); }}>
            {dict.common?.fetchError?.retry || 'Try again'}
          </Button>
        </Card>
      </div>
    );
  }

  const firstName = data.user?.firstName || dict.common?.Applicant || 'เกษตรกร';
  const stageLabelOf = (stage: HealthDashboardStage, app: ApplicationRecord) => (
    language === 'en' ? STAGE_LABEL_EN[stage] : stageLabelFor(stage, { isRenewal: app.isRenewal }));
  const dateLocale = language === 'en' ? 'en-US' : 'th-TH';

  const funnel = [
    { label: dict.dashboard?.stats?.total || 'คำขอทั้งหมด', value: stats.total },
    { label: dict.dashboard?.stats?.docReview || 'กำลังตรวจเอกสาร', value: stats.docReview },
    { label: 'ตรวจภาคสนาม', value: stats.audit },
    { label: dict.dashboard?.stats?.certified || 'รับรองแล้ว', value: stats.approved },
  ];

  const recent = data.applications.slice(0, 5);

  // Real next-action items for the right-rail card.
  const ICON_MAP: Record<string, LucideIcon> = { FileEdit, CreditCard, AlertCircle, MapPin, BadgeCheck, XCircle, AlertTriangle, CheckCircle, Clock };
  const actionItems = data.applications
    .filter((app) => app.status && isUserActionRequired(app.status))
    .map((app) => ({ app, info: getStatusInfo(app.status || ''), statusLabel: getStatusLabel(app.status || '') }))
    .slice(0, 2);

  const donutPresent = [
    { n: stats.docReview, dot: 'bg-amber-400', label: 'กำลังตรวจเอกสาร' },
    { n: stats.audit, dot: 'bg-sky-500', label: 'ตรวจภาคสนาม' },
    { n: stats.approved, dot: 'bg-leaf', label: 'รับรองแล้ว' },
    { n: stageList.filter((s) => s === 'DRAFT').length, dot: 'bg-slate-400', label: dict.common?.draft || 'ฉบับร่าง' },
  ].filter((b) => b.n > 0);

  return (
    <div className="grid grid-cols-1 gap-[22px] lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── Main column ── */}
      <div className="flex min-w-0 flex-col gap-[22px]">
        {/* Hero banner */}
        <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-primary to-leaf p-7 text-white sm:p-8">
          <div className="relative z-10 max-w-[460px]">
            <h1 className="text-[22px] font-bold leading-snug">
              {dict.dashboard?.welcome || 'สวัสดี'} {firstName} 🌿
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-white/90">
              {dict.dashboard?.subtitle || 'ติดตามคำขอ จัดการเอกสาร และรับใบรับรองดิจิทัล ครบจบในที่เดียว'}
            </p>
            <div className="my-5 flex gap-6">
              <div>
                <div className="text-[26px] font-bold tabular-nums">{stats.approved}</div>
                <div className="text-xs text-white/85">{dict.dashboard?.stats?.certified || 'ใบรับรองที่ใช้งานได้'}</div>
              </div>
              <div className="w-px bg-white/25" />
              <div>
                <div className="text-[26px] font-bold tabular-nums">{stats.inProgress}</div>
                <div className="text-xs text-white/85">{dict.dashboard?.stats?.inProgress || 'กำลังดำเนินการ'}</div>
              </div>
            </div>
            <Button asChild variant="white" size="sm">
              <Link href="/health/applications/new">
                <FileText className="mr-1.5 h-4 w-4" />
                {dict.dashboard?.actions?.newApplication || 'ยื่นคำขอใหม่'}
              </Link>
            </Button>
          </div>
        </div>

        {/* Funnel KPI card */}
        <Card className="p-[22px_24px]">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="m-0 text-base font-bold text-foreground">{language === 'en' ? 'Application overview' : 'ภาพรวมคำขอรับรอง'}</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {funnel.map((p, i) => (
              <div key={p.label} className={i ? 'px-3 sm:border-l sm:border-mint-bg' : 'px-3'}>
                <div className="text-[12.5px] text-muted-foreground">{p.label}</div>
                <div className="mt-1.5 text-[26px] font-bold tabular-nums text-foreground">{p.value}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Recent applications table */}
        <Card className="p-[22px_24px_12px]">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="m-0 text-base font-bold text-foreground">{dict.dashboard?.sections?.recent || 'คำขอล่าสุด'}</h3>
            <Link href="/health/applications" className="text-[13px] font-bold text-leaf-700 hover:underline">{dict.common?.viewAll || 'ดูทั้งหมด'}</Link>
          </div>
          {recent.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-mint-bg bg-mint-soft py-10 text-center">
              <FileText className="mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">{dict.dashboard?.empty?.title || 'ยังไม่มีคำขอ'}</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {recent.map((app, idx) => {
                const stage = normalizeHealthDashboardStage(app) as HealthDashboardStage;
                const tone = STAGE_TONE[stage] || STAGE_TONE.DRAFT;
                const pct = STAGE_PCT[stage] ?? 0;
                const appId = app.id || '';
                return (
                  <Link
                    key={appId || idx}
                    href={`/health/applications/${appId}`}
                    className={`flex items-center gap-3 py-3 transition-colors hover:bg-mint-soft ${idx ? 'border-t border-mint-bg' : ''}`}
                  >
                    <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                      <Leaf className="h-[19px] w-[19px]" />
                    </span>
                    <div className="min-w-0 flex-[2]">
                      <div className="truncate text-[13.5px] font-bold text-foreground">{app.farmName || app.plantName || (app.applicationNumber || `APP-${appId.slice(-6).toUpperCase()}`)}</div>
                      <div className="truncate text-[11px] tabular-nums text-muted-foreground">{app.applicationNumber || appId.slice(-12) || '—'} · {new Date(app.submittedAt || app.createdAt || Date.now()).toLocaleDateString(dateLocale)}</div>
                    </div>
                    <div className="hidden flex-1 items-center gap-2 sm:flex">
                      <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-mint-bg">
                        <div className={`h-full rounded-full transition-all duration-700 ${tone.bar}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-8 shrink-0 text-right text-[11px] font-bold tabular-nums text-muted-foreground">{pct}%</span>
                    </div>
                    <span className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold ${tone.chip}`}>
                      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${tone.dot}`} />
                      {stageLabelOf(stage, app) || stage}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Right rail ── */}
      <div className="flex flex-col gap-[22px]">
        <Card className="p-[22px_24px]">
          <h3 className="m-0 mb-[18px] text-base font-bold text-foreground">{dict.dashboard?.sections?.status || 'สถานะคำขอ'}</h3>
          <StatusDonut segments={donutSegments} total={stats.total} label={dict.dashboard?.stats?.total || 'คำขอทั้งหมด'} />
          <div className="mt-[18px] flex flex-col gap-[9px]">
            {donutPresent.length === 0 ? (
              <p className="text-center text-[13px] text-muted-foreground">{dict.dashboard?.empty?.title || 'ยังไม่มีคำขอ'}</p>
            ) : donutPresent.map((b) => (
              <div key={b.label} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <span className={`h-[9px] w-[9px] rounded-[3px] ${b.dot}`} />{b.label}
                </span>
                <span className="text-[13px] font-bold text-foreground">{b.n}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-[22px_24px]">
          <div className="mb-3.5 flex items-center justify-between">
            <h3 className="m-0 text-base font-bold text-foreground">{dict.dashboard?.sections?.todo || 'สิ่งที่ต้องทำ'}</h3>
            <CalendarDays className="h-[18px] w-[18px] text-muted-foreground" />
          </div>
          {actionItems.length === 0 ? (
            <div className="rounded-2xl bg-mint-soft p-4 text-center">
              <CheckCircle className="mx-auto mb-1.5 h-7 w-7 text-leaf" />
              <p className="text-[13px] font-medium text-muted-foreground">{language === 'en' ? 'Nothing to action right now' : 'ไม่มีรายการที่ต้องดำเนินการ'}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {actionItems.map(({ app, info, statusLabel }) => {
                const IconComp = ICON_MAP[info.icon] || AlertCircle;
                const appId = app.id || '';
                const high = info.urgency === 'high';
                return (
                  <Link key={appId} href={`/health/applications/${appId}`}
                    className={`flex items-start gap-3 rounded-2xl p-3.5 transition-colors ${high ? 'bg-red-50/70 hover:bg-red-50' : 'bg-mint-soft hover:bg-leaf-soft'}`}>
                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${high ? 'bg-red-100 text-red-600' : 'bg-leaf text-white'}`}>
                      <IconComp className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold text-foreground">{app.applicationNumber || `APP-${appId.slice(-6).toUpperCase()}`}</div>
                      <div className="text-[12px] leading-snug text-muted-foreground">{info.nextAction || statusLabel}</div>
                      {info.actionLabel && (
                        <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-bold text-leaf-700">{info.actionLabel}<ArrowRight className="h-3 w-3" /></span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
