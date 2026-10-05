'use strict';

/**
 * CERT-01 — the issued certificate carries a verifiable PKI signature over its
 * documentHash (non-repudiation for a government e-certificate), in addition to
 * the SHA-256 content hash. This pins verifyCertificateSignature()'s contract.
 * The real RSA sign↔verify round-trip is proven separately in
 * signature-service-namespace.test.js (INT-11); here the signer is mocked so
 * the verify-method branches are deterministic.
 */

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../shared/logger', () => {
  const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { ...l, createLogger: () => l };
});

const mockVerify = jest.fn();
const mockGetPublicKey = jest.fn();
const mockTrustedFingerprints = jest.fn();
jest.mock('../../services/crypto/signature-service', () => ({
  getSignatureService: () => ({
    verifyWithLocalKey: (...a) => mockVerify(...a),
    getPublicKey: (...a) => mockGetPublicKey(...a),
    // Fix round: a pinned row key is honoured only when its fingerprint is in
    // the trusted set. Wiring scope here — the anchor's own behaviour is pinned
    // against real keys in certificate-pinned-key-trust-anchor.test.js.
    getTrustedPublicKeyFingerprints: (...a) => mockTrustedFingerprints(...a),
  }),
  // Ruling 2 moved the fingerprint derivation into the signature service so the
  // boot-time key pin and the verify response share ONE definition. Use the
  // real implementation here — mocking a hash would test nothing.
  fingerprintPublicKey: jest.requireActual('../../services/crypto/signature-service').fingerprintPublicKey,
}));

const certService = require('../../services/certificate-service');

const signedCert = () => ({
  documentHash: 'deadbeef'.repeat(8),
  signature: 'abc123signaturehex',
  signatureAlgorithm: 'RSA-SHA256',
  signatureKeyId: 'rsa:gacp-certificate',
});

describe('CERT-01 — verifyCertificateSignature', () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockGetPublicKey.mockReset();
    mockTrustedFingerprints.mockReset();
    // Default: nothing is trusted, so any test that pins a key must say so.
    mockTrustedFingerprints.mockResolvedValue(new Set());
    // H1: a verifying public key → fingerprint (sha256 hex) on the result.
    mockGetPublicKey.mockResolvedValue('-----BEGIN PUBLIC KEY-----\nPK\n-----END PUBLIC KEY-----');
  });

  it('signed cert whose signature verifies → { signed:true, valid:true } (+ H1 publicKeyFingerprint)', async () => {
    mockVerify.mockResolvedValue(true);
    const res = await certService.verifyCertificateSignature(signedCert());
    // additive: original keys preserved, plus the new fingerprint.
    expect(res).toMatchObject({ signed: true, valid: true, algorithm: 'RSA-SHA256' });
    expect(res.publicKeyFingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Ruling 2: the row's pinned key is now the third argument. A legacy row has
    // none, so `null` is passed and the verifier falls back to the loaded key —
    // exactly the pre-Ruling-2 behaviour for exactly the pre-Ruling-2 rows.
    expect(mockVerify).toHaveBeenCalledWith('deadbeef'.repeat(8), 'abc123signaturehex', null);
  });

  it('Ruling 2 — a TRUSTED row key verifies with THAT key, and the box key is never read', async () => {
    const rowKey = '-----BEGIN PUBLIC KEY-----\nROWPINNEDKEY\n-----END PUBLIC KEY-----\n';
    mockVerify.mockResolvedValue(true);
    const { fingerprintPublicKey: realFp } = jest.requireActual('../../services/crypto/signature-service');
    mockTrustedFingerprints.mockResolvedValue(new Set([realFp(rowKey)]));

    const res = await certService.verifyCertificateSignature({ ...signedCert(), signaturePublicKey: rowKey });

    expect(mockVerify).toHaveBeenCalledWith('deadbeef'.repeat(8), 'abc123signaturehex', rowKey);
    // The whole point of the column: verification must not depend on the key
    // this machine happens to hold today.
    expect(mockGetPublicKey).not.toHaveBeenCalled();
    // ...and the attested fingerprint describes the key that actually verified.
    const { fingerprintPublicKey } = jest.requireActual('../../services/crypto/signature-service');
    expect(res.publicKeyFingerprint).toBe(fingerprintPublicKey(rowKey));
  });

  it('fingerprint derivation failing must NOT flip the verdict (best-effort)', async () => {
    mockVerify.mockResolvedValue(true);
    mockGetPublicKey.mockRejectedValue(new Error('no key'));
    const res = await certService.verifyCertificateSignature(signedCert());
    expect(res).toMatchObject({ signed: true, valid: true });
    expect(res.publicKeyFingerprint).toBeNull();
  });

  it('signed cert whose signature does NOT verify (forged/tampered) → { signed:true, valid:false }', async () => {
    mockVerify.mockResolvedValue(false);
    const res = await certService.verifyCertificateSignature(signedCert());
    expect(res).toMatchObject({ signed: true, valid: false });
  });

  it('legacy / hash-only cert (no signature) → { signed:false }, does not call the verifier', async () => {
    const res = await certService.verifyCertificateSignature({ documentHash: 'x'.repeat(64) });
    expect(res).toEqual({ signed: false });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('null cert → { signed:false }', async () => {
    expect(await certService.verifyCertificateSignature(null)).toEqual({ signed: false });
  });

  it('verifier throws → graceful { signed:true, valid:false, error:VERIFY_ERROR } (never throws)', async () => {
    mockVerify.mockRejectedValue(new Error('key load failed'));
    const res = await certService.verifyCertificateSignature(signedCert());
    expect(res).toMatchObject({ signed: true, valid: false, error: 'VERIFY_ERROR' });
  });
});
