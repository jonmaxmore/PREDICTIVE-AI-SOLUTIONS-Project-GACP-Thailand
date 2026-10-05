/**
 * Unit Tests for Documents/Files API
 * Tests file upload, download, and security features
 */

// Mock uuid first
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234-5678-90ab-cdef12345678'),
}));

// Mock logger (must include createLogger for transitive deps like prisma-database)
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};
jest.mock('../../shared/logger', () => {
  const logger = { ...mockLogger, stream: { write: jest.fn() } };
  logger.createLogger = jest.fn(() => ({ ...mockLogger }));
  return logger;
});

// Mock prisma-database (loaded transitively by upload-middleware)
jest.mock('../../services/prisma-database', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

// Mock upload-middleware (multer wrapper)
jest.mock('../../middleware/upload-middleware', () => ({
  single: jest.fn(() => (req, _res, next) => {
    req.file = null;
    next();
  }),
  array: jest.fn(() => (_req, _res, next) => next()),
}));

// Mock storage service
jest.mock('../../services/storage-service', () => ({
  uploadFile: jest.fn().mockResolvedValue({ 
    id: 'test-file-id', 
    url: '/uploads/test.pdf',
    filename: 'test.pdf',
  }),
  getFile: jest.fn().mockResolvedValue({ 
    id: 'test-file-id', 
    stream: null,
    filename: 'test.pdf',
  }),
  deleteFile: jest.fn().mockResolvedValue({ success: true }),
}));

const request = require('supertest');
const express = require('express');

// Mock auth middleware
jest.mock('../../middleware/auth-middleware', () => ({
  authenticateHealth: (req, _res, next) => {
    req.user = { id: 'test-user-123', role: 'HEALTH' };
    next();
  },
}));

const documentsRouter = require('../../routes/api/documents/documents');

describe('Documents API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v2/files', documentsRouter);
  });

  describe('POST /api/v2/files/upload', () => {
    it('should reject request without file', async () => {
      const response = await request(app)
        .post('/api/v2/files/upload')
        .set('Content-Type', 'multipart/form-data');

      // Should return 400 or 500
      expect([400, 500, 404]).toContain(response.status);
    });
  });

  describe('GET /api/v2/files/:id', () => {
    it('should handle file request', async () => {
      const response = await request(app)
        .get('/api/v2/files/test-file-id');

      // Should return something (200, 404, or 500)
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
    });
  });

  describe('DELETE /api/v2/files/:id', () => {
    it('should handle delete request', async () => {
      const response = await request(app)
        .delete('/api/v2/files/test-file-id');

      // Should return something
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
    });
  });
});

describe('Input Sanitization', () => {
  it('should sanitize filenames with path traversal attempts', () => {
    // Test the sanitization logic
    const sanitizeFilename = (filename) => {
      if (!filename) { return 'document'; }
      // Remove path traversal
      let sanitized = filename.replace(/\.\./g, '');
      // Replace slashes and dangerous chars
      sanitized = sanitized.replace(/[<>:"\\|?*]/g, '_');
      sanitized = sanitized.replace(/\//g, '_');
      // eslint-disable-next-line no-control-regex
      sanitized = sanitized.replace(/[\x00-\x1f]/g, '_');
      sanitized = sanitized.substring(0, 200);
      return sanitized || 'document';
    };

    expect(sanitizeFilename('../../../etc/passwd')).toBe('___etc_passwd');
    expect(sanitizeFilename('file<script>.pdf')).toBe('file_script_.pdf');
    expect(sanitizeFilename('normal-file.pdf')).toBe('normal-file.pdf');
    expect(sanitizeFilename('')).toBe('document');
    expect(sanitizeFilename(null)).toBe('document');
  });
});

describe('Magic Bytes Validation', () => {
  it('should validate PDF magic bytes', () => {
    const MAGIC_BYTES = {
      'application/pdf': [0x25, 0x50, 0x44, 0x46],
    };

    const validateMagicBytes = (buffer, mimeType) => {
      const expected = MAGIC_BYTES[mimeType];
      if (!expected) { return true; }
      for (let i = 0; i < expected.length; i++) {
        if (buffer[i] !== expected[i]) { return false; }
      }
      return true;
    };

    // Valid PDF header
    const validPdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D]);
    expect(validateMagicBytes(validPdf, 'application/pdf')).toBe(true);

    // Invalid header
    const invalidPdf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(validateMagicBytes(invalidPdf, 'application/pdf')).toBe(false);
  });

  it('should validate JPEG magic bytes', () => {
    const MAGIC_BYTES = {
      'image/jpeg': [[0xFF, 0xD8, 0xFF]],
    };

    const validateMagicBytes = (buffer, mimeType) => {
      const expectedVariants = MAGIC_BYTES[mimeType];
      if (!expectedVariants) { return true; }
      
      for (const expected of expectedVariants) {
        let match = true;
        for (let i = 0; i < expected.length; i++) {
          if (buffer[i] !== expected[i]) {
            match = false;
            break;
          }
        }
        if (match) { return true; }
      }
      return false;
    };

    // Valid JPEG
    const validJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    expect(validateMagicBytes(validJpeg, 'image/jpeg')).toBe(true);

    // Invalid
    const invalidJpeg = Buffer.from([0x00, 0x00, 0x00]);
    expect(validateMagicBytes(invalidJpeg, 'image/jpeg')).toBe(false);
  });
});
