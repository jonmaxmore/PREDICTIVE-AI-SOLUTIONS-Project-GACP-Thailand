/**
 * @jest-environment jsdom
 */
/**
 * With no NEXT_PUBLIC_SENTRY_DSN the browser sends nothing to Sentry.
 *
 * Every way a browser SDK can send — fetch, XMLHttpRequest, sendBeacon — is
 * replaced by a spy before anything runs; then the SDK is asked to initialise
 * and an error is captured. Nothing may be sent, and the instrumentation entry
 * point must not even load the SDK module.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

const ORIGINAL_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const fetchSpy = jest.fn(async () => new Response('{}'));
const xhrOpenSpy = jest.fn();
const beaconSpy = jest.fn(() => true);

beforeAll(() => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    // jsdom has no Resource Timing; the browser SDK's tracing reads it.
    if (typeof performance.getEntriesByType !== 'function') {
        (performance as unknown as { getEntriesByType: () => unknown[] }).getEntriesByType = () => [];
    }
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    window.fetch = fetchSpy as unknown as typeof fetch;
    XMLHttpRequest.prototype.open = xhrOpenSpy as unknown as typeof XMLHttpRequest.prototype.open;
    Object.defineProperty(navigator, 'sendBeacon', { value: beaconSpy, configurable: true });
});

afterAll(() => {
    if (ORIGINAL_DSN === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = ORIGINAL_DSN;
});

describe('web Sentry — off by default', () => {
    it('instrumentation-client does not load the SDK module without a DSN', async () => {
        const loaded = jest.fn();
        await jest.isolateModulesAsync(async () => {
            jest.doMock('@/lib/sentry/client', () => {
                loaded();
                return { initSentryClient: () => true };
            });
            await import('@/instrumentation-client');
            await new Promise((r) => setTimeout(r, 0));
        });
        jest.dontMock('@/lib/sentry/client');
        expect(loaded).not.toHaveBeenCalled();
    });

    it('instrumentation-client does load it once a DSN is baked in (control)', async () => {
        process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://publickey@o1.ingest.example.test/42';
        const init = jest.fn(() => true);
        try {
            await jest.isolateModulesAsync(async () => {
                jest.doMock('@/lib/sentry/client', () => ({ initSentryClient: init }));
                await import('@/instrumentation-client');
                await new Promise((r) => setTimeout(r, 0));
            });
        } finally {
            delete process.env.NEXT_PUBLIC_SENTRY_DSN;
            jest.dontMock('@/lib/sentry/client');
        }
        expect(init).toHaveBeenCalledTimes(1);
    });

    it('initSentryClient refuses without a DSN, and a captured error sends nothing anywhere', async () => {
        const Sentry = await import('@sentry/nextjs');
        const { initSentryClient } = await import('@/lib/sentry/client');

        expect(initSentryClient({ env: {}, hostname: 'demo.example.test' })).toBe(false);
        expect(initSentryClient({ env: { dsn: '   ' }, hostname: 'demo.example.test' })).toBe(false);
        expect(Sentry.getClient()).toBeUndefined();

        Sentry.captureException(new Error('[TEST] ทดสอบ 1-2345-67890-12-3 test@example.com'));
        await Sentry.flush(500);

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(xhrOpenSpy).not.toHaveBeenCalled();
        expect(beaconSpy).not.toHaveBeenCalled();
    });
});
