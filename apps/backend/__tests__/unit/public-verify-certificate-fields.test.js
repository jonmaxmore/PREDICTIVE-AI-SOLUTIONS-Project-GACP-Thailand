/**
 * Public certificate verification — response field mapping.
 *
 * GET /verify/:certificateNumber returns a JSON payload that a public QR
 * scanner renders. findByCertificateNumber returns the RAW Certificate row,
 * whose schema is flat: `province`, `cropType` (singular), `issuedDate`,
 * `standardName`. The route previously read `location.province`, `cropTypes`/
 * `plantType`, `issueDate`, and `certificationStandards` — none of which exist
 * on the model — so a valid cert verified with a blank province, empty crop,
 * and null issue date. These tests lock the correct mapping.
 */

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
// H1: public.js now also calls verifyCertificateSignature. Default to an
// unsigned verdict so these field-mapping tests are unaffected (signatureValid
// → null, sealed → false); individual tests can override if needed.
const mockVerifyCertificateSignature = jest.fn(async () => ({ signed: false }));
jest.mock('../../services/certificate-service', () => ({
    findByCertificateNumber: (...args) => mockFindByCertificateNumber(...args),
    verifyDocumentIntegrity: (...args) => mockVerifyDocumentIntegrity(...args),
    verifyCertificateSignature: (...args) => mockVerifyCertificateSignature(...args),
}));

const publicRouter = require('../../routes/api/auth/public');

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
        province: 'เชียงราย',
        cropType: 'กัญชา / Cannabis sativa L.',
        standardName: 'GACP Thailand',
        documentHash: 'abc',
        ...overrides,
    };
}

describe('GET /verify/:certificateNumber — field mapping', () => {
    beforeEach(() => {
        mockFindByCertificateNumber.mockReset();
        mockVerifyDocumentIntegrity.mockReturnValue({ status: 'VALID' });
    });

    it('maps province / cropType / issuedDate / standardName from the raw model', async () => {
        mockFindByCertificateNumber.mockResolvedValue(rawCert());
        const res = await request(buildApp()).get('/verify/GACP-TH-2569-A3F7B2');

        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(true);
        const c = res.body.data.certificate;
        expect(c).not.toBeNull();
        // The bug produced province:undefined, cropTypes:[null], issueDate:undefined.
        expect(c.province).toBe('เชียงราย');
        expect(c.cropTypes).toEqual(['กัญชา / Cannabis sativa L.']);
        expect(c.issueDate).toBe(new Date('2026-05-16T03:00:00Z').toISOString());
        expect(c.standards).toEqual(['GACP Thailand']);
        // cropTypes must never be the old [null]/[undefined] shape.
        expect(c.cropTypes).not.toContain(null);
        expect(c.cropTypes).not.toContain(undefined);
    });

    it('surfaces the BE-#4 integrity status', async () => {
        mockFindByCertificateNumber.mockResolvedValue(rawCert());
        mockVerifyDocumentIntegrity.mockReturnValue({ status: 'TAMPERED', expected: 'x', actual: 'y' });
        const res = await request(buildApp()).get('/verify/GACP-TH-2569-A3F7B2');
        expect(res.body.data.integrity).toBe('TAMPERED');
    });

    it('returns verified:false for an expired cert (no certificate block)', async () => {
        mockFindByCertificateNumber.mockResolvedValue(
            rawCert({ expiryDate: new Date('2000-01-01T00:00:00Z') }),
        );
        const res = await request(buildApp()).get('/verify/GACP-TH-2569-A3F7B2');
        expect(res.body.valid).toBe(false);
        expect(res.body.data.status).toBe('expired');
        expect(res.body.data.certificate).toBeNull();
    });

    it('returns valid:false when the cert is not found', async () => {
        mockFindByCertificateNumber.mockResolvedValue(null);
        const res = await request(buildApp()).get('/verify/UNKNOWN');
        expect(res.body.valid).toBe(false);
        expect(res.body.data.status).toBe('invalid');
    });
});

// BE-CERT-02 — the public HTML /page variant must mask the applicant name just
// like the JSON endpoint (last name → initial). Pre-fix the /page renderer
// echoed the raw full name, defeating the anti-scraping control. Regression
// guard so a future refactor of generateVerificationHTML can't re-leak it.
describe('GET /verify/:certificateNumber/page (HTML) — BE-CERT-02 applicant-name mask', () => {
    beforeEach(() => {
        mockFindByCertificateNumber.mockReset();
        mockVerifyDocumentIntegrity.mockReturnValue({ status: 'VALID' });
    });

    it('renders HTML with the MASKED name (สมชาย ใ.) — never the raw full name', async () => {
        mockFindByCertificateNumber.mockResolvedValue(rawCert()); // applicantName: 'สมชาย ใจดี'
        const res = await request(buildApp()).get('/verify/GACP-TH-2569-A3F7B2/page');

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.text).toContain('สมชาย ใ.');      // masked (last name → initial)
        expect(res.text).not.toContain('สมชาย ใจดี'); // raw full name must be absent
    });

    it('still returns HTML 200 for an unknown cert without leaking a name', async () => {
        mockFindByCertificateNumber.mockResolvedValue(null);
        const res = await request(buildApp()).get('/verify/NOPE/page');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.text).not.toContain('สมชาย ใจดี');
    });
});

// C5-02 (audit 2026-06-10) — generateVerificationHTML interpolated certificateNumber
// (from req.params) and applicant-controlled cert.* fields into an unauthenticated
// text/html response WITHOUT escaping → reflected/stored XSS. Lock the escaping so a
// future refactor can't reintroduce it.
describe('GET /verify/:certificateNumber/page (HTML) — C5-02 XSS escaping', () => {
    beforeEach(() => {
        mockFindByCertificateNumber.mockReset();
        mockVerifyDocumentIntegrity.mockReturnValue({ status: 'VALID' });
    });

    it('escapes an HTML payload reflected from the certificateNumber URL segment', async () => {
        mockFindByCertificateNumber.mockResolvedValue(null); // payload still reflected in <title> + .cert-number
        // slash-free payload so the Express path param decodes cleanly
        const payload = '<img src=x onerror=alert(1)>';
        const res = await request(buildApp()).get(`/verify/${encodeURIComponent(payload)}/page`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.text).not.toContain('<img src=x onerror=alert(1)>'); // raw payload must NOT appear
        expect(res.text).toContain('&lt;img src=x onerror=alert(1)&gt;'); // escaped form present
    });

    it('escapes HTML in applicant-controlled cert fields (farmName) — stored XSS', async () => {
        mockFindByCertificateNumber.mockResolvedValue(
            rawCert({ farmName: '<script>alert(document.cookie)</script>' }),
        );
        const res = await request(buildApp()).get('/verify/GACP-TH-2569-A3F7B2/page');

        expect(res.status).toBe(200);
        expect(res.text).not.toContain('<script>alert(document.cookie)</script>');
        expect(res.text).toContain('&lt;script&gt;alert(document.cookie)&lt;/script&gt;');
    });
});
