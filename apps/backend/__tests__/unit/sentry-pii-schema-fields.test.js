/**
 * Every personal-looking column in the Prisma schema is covered by the error-
 * report scrubber's key rule (packages/error-reporting/src/scrub.js isSensitiveKey).
 *
 * Why: a value is replaced whole when its KEY names a personal field, and records
 * reach error reports under their column names (setContext, extra, a logged
 * object). The first scrubber listed keys by hand and missed applicantName,
 * legalName, juristicId, registrationNo and a dozen more of THIS schema's fields
 * (privacy review, 2026-10-02). This test reads every field of
 * apps/backend/prisma/schema/*.prisma, picks the ones whose name looks personal
 * (PERSONAL_HINT, deliberately broader than the rule), and fails if the rule
 * does not cover one — so a new column cannot slip past.
 *
 * A field that looks personal but is not must be listed in REVIEWED_NOT_PERSONAL
 * with the reason. Relation foreign keys (`@relation(fields: [...])`) are UUIDs
 * and are skipped automatically.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { isSensitiveKey } = require('@gacp/error-reporting/scrub');

const SCHEMA_DIR = path.join(__dirname, '..', '..', 'prisma', 'schema');

const PERSONAL_HINT = new RegExp([
    'name', 'address', 'addr', 'phone', 'mobile', 'tel', 'email', 'mail', 'passport', 'citizen',
    'national', 'tax', 'juristic', 'registration', 'regno', 'pid', 'birth', 'dob', 'idcard',
    'laser', 'contact', 'holder', 'person', 'applicant', 'representative', 'interviewee',
    'farmer', 'owner', 'signature', 'password', 'secret', 'token', 'latitude', 'longitude',
    'gps', 'coordinat', 'ipaddress', 'useragent', 'nickname', 'surname',
].join('|'), 'i');

/** Looks personal, is not. Each entry says why. */
const REVIEWED_NOT_PERSONAL = new Map([
    ['userAgent', 'browser build string; also an allowlisted request header'],
    ['signatureAlgorithm', 'algorithm name, e.g. RSA-SHA256'],
    ['signatureKeyId', 'key identifier, not a person'],
    ['signaturePublicKey', 'public key, published by design'],
]);

function readSchemaFields() {
    const fields = new Map(); // name -> Set(types)
    const foreignKeys = new Set();
    for (const file of fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.prisma'))) {
        let inBlock = false;
        for (const line of fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8').split('\n')) {
            if (/^(model|type|view)\s+\w+/.test(line)) { inBlock = true; continue; }
            if (line.startsWith('}')) { inBlock = false; continue; }
            if (!inBlock) {continue;}
            for (const m of line.matchAll(/@relation\([^)]*fields:\s*\[([^\]]*)\]/g)) {
                for (const fk of m[1].split(',')) {foreignKeys.add(fk.trim());}
            }
            const m = /^\s+(\w+)\s+(\w+)/.exec(line);
            if (!m || line.trim().startsWith('//') || line.trim().startsWith('@@')) {continue;}
            if (!fields.has(m[1])) {fields.set(m[1], new Set());}
            fields.get(m[1]).add(m[2]);
        }
    }
    return { fields, foreignKeys };
}

describe('scrubber key rule vs the Prisma schema', () => {
    const { fields, foreignKeys } = readSchemaFields();

    it('reads the schema (sanity: hundreds of fields, the known personal ones among them)', () => {
        expect(fields.size).toBeGreaterThan(500);
        for (const known of ['firstName', 'thaiCitizenId', 'taxId', 'juristicId', 'applicantName', 'phoneNumber']) {
            expect(fields.has(known)).toBe(true);
        }
    });

    it('covers every personal-looking text or JSON column', () => {
        const uncovered = [];
        for (const [name, types] of fields) {
            if (!PERSONAL_HINT.test(name)) {continue;}
            if (foreignKeys.has(name)) {continue;}
            if (!types.has('String') && !types.has('Json')) {continue;}
            if (REVIEWED_NOT_PERSONAL.has(name)) {continue;}
            if (!isSensitiveKey(name)) {uncovered.push(name);}
        }
        expect(uncovered).toEqual([]);
    });

    it('the reviewed exemptions still exist (a stale exemption is removed, not kept)', () => {
        for (const name of REVIEWED_NOT_PERSONAL.keys()) {
            expect(fields.has(name)).toBe(true);
        }
    });

    it('catches a new column the hint would flag (mutation: a made-up field)', () => {
        // If someone narrows isSensitiveKey, these hint-matching names must still be covered.
        for (const made of ['guardianName', 'spouseNationalId', 'homeAddressLine2', 'secondaryPhone', 'farmerContact']) {
            expect(isSensitiveKey(made)).toBe(true);
        }
    });
});
