'use strict';

/**
 * INT-11 — per-issuer key namespace must be cryptographically enforced.
 * Pre-fix signWithLocalKey(hash) ignored its 2nd arg, so DTAM and PLATFORM
 * receipts were signed with the SAME default key (separation was cosmetic).
 * signWithLocalKey(hash, keyNamespace) now loads a per-namespace key under
 * <keyDir>/namespaces/<sanitized>/private.pem when provisioned, and falls back
 * to the default key (with a warning) until ops installs the namespaced keys.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PASS = 'int11-test-rsa-passphrase';
process.env.RSA_PRIVATE_KEY_PASSPHRASE = PASS;

const { SignatureService } = require('../../services/crypto/signature-service');

function genEncryptedKeypair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: PASS },
  });
}

function verifySig(publicPem, hash, sigHex) {
  const v = crypto.createVerify('RSA-SHA256');
  v.update(hash);
  v.end();
  return v.verify(publicPem, sigHex, 'hex');
}

describe('INT-11 — signature-service per-namespace key', () => {
  let svc;
  let keyDir;
  let defaultPublicPem;
  let platformPublicPem;
  const HASH = 'a'.repeat(64);

  beforeAll(async () => {
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'int11-keys-'));
    svc = new SignatureService({ keyDir, useKMS: false });
    await svc.ensureInitialized(); // generates the default keypair in keyDir
    defaultPublicPem = fs.readFileSync(path.join(keyDir, 'public.pem'), 'utf8');

    // Provision a DISTINCT key for the PLATFORM namespace (rsa:platform-receipt
    // → sanitized 'rsa-platform-receipt'). Leave DTAM un-provisioned to exercise
    // the fallback.
    const platform = genEncryptedKeypair();
    platformPublicPem = platform.publicKey;
    const nsDir = path.join(keyDir, 'namespaces', 'rsa-platform-receipt');
    fs.mkdirSync(nsDir, { recursive: true });
    fs.writeFileSync(path.join(nsDir, 'private.pem'), platform.privateKey);
    fs.writeFileSync(path.join(nsDir, 'public.pem'), platform.publicKey);
  });

  afterAll(() => {
    try { fs.rmSync(keyDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('hasNamespaceKey: true for a provisioned namespace, false otherwise', async () => {
    expect(await svc.hasNamespaceKey('rsa:platform-receipt')).toBe(true);
    expect(await svc.hasNamespaceKey('rsa:dtam-receipt')).toBe(false);
  });

  it('signs with the PLATFORM namespace key (verifiable by its key, NOT the default)', async () => {
    const sig = await svc.signWithLocalKey(HASH, 'rsa:platform-receipt');
    expect(verifySig(platformPublicPem, HASH, sig)).toBe(true);
    expect(verifySig(defaultPublicPem, HASH, sig)).toBe(false); // proves a DIFFERENT key was used
  });

  it('falls back to the default key when the namespace is not provisioned', async () => {
    const sig = await svc.signWithLocalKey(HASH, 'rsa:dtam-receipt');
    expect(verifySig(defaultPublicPem, HASH, sig)).toBe(true); // fell back to default
    expect(verifySig(platformPublicPem, HASH, sig)).toBe(false);
  });

  it('no namespace (legacy call) still signs with the default key', async () => {
    const sig = await svc.signWithLocalKey(HASH);
    expect(verifySig(defaultPublicPem, HASH, sig)).toBe(true);
  });

  it('DTAM and PLATFORM signatures differ once PLATFORM has its own key', async () => {
    const dtam = await svc.signWithLocalKey(HASH, 'rsa:dtam-receipt');       // default (fallback)
    const platform = await svc.signWithLocalKey(HASH, 'rsa:platform-receipt'); // namespaced
    expect(dtam).not.toBe(platform);
  });
});
