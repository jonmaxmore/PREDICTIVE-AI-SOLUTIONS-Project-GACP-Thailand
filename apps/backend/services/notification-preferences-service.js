/**
 * @module services/notification-preferences-service
 *
 * Per-user opt-out for notification channels (Phase 7).
 *
 * Stored as JSON on User.notificationSettings (column already exists in
 * the auth schema; no migration needed). Shape:
 *
 *   {
 *     channels: {
 *       <NotifyType>: { inApp: boolean }
 *     }
 *   }
 *
 * Default-allow semantics: a missing key OR a missing channel field is
 * treated as enabled. Users only need to flip the ones they want OFF.
 *
 * sendNotification consults isAllowed(user, type, 'inApp') before
 * writing to the notifications table — the only channel this module
 * still governs.
 *
 * External-services cleanup, Task 4 (2026-08-19): the email/SMS channel
 * concept is removed — business email/SMS dispatch was already retired
 * from the dispatch paths in Tasks 1-3 (operator decision, 2026-08-13,
 * shared/notification-view.js:16-19), so opting a TYPE out of a channel
 * that no longer sends is meaningless. `SUPPORTED_CHANNELS` now lists
 * only `inApp`; `email`/`sms` fall through `isAllowed()`'s
 * `SUPPORTED_CHANNELS.includes(channel)` guard exactly like any other
 * unrecognized channel name and always default-allow. Values already
 * persisted with legacy `email`/`sms` sub-keys (from before this
 * change) are TOLERATED on read: `normalize()` only ever copies fields
 * named in `SUPPORTED_CHANNELS`, so the legacy keys are silently
 * dropped rather than crashing or corrupting the surviving `inApp`
 * field — pinned in notification-preferences-service.test.js
 * ("legacy-shaped stored value ... does not crash").
 */

'use strict';

const { prisma } = require('./prisma-database');
const logger = require('../shared/logger');

const SUPPORTED_CHANNELS = ['inApp'];

function normalizeChannelObject(value) {
    if (!value || typeof value !== 'object') {return {};}
    const out = {};
    for (const ch of SUPPORTED_CHANNELS) {
        if (typeof value[ch] === 'boolean') {out[ch] = value[ch];}
    }
    return out;
}

function normalize(settings) {
    const obj = settings && typeof settings === 'object' ? settings : {};
    const channels = obj.channels && typeof obj.channels === 'object' ? obj.channels : {};
    const normalized = {};
    for (const [type, val] of Object.entries(channels)) {
        normalized[String(type)] = normalizeChannelObject(val);
    }
    return { channels: normalized };
}

async function getPrefs(userId) {
    if (!userId) {return { channels: {} };}
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { notificationSettings: true },
    });
    return normalize(user?.notificationSettings);
}

async function updatePrefs(userId, prefs) {
    if (!userId) {throw new Error('userId required');}
    const normalized = normalize(prefs);
    await prisma.user.update({
        where: { id: userId },
        data: { notificationSettings: normalized },
    });
    return normalized;
}

/**
 * Resolve a user's preferences for a single (type, channel) — defaults
 * to true when the field is missing.  Accepts either a userId or the
 * already-loaded settings object so callers in the dispatch path can
 * skip the DB round-trip when the setting is already in scope.
 */
async function isAllowed({ userId, settings, type, channel }) {
    if (!type || !SUPPORTED_CHANNELS.includes(channel)) {return true;}
    let resolved = settings;
    if (!resolved && userId) {
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { notificationSettings: true },
            });
            resolved = user?.notificationSettings;
        } catch (e) {
            // DB hiccup → default-allow so a notification isn't lost
            logger.warn(`[notification-prefs] read failed for ${userId}: ${e?.message}`);
            return true;
        }
    }
    const norm = normalize(resolved);
    const entry = norm.channels[type];
    if (!entry) {return true;} // no opt-out for this type
    return entry[channel] !== false; // default-allow
}

module.exports = {
    SUPPORTED_CHANNELS,
    getPrefs,
    updatePrefs,
    isAllowed,
    normalize,
};
