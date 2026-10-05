/**
 * Digital Signature & Cryptography Service
 *
 * Main entry point for all cryptographic operations in the Botanical Audit Framework.
 *
 * Features:
 * - RSA-2048 digital signatures
 * - SHA-256 hash chains for tamper-proof records
 * - RFC 3161 trusted timestamps
 * - AWS KMS integration for production
 * - Key rotation and management
 *
 * Usage:
 * ```javascript
 * const cryptoService = require('./services/CryptoUtils');
 *
 *
 * // Initialize on app startup
 * await cryptoService.initialize({
 *   useKMS: process.env.NODE_ENV === 'production',
 *   kmsKeyId: process.env.AWS_KMS_KEY_ID,
 *   tsaProvider: process.env.TSA_PROVIDER || 'freetsa'
 * });
 *
 * // Sign a record
 * const signedRecord = await cryptoService.signRecord(record);
 *
 * // Verify a record
 * const verification = await cryptoService.verifyRecord(record);
 * ```
 *
 * @module services/crypto
 */

const { initializeSignatureService } = require('./signature-service');
const { getTimestampService } = require('./timestamp-service');
const { createLogger } = require('../../shared/logger');
const logger = createLogger('crypto-service');

/**
 * Unified Crypto Service
 */
class CryptoService {
  constructor() {
    this.signatureService = null;
    this.timestampService = null;
    this.initialized = false;
  }

  /**
   * Initialize crypto service
   *
   * @param {Object} options - Configuration options
   * @param {Boolean} options.useKMS - Use AWS KMS for key management
   * @param {String} options.kmsKeyId - AWS KMS key ID
   * @param {String} options.tsaProvider - Timestamp authority provider (freetsa/digicert/globalsign)
   * @param {String} options.keyDir - Local key directory (if not using KMS)
   */
  async initialize(options = {}) {
    try {
      logger.info('Initializing crypto service...');

      // Initialize signature service
      this.signatureService = await initializeSignatureService({
        useKMS: options.useKMS || false,
        kmsKeyId: options.kmsKeyId,
        keyDir: options.keyDir,
      });

      // Initialize timestamp service
      this.timestampService = getTimestampService({
        provider: options.tsaProvider || 'freetsa',
      });

      this.initialized = true;
      logger.info('Crypto service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize crypto service:', error);
      throw error;
    }
  }

