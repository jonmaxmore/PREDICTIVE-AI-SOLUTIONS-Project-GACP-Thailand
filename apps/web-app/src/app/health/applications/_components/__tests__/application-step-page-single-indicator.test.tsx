/**
 * application-step-page-single-indicator.test.tsx — W2-A + W2-B acceptance test.
 *
 * Design-cleanup audit (2026-08-21): the wizard step page rendered FOUR
 * step-progress affordances at once on step 1 (the operator's top
 * complaint — "มีทั้ง hint มีทั้งสรุป มีสรุป มีกรอกข้อมูล"):
 *   1. The top pill/chip stepper — rendered by _steps/layout.tsx, kept.
 *   2. A numbered-circle badge (e.g. "1") in this component's own header.
 *   3. A "ขั้นตอนที่ N จาก 8" text line right next to it.
 *   4. An 8-segment labeled mini progress bar below the header.
 *   ...plus a tip banner (ApplicationFlowTipBanner) repeating the same
 *   subtitle already shown in the header description.
 *
 * Fix: delete #2, #3, #4, and the tip-banner render site from
 * application-step-page.tsx. Keep the h2 title + one-line description
 * (the single remaining source of "what step am I on" copy at this
 * layer — the compact pill rail in the parent layout is the other).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn<(url: string, opts?: unknown) => Promise<unknown>>();

jest.mock('@/lib/api/api-client', () => ({
    api: { get: (url: string, opts?: unknown) => mockApiGet(url, opts) },
}));

const mockRouter = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => mockRouter,
    useParams: () => ({ id: '1' }),
    notFound: jest.fn(),
}));

// IMPORTANT: return the SAME object/function references on every call.
// Real Zustand hooks are referentially stable across renders when nothing
// changed; a naive `() => ({ ...literal... })` mock recreates a fresh
// object (and fresh `jest.fn()`s) on every render, which makes any
// consuming `useEffect([...store fields...])` re-fire every render — with
// application-step-page.tsx's fetchConfig effect (deps include
// `setCurrentStep`) that produces a genuine infinite render loop under test.
const mockStoreState = {
    plantId: null as string | null,
    currentStep: 0,
    consentedPDPA: false,
    acknowledgedStandards: false,
};
const mockStoreValue = {
    state: mockStoreState,
    setCurrentStep: jest.fn(),
    updateState: jest.fn(),
    hydrateDraft: jest.fn(),
    setResumePending: jest.fn(),
    // consent-step (rendered at step 1) also destructures these:
    consentPDPA: jest.fn(),
    acknowledgeStandards: jest.fn(),
};
jest.mock('@/app/health/applications/hooks/use-application-flow-store', () => ({
    useApplicationFlowStore: () => mockStoreValue,
}));

import ApplicationStepPage from '../application-step-page';

describe('[W2-A/W2-B] application-step-page — step 1 renders exactly one step-progress indicator (plus the tip banner is gone)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockApiGet.mockReset();
        mockApiGet.mockImplementation((url: string) => {
            if (url.includes('/applications/draft')) {
                return Promise.resolve({ success: true, data: null });
            }
            if (url.includes('/api/applications/config')) {
                return Promise.resolve({ success: true, data: {} });
            }
            return Promise.resolve({ success: false, error: 'unexpected url in test' });
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
    });

    function mount() {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(<ApplicationStepPage />);
        });
    }

    async function flush() {
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
    }

    it('renders the step title exactly once and no numbered-circle badge / "step N of total" text / 8-segment bar', async () => {
        mount();
        await flush();

        // Sanity: we actually reached the loaded step body (not stuck on
        // the loading spinner or an error card).
        expect(container!.textContent).toContain('ประเภทคำขอและผู้ยื่น');

        // #2 numbered-circle badge — unique wrapper class from the header.
        expect(container!.innerHTML).not.toContain('bg-leaf-soft text-base font-bold text-leaf-700');
        // #3 "ขั้นตอนที่ N จาก 8" counter text (chrome.stepCounter interpolated).
        expect(container!.textContent).not.toMatch(/ขั้นตอนที่\s*\d+\s*จาก\s*\d+/);
        // #4 the 8-segment mini progress bar — unique segment class.
        expect(container!.innerHTML).not.toContain('h-[7px] rounded-full');
    }, 20000);

    it('does not render the tip banner (no tip-toggle button, no leaking tip copy)', async () => {
        mount();
        await flush();

        expect(container!.textContent).not.toContain('แสดงคำแนะนำ');
        expect(container!.textContent).not.toContain('ซ่อนคำแนะนำ');
        // Step 1's tip copy (APPLICATION_FLOW_STEP_TIPS[1].tip) must not leak.
        expect(container!.textContent).not.toContain('เลือกประเภทคำขอ (ใหม่/ต่ออายุ/ขอใบแทน)');
    }, 20000);

    it('still renders the step title and description exactly once (the single remaining chrome at this layer)', async () => {
        mount();
        await flush();

        const titleMatches = container!.innerHTML.match(/ประเภทคำขอและผู้ยื่น/g) || [];
        expect(titleMatches.length).toBe(1);
    }, 20000);
});
