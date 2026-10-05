/**
 * Redis Service - Cache Layer for GACP Backend
 * 
 * Features:
 * - Connection pooling with ioredis
 * - Auto-reconnect and error handling
 * - JSON serialization support
 * - Cache patterns (get, set, invalidate)
 * - Graceful degradation when Redis is unavailable
 * 
 * Usage:
 *   const cache = require('./services/RedisService');
 *   await cache.set('user:123', userData, 300); // 5 min TTL
 *   const data = await cache.get('user:123');
 */

const Redis = require('ioredis');
const { createLogger } = require('../shared/logger');
const logger = createLogger('redis-service');

/**
 * ── TWO CONTRACTS, ON PURPOSE (W1-5, 2026-08-22) ─────────────────────────
 * `get`/`set`/`setNX`/`del`/`invalidatePattern` are the CACHE contract:
 * they never throw, and they collapse "store unavailable" into the same
 * return value as "key absent" (null / false). That is correct for a cache
 * — routes/api/documents/reports.js and friends simply re-query Postgres.
 *
 * `getStrict`/`setStrict` are the AUTHORITATIVE contract: they REJECT with
 * a `RedisUnavailableError` when the store cannot answer, so a security
 * decision can tell "this token is not revoked" apart from "I could not
 * find out whether this token is revoked". Token blocklists, session-family
 * blocklists and OTP/MFA lookups MUST use these — collapsing the two cases
 * there is a fail-OPEN vulnerability: a Redis outage made every blocklisted
 * refresh token look valid for its full 7-day TTL, and the fail-CLOSED
 * `catch` branches written to prevent exactly that were unreachable code.
 *
 * Rule of thumb: if the answer decides whether a credential is honoured,
 * use the strict accessor. If the answer only decides whether you skip a
 * database round-trip, use the cache accessor.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Raised by the strict accessors when the store could not answer.
 * Deliberately distinct from "the key is absent" (which resolves to null);
 * callers on authoritative paths branch on `code === 'REDIS_UNAVAILABLE'`.
 *
 * The message carries only the operation and the key's NAMESPACE (the text
 * before the first ':'), never the full key — auth keys embed a jti, a
 * userId or an OTP-scoped identifier, and those must not reach logs.
 */
class RedisUnavailableError extends Error {
    constructor(op, key, cause) {
        const namespace = String(key || '').split(':')[0] || 'unknown';
        super(`Redis unavailable during ${op} on namespace "${namespace}"`);
        this.name = 'RedisUnavailableError';
        this.code = 'REDIS_UNAVAILABLE';
        this.op = op;
        this.namespace = namespace;
        if (cause) { this.cause = cause; }
    }
}

