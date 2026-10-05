'use client';

/**
 * Application Form Store v2 — Hybrid Auto-Save (Google Docs pattern)
 * IndexedDB (instant) + API sync (debounced 3s)
 *
 * Data flow:
 * 1. User types → save to IndexedDB instantly (0ms)
 * 2. Debounce 3s → PATCH /api/applications/draft (delta)
 * 3. Show"Saved"when API confirms
 * 4. On mount → check API draft first → fallback to IndexedDB
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { indexedDBStorage } from '@/lib/indexeddb-storage';
import { apiClient, type ApiResponse } from '@/lib/api/api-client';
import { submitGateRefusalTh } from '@/lib/services/application-requirements';

import type {
  PlantId,
  ServiceType,
  CertificationPurpose,
  MainCultivationType,
  SiteType,
  ApplicantData,
  FarmData,
  Plot,
  HarvestData,
  DocumentUpload,
  CultivationDetails,
} from './domain-types';

// ═════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface FormState {
  // Step 1: Plant & Consent
  consentedPDPA: boolean;
  acknowledgedStandards: boolean;
  plantId: PlantId | null;
  serviceType: ServiceType;
  certificationPurposes: CertificationPurpose[];
  cultivationMethods: MainCultivationType[];
  siteTypes: SiteType[];

  // Step 2: Applicant
  applicantData: ApplicantData | null;

  // Step 3: Farm & Cultivation
  farmData: FarmData | null;
  plots: Plot[];
  cultivationDetails: CultivationDetails | null;

  // Step 4: Quality & Documents
  harvestData: HarvestData | null;
  documents: DocumentUpload[];

  // Step 5: Review
  confirmed: boolean;

  // Meta
  applicationId: string | null;
  applicationNumber: string | null;
  syncVersion: number;
  currentStep: number;
  syncStatus: SyncStatus;
  lastSyncError: string | null;
  isEditMode: boolean;
}

export interface FormActions {
  update: (partial: Partial<FormState>) => void;
  reset: () => void;
  setStep: (step: number) => void;
  syncToAPI: () => Promise<void>;
  loadFromAPI: (editId?: string) => Promise<void>;
  submitToAPI: () => Promise<{ success: boolean; error?: string; applicationId?: string }>;
}

// ═════════════════════════════════════════════
// Initial State
// ═════════════════════════════════════════════

const initialState: FormState = {
  consentedPDPA: false,
  acknowledgedStandards: false,
  plantId: null,
  serviceType: 'NEW',
  certificationPurposes: [],
  cultivationMethods: [],
  siteTypes: [],
  applicantData: null,
  farmData: null,
  plots: [],
  cultivationDetails: null,
  harvestData: null,
  documents: [],
  confirmed: false,
  applicationId: null,
  applicationNumber: null,
  syncVersion: 0,
  currentStep: 0,
  syncStatus: 'idle',
  lastSyncError: null,
  isEditMode: false,
};

// ═════════════════════════════════════════════
// Data Mapper: Flat State ↔ Backend formData.steps
// ═════════════════════════════════════════════

function stateToBackendSteps(state: FormState): Record<string, Record<string, unknown>> {
  return {
    // Step 1: Plant & Consent
    '1': {
      plantId: state.plantId,
      serviceType: state.serviceType,
      certificationPurposes: state.certificationPurposes,
      cultivationMethods: state.cultivationMethods,
      siteTypes: state.siteTypes,
      consentedPDPA: state.consentedPDPA,
      acknowledgedStandards: state.acknowledgedStandards,
    },
    // Step 2: Applicant
    '2': state.applicantData ? { ...state.applicantData } : {},
    // Step 3: Farm & Cultivation
    '3': {
      ...(state.farmData || {}),
      plots: state.plots,
      cultivationDetails: state.cultivationDetails,
    },
    // Step 4: Quality & Documents
    '4': {
      ...(state.harvestData || {}),
      documents: state.documents,
    },
    // Step 5: Review
    '5': {
      confirmed: state.confirmed,
    },
  };
}

function backendStepsToState(steps: Record<string, Record<string, unknown>>): Partial<FormState> {
  const s1 = (steps?.['1'] || {}) as Record<string, unknown>;
  const s2 = (steps?.['2'] || {}) as Record<string, unknown>;
  const s3 = (steps?.['3'] || {}) as Record<string, unknown>;
  const s4 = (steps?.['4'] || {}) as Record<string, unknown>;
  const s5 = (steps?.['5'] || {}) as Record<string, unknown>;

  const result: Partial<FormState> = {};

  // Step 1
  if (s1.plantId) result.plantId = s1.plantId as PlantId;
  if (s1.serviceType) result.serviceType = s1.serviceType as ServiceType;
  // Backward compat: handle both old single string and new array format
  if (Array.isArray(s1.certificationPurposes)) {
    result.certificationPurposes = s1.certificationPurposes as CertificationPurpose[];
  } else if (s1.certificationPurpose) {
    result.certificationPurposes = [s1.certificationPurpose as CertificationPurpose];
  }
  if (Array.isArray(s1.cultivationMethods)) result.cultivationMethods = s1.cultivationMethods as MainCultivationType[];
  if (Array.isArray(s1.siteTypes)) result.siteTypes = s1.siteTypes as SiteType[];
  if (typeof s1.consentedPDPA === 'boolean') result.consentedPDPA = s1.consentedPDPA;
  if (typeof s1.acknowledgedStandards === 'boolean') result.acknowledgedStandards = s1.acknowledgedStandards;

  // Step 2
  if (s2.applicantType) result.applicantData = s2 as unknown as ApplicantData;

  // Step 3
  if (s3.farmName || s3.address) {
    const { plots, cultivationDetails, ...farmFields } = s3 as Record<string, unknown>;
    result.farmData = farmFields as unknown as FarmData;
    if (Array.isArray(plots)) result.plots = plots as Plot[];
    if (cultivationDetails) result.cultivationDetails = cultivationDetails as CultivationDetails;
  }

  // Step 4
  if (s4.harvestMethod || s4.dryingMethod) {
    const { documents, ...harvestFields } = s4 as Record<string, unknown>;
    result.harvestData = harvestFields as unknown as HarvestData;
    if (Array.isArray(documents)) result.documents = documents as DocumentUpload[];
  }

  // Step 5
  if (typeof s5.confirmed === 'boolean') result.confirmed = s5.confirmed;

  return result;
}

// ═════════════════════════════════════════════
// Debounce helper
// ═════════════════════════════════════════════

let syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DELAY_MS = 3000;

function debouncedSync(fn: () => void) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(fn, SYNC_DELAY_MS);
}

/** Cancel pending debounced sync — call on component unmount to prevent memory leak */
export function cancelPendingSync() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}

