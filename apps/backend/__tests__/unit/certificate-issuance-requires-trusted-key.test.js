'use strict';

/**
 * Issuance must apply the SAME trust standard as verification.
 *
 * Found by the G4 real-journey walk (2026-08-25). A certificate was minted through the
 * full pressed journey — audit passed, evidence gate satisfied, signature written — and
 * the product's own verifier then answered:
 *
 *   verifyCertificateSignature(GACP-TH-2569-CAE820)
 *     → { signed: true, valid: false, reason: 'untrusted_pinned_key' }
 *
 * The two ends were asking different questions.
 *
 *   ISSUE  (signCertificateDataOrThrow): "does this signature verify against the key I am
 *          about to pin?" — trivially yes, it is the key that just signed it. Any key
 *          passes, including a throwaway one this process generated seconds earlier
 *          because keys/private.pem could not be decrypted.
 *   VERIFY (verifyCertificateSignature): "is that pinned key one the deployment vouches
 *          for?" — the fingerprint must be in getTrustedPublicKeyFingerprints().
 *
 * So the platform could issue certificates it would itself later call invalid, silently:
 * the row looks perfect (status active, signature present, public key pinned), the only
 * warning goes to a log line, and the failure surfaces at the worst possible moment —
 * when a buyer scans the QR to check the farm is certified.
 *
 * The fix asks the verifier's question at issuance. If the key that would be pinned is
 * not trusted, no certificate is written: the audit-result transaction rolls back and the
 * auditor retries once the real key is mounted — the same fail-closed shape Ruling 2
 * established for a missing signature (certificate-signing-fail-closed.test.js).
 *
 * A certificate that cannot be verified is not a certificate. Better to refuse than to
 * hand a farmer a document that fails the moment someone checks it.
 */

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../services/cache-service', () => ({
    invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/onsite-evidence-gate', () => ({
    assertOnsiteEvidenceSufficient: jest.fn(async () => undefined),
}));

const mockSign = jest.fn();
const mockGetPublicKeyForNamespace = jest.fn();
const mockVerify = jest.fn();
const mockTrusted = jest.fn();
const mockFingerprint = jest.fn();
jest.mock('../../services/crypto/signature-service', () => ({
    getSignatureService: () => ({
        signWithLocalKey: (...a) => mockSign(...a),
        getPublicKeyForNamespace: (...a) => mockGetPublicKeyForNamespace(...a),
        verifyWithLocalKey: (...a) => mockVerify(...a),
        getTrustedPublicKeyFingerprints: (...a) => mockTrusted(...a),
    }),
    fingerprintPublicKey: (...a) => mockFingerprint(...a),
}));

const certificateService = require('../../services/certificate-service');

const PUBLIC_PEM = '-----BEGIN PUBLIC KEY-----\nMOCKPUBLICKEY\n-----END PUBLIC KEY-----\n';
const FINGERPRINT = 'sha256:aaaaaaaaaaaa';

describe('certificate issuance refuses a key the platform does not trust', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSign.mockResolvedValue('SIGNATURE-BASE64');
        mockGetPublicKeyForNamespace.mockResolvedValue(PUBLIC_PEM);
        mockVerify.mockResolvedValue(true); // the signature always matches its own key
        mockFingerprint.mockReturnValue(FINGERPRINT);
    });

    function certData() {
        return { documentHash: 'a'.repeat(64) };
    }

    it('refuses when the key that would be pinned is NOT in the trusted set', async () => {
        mockTrusted.mockResolvedValue(new Set(['sha256:some-other-key']));

        await expect(
            certificateService.signCertificateDataOrThrow(certData(), 'GACP-TH-2569-TEST01'),
        ).rejects.toMatchObject({ code: 'CERT_SIGNING_UNAVAILABLE', statusCode: 503 });
    });

    it('names the untrusted key in the refusal, so the operator knows what to mount', async () => {
        mockTrusted.mockResolvedValue(new Set(['sha256:some-other-key']));

        let thrown;
        try {
            await certificateService.signCertificateDataOrThrow(certData(), 'GACP-TH-2569-TEST01');
        } catch (err) { thrown = err; }

        expect(thrown).toBeDefined();
        expect(String(thrown.message)).toMatch(/GACP-TH-2569-TEST01/);
        expect(String(thrown.message)).toMatch(new RegExp(FINGERPRINT.replace(/[:]/g, '.')));
    });

    it('writes NOTHING onto the row when it refuses', async () => {
        mockTrusted.mockResolvedValue(new Set(['sha256:some-other-key']));
        const data = certData();

        await certificateService.signCertificateDataOrThrow(data, 'GACP-TH-2569-TEST01').catch(() => {});

        expect(data.signature).toBeUndefined();
        expect(data.signaturePublicKey).toBeUndefined();
        expect(data.signatureAlgorithm).toBeUndefined();
    });

    it('signs and pins when the key IS trusted', async () => {
        mockTrusted.mockResolvedValue(new Set([FINGERPRINT]));
        const data = certData();

        await certificateService.signCertificateDataOrThrow(data, 'GACP-TH-2569-TEST01');

        expect(data.signature).toBe('SIGNATURE-BASE64');
        expect(data.signaturePublicKey).toBe(PUBLIC_PEM);
        expect(data.signatureAlgorithm).toBeTruthy();
    });

    it('still refuses a signature that does not verify against its own key (Ruling 2 unchanged)', async () => {
        mockTrusted.mockResolvedValue(new Set([FINGERPRINT]));
        mockVerify.mockResolvedValue(false);

        await expect(
            certificateService.signCertificateDataOrThrow(certData(), 'GACP-TH-2569-TEST01'),
        ).rejects.toMatchObject({ code: 'CERT_SIGNING_UNAVAILABLE' });
    });

    it('asks about the CONSTANT namespace, never a value carried on the row', async () => {
        mockTrusted.mockResolvedValue(new Set([FINGERPRINT]));

        await certificateService.signCertificateDataOrThrow(certData(), 'GACP-TH-2569-TEST01');

        expect(mockTrusted).toHaveBeenCalledWith('rsa:gacp-certificate');
    });
});
