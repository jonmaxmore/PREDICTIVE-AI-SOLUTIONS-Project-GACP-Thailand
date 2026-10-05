/**
 * W2-D — rate-limiter Redis dedupe path unit test.
 *
 * Pins the behaviour of the Redis branch in
 * apps/backend/middleware/rate-limiter.js:78-99 — the multi-instance
 * dedupe path that lets multiple backend pods share a single rate-limit
 * counter via Redis (vs. the per-process Map fallback at lines 101-112).
 *
 * Why this test exists:
 *   - Two existing integration tests (provider-cms-workflow + provider-
 *     admin-planting-integrity) USE rate-limit but neither asserts the
 *     Redis-specific behaviour. The W1 audit called out the gap.
 *   - The Redis branch uses ioredis.pipeline() + incr + pttl + pexpire.
 *     A future refactor that swaps the pipeline for individual commands
 *     (race condition) would silently slip through.
 *   - The "first request sets pexpire when pttl < 0" branch is subtle —
 *     without it the rate-limit window NEVER resets.
 *
 * I-008 applied: the SUT does require('../config/redis'). The mock
 * exposes the SAME shape ioredis client exposes: .status, .pipeline(),
 * .pexpire(). The pipeline returns an object with .incr, .pttl,
 * .exec. Each command in pipeline returns the pipeline (chainable).
 *
 * See: docs/handoffs/iter-W2/00-rfc.md §W2-D
 */

'use strict';

// Module-level Redis mock (must be declared BEFORE require below).
const pipelineExecFn = jest.fn();
const pexpireFn = jest.fn();

const mockPipeline = {
    incr: jest.fn(() => mockPipeline),
    pttl: jest.fn(() => mockPipeline),
};
Object.defineProperty(mockPipeline, 'exec', {
    value: (...args) => pipelineExecFn(...args),
    writable: true,
});

const mockRedisClient = {
    status: 'ready',
    pipeline: jest.fn(() => mockPipeline),
    pexpire: (...args) => pexpireFn(...args),
};

jest.mock('../../config/redis', () => mockRedisClient);

// Logger mock to silence the [SECURITY] rate-limit warnings.
jest.mock('../../shared/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
    stream: { write: jest.fn() },
}));

// SUT must be required AFTER mocks so they apply.
const { createRateLimiter, cleanupMemoryStore } = require('../../middleware/rate-limiter');

function createReq({ ip = '10.0.0.1', path = '/api/test' } = {}) {
    return {
        ip,
        path,
        originalUrl: path,
        headers: { 'x-forwarded-for': ip },
        connection: { remoteAddress: ip },
        socket: { remoteAddress: ip },
    };
}

function createRes() {
    const headers = {};
    const res = {
        statusCode: 200,
        body: null,
        headers,
        setHeader: jest.fn((name, value) => { headers[name] = value; }),
        status: jest.fn(function statusFn(code) { res.statusCode = code; return res; }),
        json: jest.fn(function jsonFn(payload) { res.body = payload; return res; }),
    };
    return res;
}

beforeEach(() => {
    pipelineExecFn.mockReset();
    pexpireFn.mockReset();
    mockPipeline.incr.mockClear();
    mockPipeline.pttl.mockClear();
    mockRedisClient.pipeline.mockClear();
    mockRedisClient.status = 'ready';
    // Reset memory store so per-it state stays hermetic.
    cleanupMemoryStore();
});

describe('W2-D rate-limiter Redis dedupe branch', () => {
    it('uses Redis pipeline (incr + pttl) when redis.status === "ready"', async () => {
        // 1st request: pttl returns -2 (key has no TTL) -> triggers pexpire
        pipelineExecFn.mockResolvedValueOnce([[null, 1], [null, -2]]);

        const limiter = createRateLimiter({ windowMs: 60000, max: 5, message: 'rate' });
        const req = createReq();
        const res = createRes();
        const next = jest.fn();

        await limiter(req, res, next);

        expect(mockRedisClient.pipeline).toHaveBeenCalledTimes(1);
        expect(mockPipeline.incr).toHaveBeenCalledWith('ratelimit:10.0.0.1:/api/test');
        expect(mockPipeline.pttl).toHaveBeenCalledWith('ratelimit:10.0.0.1:/api/test');
        expect(pipelineExecFn).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.headers['X-RateLimit-Limit']).toBe(5);
        expect(res.headers['X-RateLimit-Remaining']).toBe(4);
    });

    it('sets pexpire on first request only (pttl < 0 branch)', async () => {
        // pttl = -2 -> key never existed -> must set pexpire
        pipelineExecFn.mockResolvedValueOnce([[null, 1], [null, -2]]);
        pexpireFn.mockResolvedValueOnce(1);

        const limiter = createRateLimiter({ windowMs: 60000, max: 5 });
        const req = createReq();
        const res = createRes();
        const next = jest.fn();

        await limiter(req, res, next);

        expect(pexpireFn).toHaveBeenCalledTimes(1);
        expect(pexpireFn).toHaveBeenCalledWith('ratelimit:10.0.0.1:/api/test', 60000);
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('does NOT call pexpire on subsequent requests (pttl >= 0 branch — key already has TTL)', async () => {
        // pttl = 45000ms remaining -> key still has TTL -> pexpire NOT called
        pipelineExecFn.mockResolvedValueOnce([[null, 2], [null, 45000]]);

        const limiter = createRateLimiter({ windowMs: 60000, max: 5 });
        const req = createReq();
        const res = createRes();
        const next = jest.fn();

        await limiter(req, res, next);

        expect(pexpireFn).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.headers['X-RateLimit-Remaining']).toBe(3);
    });

    it('returns 429 Too Many Requests once Redis count exceeds max', async () => {
        // count = 6, max = 5 -> exceeded
        pipelineExecFn.mockResolvedValueOnce([[null, 6], [null, 12345]]);

        const limiter = createRateLimiter({ windowMs: 60000, max: 5, message: 'slow down' });
        const req = createReq();
        const res = createRes();
        const next = jest.fn();

        await limiter(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.body).toMatchObject({
            success: false,
            error: 'Too Many Requests',
            message: 'slow down',
        });
        expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('falls back to memory store when redis.status !== "ready" (unavailable branch)', async () => {
        mockRedisClient.status = 'connecting'; // not ready -> skip pipeline
        const limiter = createRateLimiter({ windowMs: 60000, max: 5 });
        const req = createReq({ ip: '10.0.0.2', path: '/api/fb' });
        const res = createRes();
        const next = jest.fn();

        await limiter(req, res, next);

        expect(mockRedisClient.pipeline).not.toHaveBeenCalled();
        expect(pipelineExecFn).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
        // memory branch sets count=1 on first hit
        expect(res.headers['X-RateLimit-Remaining']).toBe(4);
    });

    it('falls back to memory store when Redis pipeline rejects (catch branch)', async () => {
        pipelineExecFn.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        const limiter = createRateLimiter({ windowMs: 60000, max: 5 });
        const req = createReq({ ip: '10.0.0.3', path: '/api/err' });
        const res = createRes();
        const next = jest.fn();

        await limiter(req, res, next);

        // Pipeline was attempted, but memory fallback ran.
        expect(mockRedisClient.pipeline).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.headers['X-RateLimit-Remaining']).toBe(4);
    });
});
