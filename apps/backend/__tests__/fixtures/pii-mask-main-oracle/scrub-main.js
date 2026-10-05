// VERBATIM copy of packages/error-reporting/src/scrub.js at main a0ee3b68 — the test oracle
// for pii-mask-main-oracle.test.js. Never edit: it pins what main masked.
'use strict';

/**
 * Personal-data scrubbing for error reports — ONE module for the backend and the
 * web app.
 *
 * Sentry was re-added 2026-10-02 by operator decision, with this scrubbing as the
 * first-class requirement (PDPA). It works in three layers, the same on both
 * sides:
 *   1. `sentryScrubOptions().dataCollection` — the SDK does not collect cookies,
 *      bodies, query strings, user info or local variables in the first place;
 *   2. `beforeSend` / `beforeSendTransaction` / `beforeBreadcrumb` — scrubEvent and
 *      scrubBreadcrumb below;
 *   3. `scrubbingTransport` — every envelope, whatever produced it (sessions,
 *      streamed spans), is scrubbed again on its way out.
 *
 * ── Why CommonJS + JSDoc, not TypeScript ─────────────────────────────────────
 * Same reason as packages/validation/src/thai-id-checksum.js: the backend is
 * CommonJS Node running straight off the pnpm workspace symlink, the web app is
 * TypeScript compiled by Next. A .ts module is invisible to the first. CommonJS
 * is the one shape both halves load, so the rule lives here once.
 *
 * ── What it removes ─────────────────────────────────────────────────────────
 *   request   body (`data`), cookies, `env`, the whole query string (on every
 *             route — a search box sends names), the URL fragment, and every header
 *             not on HEADER_ALLOWLIST (so Authorization, Cookie, X-CSRF-Token,
 *             X-*-Id are gone). Referer / Origin are cut to origin + path.
 *   URLs      anywhere (breadcrumbs, spans, trace data, free text): no query
 *             string; a path segment that carries Thai text, whitespace or a
 *             pattern below is replaced.
 *   user      everything but `id`, and `id` only when it is a UUID.
 *   strings   in message, logentry, exception values, transaction names, span
 *             descriptions, breadcrumbs, extra, contexts and tags:
 *               - Prisma client errors cut to operation + summary line (the
 *                 argument tree echoes every value passed)
 *               - Postgres `DETAIL:`, `Key (col)=(…)`, `Failing row contains (…)`
 *               - 13-digit Thai national ID / tax ID, ASCII or Thai digits, any
 *                 single `-` `.` or space between digits
 *               - email addresses (also %40-encoded)
 *               - Thai phone numbers (0x / +66, mobile and landline; `-` `.` space
 *                 and brackets; Thai digits)
 *               - JWT-shaped tokens, Bearer / Basic credentials
 *               - Stripe pi_ / cs_ / seti_ ids and client secrets, sk_ / rk_ keys,
 *                 whsec_ webhook secrets
 *               - the password in a postgres:// URL
 *               - `password=…`, `token=…`, `secret=…`-style pairs
 *   keys      any value whose KEY names a credential or a personal field
 *             (isSensitiveKey: contains name / address / phone / email / tax /
 *             juristic / registration / … or is a word like pid / dob) is
 *             replaced whole. Held to the Prisma schema by
 *             apps/backend/__tests__/unit/sentry-pii-schema-fields.test.js.
 *   tags      a tag value with Thai text is replaced (tags are labels).
 *   breadcrumbs  console breadcrumbs that carried any pattern, or Thai free text,
 *             are dropped; fetch / xhr / http breadcrumbs lose their bodies and
 *             headers.
 *
 * ── What it cannot see ───────────────────────────────────────────────────────
 * A person's NAME inside free text ("ไม่พบ นายสมชาย ใจดี") has no shape a regex
 * can find. Names are removed where they sit in a named field (firstName,
 * fullName, user.username, request bodies), not inside prose. Error messages
 * must not be built from names; Sentry's server-side Data Scrubber is the second
 * layer (docs/operations/sentry-error-tracking.md).
 *
 * ── Failure ─────────────────────────────────────────────────────────────────
 * If scrubbing throws, the event is DROPPED (null), never sent as it was.
 */

