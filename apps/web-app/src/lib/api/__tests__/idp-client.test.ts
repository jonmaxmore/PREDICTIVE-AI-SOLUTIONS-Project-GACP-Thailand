/**
 * idp-client.ts — Item 6 (council final-fix round, ThaID sandbox readiness
 * final-fix-report). LOCALHOST half of the suite — see
 * idp-client-nonlocalhost.test.ts for the deploy-shaped (non-localhost)
 * hostname cases.
 *
 * `idpBackendOrigin()` silently falls back to `http://localhost:8000` when
 * `NEXT_PUBLIC_BACKEND_ORIGIN` is unset. That default is exactly right for
 * local dev, but on a real deploy where the env var was never set, every
 * citizen's browser POSTs its OAuth calls to their OWN localhost — a
 * failure that presents to a citizen (or an operator without DevTools
 * habits) as "ThaID is broken" with no diagnostic anywhere.
 *
 * Fix: `idpFetch` now `console.error`s a loud, Thai+English diagnostic
 * naming the missing env var whenever (a) the env var is genuinely unset
 * AND (b) the browser is NOT itself on localhost/127.0.0.1 — i.e. exactly
 * the case where the fallback is plausibly wrong. Never throws (keeps
 * localhost dev ergonomics zero-config).
 *
 * This file runs under jsdom's DEFAULT url (http://localhost/) — jest's
 * jsdom environment locks `window.location`/its properties as
 * non-configurable, so a hostname cannot be mutated at runtime inside a
 * test; the only reliable way to control it is the environment's initial
 * URL, set once per file via a docblock pragma (see the sibling file).
 */

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';

describe('idpFetch — Item 6: hostname===localhost (default jsdom URL)', () => {
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

    it('sanity: this file really does run on hostname===localhost', () => {
        expect(window.location.hostname).toBe('localhost');
    });

    it('env unset + hostname===localhost → NO warning (expected local-dev shape), still calls fetch against the fallback origin', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        const { idpFetch } = await import('../idp-client');
        await idpFetch('/api/auth/idp/providers');

        expect(errorSpy).not.toHaveBeenCalled();
        const [url] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string];
        expect(url).toBe('http://localhost:8000/api/auth/idp/providers');

        errorSpy.mockRestore();
    });

    it('env SET + hostname===localhost → NO warning, uses the configured origin', async () => {
        process.env.NEXT_PUBLIC_BACKEND_ORIGIN = 'https://api.gacpth.com';
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        const { idpFetch } = await import('../idp-client');
        await idpFetch('/api/auth/idp/providers');

        expect(errorSpy).not.toHaveBeenCalled();
        const [url] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string];
        expect(url).toBe('https://api.gacpth.com/api/auth/idp/providers');

        errorSpy.mockRestore();
    });
});
