import type { ApplicationData } from "./print-page-config";

export interface ProviderApplicationResponse {
    success?: boolean;
    data?: ApplicationData;
}

export interface PlotItem {
    id?: string;
    name?: string;
    areaSize?: number | string;
    areaUnit?: string;
    solarSystem?: string;
}

export interface ApplicantData extends Record<string, unknown> {
    applicantType?: 'INDIVIDUAL' | 'JURISTIC' | 'COMMUNITY' | string;
    firstName?: string;
    lastName?: string;
    idCard?: string;
    address?: string;
    province?: string;
    district?: string;
    subdistrict?: string;
    postalCode?: string;
    phone?: string;
    email?: string;
    lineId?: string;
    communityName?: string;
    communityRegNumber?: string;
    registrationTVC3?: string;
    communityRegDate?: string;
    communityAddress?: string;
    memberCount?: number | string;
    presidentName?: string;
    presidentIdCard?: string;
    presidentPhone?: string;
    companyName?: string;
    companyType?: string;
    registrationNumber?: string;
    taxId?: string;
    registeredCapital?: string | number;
    companyAddress?: string;
    companyPhone?: string;
    directorName?: string;
    directorPosition?: string;
    directorIdCard?: string;
    directorPhone?: string;
    directorEmail?: string;
    contactName?: string;
    coordinatorName?: string;
    contactPhone?: string;
    coordinatorPhone?: string;
    contactEmail?: string;
    coordinatorLineId?: string;
}

export interface FarmData extends Record<string, unknown> {
    farmName?: string;
    address?: string;
    farmAddress?: string;
    subdistrict?: string;
    subDistrict?: string;
    district?: string;
    province?: string;
    postalCode?: string;
    gpsLat?: string | number;
    gpsLng?: string | number;
    totalAreaSize?: string | number;
    totalAreaUnit?: string;
    landOwnership?: 'OWN' | 'RENT' | 'CONSENT' | string;
    waterSource?: string;
    electricitySource?: string;
    soilType?: string;
    soilPH?: string | number;
    hasFence?: boolean;
    hasCCTV?: boolean;
    hasAccessControl?: boolean;
    hasWarningSign?: boolean;
}

export interface ProductionData extends Record<string, unknown> {
    plantParts?: string[] | string;
    propagationType?: string | string[];
    varietyName?: string;
    seedSource?: string;
    sourceType?: string;
    cultivationArea?: string | number;
    spacing?: string;
    plantCount?: string | number;
    estimatedYield?: string | number;
}

export interface HarvestData extends Record<string, unknown> {
    harvestMethod?: string;
    dryingMethod?: string;
    dryingDetail?: string;
    storageSystem?: string;
    packaging?: string;
}

export interface PrintFormData extends Record<string, unknown> {
    applicantData?: ApplicantData;
    farmData?: FarmData;
    productionData?: ProductionData;
    harvestData?: HarvestData;
    plots?: PlotItem[];
    documents?: Record<string, unknown>;
    uploadedDocs?: Record<string, unknown>;
    plantName?: string;
    plantId?: string;
    scientificName?: string;
    plantPart?: string;
    usedPart?: string;
    purpose?: string;
    usePurpose?: string;
    harvestMethod?: string;
    dryingMethod?: string;
    dryingDetail?: string;
    storageSystem?: string;
    storageMethod?: string;
    packaging?: string;
    packagingMethod?: string;
    youtubeUrl?: string;
    videoLink?: string;
}
