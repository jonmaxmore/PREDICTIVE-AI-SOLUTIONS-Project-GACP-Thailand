/**
 * Crypto Service Tests
 *
 * Tests for digital signature and cryptography services.
 *
 * @module __tests__/crypto-service.test
 */
const _crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { CryptoService } = require('../services/crypto');
// Test configuration
const TEST_KEY_DIR = path.join(__dirname, '../__test_keys__');
describe('CryptoService', () => {
  let cryptoService;
  beforeAll(async () => {
    // Clean up test keys directory
    try {
      await fs.rm(TEST_KEY_DIR, { recursive: true, force: true });
    } catch (_error) {
      // Directory might not exist
    }
    // Initialize crypto service with test configuration
    cryptoService = new CryptoService();
    await cryptoService.initialize({
      useKMS: false, // Use local keys for testing
      keyDir: TEST_KEY_DIR,
      tsaProvider: 'freetsa',
    });
  });
  afterAll(async () => {
    // Clean up test keys
    try {
      await fs.rm(TEST_KEY_DIR, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });
  describe('Initialization', () => {
    test('should initialize successfully', () => {
      expect(cryptoService.initialized).toBe(true);
      expect(cryptoService.signatureService).toBeDefined();
      expect(cryptoService.timestampService).toBeDefined();
    });
    test('should throw error if not initialized', () => {
      const uninitializedService = new CryptoService();
      expect(() => {
        uninitializedService.generateHash({ test: 'data' });
      }).toThrow('CryptoService not initialized');
    });
    test('should have correct status', () => {
      const status = cryptoService.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.signatureService).toBe('ready');
      expect(status.timestampService).toBe('ready');
      expect(status.usingKMS).toBe(false);
    });
  });
  describe('Hash Generation', () => {
    test('should generate SHA-256 hash for object', () => {
      const data = { test: 'data', value: 123 };
      const hash = cryptoService.generateHash(data);
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // SHA-256 = 64 hex chars
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });
    test('should generate SHA-256 hash for string', () => {
      const data = 'test string';
      const hash = cryptoService.generateHash(data);
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });
    test('should generate consistent hashes', () => {
      const data = { test: 'data' };
      const hash1 = cryptoService.generateHash(data);
      const hash2 = cryptoService.generateHash(data);
      expect(hash1).toBe(hash2);
    });
    test('should generate different hashes for different data', () => {
      const data1 = { test: 'data1' };
      const data2 = { test: 'data2' };
      const hash1 = cryptoService.generateHash(data1);
      const hash2 = cryptoService.generateHash(data2);
      expect(hash1).not.toBe(hash2);
    });
  });
  describe('Hash Chain', () => {
    test('should generate hash chain for genesis record', () => {
      const record = {
        id: 'record-1',
        type: 'PLANTING',
        data: { plant: 'Cannabis', quantity: 100 },
        timestamp: '2025-05-21T10:00:00.000Z',
        userId: 'user-1',
      };
      const hash = cryptoService.generateHashChain(record, null);
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64);
    });
    test('should generate hash chain linking to previous record', () => {
      const record1 = {
        id: 'record-1',
        type: 'PLANTING',
        data: { plant: 'Cannabis' },
        timestamp: '2025-05-21T10:00:00.000Z',
        userId: 'user-1',
      };
      const record2 = {
        id: 'record-2',
        type: 'WATERING',
        data: { amount: '5L' },
        timestamp: '2025-05-21T11:00:00.000Z',
        userId: 'user-1',
      };
      const hash1 = cryptoService.generateHashChain(record1, null);
      const hash2 = cryptoService.generateHashChain(record2, hash1);
      expect(hash1).not.toBe(hash2);
      expect(hash2).toBeDefined();
    });
    test('should verify valid hash chain', () => {
      const record = {
        id: 'record-1',
        type: 'PLANTING',
        data: { plant: 'Cannabis' },
        timestamp: '2025-05-21T10:00:00.000Z',
        userId: 'user-1',
      };
      const hash = cryptoService.generateHashChain(record, null);
      const recordWithHash = { ...record, hash, previousHash: '0'.repeat(64) };
      const isValid = cryptoService.verifyHashChain(recordWithHash, null);
      expect(isValid).toBe(true);
    });
    test('should detect tampered hash chain', () => {
      const record = {
        id: 'record-1',
        type: 'PLANTING',
        data: { plant: 'Cannabis' },
        timestamp: '2025-05-21T10:00:00.000Z',
        userId: 'user-1',
      };
      const hash = cryptoService.generateHashChain(record, null);
      // Tamper with data
      const tamperedRecord = {
        ...record,
        data: { plant: 'Cannabis', quantity: 999 }, // Changed data
        hash,
      };
      const isValid = cryptoService.verifyHashChain(tamperedRecord, null);
      expect(isValid).toBe(false);
    });
  });
  describe('Digital Signatures', () => {
    test('should sign a hash', async () => {
      const data = { test: 'data' };
      const hash = cryptoService.generateHash(data);
      const signature = await cryptoService.sign(hash);
      expect(signature).toBeDefined();
      expect(signature.length).toBeGreaterThan(0);
      expect(/^[0-9a-f]+$/.test(signature)).toBe(true);
    });
    test('should verify valid signature', async () => {
      const data = { test: 'data' };
      const hash = cryptoService.generateHash(data);
      const signature = await cryptoService.sign(hash);
      const isValid = await cryptoService.verify(hash, signature);
      expect(isValid).toBe(true);
    });
    test('should reject invalid signature', async () => {
      const data = { test: 'data' };
      const hash = cryptoService.generateHash(data);
      const signature = await cryptoService.sign(hash);
      // Tamper with signature
      const tamperedSignature = signature.replace(/a/g, 'b');
      const isValid = await cryptoService.verify(hash, tamperedSignature);
      expect(isValid).toBe(false);
    });
    test('should reject signature for wrong hash', async () => {
      const data1 = { test: 'data1' };
      const data2 = { test: 'data2' };
      const hash1 = cryptoService.generateHash(data1);
      const hash2 = cryptoService.generateHash(data2);
      const signature1 = await cryptoService.sign(hash1);
      // Try to verify signature1 with hash2
      const isValid = await cryptoService.verify(hash2, signature1);
      expect(isValid).toBe(false);
    });
    test('should get public key', async () => {
      const publicKey = await cryptoService.getPublicKey();
      expect(publicKey).toBeDefined();
      expect(publicKey).toContain('BEGIN PUBLIC KEY');
      expect(publicKey).toContain('END PUBLIC KEY');
    });
  });
  describe('Complete Record Signing', () => {
    test('should sign complete record without timestamp', async () => {
      const record = {
        id: 'record-1',
        type: 'PLANTING',
        data: { plant: 'Cannabis', quantity: 100 },
        timestamp: '2025-05-21T10:00:00.000Z',
        userId: 'user-1',
      };
      const signedRecord = await cryptoService.signRecord(
        record,
        null,
        false, // No RFC 3161 timestamp
      );
      expect(signedRecord.hash).toBeDefined();
      expect(signedRecord.signature).toBeDefined();
      expect(signedRecord.previousHash).toBe('0'.repeat(64));
      expect(signedRecord.timestamp).toBe('2025-05-21T10:00:00.000Z'); // Original timestamp preserved
      expect(signedRecord.rfc3161Timestamp).toBeNull(); // No RFC 3161 timestamp
    });
    test('should sign complete record with timestamp', async () => {
      const record = {
        id: 'record-1',
        type: 'PLANTING',
        data: { plant: 'Cannabis' },
        timestamp: '2025-05-21T10:00:00.000Z',
        userId: 'user-1',
      };
      const signedRecord = await cryptoService.signRecord(
        record,
        null,
        true, // Include RFC 3161 timestamp
      );
      expect(signedRecord.hash).toBeDefined();
      expect(signedRecord.signature).toBeDefined();
      expect(signedRecord.timestamp).toBe('2025-05-21T10:00:00.000Z'); // Original timestamp preserved
      expect(signedRecord.rfc3161Timestamp).toBeDefined(); // RFC 3161 timestamp added
      expect(signedRecord.rfc3161Timestamp.timestamp).toBeDefined(); // Has timestamp field
    }, 10000); // Increase timeout for TSA request
    test('should verify valid signed record', async () => {
      const record = {
        id: 'record-1',
        type: 'PLANTING',
        data: { plant: 'Cannabis' },
        timestamp: '2025-05-21T10:00:00.000Z',
        userId: 'user-1',
      };
      const signedRecord = await cryptoService.signRecord(record, null, false);
      const verification = await cryptoService.verifyRecord(signedRecord, null);
      console.log('Signed record:', JSON.stringify(signedRecord, null, 2));
      console.log('Verification result:', JSON.stringify(verification, null, 2));
      expect(verification.valid).toBe(true);
      expect(verification.signature.valid).toBe(true);
      expect(verification.signature.hash.valid).toBe(true);
      expect(verification.signature.signature.valid).toBe(true);
    });
    test('should detect tampered record data', async () => {
      const record = {
        id: 'record-1',
        type: 'PLANTING',
        data: { plant: 'Cannabis', quantity: 100 },
        timestamp: '2025-05-21T10:00:00.000Z',
        userId: 'user-1',
      };
      const signedRecord = await cryptoService.signRecord(record, null, false);
      // Tamper with data
      signedRecord.data.quantity = 999;
      const verification = await cryptoService.verifyRecord(signedRecord, null);
      expect(verification.valid).toBe(false);
      expect(verification.signature.hash.valid).toBe(false);
    });
  });
  describe('Batch Operations', () => {
    test('should sign multiple records in batch', async () => {
      const records = [
        {
          id: 'record-1',
          type: 'PLANTING',
          data: { plant: 'Cannabis' },
          timestamp: '2025-05-21T10:00:00.000Z',
          userId: 'user-1',
        },
        {
          id: 'record-2',
          type: 'WATERING',
          data: { amount: '5L' },
          timestamp: '2025-05-21T11:00:00.000Z',
          userId: 'user-1',
        },
        {
          id: 'record-3',
          type: 'HARVEST',
          data: { weight: '2kg' },
          timestamp: '2025-05-21T12:00:00.000Z',
          userId: 'user-1',
        },
      ];
      const signedRecords = await cryptoService.signRecordsBatch(records, false);
      expect(signedRecords.length).toBe(3);
      expect(signedRecords[0].previousHash).toBe('0'.repeat(64)); // Genesis
      expect(signedRecords[1].previousHash).toBe(signedRecords[0].hash); // Chained
      expect(signedRecords[2].previousHash).toBe(signedRecords[1].hash); // Chained
    });
    test('should verify record chain', async () => {
      const records = [
        {
          id: 'record-1',
          type: 'PLANTING',
          data: { plant: 'Cannabis' },
          timestamp: '2025-05-21T10:00:00.000Z',
          userId: 'user-1',
        },
        {
          id: 'record-2',
          type: 'WATERING',
          data: { amount: '5L' },
          timestamp: '2025-05-21T11:00:00.000Z',
          userId: 'user-1',
        },
      ];
      const signedRecords = await cryptoService.signRecordsBatch(records, false);
      const verification = await cryptoService.verifyRecordChain(signedRecords);
      expect(verification.valid).toBe(true);
      expect(verification.totalRecords).toBe(2);
      expect(verification.validRecords).toBe(2);
      expect(verification.invalidRecords).toBe(0);
    });
    test('should detect break in chain', async () => {
      const records = [
        {
          id: 'record-1',
          type: 'PLANTING',
          data: { plant: 'Cannabis' },
          timestamp: '2025-05-21T10:00:00.000Z',
          userId: 'user-1',
        },
        {
          id: 'record-2',
          type: 'WATERING',
          data: { amount: '5L' },
          timestamp: '2025-05-21T11:00:00.000Z',
          userId: 'user-1',
        },
      ];
      const signedRecords = await cryptoService.signRecordsBatch(records, false);
      // Break the chain by tampering with data (which invalidates the hash)
      signedRecords[1].data.amount = '10L'; // Changed from 5L to 10L
      const verification = await cryptoService.verifyRecordChain(signedRecords);
      expect(verification.valid).toBe(false);
      expect(verification.invalidRecords).toBeGreaterThan(0);
    });
  });
  describe('Performance', () => {
    test('should sign 100 records in reasonable time', async () => {
      const records = Array.from({ length: 100 }, (_, i) => ({
        id: `record-${i}`,
        type: 'PLANTING',
        data: { plant: 'Cannabis', index: i },
        timestamp: new Date().toISOString(),
        userId: 'user-1',
      }));
      const startTime = Date.now();
      const signedRecords = await cryptoService.signRecordsBatch(records, false);
      const endTime = Date.now();
      const duration = endTime - startTime;
      expect(signedRecords.length).toBe(100);
      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds
      console.log(`Signed 100 records in ${duration}ms (${(duration / 100).toFixed(2)}ms/record)`);
    }, 10000);
    test('should verify 100 records in reasonable time', async () => {
      const records = Array.from({ length: 100 }, (_, i) => ({
        id: `record-${i}`,
        type: 'PLANTING',
        data: { plant: 'Cannabis', index: i },
        timestamp: new Date().toISOString(),
        userId: 'user-1',
      }));
      const signedRecords = await cryptoService.signRecordsBatch(records, false);
      const startTime = Date.now();
      const verification = await cryptoService.verifyRecordChain(signedRecords);
      const endTime = Date.now();
      const duration = endTime - startTime;
      expect(verification.valid).toBe(true);
      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds
      console.log(
        `Verified 100 records in ${duration}ms (${(duration / 100).toFixed(2)}ms/record)`,
      );
    }, 10000);
  });
  describe('Edge Cases', () => {
    test('should handle empty data', async () => {
      const record = {
        id: 'record-1',
        type: 'PLANTING',
        data: {},
        timestamp: '2025-05-21T10:00:00.000Z',
        userId: 'user-1',
      };
      const signedRecord = await cryptoService.signRecord(record, null, false);
      expect(signedRecord.hash).toBeDefined();
      expect(signedRecord.signature).toBeDefined();
    });
    test('should handle large data', async () => {
      const largeData = {
        field1: 'x'.repeat(10000),
        field2: 'y'.repeat(10000),
        field3: 'z'.repeat(10000),
      };
      const record = {
        id: 'record-1',
        type: 'PLANTING',
        data: largeData,
        timestamp: '2025-05-21T10:00:00.000Z',
        userId: 'user-1',
      };
      const signedRecord = await cryptoService.signRecord(record, null, false);
      expect(signedRecord.hash).toBeDefined();
      expect(signedRecord.signature).toBeDefined();
    });
    test('should handle special characters', async () => {
      const record = {
        id: 'record-1',
        type: 'PLANTING',
        data: {
          text: '🌱 Cannabis ภาษาไทย ä¸­æ–‡ Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©',
        },
        timestamp: '2025-05-21T10:00:00.000Z',
        userId: 'user-1',
      };
      const signedRecord = await cryptoService.signRecord(record, null, false);
      const verification = await cryptoService.verifyRecord(signedRecord, null);
      expect(verification.valid).toBe(true);
    });
  });
});
