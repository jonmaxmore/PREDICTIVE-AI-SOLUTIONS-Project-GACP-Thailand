'use strict';

/**
 * Ruling 2 / defect 2 — HASH-ONLY FALLBACK.
 *
 * Pre-fix certificate-service.js:438-452 wrapped the PKI signing call in a
 * try/catch that logged "issuing with hash-only integrity" and carried on, so a
 * signing outage still minted a certificate with `signature = null`. A
 * government e-certificate whose signature is absent cannot be verified by a
 * third party at all — the row's SHA-256 hash only proves the row agrees with
 * itself, and anyone who can write the row can rewrite the hash.
 *
 * This is not hypothetical. A read-only query of the demo database on
 * 2026-08-22 found 3 certificates, all created AFTER CERT-01 shipped
 * (2026-06-07), and `signature IS NULL` on every one of them.
 *
 * Post-fix contract: no signature → no certificate. generateCertificate throws
 * CERT_SIGNING_UNAVAILABLE (503) BEFORE `certificate.create`, so the caller's
 * transaction rolls the AUDIT_PASSED status flip back with it and the auditor
 * can simply retry once the key is mounted.
 */

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));
// The evidence gate is proven separately (certificate-service-evidence-gate.test.js);
// here it must pass so the signing branch is what the assertions observe.
jest.mock('../../services/onsite-evidence-gate', () => ({
    assertOnsiteEvidenceSufficient: jest.fn(async () => undefined),
}));

const mockSign = jest.fn();
const mockGetPublicKeyForNamespace = jest.fn();
const mockVerify = jest.fn();
// Issuance now also asks the verifier's question — is the key we are about to pin one
// this deployment trusts? That branch is proven in
// certificate-issuance-requires-trusted-key.test.js; here the key is trusted, so the
// assertions below observe the signing branch — the same reason the evidence gate above
// is stubbed to pass.
const TRUSTED_FINGERPRINT = 'sha256:trusted-in-this-test';
jest.mock('../../services/crypto/signature-service', () => ({
    getSignatureService: () => ({
        signWithLocalKey: (...a) => mockSign(...a),
        getPublicKeyForNamespace: (...a) => mockGetPublicKeyForNamespace(...a),
        verifyWithLocalKey: (...a) => mockVerify(...a),
        getTrustedPublicKeyFingerprints: async () => new Set([TRUSTED_FINGERPRINT]),
    }),
    fingerprintPublicKey: () => TRUSTED_FINGERPRINT,
}));

const certificateService = require('../../services/certificate-service');
const { farmAuditPhotoStub } = require('../../test-support/farm-audit-photo-stub');
const { ERROR_CODES } = require('../../shared/error-codes');

const PUBLIC_PEM = '-----BEGIN PUBLIC KEY-----\nMOCKPUBLICKEY\n-----END PUBLIC KEY-----\n';

function makeApp() {
    return {
        id: 'app-1',
        organizationId: 'org-1',
        entityId: null,
        applicationNumber: 'GACP-2026-001',
        status: 'AUDIT_PASSED',
        auditResult: 'PASS',
        formData: {
            auditResult: 'PASS',
            auditedAt: new Date().toISOString(),
            // F-G4-58: the plant is resolved from the master BEFORE the farm resolver
            // and the signing branch; an application that states none is refused as
            // CERTIFICATE_PLANT_UNKNOWN (422), so the wizard's answer is stated here.
            plantId: 'cannabis',
            // F-G4-52: a farm cannot be created without its location. The farm
            // resolver runs BEFORE signing, so a blank here would be refused as
            // CERTIFICATE_FARM_LOCATION_MISSING and the signing branch below
            // would never be what the assertions observe.
            farmData: { farmName: 'ฟาร์มของผู้ยื่น', address: '1 หมู่ 1', province: 'เชียงใหม่', district: 'สันทราย', subdistrict: 'แม่แฝก', postalCode: '50210' },
        },
        applicant: { id: 'user-1', firstName: 'สมชาย', lastName: 'ใจดี' },
        entity: null,
    };
}

