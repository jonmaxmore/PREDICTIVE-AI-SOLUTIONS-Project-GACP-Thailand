/**
 * W3 (real-qr-codes, 2026-08-22) — the public cert-verify page previously
 * showed a decorative lucide `<QrCode>` icon captioned "สแกนเพื่อตรวจสอบ"
 * (the backlog 2026-08-20). That icon is not a code — nothing can
 * scan it. This pins two contracts:
 *
 *   1. The page renders a REAL `QrImage` (the shared component) encoding
 *      this certificate's own public verify URL — built from the SAME
 *      request-host source the page already uses for its backend fetch
 *      (see the C1 comment in page.tsx), not a hardcoded host.
 *   2. The decorative icon is gone — page.tsx no longer imports/renders
 *      lucide-react's `QrCode` at all.
 *
 * Follows the sibling `verify-holder-row.test.tsx` pattern: render the
 * async server component directly (next/headers + fetch stubbed), then
 * `renderToStaticMarkup`. `QrImage` itself is mocked here — its own
 * client-side generation + real-decode proof lives in
 * `src/components/ui/__tests__/qr-image.decode.test.ts`, which never
 * mocks `qrcode`. This test's job is only the page's WIRING: does it ask
 * for a real QR encoding the right value, and is the fake one gone.
 */

import * as fs from 'fs';
import * as path from 'path';
import { renderToStaticMarkup } from 'react-dom/server';

const mockHeaderGet = jest.fn((name: string) =>
    name === 'x-forwarded-host' ? 'staging.gacpth.com' : name === 'x-forwarded-proto' ? 'https' : null,
);

jest.mock('next/headers', () => ({
    headers: async () => ({ get: (name: string) => mockHeaderGet(name) }),
}));

jest.mock('@/components/ui/qr-image', () => {
    // Keep the REAL qrRenderOptions (a pure function, no canvas/DOM
    // dependency) — page.tsx imports it alongside QrImage for its SSR
    // pre-render, and a mock module that omitted it would make that call
    // throw "qrRenderOptions is not a function" (fix-round 1 finding).
    const actual = jest.requireActual('@/components/ui/qr-image') as { qrRenderOptions: (size: number) => object };
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reason: jest factory closure
    const React = require('react');
    return {
        __esModule: true,
        qrRenderOptions: actual.qrRenderOptions,
        QrImage: (
            { value, alt, initialDataUrl }: { value: string; alt: string; initialDataUrl?: string | null },
        ) =>
            React.createElement('div', {
                'data-testid': 'qr-image-stub',
                'data-value': value,
                'data-alt': alt,
                'data-has-initial-data-url': initialDataUrl ? 'true' : 'false',
            }),
    };
});

import PublicCertVerifyPage from '../page';

const CERT_NUMBER = 'GACP-TH-2569-85B448';

function stubVerifyResponse(certificate: Record<string, unknown>) {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
            success: true,
            verified: true,
            valid: true,
            data: { certificate, verifiedAt: '2026-08-15T00:00:00.000Z' },
        }),
    }) as unknown as typeof fetch;
}

async function renderPage(certNumber = CERT_NUMBER) {
    const element = await PublicCertVerifyPage({
        params: Promise.resolve({ 'cert-number': certNumber }),
    });
    return renderToStaticMarkup(element);
}

afterEach(() => {
    jest.clearAllMocks();
});

describe('W3 — public verify page renders a REAL QR, not a decorative icon', () => {
    it('renders QrImage with value = this certificate\'s own public verify URL (request-host based)', async () => {
        stubVerifyResponse({
            farmName: 'ฟาร์มสมุนไพรบ้านนา',
            province: 'เชียงใหม่',
            cropTypes: ['ขมิ้นชัน'],
            issueDate: '2026-01-01T00:00:00.000Z',
            expiryDate: '2027-01-01T00:00:00.000Z',
        });
        const html = await renderPage();
        expect(html).toContain('data-testid="qr-image-stub"');
        expect(html).toContain(`data-value="https://staging.gacpth.com/verify/${CERT_NUMBER}"`);
    });

    it('does not import lucide-react\'s decorative QrCode icon anywhere in page.tsx', () => {
        const src = fs.readFileSync(path.join(__dirname, '../page.tsx'), 'utf8');
        expect(src).not.toMatch(/\bQrCode\b/);
    });

    it('still prints the certificate number as the human-readable fallback', async () => {
        stubVerifyResponse({ farmName: 'ฟาร์มสมุนไพรบ้านนา' });
        const html = await renderPage();
        expect(html).toContain(CERT_NUMBER);
    });

    it('pre-renders a real QR data URL server-side (fix-round 1, point 5 — SSR/no-JS/crawler sees a real code, not a blank box)', async () => {
        stubVerifyResponse({ farmName: 'ฟาร์มสมุนไพรบ้านนา' });
        const html = await renderPage();
        expect(html).toContain('data-has-initial-data-url="true"');
    });
});
