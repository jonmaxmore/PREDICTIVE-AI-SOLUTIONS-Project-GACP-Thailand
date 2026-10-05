/**
 * Interoperability API - Shared Types
 *
 * Canonical type definitions for the public verification portal
 * and interoperability API endpoints (/api/interoperability/v1/*).
 *
 * These types are the single source of truth for:
 * - Certificate verification responses
 * - Revocation feed items
 * - Trust registry entries
 * - Signature verification
 * - Trace events
 */

export type TrustVerificationResponse = {
    success: boolean;
    valid?: boolean;
    trustStatus?: string;
    reason?: string;
    data?: {
        certificateNumber?: string;
        issuedDate?: string | null;
        expiryDate?: string | null;
        revokedAt?: string | null;
        revokedReason?: string | null;
        farm?: {
            name?: string | null;
            province?: string | null;
            district?: string | null;
        };
    };
};

export type RevocationFeedItem = {
    certificateNumber: string;
    revokedAt: string;
    revokedReason: string;
    farmName?: string | null;
    province?: string | null;
    district?: string | null;
};

export type TrustRegistryItem = {
    certificateNumber: string;
    trustStatus: string;
    issuedDate?: string | null;
    expiryDate?: string | null;
    farm?: {
        name?: string | null;
        province?: string | null;
    };
};

export type SignatureVerifyResponse = {
    success: boolean;
    valid?: boolean;
    data?: {
        hash?: string;
        signatureAlgorithm?: string;
    };
};

export type TraceEvent = {
    eventId: string;
    eventType: string;
    occurredAt: string;
    actorType: string;
};

export type TraceEventsResponse = {
    success: boolean;
    data?: {
        entityType: string;
        entityId: string;
        events: TraceEvent[];
    };
};

export const ENTITY_TYPES = ['CERTIFICATE', 'PLANTING_CYCLE', 'HARVEST_BATCH', 'PACKAGING_LOT', 'PLANT_UNIT'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
