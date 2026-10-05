/**
 * Certificate revision (ฉบับแก้ไขภายใต้เลขเดิม) — the PUBLIC verifier.
 * Spec: design note 2026-08-27-certificate-revision-design
 * ("Public verifier").
 *
 *   GET /verify/:no              gains `data.revision`: null at revision 1,
 *                                else { no, revisedAt, reasonLabel, history }.
 *                                The admin's free text (reasonText) is NEVER
 *                                in the body.
 *   GET /verify/:no/revisions/:n verifies the ARCHIVED revision n from its own
 *                                proof columns (hash recompute + pinned-key
 *                                signature) and answers superseded:true;
 *                                404 REVISION_NOT_FOUND otherwise; the verify
 *                                route's rate limiter applies.
 *
 * The REAL certificate-service runs here (listRevisionSummaries /
 * verifyArchivedRevision are what the route leans on) over a mocked Prisma
 * client. The archived signature is a REAL RSA-SHA256 signature over the
 * archived documentHash so the "signature verifies" verdict is cryptographic:
 * only the signature service's key registry is stubbed, to vouch for the
 * test key.
 */

'use strict';

const crypto = require('crypto');
const request = require('supertest');
const express = require('express');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log), stream: { write: jest.fn() } };
});

// Rate limiter → ONE pass-through middleware instance, exposed so the suite
// can prove the new route sits behind the same limiter as /verify/:no.
jest.mock('../../middleware/rate-limiter', () => {
    const limiter = jest.fn((_req, _res, next) => next());
    return { createRateLimiter: () => limiter, __limiter: limiter };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: { findUnique: jest.fn(), findFirst: jest.fn() },
        certificateRevision: { findMany: jest.fn(), findUnique: jest.fn() },
    },
}));

jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));

