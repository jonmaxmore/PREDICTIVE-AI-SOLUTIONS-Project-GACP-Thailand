'use client';

/**
 * /health/status — single-page ตรวจสอบสถานะ (N8, tile-home-redesign task 6).
 *
 * One card per application: number + plant name + a status sentence naming
 * the actor and what's awaited (stage-map.ts's `actorTH`) + an inline 5-step
 * progress bar + — when the applicant must act — a prominent action button.
 * Cards needing action get a warning border and float to the top.
 *
 * Data source: `/applications/my`, the SAME endpoint + apiClient shape
 * already used by app/health/applications/client-view.tsx (the applications
 * list page) and lib/navigation/use-nav-chips.ts — no new backend endpoint.
 *
 * BackHomeCrumb: this page used to render it directly, but the redesign
 * shipped with exactly this ONE production caller — every other inner page
 * had no back-home affordance at all. Task 1 (D1/D2, W10) moved it to the
 * SHELL level (DashboardLayout, wrapping every /health/* route via
 * app/health/layout.tsx) so every inner page gets it by default; this page
 * no longer renders its own, or it would double up with the shell's copy.
 * See components/layout/__tests__/dashboard-layout-back-home-crumb.test.tsx
 * for the coverage that moved with it.
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Leaf } from 'lucide-react';

import { apiClient as api } from '@/lib/api/api-client';
import { EmptyState } from '@/components/feature/empty-state';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { mapStatusToDisplay, STEP_LABEL_TH, type StatusDisplay } from '@/lib/status-display/stage-map';
import type { WorkflowState } from '@/lib/constants/workflow-states';

interface ApplicationRecord {
  id: string;
  applicationNumber?: string;
  plantName?: string;
  status?: string;
}

const STEP_ORDER: StatusDisplay['step'][] = [1, 2, 3, 4, 5];

// Fix round 1 (coordinator ruling) — an uninterpretable status must still
// give the farmer a path forward: point at the card's own detail-page link
// explicitly rather than a vague "unknown" message. needsUserAction stays
// false (unchanged) — this is not a state we know requires the applicant to
// do anything, just one this page can't describe precisely.
const UNKNOWN_STATUS_DISPLAY: StatusDisplay = {
  step: 1,
  stepLabelTH: STEP_LABEL_TH[1],
  actorTH: 'ไม่สามารถระบุสถานะปัจจุบันได้ กรุณาดูรายละเอียดคำขอ',
  needsUserAction: false,
};

/** A bad/unrecognized status must not crash the whole list. */
function safeMapStatus(rawStatus: string | undefined): StatusDisplay {
  const status = String(rawStatus || '').trim().toUpperCase();
  try {
    return mapStatusToDisplay(status as WorkflowState);
  } catch {
    return UNKNOWN_STATUS_DISPLAY;
  }
}

/**
 * Short "ended" badge for terminal cards (REJECTED / EXPIRED /
 * CANCEL_EXPIRED — see `StatusDisplay.terminal`). Separate from
 * `actorTH` (the full sentence + next action) — this is the at-a-glance
 * label the coordinator ruling asked for, next to the code/plant name.
 */
function terminalBadgeTH(rawStatus: string | undefined): string {
  const status = String(rawStatus || '').trim().toUpperCase();
  return status === 'REJECTED' ? 'คำขอไม่ผ่านการพิจารณา' : 'คำขอหมดอายุ';
}

/**
 * Where the action button sends the applicant. Reuses existing routes —
 * mirrors applications/client-view.tsx's PENDING_*_FEE -> /health/payments
 * split, plus the detail page's own edit/car sub-routes for the other
 * action-required statuses. No new route is introduced.
 */
function actionHref(id: string, rawStatus: string | undefined): string {
  const status = String(rawStatus || '').trim().toUpperCase();
  switch (status) {
    case 'DRAFT':
    case 'REVISION_REQUESTED':
      return `/health/applications/${id}/edit`;
    case 'PENDING_DOC_FEE':
    case 'PENDING_AUDIT_FEE':
      return `/health/payments?app=${id}`;
    case 'CAR_PENDING':
      return `/health/applications/${id}/car`;
    case 'REJECTED':
    case 'EXPIRED':
    case 'CANCEL_EXPIRED':
      return '/health/applications/new';
    default:
      return `/health/applications/${id}`;
  }
}

