
import { apiClient } from '@/lib/api/api-client';

export interface Plant {
    id: string;
    name: string;
    productionInputs: Record<string, unknown>;
    sortOrder: number;
    isActive: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface SystemConfig {
    key: string;
    value: string;
    type: string;
    description?: string;
    updatedAt?: string;
}

/**
 * Cross-tenant certificate row shape returned by
 * `GET /api/certificates/` when the caller has a provider role
 * (see apps/backend/routes/api/certificates/certificates.js:41-66
 * — the route delegates to certificate-service.listCertificates).
 *
 * Used by /admin/certificates (R3-C) to render the full roster.
 */
export interface CertificateRow {
    id: string;
    certificateNumber: string;
    applicationId: string;
    farmName: string;
    cropType: string;
    status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | string;
    issuedDate: string;
    expiryDate: string;
}

/**
 * Cross-tenant certificate DETAIL shape returned by
 * `GET /api/certificates/:id` when the caller has a provider role
 * (see apps/backend/routes/api/certificates/certificates.js — the
 * `GET /:id` route delegates to `certificateService.findById` which
 * returns the full Certificate row including revocation columns).
 *
 * Used by /admin/certificates/[id] (R7-A) to render the detail page.
 * Optional fields cover both the active and revoked sub-shapes — the
 * backend always returns all columns, but TS callers may receive a
 * partial when the API gateway projects fewer columns.
 */
export interface CertificateDetail extends CertificateRow {
    province?: string | null;
    district?: string | null;
    subDistrict?: string | null;
    address?: string | null;
    standardName?: string | null;
    score?: number | null;
    validityYears?: number | null;
    revokedAt?: string | null;
    revokedReason?: string | null;
    revokedBy?: string | null;
    issuedBy?: string | null;
    verificationCode?: string | null;
    /** F-G4-47: the linked application, selected by the `/:id` route. */
    application?: { id: string; applicationNumber?: string | null } | null;
    /** F-G4-47: `issuedBy` resolved to a display identity (provider branch only). */
    issuer?: StaffIdentity | null;
    /** F-G4-47: `revokedBy` resolved to a display identity (provider branch only). */
    revoker?: StaffIdentity | null;
    /**
     * Certificate revision (ฉบับแก้ไขภายใต้เลขเดิม): 1 for the original
     * document; n > 1 means n - 1 revisions were issued under this number.
     */
    revisionNo?: number;
    /** When the latest revision was issued; null at revision 1. */
    revisedAt?: string | null;
    /** reasonCode of the latest revision (e.g. SYSTEM_DATA_CORRECTION); null at revision 1. */
    revisionReason?: string | null;
}

/**
 * The register fields a revision may correct, in display order: the plant
 * (from the species register — F-G4-58) first, then the four location
 * fields (from the Farm row).
 */
export const CERTIFICATE_REVISION_FIELDS = [
    { key: 'cropType', label: 'พืชสมุนไพร' },
    { key: 'province', label: 'จังหวัด' },
    { key: 'district', label: 'อำเภอ' },
    { key: 'subDistrict', label: 'ตำบล' },
    { key: 'address', label: 'ที่อยู่' },
] as const;

export type CertificateRevisionField = (typeof CERTIFICATE_REVISION_FIELDS)[number]['key'];

/** The Farm-row subset of CertificateRevisionField. */
export type CertificateRevisionLocationField = Exclude<CertificateRevisionField, 'cropType'>;

/**
 * Register facts as the preview endpoint reports them (null = blank on
 * the row). `cropType` is optional because `isRevisionPreview` verifies
 * the envelope, not each field: a door that does not send the plant must
 * not be typed as if it did.
 */
export type CertificateRevisionFacts = Record<CertificateRevisionLocationField, string | null> & {
    cropType?: string | null;
};

/**
 * Body of `GET /api/admin/certificates/:id/revise-location/preview`:
 * what the certificate says now, what the source records say (Farm row
 * + species register), and which of the fields differ. `changed: []`
 * means there is nothing to revise.
 */
export interface CertificateRevisionPreview {
    current: CertificateRevisionFacts;
    corrected: CertificateRevisionFacts;
    changed: string[];
}

/** Row returned by `POST /api/admin/certificates/:id/revise-location` on 200. */
export interface RevisedCertificate {
    id: string;
    certificateNumber: string;
    revisionNo: number;
    revisedAt: string;
    correctedFields: string[];
}

export type CertificateRevisionPreviewResult =
    | { ok: true; data: CertificateRevisionPreview }
    | { ok: false; error: string; message: string };

export type ReviseCertificateResult =
    | { ok: true; data: RevisedCertificate }
    | { ok: false; error: string; message: string };

/**
 * Thai label for a revision reasonCode. Mirrors
 * certificateService.REVISION_REASON_LABELS_TH on the backend; the code
 * itself never reaches the screen.
 */
export const CERTIFICATE_REVISION_REASON_LABELS_TH: Record<string, string> = {
    SYSTEM_DATA_CORRECTION: 'แก้ไขข้อมูลบนใบรับรองให้ตรงกับบันทึกต้นทาง (ความผิดพลาดของระบบ)',
};

export function certificateRevisionReasonLabel(code: string | null | undefined): string {
    if (!code) return '-';
    return CERTIFICATE_REVISION_REASON_LABELS_TH[code] || 'แก้ไขข้อมูลบนใบรับรอง';
}

/**
 * A staff member as `GET /api/certificates/:id` resolves them inside the
 * caller's own tenant: the User id the row stores plus the display name,
 * or `displayName: null` when the lookup could not match.
 */
export interface StaffIdentity {
    id: string;
    displayName: string | null;
}

/**
 * Row returned by `POST /api/admin/certificates/:id/revoke` on 200
 * (`{ success: true, data: {...} }`). `status` is the lowercase
 * `'revoked'` the door emits, not the uppercase enum of the read routes.
 */
export interface RevokedCertificate {
    id: string;
    certificateNumber: string;
    status: 'revoked' | string;
    revokedAt: string;
    revokedBy: string;
    revokedReason: string;
}

/**
 * Outcome of `AdminService.revokeCertificate`. Never a thrown error: the
 * UI needs `error` (machine code) to branch and `message` (Thai, names
 * the cause + the next action) to show.
 */
export type RevokeCertificateResult =
    | { ok: true; data: RevokedCertificate }
    | { ok: false; error: string; message: string };

/** Backend max length for the revocation reason (REVOCATION_REASON_TOO_LONG). */
export const REVOCATION_REASON_MAX_LENGTH = 500;
/** Backend max length for the revision reason (REVISION_REASON_TOO_LONG). */
export const REVISION_REASON_MAX_LENGTH = 500;

/**
 * ONE Thai vocabulary for every code the admin certificate doors emit
 * (revoke + revise-location). Each entry names the cause and the next
 * action; the machine code itself never reaches the screen.
 */
export const CERTIFICATE_ACTION_MESSAGES = {
    REVOCATION_REASON_REQUIRED: 'กรุณาระบุเหตุผลการเพิกถอนก่อนกดยืนยัน',
    REVOCATION_REASON_TOO_LONG: `เหตุผลการเพิกถอนยาวเกิน ${REVOCATION_REASON_MAX_LENGTH} ตัวอักษร กรุณาย่อข้อความแล้วลองอีกครั้ง`,
    CERTIFICATE_ALREADY_REVOKED: 'ใบรับรองนี้ถูกเพิกถอนไปแล้ว รีเฟรชหน้าจอเพื่อดูสถานะล่าสุด',
    CERTIFICATE_NOT_FOUND: 'ไม่พบใบรับรองนี้ หรือถูกลบจากระบบแล้ว กลับไปหน้ารายการเพื่อตรวจสอบอีกครั้ง',
    INVALID_REVOCATION_REQUEST: 'คำขอเพิกถอนไม่ถูกต้อง ตรวจสอบเหตุผลที่คุณกรอกแล้วลองอีกครั้ง',
    // 500 from the door, and the fallback for any other 5xx (gateway pages
    // carry no code, so the service maps by status).
    CERTIFICATE_REVOKE_FAILED: 'ระบบเพิกถอนใบรับรองไม่สำเร็จในขณะนี้ กรุณาลองอีกครั้งในอีกสักครู่ หากยังไม่สำเร็จ ติดต่อผู้ดูแลระบบ',
    // No HTTP response at all (offline, DNS, timeout). The request may or
    // may not have reached the server, so the copy sends the user to check
    // the status before retrying rather than claiming the revoke failed.
    REQUEST_FAILED: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตของคุณ แล้วรีเฟรชหน้าจอเพื่อดูสถานะใบรับรองก่อนลองอีกครั้ง',
    // Revision door (POST /api/admin/certificates/:id/revise-location and
    // its /preview). Codes are rows in apps/backend/shared/error-codes.js.
    CERTIFICATE_NOT_REVISABLE: 'ออกฉบับแก้ไขได้เฉพาะใบรับรองที่ยังมีผลบังคับใช้เท่านั้น ใบนี้ถูกเพิกถอน ระงับ หรือหมดอายุแล้ว รีเฟรชหน้าจอเพื่อดูสถานะล่าสุด',
    CERTIFICATE_REVISION_NO_CHANGE: 'ข้อมูลที่ตั้งบนใบรับรองตรงกับบันทึกฟาร์มอยู่แล้ว ไม่มีอะไรต้องแก้ไข หากบันทึกฟาร์มผิด กรุณาแก้ไขบันทึกฟาร์มก่อนแล้วลองอีกครั้ง',
    CERTIFICATE_REVISION_CONFLICT: 'มีการออกฉบับแก้ไขของใบรับรองนี้ไปก่อนหน้าแล้ว รีเฟรชหน้าจอเพื่อดูฉบับล่าสุดก่อนดำเนินการอีกครั้ง',
    CERTIFICATE_FARM_LOCATION_MISSING: 'บันทึกฟาร์มยังไม่มีจังหวัด อำเภอ หรือตำบลครบถ้วน จึงออกฉบับแก้ไขไม่ได้ กรุณาเติมที่ตั้งฟาร์มให้ครบก่อนแล้วลองอีกครั้ง',
    // 422 from both the preview and the press (F-G4-58): the plant on the
    // certificate is resolved from the plant register, so an application
    // whose plant the register does not know cannot be revised. Retrying
    // cannot fix it; only editing the application can.
    CERTIFICATE_PLANT_UNKNOWN: 'ชนิดพืชในคำขอไม่อยู่ในทะเบียนพืชของระบบ หรือคำขอไม่ได้ระบุชนิดพืช จึงออกฉบับแก้ไขไม่ได้ ใบรับรองยังไม่ถูกเปลี่ยนแปลง กรุณาแก้ไขคำขอให้เลือกชนิดพืชจากทะเบียนพืชก่อน แล้วเปิดหน้าต่างนี้อีกครั้ง',
    REVISION_REASON_REQUIRED: 'กรุณาระบุเหตุผลการออกฉบับแก้ไขก่อนกดยืนยัน',
    REVISION_REASON_TOO_LONG: `เหตุผลการออกฉบับแก้ไขยาวเกิน ${REVISION_REASON_MAX_LENGTH} ตัวอักษร กรุณาย่อข้อความแล้วลองอีกครั้ง`,
    // 503: the signing key refused before anything was written.
    CERT_SIGNING_UNAVAILABLE: 'ระบบลงลายมือชื่อดิจิทัลไม่พร้อมใช้งานในขณะนี้ ใบรับรองยังไม่ถูกเปลี่ยนแปลง กรุณาลองอีกครั้งในอีกสักครู่ หากยังไม่สำเร็จ ติดต่อผู้ดูแลระบบ',
    // 500 from the revise door, and the fallback for any other 5xx.
    CERTIFICATE_REVISE_FAILED: 'ระบบออกฉบับแก้ไขไม่สำเร็จในขณะนี้ รีเฟรชหน้าจอเพื่อตรวจสอบว่าใบรับรองเปลี่ยนแปลงหรือไม่ แล้วลองอีกครั้งในอีกสักครู่ หากยังไม่สำเร็จ ติดต่อผู้ดูแลระบบ',
} as const satisfies Record<string, string>;

/**
 * Former name of the map, kept so existing imports and tests keep
 * resolving to the SAME object (one vocabulary, two names, no copies).
 */
export const REVOKE_ERROR_MESSAGES = CERTIFICATE_ACTION_MESSAGES;

const REVOKE_UNKNOWN_FAILURE_MESSAGE = 'เพิกถอนใบรับรองไม่สำเร็จ กรุณาลองอีกครั้ง หากยังไม่สำเร็จ ติดต่อผู้ดูแลระบบ';
const REVISE_UNKNOWN_FAILURE_MESSAGE = 'ออกฉบับแก้ไขไม่สำเร็จ รีเฟรชหน้าจอเพื่อดูสถานะใบรับรองแล้วลองอีกครั้ง หากยังไม่สำเร็จ ติดต่อผู้ดูแลระบบ';

const THAI_SCRIPT = /[฀-๿]/;

/** Thai copy for a backend certificate-action error code, or undefined for an unknown code. */
export function certificateActionMessageFor(code: string | null | undefined): string | undefined {
    if (!code) return undefined;
    return (CERTIFICATE_ACTION_MESSAGES as Record<string, string | undefined>)[code];
}

/**
 * Display text for a failed certificate action. Order: the mapped code;
 * any 5xx (gateway pages carry no code); the client's own text, but only
 * when it is Thai (apiClient echoes an unrecognised code verbatim and its
 * network/timeout branch is English); the action's generic Thai fallback.
 */
function certificateActionFailureMessage(
    code: string,
    res: { status?: number; error?: string },
    fallback: { serverError: string; unknown: string },
): string {
    const mapped = certificateActionMessageFor(code);
    if (mapped) return mapped;
    if (res.status !== undefined && res.status >= 500) {
        return fallback.serverError;
    }
    const clientText = (res.error || '').trim();
    if (clientText && clientText !== code && THAI_SCRIPT.test(clientText)) {
        return clientText;
    }
    return fallback.unknown;
}

function revokeFailureMessage(code: string, res: { status?: number; error?: string }): string {
    return certificateActionFailureMessage(code, res, {
        serverError: CERTIFICATE_ACTION_MESSAGES.CERTIFICATE_REVOKE_FAILED,
        unknown: REVOKE_UNKNOWN_FAILURE_MESSAGE,
    });
}

function reviseFailureMessage(code: string, res: { status?: number; error?: string }): string {
    return certificateActionFailureMessage(code, res, {
        serverError: CERTIFICATE_ACTION_MESSAGES.CERTIFICATE_REVISE_FAILED,
        unknown: REVISE_UNKNOWN_FAILURE_MESSAGE,
    });
}

/**
 * apiClient strips one envelope level; a flattening gateway may strip
 * none or two. Returns the inner object when `body` is `{ data: {...} }`
 * and `body.data` passes `isRow`, or `body` itself when it passes.
 */
function unwrapRow<T extends object>(body: unknown, isRow: (v: unknown) => v is T): T | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const wrapped = (body as { data?: unknown }).data;
    if (wrapped && isRow(wrapped)) return wrapped;
    return isRow(body) ? body : undefined;
}