// A real RSA key signs the fixtures; the signature service's REGISTRY is the
// only thing stubbed (it vouches for the test key's fingerprint), so
// verifyWithLocalKey runs the genuine RSA-SHA256 check over the pinned PEM.
const { publicKey: TEST_PUBLIC_KEY, privateKey: TEST_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const mockTrustedFingerprints = new Set();
jest.mock('../../services/crypto/signature-service', () => {
    const actual = jest.requireActual('../../services/crypto/signature-service');
    const nodeCrypto = jest.requireActual('crypto');
    return {
        ...actual,
        getSignatureService: () => ({
            getTrustedPublicKeyFingerprints: async () => mockTrustedFingerprints,
            verifyWithLocalKey: async (hash, signature, publicKeyPem) => {
                if (!publicKeyPem) { return false; }
                const verify = nodeCrypto.createVerify('RSA-SHA256');
                verify.update(hash);
                verify.end();
                return verify.verify(publicKeyPem, signature, 'hex');
            },
            getPublicKey: async () => null,
        }),
    };
});

const { prisma } = require('../../services/prisma-database');
const { __limiter } = require('../../middleware/rate-limiter');
const { fingerprintPublicKey } = require('../../services/crypto/signature-service');
const certificateService = require('../../services/certificate-service');
const publicRouter = require('../../routes/api/auth/public');

mockTrustedFingerprints.add(fingerprintPublicKey(TEST_PUBLIC_KEY));

function signHash(documentHash) {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(documentHash);
    signer.end();
    return signer.sign(TEST_PRIVATE_KEY, 'hex');
}

const CERT_NUMBER = 'GACP-TH-2569-A3F7B2';
const CERT_ID = 'cert-rev-1';
// The admin's words on the archived revision. If this string ever reaches a
// public body the spec's "reasonText is never exposed" rule is broken.
const REASON_TEXT_FIXTURE = 'ผู้ดูแลพิมพ์ไว้';
const REASON_LABEL_TH = 'แก้ไขข้อมูลบนใบรับรองให้ตรงกับบันทึกต้นทาง (ความผิดพลาดของระบบ)';

const FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

// The canonical (hashed + signed) content of the certificate as ORIGINALLY
// issued: the province the system got wrong.
const ORIGINAL_CONTENT = Object.freeze({
    certificateNumber: CERT_NUMBER,
    verificationCode: 'A1B2C3D4',
    applicationId: 'app-1',
    userId: 'user-1',
    farmId: 'farm-1',
    farmName: 'ฟาร์มสมุนไพรสมชาย',
    applicantName: 'สมชาย ใจดี',
    cropType: 'กัญชา',
    farmSize: 5.5,
    province: 'เชียงใหม่',
    district: 'เมือง',
    subDistrict: 'ศรีภูมิ',
    standardName: 'GACP Thailand',
    standardId: 'GACP-TH',
    validityYears: 3,
    issuedDate: new Date('2026-05-16T03:00:00Z'),
    expiryDate: FUTURE,
    issuedBy: 'provider-1',
});

// What the live row was re-signed with after the correction.
const CORRECTED_CONTENT = Object.freeze({
    ...ORIGINAL_CONTENT,
    province: 'เชียงราย',
    district: 'เมืองเชียงราย',
    subDistrict: 'รอบเวียง',
});

function signedProof(content) {
    const documentHash = certificateService.buildCertificateDocumentHash(content);
    return {
        documentHash,
        signature: signHash(documentHash),
        signatureAlgorithm: 'RSA-SHA256',
        signatureKeyId: 'rsa:gacp-certificate',
        signaturePublicKey: TEST_PUBLIC_KEY,
    };
}

/** The live certificate row (prisma.certificate.findUnique shape). */
function liveCert(overrides = {}) {
    return {
        id: CERT_ID,
        organizationId: 'org-1',
        status: 'active',
        isDeleted: false,
        address: '99/9 หมู่ 1',
        revisionNo: 1,
        revisedAt: null,
        revisedBy: null,
        revisionReason: null,
        ...ORIGINAL_CONTENT,
        ...signedProof(ORIGINAL_CONTENT),
        ...overrides,
    };
}

/** The live row at revision 2 (corrected + re-signed) as Task 3 leaves it. */
function revisedLiveCert(overrides = {}) {
    return liveCert({
        ...CORRECTED_CONTENT,
        ...signedProof(CORRECTED_CONTENT),
        revisionNo: 2,
        revisedAt: new Date('2026-08-27T04:00:00Z'),
        revisedBy: 'admin-1',
        revisionReason: 'SYSTEM_DATA_CORRECTION',
        signedAt: new Date('2026-08-27T04:00:00Z'),
        signedBy: 'admin-1',
        ...overrides,
    });
}

/** The archived revision 1 row (prisma.certificateRevision shape). */
function archivedRevision1(overrides = {}) {
    const snapshot = {
        ...JSON.parse(JSON.stringify(ORIGINAL_CONTENT)),
        address: '99/9 หมู่ 1',
    };
    return {
        id: 'rev-1',
        certificateId: CERT_ID,
        revisionNo: 1,
        snapshot,
        ...signedProof(ORIGINAL_CONTENT),
        signedBy: 'provider-1',
        signedAt: new Date('2026-05-16T03:00:00Z'),
        supersededAt: new Date('2026-08-27T04:00:00Z'),
        supersededBy: 'admin-1',
        reasonCode: 'SYSTEM_DATA_CORRECTION',
        reasonText: REASON_TEXT_FIXTURE,
        correctedFields: ['province', 'district', 'subDistrict'],
        organizationId: 'org-1',
        ...overrides,
    };
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/', publicRouter);
    return app;
}

beforeEach(() => {
    jest.clearAllMocks();
    prisma.certificate.findUnique.mockResolvedValue(null);
    prisma.certificateRevision.findMany.mockResolvedValue([]);
    prisma.certificateRevision.findUnique.mockResolvedValue(null);
});

describe('GET /verify/:no — data.revision', () => {
    it('(a) is null for a certificate at revision 1 and asks for no history', async () => {
        prisma.certificate.findUnique.mockResolvedValue(liveCert({ revisionNo: 1 }));
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.data).toHaveProperty('revision');
        expect(res.body.data.revision).toBeNull();
        expect(prisma.certificateRevision.findMany).not.toHaveBeenCalled();
    });

    it('(a2) a row issued before the expand migration (revisionNo absent) reads as revision 1', async () => {
        const row = liveCert();
        delete row.revisionNo;
        prisma.certificate.findUnique.mockResolvedValue(row);
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.data.revision).toBeNull();
    });

    it('(b) at revision 2 carries no/revisedAt/reasonLabel/history and never the reasonText', async () => {
        prisma.certificate.findUnique.mockResolvedValue(revisedLiveCert());
        prisma.certificateRevision.findMany.mockResolvedValue([
            {
                revisionNo: 1,
                signedAt: new Date('2026-05-16T03:00:00Z'),
                supersededAt: new Date('2026-08-27T04:00:00Z'),
                reasonText: REASON_TEXT_FIXTURE,
            },
        ]);
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(true);
        // The corrected row still verifies as a whole document.
        expect(res.body.data.integrity).toBe('VALID');
        expect(res.body.data.signatureValid).toBe(true);
        expect(res.body.data.certificate.province).toBe('เชียงราย');

        expect(res.body.data.revision).toEqual({
            no: 2,
            revisedAt: '2026-08-27T04:00:00.000Z',
            reasonLabel: REASON_LABEL_TH,
            history: [
                { no: 1, signedAt: '2026-05-16T03:00:00.000Z', supersededAt: '2026-08-27T04:00:00.000Z' },
            ],
        });
        expect(res.body.data.revision.reasonLabel).not.toMatch(/—/);

        // The history is asked for in ascending order, by this certificate's id.
        const call = prisma.certificateRevision.findMany.mock.calls[0][0];
        expect(call.where).toEqual({ certificateId: CERT_ID });
        expect(call.orderBy).toEqual({ revisionNo: 'asc' });

        // reasonText is the admin's private note: it must not be in the body.
        expect(res.text).not.toContain(REASON_TEXT_FIXTURE);
    });

    it('(b4) a cropType-only revision (F-G4-58) is published under a label that states no farm-location correction', async () => {
        // The c04 walk case (E5960D, 4C3761): the location already agreed with
        // the farm row; only the retired literal cropType 'Herb' was corrected
        // from the plant master. The live row carries ORIGINAL_CONTENT's
        // location unchanged and the master's plant name.
        prisma.certificate.findUnique.mockResolvedValue(liveCert({
            revisionNo: 2,
            revisedAt: new Date('2026-08-27T04:00:00Z'),
            revisedBy: 'admin-1',
            revisionReason: 'SYSTEM_DATA_CORRECTION',
            signedAt: new Date('2026-08-27T04:00:00Z'),
            signedBy: 'admin-1',
        }));
        prisma.certificateRevision.findMany.mockResolvedValue([
            { revisionNo: 1, signedAt: new Date('2026-05-16T03:00:00Z'), supersededAt: new Date('2026-08-27T04:00:00Z'), correctedFields: ['cropType'] },
        ]);
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(true);
        expect(res.body.data.certificate.province).toBe('เชียงใหม่');
        expect(res.body.data.revision.no).toBe(2);
        expect(res.body.data.revision.reasonLabel).toBe(REASON_LABEL_TH);
        // No farm-location correction happened, so the register may not say one did.
        expect(res.body.data.revision.reasonLabel).not.toMatch(/ที่ตั้งฟาร์ม/);
        expect(res.text).not.toContain(REASON_TEXT_FIXTURE);
    });

    it('(b2) history keeps ascending order across several revisions', async () => {
        prisma.certificate.findUnique.mockResolvedValue(revisedLiveCert({ revisionNo: 3 }));
        prisma.certificateRevision.findMany.mockResolvedValue([
            { revisionNo: 1, signedAt: new Date('2026-05-16T03:00:00Z'), supersededAt: new Date('2026-06-01T00:00:00Z') },
            { revisionNo: 2, signedAt: new Date('2026-06-01T00:00:00Z'), supersededAt: new Date('2026-08-27T04:00:00Z') },
        ]);
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.data.revision.no).toBe(3);
        expect(res.body.data.revision.history.map((h) => h.no)).toEqual([1, 2]);
    });

    it('(b3) a revised certificate that later expired still reports its revision', async () => {
        prisma.certificate.findUnique.mockResolvedValue(revisedLiveCert({ expiryDate: PAST }));
        prisma.certificateRevision.findMany.mockResolvedValue([
            { revisionNo: 1, signedAt: new Date('2026-05-16T03:00:00Z'), supersededAt: new Date('2026-08-27T04:00:00Z') },
        ]);
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}`);

        expect(res.status).toBe(200);
        expect(res.body.valid).toBe(false);
        expect(res.body.data.status).toBe('expired');
        expect(res.body.data.certificate).toBeNull();
        expect(res.body.data.revision).toMatchObject({ no: 2, reasonLabel: REASON_LABEL_TH });
        expect(res.body.data.revision.history).toHaveLength(1);
    });
});

describe('GET /verify/:no/revisions/:n — the archived revision', () => {
    it('(c) an intact archived revision reads superseded:true, integrity VALID, signatureValid true', async () => {
        prisma.certificate.findUnique.mockResolvedValue(revisedLiveCert());
        prisma.certificateRevision.findUnique.mockResolvedValue(archivedRevision1());
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}/revisions/1`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({
            certificateNumber: CERT_NUMBER,
            revisionNo: 1,
            superseded: true,
            supersededAt: '2026-08-27T04:00:00.000Z',
            certificateStatus: 'active',
            integrity: 'VALID',
            signatureValid: true,
            snapshot: {
                province: 'เชียงใหม่',
                district: 'เมือง',
                subDistrict: 'ศรีภูมิ',
                farmName: 'ฟาร์มสมุนไพรสมชาย',
            },
        });
        // Looked up by the (certificateId, revisionNo) unique key of the live row.
        expect(prisma.certificateRevision.findUnique).toHaveBeenCalledWith({
            where: { certificateId_revisionNo: { certificateId: CERT_ID, revisionNo: 1 } },
        });
        expect(res.text).not.toContain(REASON_TEXT_FIXTURE);
        // The archived snapshot's own address line is not part of the public shape.
        expect(res.text).not.toContain('99/9');
    });

    it('(c2) an archived snapshot edited after archival reads TAMPERED', async () => {
        prisma.certificate.findUnique.mockResolvedValue(revisedLiveCert());
        const row = archivedRevision1();
        row.snapshot = { ...row.snapshot, province: 'กรุงเทพมหานคร' };
        prisma.certificateRevision.findUnique.mockResolvedValue(row);
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}/revisions/1`);

        expect(res.status).toBe(200);
        expect(res.body.data.integrity).toBe('TAMPERED');
        expect(res.body.data.superseded).toBe(true);
    });

    it('(c3) an archived signature that does not verify against the pinned key reads signatureValid false', async () => {
        prisma.certificate.findUnique.mockResolvedValue(revisedLiveCert());
        const row = archivedRevision1();
        row.signature = signHash('a different document');
        prisma.certificateRevision.findUnique.mockResolvedValue(row);
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}/revisions/1`);

        expect(res.status).toBe(200);
        expect(res.body.data.integrity).toBe('VALID');
        expect(res.body.data.signatureValid).toBe(false);
    });

    // The LIVE certificate's public state gates the archived facts. The main
    // door (/verify/:no) answers certificate:null for a revoked, suspended or
    // date-expired certificate; the archived-revision door is never the wider
    // one, and a revoked number never carries a green verdict. The four facts
    // of the archived snapshot are the strings that must be absent.
    const ARCHIVED_FACTS = ['ฟาร์มสมุนไพรสมชาย', 'เชียงใหม่', 'เมือง', 'ศรีภูมิ'];

    it.each([
        ['revoked', { status: 'revoked', revokedAt: new Date('2026-08-28T01:00:00Z'), revokedBy: 'admin-2' }, 'revoked', 'REVOKED'],
        ['suspended', { status: 'suspended' }, 'suspended', 'VALID'],
        ['date-expired', { expiryDate: PAST }, 'expired', 'VALID'],
    ])('(f) live row %s: no archived facts, certificateStatus carried, main door withholds the same', async (_label, overrides, expectedStatus, expectedIntegrity) => {
        prisma.certificate.findUnique.mockResolvedValue(revisedLiveCert(overrides));
        prisma.certificateRevision.findUnique.mockResolvedValue(archivedRevision1());
        const app = buildApp();
        const res = await request(app).get(`/verify/${CERT_NUMBER}/revisions/1`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.superseded).toBe(true);
        expect(res.body.data.certificateStatus).toBe(expectedStatus);
        expect(res.body.data.snapshot).toBeNull();
        expect(res.body.data.integrity).toBe(expectedIntegrity);
        for (const fact of ARCHIVED_FACTS) {
            expect(res.text).not.toContain(fact);
        }
        expect(res.text).not.toContain(REASON_TEXT_FIXTURE);

        // Parity: the main door withholds the live facts for this same row.
        const main = await request(app).get(`/verify/${CERT_NUMBER}`);
        expect(main.status).toBe(200);
        expect(main.body.valid).toBe(false);
        expect(main.body.data.status).toBe(expectedStatus);
        expect(main.body.data.certificate).toBeNull();
    });

    it('(f2) a revocation MARKER left on an otherwise active row (isDeleted) reads REVOKED with no archived facts', async () => {
        prisma.certificate.findUnique.mockResolvedValue(revisedLiveCert({ status: 'active', isDeleted: true }));
        prisma.certificateRevision.findUnique.mockResolvedValue(archivedRevision1());
        const app = buildApp();
        const res = await request(app).get(`/verify/${CERT_NUMBER}/revisions/1`);

        expect(res.status).toBe(200);
        expect(res.body.data.certificateStatus).toBe('revoked');
        expect(res.body.data.integrity).toBe('REVOKED');
        expect(res.body.data.snapshot).toBeNull();
        for (const fact of ARCHIVED_FACTS) {
            expect(res.text).not.toContain(fact);
        }

        // Same verdict the main door's integrity check reaches for this row.
        const main = await request(app).get(`/verify/${CERT_NUMBER}`);
        expect(main.body.data.integrity).toBe('REVOKED');
    });

    it('(f3) an active live row still answers the archived facts, with certificateStatus active', async () => {
        prisma.certificate.findUnique.mockResolvedValue(revisedLiveCert());
        prisma.certificateRevision.findUnique.mockResolvedValue(archivedRevision1());
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}/revisions/1`);

        expect(res.status).toBe(200);
        expect(res.body.data.certificateStatus).toBe('active');
        expect(res.body.data.snapshot).toEqual({
            province: 'เชียงใหม่',
            district: 'เมือง',
            subDistrict: 'ศรีภูมิ',
            farmName: 'ฟาร์มสมุนไพรสมชาย',
        });
    });

    it('(d) answers 404 REVISION_NOT_FOUND when no such revision is archived', async () => {
        prisma.certificate.findUnique.mockResolvedValue(revisedLiveCert());
        prisma.certificateRevision.findUnique.mockResolvedValue(null);
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}/revisions/9`);

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false, error: 'REVISION_NOT_FOUND' });
        expect(prisma.certificateRevision.findUnique).toHaveBeenCalledWith({
            where: { certificateId_revisionNo: { certificateId: CERT_ID, revisionNo: 9 } },
        });
    });

    it.each([['0'], ['-1'], ['abc'], ['1.5']])('(d2) revision "%s" is not a revision number: 404 without a lookup', async (n) => {
        prisma.certificate.findUnique.mockResolvedValue(revisedLiveCert());
        const res = await request(buildApp()).get(`/verify/${CERT_NUMBER}/revisions/${n}`);

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false, error: 'REVISION_NOT_FOUND' });
        expect(prisma.certificateRevision.findUnique).not.toHaveBeenCalled();
    });

    it('(d3) an unknown certificate number is 404 without a revision lookup', async () => {
        prisma.certificate.findUnique.mockResolvedValue(null);
        const res = await request(buildApp()).get('/verify/GACP-TH-2569-000000/revisions/1');

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false, error: 'REVISION_NOT_FOUND' });
        expect(prisma.certificateRevision.findUnique).not.toHaveBeenCalled();
    });

    it('(d4) REVISION_NOT_FOUND is a catalogued 404', () => {
        const { lookup } = require('../../shared/error-codes');
        const entry = lookup('REVISION_NOT_FOUND');
        expect(entry).toBeTruthy();
        expect(entry.httpStatus).toBe(404);
        expect(entry.source).toMatch(/^routes\/api\/auth\/public\.js:\d+$/);
        expect(entry.messageTh).toMatch(/กรุณา|คุณ/);
        expect(entry.messageTh).not.toMatch(/—/);
    });

    it('(e) sits behind the same rate limiter as /verify/:no', async () => {
        const routeLayer = publicRouter.stack.find(
            (layer) => layer.route && layer.route.path === '/verify/:certificateNumber/revisions/:n',
        );
        expect(routeLayer).toBeDefined();
        expect(routeLayer.route.methods.get).toBe(true);
        expect(routeLayer.route.stack.some((l) => l.handle === __limiter)).toBe(true);

        prisma.certificate.findUnique.mockResolvedValue(revisedLiveCert());
        prisma.certificateRevision.findUnique.mockResolvedValue(archivedRevision1());
        await request(buildApp()).get(`/verify/${CERT_NUMBER}/revisions/1`);
        expect(__limiter).toHaveBeenCalledTimes(1);
    });
});

