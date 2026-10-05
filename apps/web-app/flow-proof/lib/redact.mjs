/**
 * PII redaction for anything captured off the wire (request/response bodies,
 * headers) before it is written into evidence/ or report.html — the project rules
 * 3.3 (no secret/PII in reports). Deliberately conservative: redacts by KEY
 * name (case-insensitive) for structured JSON, and by regex for raw text
 * (national ID, email, phone, bearer/JWT-shaped tokens).
 */
const SENSITIVE_KEYS = new Set([
  'password', 'confirmpassword', 'confirm_password', 'newpassword',
  'idcard', 'nationalid', 'national_id', 'identifier', 'citizenid',
  'authorization', 'accesstoken', 'refreshtoken', 'token', 'jwt',
  'cookie', 'set-cookie', 'apikey', 'api_key', 'secret',
  'phonenumber', 'phone', 'email',
]);

const THAI_ID_RE = /\b\d{13}\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\b0\d{9}\b/g;
const JWT_RE = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g;

export function redactString(s) {
  if (typeof s !== 'string') return s;
  // EMAIL before THAI_ID/PHONE: an email local-part that happens to contain
  // 10-13 digits (e.g. a timestamp-based test fixture address) would
  // otherwise get partially eaten by the digit-run patterns first, leaving a
  // malformed "user.[REDACTED_ID]@domain" instead of one clean
  // [REDACTED_EMAIL] — still no leak either way, but this order is correct.
  return s
    .replace(JWT_RE, '[REDACTED_TOKEN]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(THAI_ID_RE, '[REDACTED_ID]')
    .replace(PHONE_RE, '[REDACTED_PHONE]');
}

function redactValue(value, key) {
  if (key && SENSITIVE_KEYS.has(String(key).toLowerCase())) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, undefined));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(v, k);
    return out;
  }
  return value;
}

/** Redacts a parsed-JSON body, a plain string body, or undefined/null. Never throws — a body it cannot parse is returned as a length-only placeholder rather than risking a PII leak. */
export function redactBody(body) {
  if (body === undefined || body === null) return body;
  if (typeof body === 'object') return redactValue(body, undefined);
  if (typeof body === 'string') {
    try {
      return redactValue(JSON.parse(body), undefined);
    } catch {
      return redactString(body).slice(0, 2000);
    }
  }
  return '[unrecognized body type]';
}

export function redactHeaders(headers) {
  if (!headers) return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}
