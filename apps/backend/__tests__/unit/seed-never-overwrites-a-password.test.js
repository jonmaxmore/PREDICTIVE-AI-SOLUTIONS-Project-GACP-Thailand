'use strict';

/**
 * The seed sets a password ONCE, on create, and never again.
 *
 * A password on an existing account is a credential someone holds; it is not a fixture.
 * prisma/seed-gacp.js used to carry `password` in the `update:` clause of every user
 * upsert, so re-running the seed silently reset every seeded account to the fixture value.
 * On 2026-08-26 the seed ran by accident — a worker required the file to read its column
 * names, before the require.main guard existed — and the pressed walk's officer logins then
 * all failed with "รหัสผ่านไม่ถูกต้อง", because the credentials on file described accounts
 * the seed had just rewritten.
 *
 * `role` was removed from the same clauses on 2026-08-22 for the same reason (an
 * unconditional update is exactly what must not happen to a column an operator changes by
 * hand). `password` should have gone with it and did not.
 *
 * This reads the source rather than running the seed, because running the seed writes to
 * whatever DATABASE_URL points at — which is how the incident happened.
 */

const fs = require('fs');
const path = require('path');

const SEED = path.join(__dirname, '..', '..', 'prisma', 'seed-gacp.js');

/** Every `update: { ... }` object literal in the file, as raw text. */
function updateClauses(source) {
    const clauses = [];
    const re = /update:\s*\{/g;
    let match;
    while ((match = re.exec(source)) !== null) {
        let depth = 0;
        let i = match.index + match[0].length - 1;
        for (; i < source.length; i += 1) {
            if (source[i] === '{') { depth += 1; }
            if (source[i] === '}') { depth -= 1; if (depth === 0) { break; } }
        }
        clauses.push(source.slice(match.index, i + 1));
    }
    return clauses;
}

describe('seed-gacp.js never overwrites an existing password', () => {
    const source = fs.readFileSync(SEED, 'utf8');
    const clauses = updateClauses(source);

    it('finds the upsert update clauses — a parser that found none would pass vacuously', () => {
        expect(clauses.length).toBeGreaterThan(3);
    });

    it('no update clause writes `password`', () => {
        const offenders = clauses.filter((c) => /\bpassword\s*:/.test(c));

        // If this fails: the fixture password belongs in `create:` only. Do not move it
        // back to `update:` to "repair" a dev account — reset that account deliberately.
        expect(offenders).toEqual([]);
    });

    it('still sets the fixture password on create, so a fresh box gets usable accounts', () => {
        expect(source).toMatch(/create:\s*\{[^}]*\bpassword\s*:/);
    });
});
