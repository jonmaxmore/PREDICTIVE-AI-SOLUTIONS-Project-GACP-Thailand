/**
 * Y1-FIX-D — Thai error-code mapping for the admin modals (ForceMfaResetModal
 * and its FORCE_MFA_RESET_ERROR_MAP were removed 2026-09-26 — operator
 * "ถอดทั้งสองประตู": no one clears another account's 2FA).
 *
 * Codifies Policy 5 from `docs/i18n-policy.md`: backend returns stable
 * English `code` identifiers (e.g. `SELF_ROLE_CHANGE_FORBIDDEN`,
 * `USER_NOT_FOUND`); each admin modal renders a Thai message via a
 * locally-exported `*_ERROR_MAP` consumed through the shared
 * `resolveErrorCode` helper in `@/lib/i18n/error-code-map`.
 *
 * Pure-helper test pattern — we exercise the exported maps directly
 * rather than rendering the modals and chasing a sonner toast through
 * jsdom.
 */

import { describe, expect, it } from '@jest/globals';
import { resolveErrorCode, hasMappedErrorCode } from '@/lib/i18n/error-code-map';
import { CHANGE_ROLE_ERROR_MAP } from '../ChangeRoleModal';
import { USER_DISABLE_ERROR_MAP } from '../UserDisableModal';
import { FORCE_STATUS_ERROR_MAP } from '../ForceStatusModal';

describe('[Y1-FIX-D] CHANGE_ROLE_ERROR_MAP (Policy 5)', () => {
    it('maps SELF_ROLE_CHANGE_FORBIDDEN to a Thai self-target message', () => {
        const msg = resolveErrorCode(
            { code: 'SELF_ROLE_CHANGE_FORBIDDEN', error: 'cannot change own role' },
            CHANGE_ROLE_ERROR_MAP,
            'ไม่สามารถเปลี่ยนบทบาทได้',
        );
        expect(msg).toContain('ผู้ดูแลระบบ');
        expect(msg).toContain('ตนเอง');
        // Backend's English message MUST NOT leak past the Thai map.
        expect(msg).not.toContain('cannot change');
    });

    it('maps ROLE_ADMIN_CANNOT_BE_LAST to a Thai "last admin" message', () => {
        const msg = resolveErrorCode(
            { code: 'ROLE_ADMIN_CANNOT_BE_LAST' },
            CHANGE_ROLE_ERROR_MAP,
            'fallback',
        );
        expect(msg).toContain('ADMIN');
        expect(msg).toContain('คนสุดท้าย');
    });

    it('maps ROLE_DOWNGRADE_FORBIDDEN to a Thai status-blocked message', () => {
        const msg = resolveErrorCode(
            { code: 'ROLE_DOWNGRADE_FORBIDDEN' },
            CHANGE_ROLE_ERROR_MAP,
            'fallback',
        );
        expect(msg).toContain('บทบาท');
    });

    it('maps USER_NOT_FOUND to a Thai not-found message', () => {
        const msg = resolveErrorCode(
            { code: 'USER_NOT_FOUND' },
            CHANGE_ROLE_ERROR_MAP,
            'fallback',
        );
        expect(msg).toContain('ไม่พบ');
    });

    it('falls back to envelope error when code is unmapped', () => {
        const msg = resolveErrorCode(
            { code: 'WEIRD_UPSTREAM', error: 'Backend exact text' },
            CHANGE_ROLE_ERROR_MAP,
            'fallback',
        );
        expect(msg).toBe('Backend exact text');
    });

    it('falls back to caller fallback when no code / error present', () => {
        expect(resolveErrorCode({}, CHANGE_ROLE_ERROR_MAP, 'fallback')).toBe('fallback');
        expect(resolveErrorCode(null, CHANGE_ROLE_ERROR_MAP, 'fallback')).toBe('fallback');
    });
});

describe('[Y1-FIX-D] USER_DISABLE_ERROR_MAP (Policy 5)', () => {
    it('maps SELF_DISABLE_FORBIDDEN to a Thai self-target message', () => {
        const msg = resolveErrorCode(
            { code: 'SELF_DISABLE_FORBIDDEN' },
            USER_DISABLE_ERROR_MAP,
            'fallback',
        );
        expect(msg).toContain('ผู้ดูแลระบบ');
        expect(msg).toContain('ตนเอง');
    });

    it('maps USER_ALREADY_DISABLED to a Thai already-state message', () => {
        const msg = resolveErrorCode(
            { code: 'USER_ALREADY_DISABLED' },
            USER_DISABLE_ERROR_MAP,
            'fallback',
        );
        expect(msg).toContain('ระงับ');
    });

    it('maps USER_HAS_PENDING_APPLICATIONS to a Thai pending-work message', () => {
        const msg = resolveErrorCode(
            { code: 'USER_HAS_PENDING_APPLICATIONS' },
            USER_DISABLE_ERROR_MAP,
            'fallback',
        );
        expect(msg).toContain('คำขอ');
        expect(msg).toContain('ดำเนินการ');
    });

    it('maps ALREADY_ACTIVE to a Thai enable-no-op message', () => {
        const msg = resolveErrorCode(
            { code: 'ALREADY_ACTIVE' },
            USER_DISABLE_ERROR_MAP,
            'fallback',
        );
        expect(msg).toContain('เปิดใช้งาน');
    });
});

