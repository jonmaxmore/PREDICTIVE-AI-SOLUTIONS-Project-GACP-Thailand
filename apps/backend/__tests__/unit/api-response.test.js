const {
  resolveRequestId,
  responseMeta,
  sendErrorResponse,
  sendSuccessResponse,
  safeErrorMessage,
  isValidUUID,
  classifyPrismaError,
  respondError,
} = require('../../shared/api-response');

function makePrismaError(name, code) {
  const e = new Error('verbose prisma internals at /app/node_modules/@prisma/client');
  e.name = name;
  if (code) { e.code = code; }
  return e;
}

function createMockRes() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    },
  };
}

describe('api-response', () => {
  it('reuses request id from header when req.id is missing', () => {
    const requestId = resolveRequestId({
      headers: { 'x-request-id': 'req-123' },
    });
    expect(requestId).toBe('req-123');
  });

  it('builds success response with metadata', () => {
    const req = {
      id: 'req-999',
      method: 'GET',
      originalUrl: '/api/demo',
      headers: {},
    };
    const res = createMockRes();

    sendSuccessResponse(res, req, {
      data: { ok: true },
      message: 'Done',
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.message).toBe('Done');
    expect(res.payload.data).toEqual({ ok: true });
    expect(res.payload.requestId).toBe('req-999');
    expect(res.payload.path).toBe('/api/demo');
  });

  it('builds error response with fallback thai message', () => {
    const req = {
      id: 'req-500',
      method: 'POST',
      originalUrl: '/api/demo',
      headers: {},
    };
    const res = createMockRes();

    sendErrorResponse(res, req, {
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
    });

    expect(res.statusCode).toBe(401);
    expect(res.payload.success).toBe(false);
    expect(res.payload.code).toBe('UNAUTHORIZED');
    expect(res.payload.error).toBe('Unauthorized');
    expect(res.payload.messageTh).toBe('ไม่มีสิทธิ์เข้าถึง');
    expect(res.payload.requestId).toBe('req-500');
  });

  describe('resolveRequestId — fallback chain', () => {
    it('prefers req.id when present', () => {
      expect(resolveRequestId({
        id: 'req-from-id',
        headers: { 'x-request-id': 'req-from-header' },
      })).toBe('req-from-id');
    });

    it('falls back to x-request-id header when req.id is missing', () => {
      expect(resolveRequestId({
        headers: { 'x-request-id': 'req-from-header' },
      })).toBe('req-from-header');
    });

    it('generates a UUID when neither req.id nor header is set', () => {
      const id = resolveRequestId({ headers: {} });
      expect(isValidUUID(id)).toBe(true);
    });

    it('handles missing req / headers gracefully (never throws)', () => {
      const id = resolveRequestId(undefined);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('rejects non-string header value (falls through to UUID)', () => {
      // Headers occasionally arrive as arrays from proxies; the helper
      // should not return the array — it should generate a fresh UUID.
      const id = resolveRequestId({ headers: { 'x-request-id': ['a', 'b'] } });
      expect(isValidUUID(id)).toBe(true);
    });
  });

  describe('responseMeta', () => {
    it('returns documented shape with requestId + timestamp + path + method', () => {
      const meta = responseMeta({
        id: 'req-1',
        method: 'PATCH',
        originalUrl: '/api/x',
        headers: {},
      });
      expect(meta.requestId).toBe('req-1');
      expect(meta.method).toBe('PATCH');
      expect(meta.path).toBe('/api/x');
      expect(typeof meta.timestamp).toBe('string');
    });

    it('falls back from originalUrl to url', () => {
      const meta = responseMeta({ url: '/raw', headers: {} });
      expect(meta.path).toBe('/raw');
    });

    it('returns null path/method when neither is set', () => {
      const meta = responseMeta({ headers: {} });
      expect(meta.path).toBeNull();
      expect(meta.method).toBeNull();
    });
  });

  describe('safeErrorMessage — security sanitizer', () => {
    // This helper decides what error text is exposed to end users.
    // A regression that adds an unsafe phrase or drops a safe one
    // changes the security posture of every controller that calls
    // safeErrorMessage(error) on its catch block.

    it('passes messages containing a known-safe phrase', () => {
      expect(safeErrorMessage(new Error('user not found'))).toBe('user not found');
      expect(safeErrorMessage(new Error('Invalid credentials'))).toBe('Invalid credentials');
      expect(safeErrorMessage(new Error('email already exists'))).toBe('email already exists');
      expect(safeErrorMessage(new Error('Token expired')))
        .toBe('Token expired');
      expect(safeErrorMessage(new Error('Too many requests')))
        .toBe('Too many requests');
    });

    it('replaces messages without a safe phrase with the fallback', () => {
      // Internal-looking messages — these MUST NOT reach the client.
      expect(safeErrorMessage(new Error('PrismaClientKnownRequestError P2002')))
        .toBe('An error occurred while processing your request');
      expect(safeErrorMessage(new Error('connection refused 127.0.0.1:5432')))
        .toBe('An error occurred while processing your request');
      expect(safeErrorMessage(new Error('SECRET_KEY=abc123 leaked')))
        .toBe('An error occurred while processing your request');
    });

    it('honors custom fallback', () => {
      const out = safeErrorMessage(
        new Error('internal'),
        'Custom fallback message',
      );
      expect(out).toBe('Custom fallback message');
    });

    it('handles null / undefined / empty input via fallback', () => {
      expect(safeErrorMessage(null)).toBe('An error occurred while processing your request');
      expect(safeErrorMessage(undefined)).toBe('An error occurred while processing your request');
      expect(safeErrorMessage('')).toBe('An error occurred while processing your request');
      expect(safeErrorMessage({ message: '' })).toBe('An error occurred while processing your request');
    });

    it('accepts plain string input (not just Error instances)', () => {
      expect(safeErrorMessage('account is disabled')).toBe('account is disabled');
      expect(safeErrorMessage('something garbage')).toBe('An error occurred while processing your request');
    });

    it('case-insensitive phrase matching', () => {
      // 'Forbidden' (capitalized) → matches 'forbidden' phrase.
      expect(safeErrorMessage(new Error('Forbidden')))
        .toBe('Forbidden');
      expect(safeErrorMessage(new Error('VALIDATION FAILED')))
        .toBe('VALIDATION FAILED');
    });
  });

  describe('classifyPrismaError — Prisma → HTTP status mapping', () => {
    it('maps PrismaClientValidationError (bad input shape) to 400', () => {
      expect(classifyPrismaError(makePrismaError('PrismaClientValidationError')))
        .toEqual({ status: 400, code: 'VALIDATION_ERROR' });
    });

    it('maps P2025 (record not found) to 404', () => {
      expect(classifyPrismaError(makePrismaError('PrismaClientKnownRequestError', 'P2025')))
        .toEqual({ status: 404, code: 'NOT_FOUND' });
    });

    it('maps P2002 (unique) and P2003 (FK) to 409', () => {
      expect(classifyPrismaError(makePrismaError('PrismaClientKnownRequestError', 'P2002')))
        .toEqual({ status: 409, code: 'CONFLICT' });
      expect(classifyPrismaError(makePrismaError('PrismaClientKnownRequestError', 'P2003')))
        .toEqual({ status: 409, code: 'CONFLICT' });
    });

    it('maps malformed-value codes (P2000/P2023…) to 400', () => {
      expect(classifyPrismaError(makePrismaError('PrismaClientKnownRequestError', 'P2023')))
        .toEqual({ status: 400, code: 'VALIDATION_ERROR' });
      expect(classifyPrismaError(makePrismaError('PrismaClientKnownRequestError', 'P2000')))
        .toEqual({ status: 400, code: 'VALIDATION_ERROR' });
    });

    it('returns null for unknown Pxxxx and for ordinary errors (→ caller 500)', () => {
      expect(classifyPrismaError(makePrismaError('PrismaClientKnownRequestError', 'P9999'))).toBeNull();
      expect(classifyPrismaError(new Error('boom'))).toBeNull();
      expect(classifyPrismaError(null)).toBeNull();
      expect(classifyPrismaError('a string')).toBeNull();
    });

    it('recognises a bare Pxxxx code even without the Prisma error name', () => {
      const e = new Error('x'); e.code = 'P2025';
      expect(classifyPrismaError(e)).toEqual({ status: 404, code: 'NOT_FOUND' });
    });
  });

  describe('respondError — single catch-block exit point', () => {
    const req = { id: 'req-1', method: 'POST', originalUrl: '/api/x', headers: {} };

    it('maps a Prisma validation error to 400 and never leaks internals', () => {
      const res = createMockRes();
      respondError(res, req, makePrismaError('PrismaClientValidationError'), { message: 'fallback' });
      expect(res.statusCode).toBe(400);
      expect(res.payload.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.payload).toLowerCase()).not.toContain('node_modules');
    });

    it('maps P2025 to 404', () => {
      const res = createMockRes();
      respondError(res, req, makePrismaError('PrismaClientKnownRequestError', 'P2025'));
      expect(res.statusCode).toBe(404);
      expect(res.payload.code).toBe('NOT_FOUND');
    });

    it('falls back to 500 for a genuine server error', () => {
      const res = createMockRes();
      respondError(res, req, new Error('kaboom'), { message: 'Failed to do thing' });
      expect(res.statusCode).toBe(500);
      expect(res.payload.code).toBe('INTERNAL_SERVER_ERROR');
    });

    it('honours an explicit non-Prisma fallback status', () => {
      const res = createMockRes();
      respondError(res, req, new Error('nope'), { status: 400, message: 'bad request' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('isValidUUID', () => {
    it('accepts canonical UUID v4', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUUID('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    });

    it('accepts uppercase + mixed case', () => {
      expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
      expect(isValidUUID('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
    });

    it('trims surrounding whitespace before matching', () => {
      expect(isValidUUID('  550e8400-e29b-41d4-a716-446655440000  ')).toBe(true);
    });

    it('rejects non-UUID strings, partials, and non-string input', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false);
      expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);          // truncated
      expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false); // no dashes
      expect(isValidUUID('')).toBe(false);
      expect(isValidUUID(null)).toBe(false);
      expect(isValidUUID(undefined)).toBe(false);
      expect(isValidUUID(123)).toBe(false);
    });
  });
});
