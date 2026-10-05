/**
 * STAGE B3 — well-formedness guard for the @unique-drop migration
 * (prisma/migrations/20260629030000_drop_plaintext_national_id_uniques).
 *
 * The migration drops the now-meaningless PLAINTEXT national-ID uniques (which
 * cannot survive random-IV AES-GCM encryption) while KEEPING the columns + the
 * keyed *Hash/*Hmac uniques that hold the real invariant. This static guard
 * pins that contract without a live DB.
 */

const fs = require('fs');
const path = require('path');

const MIGRATION_SQL = path.resolve(
    __dirname,
    '../../prisma/migrations/20260629030000_drop_plaintext_national_id_uniques/migration.sql',
);

describe('[STAGE B3] @unique-drop migration is well-formed', () => {
    let sql = '';
    beforeAll(() => {
        expect(fs.existsSync(MIGRATION_SQL)).toBe(true);
        sql = fs.readFileSync(MIGRATION_SQL, 'utf8');
    });

    test('drops the three plaintext uniques (constraint + index forms, IF EXISTS)', () => {
        // users.healthId
        expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS "users_healthId_key"/);
        expect(sql).toMatch(/DROP INDEX IF EXISTS "users_healthId_key"/);
        // users.providerId
        expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS "users_providerId_key"/);
        expect(sql).toMatch(/DROP INDEX IF EXISTS "users_providerId_key"/);
        // entities (type, thaiCitizenIdHash)
        expect(sql).toMatch(/DROP (CONSTRAINT|INDEX) IF EXISTS "entities_type_thaiCitizenIdHash_key"/);
    });

    test('every DROP is IF EXISTS (idempotent / re-runnable)', () => {
        const drops = sql.split(/\r?\n/).filter((l) => /^\s*(ALTER TABLE[^;]*DROP|DROP INDEX)/i.test(l));
        expect(drops.length).toBeGreaterThanOrEqual(6);
        for (const line of drops) {
            expect(line).toMatch(/IF EXISTS/i);
        }
    });

    test('does NOT drop the columns themselves (B1 decrypt + back-compat)', () => {
        expect(sql).not.toMatch(/DROP COLUMN/i);
    });

    test('does NOT touch the keyed uniques that now hold the invariant', () => {
        // The Hash/Hmac uniques must survive.
        expect(sql).not.toMatch(/healthIdHash_key|healthIdHmac_key/);
        expect(sql).not.toMatch(/providerIdHash_key|providerIdHmac_key/);
        expect(sql).not.toMatch(/entities_type_thaiCitizenIdHmac_key/);
    });

    test('does NOT contain a CREATE DDL statement (this migration only drops)', () => {
        // Ignore SQL comment lines (`--`) — the header explains WHY there is no
        // CREATE and legitimately mentions the phrase. Only executable DDL counts.
        const executable = sql
            .split(/\r?\n/)
            .filter((l) => !/^\s*--/.test(l))
            .join('\n');
        expect(executable).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
        expect(executable).not.toMatch(/CREATE\s+TABLE/i);
    });
});