function makePrisma() {
    return {
        // certificate number draws its running number from the ReceiptSequence series
        receiptSequence: { upsert: jest.fn(async () => ({ counter: 1 })) },
        certificate: {
            findFirst: jest.fn(async () => null),
            findUnique: jest.fn(async () => null),
            create: jest.fn(async ({ data }) => ({ id: 'cert-new', ...data })),
        },
        application: { findUnique: jest.fn(async () => makeApp()) },
        farm: {
            findFirst: jest.fn(async () => null), // no farm at that address — resolver creates one
            create: jest.fn(async ({ data }) => ({ id: 'farm-1', ...data })),
        },
        plot: { count: jest.fn(async () => 1) },
        auditChecklist: { findFirst: jest.fn(async () => ({ id: 'audit-1' })) },
        farmAuditPhoto: farmAuditPhotoStub(99),
        farmAuditChecklistItem: { count: jest.fn(async () => 99) },
        // F-G4-58: issuance names the plant from the master (plant-species-service),
        // read through this client, and refuses before any write when it is unknown.
        plantSpecies: {
            findUnique: jest.fn(async ({ where }) => (where.code === 'CAN'
                ? { id: 'ps-can', code: 'CAN', nameTH: 'กัญชา', nameEN: 'Cannabis' }
                : null)),
        },
    };
}

const issue = (prisma) => certificateService.generateCertificate(
    'app-1', 'auditor-1', { prisma, skipInitialAssets: true },
);

describe('Ruling 2 — certificate issuance fails CLOSED when it cannot sign', () => {
    beforeEach(() => {
        mockSign.mockReset();
        mockGetPublicKeyForNamespace.mockReset();
        mockVerify.mockReset();
        mockGetPublicKeyForNamespace.mockResolvedValue(PUBLIC_PEM);
        mockVerify.mockResolvedValue(true);
    });

    test('signer throws → no Certificate row is created and CERT_SIGNING_UNAVAILABLE is raised', async () => {
        mockSign.mockRejectedValue(new Error('error:1C800064:Provider routines::bad decrypt'));
        const prisma = makePrisma();

        await expect(issue(prisma)).rejects.toMatchObject({ code: 'CERT_SIGNING_UNAVAILABLE' });
        expect(prisma.certificate.create).not.toHaveBeenCalled();
    });

    test('signer returns an empty signature → still fails closed, no row', async () => {
        mockSign.mockResolvedValue(null);
        const prisma = makePrisma();

        await expect(issue(prisma)).rejects.toMatchObject({ code: 'CERT_SIGNING_UNAVAILABLE' });
        expect(prisma.certificate.create).not.toHaveBeenCalled();
    });

    test('signature does not verify against the key about to be pinned → fails closed', async () => {
        mockSign.mockResolvedValue('deadbeef');
        mockVerify.mockResolvedValue(false);
        const prisma = makePrisma();

        await expect(issue(prisma)).rejects.toMatchObject({ code: 'CERT_SIGNING_UNAVAILABLE' });
        expect(prisma.certificate.create).not.toHaveBeenCalled();
    });

    test('the raised error carries the operator-facing HTTP intent (503) so the UI can explain the outage', async () => {
        mockSign.mockRejectedValue(new Error('no key'));
        await expect(issue(makePrisma())).rejects.toMatchObject({ statusCode: 503 });
    });

    test('CERT_SIGNING_UNAVAILABLE is catalogued (Thai + English) so the UI never shows a bare code', () => {
        const entry = ERROR_CODES.CERT_SIGNING_UNAVAILABLE;
        expect(entry).toBeDefined();
        expect(entry.httpStatus).toBe(503);
        expect(entry.messageTh.length).toBeGreaterThan(0);
        // thai-ui-copy: no em dash in Thai copy.
        expect(entry.messageTh).not.toMatch(/—/);
    });

    test('happy path still mints, and pins the verifying public key on the row', async () => {
        mockSign.mockResolvedValue('a-real-signature-hex');
        const prisma = makePrisma();

        await issue(prisma);

        expect(prisma.certificate.create).toHaveBeenCalledTimes(1);
        const { data } = prisma.certificate.create.mock.calls[0][0];
        expect(data.signature).toBe('a-real-signature-hex');
        expect(data.signatureAlgorithm).toBe('RSA-SHA256');
        expect(data.signatureKeyId).toBe('rsa:gacp-certificate');
        // Ruling 2 / defect 3: the row carries the key that verifies it.
        expect(data.signaturePublicKey).toBe(PUBLIC_PEM);
        // The public key asked for must be the one matching the signing namespace,
        // not "whatever key happens to be loaded".
        expect(mockGetPublicKeyForNamespace).toHaveBeenCalledWith('rsa:gacp-certificate');
    });
});
