/**
 * Input INSPECTION middleware — it observes, it does not rewrite.
 *
 * This used to STRIP matched patterns out of every string in every request body,
 * query and param. Measured 2026-09-08 by running it against text a Thai user or
 * officer can plausibly write (evidence/api-db-audit-2026-09-08):
 *
 *   "สวนสมใจ -- แปลงที่ 1"          ->  "สวนสมใจ แปลงที่ 1"
 *   "onsite=ตรวจแล้ว"                     ->  "ตรวจแล้ว"            <- the word vanished
 * and a fertiliser note wrapped in C-style comment delimiters lost the whole
 * note, keeping only "ปุ๋ยสูตร 15-15-15 ". (The exact third string cannot be
 * written inside this block comment; it is in the test, verbatim.)
 *
 * `/on\w+\s*=/` exists to catch `onclick=` and matches ANY English word starting
 * with "on" followed by "="; the SQL-comment patterns are meaningless against
 * Prisma's parameterised queries and ate ordinary parentheticals. No error was
 * raised and no warning shown — the user was told the save succeeded. That is
 * silent data corruption on a government registry.
 *
 * OPERATOR RULING 2026-09-08: "ปล่อยผ่านแล้ว escape ตอนแสดงผล" — pass the input
 * through, escape where it is rendered. Verified before the change that every
 * render path already escapes:
 *   - React escapes by default. The two `dangerouslySetInnerHTML` call sites that
 *     carry applicant data render HTML produced by
 *     services/pdf/katorlor1-template-service.js, which escapes & < > at :46-48
 *     under the comment "Everything applicant-supplied is escaped."
 *   - services/pdf/pdf-generator.service.js escapes /[&<>"']/g when substituting
 *     {{...}} into every PDF template.
 *   - Prisma parameterises every query, so the SQL patterns guarded nothing.
 *
 * What is KEPT: the detection and the warning log. Knowing that someone posted a
 * script tag is useful; quietly editing their farm name is not. Guarded by
 * __tests__/unit/input-survives-the-round-trip.test.js, which pins both halves —
 * ordinary text survives here, and the escaping that now carries the whole load
 * stays in place there.
 *
 * BACK-01 (audit 2026-09-17): THE INSPECTION ITSELF COULD STOP THE SERVER.
 * server.js mounts this on every path, before the rate limiter and before
 * authentication. Three of the patterns (`on\w+\s*=`, `<script\b[^>]*>`, and the
 * block-comment pattern) were run with .test() over every string, and each one
 * re-scans the rest of the string from every position where a match could
 * start. The cost therefore grew with the square of the length: 100 KB took
 * 5.4 s, and the body limit was 10 MB. One anonymous POST froze the event loop
 * for every user, webhook and cron job. Two independent fixes:
 *   1. every check below is linear in the string's length. The three quadratic
 *      patterns are replaced by scans that read the string once and flag exactly
 *      what the old regexes flagged. The other patterns were already linear and
 *      remain regexes.
 *   2. a string longer than MAX_INSPECTED_LENGTH is not inspected at all.
 * Pinned by __tests__/unit/sanitize-input-linear-time.test.js, which also
 * compares every check against the old regexes on 20,000 generated strings.
 *
 * @module middleware/sanitize-input
 */

const logger = require('../shared/logger');
const { getRequestIp } = require('../utils/client-ip');

/**
 * Strings longer than this are passed through without being inspected, and are
 * logged as OVERSIZE_NOT_INSPECTED with their path and length.
 *
 * Why skip rather than refuse: this middleware only observes (operator ruling
 * 2026-09-08 above). Refusing long strings would turn it back into a global
 * gate that guesses what "too long" means for every field. That limit belongs
 * in each route's own schema; herb-knowledge content, for example, allows 20,000
 * characters. Escaping at render time protects a long string exactly as it
 * protects a short one, so skipping inspection loses only a log line, and the
 * log line records that an oversize string arrived. The body parsers
 * (middleware/body-parsers.js) cap the total size of the request.
 */
const MAX_INSPECTED_LENGTH = 32 * 1024;

/** A check that is already linear stays a regex. Non-global: no lastIndex state. */
function regexCheck(re) {
    return { source: re.source, test: (value) => re.test(value) };
}

// `<script\b[^>]*>`: "<script" as a whole word, then a ">" anywhere after it.
// `[^>]*` can always stretch to the first ">", so only whether one exists
// matters. If no ">" follows the first "<script", none follows a later one.
const SCRIPT_WORD = /<script\b/i;
function hasScriptOpenTag(value) {
    const found = SCRIPT_WORD.exec(value);
    return found !== null && value.indexOf('>', found.index + '<script'.length) !== -1;
}

// `on\w+\s*=`: "on", at least one more word character, then optional
// whitespace and "=". If `\w+` stopped short of the end of the word, the next
// character would be a word character, which cannot start `\s*=`. So only whole
// words matter: read each word once, and ask whether "on" occurs in it before
// its last character. `\w` is ASCII-only without the u flag, so toLowerCase()
// is exactly the old i flag.
const WORD = /\w+/g;
const SPACE_THEN_EQUALS = /\s*=/y;
function hasEventHandlerAssignment(value) {
    WORD.lastIndex = 0;
    for (let word = WORD.exec(value); word !== null; word = WORD.exec(value)) {
        if (word[0].slice(0, -1).toLowerCase().includes('on')) {
            SPACE_THEN_EQUALS.lastIndex = WORD.lastIndex;
            if (SPACE_THEN_EQUALS.test(value)) { return true; }
        }
    }
    return false;
}

