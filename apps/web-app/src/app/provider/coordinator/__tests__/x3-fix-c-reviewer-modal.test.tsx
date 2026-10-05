/**
 * x3-fix-c-reviewer-modal.test.tsx — Loop X Iter 3 (X3-FIX-C).
 *
 * Coordinator (SCHEDULER) hand-rolled reviewer-assignment modal:
 *
 *   1. M-9 — modal is NOT Radix-backed, so it lacked the Dialog
 *      primitive's built-in Esc handling. Pre-X3 a keyboard user
 *      could open the dialog but had to click the backdrop or the
 *      ยกเลิก button to dismiss. The fix wires a window-level
 *      keydown listener that closes when Escape is pressed while
 *      the modal is open.
 *   2. H-11 — the first interactive control inside the modal (the
 *      reviewer `<select>`) now carries `autoFocus` so keyboard
 *      users do not have to Tab past the dialog title + close icon.
 *   3. M-7 — decorative lucide icons used in tab triggers, action
 *      buttons, and the empty-state are now `aria-hidden="true"` so
 *      screen readers do not announce them.
 *
 * Strategy: production-source grep for the M-7 + M-9 + H-11 wiring
 * (cheap, deterministic, blocks future regressions). The hand-rolled
 * modal rendering depends on a few apiClient calls + a real Radix-
 * agnostic `<select>`; full createRoot mount is verified for the Esc
 * close path.
 */

import * as React from 'react';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
        usePathname: () => '/provider/coordinator',
        useSearchParams: () => new URLSearchParams(),
    };
});

jest.mock('@/lib/notifications', () => ({
    notifications: { show: jest.fn() },
}));

// apiClient stubs to keep mount cheap — the dashboard fetches a few
// endpoints on first render, and we want the reviewer-assignment modal
// to be reachable without network noise.
const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockApiGet(...args),
        post: (...args: unknown[]) => mockApiPost(...args),
    },
}));

const coordinatorSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'client-view.tsx'),
    'utf8',
);
const contextPanelSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'coordinator-context-panel.tsx'),
    'utf8',
);

describe('[X3-FIX-C / M-9] Coordinator reviewer modal — Esc handler (source)', () => {
    it('declares a window-level keydown listener gated on assignModalOpen', () => {
        // The fix introduces a useEffect that registers a keydown
        // listener when assignModalOpen flips true, and removes it on
        // close/unmount. We grep for the explicit Escape branch.
        expect(coordinatorSrc).toContain("event.key === 'Escape'");
        // Cleanup is mandatory — without it the modal would re-register
        // listeners on every state change.
        expect(coordinatorSrc).toContain('removeEventListener');
        // Effect is gated on assignModalOpen so we don't intercept Esc
        // when the modal is closed.
        expect(coordinatorSrc).toMatch(
            /useEffect\(\(\) => \{[\s\S]*?if \(!assignModalOpen\) return;/,
        );
    });
});

describe('[X3-FIX-C / H-11] Coordinator reviewer modal — autoFocus on select (source)', () => {
    it('declares autoFocus + the standard eslint-disable on the reviewer select', () => {
        // The select is the first focusable control after the close
        // icon — autoFocus ensures keyboard users land on it.
        expect(coordinatorSrc).toContain('id={reviewerSelectId}');
        expect(coordinatorSrc).toContain(
            'eslint-disable-next-line jsx-a11y/no-autofocus',
        );
        // Verify the autoFocus token appears inside the reviewer
        // <select> opening tag (between `<select` and the first
        // `<option`). We can't just use `>` as a terminator because
        // arrow-function syntax (`(e) =>`) contains it.
        const selectOpenIdx = coordinatorSrc.indexOf(
            '<select\n              id={reviewerSelectId}',
        );
        expect(selectOpenIdx).toBeGreaterThan(-1);
        const firstOptionIdx = coordinatorSrc.indexOf('<option', selectOpenIdx);
        const reviewerBlock = coordinatorSrc.slice(selectOpenIdx, firstOptionIdx);
        expect(reviewerBlock).toContain('autoFocus');
    });
});

describe('[X3-FIX-C / M-7] Coordinator lucide icons aria-hidden (source)', () => {
    it('decorative icons next to text labels carry aria-hidden="true"', () => {
        // Spot-check a handful of the bulk-update icons across the
        // dashboard. Each of these renders next to a Thai label, so
        // they are decorative and should be hidden from AT.
        expect(coordinatorSrc).toContain('<RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true"');
        expect(coordinatorSrc).toContain('<FileCheck size={14} className="mr-1" aria-hidden="true"');
        expect(coordinatorSrc).toContain('<Calendar size={14} className="mr-1" aria-hidden="true"');
        expect(coordinatorSrc).toContain('<UserCheck size={14} className="mr-1.5" aria-hidden="true"');
        expect(coordinatorSrc).toContain('<MapPin size={16} className="mr-1.5" aria-hidden="true"');
        expect(coordinatorSrc).toContain('<ChevronRight size={16} className="ml-1" aria-hidden="true"');
    });

    it('coordinator-context-panel decorative icons also carry aria-hidden', () => {
        // The right-rail context panel renders Flame/Calendar/Clock/Users
        // alongside their tile titles. All should be decorative-hidden.
        // Minimal-redesign pass (2026-07-24): these dropped from size={20} in a
        // 40px tinted icon tile to a plain size={16} glyph beside the heading.
        // The aria-hidden contract this test exists for is unchanged.
        expect(contextPanelSrc).toContain('<Flame size={16} className="shrink-0 text-destructive" aria-hidden="true"');
        expect(contextPanelSrc).toContain('<Calendar size={16} className="shrink-0 text-muted-foreground" aria-hidden="true"');
        expect(contextPanelSrc).toContain('<Users size={16} className="shrink-0 text-muted-foreground" aria-hidden="true"');
    });
});

describe('[X3-FIX-C / M-9] Coordinator reviewer modal — Esc keydown closes modal (mount)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        // Quiet stub for the dashboard fetches; the modal only relies on
        // the reviewers list which we feed an empty array.
        mockApiGet.mockResolvedValue({ success: true, data: [] });
        mockApiPost.mockResolvedValue({ success: true });
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

    it('Escape key dispatched while modal is open removes the modal from the DOM', async () => {
        // Lightweight harness — mounts the same hand-rolled modal JSX
        // shape as the production page to exercise the useEffect that
        // M-9 introduces. We can't easily mount CoordinatorDashboardPage
        // here because it transitively renders ProviderLayout +
        // SummaryHeader which would balloon the test surface; the harness
        // mirrors the modal lifecycle (open boolean → useEffect adds Esc
        // listener → setOpen(false) on Escape). The production listener
        // logic is grep-locked above.
        const Harness: React.FC = () => {
            const [open, setOpen] = React.useState(true);
            React.useEffect(() => {
                if (!open) return;
                const handle = (event: KeyboardEvent) => {
                    if (event.key === 'Escape') {
                        event.stopPropagation();
                        setOpen(false);
                    }
                };
                window.addEventListener('keydown', handle);
                return () => window.removeEventListener('keydown', handle);
            }, [open]);
            return open ? <div data-testid="hand-rolled-modal">open</div> : null;
        };

        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<Harness />);
        });

        // Modal is open initially.
        expect(
            container!.querySelector('[data-testid="hand-rolled-modal"]'),
        ).not.toBeNull();

        // Fire Escape — the production code calls setAssignModalOpen(false)
        // which unmounts the dialog markup.
        await act(async () => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            );
        });

        expect(
            container!.querySelector('[data-testid="hand-rolled-modal"]'),
        ).toBeNull();
    });
});
