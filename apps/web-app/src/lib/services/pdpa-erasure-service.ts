/**
 * PdpaErasureService — frontend wrapper for the
 * 2-step PDPA ม.32 erasure HTTP surface.
 *
 * Backend contract (apps/backend/routes/api/pdpa/erasure.js):
 *   POST   /api/pdpa/erasure/request       — { reason? } → { requestId, expiresAt, _testToken? }
 *   POST   /api/pdpa/erasure/confirm       — { requestId, token } → executeErasure summary
 *   POST   /api/pdpa/erasure/:id/cancel    — () → { ok, requestId, status }
 *
 * Envelope-tolerant: every method returns the apiClient ApiResponse
 * envelope on BOTH success and failure (never throws). Mirrors the
 * pattern set by AdminService.listCertificates so the calling view
 * can branch on `res.success` without try/catch.
 */

import { apiClient, type ApiResponse } from '@/lib/api/api-client';

/**
 * Shape returned by POST /api/pdpa/erasure/request on the 202-Accepted
 * happy path. `_testToken` is present ONLY when the backend runs with
 * NODE_ENV=test (E2E escape hatch); production responses never include
 * the token — it is delivered via email.
 */
export interface RequestErasureResponse {
    requestId: string;
    expiresAt: string;
    _testToken?: string;
}

/**
 * The executeErasure summary shape (pdpa-erasure-service.js:504-524).
 * Returned by POST /api/pdpa/erasure/confirm on success.
 */
export interface ErasureSummary {
    ok: boolean;
    userId: string;
    executedAt: string;
    anonymized: {
        user: boolean;
        applications: number;
        certificates: number;
    };
    erased: {
        applicationDrafts: number;
        notifications: number;
    };
    preserved: string[];
}

export interface CancelErasureResponse {
    ok: boolean;
    requestId: string;
    status: string;
}

export const PdpaErasureService = {
    /**
     * Step 1 — submit a new erasure request.
     *
     * The token is NOT in the HTTP response body (production). The
     * server side dispatches the confirmation link through the email
     * fanout channel — the UI surfaces only `requestId` + `expiresAt`
     * to the data subject.
     */
    async requestErasure(
        params: { reason?: string } = {},
    ): Promise<ApiResponse<RequestErasureResponse>> {
        const body: { reason?: string } = {};
        if (typeof params.reason === 'string' && params.reason.trim().length > 0) {
            body.reason = params.reason;
        }
        return apiClient.post<RequestErasureResponse>(
            '/api/pdpa/erasure/request',
            body,
        );
    },

    /**
     * Step 2 — confirm the request using the requestId + token pair
     * that arrived via email. The backend validates the token in
     * constant time and executes the erasure inside a single
     * transaction; the response is the executeErasure summary.
     */
    async confirmErasure(
        params: { requestId: string; token: string },
    ): Promise<ApiResponse<ErasureSummary>> {
        return apiClient.post<ErasureSummary>(
            '/api/pdpa/erasure/confirm',
            { requestId: params.requestId, token: params.token },
        );
    },

    /**
     * Cancel a pending erasure request before the confirmation window
     * closes. The token is stripped from the persisted envelope when
     * the backend records the cancellation.
     */
    async cancelErasure(
        requestId: string,
    ): Promise<ApiResponse<CancelErasureResponse>> {
        return apiClient.post<CancelErasureResponse>(
            `/api/pdpa/erasure/${encodeURIComponent(requestId)}/cancel`,
        );
    },
};