const FILTERED = '[Filtered]';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ID_RE = /^[0-9a-f]{16,40}$/i;

// A digit, ASCII or Thai (๐-๙). Used by every number shape below.
const D = '[0-9\u0E50-\u0E59]';
const NOT_D_BEFORE = `(?<!${D})`;
const NOT_D_AFTER = `(?!${D})`;
// Phone separators: dash, dot, space and brackets, at most two in a row.
const PS = '[-. ()]{0,2}';

/**
 * A Prisma client error message embeds the call's ARGUMENT TREE — every value
 * the code passed (measured 2026-10-02 with Prisma 5.22: a ValidationError
 * carried firstName, lastName, address and passport). Shape:
 *   "\nInvalid `prisma.user.create()` invocation in\n<file>\n\n<code frame +
 *    argument tree>\n\n<summary line>"
 * Keep only the operation and the last paragraph (the summary). A message that
 * was already reduced has no blank line after the marker and is left alone.
 */
const PRISMA_INVOCATION = /Invalid `(?:[\w$]+\.)?((?:[\w$]+\.)?[\w$]+)\(\)` invocation/;

function reducePrismaMessage(text) {
    const m = PRISMA_INVOCATION.exec(text);
    if (!m) return text;
    const rest = text.slice(m.index);
    if (!/\n[ \t]*\n/.test(rest)) return text;
    const blocks = rest.split(/\n[ \t]*\n/).map((b) => b.trim()).filter(Boolean);
    const summary = blocks.length > 1 ? blocks[blocks.length - 1].slice(0, 500) : '';
    const prefix = text.slice(0, m.index).trim();
    return `${prefix ? `${prefix} ` : ''}Invalid \`${m[1]}()\` invocation${summary ? `: ${summary}` : ''}`;
}