// Block comment `/*…*/`: a "/*" and, somewhere after it, a "*/" that does not
// reuse the opening "*". The first "/*" has the most text after it.
function hasBlockComment(value) {
    const open = value.indexOf('/*');
    return open !== -1 && value.indexOf('*/', open + 2) !== -1;
}

// Checks that indicate XSS or injection attempts. `source` is the pattern each
// check has always been logged under, so existing log searches still match.
// The three regex literals whose `.source` is read below are NEVER executed.
// Running them is exactly the BACK-01 defect.
const DANGEROUS_CHECKS = [
    { source: /<script\b[^>]*>/.source, test: hasScriptOpenTag },           // Script tags
    regexCheck(/javascript\s*:/i),                                          // javascript: URI
    { source: /on\w+\s*=/.source, test: hasEventHandlerAssignment },        // Event handlers (onclick=, onerror=, etc.)
    regexCheck(/data\s*:\s*text\/html/i),                                   // Data URIs with HTML
    regexCheck(/vbscript\s*:/i),                                            // VBScript URI
    regexCheck(/expression\s*\(/i),                                         // CSS expression()
];

// SQL injection patterns (beyond parameterized queries — defense in depth)
const SQL_CHECKS = [
    regexCheck(/;\s*(DROP|ALTER|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\s/i),
    regexCheck(/UNION\s+(ALL\s+)?SELECT/i),
    { source: /\/\*[\s\S]*?\*\//.source, test: hasBlockComment },           // SQL comments
    regexCheck(/--\s/),                                                     // SQL line comments
];

/** Keys that reach an object's prototype chain when assigned or deep-merged. */
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively sanitize a value.
 * - Strings: strip dangerous patterns
 * - Objects/Arrays: recurse into children
 * - Primitives: pass through unchanged
 */
function sanitizeValue(value, path = '', detections = []) {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === 'string') {
        // RECORD, do not rewrite. The string is returned exactly as it arrived; the
        // only effect of a match is a line in the warning log below.
        if (value.length > MAX_INSPECTED_LENGTH) {
            detections.push({ path, pattern: null, type: 'OVERSIZE_NOT_INSPECTED', length: value.length });
            return value;
        }

        for (const check of DANGEROUS_CHECKS) {
            if (check.test(value)) {
                detections.push({ path, pattern: check.source, type: 'XSS' });
            }
        }

        for (const check of SQL_CHECKS) {
            if (check.test(value)) {
                detections.push({ path, pattern: check.source, type: 'SQL_INJECTION' });
            }
        }

        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item, index) => sanitizeValue(item, `${path}[${index}]`, detections));
    }

    if (typeof value === 'object') {
        const sanitized = {};
        for (const [key, val] of Object.entries(value)) {
            const childPath = path ? `${path}.${key}` : key;
            // JSON.parse makes "__proto__" an ordinary own key, but `sanitized[key] =`
            // would run the __proto__ setter and hand the attacker's object to
            // req.body as its prototype (PR #858 review: own keys [notes], yet
            // req.body.role === 'ADMIN'). "constructor"/"prototype" are the other
            // two steps of the same pollution path through any later deep merge.
            // No field of this API uses these names, so the key is dropped — the one
            // rewrite this middleware makes — and the drop is logged like any other
            // detection.
            if (PROTOTYPE_KEYS.has(key)) {
                detections.push({ path: childPath, pattern: null, type: 'PROTOTYPE_KEY' });
                continue;
            }
            sanitized[key] = sanitizeValue(val, childPath, detections);
        }
        return sanitized;
    }

    // Numbers, booleans, etc. pass through
    return value;
}

/**
 * Express middleware that INSPECTS req.body, req.query and req.params.
 * Logs a warning for anything that looks like an injection attempt; changes nothing.
 *
 * req.params is walked alongside body and query. It was added when this
 * middleware still rewrote values, on the argument that a path parameter could
 * carry a payload into code that interpolates strings. That argument is now
 * answered where the interpolation happens rather than here — see the module
 * docblock for the list of render boundaries and their tests — but the WALK is
 * still worth keeping: a hostile /:farmId is exactly the thing an operator wants
 * to see in the log.
 */
function sanitizeInput(req, _res, next) {
    const detections = [];

    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeValue(req.body, 'body', detections);
    }

    if (req.query && typeof req.query === 'object') {
        req.query = sanitizeValue(req.query, 'query', detections);
    }

    // Sanitize path parameters. Express populates req.params as a plain object
    // of string values; we sanitize in-place so downstream route handlers see
    // clean values. IDs (UUIDs, numeric sequences) survive intact — the patterns
    // only strip HTML/JS/SQL injection tokens.
    if (req.params && typeof req.params === 'object') {
        req.params = sanitizeValue(req.params, 'params', detections);
    }

    if (detections.length > 0) {
        logger.warn('[Sanitize] Suspicious input observed (stored as sent; escaping happens at render)', {
            ip: getRequestIp(req),
            method: req.method,
            url: req.originalUrl,
            detections: detections.slice(0, 10), // Limit logged detections
        });
    }

    next();
}

module.exports = { sanitizeInput, sanitizeValue, MAX_INSPECTED_LENGTH };
