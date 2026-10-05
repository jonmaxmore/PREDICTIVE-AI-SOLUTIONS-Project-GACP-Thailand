/**
 * ChangeRoleModal.test.tsx — V5-D Iter 28 component test.
 *
 * Mirrors the UserDisableModal sibling test (SSR-based prop-contract
 * assertions via renderToStaticMarkup). The submit flow uses the
 * `submitHandler` injection so we don't depend on apiClient.
 *
 * Coverage:
 *  1. Exports the named symbol.
 *  2. Renders nothing when open=false.
 *  3. Open=true emits modal title, current role label, and reason field.
 *  4. Accepts a submitHandler injection without throwing.
 *  5. CHANGE_ROLE_OPTIONS exposes the Tier 16 split roles
 *     (ACCOUNT_DTAM, ACCOUNT_PLATFORM) — guards UX-A4 regression.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/services/admin-service-b28', () => ({
    AdminB28Service: {
        changeRole: jest
            .fn<() => Promise<{ success: boolean }>>()
            .mockResolvedValue({ success: true }),
    },
}));

import { ChangeRoleModal, CHANGE_ROLE_OPTIONS } from '../ChangeRoleModal';

const baseProps = {
    userId: 'user-99',
    userLabel: 'สมชาย ใจดี (somchai@gacp.go.th)',
    currentRole: 'DOCUMENT_REVIEWER',
    onClose: () => {},
    onSuccess: () => {},
};

describe('ChangeRoleModal (V5-D Iter 28)', () => {
    it('exports the named component symbol', () => {
        expect(typeof ChangeRoleModal).toBe('function');
    });

    it('renders nothing when open is false', () => {
        const html = renderToStaticMarkup(
            <ChangeRoleModal {...baseProps} open={false} />,
        );
        expect(html).toBe('');
    });

    it('renders the title, user label, current role, and reason textarea when open', () => {
        const html = renderToStaticMarkup(
            <ChangeRoleModal {...baseProps} open />,
        );
        expect(html).toContain('เปลี่ยนบทบาทผู้ใช้');
        expect(html).toContain(baseProps.userLabel);
        expect(html).toContain(baseProps.currentRole);
        expect(html).toContain('เหตุผลของการเปลี่ยนบทบาท');
        // Reason min 10 chars copy is the regression net for the
        // V5-D acceptance gate.
        expect(html).toContain('อย่างน้อย 10 ตัวอักษร');
    });

    it('accepts a submitHandler injection without throwing', () => {
        const submitHandler = jest
            .fn<
                (
                    userId: string,
                    newRole: string,
                    reason: string,
                ) => Promise<{ success: boolean; message?: string }>
            >()
            .mockResolvedValue({ success: true });
        expect(() =>
            renderToStaticMarkup(
                <ChangeRoleModal
                    {...baseProps}
                    open
                    submitHandler={submitHandler}
                />,
            ),
        ).not.toThrow();
    });

    it('exposes the Tier 16 split roles in CHANGE_ROLE_OPTIONS (UX-A4 regression net)', () => {
        const values = CHANGE_ROLE_OPTIONS.map((opt) => opt.value);
        expect(values).toContain('finance_officer_dtam');
        expect(values).toContain('finance_officer_platform');
        // Spot-check the legacy + admin entries so a future trim doesn't
        // delete them by accident.
        expect(values).toContain('system_admin_dtam');
        expect(values).toContain('field_inspector');
        expect(values).toContain('DOCUMENT_REVIEWER');
    });

    // ── X5-FIX-D H-7: type-to-confirm mistype-resistance ─────────────

    it('renders the type-to-confirm input asking operator to type CONFIRM (X5-FIX-D H-7)', () => {
        const html = renderToStaticMarkup(
            <ChangeRoleModal {...baseProps} open />,
        );
        // The confirm input + its label must be present.
        expect(html).toContain('change-role-confirm');
        expect(html).toContain('CONFIRM');
        // Prompt copy: "ยืนยันโดยพิมพ์คำว่า CONFIRM"
        expect(html).toContain('ยืนยันโดยพิมพ์คำว่า');
    });

    it('renders the submit button (disabled until typed CONFIRM matches) — X5-FIX-D H-7', () => {
        const html = renderToStaticMarkup(
            <ChangeRoleModal {...baseProps} open />,
        );
        // Initial render: no role + no reason + no confirm → canSubmit
        // is false → button disabled. The data-testid stays so e2e
        // can target it.
        expect(html).toContain('change-role-submit');
        // The disabled-state class signature includes the "bg-amber-300"
        // (light) variant, NOT "bg-amber-600" (active). This is the
        // SSR proof that submit is disabled out-of-the-box.
        expect(html).toContain('bg-amber-300');
        expect(html).toContain('cursor-not-allowed');
    });
});
