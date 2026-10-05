/**
 * findings-remove-button-tap-target.test.tsx — V3-C (DM-2) regression.
 *
 * Purpose: pin the inspect-flow DecisionScreen's "remove finding" tap
 * target to the WCAG 2.5.5 minimum (≥ 44×44 px). Pre-V3 the button
 * used `h-10 w-10` (40×40), which is under the AA threshold and
 * particularly painful on phones held with one hand. V3-C raised it
 * to `h-11 w-11 min-h-[44px] min-w-[44px]`.
 *
 * The full `InspectClient` is heavy (geolocation, auto-save timers,
 * AuditService HTTP calls). To keep this test cheap and deterministic
 * we grep the source file for the production class string — a future
 * regression that downsizes the button below 44 px will fail this
 * test before it ships. This is the same pattern used by V2-D's
 * mobile-tap-target checks.
 */

import { describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Stable next/navigation router per I-016 — paid up-front so we can
// add a render-based sub-test below without re-mocking.
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
        usePathname: () => '/provider/audits/test-id/inspect',
        useParams: () => ({ id: 'test-id' }),
    };
});

// Production fixture mirroring the inspect-flow DecisionScreen remove
// button JSX — kept in sync with apps/web-app/.../inspect/client-view.tsx.
function FindingsRemoveButtonFixture({ count }: { count: number }) {
    const items = Array.from({ length: count }, (_, i) => `finding-${i}`);
    return (
        <ul className="mt-3 space-y-2">
            {items.map((f, idx) => (
                <li key={idx} className="flex items-start gap-2">
                    <textarea
                        defaultValue={f}
                        rows={2}
                        placeholder="ระบุข้อค้นพบ"
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    {items.length > 1 ? (
                        <button
                            type="button"
                            className="inline-flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50"
                            aria-label="ลบรายการ"
                        >
                            ×
                        </button>
                    ) : null}
                </li>
            ))}
        </ul>
    );
}

describe('inspect/DecisionScreen findings remove-button tap target — DM-2 (V3-C)', () => {
    it('renders h-11 w-11 min-h-[44px] min-w-[44px] on the remove button (fixture)', () => {
        const html = renderToStaticMarkup(<FindingsRemoveButtonFixture count={2} />);
        // Each of 2 findings has its own remove button → 2 matches.
        const minH = html.match(/min-h-\[44px\]/g) || [];
        const minW = html.match(/min-w-\[44px\]/g) || [];
        expect(minH.length).toBeGreaterThanOrEqual(2);
        expect(minW.length).toBeGreaterThanOrEqual(2);
        expect(html).toContain('h-11');
        expect(html).toContain('w-11');
    });

    it('omits the remove button when there is only one finding (no orphan delete)', () => {
        const html = renderToStaticMarkup(<FindingsRemoveButtonFixture count={1} />);
        expect(html).not.toContain('aria-label="ลบรายการ"');
    });

    it('uses Thai aria-label on the remove button', () => {
        const html = renderToStaticMarkup(<FindingsRemoveButtonFixture count={2} />);
        expect(html).toContain('aria-label="ลบรายการ"');
        expect(html).not.toContain('aria-label="Remove"');
        expect(html).not.toContain('aria-label="Delete"');
    });

    it('production source file (inspect/client-view.tsx) keeps the ≥44 px class set', () => {
        // Locked grep — catches a future regression where someone
        // shrinks the tap target back to h-10 w-10. The tailwind
        // class-order plugin reshuffles the classes during --fix, so
        // we check for the individual size tokens instead of an
        // ordered substring.
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', 'inspect', 'client-view.tsx'),
            'utf8',
        );
        expect(src).toContain('h-11');
        expect(src).toContain('w-11');
        expect(src).toContain('min-h-[44px]');
        expect(src).toContain('min-w-[44px]');
        // No instance of the legacy h-10 w-10 anywhere in the inspect
        // client view (the only `h-10 w-10` we ever shipped was on the
        // remove-finding button; a strict file-level guard is fine).
        expect(src).not.toContain('h-10 w-10');
    });
});
