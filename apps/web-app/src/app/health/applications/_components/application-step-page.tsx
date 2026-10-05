'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { notFound, useParams, useRouter } from 'next/navigation';
import { ApplicationNavigation } from '@/components/application-flow/application-navigation';
import { wizardNavFor } from '../new/_steps/wizard-navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/primitives/button';
import { api } from '@/lib/api/api-client';
import { useLanguage } from '@/lib/i18n/language-context';

import { useApplicationFlowStore } from '../hooks/use-application-flow-store';
import { useWizardPersistSettled } from '../new/_steps/hooks/use-application-flow-store';
import type { WizardState } from '../new/_steps/hooks/use-application-flow-store';
import {
  bounceNoticeCopy,
  bounceTarget,
  evaluateStepAccess,
  recordBounce,
  takeBounce,
  type BounceNotice,
} from '../new/_steps/hooks/wizard-step-access';
import { classifyDraftResponse, resolveActiveSteps } from '../new/_steps/hooks/wizard-load-outcome';
import { HASH_EXEMPT_KEYS } from '../new/_steps/hooks/use-auto-save';
import {
  ALL_STEPS,
  getStepDescriptions,
  resolveStepTitle,
  type FlowStep,
  type PaymentStep,
} from '../new/_steps/application-flow-config';
import Step1RequestType from '../new/_steps/steps/step1-request-type';
import { Step2IdentityStep } from '../new/_steps/steps/step2-identity';
import { Step3SiteLandStep } from '../new/_steps/steps/step3-site-land';
import { splitStoredPurposes } from '@/lib/certification-purposes';
import { recordStalePurposes } from '../new/_steps/steps/step4-variety-purpose-config';
import { Step4VarietyPurposeStep } from '../new/_steps/steps/step4-variety-purpose';
import { Step5PlansDocsStep } from '../new/_steps/steps/step5-plans-docs';
// Task 11 — step 6 reads the SERVER. The browser-truth review page it replaces is
// retired in the same batch; see step6-review.tsx for why the two could disagree.
import { Step6ReviewStep } from '../new/_steps/steps/step6-review';
import { StepInvoice } from '../new/_steps/steps/invoice-step';
import { StepSuccess } from '../new/_steps/steps/success-step';

// Wizard step component map. Note `quote` no longer appears: the
// quote-step (formerly slot 10) and the invoice-step (formerly slot 11)
// were merged into a single payment screen rendered by StepInvoice at
// slot 10. The deprecated quote-step component still exists on disk
// (see quote-step.tsx header) for partial-draft migration but is no
// longer routable. Slot 11 redirects to slot 10 — see /step/11/page.tsx.
// Wizard v2 (2026-09-05) — six steps, keyed by meaning rather than by number.
// Steps 2..5 land in T6-T11; until each does, its key is deliberately ABSENT here
// and the render guard below shows the "being rebuilt" card. Pointing an unbuilt key
// at a v1 component would be worse than a gap: the old screen writes the old shape,
// and the applicant would fill in fields the new engine never reads.
/**
 * The v1 `serviceType` read as a v2 request type.
 *
 * v1 offered a fourth option, MODIFY ("แก้ไขรายละเอียดใบรับรอง — แก้ไขข้อมูลในใบรับรองเดิม
 * โดยไม่เริ่มคำขอใหม่ทั้งหมด"), which 04ffa095 removed: it is the verbatim negation of the
 * คำรับรอง ส่วนที่ ๔ (๓) the same applicant signs three steps later, and it mapped to no
 * requestType the engine knows.
 *
 * A draft that still carries it resolves to NULL, not to NEW. Guessing NEW would decide
 * on the applicant's behalf what kind of request they are making, and the request type
 * picks which papers the law demands of them. Null means step 1 asks again.
 */
function legacyRequestType(serviceType: WizardState['serviceType'] | undefined): WizardState['requestType'] {
  if (serviceType === 'NEW' || serviceType === 'RENEWAL' || serviceType === 'REPLACEMENT') {
    return serviceType;
  }
  // Absent on the oldest drafts (the field predates them) — those were all new filings.
  return serviceType == null ? 'NEW' : null;
}

