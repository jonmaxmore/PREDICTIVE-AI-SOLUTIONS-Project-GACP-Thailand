/**
 * notification-preferences-service unit tests — Phase 7.
 *
 * External-services cleanup, Task 4 (2026-08-19): the email/SMS channel
 * concept is removed from this module — only `inApp` is a supported
 * channel now (business email/SMS dispatch was retired in Tasks 1-3).
 * Users have prefs already persisted in the old `{ email, inApp, sms }`
 * per-type shape; those legacy sub-keys MUST be tolerated on read (not
 * crash, not corrupt the rest of the value) — see the dedicated
 * "legacy JSON tolerance" pin below.
 *
 *  - normalize: drops unknown keys (incl. legacy email/sms) + non-boolean values
 *  - getPrefs: returns shape from User.notificationSettings; legacy shape tolerated
 *  - updatePrefs: writes normalized (in-app-only) JSON
 *  - isAllowed: default-allow when missing; respects explicit false; email/sms
 *    channels are no longer supported (always default-allow, channel concept removed)
 */

'use strict';

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const dbState = { users: {} };
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(async ({ where }) => dbState.users[where.id] || null),
            update: jest.fn(async ({ where, data }) => {
                dbState.users[where.id] = { ...dbState.users[where.id], ...data };
                return dbState.users[where.id];
            }),
        },
    },
}));

const prefs = require('../../services/notification-preferences-service');

beforeEach(() => {
    jest.clearAllMocks();
    dbState.users = {};
});

describe('normalize', () => {
    test('returns empty channels for null/undefined input', () => {
        expect(prefs.normalize(null)).toEqual({ channels: {} });
        expect(prefs.normalize(undefined)).toEqual({ channels: {} });
        expect(prefs.normalize({})).toEqual({ channels: {} });
    });

    test('drops legacy email/sms keys plus any other unknown key (channel concept removed — in-app only)', () => {
        const out = prefs.normalize({
            channels: {
                FOO: { email: true, weird: true, sms: false, inApp: true },
            },
        });
        expect(out.channels.FOO).toEqual({ inApp: true });
    });

    test('drops non-boolean channel values', () => {
        const out = prefs.normalize({
            channels: {
                FOO: { email: 'yes', inApp: 0, sms: false },
            },
        });
        expect(out.channels.FOO).toEqual({});
    });
});

describe('getPrefs', () => {
    test('returns empty channels for unknown user', async () => {
        const r = await prefs.getPrefs('missing');
        expect(r).toEqual({ channels: {} });
    });

    test('returns normalized notificationSettings (in-app only)', async () => {
        dbState.users['u-1'] = {
            notificationSettings: {
                channels: { WORK_ACTIVITY_BREACH: { email: false, sms: true, inApp: true } },
            },
        };
        const r = await prefs.getPrefs('u-1');
        expect(r.channels.WORK_ACTIVITY_BREACH).toEqual({ inApp: true });
    });

    // Legacy JSON tolerance pin (Task 4, external-services cleanup): a
    // value persisted BEFORE this cleanup may carry ONLY email/sms keys
    // (no `inApp` was ever written for it, because the old default-allow
    // UI never touched it). Reading it back must not crash and must not
    // corrupt the entry — it normalizes to an empty object (nothing
    // opted out), same as if the type had never been configured.
    test('legacy-shaped stored value (email/sms only, no inApp ever written) does not crash — normalizes to empty entry', async () => {
        dbState.users['u-legacy'] = {
            notificationSettings: {
                channels: { APPLICATION_SUBMITTED: { email: true, sms: true } },
            },
        };
        const r = await prefs.getPrefs('u-legacy');
        expect(r.channels.APPLICATION_SUBMITTED).toEqual({});

        const ok = await prefs.isAllowed({
            userId: 'u-legacy', type: 'APPLICATION_SUBMITTED', channel: 'inApp',
        });
        expect(ok).toBe(true); // default-allow: legacy blob never recorded an inApp opt-out
    });
});

describe('updatePrefs', () => {
    test('writes normalized JSON (in-app only — email/sms are dropped on write)', async () => {
        await prefs.updatePrefs('u-1', {
            channels: {
                FOO: { email: true, junk: 'x', inApp: false },
                BAR: 'not-an-object',
            },
        });
        const stored = dbState.users['u-1'].notificationSettings;
        expect(stored.channels.FOO).toEqual({ inApp: false });
        expect(stored.channels.BAR).toEqual({});
    });
});

describe('isAllowed', () => {
    test('default-allow when no settings', async () => {
        const ok = await prefs.isAllowed({ settings: null, type: 'X', channel: 'inApp' });
        expect(ok).toBe(true);
    });

    test('default-allow when type missing', async () => {
        const ok = await prefs.isAllowed({
            settings: { channels: { OTHER: { inApp: false } } },
            type: 'X',
            channel: 'inApp',
        });
        expect(ok).toBe(true);
    });

    test('default-allow when channel missing for the type', async () => {
        const ok = await prefs.isAllowed({
            settings: { channels: { X: { email: false } } },
            type: 'X',
            channel: 'inApp',
        });
        expect(ok).toBe(true);
    });

    test('returns false when explicitly opted out', async () => {
        const ok = await prefs.isAllowed({
            settings: { channels: { X: { inApp: false } } },
            type: 'X',
            channel: 'inApp',
        });
        expect(ok).toBe(false);
    });

    test('falls back to DB lookup when only userId is given', async () => {
        dbState.users['u-1'] = {
            notificationSettings: { channels: { X: { inApp: false } } },
        };
        const ok = await prefs.isAllowed({ userId: 'u-1', type: 'X', channel: 'inApp' });
        expect(ok).toBe(false);
    });

    test('returns true when channel is unknown', async () => {
        const ok = await prefs.isAllowed({ settings: {}, type: 'X', channel: 'pigeon' });
        expect(ok).toBe(true);
    });

    // Channel-concept-removed pin (Task 4): 'email'/'sms' are no longer
    // SUPPORTED_CHANNELS at all — isAllowed() always default-allows for
    // them now, regardless of what a legacy stored value says, because
    // this module no longer recognizes those channels to opt out of.
    test('email/sms channels no longer supported — always default-allow, even when the legacy value says opted-out', async () => {
        dbState.users['u-1'] = {
            notificationSettings: { channels: { X: { sms: false, email: false, inApp: false } } },
        };
        const okSms = await prefs.isAllowed({ userId: 'u-1', type: 'X', channel: 'sms' });
        const okEmail = await prefs.isAllowed({ userId: 'u-1', type: 'X', channel: 'email' });
        expect(okSms).toBe(true);
        expect(okEmail).toBe(true);
    });
});
