/**
 * M1 Task B1 — the public verify readers show the HOLDER, not the person who typed.
 *
 * PR-A added `Certificate.holderDisplayName` / `holderType`
 * (prisma/schema/certification.prisma:34-35). This suite pins how the two
 * public readers consume them:
 *
 *   1. `holderNameForDisplay(cert)` (routes/api/auth/public.js) — the masking
 *      rule of plan D2: a juristic / community-enterprise name is a business
 *      name, NOT personal data, so it is shown in full; a person-shaped holder
 *      (INDIVIDUAL / LEGACY_PERSON / unknown) keeps going through the PR-1.5
 *      `maskApplicantName` anti-scraping control.
 *   2. The PDF placeholder map (services/pdf/certificate-template-service.js)
 *      prefers `holderDisplayName` and falls back to `applicantName` for rows
 *      issued before the backfill.
 *
 * The JSON contract is ADDITIVE (plan D11/D12): `applicantName` keeps its old
 * masked value so existing consumers do not break; `holderDisplayName` is new.
 */

'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log), stream: { write: jest.fn() } };
});

// Rate limiter → pass-through middleware in tests.
jest.mock('../../middleware/rate-limiter', () => ({
    createRateLimiter: () => (_req, _res, next) => next(),
}));

const mockFindByCertificateNumber = jest.fn();
const mockVerifyDocumentIntegrity = jest.fn(() => ({ status: 'VALID' }));
const mockVerifyCertificateSignature = jest.fn(async () => ({ signed: false }));
jest.mock('../../services/certificate-service', () => ({
    findByCertificateNumber: (...args) => mockFindByCertificateNumber(...args),
    verifyDocumentIntegrity: (...args) => mockVerifyDocumentIntegrity(...args),
    verifyCertificateSignature: (...args) => mockVerifyCertificateSignature(...args),
}));

// The PDF service pulls in Puppeteer / MinIO at require time; the mapper under
// test (`buildCertificateContext`) is pure, so the heavy deps are stubbed.
jest.mock('qrcode', () => ({
    toDataURL: jest.fn(async () => 'data:image/png;base64,FAKEQR=='),
}));
jest.mock('../../services/pdf/pdf-generator.service', () => ({
    generatePDF: jest.fn(async () => Buffer.from('%PDF-FAKE')),
    replaceTemplateVariables: jest.fn((template) => template),
    readTemplateCached: jest.fn(() => ''),
}));
jest.mock('../../services/storage-service', () => ({
    BUCKETS: { certificates: 'certificates' },
    uploadBuffer: jest.fn(async () => ({ ok: true })),
    getSignedDownloadUrl: jest.fn(async () => 'https://example/signed-url'),
}));

const publicRouter = require('../../routes/api/auth/public');
const { holderNameForDisplay } = publicRouter;
const { buildCertificateContext } = require('../../services/pdf/certificate-template-service');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/', publicRouter);
    return app;
}

// A raw Certificate row as returned by prisma.certificate.findUnique.
function rawCert(overrides = {}) {
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return {
        certificateNumber: 'GACP-TH-2569-A3F7B2',
        verificationCode: 'A1B2C3D4',
        status: 'active',
        issuedDate: new Date('2026-05-16T03:00:00Z'),
        expiryDate: future,
        farmName: 'ฟาร์มสมุนไพรสมชาย',
        applicantName: 'สมชาย ใจดี',
        holderDisplayName: 'บริษัท สมุนไพรไทย จำกัด',
        holderType: 'JURISTIC',
        province: 'เชียงราย',
        cropType: 'กัญชา / Cannabis sativa L.',
        standardName: 'GACP Thailand',
        documentHash: 'abc',
        ...overrides,
    };
}

describe('M1 holder display on public verify', () => {
    it('shows unmasked juristic holder name', () => {
        expect(holderNameForDisplay({
            holderDisplayName: 'บริษัท สมุนไพรไทย จำกัด',
            holderType: 'JURISTIC',
            applicantName: 'สมชาย ใจดี',
        })).toBe('บริษัท สมุนไพรไทย จำกัด');
    });

    it('shows unmasked community-enterprise holder name', () => {
        expect(holderNameForDisplay({
            holderDisplayName: 'วิสาหกิจชุมชนสมุนไพรบ้านนา',
            holderType: 'COMMUNITY_ENTERPRISE',
            applicantName: 'สมชาย ใจดี',
        })).toBe('วิสาหกิจชุมชนสมุนไพรบ้านนา');
    });

    it('masks person-shaped holders (INDIVIDUAL / LEGACY_PERSON / unknown)', () => {
        const out = holderNameForDisplay({ holderDisplayName: 'สมชาย ใจดี', holderType: 'LEGACY_PERSON' });
        expect(out).not.toBe('สมชาย ใจดี');       // masked by the existing maskApplicantName
        expect(out.startsWith('สมชาย')).toBe(true);

        const individual = holderNameForDisplay({ holderDisplayName: 'สมชาย ใจดี', holderType: 'INDIVIDUAL' });
        expect(individual).toBe(out);
    });

    it('falls back to applicantName when holder columns are empty (pre-backfill rows)', () => {
        expect(holderNameForDisplay({
            holderDisplayName: null, holderType: null, applicantName: 'สมหญิง ดีใจ',
        })).toBe(holderNameForDisplay({
            holderDisplayName: 'สมหญิง ดีใจ', holderType: 'LEGACY_PERSON',
        }));
    });
});

