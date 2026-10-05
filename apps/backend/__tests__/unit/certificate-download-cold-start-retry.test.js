/**
 * F-PDF-COLD-START-TIMEOUT — GET /api/certificates/:id/download retry
 * budget (2026-08-20 review follow-up: nginx-timeout-safe retry).
 *
 * evidence/phase0/FINDINGS.md:177-178 (walk C15): the first PDF render after
 * a backend restart pays Puppeteer's browser-launch cost inline and can trip
 * puppeteer's own 30s launch timeout (attempt 1 = 503; attempts 2-4
 * succeeded once the browser was already warm). The route retries ONCE on a
 * cold-start-class failure — but nginx fronts this route with
 * `proxy_read_timeout 60s` (nginx/gacp.production.conf:157, no override on
 * the /api/ catch-all at :334-349): two un-timeboxed attempts could stack to
 * ~60-70s and get killed by nginx as an opaque 504 — WORSE than the original
 * single ~30-35s failure. certificates.js now bounds the whole sequence:
 *   PDF_TOTAL_BUDGET_MS = 50_000   (ceiling for attempt-1 + retry)
 *   PDF_ATTEMPT_TIMEOUT_MS = 25_000 (hard deadline for ANY single attempt)
 *   PDF_RETRY_CUTOFF_MS = 20_000    (only retry if attempt-1 failed before
 *                                    this much elapsed time)
 *
 * These tests exercise the REAL timing behaviour with Jest fake timers
 * (idiom: period-close-service.test.js) — no real wall-clock waiting.
 *
 * Test strategy: extract + invoke the route's async handler function
 * directly (bypassing authenticateHealth + a real HTTP/socket layer)
 * instead of supertest, so fake timers control 100% of what the handler
 * awaits — no risk of Node's real socket/keep-alive timers interacting with
 * jest's fake clock.
 */

'use strict';

const mockGetCertificateForUser = jest.fn();
const mockGetCertificatePdf = jest.fn();
jest.mock('../../services/certificate-service', () => ({
    getCertificateForUser: (...args) => mockGetCertificateForUser(...args),
    getCertificatePdf: (...args) => mockGetCertificatePdf(...args),
}));

jest.mock('../../services/entity-service', () => ({ assertCapability: jest.fn() }));