/** Ordered: the specific shapes first, so a generic one never eats half a token. */
const STRING_PATTERNS = [
    // Postgres error payloads echo row values: DETAIL lines, unique-key values,
    // the failing row of a CHECK violation.
    [/\bDETAIL:[^\n`]*/g, `DETAIL: ${FILTERED}`],
    [/\bKey \(([^)]*)\)=\((?:[^()]|\([^()]*\))*\)/g, `Key ($1)=(${FILTERED})`],
    [/Failing row contains \((?:[^()]|\([^()]*\))*\)/g, `Failing row contains (${FILTERED})`],
    // postgres URL: keep scheme, user and host; drop the password.
    [/\b(postgres(?:ql)?:\/\/[^\s:/@]+):[^\s@/]+@/gi, `$1:${FILTERED}@`],
    // A query string inside free text (span descriptions, logged URLs): the
    // query is dropped, the URL or path before it is kept.
    [/((?:https?|wss?):\/\/[^\s?#"'<>`]+|(?<=^|[\s(["'=:,])\/[^\s?#"'<>`]*)\?[^\s"'<>`]*/g, '$1'],
    // A URL path segment carrying percent-encoded Thai (UTF-8 E0 B8 / E0 B9) is
    // user text — a name in a path — wherever the URL sits in free text
    // (http.client span descriptions, logged URLs).
    [/(\/)[^\s/?#"'<>`]*%E0%B[89][^\s/?#"'<>`]*/gi, `$1${FILTERED}`],
    // Authorization credentials.
    [/\b(Bearer|Basic)\s+[^\s"',;]+/gi, `$1 ${FILTERED}`],
    // JWT: three base64url segments, the header always starting `eyJ`.
    [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, FILTERED],
    // Stripe object ids / client secrets / keys / webhook secrets.
    [/\b(?:pi|cs|seti|sk|rk|whsec)_(?:(?:test|live)_)?[A-Za-z0-9]{6,}(?:_secret_[A-Za-z0-9]+)?/g, FILTERED],
    // key=value / key: value credentials in free text.
    [/\b((?:client[_-]?)?secret|password|passwd|pwd|(?:access|refresh|id|auth)?[_-]?token|api[_-]?key)(\s*[=:]\s*)[^\s&"',;]+/gi, `$1$2${FILTERED}`],
    // Email, plain and percent-encoded.
    [/[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, FILTERED],
    // 13-digit national ID / tax ID, ASCII or Thai digits, with any single
    // dash / dot / space between any digits. It may not start or end inside a
    // longer run of digits (so two phone numbers side by side are not read as one ID)...
    [new RegExp(`(?<!${D}|${D}[-. ])${D}(?:[-. ]?${D}){12}(?!${D}|[-. ]${D})`, 'g'), FILTERED],
    // ...and the two common shapes are also caught when another number follows.
    [new RegExp(`${NOT_D_BEFORE}(?:${D}{13}|${D}[-. ]${D}{4}[-. ]${D}{5}[-. ]${D}{2}[-. ]${D})${NOT_D_AFTER}`, 'g'), FILTERED],
    // Thai phone numbers, +66 / 66 form: mobile (6/8/9 + 8 digits), landline (2-5/7 + 7 digits).
    [new RegExp(`(?:\\+66|${NOT_D_BEFORE}66)${PS}(?:[689\u0E56\u0E58\u0E59](?:${PS}${D}){8}|[2-57\u0E52-\u0E55\u0E57](?:${PS}${D}){7})${NOT_D_AFTER}`, 'g'), FILTERED],
    // Thai phone numbers, 0 form, optionally bracketed: (02) 123 4567, 081.234.5678, ๐๘๑…
    // Any 10-digit 0x number is read as a phone (020-123-4567 too); 9 digits only for landline prefixes.
    [new RegExp(`${NOT_D_BEFORE}\\(?[0\u0E50](?:[1-9\u0E51-\u0E59](?:${PS}${D}){8}|[2-57\u0E52-\u0E55\u0E57](?:${PS}${D}){7})${NOT_D_AFTER}`, 'g'), FILTERED],
];

/**
 * A value under a key that names a credential or a personal field is replaced
 * whole. Two rules: the key contains one of SENSITIVE_KEY_PARTS (separators and
 * case ignored), or one of its words is in SENSITIVE_KEY_WORDS. Broad on purpose —
 * `name` alone covers applicantName, legalName, displayName, accountName…;
 * __tests__/unit/sentry-pii-schema-fields.test.js holds every PII-looking column of
 * prisma/schema/*.prisma to this rule, so a new column cannot slip past it.
 */
const SENSITIVE_KEY_PARTS = [
    'name', 'address', 'phone', 'mobile', 'email', 'passport', 'citizen', 'national', 'tax',
    'juristic', 'registration', 'regno', 'birth', 'idcard', 'laser', 'contact', 'holder',
    'person', 'applicant', 'representative', 'interviewee', 'password', 'passwd', 'secret',
    'token', 'cookie', 'session', 'authorization', 'credential', 'signature', 'apikey',
    'privatekey', 'healthid', 'providerid', 'body', 'clientip', 'remoteaddr', 'latitude',
    'longitude', 'gps', 'coordinat', 'dsn',
];
const SENSITIVE_KEY_WORDS = new Set(['pid', 'dob', 'tel', 'lat', 'lng', 'ip', 'pwd', 'otp']);

/** SDK / OpenTelemetry attribute keys that only LOOK like the rule. */
const NON_PERSONAL_KEYS = new Set([
    'express.name', 'sentry.segment.name', 'sentry.segment.name.source', 'otel.scope.name',
    'db.name', 'db.system', 'db.system.name', 'db.operation.name', 'db.collection.name', 'db.namespace',
    'service.name', 'messaging.destination.name', 'code.function.name', 'code.function',
]);

/** SDK-generated contexts: their `name` fields are an OS, a runtime, a browser. */
const SDK_CONTEXTS = new Set(['os', 'runtime', 'browser', 'device', 'app', 'culture', 'cloud_resource', 'react', 'response']);

function isSensitiveKey(key) {
    const k = String(key);
    if (NON_PERSONAL_KEYS.has(k)) return false;
    const flat = k.toLowerCase().replace(/[-_.\s]/g, '');
    if (SENSITIVE_KEY_PARTS.some((part) => flat.includes(part))) return true;
    const words = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/);
    return words.some((w) => SENSITIVE_KEY_WORDS.has(w));
}

/** OpenTelemetry header attributes: `http.request.header.<name>`. */
const OTEL_HEADER_KEY = /^http\.(?:request|response)\.header\.(.+)$/i;

/** Keys whose value is a URL or a path. */
const URL_VALUE_KEYS = new Set(['url', 'url.full', 'url.path', 'http.url', 'http.target', 'from', 'to', 'request_path']);

/** Keys whose value is a bare query string: never sent. */
const QUERY_VALUE_KEYS = new Set(['url.query', 'http.query', 'query', 'query_string']);

/** Keys that hold SDK-generated hex ids: kept as they are, or traces stop linking. */
const HEX_ID_KEYS = new Set(['trace_id', 'span_id', 'parent_span_id', 'event_id', 'sid', 'profile_id', 'replay_id']);

/** The only request headers that survive. */
const HEADER_ALLOWLIST = new Set([
    'accept', 'accept-encoding', 'accept-language', 'content-length', 'content-type',
    'host', 'origin', 'referer', 'user-agent', 'x-api-version', 'x-request-id',
]);

const HTTP_BODY_KEYS = new Set(['body', 'request_body', 'response_body', 'request_headers', 'response_headers', 'headers']);
const BREADCRUMB_PASS_THROUGH = new Set(['category', 'level', 'type', 'timestamp']);

const MAX_DEPTH = 12;

/**
 * Replace every pattern in a string. Non-strings pass through.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function scrubString(value) {
    if (typeof value !== 'string' || value === '') return value;
    let out = reducePrismaMessage(value);
    for (const [re, replacement] of STRING_PATTERNS) {
        out = out.replace(re, replacement);
    }
    return /** @type {T} */ (/** @type {unknown} */ (out));
}

function carriesPattern(text) {
    return typeof text === 'string' && scrubString(text) !== text;
}

function splitUrl(url) {
    const m = /^([^?#]*)(?:\?([^#]*))?(?:#.*)?$/s.exec(url);
    return m ? { path: m[1], query: m[2] } : { path: url, query: undefined };
}

function safeDecode(text) {
    try {
        return decodeURIComponent(text.replace(/\+/g, ' '));
    } catch {
        return text;
    }
}

/** Route segments are ASCII words; Thai text or whitespace in one is user input. */
const FREE_TEXT_SEGMENT = /[\u0E00-\u0E7F\s]/;

/** Thai letters: in a label (a tag value) or a console line they may be a name. */
const THAI_TEXT = /[\u0E01-\u0E4E]/;

function scrubTags(tags) {
    if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return scrubValue(tags);
    const out = {};
    for (const k of Object.keys(tags)) {
        const v = tags[k];
        out[k] = typeof v === 'string' && THAI_TEXT.test(v) ? FILTERED : scrubValue(v, k);
    }
    return out;
}

function scrubPath(path) {
    return path.split('/').map((segment) => {
        if (!segment) return segment;
        const decoded = safeDecode(segment);
        return FREE_TEXT_SEGMENT.test(decoded) || carriesPattern(decoded) || carriesPattern(segment) ? FILTERED : segment;
    }).join('/');
}

/**
 * Scrub a URL down to origin + path: the query string and fragment are always
 * dropped (a search box sends names: provider/applications?q=…), and a path
 * segment carrying a pattern or free text is replaced.
 * @param {unknown} url
 */
function scrubUrl(url) {
    if (typeof url !== 'string') return url;
    const { path } = splitUrl(url);
    // scheme://userinfo@host stays as one piece (its userinfo is pattern-scrubbed);
    // only the path after it is split into segments.
    const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(path);
    const head = origin ? origin[0] : '';
    return scrubString(head) + scrubPath(path.slice(head.length));
}

/**
 * Deep-scrub any JSON-like value: sensitive keys replaced whole (unless
 * `checkKeys` is false), strings pattern-scrubbed, SDK hex ids kept.
 * Cycle- and depth-safe.
 */
function scrubValue(value, key, depth = 0, seen = new WeakSet(), checkKeys = true) {
    if (checkKeys && key !== undefined && isSensitiveKey(key)) {
        return value === undefined || value === null ? value : FILTERED;
    }
    if (typeof value === 'string') {
        if (key !== undefined && HEX_ID_KEYS.has(String(key)) && HEX_ID_RE.test(value)) return value;
        return scrubString(value);
    }
    if (value === null || typeof value !== 'object') return value;
    if (depth >= MAX_DEPTH) return FILTERED;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => scrubValue(item, undefined, depth + 1, seen, checkKeys));
    }
    return scrubObject(value, depth, seen, checkKeys);
}

function scrubObject(obj, depth, seen, checkKeys = true) {
    const out = {};
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        const header = OTEL_HEADER_KEY.exec(k);
        if (header) {
            // Same allowlist as request.headers: anything else is dropped whole.
            const name = header[1].toLowerCase();
            if (HEADER_ALLOWLIST.has(name)) {
                out[k] = name === 'referer' || name === 'origin'
                    ? (Array.isArray(v) ? v.map((x) => scrubUrl(String(x))) : scrubUrl(String(v)))
                    : scrubValue(v, undefined, depth + 1, seen);
            }
            continue;
        }
        if (QUERY_VALUE_KEYS.has(k)) continue; // never sent
        if (checkKeys && isSensitiveKey(k)) {
            out[k] = v === undefined || v === null ? v : FILTERED;
        } else if (URL_VALUE_KEYS.has(k) && typeof v === 'string') {
            out[k] = scrubUrl(v);
        } else {
            out[k] = scrubValue(v, k, depth + 1, seen, checkKeys);
        }
    }
    return out;
}

function scrubContexts(contexts) {
    if (!contexts || typeof contexts !== 'object' || Array.isArray(contexts)) return scrubValue(contexts);
    const out = {};
    for (const name of Object.keys(contexts)) {
        // A context's NAME is a label the code chose; what is inside it is scrubbed.
        out[name] = scrubValue(contexts[name], undefined, 0, new WeakSet(), !SDK_CONTEXTS.has(name));
    }
    return out;
}

function scrubHeaders(headers) {
    if (!headers || typeof headers !== 'object') return undefined;
    const out = {};
    for (const name of Object.keys(headers)) {
        const lower = name.toLowerCase();
        if (!HEADER_ALLOWLIST.has(lower)) continue;
        const v = headers[name];
        out[name] = lower === 'referer' || lower === 'origin' ? scrubUrl(String(v)) : scrubValue(v);
    }
    return out;
}

function scrubRequest(request) {
    if (!request || typeof request !== 'object') return request;
    const out = {};
    for (const k of Object.keys(request)) {
        const v = request[k];
        // body, cookies, env and the query string: dropped whole.
        if (k === 'data' || k === 'cookies' || k === 'env' || k === 'query_string') continue;
        if (k === 'headers') out.headers = scrubHeaders(v);
        else if (k === 'url') out.url = scrubUrl(v);
        else if (k === 'method') out.method = v;
        else out[k] = scrubValue(v, k);
    }
    return out;
}

function keepOnlyUserId(user) {
    if (user && typeof user === 'object' && typeof user.id === 'string' && UUID_RE.test(user.id)) {
        return { id: user.id };
    }
    return undefined;
}

function breadcrumbText(breadcrumb) {
    const parts = [breadcrumb.message];
    const args = breadcrumb.data && breadcrumb.data.arguments;
    if (Array.isArray(args)) {
        for (const a of args) parts.push(typeof a === 'string' ? a : JSON.stringify(a));
    }
    return parts.filter((p) => typeof p === 'string').join(' ');
}

function scrubBreadcrumbData(data, isHttp) {
    const kept = {};
    for (const k of Object.keys(data)) {
        if (isHttp && HTTP_BODY_KEYS.has(k)) continue;
        kept[k] = data[k];
    }
    return scrubValue(kept);
}

/**
 * The beforeBreadcrumb hook, and what beforeSend applies to an event's
 * breadcrumbs. Returns null to drop. A breadcrumb it cannot read is dropped.
 */
function scrubBreadcrumb(breadcrumb) {
    if (!breadcrumb || typeof breadcrumb !== 'object') return null;
    try {
        const category = String(breadcrumb.category || '');
        if (category === 'console' || category.startsWith('console.')) {
            // A console line with a pattern, or with Thai free text (a name cannot be
            // told apart from prose), is dropped whole.
            const text = breadcrumbText(breadcrumb);
            if (carriesPattern(text) || THAI_TEXT.test(text)) return null;
        }
        const isHttp = breadcrumb.type === 'http' || category === 'fetch' || category === 'xhr' || category === 'http';
        const out = {};
        for (const k of Object.keys(breadcrumb)) {
            const v = breadcrumb[k];
            if (k === 'message') out.message = scrubString(v);
            else if (k === 'data' && v && typeof v === 'object') out.data = scrubBreadcrumbData(v, isHttp);
            else if (BREADCRUMB_PASS_THROUGH.has(k)) out[k] = v;
            else out[k] = scrubValue(v, k);
        }
        return out;
    } catch {
        return null;
    }
}

function scrubException(exception) {
    if (!exception || typeof exception !== 'object') return exception;
    const out = { ...exception };
    if (typeof out.value === 'string') out.value = scrubString(out.value);
    if (out.mechanism && out.mechanism.data) out.mechanism = { ...out.mechanism, data: scrubValue(out.mechanism.data) };
    if (out.stacktrace && Array.isArray(out.stacktrace.frames)) {
        out.stacktrace = {
            ...out.stacktrace,
            frames: out.stacktrace.frames.map((frame) => (frame && frame.vars ? { ...frame, vars: scrubValue(frame.vars) } : frame)),
        };
    }
    return out;
}

function scrubSpan(span) {
    if (!span || typeof span !== 'object') return span;
    const out = { ...span };
    if (typeof out.description === 'string') out.description = scrubString(out.description);
    if (out.data) out.data = scrubValue(out.data);
    if (out.attributes) out.attributes = scrubValue(out.attributes);
    return out;
}

/** Top-level event keys that are SDK metadata, not content: passed through. */
const PASS_THROUGH = new Set([
    'event_id', 'timestamp', 'start_timestamp', 'level', 'platform', 'logger', 'release', 'dist',
    'environment', 'sdk', 'modules', 'type', 'fingerprint', 'server_name', 'measurements',
    'debug_meta', 'sdkProcessingMetadata', 'transaction_info',
]);

const EVENT_FIELD = {
    message: (v) => (typeof v === 'string' ? scrubString(v) : scrubValue(v)),
    contexts: (v) => scrubContexts(v),
    tags: (v) => scrubTags(v),
    transaction: (v) => scrubString(v),
    exception: (v) => (v && Array.isArray(v.values) ? { ...v, values: v.values.map(scrubException) } : scrubValue(v)),
    request: (v) => scrubRequest(v),
    user: (v) => keepOnlyUserId(v),
    breadcrumbs: (v) => (Array.isArray(v) ? v.map(scrubBreadcrumb).filter(Boolean) : undefined),
    spans: (v) => (Array.isArray(v) ? v.map(scrubSpan) : v),
};

/**
 * beforeSend / beforeSendTransaction. Returns the scrubbed event, or null to
 * drop it (also when scrubbing itself fails).
 * @template {Record<string, any>} E
 * @param {E | null | undefined} event
 * @returns {E | null}
 */
function scrubEvent(event) {
    if (!event || typeof event !== 'object') return null;
    try {
        /** @type {Record<string, unknown>} */
        const out = {};
        for (const k of Object.keys(event)) {
            const v = event[k];
            let next;
            if (PASS_THROUGH.has(k)) next = v;
            else if (Object.prototype.hasOwnProperty.call(EVENT_FIELD, k)) next = EVENT_FIELD[k](v);
            // logentry, tags, extra, contexts, threads and anything newer.
            else next = scrubValue(v);
            if (next !== undefined) out[k] = next;
        }
        return /** @type {E} */ (/** @type {unknown} */ (out));
    } catch {
        return null;
    }
}

// ── The last gate: every envelope, whatever produced it ─────────────────────
//
// beforeSend / beforeSendTransaction see events and transactions only. Measured
// 2026-10-02 against SDK 11.2.0, other items leave by other doors: a SESSION item
// carried `attrs.ip_address` and `did` (user id, else email, else username)
// straight from the scope's user, and STREAMED SPAN items carried the request
// body as `http.request.body.data`. So the transport itself is wrapped: each
// envelope is scrubbed item by item just before it is sent, and anything this
// module cannot vouch for is dropped.

/** Items that are never sent: recordings, files, profiles, user-typed feedback. */
const DROP_ITEM_TYPES = new Set([
    'attachment', 'replay_event', 'replay_recording', 'replay_video', 'profile', 'profile_chunk',
    'feedback', 'user_report', 'statsd', 'otel_log',
]);

function scrubSession(session) {
    if (!session || typeof session !== 'object') return session;
    const out = { ...session };
    if (out.did !== undefined && !(typeof out.did === 'string' && UUID_RE.test(out.did))) delete out.did;
    if (out.attrs && typeof out.attrs === 'object') {
        const attrs = { ...out.attrs };
        delete attrs.ip_address;
        out.attrs = attrs;
    }
    return out;
}

function scrubSessionAggregates(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const out = { ...payload };
    if (out.attrs && typeof out.attrs === 'object') {
        const attrs = { ...out.attrs };
        delete attrs.ip_address;
        out.attrs = attrs;
    }
    if (Array.isArray(out.aggregates)) {
        out.aggregates = out.aggregates.map((a) => {
            const agg = { ...a };
            if (agg.did !== undefined && !(typeof agg.did === 'string' && UUID_RE.test(agg.did))) delete agg.did;
            return agg;
        });
    }
    return out;
}

/** Streamed-span / log attribute maps: `{ key: { value, type } }`. */
function scrubAttributeMap(attributes) {
    if (!attributes || typeof attributes !== 'object') return attributes;
    const plain = {};
    for (const k of Object.keys(attributes)) {
        const a = attributes[k];
        plain[k] = a && typeof a === 'object' && 'value' in a ? a.value : a;
    }
    const scrubbed = scrubValue(plain);
    const out = {};
    for (const k of Object.keys(scrubbed)) {
        const original = attributes[k];
        out[k] = original && typeof original === 'object' && 'value' in original
            ? { ...original, value: scrubbed[k] }
            : scrubbed[k];
    }
    return out;
}

function scrubSpanItem(span) {
    if (!span || typeof span !== 'object') return span;
    const out = { ...span };
    if (typeof out.name === 'string') out.name = scrubString(out.name);
    if (out.attributes) out.attributes = scrubAttributeMap(out.attributes);
    return out;
}

function scrubItemsContainer(payload, scrubOne) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) return scrubValue(payload);
    return { ...payload, items: payload.items.map(scrubOne) };
}

function scrubLogItem(log) {
    if (!log || typeof log !== 'object') return log;
    const out = { ...log };
    if (typeof out.body === 'string') out.body = scrubString(out.body);
    if (out.attributes) out.attributes = scrubAttributeMap(out.attributes);
    return out;
}

/** One envelope item → its scrubbed form, or null to drop it. */
function scrubEnvelopeItem(itemHeader, payload) {
    const type = itemHeader && itemHeader.type;
    if (DROP_ITEM_TYPES.has(type)) return null;
    switch (type) {
        case 'event':
        case 'transaction':
            return scrubEvent(payload);
        case 'session':
            return scrubSession(payload);
        case 'sessions':
            return scrubSessionAggregates(payload);
        case 'span':
            return scrubItemsContainer(payload, scrubSpanItem);
        case 'log':
            return scrubItemsContainer(payload, scrubLogItem);
        case 'client_report':
            return payload; // counts of dropped events, no content
        default:
            // Anything newer than this module: only plain JSON is sent, scrubbed.
            return payload && typeof payload === 'object' && !ArrayBuffer.isView(payload) ? scrubValue(payload) : null;
    }
}

/**
 * Scrub a whole envelope `[headers, items]`. Returns null when nothing is left
 * to send (or when the envelope cannot be read).
 */
function scrubEnvelope(envelope) {
    try {
        if (!Array.isArray(envelope) || !Array.isArray(envelope[1])) return null;
        const [headers, items] = envelope;
        const outHeaders = { ...headers };
        if (outHeaders.trace && typeof outHeaders.trace === 'object') {
            const trace = { ...outHeaders.trace };
            if (typeof trace.transaction === 'string') trace.transaction = scrubString(trace.transaction);
            delete trace.user_segment;
            delete trace.user;
            outHeaders.trace = trace;
        }
        if (outHeaders.user) delete outHeaders.user;
        const outItems = [];
        for (const item of items) {
            if (!Array.isArray(item)) continue;
            const [itemHeader, payload] = item;
            const clean = scrubEnvelopeItem(itemHeader, payload);
            if (clean !== null && clean !== undefined) outItems.push([itemHeader, clean]);
        }
        if (outItems.length === 0) return null;
        return [outHeaders, outItems];
    } catch {
        return null;
    }
}

/**
 * Wrap an SDK transport factory (makeNodeTransport, makeFetchTransport, or a
 * test recorder) so every envelope passes scrubEnvelope on its way out.
 * @template {(options: any) => { send: (envelope: any) => PromiseLike<any>, flush: (timeout?: number) => PromiseLike<boolean> }} F
 * @param {F} makeTransport
 * @returns {F}
 */
function scrubbingTransport(makeTransport) {
    return /** @type {F} */ (/** @type {unknown} */ ((options) => {
        const inner = makeTransport(options);
        return {
            ...inner,
            send(envelope) {
                const clean = scrubEnvelope(envelope);
                if (!clean) return Promise.resolve({});
                return inner.send(clean);
            },
            flush: (timeout) => inner.flush(timeout),
        };
    }));
}

/**
 * What the SDK may collect at all (SDK v11 `dataCollection`). v11 removed
 * `sendDefaultPii` and replaced it with this, and every default is ON — cookies,
 * all headers, request and response bodies, query strings, DB query data and
 * stack-frame local variables. Measured 2026-10-02: with the defaults, a request
 * body left in a span attribute. Everything personal is switched off here; the
 * scrubber above still runs over whatever remains.
 */
function dataCollectionOptions() {
    return {
        userInfo: false,
        cookies: false,
        httpHeaders: {
            request: { allow: [...HEADER_ALLOWLIST] },
            response: { allow: ['content-type', 'content-length'] },
        },
        /** @type {Array<'incomingRequest' | 'outgoingRequest' | 'incomingResponse' | 'outgoingResponse'>} */
        httpBodies: [],
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        queues: false,
        stackFrameVariables: false,
    };
}

/**
 * The options both SDKs are initialised with.
 *
 * - `sendDefaultPii: false` is kept for SDKs before v11, where it is the switch;
 *   v11 ignores it and obeys `dataCollection` instead.
 * - `traceLifecycle: 'static'` is part of the scrubbing, not a tuning knob. v11
 *   defaults to 'stream', which sends spans as separate envelope items that never
 *   pass beforeSendTransaction — measured 2026-10-02: a sampled request shipped
 *   the national ID from its body in a streamed span while every error event was
 *   clean. 'static' sends one transaction event per request, which goes through
 *   scrubEvent like any other (and is dropped if it cannot be scrubbed). v12
 *   removes 'static'; moving to v12 means scrubbing in beforeSendSpan. The
 *   transport wrapper (scrubbingTransport) also scrubs streamed spans, so the
 *   wire stays clean either way.
 * - The transport is NOT set here: each app wraps its own SDK's transport with
 *   scrubbingTransport, because the factory differs per SDK.
 */
function sentryScrubOptions() {
    return {
        sendDefaultPii: false,
        dataCollection: dataCollectionOptions(),
        traceLifecycle: /** @type {'static'} */ ('static'),
        beforeSend: (event) => scrubEvent(event),
        beforeSendTransaction: (event) => scrubEvent(event),
        beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    };
}

module.exports = {
    FILTERED,
    scrubString,
    scrubUrl,
    scrubEvent,
    scrubBreadcrumb,
    scrubEnvelope,
    scrubbingTransport,
    isSensitiveKey,
    sentryScrubOptions,
};