/** Shown for a v2 step whose screen has not been built yet (T6-T11). */
function StepBeingRebuilt() {
  return (
    <div className="rounded-[1.375rem] border border-amber-200 bg-amber-50 px-6 py-16 text-center" role="status">
      <p className="text-sm text-amber-800">
        ขั้นตอนนี้กำลังปรับปรุงให้ตรงกับแบบฟอร์ม กทล.1 ฉบับใหม่ กรุณากลับมาอีกครั้ง
      </p>
    </div>
  );
}

const COMPONENT_MAP: Record<string, ComponentType> = {
  'request-type': Step1RequestType,
  identity: Step2IdentityStep,
  'site-land': Step3SiteLandStep,
  'variety-purpose': Step4VarietyPurposeStep,
  'plans-docs': Step5PlansDocsStep,
  review: Step6ReviewStep,
  invoice: StepInvoice,
  success: StepSuccess,
};

interface DraftFormData {
  plantId?: WizardState['plantId'];
  // v2 step 1. A draft written before v2 carries none of these; see the mapping
  // at the hydrator below, which derives them from the v1 keys rather than
  // dropping the applicant back to step 1 on every resume.
  requestType?: WizardState['requestType'];
  certScope?: WizardState['certScope'];
  applicantType?: WizardState['applicantType'];
  previousCertificateNumber?: WizardState['previousCertificateNumber'];
  // v2 step 4 — declared 2026-09-06 when the store stopped hiding them behind a cast.
  varieties?: WizardState['varieties'];
  varietiesNote?: WizardState['varietiesNote'];
  processing?: WizardState['processing'];
  serviceType?: WizardState['serviceType'];
  certificationPurposes?: WizardState['certificationPurposes'];
  consentedPDPA?: WizardState['consentedPDPA'];
  acknowledgedStandards?: WizardState['acknowledgedStandards'];
  siteTypes?: WizardState['siteTypes'];
  licensePdfUrl?: WizardState['licensePdfUrl'];
  cultivationMethods?: WizardState['cultivationMethods'];
  applicantData?: WizardState['applicantData'];
  farmData?: WizardState['farmData'];
  plots?: WizardState['plots'];
  lots?: WizardState['lots'];
  documents?: WizardState['documents'];
  productionData?: WizardState['productionData'];
  harvestData?: WizardState['harvestData'];
  // The rest of the round trip. Each of these is sent by the autosave and persisted by
  // POST /draft, so the draft genuinely carries them — this type simply did not say so,
  // and the hydrator below could not read what the type denied existed. Declaring them
  // against WizardState rather than restating their shapes is deliberate: the draft is a
  // snapshot of the store, so a field that changes shape in the store changes here too,
  // and the two can never describe the same data differently.
  serviceTypes?: WizardState['serviceTypes'];
  siteData?: WizardState['siteData'];
  securityData?: WizardState['securityData'];
  youtubeUrl?: WizardState['youtubeUrl'];
  locationType?: WizardState['locationType'];
  generalInfo?: WizardState['generalInfo'];
  cultivationDetails?: WizardState['cultivationDetails'];
  stepDocuments?: WizardState['stepDocuments'];
  plantTracking?: WizardState['plantTracking'];
  qrCount?: WizardState['qrCount'];
  estimatedQRCost?: WizardState['estimatedQRCost'];
}

interface DraftResponse {
  draftId?: string;
  id: string;
  formData?: DraftFormData;
  status?: string;
}

/**
 * A draft being corrected after a reviewer's comment. Every step was satisfied
 * in an earlier session, so the applicant may jump straight to the one that was
 * flagged. Same sessionStorage key the edit banner in _steps/layout.tsx reads.
 */
function readEditMode(): boolean {
  try {
    const stored = typeof window !== 'undefined' ? window.sessionStorage.getItem('gacp_edit_mode') : null;
    if (!stored) return false;
    const parsed = JSON.parse(stored) as { isEditMode?: boolean };
    return Boolean(parsed?.isEditMode);
  } catch {
    // Unavailable or malformed sessionStorage falls through to strict gating —
    // a safer default than letting a typo skip the wizard.
    return false;
  }
}