describe('certificateService — the two readers the verifier leans on', () => {
    it('listRevisionSummaries maps rows to { no, signedAt, supersededAt } ISO strings and nothing else', async () => {
        prisma.certificateRevision.findMany.mockResolvedValue([
            { revisionNo: 1, signedAt: null, supersededAt: new Date('2026-08-27T04:00:00Z'), reasonText: REASON_TEXT_FIXTURE },
        ]);
        const out = await certificateService.listRevisionSummaries(CERT_ID);
        expect(out).toEqual([{ no: 1, signedAt: null, supersededAt: '2026-08-27T04:00:00.000Z' }]);
        const call = prisma.certificateRevision.findMany.mock.calls[0][0];
        expect(call.select).toEqual({ revisionNo: true, signedAt: true, supersededAt: true });
    });

    it('verifyArchivedRevision answers { found:false } for a missing row and the full verdict for an archived one', async () => {
        prisma.certificateRevision.findUnique.mockResolvedValueOnce(null);
        await expect(certificateService.verifyArchivedRevision(CERT_ID, 4)).resolves.toEqual({ found: false });

        prisma.certificateRevision.findUnique.mockResolvedValueOnce(archivedRevision1());
        const out = await certificateService.verifyArchivedRevision(CERT_ID, 1);
        expect(out.found).toBe(true);
        expect(out.revision.revisionNo).toBe(1);
        expect(out.integrity.status).toBe('VALID');
        expect(out.signature).toMatchObject({ signed: true, valid: true });
    });
});
