/**
 * Audit Form Data Types
 *
 * TypeScript interfaces for the `formData.auditExecution` structure
 * used in the audit session endpoints and field tools components.
 *
 * These types correspond to the data persisted by:
 * - POST /session/checkin  → GPSCheckInData
 * - POST /session/evidence → EvidencePhoto
 * - POST /session/notes    → (liveNotes, durationSeconds)
 * - GET  /session          → AuditExecution
 */

/** GPS check-in data from the GPSCheckIn component */
export interface GPSCheckInData {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  withinRadius: boolean;
  distanceMeters: number | null;
  checkedInAt: string; // ISO 8601
  checkedInBy: string; // User ID
}

/** Evidence photo metadata from the AuditCamera component */
export interface EvidencePhoto {
  id: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  capturedAt: string; // ISO 8601
  applicationId: string;
  originalSize: number | null;
  watermarkedSize: number | null;
  uploadedBy: string; // User ID
  uploadedAt: string; // ISO 8601
}

/** Full audit execution state stored in formData.auditExecution */
export interface AuditExecution {
  gpsCheckIn?: GPSCheckInData;
  evidencePhotos?: EvidencePhoto[];
  liveNotes?: string;
  durationSeconds?: number;
  durationFormatted?: string; // "HH:MM:SS"
  sessionType?: 'ONLINE' | 'ONSITE';
  lastSavedAt?: string; // ISO 8601
  lastSavedBy?: string; // User ID
}

/** Workflow state enum (17 canonical states) */
export type WorkflowState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PENDING_DOC_FEE'
  | 'DOC_FEE_PAID'
  | 'ASSIGNED_FOR_REVIEW'
  | 'REVISION_REQUESTED'
  | 'DOC_APPROVED'
  | 'PENDING_AUDIT_FEE'
  | 'AUDIT_FEE_PAID'
  | 'AUDIT_CONFIRMED'
  | 'CAR_PENDING'
  | 'CAR_REVIEWING'
  | 'AUDIT_PASSED'
  | 'APPROVED'
  | 'CERTIFIED'
  | 'REJECTED'
  | 'EXPIRED';

/** Top-level form data stored in Application.formData JSON column */
export interface ApplicationFormData {
  // Workflow
  workflowState?: WorkflowState;
  workflowStateUpdatedAt?: string;

  // Location (used by GPS check-in for distance calculation)
  locationLat?: number;
  locationLng?: number;

  // Audit execution data
  auditExecution?: AuditExecution;

  // Wizard step data (dynamic keys per step)
  [key: string]: unknown;
}
