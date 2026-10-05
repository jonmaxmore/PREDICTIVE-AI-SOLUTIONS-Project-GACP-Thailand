/**
 * M1 (plan Task B2) — the public verify page names the HOLDER of the
 * certificate, not the person who filled the form.
 *
 * The backend verify JSON is additive (apps/backend/routes/api/auth/public.js):
 * `data.certificate.holderDisplayName` arrives next to the old, still-masked
 * `applicantName`. This page must prefer the holder and fall back to
 * applicantName for rows issued before the M1 backfill, so a farm whose
 * certificate is held by a company shows the company, and an old certificate
 * shows exactly what it showed yesterday.
 *
 * Unlike the sibling crypto-verdict test (which renders the pure view-model),
 * this one renders the async server component itself: the label + value pair
 * IS the thing under test and it lives in page.tsx. next/headers and fetch are
 * the only two things stubbed.
 */

import { renderToStaticMarkup } from 'react-dom/server';

const mockHeaderGet = jest.fn((name: string) =>
    name === 'x-forwarded-host' ? 'staging.gacpth.com' : name === 'x-forwarded-proto' ? 'https' : null,
);

jest.mock('next/headers', () => ({
    headers: async () => ({ get: (name: string) => mockHeaderGet(name) }),
}));

import PublicCertVerifyPage from '../page';

const HOLDER_LABEL_TH = 'ผู้ถือใบรับรอง';
const OLD_LABEL_TH = 'ผู้ประกอบการ';

type CertSlice = Record<string, unknown>;

function stubVerifyResponse(certificate: CertSlice) {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
            success: true,
            verified: true,
            valid: true,
            data: {
                certificate,
                verifiedAt: '2026-08-15T00:00:00.000Z',
            },
        }),
    }) as unknown as typeof fetch;
}

async function renderPage(certNumber = 'GACP-TH-2569-A3F7B2') {
    const element = await PublicCertVerifyPage({
        params: Promise.resolve({ 'cert-number': certNumber }),
    });
    return renderToStaticMarkup(element);
}

const BASE_CERT = {
    farmName: 'ฟาร์มสมุนไพรบ้านนา',
    province: 'เชียงใหม่',
    cropTypes: ['ขมิ้นชัน'],
    issueDate: '2026-01-01T00:00:00.000Z',
    expiryDate: '2027-01-01T00:00:00.000Z',
    standards: ['GACP'],
};

afterEach(() => {
    jest.clearAllMocks();
});

describe('M1 — public verify page shows the certificate holder', () => {
    it('renders the juristic holder name under the label ผู้ถือใบรับรอง', async () => {
        stubVerifyResponse({
            ...BASE_CERT,
            applicantName: 'สมชาย ใ.',
            holderDisplayName: 'บริษัท สมุนไพรไทย จำกัด',
        });
        const html = await renderPage();
        expect(html).toContain(HOLDER_LABEL_TH);
        expect(html).toContain('บริษัท สมุนไพรไทย จำกัด');
        // The old label is retired — one row, one meaning.
        expect(html).not.toContain(OLD_LABEL_TH);
    });

    it('falls back to the masked applicantName for pre-backfill certificates', async () => {
        stubVerifyResponse({ ...BASE_CERT, applicantName: 'สมชาย ใ.' });
        const html = await renderPage();
        expect(html).toContain(HOLDER_LABEL_TH);
        expect(html).toContain('สมชาย ใ.');
    });

    it('renders no holder row at all when neither name is present', async () => {
        stubVerifyResponse({ ...BASE_CERT });
        const html = await renderPage();
        expect(html).not.toContain(HOLDER_LABEL_TH);
        // The rest of the certificate still renders.
        expect(html).toContain('ฟาร์มสมุนไพรบ้านนา');
    });
});
