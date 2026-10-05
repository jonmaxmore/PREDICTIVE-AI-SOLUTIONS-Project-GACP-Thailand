const crypto = require('crypto');

const DEFAULT_ERROR_MESSAGES = {
  INTERNAL_SERVER_ERROR: {
    en: 'Internal server error',
    th: 'เกิดข้อผิดพลาดภายในระบบ',
  },
  VALIDATION_ERROR: {
    en: 'Validation failed',
    th: 'ข้อมูลไม่ถูกต้อง',
  },
  UNAUTHORIZED: {
    en: 'Unauthorized',
    th: 'ไม่มีสิทธิ์เข้าถึง',
  },
  FORBIDDEN: {
    en: 'Forbidden',
    th: 'ไม่ได้รับอนุญาตให้ดำเนินการ',
  },
  // provider-E2E carpet 2026-07-09 (LOW): role-middleware throws
  // AuthorizationError (code AUTHORIZATION_ERROR) on a 403 role denial, but this
  // code was absent from the map → messageTh fell back to INTERNAL_SERVER_ERROR's
  // "เกิดข้อผิดพลาดภายในระบบ" (a misleading "internal system error" for a plain
  // permission denial). Map it to the correct Thai.
  AUTHORIZATION_ERROR: {
    en: 'Access denied',
    th: 'ไม่มีสิทธิ์ดำเนินการ (บทบาทของคุณไม่ได้รับอนุญาต)',
  },
  NOT_FOUND: {
    en: 'Resource not found',
    th: 'ไม่พบข้อมูลที่ต้องการ',
  },
  // R2 Task 8 (spec 2026-09-30-remove-workspace-mode §3.6): a new draft names its
  // holder; without one the door refuses. The Thai copy is the spec's, verbatim.
  APPLICATION_HOLDER_REQUIRED: {
    en: 'No holder was chosen for this application. Choose it at step 1; if this page has been open for a while, reload it first',
    th: 'ยังไม่ได้เลือกว่าจะยื่นในนามใคร กรุณาเลือกที่ขั้นตอนที่ 1 หากเปิดหน้านี้ค้างไว้ ให้โหลดหน้าใหม่ก่อน',
  },
  // One renewal or replacement per certificate at a time: the catalogue's copy, read
  // lazily (the catalogue is large and this file loads early).
  get RENEWAL_ALREADY_IN_PROGRESS() {
    const row = require('./error-codes').ERROR_CODES.RENEWAL_ALREADY_IN_PROGRESS;
    return { en: row.messageEn, th: row.messageTh };
  },
  CONFLICT: {
    en: 'Request conflicts with the current state of the resource',
    th: 'คำขอขัดแย้งกับข้อมูลที่มีอยู่',
  },
  REQUEST_FAILED: {
    en: 'Request failed',
    th: 'คำขอไม่สำเร็จ',
  },
  INVALID_CREDENTIALS: {
    en: 'Invalid username or password',
    th: 'ไม่พบผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง',
  },
  MISSING_CREDENTIALS: {
    en: 'Please provide identifier and password',
    th: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน',
  },
  CSRF_MISMATCH: {
    en: 'Invalid CSRF token',
    th: 'โทเค็นความปลอดภัยไม่ถูกต้อง',
  },
  WEBHOOK_PROCESSING_FAILED: {
    en: 'Webhook callback accepted but processing failed',
    th: 'ระบบรับ callback แล้ว แต่ประมวลผลไม่สำเร็จ',
  },
  // SECU-02 — middleware/refuse-multipart.js. Mirrored in shared/error-codes.js.
  UNSUPPORTED_MEDIA_TYPE: {
    en: 'Unsupported request content type; send this request as JSON',
    th: 'ระบบไม่รองรับรูปแบบข้อมูลที่ส่งมา กรุณาส่งข้อมูลเป็น JSON',
  },
};

function resolveRequestId(req) {
  if (req?.id) {
    return req.id;
  }

  const headerRequestId = req?.headers?.['x-request-id'];
  if (headerRequestId && typeof headerRequestId === 'string') {
    return headerRequestId;
  }

  return crypto.randomUUID();
}

function responseMeta(req) {
  return {
    requestId: resolveRequestId(req),
    timestamp: new Date().toISOString(),
    path: req?.originalUrl || req?.url || null,
    method: req?.method || null,
  };
}

function sendSuccessResponse(
  res,
  req,
  {
    status = 200,
    message = null,
    data = null,
    extra = {},
  } = {},
) {
  return res.status(status).json({
    success: true,
    ...(message ? { message } : {}),
    ...(data !== null ? { data } : {}),
    ...responseMeta(req),
    ...extra,
  });
}

