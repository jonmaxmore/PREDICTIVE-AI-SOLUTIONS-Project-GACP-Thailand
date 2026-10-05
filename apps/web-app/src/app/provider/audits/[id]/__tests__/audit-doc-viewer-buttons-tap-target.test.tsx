/**
 * X2-FIX-C / M-12 (P-NEW-2) — audit document-viewer buttons WCAG
 * 2.5.5 tap-target regression guard.
 *
 * Pre-X2 the doc-viewer toolbar in audit-application-tab-panel.tsx
 * used 6 Button size="xs" instances (4 zoom/rotate/close in the
 * toolbar + 2 preview/open in the attachment row), each rendering
 * h-7 / 28-px tall — well below the 44×44 minimum mandated by WCAG
 * 2.5.5 for primary touch targets. DOC_REVIEWER and AUDITOR commonly
 * use iPad-class tablets to review docs, so the gap was operational.
 *
 * X2-FIX-C swaps every size="xs" → size="sm" AND adds the
 * `min-h-[44px] min-w-[44px]` className override (sm alone is h-9 =
 * 36px so still fails — the override is what brings each control up
 * to the 44 floor). data-testid hooks added per button so this guard
 * can target them deterministically.
 *
 * The guard mounts the panel with one attachment + selectedDoc set so
 * BOTH the left-list buttons (preview/open) AND the right-toolbar
 * buttons (zoom-in/zoom-out/rotate/close) render in the same pass,
 * then walks every doc-viewer-* test-id and asserts the className
 * predicate (clientHeight is not reliable in JSDOM — Tailwind classes
 * don't compile in the test environment, so a className substring
 * check is the canonical pattern repo-wide; see
 * findings-remove-button-tap-target.test.tsx for the same shape).
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
    { key: 'houseRegDoc', label: 'House Reg', url: null },
];

describe('[X2-FIX-C / M-12] audit doc-viewer buttons — WCAG 2.5.5 44×44 tap target', () => {
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

    it('left-list "ดูเอกสาร" and "เปิดใหม่" buttons carry min-h-[44px] min-w-[44px]', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(
                <AuditApplicationTabPanel
                    application={APP}
                    formData={{ plantName: 'กัญชา', areaType: 'เกษตรอินทรีย์', province: 'เชียงราย' }}
                    attachments={ATTACHMENTS}
                />,
            );
        });

        // "ดูเอกสาร" — Button without href so the primitive renders a
        // <button> and forwards data-testid. (Button primitive at
        // primitives/button.tsx:62-74 drops props on its anchor branch
        // — only className is forwarded — so the "เปิดใหม่" anchor must
        // be queried structurally.)
        const preview = container!.querySelector('[data-testid="doc-viewer-preview-idCardDoc"]');
        expect(preview).not.toBeNull();

        // "เปิดใหม่" — Button with href → renders <a>. Find it via
        // href + textContent + target=_blank.
        const allAnchors = Array.from(container!.querySelectorAll('a'));
        const openAnchor = allAnchors.find((a) =>
            a.getAttribute('href') === 'https://example.test/idcard.pdf'
            && a.getAttribute('target') === '_blank',
        );
        expect(openAnchor).toBeTruthy();

        // The min-h-[44px] / min-w-[44px] override is the explicit
        // 44-px floor; without it the Button primitive's sm size is
        // only 36 px tall. Pin both the height and width tokens.
        expect(preview!.className).toContain('min-h-[44px]');
        expect(preview!.className).toContain('min-w-[44px]');
        expect(openAnchor!.className).toContain('min-h-[44px]');
        expect(openAnchor!.className).toContain('min-w-[44px]');
        // Verify the safe-link contract (rel + target) is preserved.
        expect(openAnchor!.getAttribute('rel')).toContain('noopener');
    });

    it('right-toolbar zoom / rotate / close buttons all carry min-h-[44px] min-w-[44px]', () => {
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

        // Open the doc viewer by clicking the preview button — the
        // toolbar buttons only render once selectedDoc is set.
        const preview = container!.querySelector(
            '[data-testid="doc-viewer-preview-idCardDoc"]',
        ) as HTMLButtonElement | null;
        expect(preview).not.toBeNull();
        act(() => {
            preview!.click();
        });

        const toolbarTestIds = [
            'doc-viewer-zoom-out',
            'doc-viewer-zoom-in',
            'doc-viewer-rotate',
            'doc-viewer-close',
        ];

        for (const testId of toolbarTestIds) {
            const btn = container!.querySelector(`[data-testid="${testId}"]`);
            expect(btn).not.toBeNull();
            // WCAG 2.5.5 — every interactive control inside the doc
            // viewer toolbar must meet the 44×44 floor on touch.
            expect(btn!.className).toContain('min-h-[44px]');
            expect(btn!.className).toContain('min-w-[44px]');
        }
    });

    it('emits exactly 5 doc-viewer-* test-id buttons (preview + 4 toolbar; anchor open lacks testid by primitive design)', () => {
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

        // Open the viewer so the 4 toolbar buttons render alongside
        // the preview button on the present doc.
        const preview = container!.querySelector(
            '[data-testid="doc-viewer-preview-idCardDoc"]',
        ) as HTMLButtonElement | null;
        act(() => {
            preview!.click();
        });

        // 1 list-preview + 4 toolbar (zoom-in/out, rotate, close) = 5
        // testids. The "เปิดใหม่" anchor button is queried structurally
        // in the previous test because the Button primitive does NOT
        // forward data-testid on its `href` branch (primitives/button.tsx:62-74).
        // The url=null attachment renders only the "ไม่มีเอกสาร" Badge.
        const allButtons = container!.querySelectorAll('[data-testid^="doc-viewer-"]');
        expect(allButtons.length).toBe(5);
    });
});
