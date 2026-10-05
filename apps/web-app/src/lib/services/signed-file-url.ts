/**
 * signed-file-url — ONE way to turn a stored `/uploads/...` path into something
 * the browser can actually load (W1-2, 2026-08-21).
 *
 * WHY: `/uploads` is gated by `apps/backend/middleware/uploads-access.js`, which
 * (correctly) requires proof of entitlement for every PDPA-sensitive path. A
 * browser `<img src>` / `<iframe src>` / download link cannot attach an
 * Authorization header — it can only send cookies. Any client holding a Bearer
 * token but no valid `auth_token` cookie (the mobile app, a session whose 24h
 * cookie aged out while the access token kept being refreshed, a cross-site
 * embed) therefore got 401 on its OWN file, which is the operator report
 * "อัปโหลดไฟล์ หรือรูปไม่ได้".
 *
 * THE FIX: ask the backend to mint a short-lived signed URL for that exact
 * object (`POST /api/files/signed-url`). The backend proves entitlement once,
 * over an authenticated request, and returns a URL whose signature the static
 * route accepts on its own. The `<img>` then needs no credentials at all.
 *
 * DO NOT sprinkle token-attaching fetches into components. This module and
 * `@/lib/hooks/use-signed-file-url` are the only two entry points.
 */

import { apiClient } from '@/lib/api/api-client';

interface SignedUrlResponse {
    url: string;
    expiresAt: string;
}

interface CacheEntry {
    /** In-flight or settled mint for this exact object. */
    promise: Promise<string>;
    /** Epoch ms at which the minted signature stops being usable. */
    expiresAtMs: number;
}

/**
 * Per-object cache. Two jobs:
 *  1. collapse the burst of identical mints a list of thumbnails would fire;
 *  2. avoid re-minting on every re-render for a signature that is still good.
 *
 * Entries are dropped a safety margin BEFORE the real expiry so a slow image
 * load never races the deadline.
 */
const REFRESH_MARGIN_MS = 30_000;
const cache = new Map<string, CacheEntry>();

/** Test seam + a hook for "the user switched account, forget everything". */
export function clearSignedFileUrlCache(): void {
    cache.clear();
}

/** Only `/uploads/...` paths are gated; anything else is already loadable. */
function needsSigning(fileUrl: string): boolean {
    return fileUrl.startsWith('/uploads/');
}

/**
 * Thai copy for a failed mint. Each message names the CAUSE and the NEXT
 * ACTION, and never opens with a bare apology.
 */
function messageForFailure(status?: number, code?: string): string {
    if (status === 401 || code === 'NO_TOKEN') {
        return 'เซสชันหมดอายุแล้ว คุณเข้าสู่ระบบอีกครั้งแล้วเปิดไฟล์ใหม่ได้';
    }
    if (status === 404 || code === 'NOT_FOUND') {
        return 'ไม่พบไฟล์นี้ หรือบัญชีของคุณไม่มีสิทธิ์เปิดดู คุณติดต่อผู้ดูแลระบบได้หากคิดว่าเป็นความผิดพลาด';
    }
    if (status === 400 || code === 'INVALID_PATH') {
        return 'ที่อยู่ไฟล์ไม่ถูกต้อง คุณกลับไปที่หน้ารายการแล้วเปิดไฟล์อีกครั้งได้';
    }
    return 'ระบบสร้างลิงก์เปิดไฟล์ไม่สำเร็จ คุณลองใหม่อีกครั้งในอีกสักครู่';
}

async function mint(fileUrl: string): Promise<{ url: string; expiresAtMs: number }> {
    const response = await apiClient.post<SignedUrlResponse>('/files/signed-url', { fileUrl });

    if (!response.success || !response.data?.url) {
        throw new Error(messageForFailure(response.status, response.code));
    }

    const expiresAtMs = Date.parse(response.data.expiresAt);
    return {
        url: response.data.url,
        expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + REFRESH_MARGIN_MS,
    };
}

/**
 * Resolve a stored file path to a URL the browser can load with no credentials.
 *
 * @param fileUrl the stored path, e.g. `/uploads/documents/abc.pdf`. A URL that is
 *   not under `/uploads/` (a data:, blob:, or already-absolute CDN url) is
 *   returned unchanged — nothing gates it, so nothing needs signing.
 * @throws Error with a Thai message when the backend refuses to mint, so the
 *   caller can show a real failure state instead of a broken image icon.
 */
export async function getSignedFileUrl(fileUrl: string): Promise<string> {
    const target = String(fileUrl || '').trim();
    if (!target || !needsSigning(target)) {
        return target;
    }

    const cached = cache.get(target);
    if (cached && cached.expiresAtMs - REFRESH_MARGIN_MS > Date.now()) {
        return cached.promise;
    }

    // Placeholder expiry keeps a concurrent caller on THIS in-flight mint
    // instead of starting a second one; the real value lands below.
    const entry: CacheEntry = {
        expiresAtMs: Date.now() + REFRESH_MARGIN_MS * 2,
        promise: mint(target)
            .then((minted) => {
                const live = cache.get(target);
                if (live) {
                    live.expiresAtMs = minted.expiresAtMs;
                }
                return minted.url;
            })
            .catch((err) => {
                // A failed mint must not be cached — the next render should retry
                // (the session may have been refreshed in between).
                cache.delete(target);
                throw err;
            }),
    };
    cache.set(target, entry);
    return entry.promise;
}

export default getSignedFileUrl;