function sendErrorResponse(
  res,
  req,
  {
    status = 500,
    code = 'INTERNAL_SERVER_ERROR',
    message = null,
    messageTh = null,
    details = null,
    extra = {},
  } = {},
) {
  // ENTITY_PERMISSION_DENIED has ONE answer at every door, whatever the thrower wrote
  // (R2 Task 10 round 2): the catalogue copy, the same body entityPermissionDeniedBody
  // builds. Required lazily: the catalogue module is large and this file loads early.
  if (code === 'ENTITY_PERMISSION_DENIED') {
    const { entityPermissionDeniedBody } = require('./entity-permission-denied');
    return res.status(status).json({
      ...entityPermissionDeniedBody(extra?.permission),
      ...(details ? { details } : {}),
      ...responseMeta(req),
    });
  }
  const fallbackMessages = DEFAULT_ERROR_MESSAGES[code] || DEFAULT_ERROR_MESSAGES.INTERNAL_SERVER_ERROR;
  const resolvedMessage = message || fallbackMessages.en;
  const resolvedMessageTh = messageTh || fallbackMessages.th;

  return res.status(status).json({
    success: false,
    code,
    error: resolvedMessage,
    message: resolvedMessage,
    messageTh: resolvedMessageTh,
    ...(details ? { details } : {}),
    ...responseMeta(req),
    ...extra,
  });
}

/**
 * Known-safe error messages that can be shown to end users.
 * Any message NOT on this list will be replaced with a generic error.
 */
const SAFE_ERROR_PHRASES = [
  'not found', 'unauthorized', 'forbidden', 'already paid', 'already exists',
  'already fully paid', 'validation', 'required', 'invalid', 'not eligible',
  'too many', 'expired', 'disabled', 'missing', 'phase',
];

/**
 * Substrings that, if present, indicate the message leaks internal details
 * (ORM/Prisma internals, stack frames, file paths, SQL, schema identifiers).
 * Messages matching any of these are ALWAYS replaced with the fallback,
 * even if they also happen to contain a safe phrase.
 */
const UNSAFE_ERROR_INDICATORS = [
  'prisma', 'prismaclient', 'sqlstate', 'sequelize',
  'pg_', 'postgres', 'mysql', 'sqlite',
  'at object.', 'at async ', 'at process.', 'at /', 'at \\',
  'node_modules', '/app/', '\\app\\', 'c:\\', '/usr/', '/var/',
  'foreign key', 'unique constraint', 'constraint failed',
  '.js:', '.ts:', 'eacces', 'econnrefused', 'enotfound',
  'invocation in', 'invalid `',
];

/**
 * Maximum length of a client-safe error message. Anything longer is
 * almost certainly a stack trace or serialized internal payload.
 */
const SAFE_ERROR_MAX_LENGTH = 160;

/**
 * Sanitize an error message for client-facing response.
 * Only allows short messages matching the known-safe allowlist AND not
 * matching any unsafe indicator; everything else falls back to a generic message.
 */
function safeErrorMessage(error, fallback = 'An error occurred while processing your request') {
  const msg = String(error?.message || error || '').trim();
  if (!msg) {return fallback;}
  if (msg.length > SAFE_ERROR_MAX_LENGTH) {return fallback;}
  if (/[\r\n]/.test(msg)) {return fallback;}
  const lower = msg.toLowerCase();
  if (UNSAFE_ERROR_INDICATORS.some(needle => lower.includes(needle))) {
    return fallback;
  }
  if (SAFE_ERROR_PHRASES.some(phrase => lower.includes(phrase))) {
    return msg;
  }
  return fallback;
}

/**
 * Validate UUID v4 format
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(value) {
  return UUID_REGEX.test(String(value || '').trim());
}

/**
 * Map a thrown Prisma error to a client-appropriate HTTP status + code.
 *
 * Route handlers historically did `catch (e) { res.status(500) }`, which turned
 * every Prisma-level error into a 500 — including ordinary client mistakes:
 *   - a wrong-typed body reaches the query   -> PrismaClientValidationError
 *   - update/delete against a non-existent id -> known-request error P2025
 * Those are 400 / 404 conditions, not server faults. This classifier lets the
 * shared `respondError` (and the global error handler) return the correct
 * status without each handler hand-rolling its own Prisma introspection.
 *
 * Detection is by `error.name` / `error.code` (the Prisma error surface) so we
 * do not have to import @prisma/client runtime internals, which differ between
 * the generated client location and the bundled runtime.
 *
 * @param {*} error
 * @returns {{status:number, code:string}|null} null when the error is NOT a
 *   recognised client-caused Prisma condition (caller should treat it as 500).
 */
