/**
 * X5-FIX-A / M-9 — StatusOverridePanel canonical endpoint (service-level).
 *
 * X5-A GAP A-4 flagged that /admin/settings StatusOverridePanel was
 * still POSTing to the LEGACY `/provider/admin/status-override`
 * endpoint with the old `{ applicationId, newStatus, reason }` shape,
 * in parallel with the canonical Iter 28
 * `/admin/applications/:id/force-status` endpoint (which expects
 * `{ toStatus, reasonCode, reason }` and validates reason ≥ 10 chars).
 *
 * X5-FIX-A consolidates by removing the legacy POST from the panel
 * and routing the admin to the canonical force-status page. The
 * canonical service surface (AdminB28Service.forceStatus) remains the
 * single mutation site.
 *
 * This file pins the M-9 contract from a different angle than
 * `x5-fix-c-force-status-consolidation.test.ts` (which source-greps the
 * page). Here we prove the canonical service method exists, the
 * payload shape is the Iter 28 form, and the URL the panel routes to
 * matches what the canonical page expects to receive.
 */

import { AdminB28Service, FORCE_STATUS_REASON_CODES } from '@/lib/services/admin-service-b28';
import { apiClient } from '@/lib/api/api-client';

jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
    },
}));

const mockedPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

describe('X5-FIX-A M-9 — canonical force-status endpoint contract', () => {
    beforeEach(() => {
        mockedPost.mockReset();
        mockedPost.mockResolvedValue({ success: true, data: undefined });
    });

    it('forceStatus POSTs to /admin/applications/:id/force-status (canonical)', async () => {
        await AdminB28Service.forceStatus({
            applicationId: 'cm3x7abc',
            toStatus: 'APPROVED',
            reasonCode: 'MANUAL_REVIEW_EXCEPTION',
            reason: 'Audit recovery per ticket #4242',
        });

        expect(mockedPost).toHaveBeenCalledTimes(1);
        const url = mockedPost.mock.calls[0][0] as string;
        expect(url).toBe('/admin/applications/cm3x7abc/force-status');
    });

    it('payload shape is the Iter 28 form { toStatus, reasonCode, reason }', async () => {
        await AdminB28Service.forceStatus({
            applicationId: 'app-1',
            toStatus: 'APPROVED',
            reasonCode: 'DATA_CORRECTION',
            reason: 'แก้ไขข้อมูลที่ผิดพลาด',
        });
        const body = mockedPost.mock.calls[0][1] as Record<string, unknown>;
        expect(body).toEqual({
            toStatus: 'APPROVED',
            reasonCode: 'DATA_CORRECTION',
            reason: 'แก้ไขข้อมูลที่ผิดพลาด',
        });
        // The legacy `newStatus` key is gone — canonical sends `toStatus`.
        expect(body).not.toHaveProperty('newStatus');
        // Legacy `applicationId` body key is gone too — canonical uses the URL.
        expect(body).not.toHaveProperty('applicationId');
    });

    it('reasonCode allow-list contains the 5 Iter 28 codes', () => {
        const codes = FORCE_STATUS_REASON_CODES.map((c) => c.value);
        expect(codes).toContain('DATA_CORRECTION');
        expect(codes).toContain('COMPLIANCE_ESCALATION');
        expect(codes).toContain('LEGAL_ORDER');
        expect(codes).toContain('SYSTEM_RECOVERY');
        expect(codes).toContain('MANUAL_REVIEW_EXCEPTION');
        expect(codes).toHaveLength(5);
    });

    it('NEVER hits the legacy /provider/admin/status-override URL', async () => {
        // Sanity: the canonical service method must not have a legacy
        // fallback. Even if a malformed applicationId is passed, the URL
        // pattern stays canonical.
        await AdminB28Service.forceStatus({
            applicationId: '',
            toStatus: 'APPROVED',
            reasonCode: 'DATA_CORRECTION',
            reason: 'test',
        });
        const url = mockedPost.mock.calls[0][0] as string;
        expect(url).not.toContain('/provider/admin/status-override');
        expect(url).toContain('/admin/applications/');
        expect(url).toContain('/force-status');
    });
});
