/**
 * admin-service-b28-endpoint-urls.test.ts — V5-D regression net.
 *
 * For every method on `AdminB28Service`, assert the URL it calls
 * against an `apiClient` mock. The Iter 28 backend rewires (UX-A1,
 * UX-A2, UX-A3, UX-B1, UX-B2, UX-C1) are now CONTRACT-tested here:
 * any future refactor that re-points a method to a wrong URL or
 * drops a method will fail loudly in this single file.
 *
 * Pattern mirrors admin-service-certificates.test.ts.
 */

import { AdminB28Service } from '../admin-service-b28';
import { apiClient } from '@/lib/api/api-client';

jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
    },
}));

const mockedGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockedPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockedPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;

describe('AdminB28Service endpoint URLs (V5-D rewires)', () => {
    beforeEach(() => {
        mockedGet.mockReset();
        mockedPost.mockReset();
        mockedPatch.mockReset();
        // Default resolved value so the service code path never throws.
        mockedGet.mockResolvedValue({ success: true, data: undefined });
        mockedPost.mockResolvedValue({ success: true, data: undefined });
        mockedPatch.mockResolvedValue({ success: true, data: undefined });
    });

    it('listUsers GETs /admin/users with default pagination', async () => {
        await AdminB28Service.listUsers();
        expect(mockedGet).toHaveBeenCalledTimes(1);
        const url = mockedGet.mock.calls[0][0] as string;
        expect(url.startsWith('/admin/users')).toBe(true);
        expect(url).toContain('page=1');
        expect(url).toContain('limit=25');
    });

    it('disableUser PATCHes /admin/users/:id/disable with { reason } (UX-A1)', async () => {
        await AdminB28Service.disableUser('user-1', 'พบความผิดปกติ');
        expect(mockedPatch).toHaveBeenCalledTimes(1);
        expect(mockedPatch).toHaveBeenCalledWith(
            '/admin/users/user-1/disable',
            { reason: 'พบความผิดปกติ' },
        );
    });

    it('enableUser PATCHes /admin/users/:id/enable with empty body (UX-A1)', async () => {
        await AdminB28Service.enableUser('user-2');
        expect(mockedPatch).toHaveBeenCalledTimes(1);
        expect(mockedPatch).toHaveBeenCalledWith('/admin/users/user-2/enable', {});
    });

    it('changeRole PATCHes /admin/users/:id/change-role with { newRole, reason } (UX-A3)', async () => {
        await AdminB28Service.changeRole(
            'user-3',
            'field_inspector',
            'promote ผู้ใช้เป็น auditor',
        );
        expect(mockedPatch).toHaveBeenCalledTimes(1);
        expect(mockedPatch).toHaveBeenCalledWith(
            '/admin/users/user-3/change-role',
            { newRole: 'field_inspector', reason: 'promote ผู้ใช้เป็น auditor' },
        );
    });

    // forceResetMfa went 2026-09-26 with its backend route (operator "ถอดทั้งสองประตู":
    // no one clears another account's 2FA).
    it('has no forceResetMfa — no client call to clear another account\'s 2FA', () => {
        expect((AdminB28Service as Record<string, unknown>).forceResetMfa).toBeUndefined();
    });

    it('forceStatus POSTs /admin/applications/:id/force-status with { toStatus, reasonCode, reason } (UX-B1)', async () => {
        await AdminB28Service.forceStatus({
            applicationId: 'app-1',
            toStatus: 'CERTIFIED',
            reasonCode: 'MANUAL_REVIEW_EXCEPTION',
            reason: 'แก้ไขข้อผิดพลาดของระบบ',
        });
        expect(mockedPost).toHaveBeenCalledTimes(1);
        expect(mockedPost).toHaveBeenCalledWith(
            '/admin/applications/app-1/force-status',
            {
                toStatus: 'CERTIFIED',
                reasonCode: 'MANUAL_REVIEW_EXCEPTION',
                reason: 'แก้ไขข้อผิดพลาดของระบบ',
            },
        );
    });

    it('revertLastTransition POSTs /admin/applications/:id/revert-last-transition (UX-B2 — NEW)', async () => {
        await AdminB28Service.revertLastTransition(
            'app-2',
            'การ force-status ก่อนหน้านี้เกิดความผิดพลาด',
        );
        expect(mockedPost).toHaveBeenCalledTimes(1);
        expect(mockedPost).toHaveBeenCalledWith(
            '/admin/applications/app-2/revert-last-transition',
            { reason: 'การ force-status ก่อนหน้านี้เกิดความผิดพลาด' },
        );
    });

    it('listAuditLog GETs /admin/audit-log with structured filters (UX-C1)', async () => {
        await AdminB28Service.listAuditLog({
            actorId: 'actor-uuid-1',
            category: 'ADMIN',
            action: 'USER_DISABLED',
            applicationId: 'app-3',
            organizationId: 'org-3',
            from: '2026-05-01',
            to: '2026-05-17',
        });
        expect(mockedGet).toHaveBeenCalledTimes(1);
        const url = mockedGet.mock.calls[0][0] as string;
        expect(url.startsWith('/admin/audit-log')).toBe(true);
        expect(url).toContain('actorId=actor-uuid-1');
        expect(url).toContain('category=ADMIN');
        expect(url).toContain('action=USER_DISABLED');
        expect(url).toContain('applicationId=app-3');
        expect(url).toContain('organizationId=org-3');
        expect(url).toContain('from=2026-05-01');
        expect(url).toContain('to=2026-05-17');
    });

    it('auditLogExportUrl returns /api/admin/audit-log/export.csv with structured filters (UX-C1)', () => {
        const url = AdminB28Service.auditLogExportUrl({
            actorId: 'actor-uuid-2',
            category: 'PAYMENT',
            applicationId: 'app-4',
            organizationId: 'org-4',
            from: '2026-05-10',
            to: '2026-05-17',
        });
        // The legacy /provider/admin/audit-log/export.csv path is gone.
        expect(url).toContain('/api/admin/audit-log/export.csv');
        expect(url).not.toContain('/provider/admin/');
        expect(url).toContain('actorId=actor-uuid-2');
        expect(url).toContain('category=PAYMENT');
        expect(url).toContain('applicationId=app-4');
        expect(url).toContain('organizationId=org-4');
    });

    // ── Negative-net: ensure NONE of the V5-D methods regress to
    // the legacy /provider/admin/* surface. This is the single
    // assertion that fails loudly if a future refactor reverts.
    it('never calls any /provider/admin/* legacy URL', async () => {
        await AdminB28Service.listUsers();
        await AdminB28Service.disableUser('u', 'a long reason here');
        await AdminB28Service.enableUser('u');
        await AdminB28Service.changeRole('u', 'field_inspector', 'a long reason here');
        await AdminB28Service.forceStatus({
            applicationId: 'a',
            toStatus: 'CERTIFIED',
            reasonCode: 'MANUAL_REVIEW_EXCEPTION',
            reason: 'a long reason here',
        });
        await AdminB28Service.revertLastTransition('a', 'a long reason here');
        await AdminB28Service.listAuditLog({ actorId: 'a' });
        const exportUrl = AdminB28Service.auditLogExportUrl({ actorId: 'a' });

        const allUrls = [
            ...mockedGet.mock.calls.map((c) => c[0]),
            ...mockedPost.mock.calls.map((c) => c[0]),
            ...mockedPatch.mock.calls.map((c) => c[0]),
            exportUrl,
        ];
        for (const url of allUrls) {
            expect(String(url)).not.toContain('/provider/admin/');
        }
    });
});
