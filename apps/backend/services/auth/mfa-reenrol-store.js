'use strict';

/**
 * Pending second-factor re-enrolment (moving an ENABLED 2FA to a new device).
 *
 * Round 4 (2026-09-26): POST /api/mfa/setup on an account with 2FA enabled needs
 * the current code, and the new secret waits here instead of replacing the live
 * one. Round 5 (security re-review 2026-09-26-no-recovery-round34-review.md,
 * MEDIUM): the door that CONSUMES the entry, /verify-setup, had no link to the
 * session that created it and no attempt count. So the entry now carries:
 *   - `session`  the token id of the session that started it; /verify-setup from
 *                any other session is refused;
 *   - attempts   counted on `<key>:attempts` with an atomic INCR (round 6); at
 *                most 5 codes are ever checked, the 5th wrong one deletes the
 *                entry (restart /setup with the current code).
 * It is also deleted whenever the account's security state changes: /disable,
 * password change, logout, revoke-all-sessions, and a finished re-enrol.
 *
 * Redis, strict: a read or write that cannot reach the store throws
 * RedisUnavailableError, and the routes answer 503 without touching the user row.
 * `clear` is best-effort (it never throws): the entry expires with its TTL and is
 * bound to one session anyway.
 *
 * @module services/auth/mfa-reenrol-store
 */

const redisService = require('../redis-service');
// The plain logger (as routes/api/identity/mfa.js uses it): several suites mock
// shared/logger without createLogger, and this module loads inside all of them.
const logger = require('../../shared/logger');

const REENROL_TTL_SECONDS = 10 * 60;
const MAX_FAILED_CODES = 5;

const keyFor = (userId) => `mfa:reenrol:${userId}`;
// Round 6: attempts are counted on their own key with an atomic INCR (the raw
// pattern rate-limiter.js uses), not read-modify-written on the entry. k parallel
// guesses used to read the same count (security re-review round 5, LOW: k=5 → 15
// codes checked). Each attempt now claims a unique number BEFORE its code is
// checked, and only numbers 1..MAX_FAILED_CODES may check a code.
const attemptsKeyFor = (userId) => `mfa:reenrol:${userId}:attempts`;

async function start(userId, { secret, session }) {
    const entry = {
        secret,
        session,
        expiresAt: Date.now() + REENROL_TTL_SECONDS * 1000,
    };
    // A new re-enrol starts from zero attempts.
    await redisService.delStrict(attemptsKeyFor(userId));
    await redisService.setStrict(keyFor(userId), entry, REENROL_TTL_SECONDS);
    return entry;
}

/**
 * Claim one code check, atomically. INCR + PEXPIRE in one pipeline; the counter
 * dies with the entry (same deadline).
 * @returns {Promise<{attempt: number, allowed: boolean}>} allowed = attempt ≤ MAX_FAILED_CODES
 * @throws {RedisUnavailableError} when the store cannot answer (the route says 503)
 */
async function claimAttempt(userId, entry) {
    const key = attemptsKeyFor(userId);
    const client = redisService.client;
    if (!redisService.isConnected || !client) {
        throw new redisService.RedisUnavailableError('INCR', key);
    }
    let results;
    try {
        const ttlMs = Math.max(1000, (Number(entry?.expiresAt) || 0) - Date.now());
        results = await client.pipeline().incr(key).pexpire(key, ttlMs).exec();
    } catch (err) {
        throw new redisService.RedisUnavailableError('INCR', key, err);
    }
    const [incrErr, attempt] = results?.[0] || [];
    if (incrErr || typeof attempt !== 'number') {
        throw new redisService.RedisUnavailableError('INCR', key, incrErr);
    }
    return { attempt, allowed: attempt <= MAX_FAILED_CODES };
}

async function read(userId) {
    return redisService.getStrict(keyFor(userId));
}

/**
 * After a wrong code: the attempt that reaches MAX_FAILED_CODES deletes the entry.
 * @returns {Promise<{exhausted: boolean, failures: number}>}
 */
async function recordFailure(userId, attempt) {
    if (attempt >= MAX_FAILED_CODES) {
        await redisService.delStrict(keyFor(userId));
        await redisService.delStrict(attemptsKeyFor(userId));
        return { exhausted: true, failures: attempt };
    }
    return { exhausted: false, failures: attempt };
}

async function clear(userId, reason) {
    if (!userId) { return; }
    try {
        await redisService.delStrict(keyFor(userId));
        await redisService.delStrict(attemptsKeyFor(userId));
    } catch (err) {
        logger.warn(`[mfa-reenrol] pending entry not cleared (${reason || 'unspecified'}): ${err?.message}`);
    }
}

module.exports = { start, read, claimAttempt, recordFailure, clear, keyFor, attemptsKeyFor, REENROL_TTL_SECONDS, MAX_FAILED_CODES };
