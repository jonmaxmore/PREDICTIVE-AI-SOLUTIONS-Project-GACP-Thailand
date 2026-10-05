/**
 * x3-fix-c-audit-decision-modal.test.tsx — Loop X Iter 3 (X3-FIX-C).
 *
 * AuditDecisionModal regression guards:
 *
 *   1. H-10 — the CAR-mode "remove finding" button (legacy AuditDecisionModal,
 *      distinct from the inspect-flow DecisionScreen which V3-C already fixed)
 *      previously rendered at h-7 w-7 (28×28) — under WCAG 2.5.5 AA. After
 *      X3-FIX-C it carries h-11 + min-h-[44px] + min-w-[44px] so the auditor
 *      can confidently dismiss a row on a tablet.
 *   2. H-11 — the modal's first interactive input now declares `autoFocus`
 *      so screen-reader + keyboard users land on the relevant Textarea
 *      instead of a Tab away from it. In CAR mode that's the first
 *      finding's nonConformity Textarea; in PASS mode that's the
 *      decision-notes Textarea (mutually exclusive, controlled by the
 *      `isCAR` flag derived from `decision`).
 *
 * Strategy: production source grep (mirrors
 * `findings-remove-button-tap-target.test.tsx`) plus a render assertion
 * driven through createRoot+act to verify the focused element after
 * mount. The legacy 28×28 grep is locked so reverting to h-7 w-7 fails.
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
        usePathname: () => '/provider/audits/test-id',
        useSearchParams: () => new URLSearchParams(),
        useParams: () => ({ id: 'test-id' }),
    };
});

jest.mock('@/lib/notifications', () => ({
    notifications: { show: jest.fn() },
}));

import { AuditDecisionModal } from '../audit-decision-modal';

const modalSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'audit-decision-modal.tsx'),
    'utf8',
);

describe('[X3-FIX-C / H-10] AuditDecisionModal CAR remove-finding ≥ 44 px', () => {
    it('no longer carries the legacy h-7 w-7 class on the remove button', () => {
        // Legacy ghost-button used `h-7 w-7 p-0` (28×28). The fix raises
        // it to `h-11 min-h-[44px] w-11 min-w-[44px] p-0`. Lock the regression.
        expect(modalSrc).not.toContain('className="h-7 w-7 p-0');
    });

    it('declares the ≥ 44 px tap-target token set on the remove button', () => {
        // The class string we look for is the prefix; the rest of the
        // hover styling can shift without breaking the assertion.
        expect(modalSrc).toContain('h-11 min-h-[44px] w-11 min-w-[44px] p-0');
        expect(modalSrc).toContain('aria-label="ลบรายการ"');
    });
});

describe('[X3-FIX-C / H-11] AuditDecisionModal first-input autoFocus', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
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

    it('source declares autoFocus on the first CAR-mode Textarea and the eslint-disable comment', () => {
        expect(modalSrc).toContain(
            'eslint-disable-next-line jsx-a11y/no-autofocus',
        );
        // First-finding autoFocus is gated on `idx === 0` so the
        // typical 2nd/3rd finding does not steal focus.
        expect(modalSrc).toMatch(/autoFocus=\{idx === 0\}/);
        // PASS-mode autoFocus is gated on the inverse of isCAR so the
        // decision-notes Textarea takes focus when there's no CAR.
        expect(modalSrc).toMatch(/autoFocus=\{!isCAR\}/);
    });

    it('in PASS mode the decision-notes Textarea receives focus on mount', async () => {
        await act(async () => {
            root = createRoot(container!);
            root.render(
                <AuditDecisionModal
                    opened
                    decision="PASS"
                    decisionNotes=""
                    evidenceFiles={[]}
                    findings={[]}
                    isCompressing={false}
                    isSubmitting={false}
                    onClose={() => {}}
                    onDecisionNotesChange={() => {}}
                    onEvidenceUpload={() => {}}
                    onRemoveEvidence={() => {}}
                    onFindingsChange={() => {}}
                    formatBytes={(b: number) => `${b}B`}
                    onSubmit={() => {}}
                />,
            );
        });
        // Allow effects to flush.
        await act(async () => {
            await Promise.resolve();
        });
        // Decision-notes Textarea label = "บันทึกผลการตัดสิน". Locate
        // by label text and confirm it owns document.activeElement.
        const labels = Array.from(document.querySelectorAll('label')) as HTMLLabelElement[];
        const decisionLabel = labels.find((l) =>
            (l.textContent || '').includes('บันทึกผลการตัดสิน'),
        );
        expect(decisionLabel).toBeTruthy();
        const decisionTextarea = decisionLabel
            ? document.getElementById(decisionLabel.getAttribute('for') || '')
            : null;
        expect(decisionTextarea).toBeTruthy();
        expect(document.activeElement).toBe(decisionTextarea);
    });
});