describe('[Y1-FIX-D] FORCE_STATUS_ERROR_MAP (Policy 5)', () => {
    it('maps INVALID_STATE_TRANSITION to a Thai workflow message', () => {
        const msg = resolveErrorCode(
            { code: 'INVALID_STATE_TRANSITION' },
            FORCE_STATUS_ERROR_MAP,
            'fallback',
        );
        expect(msg).toContain('สถานะ');
    });

    it('maps APPLICATION_LOCKED to a Thai temporary-lock message', () => {
        const msg = resolveErrorCode(
            { code: 'APPLICATION_LOCKED' },
            FORCE_STATUS_ERROR_MAP,
            'fallback',
        );
        expect(msg).toContain('ล็อก');
        expect(msg).toContain('รีเฟรช');
    });

    it('maps APPLICATION_NOT_FOUND to a Thai not-found message', () => {
        const msg = resolveErrorCode(
            { code: 'APPLICATION_NOT_FOUND' },
            FORCE_STATUS_ERROR_MAP,
            'fallback',
        );
        expect(msg).toContain('ไม่พบ');
    });

    it('aliases INVALID_TRANSITION to the same copy as INVALID_STATE_TRANSITION', () => {
        const a = resolveErrorCode({ code: 'INVALID_TRANSITION' }, FORCE_STATUS_ERROR_MAP, 'fb');
        const b = resolveErrorCode({ code: 'INVALID_STATE_TRANSITION' }, FORCE_STATUS_ERROR_MAP, 'fb');
        expect(a).toBe(b);
    });
});

describe('[Y1-FIX-D] hasMappedErrorCode helper', () => {
    it('returns true for codes present in the map', () => {
        expect(hasMappedErrorCode('SELF_DISABLE_FORBIDDEN', USER_DISABLE_ERROR_MAP)).toBe(true);
        expect(hasMappedErrorCode('INVALID_STATE_TRANSITION', FORCE_STATUS_ERROR_MAP)).toBe(true);
    });

    it('returns false for missing / null / empty codes', () => {
        expect(hasMappedErrorCode('NOT_IN_MAP', USER_DISABLE_ERROR_MAP)).toBe(false);
        expect(hasMappedErrorCode(null, USER_DISABLE_ERROR_MAP)).toBe(false);
        expect(hasMappedErrorCode(undefined, USER_DISABLE_ERROR_MAP)).toBe(false);
        expect(hasMappedErrorCode('', USER_DISABLE_ERROR_MAP)).toBe(false);
    });
});

describe('[Y1-FIX-D] cross-cutting Policy 5 invariants', () => {
    const MAPS: ReadonlyArray<{ name: string; map: Readonly<Record<string, string>> }> = [
        { name: 'CHANGE_ROLE_ERROR_MAP', map: CHANGE_ROLE_ERROR_MAP },
        { name: 'USER_DISABLE_ERROR_MAP', map: USER_DISABLE_ERROR_MAP },
        { name: 'FORCE_STATUS_ERROR_MAP', map: FORCE_STATUS_ERROR_MAP },
    ];

    it.each(MAPS)('$name has at least one entry', ({ map }) => {
        expect(Object.keys(map).length).toBeGreaterThan(0);
    });

    it.each(MAPS)('$name values are all Thai (contain ก-๙ characters)', ({ map }) => {
        for (const [code, message] of Object.entries(map)) {
            expect(message).toMatch(/[฀-๿]/);
            // Codes must be UPPER_SNAKE (English machine identifier).
            expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
        }
    });

    it.each(MAPS)('$name keys never contain Thai characters (per Policy 5)', ({ map }) => {
        for (const code of Object.keys(map)) {
            expect(code).not.toMatch(/[฀-๿]/);
        }
    });

    it.each(MAPS)('$name maps include a PERMISSION_DENIED / FORBIDDEN_ROLE catch-all', ({ map }) => {
        // The shared RBAC layer can surface either code depending on the
        // route. Every admin modal must accept both so the toast is
        // consistent regardless of which the backend chose.
        expect(map.PERMISSION_DENIED || map.FORBIDDEN_ROLE).toBeDefined();
    });
});
