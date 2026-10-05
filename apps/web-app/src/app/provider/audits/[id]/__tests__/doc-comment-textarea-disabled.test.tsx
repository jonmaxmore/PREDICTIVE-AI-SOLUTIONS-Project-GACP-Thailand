/**
 * X3-FIX-D / H-9 (2026-05-18) — per-document Auditor comment Textarea
 * visual-bug regression guard.
 *
 * Pre-X3 the doc-viewer in audit-application-tab-panel.tsx rendered an
 * editable <textarea> per attachment. The text typed by the auditor was
 * stored ONLY in local React state (`stepComments` at line 29), so a
 * tab change or page close silently dropped the user's input. The
 * visual affordance implied persistence; the actual behaviour did not.
 *
 * X3-FIX-D disables the textarea and adds:
 *   - `disabled` + `aria-disabled="true"` on the <textarea> element
 *   - A `title` Thai tooltip explaining the pending state
 *   - A small helper paragraph below the field (data-testid
 *     `doc-comment-helper-{key}`) carrying the same Thai sentence so
 *     non-pointer users see it without hovering for the tooltip.
 *
 * This guard mounts the panel with two attachments and asserts BOTH
 * disabled textareas plus the helper text. Persistence work itself is
 * deferred to X3.5 (per the X3 meeting L-11) and requires a schema
 * change + new POST endpoint.
 */

import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Stable next/navigation per I-016 (defensive).
jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
    };
    return {
        useRouter: () => router,
        usePathname: () => '/provider/audits/test-id',
        useSearchParams: () => new URLSearchParams(),
        useParams: () => ({ id: 'test-id' }),
    };
});

import { AuditApplicationTabPanel } from '../audit-application-tab-panel';
import type { ApplicationData } from '../provider-audit-job-sheet-config';

const APP: ApplicationData = {
    id: 'app-1',
    applicationNumber: 'GACP-2026-9999',
    status: 'AUDIT_CONFIRMED',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z',
    health: { firstName: 'Test', lastName: 'Farmer', email: 'f@x', phone: '081' },
};

const ATTACHMENTS = [
    { key: 'idCardDoc', label: 'ID Card', url: 'https://example.test/idcard.pdf' },
    { key: 'houseRegDoc', label: 'House Reg', url: 'https://example.test/house.pdf' },
];

describe('[X3-FIX-D / H-9] per-document comment Textarea disabled until persistence ships', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    it('renders the per-document <textarea> with disabled + aria-disabled and a Thai tooltip', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(
                <AuditApplicationTabPanel
                    application={APP}
                    formData={{}}
                    attachments={ATTACHMENTS}
                />,
            );
        });

        // One disabled textarea per attachment — both must carry the
        // disabled attribute, the aria-disabled mirror, and the Thai
        // tooltip explaining persistence is pending (X3.5).
        for (const att of ATTACHMENTS) {
            const ta = container!.querySelector(
                `[data-testid="doc-comment-textarea-${att.key}"]`,
            ) as HTMLTextAreaElement | null;
            expect(ta).not.toBeNull();
            expect(ta!.disabled).toBe(true);
            expect(ta!.getAttribute('aria-disabled')).toBe('true');
            expect(ta!.getAttribute('title')).toContain('ยังไม่พร้อมใช้งาน');
            expect(ta!.getAttribute('title')).toContain('X3.5');
        }
    });

    it('renders a visible helper paragraph below each disabled textarea (non-pointer users)', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(
                <AuditApplicationTabPanel
                    application={APP}
                    formData={{}}
                    attachments={ATTACHMENTS}
                />,
            );
        });

        for (const att of ATTACHMENTS) {
            const helper = container!.querySelector(
                `[data-testid="doc-comment-helper-${att.key}"]`,
            );
            expect(helper).not.toBeNull();
            expect(helper!.textContent).toContain('ยังไม่พร้อมใช้งาน');
            expect(helper!.textContent).toContain('X3.5');
        }
    });
});