// Spec 2026-09-30 §3.1 (Task 4): the health branch passes the caller's holder
// scope instead of a bare userId.
jest.mock('../../services/holder-access', () => ({
    holderScope: async (req) => ({ userId: req.user.id, readIds: ['entity-own'], editIds: ['entity-own'] }),
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = {
        debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

const logger = require('../../shared/logger');
const certificatesRouter = require('../../routes/api/certificates/certificates');

const PDF_TOTAL_BUDGET_MS = 50_000;
const PDF_ATTEMPT_TIMEOUT_MS = 25_000;
const PDF_RETRY_CUTOFF_MS = 20_000;

/** Pull the final (post-auth) handler off the router's own route stack. */
function getDownloadHandler() {
    const layer = certificatesRouter.stack.find(
        (l) => l.route && l.route.path === '/:id/download' && l.route.methods && l.route.methods.get,
    );
    if (!layer) {
        throw new Error(
            'certificate-download-cold-start-retry.test.js: GET /:id/download route not found on the '
            + 'certificates router — has the route path/method changed? Update this extraction helper.',
        );
    }
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function buildReqRes() {
    const req = { params: { id: 'cert-1' }, user: { id: 'user-health-1' }, activeEntity: undefined };
    const res = {
        statusCode: 200,
        headers: {},
        body: undefined,
        setHeader(key, value) { this.headers[key] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        send(payload) { this.body = payload; return this; },
    };
    return { req, res };
}

/** A cold-start-class error via the real puppeteer TimeoutError shape. */
function coldStartError(message) {
    const err = new Error(message);
    err.name = 'TimeoutError';
    return err;
}

/** A mock implementation that rejects with `err` after `ms` virtual ms. */
function rejectsAfter(ms, err) {
    return () => new Promise((_resolve, reject) => { setTimeout(() => reject(err), ms); });
}

/** A mock implementation whose promise NEVER settles on its own. */
function hangsForever() {
    return () => new Promise(() => {});
}

const handler = getDownloadHandler();

describe('F-PDF-COLD-START-TIMEOUT — /api/certificates/:id/download retry budget', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        mockGetCertificateForUser.mockResolvedValue({ id: 'cert-1', certificateNumber: 'GACP-TH-2569-AAA' });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('happy path (already-warm browser, resolves immediately) → single call, 200, no retry log', async () => {
        mockGetCertificatePdf.mockResolvedValue(Buffer.from('%PDF-1.4 real bytes'));
        const { req, res } = buildReqRes();

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        expect(mockGetCertificatePdf).toHaveBeenCalledTimes(1);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('genuine render/data error (not cold-start) → NO retry, called exactly once, 500', async () => {
        mockGetCertificatePdf.mockRejectedValue(new Error('Certificate not found'));
        const { req, res } = buildReqRes();

        await handler(req, res);

        expect(res.statusCode).toBe(500);
        expect(mockGetCertificatePdf).toHaveBeenCalledTimes(1);
    });

    test('(b) cold-start fails FAST (2s, well under the cutoff) → retry runs, succeeds → 200, two calls', async () => {
        mockGetCertificatePdf
            .mockImplementationOnce(rejectsAfter(2_000, coldStartError('Timed out after 2000 ms while trying to connect to the browser!')))
            .mockImplementationOnce(() => Promise.resolve(Buffer.from('%PDF-1.4 real bytes')));
        const { req, res } = buildReqRes();

        const done = handler(req, res);
        await jest.advanceTimersByTimeAsync(3_000);
        await done;

        expect(res.statusCode).toBe(200);
        expect(mockGetCertificatePdf).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/cold-start failure on first attempt/i));
    });

    test('(a) cold-start fails SLOWLY (22s — past the 20s retry cutoff, still under the 25s attempt deadline so the real rejection is what fires) → NO retry, one call, 500', async () => {
        mockGetCertificatePdf.mockImplementation(
            rejectsAfter(22_000, coldStartError('Timed out after 22000 ms while trying to connect to the browser!')),
        );
        const { req, res } = buildReqRes();

        const done = handler(req, res);
        await jest.advanceTimersByTimeAsync(25_000);
        await done;

        expect(res.statusCode).toBe(500);
        expect(mockGetCertificatePdf).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/no retry budget left/i));
    });

    // (c) — attempt hangs past PDF_ATTEMPT_TIMEOUT_MS with NO native
    // settlement at all: the route's own withAttemptDeadline() must be what
    // rescues the request (classifies it cold-start via a synthetic
    // TimeoutError) rather than the handler hanging indefinitely. Note: the
    // resulting elapsed time (PDF_ATTEMPT_TIMEOUT_MS = 25_000ms) is >=
    // PDF_RETRY_CUTOFF_MS (20_000ms) by construction — requirement #1 forces
    // EVERY attempt, including the first, through the same
    // PDF_ATTEMPT_TIMEOUT_MS deadline, so a first attempt that needed the
    // full deadline to fail is mathematically indistinguishable (in elapsed
    // time) from scenario (a)'s slow-but-real 22s rejection, and gets the
    // SAME budget decision: no retry. That is the deliberately conservative
    // reading — a first attempt that consumed its entire attempt deadline is
    // evidence of a genuinely broken/very slow cold start, not a "quick
    // hiccup" worth a second try inside the route's fixed total budget. This
    // test's real purpose is to PROVE the deadline mechanism itself fires
    // (the promise never leaves the request hanging) and classifies
    // correctly — the "no retry" outcome falls out of the same cutoff math
    // as (a), asserted here for consistency.
    test('(c) attempt hangs indefinitely (never settles) → the route\'s own attempt deadline fires at 25s, classified cold-start, no dangling request — same cutoff math as (a) → no retry, one call, 500', async () => {
        mockGetCertificatePdf.mockImplementation(hangsForever());
        const { req, res } = buildReqRes();

        const done = handler(req, res);
        await jest.advanceTimersByTimeAsync(PDF_ATTEMPT_TIMEOUT_MS + 1_000);
        await done;

        expect(res.statusCode).toBe(500);
        expect(mockGetCertificatePdf).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/no retry budget left/i));
    });

    test('(d) double cold-start failure (fast fail + hanging retry) → total elapsed NEVER exceeds PDF_TOTAL_BUDGET_MS', async () => {
        mockGetCertificatePdf
            .mockImplementationOnce(rejectsAfter(2_000, coldStartError('Timed out after 2000 ms while trying to connect to the browser!')))
            .mockImplementation(hangsForever()); // the retry attempt hangs too
        const { req, res } = buildReqRes();

        const startedAt = Date.now();
        // Capture Date.now() the instant the handler's own promise settles
        // (inside a .then chained directly onto it), NOT after the
        // surrounding advanceTimersByTimeAsync call below — modern fake
        // timers advance the clock through the FULL requested window
        // regardless of when our promise already resolved inside it, so
        // reading Date.now() after the outer advance would over-count by
        // whatever margin we asked it to advance past the real settlement.
        let resolvedAt;
        const done = handler(req, res).then(() => { resolvedAt = Date.now(); });
        // 2_000 (attempt 1) + up to 25_000 (retry, capped by
        // min(PDF_ATTEMPT_TIMEOUT_MS, remaining budget) = 25_000) + margin.
        await jest.advanceTimersByTimeAsync(2_000 + PDF_ATTEMPT_TIMEOUT_MS + 1_000);
        await done;
        const totalElapsedMs = resolvedAt - startedAt;

        expect(res.statusCode).toBe(500);
        expect(mockGetCertificatePdf).toHaveBeenCalledTimes(2);
        expect(totalElapsedMs).toBeLessThan(PDF_TOTAL_BUDGET_MS);
        // Deterministic under fake timers: 2_000 (attempt 1) + 25_000 (retry
        // deadline, capped) — the extra 1_000ms of advanced time in the
        // window above was never consumed because the retry's own deadline
        // fired first and the handler had already written its response.
        expect(totalElapsedMs).toBe(2_000 + PDF_ATTEMPT_TIMEOUT_MS);
    });
});
