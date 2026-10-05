/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://gacpth.com/auth"}
 *
 * idp-client.ts — Item 6 (council final-fix round, ThaID sandbox readiness
 * final-fix-report). NON-LOCALHOST half of the suite — see the sibling
 * idp-client.test.ts for the default (localhost) hostname cases.
 *
 * This file's jsdom instance is seeded with a real-deploy-shaped URL via the
 * `@jest-environment-options` docblock pragma, because jest's jsdom
 * environment locks `window.location`/its own properties as
 * non-configurable — the only reliable way to control `hostname` for a test
 * is the environment's initial URL, set once when the file's module (and
 * its own jsdom instance) is created.
 */

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';

describe('idpFetch — Item 6: hostname!==localhost (real-deploy-shaped URL)', () => {
    const realFetch = globalThis.fetch;
    const originalEnv = process.env.NEXT_PUBLIC_BACKEND_ORIGIN;

    beforeEach(() => {
        jest.resetModules();
        (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({}),
        }));
        delete process.env.NEXT_PUBLIC_BACKEND_ORIGIN;
    });

    afterEach(() => {
        (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
        if (originalEnv === undefined) {
            delete process.env.NEXT_PUBLIC_BACKEND_ORIGIN;
        } else {
            process.env.NEXT_PUBLIC_BACKEND_ORIGIN = originalEnv;
        }
    });

    it('sanity: this file really does run on a non-localhost hostname', () => {
        expect(window.location.hostname).toBe('gacpth.com');
    });

    it('env unset + non-localhost hostname → console.error fires naming the missing var (Thai+English), still falls back and calls fetch', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        const { idpFetch } = await import('../idp-client');
        await idpFetch('/api/auth/idp/providers');

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const message = String(errorSpy.mock.calls[0]?.[0]);
        expect(message).toContain('NEXT_PUBLIC_BACKEND_ORIGIN');
        // Thai copy present too (thai-ui-copy: user-facing/ops-facing diagnostics carry Thai).
        expect(message).toMatch(/[ก-๙]/);
        // INVERTED 2026-09-06 — this line used to assert
        // 'http://localhost:8000/api/auth/idp/providers' and called it "dev ergonomics".
        //
        // What that cost, measured on the open demo the same day: the image was built
        // without NEXT_PUBLIC_BACKEND_ORIGIN, Next inlines NEXT_PUBLIC_* at BUILD time, so
        // every phone that opened demo.gacpth.com fetched ITS OWN localhost:8000. The call
        // failed, login-chooser fell to its fail-closed branch, and both ThaID and Health ID
        // — the only two doors the ministry accepts — were badged ตรวจสถานะไม่ได้ for every
        // citizen. The console.error below fired faithfully into a phone console nobody opens.
        //
        // A fallback that cannot work in the place it ships to is not ergonomics, it is a
        // default that is wrong exactly when it matters. On a real host the page's OWN origin
        // is the answer: nginx routes `location /api/auth/` straight to the backend (proved
        // 2026-09-06 on the demo box), so this is NOT the Next `[...path]` proxy that ruling
        // R-B forbids, and the idp_state cookie stays host-scoped as R-B requires.
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [url] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string];
        expect(url).toBe('https://gacpth.com/api/auth/idp/providers');

        errorSpy.mockRestore();
    });

    it('env SET + non-localhost hostname → NO warning (correctly configured)', async () => {
        process.env.NEXT_PUBLIC_BACKEND_ORIGIN = 'https://api.gacpth.com';
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        const { idpFetch } = await import('../idp-client');
        await idpFetch('/api/auth/idp/providers');

        expect(errorSpy).not.toHaveBeenCalled();
        const [url] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string];
        expect(url).toBe('https://api.gacpth.com/api/auth/idp/providers');

        errorSpy.mockRestore();
    });

    it('the page origin is used only as a FALLBACK — an explicit env var still wins', async () => {
        // ป้องกันการแก้เกินตัว: ระบบที่ backend อยู่คนละโฮสต์ต้องยังตั้งค่าเองได้
        process.env.NEXT_PUBLIC_BACKEND_ORIGIN = 'https://api.example.test';
        const { idpFetch } = await import('../idp-client');
        await idpFetch('/api/auth/idp/providers');
        const [url] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string];
        expect(url).toBe('https://api.example.test/api/auth/idp/providers');
    });

    it('fires at most once per loaded module (does not spam on every call)', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        const { idpFetch } = await import('../idp-client');
        await idpFetch('/api/auth/idp/providers');
        await idpFetch('/api/auth/idp/thaid/authorize-url', { method: 'POST' });
        await idpFetch('/api/auth/idp/thaid/callback', { method: 'POST' });

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledTimes(3);

        errorSpy.mockRestore();
    });
});
