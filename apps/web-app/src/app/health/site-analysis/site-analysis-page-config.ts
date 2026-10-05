export interface SiteAnalysis {
    id: string;
    farmId: string;
    analysisDate: string;
    analysisType: string;
    previousLandUse?: string;
    yearsOfHistory?: number;
    hasChemicalHistory: boolean;
    soilPH?: number;
    soilOrganic?: number;
    soilReportUrl?: string;
    waterPH?: number;
    waterEC?: number;
    waterReportUrl?: string;
    bufferZoneMeters?: number;
    riskLevel?: string;
    passedCriteria: boolean;
    farm?: { farmName: string };
}

export interface Farm {
    id: string;
    farmName: string;
    province: string;
}

export const ANALYSIS_TYPES = [
    { value: "INITIAL", label: "การประเมินครั้งแรก" },
    { value: "ANNUAL", label: "การประเมินประจำปี" },
    { value: "FOLLOW_UP", label: "การประเมินติดตาม" },
];

export const RISK_LEVELS = [
    { value: "LOW", label: "ต่ำ", color: "green" },
    { value: "MEDIUM", label: "ปานกลาง", color: "yellow" },
    { value: "HIGH", label: "สูง", color: "red" },
];

export function createDefaultSiteAnalysisFormData() {
    return {
        analysisType: "INITIAL",
        analysisDate: new Date(),
        previousLandUse: "",
        yearsOfHistory: 0,
        hasChemicalHistory: false,
        chemicalDetails: "",
        soilPH: 0,
        soilOrganic: 0,
        soilReportUrl: "",
        waterPH: 0,
        waterEC: 0,
        waterReportUrl: "",
        bufferZoneMeters: 0,
        nearbyPollution: "",
        floodRisk: "",
        riskLevel: "LOW",
        riskDetails: "",
        notes: "",
    };
}
