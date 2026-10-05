/**
 * W3-C — shared module-level cache for GET /api/system-config/public.
 *
 * Why this exists: the carpet-100 inventory found the same endpoint fetched
 * through TWO independent paths on a single page load — ConfigProvider in the
 * root layout (plain axios, no dedup; double-fires under React StrictMode)
 * plus the use-feature-flag hook's own module cache. Pages using FeatureGate
 * hit /api/system-config/public twice per load. This module is the single
 * fetch path both consumers share, following the codebase's established
 * module-level promise-cache idiom (use-feature-flag.ts).
 *
 * Contract proven here:
 *   1. concurrent callers share ONE network request
 *   2. later callers are served from cache (no second request)
 *   3. a failed fetch is NOT cached — the next caller retries
 *   4. invalidatePublicSystemConfig() forces a refetch
 */

const mockGet = jest.fn();

jest.mock('@/lib/api/api-client', () => ({
    apiClient: { get: (...args: unknown[]) => mockGet(...args) },
}));

import {
    getPublicSystemConfig,
    invalidatePublicSystemConfig,
} from '../system-config-cache';

describe('system-config-cache (W3-C shared fetch dedup)', () => {
    beforeEach(() => {
        mockGet.mockReset();
        invalidatePublicSystemConfig();
    });

    it('deduplicates concurrent callers into a single network request', async () => {
        mockGet.mockResolvedValue({ success: true, data: { 'feature.task_router': true } });

        const [a, b] = await Promise.all([getPublicSystemConfig(), getPublicSystemConfig()]);

        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockGet).toHaveBeenCalledWith('/api/system-config/public');
        expect(a).toEqual({ 'feature.task_router': true });
        expect(b).toEqual(a);
    });

    it('serves subsequent callers from cache without a second request', async () => {
        mockGet.mockResolvedValue({ success: true, data: { 'maintenance.enabled': 'false' } });

        await getPublicSystemConfig();
        const second = await getPublicSystemConfig();

        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(second).toEqual({ 'maintenance.enabled': 'false' });
    });

    it('does not cache a failed fetch — the next caller retries', async () => {
        mockGet.mockResolvedValueOnce({ success: false, error: '503' });
        const failed = await getPublicSystemConfig();
        expect(failed).toBeNull();

        mockGet.mockResolvedValueOnce({ success: true, data: { recovered: true } });
        const recovered = await getPublicSystemConfig();

        expect(recovered).toEqual({ recovered: true });
        expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('does not cache a thrown network error either', async () => {
        mockGet.mockRejectedValueOnce(new Error('network down'));
        const failed = await getPublicSystemConfig();
        expect(failed).toBeNull();

        mockGet.mockResolvedValueOnce({ success: true, data: { back: 1 } });
        expect(await getPublicSystemConfig()).toEqual({ back: 1 });
        expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('invalidatePublicSystemConfig() forces a refetch on the next call', async () => {
        mockGet.mockResolvedValueOnce({ success: true, data: { v: 1 } });
        expect(await getPublicSystemConfig()).toEqual({ v: 1 });

        invalidatePublicSystemConfig();

        mockGet.mockResolvedValueOnce({ success: true, data: { v: 2 } });
        expect(await getPublicSystemConfig()).toEqual({ v: 2 });
        expect(mockGet).toHaveBeenCalledTimes(2);
    });
});
