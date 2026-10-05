/**
 * Tests for redis-service.js (R5-A focus: the new `setNX` primitive).
 *
 * The service is a thin wrapper over ioredis with a graceful-degradation
 * contract: when the underlying client is not connected, every public
 * method short-circuits to a safe-default return so callers don't need a
 * Redis dependency at call sites.
 *
 * R5-A added `setNX(key, value, ttlSeconds)` as the canonical atomic
 * dedupe primitive. The contract is:
 *   - returns true when the SET actually wrote (reply === 'OK')
 *   - returns false when the key already existed (reply === null)
 *   - returns false when isConnected = false (graceful degrade)
 *   - returns false when ioredis throws (graceful degrade + warn log)
 *   - passes the canonical 'EX', ttl, 'NX' arg shape to ioredis.set
 *   - JSON-serialises the value before write
 */

'use strict';

// ioredis is a heavy native dep that opens a TCP connection on require —
// stub it before requiring redis-service so the test runs hermetically.
jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        connect: jest.fn(),
    }));
});

const redisService = require('../../services/redis-service');

describe('[R5-A] redis-service.setNX', () => {
    let originalIsConnected;
    let originalClient;

    beforeEach(() => {
        originalIsConnected = redisService.isConnected;
        originalClient = redisService.client;
    });

    afterEach(() => {
        redisService.isConnected = originalIsConnected;
        redisService.client = originalClient;
        jest.clearAllMocks();
    });

    it('returns true when ioredis returns "OK" (slot claimed)', async () => {
        const setSpy = jest.fn().mockResolvedValue('OK');
        redisService.client = { set: setSpy };
        redisService.isConnected = true;

        const ok = await redisService.setNX('notify:dedupe:abc123', { deduped: false }, 3600);

        expect(ok).toBe(true);
        expect(setSpy).toHaveBeenCalledTimes(1);
    });

    it('returns false when ioredis returns null (key already exists)', async () => {
        const setSpy = jest.fn().mockResolvedValue(null);
        redisService.client = { set: setSpy };
        redisService.isConnected = true;

        const ok = await redisService.setNX('notify:dedupe:abc123', { deduped: false }, 3600);

        expect(ok).toBe(false);
        expect(setSpy).toHaveBeenCalledTimes(1);
    });

    it('passes the canonical "EX", ttl, "NX" arg shape to ioredis.set', async () => {
        const setSpy = jest.fn().mockResolvedValue('OK');
        redisService.client = { set: setSpy };
        redisService.isConnected = true;

        await redisService.setNX('notify:dedupe:abc', { foo: 'bar' }, 3600);

        // (key, JSON-serialised value, 'EX', ttl, 'NX')
        const [key, value, exFlag, ttl, nxFlag] = setSpy.mock.calls[0];
        expect(key).toBe('notify:dedupe:abc');
        expect(value).toBe(JSON.stringify({ foo: 'bar' }));
        expect(exFlag).toBe('EX');
        expect(ttl).toBe(3600);
        expect(nxFlag).toBe('NX');
    });

    it('returns false when isConnected = false (graceful degrade, no client call)', async () => {
        const setSpy = jest.fn();
        redisService.client = { set: setSpy };
        redisService.isConnected = false;

        const ok = await redisService.setNX('notify:dedupe:xyz', { v: 1 }, 60);

        expect(ok).toBe(false);
        expect(setSpy).not.toHaveBeenCalled();
    });

    it('returns false when ioredis.set rejects (graceful degrade, no throw)', async () => {
        const setSpy = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
        redisService.client = { set: setSpy };
        redisService.isConnected = true;

        const ok = await redisService.setNX('notify:dedupe:abc', { v: 1 }, 60);

        expect(ok).toBe(false);
        expect(setSpy).toHaveBeenCalledTimes(1);
    });

    it('JSON-serialises complex values (objects round-trip cleanly)', async () => {
        const setSpy = jest.fn().mockResolvedValue('OK');
        redisService.client = { set: setSpy };
        redisService.isConnected = true;

        const value = {
            dedupeKey: 'abc',
            deduped: false,
            inApp: { ok: true, id: 'notif-1' },
            email: { ok: true, messageId: 'm-1' },
            sms: { ok: false, skipped: 'NO_PHONE' },
        };
        await redisService.setNX('notify:dedupe:complex', value, 300);

        const serialized = setSpy.mock.calls[0][1];
        expect(JSON.parse(serialized)).toEqual(value);
    });

    it('uses the default TTL of 300s when ttlSeconds is omitted', async () => {
        const setSpy = jest.fn().mockResolvedValue('OK');
        redisService.client = { set: setSpy };
        redisService.isConnected = true;

        await redisService.setNX('notify:dedupe:default-ttl', { x: 1 });

        expect(setSpy.mock.calls[0][3]).toBe(300);
    });
});
