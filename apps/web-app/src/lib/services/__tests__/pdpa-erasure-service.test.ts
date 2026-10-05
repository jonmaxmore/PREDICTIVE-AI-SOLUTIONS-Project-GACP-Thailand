/**
 * PdpaErasureService — R4-D contract tests.
 *
 * Mocks the apiClient so we can assert:
 *   (a) requestErasure POSTs to /api/pdpa/erasure/request with the
 *       reason body (or empty body when omitted)
 *   (b) confirmErasure POSTs to /api/pdpa/erasure/confirm with
 *       { requestId, token }
 *   (c) cancelErasure POSTs to /api/pdpa/erasure/:id/cancel
 *   (d) envelope-tolerant: on success=false the wrapper returns the
 *       envelope unchanged — does NOT throw
 *
 * Pattern mirrors admin-service-certificates.test.ts in this folder.
 * Mock exposes get/post/delete per I-008 — SUT only uses post today
 * but the full surface is mocked so future extensions don't break.
 */

import { PdpaErasureService } from '../pdpa-erasure-service';
import { apiClient } from '@/lib/api/api-client';

jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: jest.fn(),
        post: jest.fn(),
        delete: jest.fn(),
    },
}));

const mockedPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

describe('PdpaErasureService.requestErasure', () => {
    beforeEach(() => {
        mockedPost.mockReset();
    });

    it('POSTs to /api/pdpa/erasure/request with the reason body', async () => {
        mockedPost.mockResolvedValueOnce({
            success: true,
            data: { requestId: 'pdpa-er-abc123', expiresAt: '2026-05-18T08:00:00.000Z' },
        });
        await PdpaErasureService.requestErasure({ reason: 'ไม่ใช้ระบบแล้ว' });
        expect(mockedPost).toHaveBeenCalledWith(
            '/api/pdpa/erasure/request',
            { reason: 'ไม่ใช้ระบบแล้ว' },
        );
    });

    it('POSTs with empty body when reason is omitted', async () => {
        mockedPost.mockResolvedValueOnce({
            success: true,
            data: { requestId: 'pdpa-er-abc123', expiresAt: '2026-05-18T08:00:00.000Z' },
        });
        await PdpaErasureService.requestErasure();
        expect(mockedPost).toHaveBeenCalledWith('/api/pdpa/erasure/request', {});
    });

    it('omits reason when it is an empty / whitespace-only string', async () => {
        mockedPost.mockResolvedValueOnce({
            success: true,
            data: { requestId: 'pdpa-er-abc123', expiresAt: '2026-05-18T08:00:00.000Z' },
        });
        await PdpaErasureService.requestErasure({ reason: '   ' });
        expect(mockedPost).toHaveBeenCalledWith('/api/pdpa/erasure/request', {});
    });

    it('returns the apiClient envelope on success', async () => {
        const envelope = {
            success: true,
            data: { requestId: 'pdpa-er-xyz', expiresAt: '2026-05-18T08:00:00.000Z' },
        };
        mockedPost.mockResolvedValueOnce(envelope);
        const out = await PdpaErasureService.requestErasure({ reason: 'x' });
        expect(out).toEqual(envelope);
    });

    it('returns the envelope unchanged on success=false (does NOT throw)', async () => {
        const failure = {
            success: false,
            error: 'An erasure request is already in progress',
        };
        mockedPost.mockResolvedValueOnce(failure);
        const out = await PdpaErasureService.requestErasure({ reason: 'x' });
        expect(out).toEqual(failure);
        expect(out.success).toBe(false);
    });
});

describe('PdpaErasureService.confirmErasure', () => {
    beforeEach(() => {
        mockedPost.mockReset();
    });

    it('POSTs to /api/pdpa/erasure/confirm with { requestId, token }', async () => {
        mockedPost.mockResolvedValueOnce({
            success: true,
            data: {
                ok: true,
                userId: 'user-1',
                executedAt: '2026-05-17T10:00:00.000Z',
                anonymized: { user: true, applications: 2, certificates: 1 },
                erased: { applicationDrafts: 0, notifications: 5 },
                preserved: ['Invoice', 'JournalEntry', 'AuditLog'],
            },
        });
        await PdpaErasureService.confirmErasure({
            requestId: 'pdpa-er-abc123',
            token: 'tok-fedcba9876543210fedcba9876543210',
        });
        expect(mockedPost).toHaveBeenCalledWith(
            '/api/pdpa/erasure/confirm',
            {
                requestId: 'pdpa-er-abc123',
                token: 'tok-fedcba9876543210fedcba9876543210',
            },
        );
    });

    it('returns the envelope unchanged on success=false', async () => {
        const failure = {
            success: false,
            error: 'Invalid erasure token',
        };
        mockedPost.mockResolvedValueOnce(failure);
        const out = await PdpaErasureService.confirmErasure({
            requestId: 'pdpa-er-abc123',
            token: 'bad-token',
        });
        expect(out).toEqual(failure);
    });
});

describe('PdpaErasureService.cancelErasure', () => {
    beforeEach(() => {
        mockedPost.mockReset();
    });

    it('POSTs to /api/pdpa/erasure/:id/cancel', async () => {
        mockedPost.mockResolvedValueOnce({
            success: true,
            data: { ok: true, requestId: 'pdpa-er-abc123', status: 'CANCELED' },
        });
        await PdpaErasureService.cancelErasure('pdpa-er-abc123');
        expect(mockedPost).toHaveBeenCalledWith(
            '/api/pdpa/erasure/pdpa-er-abc123/cancel',
        );
    });

    it('URL-encodes the requestId so unusual characters do not break the path', async () => {
        mockedPost.mockResolvedValueOnce({
            success: true,
            data: { ok: true, requestId: 'pdpa er/abc', status: 'CANCELED' },
        });
        await PdpaErasureService.cancelErasure('pdpa er/abc');
        expect(mockedPost).toHaveBeenCalledWith(
            `/api/pdpa/erasure/${encodeURIComponent('pdpa er/abc')}/cancel`,
        );
    });

    it('returns the envelope unchanged on success=false', async () => {
        const failure = {
            success: false,
            error: 'Erasure request not found',
        };
        mockedPost.mockResolvedValueOnce(failure);
        const out = await PdpaErasureService.cancelErasure('pdpa-er-missing');
        expect(out).toEqual(failure);
    });
});