/**
 * Round 3 — which resume fetch currently owns the autosave hold. Module-level because a
 * step page unmounts and a NEW instance starts its own fetch: a late answer from the old
 * instance's fetch must neither load its draft over the new one nor touch the new hold.
 * Every fetch takes the next number; an answer whose number is not the latest is ignored.
 */
let latestResumeAttempt = 0;

/**
 * The answers that changed between two snapshots of the wizard (bookkeeping keys excluded,
 * the same list the autosave's change check ignores). Values are compared by reference:
 * the store replaces a value it changes and keeps the ones it does not.
 */
function answersChangedSince(before: WizardState, now: WizardState): Partial<WizardState> {
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(now) as Array<keyof WizardState>) {
    if (HASH_EXEMPT_KEYS.includes(key as string) || key === 'currentStep') continue;
    if (now[key] !== before[key]) changed[key as string] = now[key];
  }
  return changed as Partial<WizardState>;
}

export default function ApplicationStepPage() {
  const params = useParams();
  const router = useRouter();
  const { state, setCurrentStep, hydrateDraft, setResumePending } = useApplicationFlowStore();
  const { language, dict } = useLanguage();
  const [stepConfig, setStepConfig] = useState<(FlowStep | PaymentStep) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // W1-WIZARD — "backend unreachable" is a separate axis from `error`
  // (step-not-found): it renders the amber retry state instead of the
  // terminal rose card, and `retryNonce` re-fires both gating fetches
  // (config + draft) when the farmer taps retry.
  const [unavailable, setUnavailable] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  // Y1-FIX-A — dict-driven chrome copy. The wizard chrome surfaces
  // (loading/error states) used to be hardcoded Thai literals; they
  // now flow through wizard.chrome.* and respect the user's chosen
  // language. Language-aware step descriptions come from
  // `getStepDescriptions(language)`.
  const chrome = dict.wizard.chrome;
  const stepDescriptions = getStepDescriptions(language);

  const idStr = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const stepNumber = Number.parseInt(idStr || '0', 10);

  // F-G4-11 — the URL-skip guard.
  //
  // What it replaced, and why: the old guard read `hydrationAttempted.current`,
  // a ref the resume-draft effect below only ever set on the branch where the
  // local store was EMPTY. Anyone past step 2 had a populated store, so that
  // branch returned early, the ref stayed false, and the guard switched itself
  // off for the rest of the session. Typing /step/9 with nothing filled showed
  // the review screen. It also let the step render first and teleported the
  // farmer afterwards, with nothing said.
  //
  // The decision now lives in wizard-step-access.ts and is taken during render,
  // so a step whose prerequisites are unmet never reaches the DOM, and the
  // reason travels with the bounce.
  const persistSettled = useWizardPersistSettled();
  const [draftSettled, setDraftSettled] = useState(false);
  // null = not read yet. Judging before it is read would gate an edit-mode
  // applicant by rules that do not apply to them.
  const [editMode, setEditMode] = useState<boolean | null>(null);
  const [bounce, setBounce] = useState<BounceNotice | null>(null);

  useEffect(() => { setEditMode(readEditMode()); }, []);

  const access = evaluateStepAccess({
    stepNumber,
    state,
    isEditMode: editMode === true,
    ready: editMode !== null && persistSettled && draftSettled && !loading,
  });
  const blockedRequestedStep = access.kind === 'blocked' ? access.requestedStep : null;
  const blockedAllowedStep = access.kind === 'blocked' ? access.allowedStep : null;

  // Declared BEFORE the bounce effect on purpose: on the step that was refused
  // this must find nothing, so that the notice is picked up on the step the
  // farmer is sent to, not on the one they were sent away from.
  useEffect(() => {
    if (!Number.isFinite(stepNumber)) return;
    const notice = takeBounce(stepNumber);
    if (notice) setBounce(notice);
  }, [stepNumber]);

  useEffect(() => {
    if (blockedRequestedStep === null || blockedAllowedStep === null) return;
    recordBounce({ requestedStep: blockedRequestedStep, allowedStep: blockedAllowedStep });
    router.replace(bounceTarget(blockedAllowedStep));
  }, [blockedRequestedStep, blockedAllowedStep, router]);

  // Resume-draft hydration: when the wizard mounts with an empty local
  // Zustand store (e.g. user clicked "ดำเนินการต่อ" on the application
  // detail page from a different browser, or after clearing IndexedDB),
  // pull the most recent server-side draft and rehydrate. Without this
  // the user lands on a blank step 1 even though the backend has their
  // draft saved. Issue 2/3 in the applicant feedback batch.
  //
  // F-G4-11 — waits for `persistSettled` first. An empty store is only
  // evidence of "no local draft" once IndexedDB has answered; asking the
  // server before then races the rehydrate, and the guard above would judge
  // a farmer's resume against a store that had simply not loaded yet.
  const hydrationAttempted = useRef(false);
  // I-1 (fix round 1): the latest state, readable from the fetch's callback. Step 1 is on
  // screen while GET /applications/draft is in flight; an answer given in that window must
  // not be overwritten by the draft nor counted as "loaded".
  const latestStateRef = useRef(state);
  latestStateRef.current = state;
  // Round 3: the attempt whose hold THIS page raised and has not lowered yet (null = none).
  const heldByAttemptRef = useRef<number | null>(null);
  const setResumePendingRef = useRef(setResumePending);
  setResumePendingRef.current = setResumePending;
  // Round 3: leaving the page ends its hold. A hold left up by a 503 (or by a fetch that
  // never answered) used to outlive the page and silently drop every later save, so an
  // edit made after the applicant came back by another route was filed stale. Unmount
  // only — the fetch effect below re-runs on dependency changes and must not cancel itself.
  useEffect(() => () => {
    const attempt = heldByAttemptRef.current;
    if (attempt !== null && attempt === latestResumeAttempt) {
      latestResumeAttempt += 1; // the answer to that fetch is now stale
      heldByAttemptRef.current = null;
      // Round 4 I-2: the cancelled fetch must be re-askable. StrictMode (dev) runs this
      // cleanup right after mount and then mounts again with the SAME refs; with the flag
      // still true no new fetch started, the first answer was ignored as stale, and the
      // spinner never ended.
      hydrationAttempted.current = false;
      setResumePendingRef.current(false);
    }
  }, []);
  useEffect(() => {
    // `retryNonce` re-fires this effect after the farmer taps retry on the
    // unavailable state (the retry handler resets `hydrationAttempted`).
    void retryNonce;
    if (hydrationAttempted.current) return;
    if (!persistSettled) return;
    hydrationAttempted.current = true;
    if (state.plantId) {
      // Local store already populated — nothing to fetch, and the guard may
      // proceed. The old code returned here WITHOUT marking hydration done,
      // which is the hole this whole change closes.
      // Round 3: and nothing is being resumed, so no hold may stand — one left up by an
      // earlier page's unanswered fetch would drop every save from here on.
      if (latestStateRef.current.resumePending) setResumePending(false);
      setDraftSettled(true);
      return;
    }
    const stateAtFetch = { ...latestStateRef.current };
    // Round 2: hold the autosave until this fetch has answered. Lowered by the load
    // itself (hydrateDraft below) or by a definitive "no draft"; KEPT on a 503 / dropped
    // request, because that is not "no draft" and a save now would POST the empty store
    // over the real one. The retry card re-runs this effect.
    const attempt = ++latestResumeAttempt;
    heldByAttemptRef.current = attempt;
    setResumePending(true);
    const lowerHold = () => {
      heldByAttemptRef.current = null;
      setResumePending(false);
    };
    api.get<DraftResponse>('/applications/draft')
      .then((response) => {
        // Round 3: an answer to a fetch that is no longer the latest is ignored entirely.
        if (attempt !== latestResumeAttempt) return;
        const outcome = classifyDraftResponse(response);
        if (outcome.kind === 'unavailable') {
          // W1-WIZARD — 503/network on the draft fetch is NOT "no draft"
          // (a genuine no-draft is 200 {success:true, data:null}). Silently
          // showing a blank form here would hide the farmer's server-side
          // draft and invite a duplicate application — surface retry instead.
          setUnavailable(true);
          return;
        }
        // Whatever the server said, it has now said it: the guard may judge.
        setDraftSettled(true);
        if (outcome.kind === 'empty') {
          // No draft — blank form is correct, and a held answer may now be saved.
          lowerHold();
          return;
        }
        const draft = outcome.draft;
        const formData = draft.formData;
        // Redundant with the 'empty' classification, kept for TS narrowing.
        if (!formData || !formData.plantId) { lowerHold(); return; }
        const applicationId = draft.draftId || draft.id;
        // A stored purpose no ภ.ท. licence backs is not carried into the store (autosave would
        // post it back and the draft door refuses it) and is not dropped without a word: step 4
        // shows it and asks again (operator ruling 2026-10-05).
        const storedPurposes = splitStoredPurposes(formData.certificationPurposes);
        recordStalePurposes(storedPurposes.stale);
        // hydrateDraft, not updateState (O1): this is a LOAD. The autosave takes what it
        // restores as its baseline, so resuming a draft does not post it straight back.
        // Answers given while the fetch was in flight win over the draft, and the load is
        // marked unsent so the autosave posts the merged filing (I-1).
        const answeredDuringLoad = answersChangedSince(stateAtFetch, latestStateRef.current);
        const unsent: Partial<WizardState> = Object.keys(answeredDuringLoad).length > 0
          ? { ...answeredDuringLoad, syncStatus: 'PENDING', resumePending: false }
          : { syncStatus: 'SYNCED', resumePending: false };
        hydrateDraft({
          plantId: formData.plantId,
          // v2 step 1, with the legacy mapping. A draft saved before v2 has no
          // requestType, and leaving it null makes isStepComplete(1) false — so every
          // resumed legacy draft would be bounced to step 1 and the farmer would be
          // asked to re-answer something they already answered. The v1 wizard recorded
          // the same fact in `serviceType`, so read it there.
          requestType: formData.requestType ?? legacyRequestType(formData.serviceType),
          // Only a NEW request is asked for a scope; v1 had no such field, and every
          // v1 filing was a growing application, which is the form's own default.
          certScope: formData.certScope
            ?? ((formData.requestType ?? legacyRequestType(formData.serviceType)) === 'NEW' ? 'PLANTING' : null),
          // The register spells the community holder COMMUNITY_ENTERPRISE; the v1
          // applicant form said COMMUNITY. Translating here rather than at the engine
          // keeps one spelling on the wire.
          applicantType: formData.applicantType
            ?? (formData.applicantData?.applicantType === 'COMMUNITY'
              ? 'COMMUNITY_ENTERPRISE'
              : formData.applicantData?.applicantType ?? null),
          previousCertificateNumber: formData.previousCertificateNumber ?? null,
          serviceType: formData.serviceType ?? null,
          certificationPurposes: storedPurposes.valid,
          consentedPDPA: formData.consentedPDPA ?? false,
          acknowledgedStandards: formData.acknowledgedStandards ?? false,
          siteTypes: formData.siteTypes ?? [],
          licensePdfUrl: formData.licensePdfUrl ?? null,
          cultivationMethods: formData.cultivationMethods ?? [],
          applicantData: formData.applicantData ?? null,
          farmData: formData.farmData ?? null,
          plots: formData.plots ?? [],
          lots: formData.lots ?? [],
          documents: formData.documents ?? [],
          productionData: formData.productionData ?? null,
          harvestData: formData.harvestData ?? null,
          // EVERY KEY THE AUTOSAVE SENDS MUST BE RESTORED HERE. That is not tidiness,
          // it is the invariant that keeps a reload from destroying the farmer's work.
          //
          // The autosave posts the whole wizard store and the server now persists it
          // (POST /draft's wizard-owned allowlist). So any key this hydrator does NOT
          // restore sits at its initial value — [] / null / 0 / '' — and the save that
          // fires ~3 s after hydration writes that emptiness over the real data. No user
          // edit is needed: hydration was itself a state change, which is what scheduled
          // the save. (Since O1, 2026-09-30, a load no longer schedules one — but the next
          // real edit sends the whole store, so the invariant stands.)
          //
          // Eleven keys were in exactly that position and were measured being destroyed
          // by one save on a fresh browser: serviceTypes, stepDocuments (the eleven-slot
          // document record), cultivationDetails, plantTracking, generalInfo, siteData,
          // securityData, youtubeUrl, qrCount, estimatedQRCost, locationType. That is the
          // upload-loss defect inverted — losing it on the SERVER rather than on screen.
          //
          // hydration-covers-autosave.test.ts fails if the two lists ever drift again.
          // ขั้น 4 (2026-09-06): สามฟิลด์นี้เคยถูกเขียนผ่าน cast จึงไม่มีในชนิดของสถานะ
          // และไม่มีใครรู้ว่าต้องคืนค่ามันตอนโหลดร่างกลับมา
          varieties: formData.varieties ?? [],
          varietiesNote: formData.varietiesNote ?? null,
          processing: formData.processing ?? null,
          serviceTypes: formData.serviceTypes ?? [],
          siteData: formData.siteData ?? null,
          securityData: formData.securityData ?? null,
          youtubeUrl: formData.youtubeUrl ?? '',
          locationType: formData.locationType ?? null,
          generalInfo: formData.generalInfo ?? null,
          cultivationDetails: formData.cultivationDetails ?? null,
          stepDocuments: formData.stepDocuments ?? [],
          plantTracking: formData.plantTracking ?? [],
          qrCount: formData.qrCount ?? 0,
          estimatedQRCost: formData.estimatedQRCost ?? 0,
          ...(applicationId !== undefined ? { applicationId } : {}),
          ...unsent,
        });
        heldByAttemptRef.current = null; // hydrateDraft lowered the hold with the load
      })
      .catch(() => {
        if (attempt !== latestResumeAttempt) return;
        // api.get never rejects in practice; defensive — treat an
        // unexpected rejection like any other transport failure.
        setUnavailable(true);
      });
  }, [state.plantId, hydrateDraft, setResumePending, retryNonce, persistSettled]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        setLoading(true);
        const plantId = state.plantId || 'cannabis';

        // W1-WIZARD — the api-client never rejects; a 503/network failure
        // arrives as {success:false}. That used to be swallowed here
        // (silent fallback to default steps), leaving farmers on bad
        // networks with no signal and no retry. Now an unreachable
        // backend renders the amber retry state instead.
        const response = await api.get<{ steps?: number[] }>(`/api/applications/config?plantId=${plantId}`, { skipAuth: true });
        const outcome = resolveActiveSteps(response, ALL_STEPS);
        if (outcome.kind === 'unavailable') {
          setUnavailable(true);
          return;
        }

        const currentStep = outcome.steps.find((step) => step.stepNumber === stepNumber);

        if (!currentStep) {
          setError(chrome.stepNumberNotFound.replace('{n}', String(stepNumber)));
          return;
        }

        setStepConfig(currentStep);
        setCurrentStep(stepNumber - 1);
      } catch (err) {
        console.error('Step load error:', err);
        setError(chrome.stepLoadFailed);
      } finally {
        setLoading(false);
      }
    };

    if (stepNumber > 0) {
      void fetchConfig();
    } else {
      notFound();
    }
  }, [setCurrentStep, state.plantId, stepNumber, chrome.stepNumberNotFound, chrome.stepLoadFailed, retryNonce]);

  // W1-WIZARD — retry re-fires BOTH gating fetches. `setLoading(true)`
  // here (not just in the effect) so the frame between the click and the
  // effects running shows the spinner, never a flash of the rose
  // "step not found" card.
  const retryLoad = useCallback(() => {
    setUnavailable(false);
    setLoading(true);
    hydrationAttempted.current = false;
    setRetryNonce((nonce) => nonce + 1);
  }, []);

  // W1-WIZARD — backend unreachable (config or draft fetch failed with a
  // non-2xx/network error). Amber indeterminate state with a retry action,
  // mirroring the public verify page's ServiceUnavailable pattern: no
  // verdict was reached, so we neither spin forever nor pretend the form
  // loaded. Checked before `loading` so a draft failure surfaces even
  // while the config fetch is still settling; `retryLoad` flips it back
  // to the spinner for the in-flight window.
  if (unavailable) {
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <div
          role="status"
          className="flex w-full flex-col items-center justify-center gap-3 rounded-[1.375rem] border border-amber-200 bg-amber-50 px-6 py-16 text-center"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
            <AlertTriangle className="h-7 w-7" aria-hidden="true" />
          </span>
          <div className="leading-snug">
            <h3 className="text-lg font-bold text-amber-800">ไม่สามารถโหลดแบบฟอร์มได้ชั่วคราว</h3>
            <p className="mt-1 text-sm text-amber-700">
              ระบบขัดข้องชั่วคราว ข้อมูลที่คุณกรอกไว้ไม่หายไป กรุณาลองใหม่อีกครั้ง
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              Unable to load the form right now. Please try again.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={retryLoad}
            className="mt-2 border-amber-300 text-amber-700 hover:bg-amber-50"
          >
            ลองใหม่อีกครั้ง
          </Button>
        </div>
      </div>
    );
  }

  // `pending` means the store has not settled, so no verdict about this step is
  // possible yet. The spinner is the honest answer: rendering the step would be
  // the URL skip, and bouncing would punish a draft that is still loading.
  if (loading || access.kind === 'pending') {
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <div className="flex h-[400px] w-full flex-col items-center justify-center gap-4 rounded-[1.375rem] border border-mint-bg bg-card shadow-leaf-card">
          <Spinner className="h-10 w-10 text-leaf-700" />
          <p className="text-sm font-bold text-muted-foreground">{chrome.loadingStep}</p>
        </div>
      </div>
    );
  }

  // F-G4-11 — a step whose prerequisites are unmet does not render. The
  // `router.replace` above is already in flight; this is what stands in the
  // step's place for the frame or two before it lands, and it says the same
  // thing the notice on the destination will say. The old code rendered the
  // full step form here and teleported afterwards.
  if (access.kind === 'blocked') {
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <div
          role="status"
          className="flex w-full flex-col items-center justify-center gap-3 rounded-[1.375rem] border border-amber-200 bg-amber-50 px-6 py-16 text-center"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
            <AlertTriangle className="h-7 w-7" aria-hidden="true" />
          </span>
          <div className="leading-snug">
            <h3 className="text-lg font-bold text-amber-800">
              {bounceNoticeCopy(access, resolveStepTitle(
                ALL_STEPS.find((step) => step.stepNumber === access.allowedStep) ?? ALL_STEPS[0]!,
                language,
              )).title}
            </h3>
            <p className="mt-1 text-sm text-amber-700">
              กำลังพาคุณกลับไปที่ขั้นตอนที่ {access.allowedStep} เพื่อกรอกข้อมูลให้ครบก่อน
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !stepConfig) {
    return (
      <div className="mx-auto w-full max-w-[760px]">
        <div className="rounded-[1.375rem] border border-rose-200 bg-rose-50 px-6 py-16 text-center">
          <h3 className="text-xl font-bold text-rose-600">{chrome.errorTitle}</h3>
          <p className="mt-2 text-sm text-rose-500">{error || chrome.stepNotFound}</p>
        </div>
      </div>
    );
  }

  // A registry entry with no component yet — a REAL state during the v2 rebuild
  // (T6-T11). Rendering `undefined` would blank the page with a React error the
  // applicant cannot act on, so a card says what is true instead.
  //
  // It stands in for the STEP BODY rather than returning early: everything this page
  // renders around the body — the bounce notice that explains why the farmer was sent
  // here, the stepper, the title — must still appear. An early return here swallowed
  // the bounce notice, which is the one thing a bounced farmer needs to read.
  const StepComponent = COMPONENT_MAP[stepConfig.key] ?? StepBeingRebuilt;
  const navPlan = wizardNavFor(stepNumber, state);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={stepNumber}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="w-full space-y-5"
      >
        {/* F-G4-11 — why the address bar changed on its own. A bounce with no
            words reads as a broken app, so the step that was refused, the step
            that is blocking, and the way out are all named here. Dismissible,
            and shown once: `takeBounce` clears the reason as it hands it over. */}
        {bounce ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-[1.375rem] border border-amber-200 bg-amber-50 px-5 py-4"
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 leading-snug">
              <h3 className="text-sm font-bold text-amber-800">
                {bounceNoticeCopy(bounce, resolveStepTitle(stepConfig, language)).title}
              </h3>
              <p className="mt-1 text-sm text-amber-700">
                {bounceNoticeCopy(bounce, resolveStepTitle(stepConfig, language)).body}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setBounce(null)}
              className="shrink-0 text-amber-700 hover:bg-amber-100"
            >
              ปิด
            </Button>
          </div>
        ) : null}

        {/* bg-card, not bg-white: a bare white card stayed white in dark while the
            text written on it flipped to near-white (step 10, review M-4). */}
        <div className="overflow-hidden rounded-[1.375rem] border border-mint-bg bg-card shadow-leaf-card">
          {/* Header: dict-driven title + description. The step-position
              indicator lives once, in the parent layout's pill stepper
              (_steps/layout.tsx) — this header does not repeat it. */}
          <div className="flex items-start gap-4 px-5 pt-6 sm:px-7 sm:pt-7">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-primary">
                {resolveStepTitle(stepConfig, language)}
              </h2>
              {stepDescriptions[stepConfig.key] && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {stepDescriptions[stepConfig.key]}
                </p>
              )}
            </div>
          </div>

          {/* Step form body — restyled inset surface; actual form components untouched */}
          <div className="mt-5 border-t border-mint-bg bg-mint-soft/40 px-5 py-5 sm:px-7 sm:py-6">
            <ErrorBoundary>
              {StepComponent ? (
                <StepComponent />
              ) : (
                <div className="py-20 text-center font-medium text-muted-foreground">{chrome.stepNotAvailable}</div>
              )}
            </ErrorBoundary>
          </div>

          {/* แถบนำทางของ wizard — เรนเดอร์ที่นี่ที่เดียว ไม่ใช่ให้แต่ละขั้นเรนเดอร์เอง
              จนถึง 2026-09-06 มีแค่ขั้นที่ 1 ที่มีปุ่ม ส่วนขั้น 2-6 ไม่มีปุ่มใด ๆ เลย
              ⇒ ผู้ยื่นกรอกขั้น 2 เสร็จแล้วไปต่อไม่ได้และย้อนกลับไม่ได้ · ขั้นที่ลืม
              เรนเดอร์ปุ่มของตัวเองกลายเป็นทางตันโดยไม่มีอะไรพังให้เห็น */}
          {(navPlan.backHref || navPlan.nextHref) && (
            <div className="border-t border-mint-bg px-5 py-4 sm:px-7">
              <ApplicationNavigation
                showBack={Boolean(navPlan.backHref)}
                onBack={() => { if (navPlan.backHref) { router.push(navPlan.backHref); } }}
                showNext={Boolean(navPlan.nextHref)}
                // คำเดียวกับที่ขั้น 1 เคยใช้ ไม่ใช่ค่าตั้งต้นของคอมโพเนนต์ ("ดำเนินการต่อ")
                nextLabel="ถัดไป"
                isNextDisabled={navPlan.nextDisabled}
                onNext={() => {
                  if (navPlan.nextHref && !navPlan.nextDisabled) { router.push(navPlan.nextHref); }
                }}
              />
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