  /**
   * Ensure service is initialized
   * @private
   */
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error('CryptoService not initialized. Call initialize() first.');
    }
  }

  /**
   * Generate SHA-256 hash
   *
   * @param {Object|String} data - Data to hash
   * @returns {String} Hexadecimal hash
   */
  generateHash(data) {
    this.ensureInitialized();
    return this.signatureService.generateHash(data);
  }

  /**
   * Generate hash chain (links current record to previous)
   *
   * @param {Object} record - Current record
   * @param {String} previousHash - Previous record hash
   * @returns {String} Current record hash
   */
  generateHashChain(record, previousHash = null) {
    this.ensureInitialized();
    return this.signatureService.generateHashChain(record, previousHash);
  }

  /**
   * Sign a hash
   *
   * @param {String} hash - Hash to sign
   * @returns {Promise<String>} Signature (hex)
   */
  async sign(hash) {
    this.ensureInitialized();
    return await this.signatureService.sign(hash);
  }

  /**
   * Verify a signature
   *
   * @param {String} hash - Original hash
   * @param {String} signature - Signature to verify
   * @param {String} publicKey - Public key (optional)
   * @returns {Promise<Boolean>} True if valid
   */
  async verify(hash, signature, publicKey = null) {
    this.ensureInitialized();
    return await this.signatureService.verify(hash, signature, publicKey);
  }

  /**
   * Sign a complete record (hash chain + signature + optional timestamp)
   *
   * @param {Object} record - Record to sign
   * @param {String} previousHash - Previous record hash (for chain)
   * @param {Boolean} includeTimestamp - Include RFC 3161 timestamp
   * @returns {Promise<Object>} Signed record
   */
  async signRecord(record, previousHash = null, includeTimestamp = true) {
    this.ensureInitialized();

    // Step 1: Generate hash chain
    const hash = this.signatureService.generateHashChain(record, previousHash);

    // Step 2: Sign the hash
    const signature = await this.signatureService.sign(hash);

    // Step 3: Get RFC 3161 timestamp (if requested)
    let rfc3161Timestamp = null;
    if (includeTimestamp) {
      try {
        rfc3161Timestamp = await this.timestampService.timestampRecord(hash);
      } catch (error) {
        logger.warn('RFC 3161 timestamp failed, continuing without it:', error.message);
      }
    }

    // Return complete signed record
    return {
      ...record,
      hash,
      signature,
      previousHash: previousHash || '0'.repeat(64),
      rfc3161Timestamp, // Separate field to avoid overwriting record.timestamp
    };
  } /**
   * Verify a complete record (hash chain + signature + timestamp)
   *
   * @param {Object} record - Record to verify
   * @param {String} previousHash - Expected previous hash
   * @param {String} publicKey - Public key (optional)
   * @returns {Promise<Object>} Verification result
   */
  async verifyRecord(record, previousHash = null, publicKey = null) {
    this.ensureInitialized();

    // Verify hash chain and signature
    const signatureVerification = await this.signatureService.verifyRecord(
      record,
      previousHash,
      publicKey,
    );

    // Verify RFC 3161 timestamp (if present)
    let timestampVerification = null;
    if (record.rfc3161Timestamp && record.rfc3161Timestamp.token) {
      try {
        timestampVerification = await this.timestampService.verifyTimestamp(
          record.rfc3161Timestamp.token,
          record.hash,
        );
      } catch (error) {
        console.warn('RFC 3161 timestamp verification failed:', error.message);
        timestampVerification = {
          valid: false,
          error: error.message,
        };
      }
    }

    return {
      valid: signatureVerification.valid && (!timestampVerification || timestampVerification.valid),
      signature: signatureVerification,
      timestamp: timestampVerification,
    };
  }

  /**
   * Verify hash chain integrity
   *
   * @param {Object} record - Record to verify
   * @param {String} previousHash - Expected previous hash
   * @returns {Boolean} True if hash chain is valid
   */
  verifyHashChain(record, previousHash = null) {
    this.ensureInitialized();
    return this.signatureService.verifyHashChain(record, previousHash);
  }

  /**
   * Get public key (for verification by others)
   *
   * @returns {Promise<String>} PEM-formatted public key
   */
  async getPublicKey() {
    this.ensureInitialized();
    return await this.signatureService.getPublicKey();
  }

  /**
   * Batch sign multiple records
   *
   * @param {Array<Object>} records - Records to sign
   * @param {Boolean} includeTimestamp - Include timestamps
   * @returns {Promise<Array<Object>>} Signed records
   */
  async signRecordsBatch(records, includeTimestamp = false) {
    this.ensureInitialized();

    const signedRecords = [];
    let previousHash = null;

    for (const record of records) {
      const signedRecord = await this.signRecord(record, previousHash, includeTimestamp);
      signedRecords.push(signedRecord);
      previousHash = signedRecord.hash;
    }

    return signedRecords;
  }

  /**
   * Verify chain of records
   *
   * @param {Array<Object>} records - Records to verify (in order)
   * @returns {Promise<Object>} Verification result
   */
  async verifyRecordChain(records) {
    this.ensureInitialized();

    const results = [];
    let previousHash = null;
    let allValid = true;

    for (const record of records) {
      const verification = await this.verifyRecord(record, previousHash);
      results.push({
        recordId: record.id || record.recordId,
        ...verification,
      });

      if (!verification.valid) {
        allValid = false;
      }

      previousHash = record.hash;
    }

    return {
      valid: allValid,
      totalRecords: records.length,
      validRecords: results.filter(r => r.valid).length,
      invalidRecords: results.filter(r => !r.valid).length,
      details: results,
    };
  }

  /**
   * Rotate cryptographic keys
   *
   * @param {Number} version - New key version
   * @returns {Promise<Object>} Key rotation result
   */
  async rotateKeys(version) {
    this.ensureInitialized();
    return await this.signatureService.rotateKeys(version);
  }

  /**
   * Get timestamp for a hash
   *
   * @param {String} hash - Hash to timestamp
   * @returns {Promise<Object>} Timestamp data
   */
  async getTimestamp(hash) {
    this.ensureInitialized();
    return await this.timestampService.timestampRecord(hash);
  }

  /**
   * Clear timestamp cache
   */
  clearTimestampCache() {
    this.ensureInitialized();
    this.timestampService.clearCache();
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      initialized: this.initialized,
      signatureService: this.signatureService ? 'ready' : 'not initialized',
      timestampService: this.timestampService ? 'ready' : 'not initialized',
      usingKMS: this.signatureService?.useKMS || false,
      tsaProvider: this.timestampService?.tsaConfig?.name || 'unknown',
    };
  }
}

// Export singleton instance
let instance = null;

/**
 * Get CryptoService instance (singleton)
 */
function getCryptoService() {
  if (!instance) {
    instance = new CryptoService();
  }
  return instance;
}

/**
 * Initialize crypto service (call this on app startup)
 *
 * @param {Object} options - Configuration options
 * @returns {Promise<CryptoService>}
 */
async function initialize(options = {}) {
  const service = getCryptoService();
  await service.initialize(options);
  return service;
}

// Export both class and singleton methods
module.exports = {
  CryptoService,
  getCryptoService,
  initialize,

  // Direct exports for convenience
  get initialized() {
    return instance?.initialized || false;
  },

  generateHash: (...args) => getCryptoService().generateHash(...args),
  generateHashChain: (...args) => getCryptoService().generateHashChain(...args),
  sign: (...args) => getCryptoService().sign(...args),
  verify: (...args) => getCryptoService().verify(...args),
  signRecord: (...args) => getCryptoService().signRecord(...args),
  verifyRecord: (...args) => getCryptoService().verifyRecord(...args),
  verifyHashChain: (...args) => getCryptoService().verifyHashChain(...args),
  getPublicKey: (...args) => getCryptoService().getPublicKey(...args),
  signRecordsBatch: (...args) => getCryptoService().signRecordsBatch(...args),
  verifyRecordChain: (...args) => getCryptoService().verifyRecordChain(...args),
  rotateKeys: (...args) => getCryptoService().rotateKeys(...args),
  getTimestamp: (...args) => getCryptoService().getTimestamp(...args),
  clearTimestampCache: (...args) => getCryptoService().clearTimestampCache(...args),
  getStatus: (...args) => getCryptoService().getStatus(...args),
};

