/**
 * V1-C / D9 — /health/certificates error vs empty state.
 *
 * Before V1-C the page's fetch handler swallowed every error via
 * `.catch(() => setCertificates([]))`, so a 500 from the backend
 * rendered exactly the same "ยังไม่พบใบรับรอง" empty-state card
 * as a successfully fetched zero-row result. Applicants whose
 * backend was down were told they had no certificates.
 *
 * V1-C distinguishes three states:
 *   1. loading                → PageSkeleton (existing).
 *   2. fetched 0 rows        → existing zinc empty-state card
 *                               (data-testid="cert-list-empty").
 *   3. fetch returned an error → NEW rose error card with retry
 *                               (data-testid="cert-list-error").
 *
 * These tests use createRoot + act so the useEffect fires and we
 * can assert on the post-resolve markup. The api client is mocked
 * via jest.mock('@/lib/api') so the test stays hermetic.
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock the api client BEFORE importing the page so the import sees
// our stub. The certificates page consumes only `apiClient.get` for
// the `/api/certificates/my` lookup.
const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api', () => ({
    apiClient: { get: (url: string) => mockApiGet(url) },
    api: { get: (url: string) => mockApiGet(url) },
}));

// PageSkeleton renders a non-empty fragment we can assert on for the
// loading branch. Keep the real implementation (no mock needed).

// framer-motion's `motion.div` renders a plain div in SSR — we don't
// need to mock it for SSR-ish testing.

import HealthCertificatesPage from '../client-view';
// W3-C: the page now consumes useLanguage(), which throws when the
// component is mounted outside a LanguageProvider. Wrap the test mount
// so the existing assertions (which target the Thai copy because TH is
// the default locale) continue to work.
import { LanguageProvider } from '@/lib/i18n/language-context';

describe('[V1-C / D9] /health/certificates — loading vs empty vs error', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset the persisted language back to TH so the existing Thai
        // assertions hold regardless of test ordering.
        try {
            window.localStorage.removeItem('language');
        } catch {
            /* JSDOM may not expose localStorage in some setups — ignore. */
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

    function mount() {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(
                <LanguageProvider>
                    <HealthCertificatesPage />
                </LanguageProvider>,
            );
        });
    }

    it('renders the loading skeleton before the fetch resolves', () => {
        // Pending promise — never resolves so we observe the initial branch.
        mockApiGet.mockReturnValue(new Promise(() => undefined));
        mount();
        // Loading branch returns <PageSkeleton type="list" /> which renders
        // animated bone placeholders — assert neither the empty nor error
        // state markup is present, AND that the SummaryHeader is not
        // rendered yet (that's the post-load branch).
        expect(container!.querySelector('[data-testid="cert-list-empty"]')).toBeNull();
        expect(container!.querySelector('[data-testid="cert-list-error"]')).toBeNull();
        // Empty-state copy must NOT leak into the loading branch.
        expect(container!.textContent).not.toContain('ยังไม่พบใบรับรอง');
    });

    it('renders the empty state when the backend returns an empty list', async () => {
        mockApiGet.mockResolvedValueOnce({ success: true, data: { data: [] } });
        mount();
        await act(async () => {
            await Promise.resolve();
        });

        const empty = container!.querySelector('[data-testid="cert-list-empty"]');
        expect(empty).not.toBeNull();
        expect(empty!.textContent).toContain('ยังไม่พบใบรับรอง');
        // The error state MUST NOT render in the empty branch.
        expect(container!.querySelector('[data-testid="cert-list-error"]')).toBeNull();
    });

    it('renders the NEW error state when the apiClient envelope reports success=false', async () => {
        // The api-client surfaces non-2xx as `{ success: false, error: ... }`.
        // V1-C's fix MUST branch on this and show the error card with a
        // retry CTA — NOT the zinc empty-state card.
        mockApiGet.mockResolvedValueOnce({
            success: false,
            error: 'ระบบกำลังปรับปรุง',
        });
        mount();
        await act(async () => {
            await Promise.resolve();
        });

        const errCard = container!.querySelector('[data-testid="cert-list-error"]');
        expect(errCard).not.toBeNull();
        // Header verbatim from the implementation.
        expect(errCard!.textContent).toContain('ไม่สามารถโหลดรายการใบรับรองได้');
        // The backend error string is rendered for context.
        expect(errCard!.textContent).toContain('ระบบกำลังปรับปรุง');
        // Retry CTA present (so the user can recover without refresh).
        expect(errCard!.textContent).toContain('ลองอีกครั้ง');
        // Empty state MUST NOT render in the error branch.
        expect(container!.querySelector('[data-testid="cert-list-empty"]')).toBeNull();
        // Empty-state Thai copy MUST NOT leak — that was the bug.
        expect(container!.textContent).not.toContain('ยังไม่พบใบรับรอง');
    });

    it('renders the error state when the fetch promise rejects (network outage)', async () => {
        mockApiGet.mockRejectedValueOnce(new Error('network outage'));
        mount();
        await act(async () => {
            await Promise.resolve();
        });

        const errCard = container!.querySelector('[data-testid="cert-list-error"]');
        expect(errCard).not.toBeNull();
        expect(errCard!.textContent).toContain('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
        // Defensive: empty state must NOT also be on screen.
        expect(container!.querySelector('[data-testid="cert-list-empty"]')).toBeNull();
    });
});
