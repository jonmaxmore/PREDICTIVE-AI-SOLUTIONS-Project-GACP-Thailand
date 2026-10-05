/**
 * The payload of GET /api/provider/auditor/applications/:id/decision-file
 * (apps/backend/services/certification-decision-file-service.js). Read only.
 */

export interface DecisionFileDocument {
    slotId: string;
    labelTH: string;
    required: boolean;
    satisfied: boolean;
    fileUrl: string | null;
    fileName: string | null;
    verdict: string | null;
    reviewReason: string | null;
}

export interface DecisionFileChecklistItem {
    itemCode: string;
    section: string;
    prompt: string;
    isCritical: boolean;
    response: string | null;
    notes: string | null;
}

export interface DecisionFilePhoto {
    photoId: string;
    uploadedBy: string | null;
    uploadedAt: string | null;
    capturedAt: string | null;
    fileHash: string;
    gps: { latitude: number | null; longitude: number | null };
    place: { status: string; distanceMeters: number | null; toleranceMeters: number; beyondTolerance: boolean | null };
    time: { capturedAtSource: string; windowSource: string; status: string; offsetSeconds: number | null };
    appearance: { perceptualHash: string | null; algorithm: string | null };
    flags: string[];
    caption: string | null;
    fileUrl: string | null;
    fileName: string | null;
}

export interface DecisionFileGps {
    checkIn: { latitude: number; longitude: number; accuracy: number | null; at: string } | null;
    withinTolerance?: boolean;
    distanceMeters?: number | null;
    farmLatitude?: number | null;
    farmLongitude?: number | null;
    toleranceMeters?: number;
    unknownFarmLocation?: boolean;
}

export interface DecisionFileEvidenceGate {
    sufficient: boolean;
    photoCount?: number;
    itemCount?: number;
    code?: string;
    messageTh?: string;
}

export interface DecisionFileCarDecision {
    decision: string;
    notes: string | null;
    reasonCode: string | null;
    decidedAt: string | null;
    findings: Array<{ nonConformity: string; correctiveAction: string; category: string | null }>;
}

export interface DecisionFile {
    application: {
        id: string;
        applicationNumber: string;
        status: string;
        applicantName: string;
        submittedAt: string | null;
        updatedAt: string | null;
        scheduledDate: string | null;
        farmAddress: string;
        farmLatitude: number | null;
        farmLongitude: number | null;
    };
    documents: DecisionFileDocument[];
    onsite: {
        audit: { id: string } | null;
        checklist: DecisionFileChecklistItem[];
        photos: DecisionFilePhoto[];
        nearDuplicatePairs: Array<{ photoIds: string[]; distanceBits: number; sameFileHash: boolean; algorithm: string }>;
        notRecorded: { place: number; time: number; appearance: number } | null;
        needsAttention: number;
        toleranceMeters?: number;
        gps: DecisionFileGps;
        evidenceGate: DecisionFileEvidenceGate;
    };
    inspectorSummary: {
        inspectorName: string | null;
        decision: string | null;
        notes: string | null;
        reasonCode: string | null;
        decidedAt: string | null;
    };
    carHistory: {
        rounds: Array<{ roundNo: number; decidedAt: string | null; dueAt: string | null }>;
        decisions: DecisionFileCarDecision[];
        applicantDocuments: Array<{ name: string | null; path: string | null; uploadedAt: string | null }>;
    };
}
