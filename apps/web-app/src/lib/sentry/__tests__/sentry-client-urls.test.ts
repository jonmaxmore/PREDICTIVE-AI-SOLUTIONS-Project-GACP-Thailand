/**
 * @jest-environment jsdom
 */
/**
 * Browser Sentry: query strings and free-text path segments never leave.
 *
 * Privacy review 2026-10-02 (Critical 2): the officer search box
 * (src/app/provider/applications/page.tsx) sends `?q=<applicant name>`, and the
 * browser SDK 11 puts URLs into fetch breadcrumbs (`data.url`), navigation
 * breadcrumbs (`data.to`) and `event.request.url` regardless of
 * `dataCollection.urlQueryParams`. The real SDK runs here with a recording
 * transport; the scrubber is not mocked.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';
import { initSentryClient } from '@/lib/sentry/client';

const PAGE_QUERY = 'สมหญิง ค้นหาหน้า';
const FETCH_QUERY = 'มานะ ค้นหาเฟทช์';
const PATH_NAME = 'ชื่อ ในพาธ';
const CONSOLE_NAME = 'ปิติ คอนโซลเว็บ';

const sent: unknown[] = [];
const recordingTransport = () => ({
    send: async (envelope: unknown) => {
        sent.push(envelope);
        return { statusCode: 200 };
    },
    flush: async () => true,
});

describe('web client Sentry — URLs carry no query and no free text', () => {
    beforeAll(async () => {
        if (typeof performance.getEntriesByType !== 'function') {
            (performance as unknown as { getEntriesByType: () => unknown[] }).getEntriesByType = () => [];
        }
        // A fetch for the SDK to instrument (jsdom has none).
        (window as unknown as { fetch: unknown }).fetch = async () => ({
            status: 200, ok: true, headers: { get: () => null }, clone() { return this; }, text: async () => '', body: null,
        });
        initSentryClient({
            env: { dsn: 'https://publickey@o1.ingest.example.test/42', tracesSampleRate: '1' },
            hostname: 'demo.example.test',
            transport: recordingTransport as never,
        });
        window.history.pushState({}, '', `/health/applications?q=${encodeURIComponent(PAGE_QUERY)}`);
        await window.fetch(`/api/v2/provider/applications?q=${encodeURIComponent(FETCH_QUERY)}&status=x`);
        await window.fetch(`https://staging.example.test/api/applications/${encodeURIComponent(PATH_NAME)}`);
        console.error('failed for', { applicantName: CONSOLE_NAME });
        Sentry.captureException(new Error('[TEST] search page failed'));
        await Sentry.flush(2000);
    });

    afterAll(async () => {
        await Sentry.close(2000);
    });

    it('no searched name, path name or logged name appears anywhere, encoded or not', () => {
        const raw = JSON.stringify(sent);
        expect(raw).toContain('[TEST] search page failed');
        for (const name of [PAGE_QUERY, FETCH_QUERY, PATH_NAME, CONSOLE_NAME]) {
            expect(raw).not.toContain(name);
            expect(raw).not.toContain(encodeURIComponent(name));
        }
    });

    it('keeps paths: request.url, the fetch and navigation breadcrumbs', () => {
        const event = (sent as Array<[unknown, Array<[{ type: string }, Record<string, any>]>]>) // eslint-disable-line @typescript-eslint/no-explicit-any
            .flatMap(([, items]) => items)
            .find(([h]) => h.type === 'event')?.[1];
        expect(event?.request?.url).toBe('http://localhost/health/applications');
        const crumbs: Array<Record<string, any>> = event?.breadcrumbs ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
        const urls = crumbs.filter((b) => b.category === 'fetch').map((b) => b.data?.url);
        expect(urls).toContain('/api/v2/provider/applications');
        expect(urls).toContain('https://staging.example.test/api/applications/[Filtered]');
        const nav = crumbs.find((b) => b.category === 'navigation');
        expect(nav?.data?.to).toBe('/health/applications');
    });
});
