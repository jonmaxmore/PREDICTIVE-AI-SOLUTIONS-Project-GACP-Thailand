/**
 * Catalog tests for `apps/backend/shared/error-codes.js`.
 *
 * Acceptance per RFC W4-B:
 *   - Catalog is a frozen object
 *   - Every entry has the 6 required fields { code, httpStatus, messageEn,
 *     messageTh, source, remediation }
 *   - httpStatus is in the 4xx/5xx range
 *   - All `code` keys match `^[A-Z][A-Z0-9_]+$`
 *   - Codes are unique (Object.keys form a set; entry.code matches the key)
 *   - All 10 DEFAULT_ERROR_MESSAGES from api-response.js are catalogued
 *   - All 11 codes from shared/errors.js (8 AppError subclasses + 3
 *     branches) are catalogued
 *   - extract-error-codes.js runs without crashing in --validate mode
 *     (sanity: the extractor module is importable and `extract()` returns
 *     a Map)
 */

const { ERROR_CODES, getMessage, lookup } = require('../../shared/error-codes');
const { DEFAULT_ERROR_MESSAGES } = require('../../shared/api-response');
const { extract, loadCatalog } = require('../../scripts/extract-error-codes');

const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = ['code', 'httpStatus', 'messageEn', 'messageTh', 'source', 'remediation'];
const CODE_REGEX = /^[A-Z][A-Z0-9_]+$/;

