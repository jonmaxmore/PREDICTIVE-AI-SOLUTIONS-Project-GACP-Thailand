import type { VarietyRow } from '../steps/step4-variety-purpose-config';

import type {
    ApplicantData,
    CertificationPurpose,
    CultivationDetails,
    DocumentUpload,
    FarmData,
    GeneralInfo,
    HarvestData,
    Lot,
    MainCultivationType,
    PlantId,
    PlantTrackingData,
    Plot,
    ProductionData,
    SecurityData,
    ServiceType,
    SiteData,
    SiteType,
    StepDocument,
    WizardSyncStatus,
} from './use-application-flow-store.domain-types';

/** กทล.1 asks three separate questions on its first page; v2 stops folding them. */
export type RequestType = 'NEW' | 'RENEWAL' | 'REPLACEMENT';
/** Asked only for a NEW request — a renewal or a replacement inherits its scope. */
export type CertScope = 'PLANTING' | 'PROCESSING';
/**
 * Who the certificate would belong to. The engine's own vocabulary
 * (requirement-rule-service RULE_DIMENSIONS.holderType), spelled the same here so
 * step 1 can hand it to the requirements lens without a translation table in between
 * — a second spelling is a second place for the law to be applied to the wrong filing.
 *
 * NOT `ApplicantData.applicantType`, which says COMMUNITY where the register says
 * COMMUNITY_ENTERPRISE. That older field stays where it is; this is the one the
 * server is asked with.
 */
export type ApplicantHolderType = 'INDIVIDUAL' | 'JURISTIC' | 'COMMUNITY_ENTERPRISE';

export interface WizardState {
    currentStep: number;
    plantId: PlantId | null;
    /** v2 step 1. `serviceType` below is the v1 spelling, kept while drafts drain. */
    requestType: RequestType | null;
    certScope: CertScope | null;
    applicantType: ApplicantHolderType | null;
    /** Required when requestType is RENEWAL or REPLACEMENT — there is a certificate to name. */
    previousCertificateNumber: string | null;
    /**
     * v2 step 4 — พันธุ์และวัตถุประสงค์.
     *
     * DECLARED 2026-09-06. The step wrote these three through
     * `updateState({ [key]: value } as never)`, so they existed in the store at runtime and
     * NOT in this type. The cast is what hid them: every list built from this interface —
     * the autosave payload, the server's writable-key allow-list, and the drift test that
     * compares the two — was blind to them, and a filing's varieties never reached the
     * database. The same cast shape had already cost this file once (`previousCertNumber`,
     * see use-auto-save.ts). A field the wizard writes belongs here.
     */
    varieties: VarietyRow[];
    /** พันธุ์ที่เกินสองแถวที่ฟอร์มพิมพ์ได้ — ไม่ทิ้ง แต่พิมพ์เป็นหมายเหตุใต้ตาราง */
    varietiesNote: string | null;
    /** ข้อมูลการแปรรูป ถามเมื่อ certScope = PROCESSING */
    processing: Record<string, unknown> | null;
    serviceType: ServiceType | null;
    serviceTypes: ServiceType[]; // Multi-service support
    certificationPurposes: CertificationPurpose[];
    siteTypes: SiteType[];
    licensePdfUrl: string | null;
    consentedPDPA: boolean;
    acknowledgedStandards: boolean;
    applicantData: ApplicantData | null;
    siteData: SiteData | null;
    productionData: ProductionData | null;
    harvestData: HarvestData | null;
    securityData: SecurityData | null;
    documents: DocumentUpload[];
    youtubeUrl?: string;
    locationType: SiteType | null;
    generalInfo: GeneralInfo | null;
    applicationId?: string;
    syncStatus: WizardSyncStatus;
    /**
     * O1 (2026-09-30) — bookkeeping, not an answer: bumped every time the store is
     * LOADED (IndexedDB rehydrate, server draft, the edit page) rather than edited.
     * The autosave takes whatever a new epoch carries as its baseline, so opening a
     * draft never counts as a change. Hash-exempt and never sent.
     */
    hydrationEpoch?: number;
    /**
     * Round 2 (2026-10-02) — bookkeeping, not an answer, never persisted: true while the
     * step page's resume fetch (GET /applications/draft) is in flight. The autosave holds
     * every save until it is false, so a near-empty store is never POSTed over the real
     * draft before that draft has loaded.
     */
    resumePending?: boolean;
    /**
     * Round 5b — bookkeeping, not an answer: the user id these answers belong to, stamped
     * from the signed-in user when the wizard first holds answers, persisted with them.
     * A sign-in by anyone else empties the wizard (lib/wizard-session claimWizardFor); an
     * expiry does not. Hash-exempt and never sent.
     */
    ownerUserId?: string;
    createdAt?: string;
    updatedAt?: string;
    // [NEW] V4 Fields for 9-step redesign
    cultivationMethods: MainCultivationType[];
    cultivationDetails: CultivationDetails | null;
    stepDocuments: StepDocument[];
    plantTracking: PlantTrackingData[];
    qrCount: number;
    estimatedQRCost: number;
    // [NEW] Farm-Plot-Lot structure
    farmData: FarmData | null;
    plots: Plot[];
    lots: Lot[];
    // [NEW] Quote Data
    milestone1?: {
        dtamQuote: { number: string; amount: number; accepted: boolean };
        platformQuote?: { number: string; amount: number; accepted: boolean };
    };
}

export interface WizardActions {
    // State update actions
    updateState: (updates: Partial<WizardState>) => void;
    /** Load a saved draft into the store: the same write as updateState, marked as a load (O1). */
    hydrateDraft: (updates: Partial<WizardState>) => void;
    /** Mark what the store holds now as loaded, not edited (O1) — the IndexedDB rehydrate. */
    markHydrated: () => void;
    /** Round 2: raise/lower the autosave hold around the resume fetch. */
    setResumePending: (pending: boolean) => void;
    setPlant: (plantId: PlantId) => void;
    setServiceType: (serviceType: ServiceType) => void;
    setServiceTypes: (serviceTypes: ServiceType[]) => void; // Multi-service
    setCertificationPurposes: (purposes: CertificationPurpose[]) => void;
    setSiteTypes: (siteTypes: SiteType[]) => void;
    setLicensePdfUrl: (url: string | null) => void;
    setApplicantData: (applicantData: ApplicantData) => void;
    setSiteData: (siteData: SiteData) => void;
    setProductionData: (productionData: ProductionData) => void;
    setHarvestData: (harvestData: HarvestData) => void;
    setSecurityData: (securityData: SecurityData) => void;
    setDocuments: (documents: DocumentUpload[]) => void;
    setLocationType: (locationType: SiteType) => void;
    setYoutubeUrl: (youtubeUrl: string) => void;
    setGeneralInfo: (generalInfo: GeneralInfo) => void;
    setCurrentStep: (step: number) => void;
    consentPDPA: () => void;
    acknowledgeStandards: () => void;
    resetWizard: () => void;
    /** Round 5: forget the application id the server refused; keep the answers, mark them unsent. */
    detachApplication: () => void;
    setApplicationId: (applicationId: string) => void;
    setSyncStatus: (status: WizardSyncStatus) => void;
    // [NEW] Farm-Plot-Lot actions
    setFarmData: (farmData: FarmData) => void;
    setPlots: (plots: Plot[]) => void;
    setLots: (lots: Lot[]) => void;
    addPlot: (plot: Plot) => void;
    removePlot: (plotId: string) => void;
    addLot: (lot: Lot) => void;
    removeLot: (lotId: string) => void;
    setCultivationMethods: (methods: MainCultivationType[]) => void;
}
