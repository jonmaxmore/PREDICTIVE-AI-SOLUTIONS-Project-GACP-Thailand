/**
 * W3 (real-qr-codes, 2026-08-22) — the certificate-list QR preview dialog.
 *
 * `client-view.tsx` opens a dialog showing a certificate's QR when the
 * user taps the QR thumbnail button. When the backend hadn't attached a
 * `qrCode` blob to a row, the dialog fell back to a decorative lucide
 * `<QrCode>` icon (the backlog 2026-08-20) — that fallback is not a
 * code, nothing can scan it.
 *
 * Fix: the dialog now always renders the shared `QrImage`, generating the
 * code client-side from `CertificateService.getCertificateVerifyUrl` (the
 * SAME source cert-detail already trusts — never stale, unlike a backend
 * blob), with the backend `qrCode` kept ONLY as `fallbackSrc` for if
 * client-side generation itself errors.
 *
 * Pattern mirrors `certificates-error-state.test.tsx`: createRoot + act,
 * `@/lib/api` mocked at the module boundary, wrapped in LanguageProvider
 * (the page throws outside one).
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn<(url: string) => Promise<unknown>>();
jest.mock('@/lib/api', () => ({
    apiClient: { get: (url: string) => mockApiGet(url) },
    api: { get: (url: string) => mockApiGet(url) },
}));

// Real QR generation + decode-proof lives in
// src/components/ui/__tests__/qr-image.decode.test.ts. This test only
// pins that the DIALOG asks for one with the right value — stub it so
// this test doesn't depend on jsdom's canvas (which qrcode's browser
// path needs and jsdom does not provide).
jest.mock('@/components/ui/qr-image', () => ({
    __esModule: true,
    QrImage: ({ value, alt }: { value: string; alt: string }) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- reason: jest factory closure
        const React = require('react');
        return React.createElement('div', {
            'data-testid': 'qr-image-stub',
            'data-value': value,
            'data-alt': alt,
        });
    },
}));

import HealthCertificatesPage from '../client-view';
import { LanguageProvider } from '@/lib/i18n/language-context';
import { CertificateService } from '@/lib/services/certificate-service';

const CERT: Record<string, unknown> = {
    id: 'c1',
    id: 'c1',
    certificateNumber: 'GACP-TH-2569-99XYZ',
    applicationId: 'app-1',
    farmId: 'farm-1',
    siteName: 'ฟาร์มทดสอบ',
    plantType: 'ขมิ้นชัน',
    issuedDate: '2026-01-01T00:00:00.000Z',
    expiryDate: '2028-01-01T00:00:00.000Z',
    status: 'ACTIVE',
    // No qrCode — this is exactly the row that used to fall back to the
    // decorative icon.
};

describe('[W3] /health/certificates — QR preview dialog renders a REAL QR, not a decorative icon', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

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

    it('tapping the QR thumbnail for a cert WITHOUT a backend qrCode opens a dialog with a real QrImage encoding its verify URL', async () => {
        mockApiGet.mockResolvedValueOnce({ success: true, data: { data: [CERT] } });
        mount();
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        const thumb = container!.querySelector('button[aria-label="คิวอาร์โค้ดของใบรับรอง GACP"]');
        expect(thumb).not.toBeNull();
        act(() => {
            (thumb as HTMLButtonElement).click();
        });

        // Fix-round 1 (review 6712f985): the previous assertion here queried
        // `[data-testid="qr-image-stub"] svg` — the stub is a childless div,
        // so that selector can NEVER match anything and the check was
        // vacuous regardless of what actually rendered. Scope to the QR
        // box itself (data-testid="cert-qr-preview-box", added to the SUT)
        // instead: that box renders EITHER the real `<QrImage>` (stubbed
        // here to a childless div) OR, pre-fix, a plain lucide `<QrCode>`
        // icon — an actual `<svg>`. Asserting no `<svg>` inside that
        // specific box is a genuine regression check.
        // The Dialog primitive portals its content to document.body, not
        // into `container` — mirrors the original stub lookup below.
        const qrBox = document.body.querySelector('[data-testid="cert-qr-preview-box"]');
        expect(qrBox).not.toBeNull();

        const stub = qrBox!.querySelector('[data-testid="qr-image-stub"]');
        expect(stub).not.toBeNull();
        const expectedUrl = CertificateService.getCertificateVerifyUrl('GACP-TH-2569-99XYZ');
        expect(stub!.getAttribute('data-value')).toBe(expectedUrl);

        expect(qrBox!.querySelector('svg')).toBeNull();
    });
});
