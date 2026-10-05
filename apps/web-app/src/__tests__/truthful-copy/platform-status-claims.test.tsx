/**
 * What the site says it is (audit 2026-09-17 UXUI-02, operator decision 6).
 *
 * Before this suite:
 *   - the footer, on every marketing, legal and dashboard page, said
 *     "ระบบนี้รับรองโดย{ministry}" and "เป็นเว็บไซต์ของรัฐบาลไทย ใช้งานฟรี
 *     ไม่มีค่าใช้จ่ายแอบแฝง" — on a .com site that bills 35,310 THB per
 *     cultivation scope, whose own login page says the official Garuda emblem is
 *     still awaiting approval, and whose Terms name a company as the seller;
 *   - both public verify pages printed "ออกโดย ... ภายใต้มาตรฐาน ISO/IEC 17065"
 *     under every result, including "not found" and "could not check".
 *
 * No record in the repository shows a government authorisation for this site,
 * or an ISO/IEC 17065 accreditation. What the records do show: the platform
 * company provides and bills the service (payment-terms v1.2 §1), and the
 * certificate is the department's (Terms of Service §1-§2;
 * apps/backend/services/pdf/templates/certificate.html "ออกโดย DTAM").
 */

import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

import { Footer } from '@/components/layout/Footer';
import { th } from '@/lib/i18n/dictionaries/th';
import { en } from '@/lib/i18n/dictionaries/en';

const mockHeaderGet = jest.fn((name: string) =>
    name === 'x-forwarded-host' ? 'demo.gacpth.com' : name === 'x-forwarded-proto' ? 'https' : null,
);

jest.mock('next/headers', () => ({
    headers: async () => ({ get: (name: string) => mockHeaderGet(name) }),
}));

jest.mock('@/components/ui/qr-image', () => {
    const actual = jest.requireActual('@/components/ui/qr-image') as { qrRenderOptions: (size: number) => object };
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reason: jest factory closure
    const React = require('react');
    return {
        __esModule: true,
        qrRenderOptions: actual.qrRenderOptions,
        QrImage: () => React.createElement('div', { 'data-testid': 'qr-image-stub' }),
    };
});

import PublicCertVerifyPage from '@/app/(public)/verify/[cert-number]/page';
import PublicCertRevisionPage from '@/app/(public)/verify/[cert-number]/revision/[n]/page';

const ISSUER_LINE = 'ใบรับรองออกโดยกรมการแพทย์แผนไทยและการแพทย์ทางเลือก';

function textOf(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || '').replace(/\s+/g, ' ');
}

function stubFetch(response: { ok: boolean; status?: number; body?: unknown } | 'throw') {
    global.fetch = jest.fn(async () => {
        if (response === 'throw') throw new Error('network down');
        return {
            ok: response.ok,
            status: response.status ?? (response.ok ? 200 : 500),
            json: async () => response.body,
        };
    }) as unknown as typeof fetch;
}

async function verifyText(): Promise<string> {
    const element = await PublicCertVerifyPage({
        params: Promise.resolve({ 'cert-number': 'GACP-TH-2569-85B448' }),
    });
    return textOf(renderToStaticMarkup(element));
}

async function revisionText(): Promise<string> {
    const element = await PublicCertRevisionPage({
        params: Promise.resolve({ 'cert-number': 'GACP-TH-2569-85B448', n: '1' }),
    });
    return textOf(renderToStaticMarkup(element));
}

afterEach(() => {
    jest.clearAllMocks();
});

describe('footer', () => {
    const html = renderToStaticMarkup(<Footer buildDate="2026-09-17" version="abc1234" />);
    const text = textOf(html);

    it('does not call the site a government website, free, or certified by the department', () => {
        expect(text).not.toContain('เว็บไซต์ของรัฐบาล');
        expect(text).not.toContain('ใช้งานฟรี');
        expect(text).not.toContain('รับรองโดย');
    });

    it('says who runs the service, who issues the certificate, and that it charges fees', () => {
        expect(text).toContain('บริษัทผู้ให้บริการแพลตฟอร์ม');
        expect(text).toContain(`ใบรับรองออกโดย${th.common.ministryName}`);
        expect(text).toContain('บริการนี้มีค่าบริการ');
        expect(html).toContain('href="/pricing"');
    });

    it('the English footer makes none of the retired claims either', () => {
        const footerEn = Object.values(en.footer).filter((v): v is string => typeof v === 'string').join('\n');
        expect(footerEn).not.toMatch(/government website/i);
        expect(footerEn).not.toMatch(/free to use/i);
        expect(footerEn).not.toMatch(/endorsed by/i);
        const footerTh = Object.values(th.footer).filter((v): v is string => typeof v === 'string').join('\n');
        expect(footerTh).not.toContain('เว็บไซต์ของรัฐบาล');
        expect(footerTh).not.toContain('รับรองโดย');
    });
});

describe('public verify page', () => {
    it('a found certificate names its issuer and claims no ISO/IEC 17065 accreditation', async () => {
        stubFetch({
            ok: true,
            body: {
                success: true,
                verified: true,
                data: {
                    certificate: { farmName: 'ฟาร์มทดสอบ', expiryDate: '2027-09-01T00:00:00.000Z' },
                    verifiedAt: '2026-09-17T00:00:00.000Z',
                },
            },
        });
        const text = await verifyText();
        expect(text).not.toContain('17065');
        expect(text).toContain(ISSUER_LINE);
    });

    it('a number the register does not hold says nothing about who issued it', async () => {
        stubFetch({
            ok: true,
            body: {
                success: true,
                verified: false,
                data: { reason: 'Certificate not found', reasonCode: 'NOT_FOUND' },
            },
        });
        const text = await verifyText();
        expect(text).not.toContain('17065');
        expect(text).not.toContain(ISSUER_LINE);
    });

    it('a check that could not run says nothing about who issued it', async () => {
        stubFetch('throw');
        const text = await verifyText();
        expect(text).not.toContain('17065');
        expect(text).not.toContain(ISSUER_LINE);
    });
});

describe('public revision page', () => {
    it('an archived revision claims no ISO/IEC 17065 accreditation', async () => {
        stubFetch({
            ok: true,
            body: {
                data: {
                    certificateNumber: 'GACP-TH-2569-85B448',
                    revisionNo: 1,
                    superseded: true,
                    supersededAt: '2026-09-01T00:00:00.000Z',
                    snapshot: { farmName: 'ฟาร์มทดสอบ', province: 'เชียงใหม่' },
                },
            },
        });
        const text = await revisionText();
        expect(text).not.toContain('17065');
        expect(text).toContain(ISSUER_LINE);
    });

    it('a revision that does not exist says nothing about who issued it', async () => {
        stubFetch({ ok: false, status: 404 });
        const text = await revisionText();
        expect(text).not.toContain('17065');
        expect(text).not.toContain(ISSUER_LINE);
    });
});
