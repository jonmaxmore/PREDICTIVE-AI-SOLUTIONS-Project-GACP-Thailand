'use strict';
/**
 * Quotation acceptance snapshot (F-G4-64) — the schema and its expand migration agree.
 * Spec: design note 2026-08-28-quotation-acceptance-under-checkout-design §3.2.
 *
 * Pure file-system scan (no DB, no prisma client) — same shape as
 * __tests__/unit/certificate-revision-schema.test.js.
 */
const fs = require('fs');
const path = require('path');

const SCHEMA = path.resolve(__dirname, '../../prisma/schema/billing.prisma');
const MIG_DIR = path.resolve(__dirname, '../../prisma/migrations');
const EXTENSION_PATH = path.resolve(__dirname, '../../services/tenant-prisma-extension.js');
const MIGRATION = '20260828100000_quotation_acceptance_snapshot_expand';

/**
 * A column added NOT NULL with no default — the one shape that makes
 * `prisma migrate deploy` abort on a table that already holds rows.
 * The name class is every character Prisma emits in a column name: this table
 * pair mixes camelCase (`phase1InvoicedAt`) with snake_case (`quotation_id`),
 * so digits and underscores must be inside the class or the guard is blind to
 * two thirds of the columns it claims to watch.
 */
const ADD_COLUMN_NOT_NULL_NO_DEFAULT = /ADD COLUMN "[A-Za-z0-9_]+" [A-Z()0-9, ]+ NOT NULL(?! DEFAULT)/;

/** The text of one `model X { ... }` block, bounded at its own closing brace. */
function modelBlock(schema, name) {
    const start = schema.indexOf(`model ${name} {`);
    if (start < 0) { return ''; }
    const end = schema.indexOf('\n}', start);
    return schema.slice(start, end + 2);
}

/** The migration with its `--` comment lines removed: what the database actually executes. */
function executableSql(sql) {
    return sql.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');
}

describe('quotation acceptance snapshot — schema and expand migration agree', () => {
    const schema = fs.readFileSync(SCHEMA, 'utf8');

    it('Quotation carries the acceptance snapshot, its hash, the actor and the per-phase invoiced stamps', () => {
        const q = modelBlock(schema, 'Quotation');
        expect(q).toMatch(/acceptedSnapshot\s+Json\?/);
        expect(q).toMatch(/acceptedSnapshotHash\s+String\?/);
        expect(q).toMatch(/acceptedBy\s+String\?/);
        expect(q).toMatch(/phase1InvoicedAt\s+DateTime\?/);
        expect(q).toMatch(/phase2InvoicedAt\s+DateTime\?/);
    });

    it('CheckoutOrder is bound to the quotation and to the exact figures accepted', () => {
        const o = modelBlock(schema, 'CheckoutOrder');
        expect(o).toMatch(/quotationId\s+String\?/);
        expect(o).toMatch(/quotationSnapshotHash\s+String\?/);
        expect(o).toMatch(/paymentTermsVersion\s+String\?/);
        expect(o).toMatch(/paymentTermsAcceptedAt\s+DateTime\?/);
        expect(o).toMatch(/@@index\(\[quotationId\]\)/);
    });

    it('the quotation pointer is the same database type as the row it points at', () => {
        // Quotation.id is a uuid column; a TEXT pointer at it cannot be joined
        // (`operator does not exist: uuid = text`) and cannot carry a @relation.
        // Same correction DB-01 (journalEntryId) and DB-02 (postedJournalEntryId)
        // already made in this file.
        expect(modelBlock(schema, 'Quotation')).toMatch(/\bid\s+String\s+@id\b[^\n]*@db\.Uuid/);
        expect(modelBlock(schema, 'CheckoutOrder')).toMatch(/quotationId\s+String\?\s+@db\.Uuid/);
    });

    it('the expand migration exists and adds exactly those columns, dropping nothing', () => {
        const file = path.join(MIG_DIR, MIGRATION, 'migration.sql');
        expect(fs.existsSync(file)).toBe(true);
        const sql = executableSql(fs.readFileSync(file, 'utf8'));
        for (const col of ['acceptedSnapshot', 'acceptedSnapshotHash', 'acceptedBy',
            'phase1InvoicedAt', 'phase2InvoicedAt']) {
            expect(sql).toContain(`ALTER TABLE "quotations" ADD COLUMN "${col}"`);
        }
        for (const col of ['quotation_id', 'quotation_snapshot_hash',
            'payment_terms_version', 'payment_terms_accepted_at']) {
            expect(sql).toContain(`ALTER TABLE "checkout_orders" ADD COLUMN "${col}"`);
        }
        // The pointer column is UUID in SQL too, or the index and every later
        // join against quotations.id is unusable.
        expect(sql).toContain('ALTER TABLE "checkout_orders" ADD COLUMN "quotation_id" UUID;');
        expect(sql).toContain('CREATE INDEX');
        // Expand only: nothing is dropped, renamed, retyped or backfilled.
        expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT)/i);
        expect(sql).not.toMatch(/RENAME/i);
        expect(sql).not.toMatch(/\bUPDATE\s+"/i);
        // Every added column is nullable — no NOT NULL without a default on a live table.
        expect(sql).not.toMatch(ADD_COLUMN_NOT_NULL_NO_DEFAULT);
    });

    it('the expand-only guard sees column names with digits and underscores too', () => {
        // The guard above is only worth its line if it fires on the names this
        // very migration uses. Six of its nine columns contain a digit or an
        // underscore; a name class of [a-zA-Z]+ silently skips all six.
        expect('ALTER TABLE "checkout_orders" ADD COLUMN "quotation_id" TEXT NOT NULL;')
            .toMatch(ADD_COLUMN_NOT_NULL_NO_DEFAULT);
        expect('ALTER TABLE "quotations" ADD COLUMN "phase1InvoicedAt" TIMESTAMP(3) NOT NULL;')
            .toMatch(ADD_COLUMN_NOT_NULL_NO_DEFAULT);
        expect('ALTER TABLE "quotations" ADD COLUMN "acceptedBy" TEXT NOT NULL;')
            .toMatch(ADD_COLUMN_NOT_NULL_NO_DEFAULT);
        // …and stays quiet on the two shapes that are safe on a live table.
        expect('ALTER TABLE "checkout_orders" ADD COLUMN "quotation_id" UUID;')
            .not.toMatch(ADD_COLUMN_NOT_NULL_NO_DEFAULT);
        expect('ALTER TABLE "checkout_orders" ADD COLUMN "is_gated" BOOLEAN NOT NULL DEFAULT false;')
            .not.toMatch(ADD_COLUMN_NOT_NULL_NO_DEFAULT);
    });

    it('Quotation is registered tenant-scoped, beside Quote', () => {
        const ext = fs.readFileSync(EXTENSION_PATH, 'utf8');
        expect(ext).toMatch(/^\s*'Quotation',/m);
    });
});