// ═════════════════════════════════════════════
// Store
// ═════════════════════════════════════════════

export const useApplicationFormStore = create<FormState & FormActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      // Update + trigger debounced API sync
      update: (partial) => {
        set((state) => ({
          ...state,
          ...partial,
          syncVersion: state.syncVersion + 1,
          syncStatus: 'idle' as SyncStatus,
        }));

        // Schedule debounced API sync
        debouncedSync(() => {
          const current = get();
          if (current.applicationId || current.syncVersion > 0) {
            void current.syncToAPI();
          }
        });
      },

      reset: () => {
        if (syncTimer) clearTimeout(syncTimer);
        set(initialState);
      },

      setStep: (step) => set({ currentStep: step }),

      // ── API Sync (debounced, called auto) ──
      syncToAPI: async () => {
        const state = get();
        set({ syncStatus: 'syncing' });

        try {
          const steps = stateToBackendSteps(state);
          const payload: Record<string, unknown> = {
            ...steps,
            step: state.currentStep + 1, // backend uses 1-indexed
            serviceType: state.serviceType?.toLowerCase() === 'new' ? 'new_application' : state.serviceType,
            consentedPDPA: state.consentedPDPA,
            certificationPurposes: state.certificationPurposes,
          };

          if (state.applicationId) {
            payload.applicationId = state.applicationId;
          }

          // apiClient unwraps one envelope level (api-client.ts:410); backend
          // returns single-level `{ success, data: { draftId, ... } }`
          // (applications.js:395) — so `response.data` IS the inner object.
          const response = await apiClient.post<{
            draftId: string;
            applicationNumber: string;
            status: string;
          }>('/api/applications/draft', payload);

          if (response.success && response.data) {
            set({
              syncStatus: 'synced',
              lastSyncError: null,
              applicationId: response.data.draftId || state.applicationId,
              applicationNumber: response.data.applicationNumber || state.applicationNumber,
            });
          } else {
            set({
              syncStatus: 'error',
              lastSyncError: response.error || 'Failed to sync',
            });
          }
        } catch (err) {
          set({
            syncStatus: 'error',
            lastSyncError: err instanceof Error ? err.message : 'บันทึกอัตโนมัติไม่สำเร็จ',
          });
        }
      },

      // ── Load draft from API (on mount) ──
      loadFromAPI: async (editId?: string) => {
        try {
          // apiClient unwraps one envelope level (api-client.ts:410); both
          // backend routes return single-level `{ success, data: {...} }`
          // (applications.js:917 for /draft, application-workflow-handlers.js:195
          // for /:id) — so `response.data` IS the inner object. Both shapes are
          // read via `Record<string, unknown>` casts below, so a single loose
          // generic keeps the union assignable.
          let response: ApiResponse<Record<string, unknown>>;

          if (editId) {
            // Edit mode: load specific application
            response = await apiClient.get<Record<string, unknown>>(`/api/applications/${editId}`);
          } else {
            // New mode: load latest draft
            response = await apiClient.get<Record<string, unknown>>('/api/applications/draft');
          }

          if (response.success && response.data) {
            const data = response.data;
            const formData = (data as Record<string, unknown>).formData as Record<string, unknown> | undefined;
            const steps = (data as Record<string, unknown>).steps as Record<string, Record<string, unknown>> | undefined
              || (formData?.steps as Record<string, Record<string, unknown>> | undefined);

            if (steps && Object.keys(steps).length > 0) {
              const restored = backendStepsToState(steps);
              const appId = (data as Record<string, unknown>).draftId as string
                || (data as Record<string, unknown>).id as string
                || (data as Record<string, unknown>).id as string;

              set({
                ...restored,
                applicationId: appId || null,
                applicationNumber: (data as Record<string, unknown>).applicationNumber as string || null,
                isEditMode: !!editId,
                syncStatus: 'synced',
              });
            }
          }
        } catch {
          // Silently fail — IndexedDB data is still available
        }
      },

      // ── Submit final application ──
      submitToAPI: async () => {
        const state = get();
        set({ syncStatus: 'syncing' });

        try {
          const steps = stateToBackendSteps(state);
          const payload: Record<string, unknown> = {
            ...steps,
            serviceType: state.serviceType?.toLowerCase() === 'new' ? 'new_application' : state.serviceType,
            consentedPDPA: state.consentedPDPA,
            certificationPurposes: state.certificationPurposes,
          };

          if (state.applicationId) {
            payload.applicationId = state.applicationId;
          }

          // apiClient unwraps one envelope level (api-client.ts:410); backend
          // returns single-level `{ success, data: { id, ... } }`
          // (applications.js:493) — so `response.data` IS the inner object and
          // `message`/`error` are top-level fields on the ApiResponse.
          const response = await apiClient.post<{
            id: string;
            applicationNumber: string;
            status: string;
          }>('/api/applications/submit', payload);

          if (response.success && response.data) {
            set({
              syncStatus: 'synced',
              lastSyncError: null,
              applicationId: response.data.id || state.applicationId,
              applicationNumber: response.data.applicationNumber || state.applicationNumber,
            });
            return { success: true, applicationId: response.data.id };
          }

          // `response.message` is always undefined on the error branch — the envelope
          // strips `message` as a reserved key (api-client.ts:75) — so this used to land
          // on `response.error`, the raw code, and show a farmer the literal string
          // "APPLICATION_NOT_JUDGEABLE". The gate's Thai travels in `.meta`; ask for it by
          // the refusal's KIND, exactly as the preview door does (review layer 2, C1/C7).
          const errorMsg = submitGateRefusalTh(response.code || response.error, response.meta)
            || response.message
            || response.error
            || 'ส่งคำขอไม่สำเร็จ';
          set({ syncStatus: 'error', lastSyncError: errorMsg });
          return { success: false, error: errorMsg };
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'ส่งคำขอไม่สำเร็จ';
          set({ syncStatus: 'error', lastSyncError: msg });
          return { success: false, error: msg };
        }
      },
    }),
    {
      name: 'gacp_application_v2',
      version: 1, // `client-localstorage-schema` — bump on schema changes
      storage: createJSONStorage(() => indexedDBStorage),
      skipHydration: false,
      // Don't persist volatile state — destructure to drop syncStatus +
      // lastSyncError from the persisted snapshot. Names prefixed with `_`
      // because the destructure intentionally throws them away (they only
      // exist as side-channels to omit fields from `rest`).
      partialize: (state) => {
        const { syncStatus: _syncStatus, lastSyncError: _lastSyncError, ...rest } = state;
        return rest as FormState & FormActions;
      },
    }
  )
);