export default function StatusClientView() {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await api.get<ApplicationRecord[]>('/applications/my');
        if (cancelled) return;
        if (!result.success || !result.data) {
          setLoadError(result.error || 'ไม่สามารถโหลดรายการคำขอได้ในขณะนี้');
          setApplications([]);
        } else {
          setApplications(Array.isArray(result.data) ? result.data : []);
        }
      } catch {
        if (!cancelled) {
          setLoadError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
          setApplications([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // needsUserAction cards float to the top; Array#sort is stable, so the
  // relative order within each group (server's own order — newest first)
  // is preserved.
  const rows = useMemo(() => {
    return applications
      .map((app) => ({ app, display: safeMapStatus(app.status) }))
      .sort((a, b) => Number(b.display.needsUserAction) - Number(a.display.needsUserAction));
  }, [applications]);

  return (
    <div className="flow-stack-lg animate-fade-in-up" role="main">
      <div>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">ตรวจสอบสถานะ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          สถานะคำขอรับรอง GACP ของคุณ พร้อมสิ่งที่ต้องดำเนินการ
        </p>
      </div>

      {loadError ? (
        <Card
          data-testid="status-list-error"
          role="alert"
          className="border-2 border-rose-200 bg-rose-50/60 p-6 text-center"
        >
          <p className="text-sm text-rose-700">{loadError}</p>
        </Card>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-32 rounded-[1.375rem]" />
          ))}
        </div>
      ) : loadError ? null : rows.length === 0 ? (
        <EmptyState
          title="คุณยังไม่มีคำขอ"
          hint="เริ่มต้นสมัครขอใบรับรอง GACP แรกของคุณได้ทันที"
          action={
            <Button asChild variant="filled">
              <Link href="/health/applications/new" className="no-underline">
                สมัครขอใบรับรอง
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map(({ app, display }) => {
            const id = app.id;
            const code = app.applicationNumber || `APP-${id.slice(-6).toUpperCase()}`;
            const plantName = app.plantName || 'พืชที่ยื่นขอ';
            const isTerminal = display.terminal === true;

            return (
              <Card
                key={id}
                data-testid="status-app-card"
                data-needs-action={display.needsUserAction ? 'true' : 'false'}
                className={
                  display.needsUserAction
                    ? 'relative overflow-hidden border-2 border-amber-300'
                    : 'relative overflow-hidden border border-mint-bg'
                }
              >
                <Link
                  href={`/health/applications/${id}`}
                  aria-label={`${code} สถานะ ${display.stepLabelTH}`}
                  className="absolute inset-0 z-0 no-underline"
                />
                <CardContent className="relative z-10 p-5 pt-5 sm:p-6 sm:pt-6">
                  <div className="pointer-events-none flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        className={
                          display.needsUserAction
                            ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700'
                            : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft'
                        }
                      >
                        {display.needsUserAction ? (
                          <AlertTriangle className="h-[18px] w-[18px]" aria-hidden="true" focusable="false" />
                        ) : (
                          <Leaf className="h-[18px] w-[18px]" aria-hidden="true" focusable="false" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-foreground">{code}</span>
                          <span className="text-xs text-muted-foreground">{plantName}</span>
                          {isTerminal ? (
                            <Badge
                              data-testid="status-terminal-badge"
                              tone={app.status?.toUpperCase() === 'REJECTED' ? 'danger' : 'neutral'}
                            >
                              {terminalBadgeTH(app.status)}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-foreground">{display.actorTH}</p>
                      </div>
                    </div>

                    {display.needsUserAction ? (
                      <div className="pointer-events-auto relative z-10 w-full shrink-0 sm:w-auto">
                        <Button asChild variant="filled" size="sm" className="w-full sm:w-auto">
                          <Link href={actionHref(id, app.status)} data-testid="status-action-btn" className="no-underline">
                            {display.actionTH ?? 'ดำเนินการต่อ'}
                          </Link>
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {/* Inline 5-step progress bar. Terminal cards (REJECTED /
                      EXPIRED / CANCEL_EXPIRED — see StatusDisplay.terminal)
                      render every dot muted with NO current-step marker:
                      `display.step` on a terminal status is a sort-key /
                      minimum-known-progress floor, not a claim about where
                      the application currently sits (coordinator ruling,
                      fix round 1 — see stage-map.ts module doc). */}
                  <div className="pointer-events-none mt-4">
                    <div className="flex items-center">
                      {STEP_ORDER.map((step, idx) => {
                        const isComplete = !isTerminal && step < display.step;
                        const isCurrent = !isTerminal && step === display.step;
                        return (
                          <div key={step} className="flex flex-1 items-center last:flex-none">
                            <span
                              data-testid="status-step-dot"
                              data-current={isCurrent ? 'true' : 'false'}
                              title={STEP_LABEL_TH[step]}
                              className={
                                isComplete || isCurrent
                                  ? isCurrent
                                    ? 'h-2.5 w-2.5 shrink-0 rounded-full bg-leaf ring-2 ring-leaf/30'
                                    : 'h-2 w-2 shrink-0 rounded-full bg-leaf'
                                  : 'h-2 w-2 shrink-0 rounded-full bg-muted'
                              }
                            />
                            {idx < STEP_ORDER.length - 1 && (
                              <div className={isComplete ? 'h-0.5 flex-1 bg-leaf/50' : 'h-0.5 flex-1 bg-muted'} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {isTerminal ? (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">คำขอนี้สิ้นสุดกระบวนการแล้ว</p>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        ขั้นที่ {display.step} จาก 5: {display.stepLabelTH}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
