'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Icons } from '@/components/ui/icons';
import { AutoSaveIndicator } from '@/components/application-flow/auto-save-indicator';
import { Badge } from '@/components/ui/primitives/badge';
import { ConfirmDialog } from '@/components/feature/confirm-dialog';
import { useLanguage } from '@/lib/i18n/language-context';
import { cn } from '@/lib/utils';
import { useApplicationFlowStore } from './hooks/use-application-flow-store';
import { useAutoSave } from './hooks/use-auto-save';
import { FLOW_STEPS, PAYMENT_STEPS, resolveStepLabel } from './application-flow-config';

interface EditModeInfo {
  isEditMode: boolean;
  applicationId: string;
  revisionComment: string;
  applicationNumber: string;
}



export default function ApplicationFlowLayout({ children }: { children: React.ReactNode }) {
  const { state } = useApplicationFlowStore();
  const autoSave = useAutoSave();
  const router = useRouter();
  const pathname = usePathname();
  const { t, language, dict } = useLanguage();

  // Y1-FIX-A — wizard chrome copy (close button aria, header titles,
  // payment label, edit banner). Previously these were hardcoded Thai
  // literals which left EN-locale users staring at Thai chrome around
  // their (otherwise-translated) form fields.
  const chrome = dict.wizard.chrome;

  const [editModeInfo, setEditModeInfo] = useState<EditModeInfo | null>(null);
  // Wave E.3-C: replaced native window.confirm() with ConfirmDialog.
  // The "X" button used to call window.confirm (browser-locale-locked,
  // unstyled, blocks the JS event loop). Now we open a state-driven
  // dialog that respects the app's current language and design tokens.
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('gacp_edit_mode');
      if (!stored) return;
      const parsed = JSON.parse(stored) as EditModeInfo;
      if (parsed?.isEditMode) {
        setEditModeInfo(parsed);
      }
    } catch (error: unknown) {
      console.error('[application-flow-layout] failed to read edit mode info', error);
    }
  }, []);

  const isEditMode = Boolean(editModeInfo?.isEditMode);

  const activeStep = useMemo(() => {
    const matched = pathname?.match(/\/step\/(\d+)/);
    return matched ? Number(matched[1]) : state.currentStep + 1;
  }, [pathname, state.currentStep]);

  // Payment phase ≡ the user is on a slot owned by PAYMENT_STEPS. After
  // the 2026-05-16 quote/invoice merge that's slots [10, 12] (slot 11
  // redirects to 10). Deriving from PAYMENT_STEPS directly rather than
  // hard-coding a numeric range avoids the off-by-one trap that bit the
  // previous `activeStep >= 8 && activeStep <= 10` heuristic (which both
  // missed slot 11/12 and false-positived the documents/review steps).
  const isPaymentPhase = PAYMENT_STEPS.some((step) => step.stepNumber === activeStep);
  const currentPaymentStep = isPaymentPhase
    ? PAYMENT_STEPS.find((step) => step.stepNumber === activeStep)
    : null;
  const currentPaymentLabel = currentPaymentStep
    ? resolveStepLabel(currentPaymentStep, language)
    : null;

  const target = isEditMode
    ? `/health/applications/${editModeInfo?.applicationId}`
    : '/health/dashboard';

  const performNavigateAway = () => {
    if (isEditMode) {
      sessionStorage.removeItem('gacp_edit_mode');
    }
    router.push(target);
  };

  const cancelApplication = () => {
    if (autoSave.isDirty) {
      setLeaveDialogOpen(true);
      return;
    }
    performNavigateAway();
  };

  // The pill rail shows the form steps; the payment phase shows its own two. This
  // used to read `Math.min(totalSteps, FLOW_STEPS.length)` where totalSteps came from
  // GET /api/applications/config — an endpoint that has never returned a `totalSteps`
  // key. Verified against the running server: the response is
  // {"success":true,"data":{"steps":[1..12],"plantId":"cannabis"}}. So the request
  // fired on every wizard load, the value never changed from its initial 9, and
  // Math.min(9, FLOW_STEPS.length) was FLOW_STEPS.length in every case. A network
  // round trip that could only ever return the constant it started with
  // (evidence/apple-qa-audit-2026-09-07: six config requests on one page load).
  const stepsToShow = isPaymentPhase ? PAYMENT_STEPS.length : FLOW_STEPS.length;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* ── Minimal Application Header ── */}
      <header className="sticky top-0 z-30 border-b border-border bg-card">
        <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={cancelApplication}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-100 bg-card text-zinc-400 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900 active:scale-95"
              aria-label={chrome.closeAria}
            >
              <Icons.X size={20} />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black tracking-tight text-zinc-900">
                  {isEditMode ? chrome.headerTitleEdit : isPaymentPhase ? chrome.headerTitlePayment : chrome.headerTitleNew}
                </h1>
                {isEditMode && (
                  <Badge variant="secondary" className="border-none bg-amber-100 text-[10px] font-bold text-amber-700">
                    {chrome.editBannerBadge}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] font-medium text-zinc-400">
                {currentPaymentLabel ? chrome.headerSubtitleStatus.replace('{label}', currentPaymentLabel) : chrome.headerSubtitleForm}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <AutoSaveIndicator
                isDirty={autoSave.isDirty}
                isSaving={autoSave.isSaving}
                lastSavedAt={autoSave.lastSavedAt}
                error={autoSave.error}
                errorKind={autoSave.errorKind}
                syncState={autoSave.syncState}
                syncStatus={state.syncStatus}
                retryPhase={autoSave.retryPhase}
                onRetry={autoSave.retryNow}
              />
            </div>
          </div>

          {/* Pill stepper (Application Style) — the wizard's single
              step-progress indicator (design-cleanup 2026-08-21, W2-A).
              Rendered in edit mode too: it derives purely from the URL's
              activeStep, so it stays accurate there, and application-step-page.tsx
              no longer renders any indicator of its own — without this,
              edit mode would show zero step-progress affordances. */}
          {!isPaymentPhase && (
            <div className="no-scrollbar mt-4 flex items-center gap-1.5 overflow-x-auto pb-1">
              {FLOW_STEPS.slice(0, stepsToShow).map((step, i) => {
                // Compare against the canonical step.stepNumber (URL-stable) so
                // that vacant slots in FLOW_STEPS — e.g. step 3 was merged into
                // step 2 — don't desync the pill from the active route.
                const done = step.stepNumber < activeStep;
                const active = step.stepNumber === activeStep;
                const StepIcon = step.icon;

                return (
                  <div key={step.key} className="flex items-center gap-1.5">
                    <div
                      className={cn(
                        'flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-[11px] font-semibold transition-all duration-300',
                        done
                          ? 'bg-primary/10 text-primary'
                          : active
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {done ? (
                        <Icons.Check className="h-3 w-3" />
                      ) : (
                        <StepIcon className="h-3 w-3" />
                      )}
                      <span>{resolveStepLabel(step, language)}</span>
                    </div>
                    {i < stepsToShow - 1 && (
                      <div className={`h-px w-3 rounded-full ${done ? 'bg-primary/40' : 'bg-border'}`} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Payment progress — derived from PAYMENT_STEPS position so
              the bar stays accurate after the quote/invoice merge (and
              future payment-step changes). Previously hard-coded as
              `(activeStep - 7) / 3` which assumed three contiguous slots
              starting at 10. */}
          {isPaymentPhase && (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <motion.div
                initial={{ width: 0 }}
                animate={{
                  width: `${(((PAYMENT_STEPS.findIndex((s) => s.stepNumber === activeStep) + 1) / PAYMENT_STEPS.length) * 100)}%`,
                }}
                className="h-full rounded-full bg-primary"
              />
            </div>
          )}
        </div>
      </header>

      {/* Edit mode banner */}
      {isEditMode && editModeInfo?.revisionComment ? (
        <section className="mx-auto mt-6 w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-amber-100 bg-amber-50/50 p-6 text-amber-900"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-200 text-amber-800 shadow-sm">
                <Icons.AlertTriangle size={18} />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-tight">{chrome.editBannerTitle}</p>
                <p className="text-xs font-bold opacity-60">{editModeInfo.applicationNumber}</p>
              </div>
            </div>
            <p className="mt-4 rounded-2xl bg-white/80 p-4 text-sm leading-relaxed shadow-inner">
              {editModeInfo.revisionComment}
            </p>
          </motion.div>
        </section>
      ) : null}

      {/* Main content */}
      {/* Single width standard (2026-06-11): the wizard runs its own layout (not
          DashboardLayout), so it needs the same mx-auto max-w-7xl cap explicitly —
          found full-bleed (2496px vs 1280 everywhere else) in live staging verify. */}
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* F-APPV2-02 — the server did not grant the ประเภทคำขอ that was chosen.
            NOT an error: the draft saved. But `requestType` is server-owned (RENEWAL and
            REPLACEMENT are judged by two rows instead of the whole ส่วนที่ ๓ set), so the
            server records NEW until a live certificate the applicant owns is named — and
            the applicant has to be told that, or their document list simply gets longer
            for no reason they can see. Amber, not red: nothing was lost. */}
        {autoSave.lawNotice ? (
          <div
            role="status"
            className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <p className="mb-1 font-semibold">ระบบบันทึกคำขอนี้เป็น &ldquo;ขอใหม่&rdquo; ไว้ก่อน</p>
            <p>{autoSave.lawNotice.messageTh}</p>
          </div>
        ) : null}
        {/* Round 5 (b): the server refused the application id the wizard was saving under
            (already filed, or not found for this account). The answers were kept and go
            into an id-less save (the server's latest open DRAFT, or a new one). Amber, not red:
            nothing the applicant typed was lost. */}
        {autoSave.detachNotice ? (
          <div
            role="status"
            className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <p>{autoSave.detachNotice}</p>
          </div>
        ) : null}
        {children}
      </main>

      {/* Wave E.3-C: replacement for the previous window.confirm() call
          on the "X" button. Confirm flow is now state-driven, i18n-aware,
          and styled to match the rest of the app. */}
      <ConfirmDialog
        open={leaveDialogOpen}
        onOpenChange={setLeaveDialogOpen}
        onConfirm={() => {
          setLeaveDialogOpen(false);
          performNavigateAway();
        }}
        title={t('common.unsavedChanges.title')}
        description={t('common.unsavedChanges.description')}
        confirmLabel={t('common.leave')}
        variant="destructive"
      />
    </div>
  );
}
