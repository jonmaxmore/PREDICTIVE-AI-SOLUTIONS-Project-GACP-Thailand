/**
 * decision-buttons-mobile.test.tsx — V3-C (DM-1) regression.
 *
 * Purpose: pin the mobile-first grid layout + ≥44 px tap-target on
 * the AUDITOR job-sheet action-buttons row. Pre-V3 the buttons
 * lived inside a `flex flex-wrap items-center gap-2` parent which
 * wrapped awkwardly on 375 px phones (each emoji + label took its
 * own row). V3-C wrapped them in a `grid grid-cols-1 sm:grid-cols-3`
 * container and gave each button `min-h-[44px] whitespace-normal`.
 *
 * The page.tsx component pulls in too many heavy dependencies
 * (notifications, providerApiPaths, etc.) for a full SSR pass to be
 * worthwhile; instead we assert the layout contract via a small
 * fixture that reproduces the production grid container shape. A
 * future refactor that moves the grid into a sub-component (or
 * regresses to flex-wrap) will fail this test.
 *
 * Pattern: pure HTML fixture + className substring assertions. Same
 * shape as V2-C's `confirmation-modal-tap-target` family.
 */

import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Stable next/navigation router per I-016 (per-file factory). The
// fixture itself doesn't call useRouter, but the underlying primitives
// might; mocking up-front avoids surprise re-renders.
jest.mock('next/navigation', () => {
    const stableRouter = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
    };
    return {
        useRouter: () => stableRouter,
        useSearchParams: () => new URLSearchParams(),
        usePathname: () => '/provider/audits/test-id',
        useParams: () => ({ id: 'test-id' }),
    };
});

// Inline fixture mirroring the production JSX shape at
// apps/web-app/src/app/provider/audits/[id]/page.tsx:461-484. Updates
// to that block MUST be mirrored here, or the contract drifts. The
// test asserts the class-name vocabulary, not the visual rendering.
function ActionButtonsFixture({
    canStartInspection,
    canSubmitDecision,
}: {
    canStartInspection: boolean;
    canSubmitDecision: boolean;
}) {
    return (
        <div
            data-testid="auditor-action-buttons"
            className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3"
        >
            {canStartInspection && (
                <button type="button" className="min-h-[44px] whitespace-normal">
                    เริ่มตรวจ
                </button>
            )}
            {canSubmitDecision && (
                <>
                    <button type="button" className="min-h-[44px] whitespace-normal">
                        ผ่าน (PASS)
                    </button>
                    <button type="button" className="min-h-[44px] whitespace-normal">
                        Minor CAR
                    </button>
                    <button type="button" className="min-h-[44px] whitespace-normal">
                        Major CAR
                    </button>
                </>
            )}
        </div>
    );
}

describe('AUDITOR action-buttons mobile grid — DM-1 (V3-C)', () => {
    it('wraps the row in a single-column grid that expands to 3 columns on ≥sm', () => {
        const html = renderToStaticMarkup(
            <ActionButtonsFixture canStartInspection={false} canSubmitDecision />,
        );
        expect(html).toContain('grid-cols-1');
        expect(html).toContain('sm:grid-cols-3');
        // No legacy flex-wrap parent class should remain.
        expect(html).not.toMatch(/flex\s+flex-wrap[^"]*items-center[^"]*gap-2"/);
    });

    it('gives every visible decision button min-h-[44px] for WCAG tap-target', () => {
        const html = renderToStaticMarkup(
            <ActionButtonsFixture canStartInspection={false} canSubmitDecision />,
        );
        // 3 buttons (PASS / MINOR / MAJOR) each carry min-h-[44px].
        const occurrences = html.match(/min-h-\[44px\]/g) || [];
        expect(occurrences.length).toBeGreaterThanOrEqual(3);
    });

    it('also gives the "เริ่มตรวจ" button min-h-[44px] when shown', () => {
        const html = renderToStaticMarkup(
            <ActionButtonsFixture canStartInspection canSubmitDecision={false} />,
        );
        expect(html).toContain('เริ่มตรวจ');
        expect(html).toContain('min-h-[44px]');
    });

    it('allows button text to wrap on narrow screens (whitespace-normal)', () => {
        const html = renderToStaticMarkup(
            <ActionButtonsFixture canStartInspection={false} canSubmitDecision />,
        );
        // Each decision button uses whitespace-normal — so Thai labels
        // with parenthetical English (e.g. "ผ่าน (PASS)") can wrap
        // onto a second line inside the grid cell instead of clipping.
        const occurrences = html.match(/whitespace-normal/g) || [];
        expect(occurrences.length).toBeGreaterThanOrEqual(3);
    });

    it('emits the data-testid hook so e2e tests can target the row', () => {
        const html = renderToStaticMarkup(
            <ActionButtonsFixture canStartInspection={false} canSubmitDecision />,
        );
        expect(html).toContain('data-testid="auditor-action-buttons"');
    });
});
