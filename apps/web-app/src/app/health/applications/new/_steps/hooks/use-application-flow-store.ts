"use client";
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { indexedDBStorage } from '@/lib/indexeddb-storage';
import { WIZARD_STORAGE_KEY, registerWizardReset, type WizardOwnership } from '@/lib/wizard-session';
import { getStoredUser } from '@/lib/services/auth-service-session';
import type { WizardState, WizardActions } from './use-application-flow-store.state-types';

export * from './use-application-flow-store.domain-types';
export * from './use-application-flow-store.state-types';
import { identityComplete } from '../steps/step2-identity-config';
import { step1CanProceed } from '../steps/step1-request-type-config';
import { step3CanProceed } from '../steps/step3-site-land-config';
import { step4CanProceed } from '../steps/step4-variety-purpose-config';

const initialState: WizardState = {
  currentStep: 0,
  plantId: null,
  // v2 step 1. Null, never a default: a request type the applicant did not choose
  // would decide which papers the law demands of them.
  requestType: null,
  certScope: null,
  holderEntityId: null,
  applicantType: null,
  // v2 step 4 — ว่างเปล่า ไม่ใช่แถวตัวอย่าง: ฟอร์มถาม ไม่ได้สมมติให้
  varieties: [],
  varietiesNote: null,
  processing: null,
  previousCertificateNumber: null,
  serviceType: null,
  serviceTypes: [], // Multi-service support
  certificationPurposes: [],
  siteTypes: [],
  licensePdfUrl: null,
  consentedPDPA: false,
  acknowledgedStandards: false,
  applicantData: null,
  siteData: null,
  productionData: null,
  harvestData: null,
  securityData: null,
  documents: [],
  youtubeUrl: '',
  locationType: null,
  generalInfo: null,
  syncStatus: 'SYNCED',
  // [NEW] V4 Fields
  cultivationMethods: [],
  cultivationDetails: null,
  stepDocuments: [],
  plantTracking: [],
  qrCount: 0,
  estimatedQRCost: 0,
  // [NEW] Farm-Plot-Lot
  farmData: null,
  plots: [],
  lots: [],
};

const STORAGE_KEY = WIZARD_STORAGE_KEY;

/**
 * Has the persisted draft finished loading out of IndexedDB — successfully or
 * not?
 *
 * F-G4-11. The URL-skip guard has to read the store to decide which step a
 * farmer has earned, and reading it before rehydration lands means reading an
 * empty wizard and bouncing someone whose draft was simply still in flight.
 * `persist.hasHydrated()` answers only the happy path: zustand leaves it false
 * forever when the storage read throws, which is exactly what happens in a
 * browser with IndexedDB blocked (private windows, locked-down profiles). That
 * would disable the guard for those users and leave everyone else waiting on an
 * event that never fires.
 *
 * `onRehydrateStorage`'s callback is the one signal zustand fires on BOTH
 * paths (middleware.js — `postRehydrationCallback(state, undefined)` on
 * success, `(undefined, error)` in the catch). Settled here means "we know as
 * much as we are ever going to know", which is the question the guard is
 * actually asking.
 */
let persistSettled = false;
const persistSettledListeners = new Set<() => void>();

function markPersistSettled(): void {
  if (persistSettled) return;
  persistSettled = true;
  persistSettledListeners.forEach((listener) => listener());
  persistSettledListeners.clear();
}

