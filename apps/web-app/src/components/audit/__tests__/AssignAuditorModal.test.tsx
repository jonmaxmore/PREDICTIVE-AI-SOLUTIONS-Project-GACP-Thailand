/**
 * AssignAuditorModal.test.tsx — Iter 25 step 7 component test.
 *
 * The repo doesn't pull in `@testing-library/react`, and Radix
 * Dialog renders into a Portal (no SSR output), so we can't assert
 * the open-state markup the way the Footer test does. Instead this
 * file covers the modal's **prop contract**:
 *
 *   1. The component module exports the named symbol.
 *   2. The component is renderable with `open={false}` without
 *      throwing (closed state is the implicit default a parent
 *      lands on the page in).
 *   3. The component is renderable with a null application (the
 *      mount path during transition).
 *   4. The component is renderable with `open={true}` (no throw)
 *      even though Radix portals away the body.
 *
 * The actual user-visible markup (Thai labels, slot buttons,
 * calendar) is exercised by the field-app integration tests in the
 * Playwright suite (out-of-scope for unit tests).
 */

import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/services/audit-service', () => ({
    AuditService: {
        getAuditors: jest
            .fn<() => Promise<{ success: boolean; data: Array<{ id: string; name: string }> }>>()
            .mockResolvedValue({
                success: true,
                data: [
                    { id: 'aud-1', name: 'นาย ทดสอบ ใจดี' },
                    { id: 'aud-2', name: 'นาง สมหญิง ตรวจดี' },
                ],
            }),
        getAuditorAvailability: jest
            .fn<() => Promise<{ success: boolean; data: unknown }>>()
            .mockResolvedValue({
                success: true,
                data: { auditorId: 'aud-1', auditorName: 'X', busy: [], free: [] },
            }),
        assignAuditor: jest
            .fn<() => Promise<{ success: boolean; data: { inspectionId: string } }>>()
            .mockResolvedValue({
                success: true,
                data: { inspectionId: 'ins-1' },
            }),
    },
}));

jest.mock('@/lib/notifications', () => ({
    notifications: { show: jest.fn() },
}));

import { AssignAuditorModal } from '../AssignAuditorModal';
import type { SchedulingQueueItem } from '@/lib/services/audit-service';

const application: SchedulingQueueItem = {
    applicationId: 'app-1',
    applicationNumber: 'GACP-2026-0001',
    applicantName: 'นาย เกษตรกร ทดสอบ',
    applicantNameMasked: 'น. เกษตรกร ท.',
    paymentDate: '2026-05-01T00:00:00.000Z',
    region: 'NORTH',
    scope: 'TURMERIC',
    ageDays: 3,
    status: 'AUDIT_FEE_PAID',
    farmAddress: '123 ม.4 ต.ทดสอบ อ.ทดสอบ จ.เชียงใหม่',
};

describe('AssignAuditorModal (Iter 25)', () => {
    it('exports the named component symbol', () => {
        expect(typeof AssignAuditorModal).toBe('function');
    });

    it('renders without throwing when closed', () => {
        expect(() =>
            renderToStaticMarkup(
                <AssignAuditorModal
                    open={false}
                    application={application}
                    onClose={() => {}}
                    onAssigned={() => {}}
                />,
            ),
        ).not.toThrow();
    });

    it('emits empty markup when closed (Radix Dialog portals body away)', () => {
        const html = renderToStaticMarkup(
            <AssignAuditorModal
                open={false}
                application={application}
                onClose={() => {}}
                onAssigned={() => {}}
            />,
        );
        // The closed dialog must not leak the title into the page DOM.
        expect(html).not.toContain('จัดตารางตรวจประเมินภาคสนาม');
    });

    it('renders without throwing when open=true (Portal target exists)', () => {
        expect(() =>
            renderToStaticMarkup(
                <AssignAuditorModal
                    open
                    application={application}
                    onClose={() => {}}
                    onAssigned={() => {}}
                />,
            ),
        ).not.toThrow();
    });

    it('handles missing application gracefully (null safety)', () => {
        expect(() =>
            renderToStaticMarkup(
                <AssignAuditorModal
                    open={false}
                    application={null}
                    onClose={() => {}}
                    onAssigned={() => {}}
                />,
            ),
        ).not.toThrow();
    });
});
