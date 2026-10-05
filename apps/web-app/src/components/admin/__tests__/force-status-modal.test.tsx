/**
 * ForceStatusModal.test.tsx — Iter 28 step 5 component test.
 *
 * Mirrors the AssignAuditorModal (Iter 25) test contract — this repo
 * doesn't pull in @testing-library/react, so we exercise the
 * component's prop contract via SSR via `renderToStaticMarkup`.
 *
 * Coverage:
 *  1. Module exports the named symbol.
 *  2. Renders without throwing when closed (returns null).
 *  3. Closed state emits empty markup — no title text leaks.
 *  4. Renders without throwing when open (full danger card visible).
 *  5. Accepts a custom submitHandler prop without throwing.
 *
 * The interactive behavior (disabled-until-valid, trimmed payload)
 * is exercised by the Playwright E2E in iter 29 (out of scope here
 * because Radix-style portal + state changes require DOM hooks).
 */

import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

// V5-D: mock must expose FORCE_STATUS_REASON_CODES (used by the
// modal's reasonCode dropdown). Without it the SSR render throws
// "Cannot read properties of undefined (reading 'map')".
jest.mock('@/lib/services/admin-service-b28', () => ({
    AdminB28Service: {
        forceStatus: jest
            .fn<() => Promise<{ success: boolean }>>()
            .mockResolvedValue({ success: true }),
    },
    FORCE_STATUS_REASON_CODES: [
        { value: 'DATA_CORRECTION', label: 'แก้ไขข้อมูล (Data correction)' },
        { value: 'COMPLIANCE_ESCALATION', label: 'การยกระดับด้าน Compliance' },
        { value: 'LEGAL_ORDER', label: 'คำสั่งทางกฎหมาย' },
        { value: 'SYSTEM_RECOVERY', label: 'กู้คืนสถานะระบบ' },
        { value: 'MANUAL_REVIEW_EXCEPTION', label: 'ตรวจสอบโดยบุคคล (ค่าเริ่มต้น)' },
    ],
}));

import { ForceStatusModal, FORCE_STATUS_OPTIONS } from '../ForceStatusModal';

describe('ForceStatusModal (Iter 28)', () => {
    it('exports the named component symbol', () => {
        expect(typeof ForceStatusModal).toBe('function');
    });

    it('exports a non-empty FORCE_STATUS_OPTIONS list', () => {
        expect(Array.isArray(FORCE_STATUS_OPTIONS)).toBe(true);
        expect(FORCE_STATUS_OPTIONS.length).toBeGreaterThan(0);
        // The override target the page exposes must include CERTIFIED
        // — that's the gnarliest end-state and we want to confirm it
        // hasn't been accidentally dropped.
        expect(FORCE_STATUS_OPTIONS.map((o) => o.value)).toContain('CERTIFIED');
    });

    it('renders nothing when open is false', () => {
        const html = renderToStaticMarkup(
            <ForceStatusModal
                applicationId="app-123"
                currentStatus="SUBMITTED"
                open={false}
                onClose={() => {}}
            />,
        );
        // Closed modal returns null — the title must NOT appear in
        // the static markup of the page tree.
        expect(html).toBe('');
    });

    it('renders without throwing when open=true', () => {
        expect(() =>
            renderToStaticMarkup(
                <ForceStatusModal
                    applicationId="app-123"
                    currentStatus="SUBMITTED"
                    open
                    onClose={() => {}}
                />,
            ),
        ).not.toThrow();
    });

    it('emits the danger title and application id in open markup', () => {
        const html = renderToStaticMarkup(
            <ForceStatusModal
                applicationId="app-456"
                currentStatus="DOC_APPROVED"
                open
                onClose={() => {}}
            />,
        );
        expect(html).toContain('เปลี่ยนสถานะฉุกเฉิน');
        expect(html).toContain('app-456');
        expect(html).toContain('DOC_APPROVED');
    });

    it('accepts a submitHandler injection (used by E2E + integration tests)', () => {
        const submitHandler = jest
            .fn<
                (payload: {
                    applicationId: string;
                    toStatus: string;
                    reasonCode: string;
                    reason: string;
                }) => Promise<{ success: boolean; message?: string }>
            >()
            .mockResolvedValue({ success: true });
        expect(() =>
            renderToStaticMarkup(
                <ForceStatusModal
                    applicationId="app-789"
                    currentStatus="SUBMITTED"
                    open
                    onClose={() => {}}
                    submitHandler={submitHandler}
                />,
            ),
        ).not.toThrow();
    });

    // ── V5-D UX-B1 extensions ──────────────────────────────────────

    it('renders the reasonCode dropdown with the 5 Iter 28 reason codes', () => {
        const html = renderToStaticMarkup(
            <ForceStatusModal
                applicationId="app-201"
                currentStatus="SUBMITTED"
                open
                onClose={() => {}}
            />,
        );
        // The dropdown label + the 5 canonical codes must be present.
        expect(html).toContain('หมวดเหตุผล');
        expect(html).toContain('DATA_CORRECTION');
        expect(html).toContain('COMPLIANCE_ESCALATION');
        expect(html).toContain('LEGAL_ORDER');
        expect(html).toContain('SYSTEM_RECOVERY');
        expect(html).toContain('MANUAL_REVIEW_EXCEPTION');
    });

    it('advertises the 10-char minimum reason (V5-D UX-B1)', () => {
        const html = renderToStaticMarkup(
            <ForceStatusModal
                applicationId="app-202"
                currentStatus="SUBMITTED"
                open
                onClose={() => {}}
            />,
        );
        // The placeholder + hint both call out 10 chars.
        expect(html).toContain('อย่างน้อย 10 ตัวอักษร');
        // The legacy 5-char copy is no longer present.
        expect(html).not.toContain('อย่างน้อย 5 ตัวอักษร');
    });
});