class RedisService {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.connectionAttempts = 0;
        this.maxRetries = 3;
    }

    /**
     * Initialize Redis connection
     */
    async connect() {
        if (this.client && this.isConnected) {
            return this.client;
        }

        const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

        try {
            this.client = new Redis(redisUrl, {
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
                enableReadyCheck: true,
                lazyConnect: true,
                showFriendlyErrorStack: process.env.NODE_ENV !== 'production',
            });

            // Event handlers
            this.client.on('connect', () => {
                this.isConnected = true;
                this.connectionAttempts = 0;
                logger.info('Redis connected successfully');
            });

            this.client.on('error', (err) => {
                this.isConnected = false;
                logger.warn('Redis connection error (graceful degradation active):', err.message);
            });

            this.client.on('close', () => {
                this.isConnected = false;
                logger.info('Redis connection closed');
            });

            await this.client.connect();
            return this.client;
        } catch (error) {
            this.isConnected = false;
            logger.warn('Redis unavailable, running without cache:', error.message);
            return null;
        }
    }

    /**
     * Internal read. Throws on ANY inability to answer; the two public
     * accessors decide what to do with that. Single implementation so the
     * cache path and the authoritative path can never drift in how they
     * talk to ioredis or parse the payload.
     *
     * @private
     * @throws {RedisUnavailableError} not connected, or the client rejected
     */
    async _read(key) {
        if (!this.isConnected || !this.client) {
            throw new RedisUnavailableError('GET', key);
        }
        let value;
        try {
            value = await this.client.get(key);
        } catch (error) {
            throw new RedisUnavailableError('GET', key, error);
        }
        if (value) {
            logger.debug(`Cache HIT: ${key}`);
            return JSON.parse(value);
        }
        logger.debug(`Cache MISS: ${key}`);
        return null;
    }

    /**
     * Internal write. Same contract as `_read`.
     *
     * @private
     * @throws {RedisUnavailableError} not connected, or the client rejected
     */
    async _write(key, value, ttlSeconds) {
        if (!this.isConnected || !this.client) {
            throw new RedisUnavailableError('SET', key);
        }
        try {
            await this.client.setex(key, ttlSeconds, JSON.stringify(value));
        } catch (error) {
            throw new RedisUnavailableError('SET', key, error);
        }
        logger.debug(`Cache SET: ${key} (TTL: ${ttlSeconds}s)`);
        return true;
    }

    /**
     * Get value from cache — CACHE contract (graceful degradation).
     *
     * Returns null both when the key is absent AND when Redis cannot be
     * reached. Callers that must tell those apart (anything deciding
     * whether a credential is honoured) MUST use `getStrict` instead.
     *
     * @param {string} key - Cache key
     * @returns {Promise<any>} - Parsed value, or null (miss OR store down)
     */
    async get(key) {
        try {
            return await this._read(key);
        } catch (error) {
            // Not-connected is the expected steady state in dev/test — keep it
            // quiet; a genuine client error is worth a warn.
            if (error instanceof RedisUnavailableError && !error.cause) {
                return null;
            }
            logger.warn(`Cache GET error for ${key}:`, (error.cause || error).message);
            return null;
        }
    }

    /**
     * Get value — AUTHORITATIVE contract (fail-closed capable).
     *
     * Resolves the parsed value on a hit, `null` on a genuine miss against a
     * healthy store, and REJECTS with `RedisUnavailableError` when the store
     * could not answer. Use on every path where "no entry" and "cannot check"
     * must lead to different decisions: token blocklists, the refresh-token
     * allowlist, session-family blocklists, OTP/MFA lookups.
     *
     * @param {string} key
     * @returns {Promise<any>} parsed value, or null when genuinely absent
     * @throws {RedisUnavailableError} when the store is unreachable
     */
    async getStrict(key) {
        return this._read(key);
    }

    /**
     * Set value in cache — CACHE contract (graceful degradation).
     *
     * Returns false both when Redis is unreachable AND when the write failed.
     * Callers whose write is a security decision (recording a revocation)
     * MUST use `setStrict` so the failure cannot be swallowed.
     *
     * @param {string} key - Cache key
     * @param {any} value - Value to cache (will be JSON stringified)
     * @param {number} ttlSeconds - Time to live in seconds (default: 300 = 5 min)
     */
    async set(key, value, ttlSeconds = 300) {
        try {
            return await this._write(key, value, ttlSeconds);
        } catch (error) {
            if (error instanceof RedisUnavailableError && !error.cause) {
                return false;
            }
            logger.warn(`Cache SET error for ${key}:`, (error.cause || error).message);
            return false;
        }
    }

    /**
     * Set value — AUTHORITATIVE contract (fail-closed capable).
     *
     * Resolves true on a confirmed write; REJECTS with `RedisUnavailableError`
     * otherwise. Use where a swallowed write means a revocation silently did
     * not happen (e.g. `invalidateSessionFamily` on refresh-token reuse).
     *
     * @param {string} key
     * @param {any} value
     * @param {number} ttlSeconds
     * @returns {Promise<true>}
     * @throws {RedisUnavailableError} when the store is unreachable
     */
    async setStrict(key, value, ttlSeconds = 300) {
        return this._write(key, value, ttlSeconds);
    }

    /**
     * Atomic SET-IF-NOT-EXISTS (NX) with TTL.
     *
     * Wraps `SET key value EX <ttl> NX` so callers can claim a dedupe slot
     * atomically across processes/pods. Returns true only when this call
     * actually wrote the key — when the key already existed (or Redis is
     * unavailable), returns false. This is the canonical primitive for
     * cross-instance dedupe (notification-fanout-service R5-A) and may be
     * reused by future allocators that need a distributed lock-lite.
     *
     * Failure semantics:
     * - Redis disconnected → returns false (caller treats as "did not write";
     *   combined with a prior get() check this gives graceful-degrade-to-non-
     *   dedupe rather than fail-closed)
     * - Redis throws → returns false + warn log; same graceful degradation
     *
     * @param {string} key
     * @param {any} value - JSON-serialized before write
     * @param {number} ttlSeconds
     * @returns {Promise<boolean>} true if SET happened (new key), false otherwise
     */
    async setNX(key, value, ttlSeconds = 300) {
        if (!this.isConnected) {return false;}

        try {
            const serialized = JSON.stringify(value);
            const reply = await this.client.set(key, serialized, 'EX', ttlSeconds, 'NX');
            const ok = reply === 'OK';
            logger.debug(`Cache SETNX: ${key} → ${ok ? 'CLAIMED' : 'EXISTS'} (TTL: ${ttlSeconds}s)`);
            return ok;
        } catch (error) {
            logger.warn(`Cache SETNX error for ${key}:`, error.message);
            return false;
        }
    }

    /**
     * Delete a specific key — CACHE contract (graceful degradation).
     * @param {string} key - Cache key to delete
     */
    async del(key) {
        try {
            return await this._delete(key);
        } catch (error) {
            if (error instanceof RedisUnavailableError && !error.cause) {
                return false;
            }
            logger.warn(`Cache DEL error for ${key}:`, (error.cause || error).message);
            return false;
        }
    }

    /**
     * Internal delete. Throws when the store cannot answer.
     * @private
     * @throws {RedisUnavailableError}
     */
    async _delete(key) {
        if (!this.isConnected || !this.client) {
            throw new RedisUnavailableError('DEL', key);
        }
        try {
            await this.client.del(key);
        } catch (error) {
            throw new RedisUnavailableError('DEL', key, error);
        }
        logger.debug(`Cache DEL: ${key}`);
        return true;
    }

    /**
     * Delete a key — AUTHORITATIVE contract (fail-closed capable).
     *
     * Use where a swallowed delete means a revocation silently did not happen
     * (e.g. dropping a refresh-token allowlist entry on logout). A `false`
     * return from `del()` cannot be told apart from "the key was not there".
     *
     * @param {string} key
     * @returns {Promise<true>}
     * @throws {RedisUnavailableError} when the store is unreachable
     */
    async delStrict(key) {
        return this._delete(key);
    }

    /**
     * Invalidate all keys matching a pattern
     * @param {string} pattern - Redis pattern (e.g., "user:*")
     */
    async invalidatePattern(pattern) {
        if (!this.isConnected) {return false;}

        try {
            // Use SCAN instead of KEYS to avoid blocking Redis in production
            const keys = [];
            let cursor = '0';
            do {
                const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = nextCursor;
                keys.push(...batch);
            } while (cursor !== '0');

            if (keys.length > 0) {
                await this.client.del(...keys);
                logger.debug(`Cache INVALIDATE: ${pattern} (${keys.length} keys)`);
            }
            return true;
        } catch (error) {
            logger.warn(`Cache INVALIDATE error for ${pattern}:`, error.message);
            return false;
        }
    }

    /**
     * Get or set pattern (cache-aside)
     * @param {string} key - Cache key
     * @param {Function} fetchFn - Function to fetch data if not cached
     * @param {number} ttlSeconds - TTL for cached data
     */
    async getOrSet(key, fetchFn, ttlSeconds = 300) {
        // Try cache first
        const cached = await this.get(key);
        if (cached !== null) {
            return cached;
        }

        // Fetch fresh data
        const fresh = await fetchFn();

        // Cache the result
        await this.set(key, fresh, ttlSeconds);

        return fresh;
    }

    /**
     * Check if Redis is available
     */
    isAvailable() {
        return this.isConnected;
    }

    /**
     * Get cache statistics
     */
    async getStats() {
        if (!this.isConnected) {
            return { connected: false };
        }

        try {
            const info = await this.client.info('stats');
            const keyspace = await this.client.info('keyspace');
            return {
                connected: true,
                info: info.substring(0, 500),
                keyspace,
            };
        } catch {
            return { connected: false };
        }
    }

    /**
     * Graceful shutdown
     */
    async disconnect() {
        if (this.client) {
            await this.client.quit();
            this.isConnected = false;
            logger.info('Redis disconnected gracefully');
        }
    }
}

// Singleton instance
const redisService = new RedisService();

// Cache key generators for consistent naming
const CacheKeys = {
    userSession: (userId) => `session:${userId}`,
    userApplications: (userId) => `apps:user:${userId}`,
    applicationDetail: (appId) => `apps:detail:${appId}`,
    jwtDecoded: (tokenHash) => `jwt:${tokenHash}`,
};

module.exports = redisService;
module.exports.CacheKeys = CacheKeys;
// Exported so authoritative callers can branch on the failure type rather
// than string-matching a message. `instanceof` works because there is a
// single module instance (Node's require cache).
module.exports.RedisUnavailableError = RedisUnavailableError;

