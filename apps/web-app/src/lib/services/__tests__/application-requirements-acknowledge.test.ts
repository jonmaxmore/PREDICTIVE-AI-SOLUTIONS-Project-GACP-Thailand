/**
 * Task 8 — the applicant's "ยืนยันว่าเอกสารถูกต้อง" goes to the owner door Task 7 built:
 * POST /applications/:id/prechecks/:precheckId/acknowledge. The door records a time and
 * nothing else; this function must not claim an acknowledgement the server refused.
 */
import { acknowledgePrecheck } from '../application-requirements';

const mockPost = jest.fn();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: { post: (...args: unknown[]) => mockPost(...args) },
}));

beforeEach(() => jest.clearAllMocks());

describe('acknowledgePrecheck', () => {
    it('posts to the owner door, both ids escaped, and returns the server’s answer', async () => {
        mockPost.mockResolvedValue({ success: true, data: { precheckId: 'pc 1', acknowledgedAt: '2026-09-27T10:00:00.000Z' } });

        await expect(acknowledgePrecheck('app/1', 'pc 1')).resolves.toEqual({
            precheckId: 'pc 1', acknowledgedAt: '2026-09-27T10:00:00.000Z',
        });
        expect(mockPost).toHaveBeenCalledWith('/applications/app%2F1/prechecks/pc%201/acknowledge');
    });

    it('throws on refusal (404 for anyone but the owner) instead of pretending', async () => {
        mockPost.mockResolvedValue({ success: false, error: 'Pre-check not found' });
        await expect(acknowledgePrecheck('app-1', 'pc-1')).rejects.toThrow();
    });

    it('the refusal is said in Thai, never the envelope’s English', async () => {
        mockPost.mockResolvedValue({ success: false, error: 'Pre-check not found' });
        await expect(acknowledgePrecheck('app-1', 'pc-1')).rejects.toThrow(/[ก-๙]/);
    });
});
