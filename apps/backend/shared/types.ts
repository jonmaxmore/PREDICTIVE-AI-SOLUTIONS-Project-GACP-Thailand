/**
 * GACP Backend — Shared Type Definitions
 * These types are used across the backend services for consistency.
 * 
 * Migration Strategy:
 *   1. Start by adding .d.ts files for existing .js modules
 *   2. Gradually convert utility files (.js → .ts)
 *   3. Convert services one at a time
 *   4. Convert routes and controllers last
 */

// ─── User & Authentication ──────────────────────────────────

export interface AuthUser {
    id: string;
    healthId?: string;
    providerId?: string;
    role: 'HEALTH' | 'PROVIDER' | 'ADMIN' | 'AUDITOR' | 'SCHEDULER';
    email?: string;
    firstName?: string;
    lastName?: string;
}

export interface JwtPayload {
    userId: string;
    role: string;
    healthId?: string;
    providerId?: string;
    iat: number;
    exp: number;
}

// ─── Application & Workflow ─────────────────────────────────

export type ApplicationStatus =
    | 'DRAFT'
    | 'SUBMITTED'
    | 'UNDER_REVIEW'
    | 'REVISION_REQUESTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'FIELD_AUDIT'
    | 'CERTIFIED';

export type PaymentPhase = 'PHASE_1' | 'PHASE_2';
export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';

export interface WorkflowEvent {
    timestamp: string;
    action: string;
    fromStatus: ApplicationStatus | null;
    toStatus: ApplicationStatus | null;
    metadata?: Record<string, unknown>;
}

// ─── API Response ───────────────────────────────────────────

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    message?: string;
    messageTh?: string;
    error?: string;
    pagination?: PaginationMeta;
}

export interface PaginationMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// ─── Payment ────────────────────────────────────────────────

export interface Invoice {
    id: string;
    invoiceNumber: string;
    applicationId: string;
    serviceType: PaymentPhase;
    status: PaymentStatus;
    totalAmount: number;
    paidAt?: Date;
    receiptNumber?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface PhaseSettlement {
    phasePaid: boolean;
    state?: { invoice?: { paidAt?: Date } };
    platform?: { invoice?: { paidAt?: Date } };
}

// ─── Farm & Planting ────────────────────────────────────────

export interface Farm {
    id: string;
    healthId: string;
    name: string;
    areaRai: number;
    latitude?: number;
    longitude?: number;
    status: 'ACTIVE' | 'INACTIVE';
}

export interface PlantingCycle {
    id: string;
    farmId: string;
    plantName: string;
    plantNameTh: string;
    startDate: Date;
    endDate?: Date;
    status: 'PLANNING' | 'PLANTING' | 'GROWING' | 'HARVESTED';
    plotCount: number;
    totalPlants: number;
}

// ─── Audit ──────────────────────────────────────────────────

export interface AuditLogEntry {
    id: string;
    category: string;
    action: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    actorId: string;
    actorType: 'USER' | 'SERVICE' | 'SYSTEM';
    resourceType: string;
    resourceId: string;
    ipAddress: string;
    result: 'SUCCESS' | 'FAILURE';
    metadata?: Record<string, unknown>;
    createdAt: Date;
}

// ─── Config ─────────────────────────────────────────────────

/**
 * PaymentConfig
 *
 * NOTE (2026-04-28, billing follow-ups): the rate fields below describe the
 * per-scope STATE (government) fee rate, NOT the full Application.phase{1,2}
 * Amount column value. Per the canonical-billing-amount fix, the column is
 * canonically the FULL phase total — call feeService.calculatePhase1Fee().total
 * for that.
 */
export interface PaymentConfig {
    phase1StateRatePerScope: number;
    phase2StateRatePerScope: number;
    invoiceExpiryMinutes: number;
    gateway: {
        publicKey?: string;
        secretKey?: string;
        webhookSecret?: string;
    };
}