describe('shared/error-codes catalog', () => {
    it('exports a frozen object with at least 80 entries (RFC W4-B floor)', () => {
        expect(Object.isFrozen(ERROR_CODES)).toBe(true);
        const count = Object.keys(ERROR_CODES).length;
        expect(count).toBeGreaterThanOrEqual(80);
    });

    it('every entry has all 6 required fields with the right types', () => {
        for (const [key, entry] of Object.entries(ERROR_CODES)) {
            for (const field of REQUIRED_FIELDS) {
                expect(entry[field]).toBeDefined();
                expect(entry[field]).not.toBeNull();
            }
            expect(typeof entry.code).toBe('string');
            expect(typeof entry.httpStatus).toBe('number');
            expect(typeof entry.messageEn).toBe('string');
            expect(typeof entry.messageTh).toBe('string');
            expect(typeof entry.source).toBe('string');
            expect(typeof entry.remediation).toBe('string');
            // The key must match the entry's own code.
            expect(entry.code).toBe(key);
            // Code must match canonical UPPER_SNAKE regex.
            expect(entry.code).toMatch(CODE_REGEX);
            // source carries `path:line`
            expect(entry.source).toMatch(/^[^:]+:\d+$/);
            // messages must be non-empty
            expect(entry.messageEn.length).toBeGreaterThan(0);
            expect(entry.messageTh.length).toBeGreaterThan(0);
        }
    });

    // the backlog 2026-08-19: the shape check below never opened the file, so
    // four entries kept pointing at providers deleted in the external-services
    // cleanup and nothing went red for a month (they were removed 2026-09-16).
    // This closes that hole. The 16 rows below are the debt that already existed
    // when the check landed: their files went with the slip/bank-account removal
    // and the money domain is flag-only for agents (the project rules L3), so they are
    // listed explicitly instead of being silently tolerated — the list must only
    // ever shrink.
    const SOURCE_FILE_ALREADY_GONE = new Set([
        'INVALID_PHASE', 'INVALID_SLIP_STATE', 'INVALID_STATE_FOR_UPLOAD', 'INVALID_REVIEWER_SIDE',
        'PAYMENT_SLIP_READ_FORBIDDEN', 'PAYMENT_SLIP_REVIEW_FORBIDDEN',
        'BANK_ACCOUNT_MANAGE_FORBIDDEN', 'BANK_ACCOUNT_READ_FORBIDDEN',
        'BANK_RECONCILIATION_FORBIDDEN', 'DAILY_CASH_FORBIDDEN',
        'IMMUTABLE_FIELD', 'INACTIVE_ACCOUNT', 'NO_REPLACEMENT',
        'AMOUNT_VERIFICATION_REQUIRED', 'AMOUNT_MISMATCH', 'SLIP_ALREADY_PROCESSED',
    ]);

    it('every source path points at a file that exists (known debt listed explicitly)', () => {
        const BACKEND = path.join(__dirname, '..', '..');
        const missing = Object.entries(ERROR_CODES)
            .filter(([code]) => !SOURCE_FILE_ALREADY_GONE.has(code))
            .filter(([, entry]) => {
                const file = String(entry.source || '').split(':')[0];
                return file && !fs.existsSync(path.join(BACKEND, file));
            })
            .map(([code, entry]) => `${code} -> ${entry.source}`);
        expect(missing).toEqual([]);
    });

    it('the known-debt list has no entry that is already fixed', () => {
        const BACKEND = path.join(__dirname, '..', '..');
        const fixed = [...SOURCE_FILE_ALREADY_GONE].filter((code) => {
            const entry = ERROR_CODES[code];
            if (!entry) { return true; }
            const file = String(entry.source || '').split(':')[0];
            return fs.existsSync(path.join(BACKEND, file));
        });
        expect(fixed).toEqual([]);
    });

    it('every httpStatus is a 4xx or 5xx HTTP status code', () => {
        for (const entry of Object.values(ERROR_CODES)) {
            expect(entry.httpStatus).toBeGreaterThanOrEqual(400);
            expect(entry.httpStatus).toBeLessThan(600);
            // Sanity: must be one of the standard 3-digit codes.
            expect(Number.isInteger(entry.httpStatus)).toBe(true);
        }
    });

    it('catalog codes are unique (no duplicate keys across the object)', () => {
        const keys = Object.keys(ERROR_CODES);
        const set = new Set(keys);
        expect(keys.length).toBe(set.size);
        // Verify the entry.code values also de-dup the same way.
        const codeValues = Object.values(ERROR_CODES).map((e) => e.code);
        const codeSet = new Set(codeValues);
        expect(codeValues.length).toBe(codeSet.size);
    });

    it('contains every code listed in shared/api-response.js DEFAULT_ERROR_MESSAGES', () => {
        const seedCodes = Object.keys(DEFAULT_ERROR_MESSAGES);
        expect(seedCodes.length).toBeGreaterThanOrEqual(10);
        for (const code of seedCodes) {
            expect(ERROR_CODES[code]).toBeDefined();
            expect(ERROR_CODES[code].code).toBe(code);
        }
    });

    it('contains every code thrown by shared/errors.js AppError + JWT branches', () => {
        // Per shared/errors.js: 8 AppError subclasses + ROUTE_NOT_FOUND +
        // INVALID_TOKEN + TOKEN_EXPIRED + INTERNAL_ERROR = 12 codes (with
        // VALIDATION_ERROR shared with the seed).
        const requiredCodes = [
            'VALIDATION_ERROR',
            'AUTH_ERROR',
            'AUTHORIZATION_ERROR',
            'NOT_FOUND',
            'CONFLICT_ERROR',
            'DATABASE_ERROR',
            'BUSINESS_LOGIC_ERROR',
            'INTERNAL_ERROR',
            'ROUTE_NOT_FOUND',
            'INVALID_TOKEN',
            'TOKEN_EXPIRED',
        ];
        for (const code of requiredCodes) {
            expect(ERROR_CODES[code]).toBeDefined();
            expect(ERROR_CODES[code].code).toBe(code);
        }
    });

    it('exposes getMessage() that returns localised strings with fallback', () => {
        expect(getMessage('VALIDATION_ERROR', 'en')).toBe('Validation failed');
        expect(getMessage('VALIDATION_ERROR', 'th')).toMatch(/ข้อมูล/);
        // Unknown code falls back to INTERNAL_SERVER_ERROR
        const fb = getMessage('NOT_A_REAL_CODE', 'en');
        expect(fb).toBe(ERROR_CODES.INTERNAL_SERVER_ERROR.messageEn);
    });

    it('exposes lookup() that returns the full row or undefined', () => {
        expect(lookup('VALIDATION_ERROR')).toBe(ERROR_CODES.VALIDATION_ERROR);
        expect(lookup('NOT_A_REAL_CODE')).toBeUndefined();
    });

    it('extract-error-codes script runs and discovers ≥ catalog floor codes', () => {
        const discovered = extract();
        expect(discovered).toBeInstanceOf(Map);
        // Should discover at least the 80-row floor (parity with catalog).
        expect(discovered.size).toBeGreaterThanOrEqual(80);
        // Spot-check that some RFC-mentioned codes are in the discovered set.
        for (const code of [
            'VALIDATION_ERROR', 'NOT_FOUND', 'PENDING_INVOICES_IN_PERIOD',
            'UNBALANCED_TOTALS', 'WHT_EXCEEDS_SUBTOTAL', 'RECEIPT_SEQUENCE_DB_UNAVAILABLE',
        ]) {
            expect(discovered.has(code)).toBe(true);
        }
    });

    it('extractor loadCatalog returns same module as direct require', () => {
        const cat = loadCatalog();
        expect(cat).toBe(ERROR_CODES);
    });

    it('every discovered code is catalogued (no drift between code and catalog)', () => {
        const discovered = extract();
        const missing = [];
        for (const code of discovered.keys()) {
            if (!ERROR_CODES[code]) {
                missing.push(code);
            }
        }
        expect(missing).toEqual([]);
    });
});
