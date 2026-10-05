/**
 * Digital Signature Service:
 * RSA-SHA256 signatures, hash-chain integrity, local key management, and optional AWS KMS integration.
 */
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('../../shared/logger');
const { getSecret } = require('../../config/secrets');
const {
  isSigningKeyRequired,
  getExpectedSigningKeyFingerprint,
  getRetiredSigningKeyFingerprints,
} = require('../../config/signing-key-policy');
const logger = createLogger('signature-service');

/**
 * Default on-disk home of the certificate signing key pair. Exported so the
 * boot guard (config/boot-secret-guard.js) checks the SAME directory the
 * service will later read, instead of re-deriving the path and drifting.
 */
const DEFAULT_KEY_DIR = path.join(__dirname, '../../keys');

/**
 * Canonical fingerprint of a PUBLIC key PEM: sha256 hex.
 *
 * Byte-identical to the derivation `certificate-service.verifyCertificateSignature`
 * has published since H1 (`sha256(String(publicKey))`) for any PEM with LF line
 * endings, so pinning a fingerprint does not change a value already surfaced on
 * the public verify response. CRLF is normalised first because a key file
 * mounted or checked out on Windows is the SAME key and must not read as a
 * different one.
 *
 * Safe to log: it is a hash of a public key.
 *
 * @param {string} publicKeyPem
 * @returns {string} 64-char lowercase hex
 */
function fingerprintPublicKey(publicKeyPem) {
  return crypto
    .createHash('sha256')
    .update(String(publicKeyPem).replace(/\r\n/g, '\n'))
    .digest('hex');
}

/**
 * Resolve the RSA private key passphrase from the unified secrets layer.
 *
 * SECURITY RATIONALE:
 *   - The RSA private key signs legally-binding artifacts (GACP certificates, tax
 *     invoices). A hardcoded fallback passphrase here would mean anyone with read
 *     access to this source code (every developer, every leaked container image)
 *     can decrypt a stolen `private.pem` and forge signatures.
 *   - We deliberately route through `getSecret()` so that:
 *       * production WITHOUT a real passphrase FAILS CLOSED (throws). No silent
 *         signing with a known-default key.
 *       * dev/test get a deterministic-per-process placeholder from the secrets
 *         catalog, never inlined here.
 *   - The throw wraps the secrets error so the failure mode is unambiguous in
 *     logs ("RSA_PRIVATE_KEY_PASSPHRASE secret is required but unset") instead of
 *     surfacing as a generic OpenSSL "bad decrypt" later.
 */
function _resolveRsaPassphrase() {
  let value;
  try {
    value = getSecret('RSA_PRIVATE_KEY_PASSPHRASE');
  } catch (_err) {
    throw new Error(
      '[signature-service] RSA_PRIVATE_KEY_PASSPHRASE secret is required but unset',
    );
  }
  if (!value) {
    // getSecret returns null only for `required: false` entries; for this secret
    // that should never happen, but guard explicitly so we never sign with empty.
    throw new Error(
      '[signature-service] RSA_PRIVATE_KEY_PASSPHRASE secret is required but unset',
    );
  }
  return value;
}

// AWS KMS (optional, enabled only when USE_AWS_KMS=true)
const USE_AWS_KMS = String(process.env.USE_AWS_KMS || '').trim().toLowerCase() === 'true';
let AWS_KMS = null;
if (USE_AWS_KMS) {
  try {
    const AWS = require('aws-sdk');
    AWS_KMS = new AWS.KMS({ region: process.env.AWS_REGION || 'ap-southeast-1' });
  } catch (_error) {
    logger.warn('USE_AWS_KMS=true but aws-sdk is not installed. Falling back to local key management.');
  }
}
/**
 * Signature Service Class
 */
