/**
 * UserDisableModal.test.tsx — Iter 28 step 5 component test.
 *
 * Mirrors the ForceStatusModal sibling test and the Iter 25
 * AssignAuditorModal pattern: SSR-based prop contract assertions
 * since this repo doesn't pull in @testing-library/react. The
 * disable/enable copy switching and reason-gate behavior are
 * exercised through the rendered markup; the actual click+submit
 * flow lives in Playwright iter 29.
 *
 * Coverage:
 *  1. Module exports the named symbol.
 *  2. Renders nothing when `open=false`.
 *  3. Open + active account → renders disable copy + reason textarea.
 *  4. Open + inactive account → renders enable copy without reason.
 *  5. Accepts a custom submitHandler without throwing.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/services/admin-service-b28', () => ({
    AdminB28Service: {
        disableUser: jest
            .fn<() => Promise<{ success: boolean }>>()
            .mockResolvedValue({ success: true }),
        enableUser: jest
            .fn<() => Promise<{ success: boolean }>>()
            .mockResolvedValue({ success: true }),
    },
}));

import { UserDisableModal } from '../UserDisableModal';

const baseUser = {
    userId: 'user-42',
    userLabel: 'สมชาย ใจดี (somchai@gacp.go.th)',
    onClose: () => {},
    onSuccess: () => {},
};

describe('UserDisableModal (Iter 28)', () => {
    it('exports the named component symbol', () => {
        expect(typeof UserDisableModal).toBe('function');
    });

    it('renders nothing when open is false', () => {
        const html = renderToStaticMarkup(
            <UserDisableModal {...baseUser} isActive open={false} />,
        );
        expect(html).toBe('');
    });

    it('renders disable copy + reason field when account is active', () => {
        const html = renderToStaticMarkup(
            <UserDisableModal {...baseUser} isActive open />,
        );
        expect(html).toContain('ระงับการใช้งานบัญชี');
        expect(html).toContain('เหตุผลที่ระงับ');
        // The label must come through so the screen-reader can find it.
        expect(html).toContain(baseUser.userLabel);
    });

    it('renders enable copy without reason field when account is inactive', () => {
        const html = renderToStaticMarkup(
            <UserDisableModal {...baseUser} isActive={false} open />,
        );
        expect(html).toContain('เปิดการใช้งานบัญชีอีกครั้ง');
        expect(html).not.toContain('เหตุผลที่ระงับ');
    });

    it('accepts a submitHandler injection without throwing', () => {
        const submitHandler = jest
            .fn<
                (
                    userId: string,
                    reason: string,
                    action: 'disable' | 'enable',
                ) => Promise<{ success: boolean; message?: string }>
            >()
            .mockResolvedValue({ success: true });
        expect(() =>
            renderToStaticMarkup(
                <UserDisableModal
                    {...baseUser}
                    isActive
                    open
                    submitHandler={submitHandler}
                />,
            ),
        ).not.toThrow();
    });

    // ── X5-FIX-D H-7: type-to-confirm mistype-resistance ─────────────

    it('renders the DISABLE token type-to-confirm input when account is active (X5-FIX-D H-7)', () => {
        const html = renderToStaticMarkup(
            <UserDisableModal {...baseUser} isActive open />,
        );
        expect(html).toContain('user-disable-confirm');
        // The disable variant must show the DISABLE token.
        expect(html).toContain('DISABLE');
        expect(html).toContain('ยืนยันโดยพิมพ์คำว่า');
    });

    it('renders the ENABLE token type-to-confirm input when account is inactive (X5-FIX-D H-7)', () => {
        const html = renderToStaticMarkup(
            <UserDisableModal {...baseUser} isActive={false} open />,
        );
        expect(html).toContain('user-disable-confirm');
        // The enable variant must show the ENABLE token (NOT DISABLE).
        expect(html).toContain('ENABLE');
        expect(html).toContain('ยืนยันโดยพิมพ์คำว่า');
        // The DISABLE token must NOT leak into the enable variant.
        // (substring check — we use the standalone token so "ENABLE"
        // doesn't trigger a false-positive on the "DISABLE" check).
        expect(html).not.toMatch(/&gt;DISABLE&lt;|>DISABLE</);
    });

    it('keeps submit disabled until typed token matches — X5-FIX-D H-7', () => {
        const html = renderToStaticMarkup(
            <UserDisableModal {...baseUser} isActive open />,
        );
        // Submit's data-testid + the disabled-class signature
        // (bg-amber-300 + cursor-not-allowed) prove the gate is closed
        // out-of-the-box.
        expect(html).toContain('user-disable-submit');
        expect(html).toContain('bg-amber-300');
        expect(html).toContain('cursor-not-allowed');
    });
});
