// jsdom has no IndexedDB; the round-3 test below writes to the store, which persists.
jest.mock('@/lib/indexeddb-storage', () => ({
  indexedDBStorage: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

import { isStepComplete, firstIncompleteStep, useWizardStoreBase } from './use-application-flow-store';
import type { WizardState } from './use-application-flow-store.state-types';

// Minimal-but-complete WizardState matching the store's initialState shape.
const base = {
  currentStep: 0,
  plantId: null,
  serviceType: null,
  serviceTypes: [],
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
  cultivationMethods: [],
  cultivationDetails: null,
  stepDocuments: [],
  plantTracking: [],
  qrCount: 0,
  estimatedQRCost: 0,
  farmData: null,
  plots: [],
  lots: [],
} as unknown as WizardState;

describe('wizard step gating — isStepComplete / firstIncompleteStep', () => {
  // Regression: the new-applicant hard-lock. A step that demands something its own
  // screen has no control for can never complete, so firstIncompleteStep pins there
  // and application-step-page bounces every forward navigation back to it — no new
  // application can be created at all. It happened on v1 step 1 (it required
  // certificationPurposes, which only step 2 collected). The v2 shape is different but
  // the trap is the same, so the guard stays and points at v2 step 1.
  it('step 1 completes on what its own screen collects — request type, applicant and PLANT', () => {
    // The plant moved here from step 4 on 2026-09-06 (F-QA-04): the register keys its
    // document rules on the plant, so a filing without one resolves to zero slots and
    // steps 2-3 show no uploads at all.
    const s: WizardState = { ...base, requestType: 'NEW', applicantType: 'INDIVIDUAL', certScope: 'PLANTING', plantId: 'cannabis' };
    expect(isStepComplete(s, 1)).toBe(true);
    expect(firstIncompleteStep(s)).toBe(2); // advances to identity, NOT stuck at 1
  });

  it('step 1 stays incomplete while any of its own three answers is missing', () => {
    // Request type + applicant + PLANT. (The scope question is retired — ขอใหม่ writes
    // PLANTING silently — but the plant itself is asked here since F-QA-04.)
    expect(isStepComplete({ ...base, requestType: 'NEW', applicantType: 'INDIVIDUAL' }, 1)).toBe(false);
    expect(isStepComplete({ ...base, requestType: 'NEW', applicantType: 'INDIVIDUAL', plantId: 'cannabis' }, 1)).toBe(true);
    expect(isStepComplete({ ...base, requestType: 'NEW', certScope: 'PLANTING' }, 1)).toBe(false);
    expect(isStepComplete({ ...base, applicantType: 'INDIVIDUAL', certScope: 'PLANTING' }, 1)).toBe(false);
    expect(firstIncompleteStep({ ...base, requestType: 'NEW' })).toBe(1);
  });

  it('step 4 gates on purpose — the plant moved to step 1 (F-QA-04)', () => {
    // NOT on cultivationMethods: ลักษณะพื้นที่ moved to step 3, where the paper puts it.
    // Demanding it on a step that no longer collects it is the v1 hard-lock exactly.
    const almost: WizardState = { ...base, plantId: 'cannabis' };
    // purpose still empty → step 4 incomplete (the requirement lives on that screen)
    expect(isStepComplete({ ...almost, certificationPurposes: [] }, 4)).toBe(false);
    expect(isStepComplete({ ...almost, certificationPurposes: ['EXPORT'] }, 4)).toBe(true);
    // The PLANT is still load-bearing — a filing that names none is refused by the submit
    // gate — but it is STEP 1's answer since F-QA-04, and step 1 refuses to complete without
    // it, so the wizard can never reach step 4 with a null plant. Step 4 no longer re-asks.
    expect(isStepComplete({ ...almost, plantId: null }, 1)).toBe(false);
  });
});

/**
 * Round 3: a hold left up by a 503 must not survive a later load. The edit page loads a
 * draft with hydrateDraft and then opens the wizard; if the hold stayed, every save
 * after it was dropped and the filing went in stale.
 */
describe('hydrateDraft lowers a stale resume hold (round 3)', () => {
  it('a load always clears resumePending unless the caller says otherwise', () => {
    const store = useWizardStoreBase.getState();
    store.setResumePending(true);
    expect(useWizardStoreBase.getState().resumePending).toBe(true);
    store.hydrateDraft({ plantId: 'cannabis' } as never);
    expect(useWizardStoreBase.getState().resumePending).toBe(false);
  });
});


/**
 * Round 5: `resetWizard` was `set(initialState)`, a shallow merge, and initialState has no
 * `applicationId` key, so a "reset" kept the id of the application just filed. The next
 * new filing then saved under that id and got 409 forever.
 */
describe('round 5: resetting the wizard lets go of the application', () => {
  it('resetWizard drops applicationId and the quotation display, not only the answers', () => {
    useWizardStoreBase.getState().hydrateDraft({
      applicationId: 'app-filed',
      requestType: 'NEW',
      milestone1: { dtamQuote: { number: 'Q-1', amount: 1, accepted: true } },
    });
    useWizardStoreBase.getState().resetWizard();
    const s = useWizardStoreBase.getState();
    expect(s.applicationId).toBeUndefined();
    expect(s.milestone1).toBeUndefined();
    expect(s.requestType).toBeNull();
  });

  it('detachApplication drops only the id, keeps every answer, and marks them unsent', () => {
    useWizardStoreBase.getState().hydrateDraft({ applicationId: 'app-filed', requestType: 'RENEWAL', plantId: 'cannabis' });
    useWizardStoreBase.getState().detachApplication();
    const s = useWizardStoreBase.getState();
    expect(s.applicationId).toBeUndefined();
    expect(s.requestType).toBe('RENEWAL');
    expect(s.plantId).toBe('cannabis');
    expect(s.syncStatus).toBe('PENDING');
  });
});
