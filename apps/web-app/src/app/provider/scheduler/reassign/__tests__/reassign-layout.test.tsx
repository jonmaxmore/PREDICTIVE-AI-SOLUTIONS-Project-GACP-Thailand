/**
 * reassign-layout.test.tsx — V2-C SC-2/SC-3 layout assertions.
 *
 * Two state assertions for the V2-C acceptance:
 *   1. SC-2 — the outer container uses `max-w-7xl` (not `max-w-sm`),
 *      and no element with class `bg-white/50` exists (the dead overlay
 *      previously layered on top of the table is removed).
 *   2. SC-2/empty — when `apiClient.get('/audits/reassignable')`
 *      returns an empty list, the "ไม่มีรายการ" Alert renders.
 *
 * SC-3 (typed-interface rename) is implicitly covered by tsc — the
 * file no longer parses if `interface provider` (lower-case) is
 * referenced under its old name. Build-time gate.
 *
 * I-008 — mock surface only includes the apiClient methods the page
 * uses (`get`, `post`). The page imports `apiClient` directly as a
 * named export.
 * I-016 — per-file stable next/navigation router.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: (...args: unknown[]) => mockGet(...args),
        post: (...args: unknown[]) => mockPost(...args),
    },
}));

jest.mock('@/lib/notifications', () => ({
    notifications: { show: jest.fn() },
}));

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
        usePathname: () => '/provider/scheduler/reassign',
        useSearchParams: () => new URLSearchParams(),
    };
});

import ReassignmentPage from '../page';

async function flushAsync(rounds = 8): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

function clearBody(): void {
    while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
    }
}

describe('ReassignmentPage — V2-C SC-2/SC-3 layout', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGet.mockImplementation(async (url: string) => {
            if (url.startsWith('/audits/reassignable')) {
                return { success: true, data: { applications: [] } };
            }
            if (url.startsWith('/provider/directory')) {
                return { success: true, data: [] };
            }
            return { success: true, data: {} };
        });
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
        clearBody();
    });

    it('SC-2: outer container is widened (max-w-7xl) and the dead bg-white/50 overlay is removed', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<ReassignmentPage />);
        });
        await flushAsync();

        // Wide-container assertion — the first child div carries the
        // wrapper class chain. Walk the tree to find ANY element with
        // `max-w-7xl` to be resilient against future header tweaks.
        const wideElements = container.querySelectorAll('.max-w-7xl');
        expect(wideElements.length).toBeGreaterThanOrEqual(1);

        // Hard-block the old narrow class to catch a regression.
        const narrowElements = container.querySelectorAll('.max-w-sm');
        expect(narrowElements.length).toBe(0);

        // Dead overlay must be gone.
        const overlayElements = container.querySelectorAll('.bg-white\\/50');
        expect(overlayElements.length).toBe(0);
    });

    it('SC-2/empty: renders the "ไม่มีรายการ" Alert when reassignable is empty', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);

        await act(async () => {
            root = createRoot(container!);
            root.render(<ReassignmentPage />);
        });
        await flushAsync();

        expect(container.textContent).toContain('ไม่มีรายการ');
        expect(container.textContent).toContain(
            'ไม่มีงานที่ต้องมอบหมายใหม่ในขณะนี้',
        );
    });
});

/**
 * X2-FIX-B / H-9 — Reassign page wraps in ProviderLayout.
 *
 * Audit X2-B §5.1 flagged that the reassign page rendered a bare
 * `<div>` shell with no global sidebar / role-aware nav. X2-FIX-B
 * wraps the page in `<ProviderLayout>` so schedulers keep their nav
 * when landing here. Source-regex assertions avoid the cost of a
 * second jsdom render and stay resilient to inner-markup churn.
 */
describe('[X2-FIX-B / H-9] ReassignmentPage wraps in ProviderLayout', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolve } = require('path') as typeof import('path');
    const pageSrc = readFileSync(resolve(__dirname, '../page.tsx'), 'utf8');

    it('imports ProviderLayout from the provider components folder', () => {
        expect(pageSrc).toMatch(
            /import\s+ProviderLayout\s+from\s+['"]\.\.\/\.\.\/components\/provider-layout['"]/,
        );
    });

    it('returns a <ProviderLayout> as the root JSX element', () => {
        // The first opening tag inside the return statement must be
        // <ProviderLayout — if a future edit reverts to a bare <div
        // shell, this assertion trips.
        expect(pageSrc).toMatch(/return\s*\(\s*(?:\/\/[^\n]*\s*)*\s*<ProviderLayout/);
    });

    it('preserves the V2-C SC-2 inner `max-w-7xl` wrapper for the wide table', () => {
        // SC-2 requires the 7-column reassignment table to breathe.
        // The inner content wrapper must keep `max-w-7xl` even after
        // the ProviderLayout wrap.
        expect(pageSrc).toMatch(/max-w-7xl/);
    });

    it('closes the <ProviderLayout> tag (well-formed JSX)', () => {
        expect(pageSrc).toContain('</ProviderLayout>');
    });
});
