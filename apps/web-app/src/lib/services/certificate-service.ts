/**
 * CertificateService — applicant-facing certificate operations.
 *
 * Iter 23 introduces the certificate detail page at
 * `/health/certificates/[id]`. The bulk-list endpoint
 * (`/api/certificates/my`) already lives in client-view.tsx; this
 * service module focuses on the single-cert detail + download flow.
 *
 * Endpoints assumed (mirroring the existing `/api/certificates/*` shape):
 *   GET  /api/certificates/:id            single cert (applicant's own)
 *   GET  /api/certificates/:id/download   PDF binary
 *   GET  /api/health/certificates/:id/pdf  legacy alias (some callers)
 *
 * The download helper uses the same blob-stream pattern as
 * `PaymentService.downloadInvoicePdf` so the network/auth path is
 * identical (token header + credentials).
 */

import { api } from '../api/api-client';
import { AuthService } from './auth-service';
import { DEFAULT_PUBLIC_HOST, buildPublicVerifyPageUrl } from '@/lib/verify/public-verify-url';

export type CertificateStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'SUSPENDED';

export interface CertificateDetail {
    id: string;
    certificateNumber: string;
    applicationId?: string | null;
    farmId?: string | null;
    siteName?: string | null;
    plantType?: string | null;
    issuedDate: string;
    expiryDate: string;
    status: CertificateStatus | string;
    qrCode?: string | null;
    qrPayload?: string | null;
    verifyUrl?: string | null;
    farm?: {
        name?: string;
        type?: string;
        province?: string;
        district?: string;
        subDistrict?: string;
        location?: string;
        totalArea?: number | null;
        areaUnit?: string;
    } | null;
    crops?: string[];
    audit?: {
        score?: number | null;
        auditorName?: string | null;
        lastAuditDate?: string | null;
    } | null;
}

/**
 * Public verify-URL builder. The certificate detail page shows this URL
 * underneath the QR so applicants can copy/share it. The domain is
 * environment-driven — production points at gacpth.com, staging
 * uses the preview origin, dev falls back to localhost.
 *
 * NOTE: only NEXT_PUBLIC_* env vars are visible in the browser bundle,
 * so we read both that and the runtime `window.location.origin` as a
 * defensive fallback (deploy preview URLs etc.).
 */
function getVerifyBase(): string {
    const fromEnv =
        process.env.NEXT_PUBLIC_GACP_VERIFY_BASE
        || process.env.NEXT_PUBLIC_PUBLIC_VERIFY_BASE
        || '';
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    if (typeof window !== 'undefined' && window.location?.origin) {
        return window.location.origin.replace(/\/+$/, '');
    }
    // Browser origin is inherently trustworthy (can't be spoofed the way a
    // request header can), so no allowlist is needed here — only the
    // server-rendered verify page (which derives its origin from request
    // headers) needs `resolvePublicOrigin`'s allowlist. Same fallback
    // constant as that path, though, so the two never drift apart.
    return DEFAULT_PUBLIC_HOST;
}

export const CertificateService = {
    /**
     * Fetch a single certificate. The applicant-scope is enforced
     * server-side; an applicant requesting somebody else's id gets a
     * 403 which our api-client normalises to a friendly error.
     */
    async getCertificateById(id: string) {
        if (!id) {
            return { success: false, error: 'INVALID_CERTIFICATE_ID' };
        }
        // Try /api/certificates/:id first; if backend prefers nested
        // /api/health/certificates/:id we fall through on 404.
        const primary = await api.get<CertificateDetail>(
            `/certificates/${encodeURIComponent(id)}`,
        );
        if (primary.success && primary.data) return primary;
        const secondary = await api.get<CertificateDetail>(
            `/health/certificates/${encodeURIComponent(id)}`,
        );
        return secondary;
    },

    /**
     * Returns the download URL for embedding in an <a download> or a
     * window.open(). The caller should NOT use this for fetch() — use
     * `downloadCertificatePdf` instead, which streams via the same
     * auth-bearing api-client.
     */
    getCertificatePdfUrl(id: string): string {
        return `/api/certificates/${encodeURIComponent(id)}/download`;
    },

    /**
     * Build the public verify URL for a given certificate number.
     * Used by the share/copy-link button on the detail page. Format
     * matches the QR-payload the backend stamps into the printed PDF.
     */
    getCertificateVerifyUrl(certNumber: string): string {
        return buildPublicVerifyPageUrl(getVerifyBase(), certNumber);
    },

    /**
     * Streamed download via the api-client's blob path (auth header +
     * cookie). Triggers a browser save-as with the cert number as the
     * filename. Returns true on success, false otherwise — the caller
     * is responsible for surfacing toast UI.
     */
    async downloadCertificatePdf(
        id: string,
        certNumber: string,
    ): Promise<boolean> {
        if (!id || !certNumber) return false;
        try {
            const token = AuthService.getToken();
            const res = await fetch(
                `/api/certificates/${encodeURIComponent(id)}/download`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                    credentials: 'include',
                },
            );
            if (!res.ok) return false;
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${certNumber}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            return true;
        } catch {
            return false;
        }
    },
};

export default CertificateService;