function isRevisionPreview(v: unknown): v is CertificateRevisionPreview {
    if (!v || typeof v !== 'object') return false;
    const o = v as Partial<CertificateRevisionPreview>;
    return typeof o.current === 'object' && o.current !== null
        && typeof o.corrected === 'object' && o.corrected !== null
        && Array.isArray(o.changed);
}

function isRevisedCertificate(v: unknown): v is RevisedCertificate {
    if (!v || typeof v !== 'object') return false;
    const o = v as Partial<RevisedCertificate>;
    return typeof o.id === 'string' && typeof o.revisionNo === 'number';
}

export const AdminService = {
    // --- Plants Management ---
    async getPlants() {
        return await apiClient.get<Plant[]>('/admin/plants');
    },

    async createPlant(data: { name: string; productionInputs: Record<string, unknown> }) {
        return await apiClient.post<Plant>('/admin/plants', data);
    },

    async updatePlant(id: string, data: Partial<Plant>) {
        return await apiClient.patch<Plant>(`/admin/plants/${id}`, data);
    },

    async deletePlant(id: string) {
        return await apiClient.delete<unknown>(`/admin/plants/${id}`);
    },

    // --- System Configuration ---
    async getConfigs() {
        return await apiClient.get<SystemConfig[]>('/admin/config');
    },

    async updateConfig(key: string, value: string) {
        return await apiClient.patch<SystemConfig>(`/admin/config/${key}`, { value });
    },

    // --- Certificates (R3-C) ----------------------------------------
    /**
     * Fetch the cross-tenant certificate roster. The backend route
     * only honors the cross-tenant view when the caller has a provider
     * role — non-provider callers get their own scope, which is OK
     * because the ADMIN page already role-gates client-side.
     *
     * Returns `[]` on any non-success or missing-data response so the
     * UI never has to defensive-null-check the array.
     *
     * NOTE: the backend list endpoint does NOT currently support a
     * `status` query string (verified against certificates.js:41-66),
     * so the client filters in-memory. If row counts grow beyond the
     * 100 default, a server-side `status=` is the next step.
     */
    async listCertificates(params?: { take?: number }): Promise<CertificateRow[]> {
        const url = '/api/certificates/' + (params?.take ? `?take=${params.take}` : '');
        const res = await apiClient.get<CertificateRow[]>(url);
        if (!res.success) return [];
        // apiClient unwraps one envelope level (api-client.ts:410); the list
        // route returns single-level `{ success, count, data: [...] }`
        // (certificates.js:82) — so `res.data` IS the array.
        const inner = res.data;
        return Array.isArray(inner) ? inner : [];
    },

    /**
     * Fetch a single certificate by id for the ADMIN detail page
     * (R7-A). Backend route is gated by `isProviderRole()` and returns
     * the full Certificate row including revocation columns.
     *
     * Returns `null` on any non-success or missing-data response so
     * the UI renders a Thai "not found" callout instead of crashing.
     * The page-level role gate (ADMIN-only) lives in detail-view.tsx
     * and matches the list page convention.
     */
    async getCertificate(id: string): Promise<CertificateDetail | null> {
        if (!id) return null;
        const url = `/api/certificates/${encodeURIComponent(id)}`;
        const res = await apiClient.get<{ data: CertificateDetail } | CertificateDetail>(url);
        if (!res.success) return null;
        // The /:id route wraps the cert in `{ success, data }` — but defensive-
        // check shape so a backend gateway that flattens does not crash the UI.
        const body = res.data as { data?: CertificateDetail } | CertificateDetail | undefined;
        if (!body) return null;
        if (typeof body === 'object' && 'data' in body && body.data) {
            return body.data;
        }
        if (typeof body === 'object' && 'id' in body) {
            return body as CertificateDetail;
        }
        return null;
    },

    /**
     * Revoke a certificate through the ADMIN door
     * `POST /api/admin/certificates/:id/revoke` with `{ reason }`.
     *
     * Contract: 200 → `{ success, data: { id, certificateNumber,
     * status: 'revoked', revokedAt, revokedBy, revokedReason } }`;
     * 400 REVOCATION_REASON_REQUIRED / REVOCATION_REASON_TOO_LONG;
     * 409 CERTIFICATE_ALREADY_REVOKED; 404; every error is
     * `{ success: false, error, message }`.
     *
     * Never throws on an HTTP error. `apiClient` keeps the backend's
     * `error` identifier in `.code` and rewrites `.error` into display
     * text, so `error` here is the code and `message` is Thai copy that
     * names the cause and the next action (known codes are mapped in
     * REVOKE_ERROR_MESSAGES; 5xx and the no-response case map by
     * status; the client's text is used only when it is already Thai).
     */
    async revokeCertificate(id: string, reason: string): Promise<RevokeCertificateResult> {
        if (!id) {
            return {
                ok: false,
                error: 'CERTIFICATE_NOT_FOUND',
                message: REVOKE_ERROR_MESSAGES.CERTIFICATE_NOT_FOUND,
            };
        }
        const url = `/api/admin/certificates/${encodeURIComponent(id)}/revoke`;
        try {
            const res = await apiClient.post<{ data: RevokedCertificate } | RevokedCertificate>(url, { reason });
            if (!res.success) {
                const code = res.code
                    || (res.status === 404 ? 'CERTIFICATE_NOT_FOUND' : undefined)
                    || (res.status === 409 ? 'CERTIFICATE_ALREADY_REVOKED' : undefined)
                    || (res.status ? `HTTP_${res.status}` : 'REQUEST_FAILED');
                return { ok: false, error: code, message: revokeFailureMessage(code, res) };
            }
            // Same defensive unwrap as getCertificate: apiClient strips one
            // envelope level, a flattening gateway may strip none or two.
            const body = res.data as { data?: RevokedCertificate } | RevokedCertificate | undefined;
            const row = body && typeof body === 'object' && 'data' in body && body.data
                ? body.data
                : (body as RevokedCertificate | undefined);
            if (!row || typeof row !== 'object' || !('id' in row)) {
                return {
                    ok: false,
                    error: 'INVALID_RESPONSE',
                    message: 'ระบบตอบกลับไม่ครบถ้วน รีเฟรชหน้าจอเพื่อตรวจสอบสถานะใบรับรองก่อนลองอีกครั้ง',
                };
            }
            return { ok: true, data: row };
        } catch (err) {
            const detail = err instanceof Error ? err.message : '';
            return {
                ok: false,
                error: 'REQUEST_FAILED',
                message: detail
                    ? `เพิกถอนใบรับรองไม่สำเร็จ (${detail}) กรุณาลองอีกครั้ง`
                    : 'เพิกถอนใบรับรองไม่สำเร็จ กรุณาลองอีกครั้ง หากยังไม่สำเร็จ ติดต่อผู้ดูแลระบบ',
            };
        }
    },

    /**
     * Read what a revision WOULD change, without writing:
     * `GET /api/admin/certificates/:id/revise-location/preview`.
     *
     * Contract: 200 → `{ success, data: { current, corrected, changed } }`
     * (`changed: []` when the certificate already matches the source records);
     * 404; 409 CERTIFICATE_NOT_REVISABLE (not `active`);
     * 422 CERTIFICATE_FARM_LOCATION_MISSING / CERTIFICATE_PLANT_UNKNOWN.
     * Never throws; same envelope handling as revokeCertificate.
     */
    async previewCertificateRevision(id: string): Promise<CertificateRevisionPreviewResult> {
        if (!id) {
            return {
                ok: false,
                error: 'CERTIFICATE_NOT_FOUND',
                message: CERTIFICATE_ACTION_MESSAGES.CERTIFICATE_NOT_FOUND,
            };
        }
        const url = `/api/admin/certificates/${encodeURIComponent(id)}/revise-location/preview`;
        try {
            const res = await apiClient.get<{ data: CertificateRevisionPreview } | CertificateRevisionPreview>(url);
            if (!res.success) {
                const code = res.code
                    || (res.status === 404 ? 'CERTIFICATE_NOT_FOUND' : undefined)
                    || (res.status === 409 ? 'CERTIFICATE_NOT_REVISABLE' : undefined)
                    || (res.status === 422 ? 'CERTIFICATE_FARM_LOCATION_MISSING' : undefined)
                    || (res.status ? `HTTP_${res.status}` : 'REQUEST_FAILED');
                return { ok: false, error: code, message: reviseFailureMessage(code, res) };
            }
            const preview = unwrapRow(res.data, isRevisionPreview);
            if (!preview) {
                return {
                    ok: false,
                    error: 'INVALID_RESPONSE',
                    message: 'ระบบตอบกลับไม่ครบถ้วน รีเฟรชหน้าจอแล้วเปิดหน้าต่างนี้อีกครั้ง',
                };
            }
            return { ok: true, data: preview };
        } catch (err) {
            const detail = err instanceof Error ? err.message : '';
            return {
                ok: false,
                error: 'REQUEST_FAILED',
                message: detail
                    ? `อ่านข้อมูลเปรียบเทียบไม่สำเร็จ (${detail}) กรุณาลองอีกครั้ง`
                    : 'อ่านข้อมูลเปรียบเทียบไม่สำเร็จ กรุณาลองอีกครั้ง หากยังไม่สำเร็จ ติดต่อผู้ดูแลระบบ',
            };
        }
    },

    /**
     * Issue a revision under the same certificate number through the ADMIN
     * door `POST /api/admin/certificates/:id/revise-location` with
     * `{ reason }`. The corrected values come from the source records
     * (Farm row + species register) on the server; the admin never sends
     * register values.
     *
     * Contract: 200 → `{ success, data: { id, certificateNumber,
     * revisionNo, revisedAt, correctedFields } }`;
     * 400 REVISION_REASON_REQUIRED / REVISION_REASON_TOO_LONG; 404;
     * 409 CERTIFICATE_NOT_REVISABLE / CERTIFICATE_REVISION_NO_CHANGE /
     * CERTIFICATE_REVISION_CONFLICT; 422 CERTIFICATE_FARM_LOCATION_MISSING /
     * CERTIFICATE_PLANT_UNKNOWN; 503 CERT_SIGNING_UNAVAILABLE. Never throws; `error` is the code and
     * `message` is Thai copy naming the cause and the next action.
     */
    async reviseCertificateLocation(id: string, reason: string): Promise<ReviseCertificateResult> {
        if (!id) {
            return {
                ok: false,
                error: 'CERTIFICATE_NOT_FOUND',
                message: CERTIFICATE_ACTION_MESSAGES.CERTIFICATE_NOT_FOUND,
            };
        }
        const url = `/api/admin/certificates/${encodeURIComponent(id)}/revise-location`;
        try {
            const res = await apiClient.post<{ data: RevisedCertificate } | RevisedCertificate>(url, { reason });
            if (!res.success) {
                // A 409 without a code cannot be told apart (three codes share
                // it); "reload and look again" is the safe next action for all.
                const code = res.code
                    || (res.status === 404 ? 'CERTIFICATE_NOT_FOUND' : undefined)
                    || (res.status === 409 ? 'CERTIFICATE_REVISION_CONFLICT' : undefined)
                    || (res.status === 422 ? 'CERTIFICATE_FARM_LOCATION_MISSING' : undefined)
                    || (res.status === 503 ? 'CERT_SIGNING_UNAVAILABLE' : undefined)
                    || (res.status ? `HTTP_${res.status}` : 'REQUEST_FAILED');
                return { ok: false, error: code, message: reviseFailureMessage(code, res) };
            }
            const row = unwrapRow(res.data, isRevisedCertificate);
            if (!row) {
                return {
                    ok: false,
                    error: 'INVALID_RESPONSE',
                    message: 'ระบบตอบกลับไม่ครบถ้วน รีเฟรชหน้าจอเพื่อตรวจสอบว่าออกฉบับแก้ไขแล้วหรือไม่ ก่อนลองอีกครั้ง',
                };
            }
            return { ok: true, data: row };
        } catch {
            // The request may or may not have reached the server: send the
            // user to check the row before pressing again.
            return {
                ok: false,
                error: 'REQUEST_FAILED',
                message: REVISE_UNKNOWN_FAILURE_MESSAGE,
            };
        }
    },
};
