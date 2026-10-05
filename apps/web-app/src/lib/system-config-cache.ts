/**
 * W3-C — single shared fetch path for GET /api/system-config/public.
 *
 * Before this module, the same endpoint was fetched through two independent
 * code paths on every page load: `ConfigProvider` in the root layout (plain
 * axios, refetched on every StrictMode double-mount) and the
 * `use-feature-flag` hook's private module cache. Pages rendering a
 * `FeatureGate` therefore hit the endpoint twice per hard navigation.
 *
 * This module owns the request. It follows the codebase's established
 * module-level promise-cache idiom (see use-feature-flag.ts): one in-flight
 * promise deduplicates concurrent callers, a resolved payload is cached for
 * the browser session, and a failure resolves to `null` WITHOUT poisoning
 * the cache so the next caller retries. Admin config mutations call
 * `invalidatePublicSystemConfig()` so both consumers refetch fresh values.
 */
import { apiClient } from '@/lib/api/api-client';

export type PublicSystemConfig = Record<string, unknown>;

let cached: PublicSystemConfig | null = null;
let inflight: Promise<PublicSystemConfig | null> | null = null;

export async function getPublicSystemConfig(): Promise<PublicSystemConfig | null> {
    if (cached) {
        return cached;
    }
    if (!inflight) {
        inflight = apiClient
            .get<PublicSystemConfig>('/api/system-config/public')
            .then((res) => {
                if (res.success && res.data && typeof res.data === 'object') {
                    cached = res.data as PublicSystemConfig;
                    return cached;
                }
                // Unavailable ≠ "no config": resolve null, cache nothing —
                // the next caller retries instead of trusting a bad answer.
                return null;
            })
            .catch(() => null)
            .finally(() => {
                inflight = null;
            });
    }
    return inflight;
}

export function invalidatePublicSystemConfig(): void {
    cached = null;
    inflight = null;
}
