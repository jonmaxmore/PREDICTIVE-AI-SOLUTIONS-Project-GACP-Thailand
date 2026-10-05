/**
 * Server-Side Configuration — Single Source of Truth
 *
 * ใช้เฉพาะในโค้ดฝั่ง Node.js (API Routes, Server Components, DAL)
 * ห้ามนำเข้าใน Client Components
 *
 * Priority order สำหรับ Backend URL:
 *   1. INTERNAL_API_URL  → Docker/CI explicit config
 *   2. BACKEND_URL       → Legacy env (docker-compose)
 *   3. FALLBACK_URLS     → Local development fallbacks
 */

/**
 * URL หลักของ Backend
 * - Docker: INTERNAL_API_URL=http://backend:8000 (set ใน docker-compose)
 * - Local dev: fallback to localhost:8000 (backend รันที่ port 8000)
 */
export const INTERNAL_BACKEND_URL =
    process.env.INTERNAL_API_URL ||
    process.env.BACKEND_URL ||
    'http://localhost:8000';

/**
 * Fallback URLs สำหรับ change-password และ route ที่ต้อง retry หลาย endpoint
 * เรียงตาม priority: Docker hostname → loopback → localhost → nginx
 */
export const FALLBACK_BACKEND_URLS = [
    'http://backend:8000',
    'http://127.0.0.1:8000',
    'http://localhost:8000',
    'http://localhost',
] as const;

/**
 * รวบ configured + fallback URLs ไว้เป็น list เดียว
 * ใช้สำหรับ routes ที่ต้องลอง probe หลาย endpoint
 */
export function getBackendCandidates(): string[] {
    const configured = [
        process.env['INTERNAL_API_URL'],
        process.env['BACKEND_URL'],
    ]
        .map((v) => String(v || '').trim())
        .filter(Boolean);

    return [...new Set([...configured, ...FALLBACK_BACKEND_URLS])];
}

/** Timeout มาตรฐานสำหรับ server-side fetch (ms) */
export const SERVER_REQUEST_TIMEOUT_MS = 10_000;
