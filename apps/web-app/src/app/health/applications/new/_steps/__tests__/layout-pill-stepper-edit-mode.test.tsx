/**
 * layout-pill-stepper-edit-mode.test.tsx — W2-A edit-mode-fallback trap.
 *
 * Design-cleanup audit (2026-08-21), W2-A trap: application-step-page.tsx
 * carried FOUR step-progress indicators; the fix keeps only the top
 * pill/chip stepper rendered by _steps/layout.tsx (ApplicationFlowLayout)
 * and deletes the other three from application-step-page.tsx.
 *
 * BUT layout.tsx previously gated that pill stepper on
 * `!isPaymentPhase && !isEditMode` — meaning a farmer editing an
 * existing draft (routed through /health/applications/new?edit=<id>,
 * gacp_edit_mode set in sessionStorage) saw NO pill stepper AT ALL. Once
 * application-step-page.tsx's own indicators are deleted, edit mode would
 * be left with ZERO step-progress indicators — a real regression, not
 * just a cosmetic one.
 *
 * Fix: drop the `!isEditMode` condition so the pill stepper also renders
 * in edit mode (it already derives correctly from the URL's `activeStep`
 * regardless of mode; no edit-mode-specific data it depended on).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockRouter = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => mockRouter,
    usePathname: () => '/health/applications/new/step/2',
}));

const mockStoreValue = {
    state: { currentStep: 0, plantId: null, syncStatus: 'SYNCED' },
};
jest.mock('@/app/health/applications/new/_steps/hooks/use-application-flow-store', () => ({
    useApplicationFlowStore: () => mockStoreValue,
}));

const mockAutoSave = {
    isDirty: false,
    isSaving: false,
    lastSavedAt: null,
    error: null,
    errorKind: null,
    draftId: null,
    syncState: 'idle',
    draftVersion: null,
    hasConflict: false,
    saveNow: jest.fn(),
    markDirty: jest.fn(),
    clearDraft: jest.fn(),
    acknowledgeConflict: jest.fn(),
};
jest.mock('@/app/health/applications/new/_steps/hooks/use-auto-save', () => ({
    useAutoSave: () => mockAutoSave,
}));

const mockApiGet = jest.fn<(url: string) => Promise<unknown>>(() =>
    Promise.resolve({ success: false, data: null }),
);
jest.mock('@/lib/api/api-client', () => ({
    api: { get: (url: string) => mockApiGet(url) },
}));

import ApplicationFlowLayout from '../layout';

describe('[W2-A trap] _steps/layout.tsx — pill stepper renders in EDIT MODE too', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        sessionStorage.clear();
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
            root.render(<ApplicationFlowLayout><div>child</div></ApplicationFlowLayout>);
        });
    }

    async function flush() {
        await act(async () => {
            for (let i = 0; i < 10; i++) await Promise.resolve();
        });
    }

    it('renders the pill stepper when NOT in edit mode (control)', async () => {
        mount();
        await flush();
        // FLOW_STEPS labels render as pills — "ยินยอม" is step 1's label.
        expect(container!.textContent).toContain('ประเภทคำขอ');
    });

    it('still renders the pill stepper when gacp_edit_mode is set (edit mode)', async () => {
        sessionStorage.setItem(
            'gacp_edit_mode',
            JSON.stringify({
                isEditMode: true,
                applicationId: 'app-1',
                revisionComment: '',
                applicationNumber: 'APP-2569-0001',
            }),
        );
        mount();
        await flush();
        expect(container!.textContent).toContain('ประเภทคำขอ');
    });
});