function classifyPrismaError(error) {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const name = String(error.name || '');

  // Malformed query/input shape (e.g. wrong scalar type, unknown field).
  if (name === 'PrismaClientValidationError') {
    return { status: 400, code: 'VALIDATION_ERROR' };
  }

  // Known request errors carry a Pxxxx code.
  const code = String(error.code || '');
  if (name === 'PrismaClientKnownRequestError' || /^P\d{4}$/.test(code)) {
    switch (code) {
      case 'P2025': // record required for the operation was not found
        return { status: 404, code: 'NOT_FOUND' };
      case 'P2002': // unique constraint violation
        return { status: 409, code: 'CONFLICT' };
      case 'P2003': // foreign-key constraint violation
        return { status: 409, code: 'CONFLICT' };
      case 'P2000': // value too long for the column
      case 'P2005': // invalid value stored for the field's type
      case 'P2006': // provided value invalid for the field
      case 'P2007': // data validation error
      case 'P2011': // null constraint violation
      case 'P2012': // missing required value
      case 'P2014': // change would violate a required relation
      case 'P2023': // inconsistent column data (e.g. malformed UUID)
        return { status: 400, code: 'VALIDATION_ERROR' };
      default:
        return null; // unknown Pxxxx -> treat as a server fault
    }
  }

  return null;
}

/**
 * Single exit point for a caught error inside a route handler.
 *
 * Prisma client-caused conditions are mapped to 400/404/409 via
 * {@link classifyPrismaError}; anything else falls back to the caller-supplied
 * status (default 500) and is logged. This replaces the bare
 * `res.status(500).json({ success:false, ... })` pattern so a bad input or a
 * missing record no longer surfaces as a server error.
 *
 * @param {import('express').Response} res
 * @param {import('express').Request} req
 * @param {*} error              the caught error
 * @param {object} [opts]
 * @param {number} [opts.status=500]   fallback status when not Prisma-mapped
 * @param {string} [opts.code]         fallback error code
 * @param {string} [opts.message]      fallback client message (sanitised)
 * @param {string} [opts.messageTh]    fallback Thai message
 * @param {string} [opts.label]        log label (e.g. '[Quotes] create')
 * @param {boolean} [opts.log=true]    log non-mapped (i.e. 5xx) errors
 */
function respondError(res, req, error, opts = {}) {
  const mapped = classifyPrismaError(error);
  if (mapped) {
    return sendErrorResponse(res, req, {
      status: mapped.status,
      code: mapped.code,
      message: safeErrorMessage(error, DEFAULT_ERROR_MESSAGES[mapped.code]?.en),
    });
  }

  // Honour an explicit HTTP status carried on the thrown error (services may
  // throw `Object.assign(new Error(msg), { statusCode: 404|501|… })`).
  const explicitStatus = Number.isInteger(error?.statusCode)
    ? error.statusCode
    : (Number.isInteger(error?.status) ? error.status : null);
  if (explicitStatus && explicitStatus >= 400 && explicitStatus < 500) {
    // Honour a machine-readable `error.code` the thrower attached (e.g.
    // APPLICATION_NOT_EDITABLE) so 4xx client errors surface their real code
    // instead of a generic REQUEST_FAILED. opts.code still wins when the caller
    // set one explicitly; this only fills the gap.
    const explicitCode = typeof error?.code === 'string' && !/^P\d{4}$/.test(error.code)
      ? error.code
      : null;
    return sendErrorResponse(res, req, {
      status: explicitStatus,
      code: opts.code || explicitCode || (explicitStatus === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED'),
      message: opts.message || safeErrorMessage(error),
    });
  }

  const status = Number.isInteger(opts.status) ? opts.status : (explicitStatus || 500);
  if (opts.log !== false && status >= 500) {
    // Lazy require avoids any shared/ ↔ shared/ load-order coupling.
    try {
      require('./logger').error(`${opts.label || 'Request'} error:`, error);
    } catch { /* logger optional */ }
  }
  return sendErrorResponse(res, req, {
    status,
    code: opts.code || (status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED'),
    message: opts.message || safeErrorMessage(error),
    messageTh: opts.messageTh || null,
  });
}

module.exports = {
  DEFAULT_ERROR_MESSAGES,
  resolveRequestId,
  responseMeta,
  sendSuccessResponse,
  sendErrorResponse,
  safeErrorMessage,
  isValidUUID,
  classifyPrismaError,
  respondError,
};
