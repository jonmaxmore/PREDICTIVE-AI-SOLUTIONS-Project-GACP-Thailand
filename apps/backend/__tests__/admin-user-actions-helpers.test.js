/**
 * Unit tests for admin-user-actions-helpers — Wave B Phase 55 (G6).
 *
 * Pure-function tests for the Prisma update payload builders + caller
 * role guard. Route-level integration is exercised separately via
 * supertest fixtures.
 */

'use strict';

const path = require('path');

const helpersPath = path.resolve(
    __dirname,
    '../routes/api/provider/handlers/admin-user-actions-helpers.js',
);

function load() {
    jest.resetModules();
    return require(helpersPath);
}

// มติ operator 2026-09-17 "เราไม่มีการกู้บัญชี": the force-password-reset action
// and its token builders (hashResetToken / generateResetToken /
// buildForceResetPayload) are gone. Pinned by the exported surface, so a
// builder that comes back under another name is caught too.
// มติ operator 2026-09-26 "ถอดทั้งสองประตู": buildDisableTwoFactorPayload (ผู้ดูแลปิด 2FA ของคนอื่น) ถูกถอดด้วย
describe('no password-reset or 2FA-clearing builder is exported', () => {
    it('exports only the unlock builder and the caller guard', () => {
        expect(Object.keys(load()).sort()).toEqual([
            'buildUnlockPayload',
            'isAdminCaller',
        ]);
    });
});

describe('buildUnlockPayload', () => {
    it('clears lock flag, lockedUntil, and loginAttempts', () => {
        const { buildUnlockPayload } = load();
        const payload = buildUnlockPayload('admin-1');
        expect(payload.isLocked).toBe(false);
        expect(payload.lockedUntil).toBeNull();
        expect(payload.loginAttempts).toBe(0);
    });

    it('records updatedBy from the actor', () => {
        const { buildUnlockPayload } = load();
        expect(buildUnlockPayload('admin-1').updatedBy).toBe('admin-1');
    });

    it('falls back to null updatedBy when actorId missing', () => {
        const { buildUnlockPayload } = load();
        expect(buildUnlockPayload(null).updatedBy).toBeNull();
        expect(buildUnlockPayload(undefined).updatedBy).toBeNull();
    });

    it('sets updatedAt to a Date', () => {
        const { buildUnlockPayload } = load();
        expect(buildUnlockPayload('x').updatedAt).toBeInstanceOf(Date);
    });
});

describe('isAdminCaller', () => {
    it('รับผู้ดูแลทั้งสองฝั่ง ไม่สนตัวพิมพ์', () => {
        const { isAdminCaller } = load();
        expect(isAdminCaller('system_admin_dtam')).toBe(true);
        expect(isAdminCaller('SYSTEM_ADMIN_DTAM')).toBe(true);
        expect(isAdminCaller('system_admin_platform')).toBe(true);
        expect(isAdminCaller('  System_Admin_Platform  ')).toBe(true);
        // คำเก่าต้องถูกปฏิเสธ — ไม่ใช่ผ่านเพราะเคยเป็นผู้ดูแล
        expect(isAdminCaller('admin')).toBe(false);
        expect(isAdminCaller('super_admin')).toBe(false);
    });

    it('rejects every other role', () => {
        const { isAdminCaller } = load();
        expect(isAdminCaller('REVIEWER_AUDITOR')).toBe(false);
        expect(isAdminCaller('AUDITOR')).toBe(false);
        expect(isAdminCaller('SCHEDULER')).toBe(false);
        expect(isAdminCaller('ACCOUNTANT')).toBe(false);
        expect(isAdminCaller('HEALTH')).toBe(false);
    });

    it('rejects null/undefined/empty', () => {
        const { isAdminCaller } = load();
        expect(isAdminCaller(null)).toBe(false);
        expect(isAdminCaller(undefined)).toBe(false);
        expect(isAdminCaller('')).toBe(false);
    });
});
