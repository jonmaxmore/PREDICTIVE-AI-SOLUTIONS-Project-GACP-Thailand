/**
 * Certificate PDF — the revision line under the certificate number.
 *
 * Spec: design note 2026-08-27-certificate-revision-design §PDF
 *   when revisionNo > 1, print "ฉบับแก้ไขครั้งที่ n · <revisedAt Thai date>"
 *   under the certificate number (placeholder REVISION_LINE, '' at revision 1).
 *   n = revisionNo - 1: the second signed content is the first correction.
 *
 * Pattern: certificate-template-service.test.js (qrcode + puppeteer mocked so
 * the rendered HTML can be inspected without a browser).
 */

'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('qrcode', () => ({
    toDataURL: jest.fn(async () => 'data:image/png;base64,FAKEQR=='),
}));

const mockGeneratedHtmls = [];
jest.mock('../../services/pdf/pdf-generator.service', () => {
    const mockFs = require('fs');
    return {
        generatePDF: jest.fn(async (html) => {
            mockGeneratedHtmls.push(html);
            return Buffer.from(`%PDF-FAKE-${html.length}`);
        }),
        replaceTemplateVariables: jest.fn((template, data) => {
            return template.replace(/\{\{(\w+)\}\}/g, (m, key) => {
                const v = data[key];
                return v === undefined ? m : String(v);
            });
        }),
        readTemplateCached: jest.fn((p) => mockFs.readFileSync(p, 'utf-8')),
    };
});

jest.mock('../../services/storage-service', () => ({
    BUCKETS: { certificates: 'certificates' },
    uploadBuffer: jest.fn(async () => ({ ok: true })),
    getSignedDownloadUrl: jest.fn(async () => 'https://example/signed-url'),
}));

jest.mock('../../shared/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const {
    buildCertificateContext,
    generateCertificatePdf,
} = require('../../services/pdf/certificate-template-service');

const TEMPLATE_PATH = path.join(
    __dirname, '..', '..', 'services', 'pdf', 'templates', 'certificate.html',
);

const BASE_CERT = Object.freeze({
    certificateNumber: 'GACP-TH-2569-A3F7B2',
    verificationCode: 'A1B2C3D4',
    qrData: 'https://gacpth.com/verify/GACP-TH-2569-A3F7B2',
    applicantName: 'สมชาย ใจดี',
    applicantId: '1234567890123',
    cropType: 'กัญชา / Cannabis sativa L.',
    farmName: 'ฟาร์มสมุนไพรสมชาย',
    province: 'เชียงราย',
    district: 'เมือง',
    subDistrict: 'รอบเวียง',
    address: 'หมู่ 1',
    standardName: 'GACP Thailand',
    issuedDate: new Date('2026-05-16T03:00:00Z'),
    expiryDate: new Date('2027-05-16T03:00:00Z'),
});

// 02:00Z is 09:00 Asia/Bangkok and still the 27th in UTC, so the printed
// day does not depend on the runner's timezone.
const REVISED_AT = new Date('2026-08-27T02:00:00Z');
const REVISION_2 = Object.freeze({ ...BASE_CERT, revisionNo: 2, revisedAt: REVISED_AT });
const REVISION_1 = Object.freeze({ ...BASE_CERT, revisionNo: 1 });

const EXPECTED_LINE = 'ฉบับแก้ไขครั้งที่ 1 · 27 ส.ค. 2569';
const CERT_NUMBER_SPAN = '<span class="cert-num">GACP-DTAM-2569-A3F7B2</span>';

describe('certificate PDF: revision line — buildCertificateContext', () => {
    it('prints "ฉบับแก้ไขครั้งที่ 1 · <Thai date>" for the second signed content', () => {
        const ctx = buildCertificateContext(REVISION_2);
        expect(ctx.REVISION_LINE).toBe(EXPECTED_LINE);
    });

    it('numbers the correction as revisionNo - 1 (third content = second correction)', () => {
        const ctx = buildCertificateContext({ ...BASE_CERT, revisionNo: 3, revisedAt: REVISED_AT });
        expect(ctx.REVISION_LINE).toBe('ฉบับแก้ไขครั้งที่ 2 · 27 ส.ค. 2569');
    });

    it('is the empty string at revision 1', () => {
        const ctx = buildCertificateContext(REVISION_1);
        expect(ctx.REVISION_LINE).toBe('');
    });

    it('is the empty string for a row that predates the revision columns', () => {
        const ctx = buildCertificateContext(BASE_CERT);
        expect(ctx.REVISION_LINE).toBe('');
    });

    it('never carries an em dash into the printed Thai line', () => {
        const ctx = buildCertificateContext(REVISION_2);
        expect(ctx.REVISION_LINE).not.toContain('—');
    });
});

describe('certificate PDF: revision line — template HTML', () => {
    let template;
    beforeAll(() => { template = fs.readFileSync(TEMPLATE_PATH, 'utf-8'); });

    it('carries the REVISION_LINE placeholder inside a .cert-revision element', () => {
        expect(template).toContain('<div class="cert-revision">{{REVISION_LINE}}</div>');
    });

    it('places the element directly under the certificate number block', () => {
        const numberAt = template.indexOf('<span class="cert-num">{{CERT_NUMBER}}</span>');
        const lineAt = template.indexOf('<div class="cert-revision">{{REVISION_LINE}}</div>');
        expect(numberAt).toBeGreaterThan(-1);
        expect(lineAt).toBeGreaterThan(numberAt);
        // Nothing but the Thai-numeral mirror of the number sits between them.
        const between = template.slice(numberAt, lineAt);
        expect(between).not.toContain('<section');
        expect(between).not.toContain('</section>');
    });

    it('hides the element when empty so revision 1 prints no blank line', () => {
        expect(template).toMatch(/\.cert-revision:empty\s*\{\s*display:\s*none;?\s*\}/);
    });
});

describe('certificate PDF: revision line — rendered HTML', () => {
    beforeEach(() => {
        mockGeneratedHtmls.length = 0;
        jest.clearAllMocks();
    });

    it('renders the revision line after the certificate number for a revised certificate', async () => {
        await generateCertificatePdf(REVISION_2, { upload: false });
        expect(mockGeneratedHtmls).toHaveLength(1);
        const html = mockGeneratedHtmls[0];
        // The header comment of the template lists every placeholder and is
        // substituted too, so anchor on the printed element, not the bare text.
        const printed = `<div class="cert-revision">${EXPECTED_LINE}</div>`;
        expect(html).toContain(printed);
        const numberAt = html.lastIndexOf(CERT_NUMBER_SPAN);
        expect(numberAt).toBeGreaterThan(-1);
        expect(html.indexOf(printed)).toBeGreaterThan(numberAt);
        expect(html).not.toContain('{{REVISION_LINE}}');
    });

    it('prints no "ฉบับแก้ไข" at revision 1', async () => {
        await generateCertificatePdf(REVISION_1, { upload: false });
        const html = mockGeneratedHtmls[0];
        expect(html).not.toContain('ฉบับแก้ไข');
        expect(html).not.toContain('{{REVISION_LINE}}');
        expect(html).toContain('<div class="cert-revision"></div>');
    });
});
