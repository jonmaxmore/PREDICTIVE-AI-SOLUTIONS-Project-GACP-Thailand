/**
 * @jest-environment jsdom
 */
/**
 * Browser Sentry, measured at the transport.
 *
 * The real @sentry/nextjs browser SDK is initialised through initSentryClient()
 * with a recording transport in place of the network: what the transport
 * receives is exactly what would be POSTed to Sentry's ingest. The scrubber is
 * not mocked — it is the shared packages/error-reporting module, wired in by
 * initSentryClient the same way production wires it.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import * as Sentry from '@sentry/nextjs';
import { initSentryClient } from '@/lib/sentry/client';

const NATIONAL_ID = '1-2345-67890-12-3';
const NATIONAL_ID_DIGITS = '1234567890123';
const EMAIL = 'test@example.com';
const JWT = [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    'eyJzdWIiOiJ1c2VyLTEiLCJyb2xlIjoiaGVhbHRoIn0',
    'c2lnbmF0dXJlLW5vdC1yZWFs',
].join('.');
const USER_ID = '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b';

type Envelope = [Record<string, unknown>, Array<[{ type: string }, unknown]>];
// Envelope payloads are untyped JSON; the assertions below read them structurally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const sent: Envelope[] = [];
const recordingTransport = () => ({
    send: async (envelope: unknown) => {
        sent.push(envelope as Envelope);
        return { statusCode: 200 };
    },
    flush: async () => true,
});

function items(type: string): Json[] {
    return sent.flatMap(([, list]) => list.filter(([h]) => h.type === type).map(([, payload]) => payload as Json));
}

describe('web client Sentry — an error event at the transport', () => {
    let initialised = false;

    beforeAll(async () => {
        // jsdom has no Resource Timing; the browser SDK's tracing reads it.
        if (typeof performance.getEntriesByType !== 'function') {
            (performance as unknown as { getEntriesByType: () => unknown[] }).getEntriesByType = () => [];
        }
        initialised = initSentryClient({
            env: {
                dsn: 'https://publickey@o1.ingest.example.test/42',
                environment: 'test-transport',
                release: '37799f12a1b2',
            },
            hostname: 'demo.example.test',
            transport: recordingTransport as never,
        });

        Sentry.setUser({ id: USER_ID, email: EMAIL, username: 'สมชาย ใจดี', ip_address: '203.0.113.7' });
        Sentry.setTag('applicant', EMAIL);
        Sentry.setExtra('form', { nationalId: NATIONAL_ID, phone: '081-234-5678' });
        // A console breadcrumb carrying an ID, and a clean one.
        console.warn(`checking ${NATIONAL_ID}`);
        console.warn('route changed');
        // A fetch breadcrumb to an auth route, with a body and a query.
        Sentry.addBreadcrumb({
            category: 'fetch',
            type: 'http',
            data: { url: `/api/auth/health/login?id=${NATIONAL_ID_DIGITS}`, method: 'POST', status_code: 401, request_body: { nationalId: NATIONAL_ID } },
        });
        Sentry.captureException(new Error(`[TEST] ทดสอบ ${NATIONAL_ID} ${EMAIL} ${JWT}`));
        await Sentry.flush(2000);
    });

    afterAll(async () => {
        await Sentry.close(2000);
    });

    it('initialises when a DSN is given', () => {
        expect(initialised).toBe(true);
        expect(Sentry.getClient()).toBeDefined();
    });

    it('sends nothing personal: no ID, email, token, name, phone or IP anywhere in the envelope', () => {
        const raw = JSON.stringify(sent);
        expect(items('event')).toHaveLength(1);
        for (const secret of [NATIONAL_ID, NATIONAL_ID_DIGITS, EMAIL, JWT, 'สมชาย', '081-234-5678', '203.0.113.7']) {
            expect(raw).not.toContain(secret);
        }
    });

    it('keeps the error type, the Thai message around the scrubbed values, and the stack', () => {
        const [event] = items('event');
        const [exception] = event.exception.values;
        expect(exception.type).toBe('Error');
        expect(exception.value).toBe('[TEST] ทดสอบ [Filtered] [Filtered] [Filtered]');
        expect(exception.stacktrace.frames.length).toBeGreaterThan(0);
    });

    it('keeps only the user id', () => {
        const [event] = items('event');
        expect(event.user).toEqual({ id: USER_ID });
    });

    it('drops the console breadcrumb that carried an ID and the fetch body and query', () => {
        const [event] = items('event');
        const crumbs: Json[] = event.breadcrumbs ?? [];
        const consoleMessages = crumbs.filter((b) => b.category === 'console').map((b) => b.message);
        expect(consoleMessages).toContain('route changed');
        expect(consoleMessages.join(' ')).not.toContain('checking');
        const fetchCrumb = crumbs.find((b) => b.category === 'fetch');
        expect(fetchCrumb?.data).toEqual({ url: '/api/auth/health/login', method: 'POST', status_code: 401 });
    });

    it('labels the event with the configured environment and release', () => {
        const [event] = items('event');
        expect(event.environment).toBe('test-transport');
        expect(event.release).toBe('37799f12a1b2');
    });

    it('session items carry no IP, and the SDK tells ingest not to infer one', () => {
        const sessions = items('session');
        expect(sessions.length).toBeGreaterThan(0);
        for (const session of sessions) {
            expect(session.attrs?.ip_address).toBeUndefined();
        }
        const [event] = items('event');
        expect(event.sdk.settings.infer_ip).toBe('never');
    });

    it('installs no Session Replay and no feedback widget', () => {
        const client = Sentry.getClient();
        expect(client?.getIntegrationByName('Replay')).toBeUndefined();
        expect(client?.getIntegrationByName('ReplayCanvas')).toBeUndefined();
        expect(client?.getIntegrationByName('Feedback')).toBeUndefined();
        expect(client?.getOptions().sendDefaultPii).toBe(false);
        expect(client?.getOptions().replaysSessionSampleRate).toBe(0);
        expect(client?.getOptions().replaysOnErrorSampleRate).toBe(0);
        expect(client?.getOptions().tracesSampleRate).toBe(0.05);
    });
});
