// Wizard State Types and Hook - Complete GACP Implementation
import { useState, useCallback } from 'react';

// Plant definitions
export const PLANTS = [
    { id: 'CAN', name: 'กัญชา', group: 'HIGH_CONTROL', icon: '' },
    { id: 'KRA', name: 'กระท่อม', group: 'HIGH_CONTROL', icon: '' },
    { id: 'TUR', name: 'ขมิ้นชัน', group: 'GENERAL', icon: '' },
    { id: 'GIN', name: 'ขิง', group: 'GENERAL', icon: '' },
    { id: 'GAL', name: 'กระชายดำ', group: 'GENERAL', icon: '' },
    { id: 'PLA', name: 'ไพล', group: 'GENERAL', icon: '' },
] as const;

export type PlantId = typeof PLANTS[number]['id'];
export type PlantGroup = 'HIGH_CONTROL' | 'GENERAL';

// Basic types
export type ServiceType = 'NEW' | 'RENEWAL' | 'REPLACEMENT';
export type ApplicantType = 'INDIVIDUAL' | 'JURISTIC' | 'COMMUNITY';
export type LandOwnership = 'OWN' | 'RENT' | 'CONSENT';
export type SourceType = 'SELF' | 'BUY' | 'IMPORT';
export type PropagationType = 'SEED' | 'CUTTING' | 'TISSUE' | 'SEEDLING' | 'OTHER';

// NEW: Step 3 - Certification Types
export type CertificationType = 'PRODUCTION' | 'PROCESSING';
/** สามคำ — 'OTHER' ถูกถอดออก 2026-09-11 (operator) · ประตูยื่นปฏิเสธคำอื่น */
export type AreaType = 'OUTDOOR' | 'GREENHOUSE' | 'INDOOR';
export type PlantPartType = 'SEED' | 'STEM' | 'FLOWER' | 'CUTTING' | 'LEAF' | 'ROOT' | 'OTHER';

// Step 3: Certification Data (NEW!)
export interface CertificationData {
    certificationTypes: CertificationType[];
    areaType: AreaType;
}

// Step 5: Applicant Data (Enhanced)
export interface ApplicantData {
    applicantType: ApplicantType;
    fullName: string;
    idCard: string;
    address: string;
    phone: string;
    email: string;
    lineId: string;
    responsibleName?: string;
    qualification?: string;
    // For HIGH_CONTROL plants
    plantingStatus?: 'NOTIFY' | 'LICENSED';
    licenseNumber?: string;
    licenseType?: 'BHT11' | 'BHT13' | 'BHT16';
}

// Step 6: Production Data (Enhanced)
export interface ProductionData {
    // Plant parts (NEW!)
    plantParts: PlantPartType[];
    plantPartsOther?: string;
    // Propagation methods (multi-select — applicants commonly use more than one)
    propagationType: PropagationType[];
    varietyName: string;
    seedSource: string;
    varietySource: string;
    // Quantity
    treeCount?: number;
    areaSizeRai?: number;
    quantityWithUnit?: string;  // NEW: "100 กก." or "500 ต้น"
    harvestCycles: number;
    estimatedYield: number;
    // Source
    sourceType: SourceType;
    sourceDetail?: string;
    // Certifications
    hasGAPCert: boolean;
    hasOrganicCert: boolean;
}

// Step 7: Site & Security
export interface SiteSecurityData {
    siteName: string;
    siteAddress: string;
    latitude: number;
    longitude: number;
    northBorder?: string;
    southBorder?: string;
    eastBorder?: string;
    westBorder?: string;
    landOwnership: LandOwnership;
    // HIGH_CONTROL security
    hasCCTV?: boolean;
    hasFence2m?: boolean;
    hasAccessLog?: boolean;
    hasBiometric?: boolean;
    // GENERAL security
    hasAnimalFence?: boolean;
    hasZoneSign?: boolean;
}

// Document with metadata
export interface DocumentUpload {
    id: string;
    file?: File;
    url?: string;  // For video links
}

