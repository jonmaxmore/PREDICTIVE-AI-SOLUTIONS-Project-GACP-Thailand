export interface FDAReferral {
    name: string;
    nameEN: string;
    phone: string;
    website: string;
    yellowCardReporting: string;
    address: string;
    scopeNote: string;
    scopeNoteEN: string;
}

export interface SafetyDisclaimer {
    medicalAdvice: string;
    medicalAdviceEN: string;
    notMedicalAdvice: string;
    notMedicalAdviceEN: string;
    consultDoctor: string;
    consultDoctorEN: string;
    reportAdverse: string;
    reportAdverseEN: string;
}

export interface TraceData {
    type: 'PLANTING_CYCLE' | 'HARVEST_BATCH' | 'LOT';
    data: {
        farm: {
            name: string;
            type?: string;
            location: string;
            address?: string;
        };
        plot?: {
            name: string;
            area?: number;
            unit?: string;
        };
        plant: {
            code?: string;
            nameTH: string;
            nameEN?: string;
            scientificName?: string;
            variety?: string;
        };
        cultivation?: {
            method: string;
            methodCode?: string;
            seedSource?: string;
            soilType?: string;
            irrigationType?: string;
            cycleName?: string;
            cycleNumber?: number;
        };
        dates?: {
            planted?: string;
            plantedTH?: string;
            expectedHarvest?: string;
            expectedHarvestTH?: string;
            actualHarvest?: string;
            actualHarvestTH?: string;
        };
        yield?: {
            estimated?: number;
            actual?: number;
            unit?: string;
        };
        status?: string;
        batch?: {
            number?: string;
            batchNumber?: string;
            plantingDate?: string;
            plantingDateTH?: string;
            harvestDate?: string;
            harvestDateTH?: string;
            yield?: number;
            yieldUnit?: string;
            qualityGrade?: string;
            status?: string;
        };
        harvests?: Array<{
            batchNumber: string;
            harvestDate?: string;
            harvestDateTH?: string;
            yield?: number;
            yieldUnit?: string;
            grade?: string;
            status?: string;
        }>;
        lot?: {
            lotNumber: string;
            packageType: string;
            quantity: number;
            unitWeight: number;
            status: string;
            packagedAt: string;
            expiryDate: string;
            // SEC-TRACE-PII-002 / R9 (design note 2026-08-20-planting-tnt-design:
            // 24, 62, 77): the backend now reports existence only, never
            // measured values, the report file, or a pass/fail verdict.
            labTest?: {
                tested: boolean;
            };
        };
        certificate?: {
            number: string;
            standard?: string;
            issuedDate?: string;
            issuedDateTH?: string;
            expiryDate?: string;
            expiryDateTH?: string;
            status?: string;
            isValid: boolean;
        };
        // SEC-TRACE-PII-002 / R9 — see `lot.labTest` above. Existence + the
        // permitted `labName` only; never measured values or a verdict.
        lab_analysis?: {
            tested: boolean;
            labName?: string | null;
        };
        verification: {
            // null/undefined at cycle granularity — the seal lives at the
            // plot/batch/lot level, so a cycle scan carries no seal verdict (M3).
            valid: boolean | null;
            certified?: boolean;
            sealed?: boolean;
            applicable?: boolean;
            scannedAt: string;
            verifiedBy?: string;
        };
        disclaimers?: SafetyDisclaimer;
        referrals?: {
            safety: FDAReferral;
            medicalEmergency: {
                phone: string;
                note: string;
            };
        };
    };
}