class SignatureService {
  constructor(options = {}) {
    this.algorithm = options.algorithm || 'RSA-SHA256';
    this.keySize = options.keySize || 2048;
    // SIGNING_KEY_DIR lets a deployment mount the key somewhere other than the
    // repository — and lets the jest harness point the whole test run at a
    // directory outside it, which is how tests get real RSA signing without
    // touching the key real certificates were signed with (jest.setup.js).
    this.keyDir = options.keyDir || process.env.SIGNING_KEY_DIR || DEFAULT_KEY_DIR;
    const requestedKms = typeof options.useKMS === 'boolean' ? options.useKMS : USE_AWS_KMS;
    this.useKMS = requestedKms && AWS_KMS !== null;
    this.kmsKeyId = options.kmsKeyId || process.env.AWS_KMS_KEY_ID;
    // In-memory key cache. `namespaced` maps a sanitized key-namespace →
    // its encrypted private-key PEM (or null when not provisioned). INT-11:
    // lets DTAM and PLATFORM receipts sign with distinct keys.
    this.keyCache = {
      public: null,
      private: null,
      namespaced: {},
    };
    // Initialization promise.
    //
    // RULING 2 fix round: initialize() can now REJECT (a required runtime with
    // no usable key). Nothing awaits this handle at construction time, so an
    // unhandled rejection would replace the guard's actionable message with a
    // generic Node warning — or, on a strict runtime, kill the process with the
    // wrong error. Attach a handler that logs the real reason exactly once;
    // ensureInitialized() still rejects for every caller that awaits it, so the
    // fail-closed behaviour is unchanged.
    this.initPromise = this.initialize();
    this.initPromise.catch((error) => {
      logger.error(`[signature-service] initialization failed: ${error.message}`);
    });
  }
  /**
   * Initialize the signature service
   */
  async initialize() {
    try {
      // Ensure keys directory exists
      await fs.mkdir(this.keyDir, { recursive: true });
      if (this.useKMS) {
        logger.info('Using AWS KMS for key management');
        // Verify KMS key exists
        await this.verifyKMSKey();
      } else {
        logger.warn('Using local key management (dev mode)');
        // Load or generate local keys
        await this.ensureLocalKeys();
      }
      logger.info('Signature service initialized');
    } catch (error) {
      logger.error('Failed to initialize signature service:', error);
      throw error;
    }
  }
  /**
   * Ensure service is initialized before operations
   */
  async ensureInitialized() {
    await this.initPromise;
  }
  /**
   * Generate SHA-256 hash of data
   *
   * @param {Object|String} data - Data to hash
   * @returns {String} Hexadecimal hash string
   */
  generateHash(data) {
    const jsonString = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.createHash('sha256').update(jsonString).digest('hex');
  }
  /**
   * Generate hash chain (link current record to previous)
   *
   * @param {Object} record - Current record data
   * @param {String} previousHash - Hash of previous record (or genesis)
   * @returns {String} Hash of current record
   */
  generateHashChain(record, previousHash = null) {
    // Use timestamp from record, or createdAt, or generate new ISO string
    const timestamp = record.timestamp || record.createdAt || new Date().toISOString();
    const data = {
      id: record.id || record.recordId,
      type: record.type,
      data: record.data,
      timestamp: timestamp,
      previousHash: previousHash || '0'.repeat(64), // Genesis record
      userId: record.userId,
    };
    return this.generateHash(data);
  }
  /**
   * Verify hash chain integrity
   *
   * @param {Object} record - Record to verify
   * @param {String} previousHash - Expected previous hash (optional, uses record.previousHash if not provided)
   * @returns {Boolean} True if hash chain is valid
   */
  verifyHashChain(record, previousHash = null) {
    // Use provided previousHash, or fall back to record.previousHash
    const expectedPreviousHash = previousHash !== null ? previousHash : record.previousHash;
    const computedHash = this.generateHashChain(
      {
        id: record.id || record.recordId,
        type: record.type,
        data: record.data,
        timestamp: record.timestamp || record.createdAt,
        userId: record.userId,
      },
      expectedPreviousHash,
    );
    return computedHash === record.hash;
  }
  /**
   * Sign data with private key
   *
   * @param {String} hash - Hash to sign
   * @returns {Promise<String>} Hexadecimal signature
   */
  async sign(hash) {
    await this.ensureInitialized();
    if (this.useKMS) {
      return await this.signWithKMS(hash);
    } else {
      return await this.signWithLocalKey(hash);
    }
  }
  /**
   * Verify signature with public key
   *
   * @param {String} hash - Original hash
   * @param {String} signature - Signature to verify
   * @param {String} publicKey - Public key (optional, uses cached if not provided)
   * @returns {Promise<Boolean>} True if signature is valid
   */
  async verify(hash, signature, publicKey = null) {
    await this.ensureInitialized();
    if (this.useKMS) {
      return await this.verifyWithKMS(hash, signature);
    } else {
      return await this.verifyWithLocalKey(hash, signature, publicKey);
    }
  }
  /**
   * Sign data using AWS KMS
   * @private
   */
  async signWithKMS(hash) {
    try {
      const params = {
        KeyId: this.kmsKeyId,
        Message: Buffer.from(hash, 'utf8'),
        MessageType: 'DIGEST',
        SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
      };
      const result = await AWS_KMS.sign(params).promise();
      return result.Signature.toString('hex');
    } catch (error) {
      logger.error('KMS signing error:', error);
      throw new Error(`Failed to sign with KMS: ${error.message}`);
    }
  }
  /**
   * Verify signature using AWS KMS
   * @private
   */
  async verifyWithKMS(hash, signature) {
    try {
      const params = {
        KeyId: this.kmsKeyId,
        Message: Buffer.from(hash, 'utf8'),
        MessageType: 'DIGEST',
        Signature: Buffer.from(signature, 'hex'),
        SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
      };
      const result = await AWS_KMS.verify(params).promise();
      return result.SignatureValid;
    } catch (error) {
      logger.error('KMS verification error:', error);
      return false;
    }
  }
  /**
   * Sign data using local private key
   * @private
   */
  /**
   * INT-11: map a key-namespace string ('rsa:dtam-receipt') to a filesystem-safe
   * directory segment ('rsa-dtam-receipt').
   * @private
   */
  _sanitizeNamespace(keyNamespace) {
    return String(keyNamespace || '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Load (and cache) the encrypted private-key PEM for a key-namespace from
   * `<keyDir>/namespaces/<sanitized>/private.pem`. Returns null when the
   * namespaced key is not provisioned (the caller falls back to the default
   * key). Namespaced keys MUST be encrypted with the same
   * RSA_PRIVATE_KEY_PASSPHRASE as the default key.
   * @private
   */
  async _loadNamespacedPrivateKey(keyNamespace) {
    const safe = this._sanitizeNamespace(keyNamespace);
    if (!safe) { return null; }
    if (Object.prototype.hasOwnProperty.call(this.keyCache.namespaced, safe)) {
      return this.keyCache.namespaced[safe];
    }
    const keyPath = path.join(this.keyDir, 'namespaces', safe, 'private.pem');
    try {
      const pem = await fs.readFile(keyPath, 'utf8');
      this.keyCache.namespaced[safe] = pem;
      return pem;
    } catch (_err) {
      this.keyCache.namespaced[safe] = null; // cache the miss (provisioning needs a restart anyway)
      return null;
    }
  }

  /**
   * INT-11: true when a per-namespace key is provisioned for `keyNamespace`.
   * Lets the caller (receipt-auto-sign) record an accurate `fellBack` flag.
   */
  async hasNamespaceKey(keyNamespace) {
    return (await this._loadNamespacedPrivateKey(keyNamespace)) !== null;
  }

  /**
   * RULING 2 — the public key that verifies what `signWithLocalKey(hash, ns)`
   * just produced, so the caller can pin it onto the row it is about to write.
   *
   * The selection MUST mirror signWithLocalKey exactly: a provisioned
   * namespaced key wins, otherwise the default key. Pinning the default public
   * key next to a namespace-signed signature would create rows that can never
   * be verified, which is the very failure this ruling exists to remove.
   *
   * @param {String|null} keyNamespace
   * @returns {Promise<String>} PEM public key
   */
  async getPublicKeyForNamespace(keyNamespace = null) {
    await this.ensureInitialized();
    if (keyNamespace && (await this._loadNamespacedPrivateKey(keyNamespace))) {
      const safe = this._sanitizeNamespace(keyNamespace);
      const publicKeyPath = path.join(this.keyDir, 'namespaces', safe, 'public.pem');
      try {
        return await fs.readFile(publicKeyPath, 'utf8');
      } catch (error) {
        // Fail closed rather than silently pinning the wrong key: an operator
        // who installed a namespaced private.pem without its public.pem has a
        // provisioning bug, and guessing would poison the certificate row.
        throw new Error(
          `[signature-service] key namespace '${keyNamespace}' has a private key but no public key at `
          + `${publicKeyPath}; refusing to guess which public key verifies its signatures. Cause: ${error.message}`,
        );
      }
    }
    return this.getPublicKey();
  }

  /**
   * RULING 2 fix round — the TRUST ANCHOR for a public key pinned on a
   * certificate row.
   *
   * The pinned key lives on the same row as the signature and the document
   * hash, so on its own it proves nothing: an attacker who can write that row
   * generates a keypair, signs the stored hash, pins their own PEM, and the
   * verifier would answer "valid" with the attacker's fingerprint. The
   * signature really does verify — the missing question is whether the key is
   * OURS. This set is the answer, and every member of it comes from deploy
   * configuration or the key mount, never from request data:
   *
   *   - the key this box currently holds for `keyNamespace` (covers everything
   *     signed today, and is what makes a plain machine move work);
   *   - SIGNING_KEY_FINGERPRINT, the operator's pin — deliberately consulted
   *     even when the mount is unreadable, so a key-mount outage degrades
   *     verification of old certificates gracefully instead of failing them;
   *   - SIGNING_KEY_RETIRED_FINGERPRINTS, keys the operator has retired but
   *     still vouches for. This is what keeps rotation non-destructive.
   *
   * @param {String|null} keyNamespace
   * @returns {Promise<Set<string>>} lowercase hex fingerprints
   */
  async getTrustedPublicKeyFingerprints(keyNamespace = null) {
    const trusted = new Set(getRetiredSigningKeyFingerprints());
    const pinned = getExpectedSigningKeyFingerprint();
    if (pinned) { trusted.add(pinned); }
    try {
      const currentPem = await this.getPublicKeyForNamespace(keyNamespace);
      if (currentPem) { trusted.add(fingerprintPublicKey(currentPem)); }
    } catch (error) {
      // Best-effort: an unreadable mount must not silently widen the set, and
      // must not empty it either — the operator-declared entries stand alone.
      logger.warn(
        `[signature-service] could not read the current public key while building the trusted set: ${error.message}`,
      );
    }
    return trusted;
  }

  async signWithLocalKey(hash, keyNamespace = null) {
    try {
      // RULING 2 — wait for initialization before touching any key.
      //
      // This was a real race, not a tidiness fix. `initialize()` is kicked off
      // by the constructor and never awaited here, so the first sign of a
      // process could reach `loadPrivateKey()` while ensureLocalKeys was still
      // on its first `await`. It then read whatever private.pem happened to be
      // on disk — including a stale one encrypted under a passphrase this
      // process cannot reproduce — and threw ERR_OSSL_BAD_DECRYPT, which the
      // old certificate-service swallowed into an unsigned certificate.
      // Reproduced locally on 2026-08-22: 4 certificate suites signed against a
      // stale dev key this way. Awaiting here means signing sees the validated
      // (or, in dev, regenerated) key, and in a required runtime it inherits
      // the boot refusal instead of signing with something unverified.
      await this.ensureInitialized();
      // INT-11: prefer the per-namespace key (DTAM vs PLATFORM separation,
      // ม.86/4 / ISO 27799 §7.2.3). Fall back to the single default key — with
      // a loud warning — while ops is still provisioning the namespaced keys,
      // so existing signing never breaks.
      let privateKeyPem = null;
      if (keyNamespace) {
        privateKeyPem = await this._loadNamespacedPrivateKey(keyNamespace);
        if (!privateKeyPem) {
          logger.warn(
            `[signature-service] key namespace '${keyNamespace}' not provisioned `
            + `(expected ${path.join(this.keyDir, 'namespaces', this._sanitizeNamespace(keyNamespace), 'private.pem')}) `
            + '— falling back to the default key. Per-issuer separation is INERT until the namespaced key is installed.',
          );
        }
      }
      if (!privateKeyPem) {
        if (!this.keyCache.private) {
          await this.loadPrivateKey();
        }
        privateKeyPem = this.keyCache.private;
      }
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(hash);
      sign.end();
      // Sign with passphrase for encrypted private key.
      // Passphrase MUST come from the secrets layer — never from a hardcoded
      // fallback — otherwise leaked source code lets an attacker decrypt the
      // stolen private key and forge signed PDFs. _resolveRsaPassphrase fails
      // closed when the secret is missing in production.
      const signature = sign.sign(
        {
          key: privateKeyPem,
          passphrase: _resolveRsaPassphrase(),
        },
        'hex',
      );
      return signature;
    } catch (error) {
      logger.error('Local signing error:', error);
      throw new Error(`Failed to sign with local key: ${error.message}`);
    }
  }
  /**
   * Verify signature using local public key
   * @private
   */
  async verifyWithLocalKey(hash, signature, publicKey = null) {
    try {
      // RULING 2 — a PEM supplied by the caller WINS and is used ALONE.
      // That caller is `certificate-service.verifyCertificateSignature`
      // passing the `signaturePublicKey` pinned on the certificate row. An old
      // certificate must stay verifiable after the on-disk key is rotated, the
      // container rebuilt, or the whole service moved to another machine —
      // none of which the row's own key material knows or cares about.
      // Falling back to the loaded key here would reintroduce exactly that
      // coupling, so the fallback only applies when the row carries no key.
      let keyToUse = publicKey;
      if (!keyToUse) {
        // Only the FALLBACK path depends on the box's own key, so only it waits
        // for initialization. A row that carries its own key must stay
        // verifiable even where boot would refuse — verification of an old
        // certificate is not a privileged operation.
        await this.ensureInitialized();
        keyToUse = this.keyCache.public || await this.loadPublicKey();
      }
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(hash);
      verify.end();
      return verify.verify(keyToUse, signature, 'hex');
    } catch (error) {
      logger.error('Local verification error:', error);
      return false;
    }
  }
  /**
   * Load the local signing key pair, or decide — loudly — what to do when it
   * cannot be used.
   *
   * RULING 2 (2026-08-22). This method used to do two unsafe things:
   *
   *   (a) A MISSING key pair was silently replaced with a freshly generated
   *       one, in EVERY environment. On a fresh container or a machine move
   *       that mints a NEW key, and every certificate signed with the previous
   *       key stops verifying. Silently swapping the identity of the certifying
   *       authority is strictly worse than refusing to start.
   *
   *   (b) A key that was PRESENT but not decryptable with the configured
   *       passphrase counted as "loaded fine" — `loadPrivateKey` only reads
   *       bytes. The failure surfaced much later inside `signWithLocalKey` as
   *       an OpenSSL bad-decrypt, which certificate-service swallowed into its
   *       hash-only fallback. That is not theory: a read-only query of the demo
   *       database on 2026-08-22 found 3 certificates, all issued after CERT-01
   *       shipped, every one of them with `signature IS NULL`.
   *
   * So the check is now "can this key actually SIGN?", not "are the files
   * there?".
   *
   * 2026-08-26 — what the routing turns on. It used to be NODE_ENV, and that
   * was wrong. Certificate GACP-TH-2569-CAE820 was minted through a real
   * journey on 2026-08-25 12:51 and pinned the key 47b98a69…; the next
   * morning the box held c09bcabf…, written at 06:08 by a restart, and the
   * product's own verifier answered `untrusted_pinned_key` for that
   * certificate. Nobody rotated anything. The development branch below simply
   * overwrote private.pem and public.pem, which killed two things at once:
   * every certificate already signed with the old key, and the old key
   * material itself — so the damage could not be undone.
   *
   * The refusal's own stated reason never mentioned the environment:
   * "generating a replacement key here would silently invalidate every
   * certificate already signed with the previous key." That is true wherever
   * certificates exist, and by the time a developer has walked a journey,
   * they do. So the question is not WHERE we are running, it is whether this
   * box already holds key material:
   *
   *   - key material PRESENT but unusable → refuse, in every environment.
   *     Nothing is written. A wrong passphrase is a configuration mistake with
   *     a fix (find the passphrase, or deliberately remove the files); it is
   *     never a reason to destroy a certifying authority's identity.
   *   - NO key material at all → a fresh box. Nothing has been signed with a
   *     key it does not have, so nothing can be invalidated: a required
   *     runtime still refuses (production mounts its key), development
   *     generates and says so at WARN.
   *
   * The escape hatch is deliberately manual — a human removes the files —
   * rather than an env flag, because a flag that permits silent key
   * replacement is this defect with a switch on it.
   *
   * Either way the fingerprint guard runs afterwards, so a loadable-but-WRONG
   * key never reaches a certificate.
   *
   * @private
   */
  async ensureLocalKeys() {
    let failure = null;
    this._refuseTheBoxKeyUnderTest();

    try {
      await this.loadPublicKey();
      await this.loadPrivateKey();
      await this._assertKeyPairUsable();
      logger.info('Loaded existing signing keys');
    } catch (error) {
      failure = error;
    }

    if (failure) {
      // Asked of the DISK, not of the cache: a half-populated cache from the
      // failed load above says nothing about what an operator mounted. Either
      // file counts — a lone public.pem means someone holds the private half,
      // and generating over it would orphan every signature it verifies.
      const hasKeyMaterial = await this._anyKeyFileExists();

      if (hasKeyMaterial || isSigningKeyRequired()) {
        // Deliberately reports the CAUSE, never key material. `failure.message`
        // here is an fs error (ENOENT + path) or an OpenSSL error string.
        throw new Error(
          '[signature-service] FATAL: the certificate signing key in '
          + `${this.keyDir} could not be loaded and used (expected private.pem + public.pem, `
          + 'decryptable with RSA_PRIVATE_KEY_PASSPHRASE). Refusing to start: generating a replacement '
          + 'key here would silently invalidate every certificate already signed with the previous key, '
          + 'and overwrite the only copy of that key. Mount the existing key (read-only secret mount), or '
          + 'set the passphrase it was encrypted with, and restart. If this box is scratch and you truly '
          + `want a new key, remove ${this.keyDir}/private.pem and public.pem by hand first — that is a `
          + 'deliberate act, and it is meant to be. '
          + `Cause: ${failure.message}`,
        );
      }

      logger.warn(
        '[signature-service] DEV KEY GENERATED — there is no signing key in '
        + `${this.keyDir}, so a THROWAWAY development key pair was created. `
        + 'Certificates signed with it cannot be verified by anyone else, and deleting it '
        + 'invalidates them. This path is refused in production and wherever REQUIRE_SIGNING_KEY=true. '
        + `Cause: ${failure.message}`,
      );
      // Clear the stale cache first: generateKeyPair writes both files, and a
      // half-populated cache from the failed load must not survive.
      this.keyCache.public = null;
      this.keyCache.private = null;
      await this.generateKeyPair();
    }

    await this._assertKeyFingerprint();
  }

  /**
   * A test run may not touch the box's own signing key. Ever.
   *
   * The rule above ("never replace existing key material") only holds if
   * something enforces it, and on 2026-08-26 nothing did: two unit suites —
   * one about area units, one about the evidence gate, neither mentioning
   * signing anywhere in its text — instantiated the real service with no
   * keyDir, so it reached apps/backend/keys and regenerated the pair. `npx
   * jest` rotated the certifying authority's key, and that is what destroyed
   * the key certificate GACP-TH-2569-CAE820 was signed with.
   *
   * A test wanting real cryptography passes its own temp `keyDir`; a test that
   * only needs issuance to get past signing mocks the service. Both are one
   * line, and both are named in the message, because the author who trips this
   * has no reason to know the history — they just wrote a test about something
   * else entirely, exactly as the two authors before them did.
   *
   * @private
   */
  _refuseTheBoxKeyUnderTest() {
    if (process.env.NODE_ENV !== 'test') { return; }
    if (path.resolve(this.keyDir) !== path.resolve(DEFAULT_KEY_DIR)) { return; }
    throw new Error(
      '[signature-service] a test is using the repository\'s own key directory '
      + `(${DEFAULT_KEY_DIR}). Refusing: a test run must never read or write the box's signing key — `
      + 'generating one there rotates the certifying authority and retroactively invalidates every '
      + 'certificate already signed. Either pass your own temporary directory '
      + '(new SignatureService({ keyDir: fs.mkdtempSync(...) })) for real cryptography, or '
      + 'jest.mock(\'services/crypto/signature-service\') when the test is about something else.',
    );
  }

  /**
   * Does this box hold ANY signing key material?
   *
   * The one question that separates "a fresh machine" from "a machine whose
   * key I would be destroying". Presence only — the files are never read here,
   * so an unreadable or corrupt key still counts as present, which is the
   * conservative answer and the correct one.
   *
   * @private
   * @returns {Promise<boolean>}
   */
  async _anyKeyFileExists() {
    const paths = [
      path.join(this.keyDir, 'private.pem'),
      path.join(this.keyDir, 'public.pem'),
    ];
    const found = await Promise.all(paths.map(
      (p) => fs.access(p).then(() => true).catch(() => false),
    ));
    return found.some(Boolean);
  }

  /**
   * Prove the loaded pair can actually produce a verifiable signature: one
   * sign + verify round-trip over a constant probe string.
   *
   * This is the check that catches the live defect — a private.pem encrypted
   * under a passphrase nobody has any more reads perfectly and fails only at
   * signing time. One RSA operation at boot buys a truthful answer.
   *
   * @private
   */
  async _assertKeyPairUsable() {
    const probe = 'signature-service:key-usability-probe';
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(probe);
    sign.end();
    const signature = sign.sign(
      { key: this.keyCache.private, passphrase: _resolveRsaPassphrase() },
      'hex',
    );
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(probe);
    verify.end();
    if (!verify.verify(this.keyCache.public, signature, 'hex')) {
      throw new Error('private.pem and public.pem are not a matching pair');
    }
  }

  /**
   * Refuse to boot when the loaded public key is not the key the operator
   * pinned via SIGNING_KEY_FINGERPRINT.
   *
   * Applies in EVERY environment, including development: a generated dev key
   * can never match a pinned fingerprint, so a developer who pins one gets the
   * same fail-closed answer production would give instead of a quiet mismatch.
   *
   * Fingerprints are hashes of PUBLIC keys — safe to put in an error message,
   * and the operator needs both halves to diagnose which key they mounted.
   *
   * @private
   * @returns {Promise<string|null>} the loaded key's fingerprint, or null when unpinned
   */
  async _assertKeyFingerprint() {
    const expected = getExpectedSigningKeyFingerprint();
    if (!this.keyCache.public) {
      await this.loadPublicKey();
    }
    const actual = fingerprintPublicKey(this.keyCache.public);
    if (!expected) { return null; }
    if (actual !== expected) {
      throw new Error(
        '[signature-service] FATAL: signing key fingerprint mismatch. '
        + `Expected ${expected}, loaded key is ${actual}. Refusing to boot: signing with an `
        + 'unexpected key produces certificates that fail verification against the published key. '
        + 'Check the key mount, or update SIGNING_KEY_FINGERPRINT if this key is intentional.',
      );
    }
    logger.info(`Signing key fingerprint verified: ${actual}`);
    return actual;
  }
  /**
   * Generate RSA key pair
   * @private
   */
  async generateKeyPair() {
    return new Promise((resolve, reject) => {
      crypto.generateKeyPair(
        'rsa',
        {
          modulusLength: this.keySize,
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem',
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem',
            cipher: 'aes-256-cbc',
            // Same rule as signWithLocalKey: the key MUST be encrypted with a
            // secret-managed passphrase. Generating a key with a hardcoded
            // passphrase would create a forever-vulnerable artifact on disk.
            passphrase: _resolveRsaPassphrase(),
          },
        },
        async (err, publicKey, privateKey) => {
          if (err) {
            return reject(err);
          }
          try {
            // Save keys to disk
            const publicKeyPath = path.join(this.keyDir, 'public.pem');
            const privateKeyPath = path.join(this.keyDir, 'private.pem');
            await fs.writeFile(publicKeyPath, publicKey);
            await fs.writeFile(privateKeyPath, privateKey);
            // Cache keys
            this.keyCache.public = publicKey;
            this.keyCache.private = privateKey;
            logger.info(`Keys saved to: ${this.keyDir}`);
            resolve({ publicKey, privateKey });
          } catch (error) {
            reject(error);
          }
        },
      );
    });
  }
  /**
   * Load public key from disk
   * @private
   */
  async loadPublicKey() {
    const publicKeyPath = path.join(this.keyDir, 'public.pem');
    this.keyCache.public = await fs.readFile(publicKeyPath, 'utf8');
    return this.keyCache.public;
  }
  /**
   * Load private key from disk
   * @private
   */
  async loadPrivateKey() {
    const privateKeyPath = path.join(this.keyDir, 'private.pem');
    this.keyCache.private = await fs.readFile(privateKeyPath, 'utf8');
    return this.keyCache.private;
  }
  /**
   * Get public key (for verification by others)
   *
   * @returns {Promise<String>} PEM-formatted public key
   */
  async getPublicKey() {
    await this.ensureInitialized();
    if (this.useKMS) {
      return await this.getKMSPublicKey();
    } else {
      if (!this.keyCache.public) {
        await this.loadPublicKey();
      }
      return this.keyCache.public;
    }
  }
  /**
   * Get public key from AWS KMS
   * @private
   */
  async getKMSPublicKey() {
    try {
      const params = { KeyId: this.kmsKeyId };
      const result = await AWS_KMS.getPublicKey(params).promise();
      // Convert DER to PEM format
      const publicKeyDER = result.PublicKey;
      const publicKeyPEM = this.derToPem(publicKeyDER, 'PUBLIC KEY');
      return publicKeyPEM;
    } catch (error) {
      logger.error('Failed to get KMS public key:', error);
      throw error;
    }
  }
  /**
   * Verify AWS KMS key exists
   * @private
   */
  async verifyKMSKey() {
    try {
      const params = { KeyId: this.kmsKeyId };
      const result = await AWS_KMS.describeKey(params).promise();
      if (result.KeyMetadata.KeyState !== 'Enabled') {
        throw new Error(`KMS key is not enabled: ${result.KeyMetadata.KeyState}`);
      }
      logger.info(`KMS key verified: ${result.KeyMetadata.KeyId}`);
      return true;
    } catch (error) {
      logger.error('KMS key verification failed:', error);
      throw new Error(`Invalid KMS key: ${error.message}`);
    }
  }
  /**
   * Convert DER to PEM format
   * @private
   */
  derToPem(der, type) {
    const base64 = der.toString('base64');
    const chunks = base64.match(/.{1,64}/g) || [];
    return [`-----BEGIN ${type}-----`, ...chunks, `-----END ${type}-----`].join('\n');
  }
  /**
   * Sign a complete record (hash + sign)
   *
   * @param {Object} record - Record to sign
   * @param {String} previousHash - Previous record hash (for chain)
   * @returns {Promise<Object>} Signed record with hash and signature
   */
  async signRecord(record, previousHash = null) {
    await this.ensureInitialized();
    // Generate hash chain
    const hash = this.generateHashChain(record, previousHash);
    // Sign the hash
    const signature = await this.sign(hash);
    // Return signed record
    return {
      ...record,
      hash,
      signature,
      previousHash: previousHash || '0'.repeat(64),
    };
  }
  /**
   * Verify a complete record (hash chain + signature)
   *
   * @param {Object} record - Record to verify
   * @param {String} previousHash - Expected previous hash
   * @param {String} publicKey - Public key (optional)
   * @returns {Promise<Object>} Verification result
   */
  async verifyRecord(record, previousHash = null, publicKey = null) {
    await this.ensureInitialized();
    // Verify hash chain
    const hashValid = this.verifyHashChain(record, previousHash);
    // Verify signature
    const signatureValid = await this.verify(record.hash, record.signature, publicKey);
    return {
      valid: hashValid && signatureValid,
      hash: {
        valid: hashValid,
        stored: record.hash,
        computed: this.generateHashChain(
          {
            id: record.id || record.recordId,
            type: record.type,
            data: record.data,
            timestamp: record.timestamp || record.createdAt,
            userId: record.userId,
          },
          previousHash,
        ),
      },
      signature: {
        valid: signatureValid,
        algorithm: this.algorithm,
      },
    };
  }
  /**
   * Rotate keys (generate new key pair)
   *
   * @param {Number} version - Key version number
   * @returns {Promise<Object>} New key pair info
   */
  async rotateKeys(version) {
    await this.ensureInitialized();
    if (this.useKMS) {
      throw new Error('Key rotation for KMS keys must be done through AWS console');
    }
    // Backup old keys
    const timestamp = Date.now();
    const backupDir = path.join(this.keyDir, 'backup', `v${version - 1}-${timestamp}`);
    await fs.mkdir(backupDir, { recursive: true });
    const publicKeyPath = path.join(this.keyDir, 'public.pem');
    const privateKeyPath = path.join(this.keyDir, 'private.pem');
    // Copy old keys to backup
    await fs.copyFile(publicKeyPath, path.join(backupDir, 'public.pem'));
    await fs.copyFile(privateKeyPath, path.join(backupDir, 'private.pem'));
    logger.info(`Backed up old keys to: ${backupDir}`);
    // Generate new keys
    const { publicKey, privateKey: _privateKey } = await this.generateKeyPair();
    logger.info(`Rotated keys to version ${version}`);
    return {
      version,
      publicKey,
      backupPath: backupDir,
      timestamp,
    };
  }
}
// Export singleton instance
let instance = null;
/**
 * Get SignatureService instance (singleton)
 *
 * @param {Object} options - Configuration options
 * @returns {SignatureService}
 */
function getSignatureService(options = {}) {
  if (!instance) {
    instance = new SignatureService(options);
  }
  return instance;
}
/**
 * Initialize SignatureService (call this on app startup)
 *
 * @param {Object} options - Configuration options
 * @returns {Promise<SignatureService>}
 */
async function initializeSignatureService(options = {}) {
  const service = getSignatureService(options);
  await service.ensureInitialized();
  return service;
}
module.exports = {
  SignatureService,
  getSignatureService,
  initializeSignatureService,
  fingerprintPublicKey,
  DEFAULT_KEY_DIR,
};