// Complete Wizard State (10 Steps)
export interface WizardState {
    currentStep: number;
    // Step 0
    plantId: PlantId | null;
    plantGroup: PlantGroup | null;
    // Step 1
    acceptedStandards: boolean;
    // Step 2
    serviceType: ServiceType | null;
    // Step 3 (kept for compatibility)
    certificationData: CertificationData | null;
    // Step 4
    consentedPDPA: boolean;
    // Step 5
    applicantData: ApplicantData | null;
    // Step 6
    productionData: ProductionData | null;
    // Step 7
    siteSecurityData: SiteSecurityData | null;
    // Step 8
    documents: DocumentUpload[];
    videoUrl?: string | undefined;
    // Submission result
    applicationId?: string;  // Backend-generated ID
    signature?: string;
}

const initialState: WizardState = {
    currentStep: 0,
    plantId: null,
    plantGroup: null,
    acceptedStandards: false,
    serviceType: null,
    certificationData: null,
    consentedPDPA: false,
    applicantData: null,
    productionData: null,
    siteSecurityData: null,
    documents: [],
    videoUrl: undefined,
};

export function useWizardState() {
    const [state, setState] = useState<WizardState>(initialState);

    const setPlant = useCallback((plantId: PlantId) => {
        const plant = PLANTS.find(p => p.id === plantId);
        setState(prev => ({
            ...prev,
            plantId,
            plantGroup: plant?.group as PlantGroup || null,
        }));
    }, []);

    const setServiceType = useCallback((serviceType: ServiceType) => {
        setState(prev => ({ ...prev, serviceType }));
    }, []);

    const setCertificationData = useCallback((data: CertificationData) => {
        setState(prev => ({ ...prev, certificationData: data }));
    }, []);

    const setAcceptedStandards = useCallback((accepted: boolean) => {
        setState(prev => ({ ...prev, acceptedStandards: accepted }));
    }, []);

    const setConsentedPDPA = useCallback((consented: boolean) => {
        setState(prev => ({ ...prev, consentedPDPA: consented }));
    }, []);

    const setApplicantData = useCallback((data: ApplicantData) => {
        setState(prev => ({ ...prev, applicantData: data }));
    }, []);

    const setProductionData = useCallback((data: ProductionData) => {
        setState(prev => ({ ...prev, productionData: data }));
    }, []);

    const setSiteSecurityData = useCallback((data: SiteSecurityData) => {
        setState(prev => ({ ...prev, siteSecurityData: data }));
    }, []);

    const setDocuments = useCallback((docs: DocumentUpload[]) => {
        setState(prev => ({ ...prev, documents: docs }));
    }, []);

    const setVideoUrl = useCallback((url: string) => {
        setState(prev => ({ ...prev, videoUrl: url }));
    }, []);

    const nextStep = useCallback(() => {
        setState(prev => ({ ...prev, currentStep: prev.currentStep + 1 }));
    }, []);

    const prevStep = useCallback(() => {
        setState(prev => ({ ...prev, currentStep: Math.max(0, prev.currentStep - 1) }));
    }, []);

    const goToStep = useCallback((step: number) => {
        setState(prev => ({ ...prev, currentStep: step }));
    }, []);

    const reset = useCallback(() => {
        setState(initialState);
    }, []);

    const isHighControl = state.plantGroup === 'HIGH_CONTROL';

    return {
        state,
        setPlant,
        setServiceType,
        setCertificationData,
        setAcceptedStandards,
        setConsentedPDPA,
        setApplicantData,
        setProductionData,
        setSiteSecurityData,
        setDocuments,
        setVideoUrl,
        nextStep,
        prevStep,
        goToStep,
        reset,
        isHighControl,
    };
}

export type WizardContext = ReturnType<typeof useWizardState>;

// Resource Links
export const RESOURCE_LINKS = {
    // DATA SOVEREIGNTY (PDPA) — this previously pointed at a third-party
    // US-hosted file-sharing folder. The authoritative blank GACP form
    // templates must be hosted on DTAM infrastructure so that a citizen
    // downloading a form never has their IP and referrer disclosed to a
    // foreign processor. This is a placeholder on our own domain: the
    // template files still need to be published at this path (or served
    // from the backend `/uploads` mount) before it resolves.
    formDownload: 'https://gacpth.com/downloads/gacp-forms',
    sopVideoGuide: 'https://www.youtube.com/watch?v=f9HwetKcUOA',
};

