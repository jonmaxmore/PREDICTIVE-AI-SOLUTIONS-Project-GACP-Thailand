/**
 * final-approval-fetch-error.test.tsx — X3-FIX-A / H-3 regression guard.
 *
 * Before X3 the parent `/provider/audits` client-view fetched the
 * final-approval queue inside a try/catch that only `console.error`ed
 * on failure — the AUDITOR's view fell through to the empty-state
 * caption "ไม่มีรายการรออนุมัติขั้นสุดท้าย", which is the same string
 * that renders when the queue is genuinely empty. Reviewers had no
 * way to distinguish an outage from a clean queue and no retry CTA.
 *
 * X3-FIX-A introduces:
 *   - Optional `fetchError` / `onRetry` props on FinalApprovalList.
 *   - A rose Card data-testid="final-approval-fetch-error" with the
 *     dict.common.fetchError.title + retry button.
 *
 * The wire-up from the parent client-view is a follow-up (file
 * boundary collision documented in the handoff). This test pins the
 * primitive contract so the parent only has to thread the props.
 *
 * Pattern mirrors X2-FIX-C activities-fetch-error.test.tsx — uses
 * createRoot+act per repo conventions (no @testing-library/react).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Stable next/navigation per I-016 — FinalApprovalList doesn't read
// the router but Button (href) imports from next/link which transitively
// can pull in next/navigation in some setups.
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
        usePathname: () => '/provider/audits',
        useSearchParams: () => new URLSearchParams(),
    };
});

import { FinalApprovalList } from '../final-approval-list';
import { LanguageProvider } from '@/lib/i18n/language-context';
import type { FinalApprovalItem } from '../auditor-types';

describe('[X3-FIX-A / H-3] FinalApprovalList — silent fetch error', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    const baseProps = {
        items: [] as FinalApprovalItem[],
        isApproving: null,
        rejectingId: null,
        rejectReason: '',
        setRejectingId: jest.fn() as (id: string | null) => void,
        setRejectReason: jest.fn() as (reason: string) => void,
        handleFinalApprove: jest.fn(() => Promise.resolve()) as (id: string) => Promise<void>,
        handleReject: jest.fn(() => Promise.resolve()) as () => Promise<void>,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        try {
            window.localStorage.removeItem('language');
        } catch {
            /* ignore */
        }
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

    function mount(node: React.ReactNode) {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(<LanguageProvider>{node}</LanguageProvider>);
        });
    }

    it('renders the rose error card when fetchError prop is non-null', () => {
        const onRetry = jest.fn();
        mount(
            <FinalApprovalList
                {...baseProps}
                fetchError="ระบบรอบสุดท้ายล่ม"
                onRetry={onRetry}
            />,
        );
        const errCard = container!.querySelector('[data-testid="final-approval-fetch-error"]');
        expect(errCard).not.toBeNull();
        // Surface the upstream message verbatim so the AUDITOR sees
        // the cause, not just a generic "something went wrong".
        expect(errCard!.textContent).toContain('ระบบรอบสุดท้ายล่ม');
        // Title from dict.common.fetchError.title (TH default).
        expect(errCard!.textContent).toContain('ไม่สามารถโหลดข้อมูลได้');
        // Retry CTA (TH default) must be present.
        expect(errCard!.textContent).toContain('ลองอีกครั้ง');
        // role="alert" so the rose card is announced.
        expect(errCard!.getAttribute('role')).toBe('alert');
    });

    it('invokes onRetry when the retry button is clicked', () => {
        const onRetry = jest.fn();
        mount(
            <FinalApprovalList
                {...baseProps}
                fetchError="backend offline"
                onRetry={onRetry}
            />,
        );
        const errCard = container!.querySelector('[data-testid="final-approval-fetch-error"]');
        expect(errCard).not.toBeNull();
        const retryBtn = errCard!.querySelector('button');
        expect(retryBtn).not.toBeNull();
        act(() => {
            retryBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('does NOT render the rose card when fetchError is null (clean path)', () => {
        mount(<FinalApprovalList {...baseProps} fetchError={null} />);
        const errCard = container!.querySelector('[data-testid="final-approval-fetch-error"]');
        expect(errCard).toBeNull();
        // Empty-state caption still renders — error ≠ empty.
        expect(container!.textContent).toContain('ไม่มีรายการรออนุมัติขั้นสุดท้าย');
    });

    it('does NOT render the rose card when fetchError prop is omitted (legacy callsite)', () => {
        // Legacy parent doesn't pass fetchError — backward compatible.
        mount(<FinalApprovalList {...baseProps} />);
        const errCard = container!.querySelector('[data-testid="final-approval-fetch-error"]');
        expect(errCard).toBeNull();
    });
});