// Create the Zustand store with persistence
const useApplicationFlowStoreBase = create<WizardState & WizardActions>()(
  persist(
    (set, _get) => ({
      // Initial state
      ...initialState,

      // Actions
      updateState: (updates) => set((state) => ({ ...state, ...updates })),

      // O1 — a load, not an edit. One set() so the autosave never sees the loaded
      // answers without the new epoch that marks them as loaded.
      // What was loaded is what the server holds, so it is SYNCED — unless the caller says
      // otherwise (I-1: the step page passes PENDING when it keeps answers given while
      // the load was in flight, so the autosave still sends them).
      // Round 3: a load also ends any resume hold — a hold left up by an earlier 503 must
      // not outlive the draft that has now loaded (it silently dropped every later save).
      hydrateDraft: (updates) => set((state) => ({
        ...state,
        syncStatus: 'SYNCED',
        resumePending: false,
        ...updates,
        hydrationEpoch: (state.hydrationEpoch ?? 0) + 1,
      })),

      markHydrated: () => set((state) => ({ hydrationEpoch: (state.hydrationEpoch ?? 0) + 1 })),

      setResumePending: (resumePending) => set({ resumePending }),

      setPlant: (plantId) => set((state) => ({
        plantId,
        currentStep: Math.max(state.currentStep, 0)
      })),

      setServiceType: (serviceType) => set({ serviceType }),

      setServiceTypes: (serviceTypes) => set({ serviceTypes }),

      setCertificationPurposes: (purposes) => set({ certificationPurposes: purposes }),

      setSiteTypes: (siteTypes) => set({ siteTypes }),

      setLicensePdfUrl: (url) => set({ licensePdfUrl: url }),

      setApplicantData: (applicantData) => set({ applicantData }),

      setSiteData: (siteData) => set({ siteData }),

      setProductionData: (productionData) => set({ productionData }),

      setHarvestData: (harvestData) => set({ harvestData }),

      setSecurityData: (securityData) => set({ securityData }),

      setDocuments: (documents) => set({ documents }),

      setLocationType: (locationType) => set({ locationType }),

      setYoutubeUrl: (youtubeUrl) => set({ youtubeUrl }),

      setGeneralInfo: (generalInfo) => set({ generalInfo }),

      setCurrentStep: (step) => set({ currentStep: step }),

      consentPDPA: () => set({ consentedPDPA: true }),

      acknowledgeStandards: () => set({ acknowledgedStandards: true }),

      // Round 5: a reset lets go of the APPLICATION too. This was `set(initialState)`, a
      // shallow merge, and initialState has no `applicationId` key, so the id of the
      // application just filed survived the reset and the next new filing saved under it
      // (409, forever). The new epoch marks the empty state as loaded, not edited (O1).
      // (replace = true, so the dropped keys are really gone, actions kept from `rest`)
      resetWizard: () => set((state) => {
        const {
          applicationId: _filed, milestone1: _quote, createdAt: _created, updatedAt: _updated,
          ownerUserId: _owner,
          ...rest
        } = state;
        return { ...rest, ...initialState, hydrationEpoch: (state.hydrationEpoch ?? 0) + 1 };
      }, true),

      // Round 5 (b): the server refused the id (409 APPLICATION_NOT_EDITABLE, already
      // filed; or 404 APPLICATION_NOT_FOUND, deleted or not this user's). Keep every
      // answer, forget the id, and mark the answers unsent so the next save makes a new
      // draft. Never touches the refused application.
      detachApplication: () => set((state) => {
        const { applicationId: _refused, ...rest } = state;
        return { ...rest, syncStatus: 'PENDING' };
      }, true),

      setApplicationId: (applicationId) => set({ applicationId }),
      setSyncStatus: (syncStatus) => set({ syncStatus }),

      // [NEW] Farm-Plot-Lot actions
      setFarmData: (farmData) => set({ farmData }),
      setPlots: (plots) => set({ plots }),
      setLots: (lots) => set({ lots }),
      addPlot: (plot) => set((state) => ({ plots: [...state.plots, plot] })),
      removePlot: (plotId) => set((state) => ({
        plots: state.plots.filter(p => p.id !== plotId),
        lots: state.lots.filter(l => l.plotId !== plotId)
      })),
      addLot: (lot) => set((state) => ({ lots: [...state.lots, lot] })),
      removeLot: (lotId) => set((state) => ({ lots: state.lots.filter(l => l.id !== lotId) })),
      setCultivationMethods: (methods) => set({ cultivationMethods: methods }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => indexedDBStorage),
      // Enable automatic hydration from indexedDB
      skipHydration: false,
      // resumePending describes THIS page's in-flight fetch; persisting it would hold a
      // later session's autosave on a fetch that no longer exists (round 2).
      partialize: (state) => {
        const { resumePending: _inFlightOnly, ...persisted } = state;
        return persisted;
      },
      // Fires whether the read succeeded or threw — see markPersistSettled.
      // O1: what IndexedDB handed back is a LOAD — mark it so the autosave takes it
      // as its baseline instead of posting it straight back to the server.
      onRehydrateStorage: () => (state) => {
        // Round 5b: answers with no owner stamp were written before the stamp existed, by
        // whoever used this browser then. They are not handed to the person signed in now.
        if (state && !state.ownerUserId && wizardHoldsAnswers(state)) {
          state.resetWizard();
        }
        state?.markHydrated();
        markPersistSettled();
      },
    }
  )
);

function wizardHoldsAnswers(state: Partial<WizardState>): boolean {
  return Boolean(state.requestType || state.plantId || state.applicationId);
}

// Round 5: logout / account switch / an accepted filing empty this store through
// lib/wizard-session (forgetWizard), which the auth service can call without importing it.
// Round 5b: and the auth service asks it whose answers it holds (claimWizardFor).
registerWizardReset(
  () => useApplicationFlowStoreBase.getState().resetWizard(),
  (): WizardOwnership => {
    const state = useApplicationFlowStoreBase.getState();
    return { ownerUserId: state.ownerUserId, started: wizardHoldsAnswers(state) };
  },
);

// Round 5b: the first time the wizard holds answers, stamp whose they are: the user signed
// in now. Answers are only reachable signed in, so every state written from here on carries
// its owner, and the persist middleware writes the stamp with them.
useApplicationFlowStoreBase.subscribe((state) => {
  if (state.ownerUserId || !wizardHoldsAnswers(state)) { return; }
  const userId = getStoredUser()?.id;
  if (userId) { useApplicationFlowStoreBase.setState({ ownerUserId: String(userId) }); }
});

/**
 * Subscribe to the rehydration signal above. Returns true once the persisted
 * draft has loaded or has failed to load; never blocks forever on either.
 */
export function useWizardPersistSettled(): boolean {
  const [settled, setSettled] = useState(persistSettled);

  useEffect(() => {
    if (persistSettled) {
      setSettled(true);
      return;
    }
    const listener = () => setSettled(true);
    persistSettledListeners.add(listener);
    return () => { persistSettledListeners.delete(listener); };
  }, []);

  return settled;
}

// Validation helpers — 9-step model (matches FLOW_STEPS in
// application-flow-config.ts). The numbering is URL-stable: step 3
// is intentionally vacant (merged into step 2) so callers operate on
// stepNumber, not array-index.
//
// Each function takes a stepNumber from the URL (1, 2, 4, 5, 6, 7, 8, 9)
// and decides whether the data needed to LEAVE that step is in the
// store. The previous 5-step version (cases 0..4) silently accepted any
// step beyond step 4 = "valid" — that's how /step/9 was reachable
// without ever filling the wizard.

/**
 * What each of the SIX v2 steps counts as finished.
 *
 * This gate is what forward navigation is bounced against, so a step that demands
 * something its own screen cannot produce hard-locks every applicant. v1 did exactly
 * that: step 1 required `certificationPurposes` while the step-1 screen had no
 * control for it, so `isStepComplete(1)` could never be true and the guard in
 * application-step-page bounced everyone back to step 1 forever. Every case below
 * therefore asks only for what that step's own screen collects.
 */
export function isStepComplete(state: WizardState, stepNumber: number): boolean {
  const stated = (v: unknown) => String(v ?? '').trim() !== '';
  switch (stepNumber) {
    case 1:
      // ประเภทคำขอและผู้ยื่น. Both answers are needed before anything downstream
      // means anything: the request type picks which papers the law asks for, and
      // the holder type is a dimension the requirement engine matches on. A renewal
      // or replacement succeeds a certificate and must name it; a NEW filing states
      // whether it is being certified for growing or for processing.
      //
      // 2026-09-06: this used to re-implement those rules inline while the step's own
      // button asked `step1CanProceed`. Two copies of one rule, and the file that owns
      // the screen even claimed they were one predicate. Now they are.
      return step1CanProceed({
        requestType: state.requestType,
        applicantType: state.applicantType,
        certScope: state.certScope,
        // The plant is step 1's answer since F-QA-04 — omitting it here would be the
        // "gate cannot see what the screen writes" class all over again.
        plantId: state.plantId,
        previousCertificateNumber: state.previousCertificateNumber,
      });
    case 2:
      // ตัวตนผู้ยื่น — the กทล.1 ส่วนที่ ๑ fields for the type chosen in STEP 1.
      //
      // Judged by the SAME catalog the screen renders from (step2-identity-config),
      // so the gate cannot ask for a field the form never shows. Keyed on
      // `state.applicantType` — step 1's answer, in the register's vocabulary — not on
      // the older `applicantData.applicantType`, which says COMMUNITY where the
      // register says COMMUNITY_ENTERPRISE.
      return identityComplete(
        state.applicantType,
        state.applicantData as unknown as Record<string, unknown> | null,
      );
    case 3:
      // สถานที่และที่ดิน — judged by the SAME predicate the screen is built from
      // (step3-site-land-config), so the gate cannot ask for a field the form never shows.
      //
      // 2026-09-06: it used to ask for `farmData.farmName`, `farmData.address` and at least
      // one `plots` row. The step writes `siteName` and `siteAddress`, and it never creates
      // a plot at all — so the step could not be completed by any amount of typing, the
      // ถัดไป button stayed dead, and the route guard bounced everyone who tried step 4.
      return step3CanProceed(state.farmData as unknown as Record<string, unknown> | null);
    case 4:
      // พันธุ์และวัตถุประสงค์ — judged by the SAME predicate the screen's own button
      // uses, so the two cannot disagree. The plant is the load-bearing part: กทล.1 law
      // is filed PER PLANT, and a filing that names none is refused by the submit gate
      // rather than judged leniently (APPLICATION_NOT_JUDGEABLE), so asking here is what
      // stops an applicant reaching the review page only to be turned away.
      //
      // cultivationMethods is NOT asked here any more: ลักษณะพื้นที่ moved to step 3,
      // where the paper puts it, and demanding it on a step that no longer collects it
      // is the v1 hard-lock exactly.
      return step4CanProceed({
        plantId: state.plantId,
        objectives: state.certificationPurposes,
      });
    case 5:
      // แผนและเอกสาร. The required-document set is the SERVER's answer
      // (GET /applications/:id/requirements), never a list the browser keeps — the
      // browser holding its own copy is how a farmer was told ครบ on one screen and
      // ไม่ครบ on the next. The refusal belongs to the submit gate, which states the
      // law's reasons, and to the review page, which names each missing paper and the
      // step to fix it on.
      //
      // 2026-09-06: this used to ask `state.documents.filter(d => d.uploaded).length > 0`.
      // The v2 slot card uploads to the server and re-reads the requirements; it never
      // writes that array, so the condition could not become true however many papers were
      // attached — the ถัดไป button was dead and the REVIEW PAGE was unreachable. A page
      // whose job is to say what is missing, reachable only once nothing is missing, is
      // not a gate; it is a wall in front of the only screen that explains the wall.
      return true;
    case 6:
      // ตรวจทาน — read-only, and it renders the server's account of the filing.
      return true;
    default:
      // 7, 8 and 9 are gone. Answering `true` for an unknown number would let a
      // stale deep link walk straight past every gate above.
      return false;
  }
}

/** The six steps, in order. There is no vacant slot to skip any more. */
const V2_STEP_ORDER = [1, 2, 3, 4, 5, 6] as const;

/**
 * The first step the applicant should be sent to. Returns 6 (the review step)
 * when everything before it is done.
 */
export function firstIncompleteStep(state: WizardState): number {
  for (const stepNumber of V2_STEP_ORDER) {
    if (!isStepComplete(state, stepNumber)) {
      return stepNumber;
    }
  }
  return 6;
}

/**
 * @deprecated Use isStepComplete(state, stepNumber) instead.
 * Kept for callers using the old 5-step model (none in tree as of 2026-05-03).
 */
export function canProceedFromStep(state: WizardState, step: number): boolean {
  // Old 0-indexed 5-step model → v2 step numbers.
  const legacyMap: Record<number, number> = { 0: 4, 1: 3, 2: 5, 3: 5, 4: 6 };
  const stepNumber = legacyMap[step] ?? step;
  return isStepComplete(state, stepNumber);
}

export function getCompletedSteps(state: WizardState): number[] {
  const completed: number[] = [];
  for (const stepNumber of V2_STEP_ORDER) {
    if (!isStepComplete(state, stepNumber)) break;
    completed.push(stepNumber);
  }
  return completed;
}

// Public hook — the single canonical hook for consumers
export function useApplicationFlowStore() {
  const store = useApplicationFlowStoreBase();

  // Extract state object for compatibility
  const state: WizardState = {
    currentStep: store.currentStep,
    plantId: store.plantId,
    requestType: store.requestType,
    certScope: store.certScope,
    holderEntityId: store.holderEntityId,
    applicantType: store.applicantType,
    varieties: store.varieties,
    varietiesNote: store.varietiesNote,
    processing: store.processing,
    previousCertificateNumber: store.previousCertificateNumber,
    serviceType: store.serviceType,
    serviceTypes: store.serviceTypes,
    certificationPurposes: store.certificationPurposes,
    siteTypes: store.siteTypes,
    licensePdfUrl: store.licensePdfUrl,
    consentedPDPA: store.consentedPDPA,
    acknowledgedStandards: store.acknowledgedStandards,
    applicantData: store.applicantData,
    siteData: store.siteData,
    productionData: store.productionData,
    harvestData: store.harvestData,
    securityData: store.securityData,
    documents: store.documents,
    ...(store.youtubeUrl !== undefined ? { youtubeUrl: store.youtubeUrl } : {}),
    locationType: store.locationType,
    generalInfo: store.generalInfo,
    ...(store.applicationId !== undefined ? { applicationId: store.applicationId } : {}),
    syncStatus: store.syncStatus,
    ...(store.hydrationEpoch !== undefined ? { hydrationEpoch: store.hydrationEpoch } : {}),
    ...(store.resumePending !== undefined ? { resumePending: store.resumePending } : {}),
    // Fix round 1 (I3): the autosave checks whose answers these are before every save.
    // Bookkeeping: hash-exempt and never sent (HASH_EXEMPT_KEYS / NOT_SENT_KEYS).
    ...(store.ownerUserId !== undefined ? { ownerUserId: store.ownerUserId } : {}),
    ...(store.createdAt !== undefined ? { createdAt: store.createdAt } : {}),
    ...(store.updatedAt !== undefined ? { updatedAt: store.updatedAt } : {}),
    // V4 Fields
    cultivationMethods: store.cultivationMethods,
    cultivationDetails: store.cultivationDetails,
    stepDocuments: store.stepDocuments,
    plantTracking: store.plantTracking,
    qrCount: store.qrCount,
    estimatedQRCost: store.estimatedQRCost,
    // Farm-Plot-Lot
    farmData: store.farmData,
    plots: store.plots,
    lots: store.lots,
  };

  return {
    state,
    isLoaded: true, // Zustand handles hydration
    updateState: store.updateState,
    hydrateDraft: store.hydrateDraft,
    markHydrated: store.markHydrated,
    setResumePending: store.setResumePending,
    setPlant: store.setPlant,
    setServiceType: store.setServiceType,
    setServiceTypes: store.setServiceTypes,
    setCertificationPurposes: store.setCertificationPurposes,
    setSiteTypes: store.setSiteTypes,
    setLicensePdfUrl: store.setLicensePdfUrl,
    setApplicantData: store.setApplicantData,
    setSiteData: store.setSiteData,
    setProductionData: store.setProductionData,
    setHarvestData: store.setHarvestData,
    setSecurityData: store.setSecurityData,
    setDocuments: store.setDocuments,
    setYoutubeUrl: store.setYoutubeUrl,
    setGeneralInfo: store.setGeneralInfo,
    setCurrentStep: store.setCurrentStep,
    consentPDPA: store.consentPDPA,
    acknowledgeStandards: store.acknowledgeStandards,
    resetWizard: store.resetWizard,
    detachApplication: store.detachApplication,
    setApplicationId: store.setApplicationId,
    setSyncStatus: store.setSyncStatus,
    setLocationType: store.setLocationType,
    setCultivationMethods: store.setCultivationMethods,
    // Farm-Plot-Lot actions
    setFarmData: store.setFarmData,
    setPlots: store.setPlots,
    setLots: store.setLots,
    addPlot: store.addPlot,
    removePlot: store.removePlot,
    addLot: store.addLot,
    removeLot: store.removeLot,
    canProceedFromStep: (step: number) => canProceedFromStep(state, step),
    getCompletedSteps: () => getCompletedSteps(state),
  };
}

// Legacy aliases for backward compatibility
export const useWizardStore = useApplicationFlowStore;
export { useApplicationFlowStoreBase as useWizardStoreBase };