describe('GET /verify/:certificateNumber (JSON) — holderDisplayName is additive', () => {
    beforeEach(() => {
        mockFindByCertificateNumber.mockReset();
        mockVerifyDocumentIntegrity.mockReturnValue({ status: 'VALID' });
    });

    it('adds holderDisplayName (unmasked juristic) while applicantName keeps its old masked value', async () => {
        mockFindByCertificateNumber.mockResolvedValue(rawCert());
        const res = await request(buildApp()).get('/verify/GACP-TH-2569-A3F7B2');

        expect(res.status).toBe(200);
        const c = res.body.data.certificate;
        expect(c.holderDisplayName).toBe('บริษัท สมุนไพรไทย จำกัด');
        // Old contract untouched: still the masked person name.
        expect(c.applicantName).toBe('สมชาย ใ.');
    });

    it('falls back to the masked applicantName for pre-backfill rows', async () => {
        mockFindByCertificateNumber.mockResolvedValue(
            rawCert({ holderDisplayName: null, holderType: null }),
        );
        const res = await request(buildApp()).get('/verify/GACP-TH-2569-A3F7B2');

        const c = res.body.data.certificate;
        expect(c.holderDisplayName).toBe('สมชาย ใ.');
        expect(c.applicantName).toBe('สมชาย ใ.');
    });
});

describe('GET /verify/:certificateNumber/page (HTML) — holder row', () => {
    beforeEach(() => {
        mockFindByCertificateNumber.mockReset();
        mockVerifyDocumentIntegrity.mockReturnValue({ status: 'VALID' });
    });

    it('renders the row as "ผู้ถือใบรับรอง" with the full juristic name, never the person name', async () => {
        mockFindByCertificateNumber.mockResolvedValue(rawCert());
        const res = await request(buildApp()).get('/verify/GACP-TH-2569-A3F7B2/page');

        expect(res.status).toBe(200);
        expect(res.text).toContain('ผู้ถือใบรับรอง');
        expect(res.text).toContain('บริษัท สมุนไพรไทย จำกัด');
        expect(res.text).not.toContain('ผู้ประกอบการ');
        expect(res.text).not.toContain('สมชาย ใจดี');   // raw person name must be absent
    });

    it('still masks a person-shaped holder in the HTML page', async () => {
        mockFindByCertificateNumber.mockResolvedValue(
            rawCert({ holderDisplayName: 'สมชาย ใจดี', holderType: 'LEGACY_PERSON' }),
        );
        const res = await request(buildApp()).get('/verify/GACP-TH-2569-A3F7B2/page');

        expect(res.text).toContain('สมชาย ใ.');
        expect(res.text).not.toContain('สมชาย ใจดี');
    });
});

describe('PDF placeholder map — APPLICANT_NAME carries the holder', () => {
    const PDF_CERT = Object.freeze({
        certificateNumber: 'GACP-TH-2569-A3F7B2',
        applicantName: 'สมชาย ใจดี',
        issuedDate: new Date('2026-05-16T03:00:00Z'),
        expiryDate: new Date('2027-05-16T03:00:00Z'),
    });

    it('prints the holder name when holderDisplayName is set', () => {
        const ctx = buildCertificateContext({
            ...PDF_CERT,
            holderDisplayName: 'บริษัท สมุนไพรไทย จำกัด',
            holderType: 'JURISTIC',
        });
        // The PDF is the legal document — it is never masked.
        expect(ctx.APPLICANT_NAME).toBe('บริษัท สมุนไพรไทย จำกัด');
    });

    it('falls back to applicantName for pre-backfill rows, then to "-"', () => {
        expect(buildCertificateContext({ ...PDF_CERT }).APPLICANT_NAME).toBe('สมชาย ใจดี');
        expect(buildCertificateContext({ ...PDF_CERT, applicantName: null }).APPLICANT_NAME).toBe('-');
    });
});
