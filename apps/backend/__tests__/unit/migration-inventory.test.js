/**
 * Migration inventory assertion test.
 *
 * Iter 27 — DBA schema reconciliation (2026-05-16).
 *
 * Static-analysis guard that prevents three classes of regression:
 *
 *   1. Loose .sql files at the migrations root (the convention is
 *      `YYYYMMDDHHMMSS_name/migration.sql`). Such files are silently
 *      ignored by `prisma migrate deploy` and create drift.
 *   2. New non-timestamped migration directories (anything other than
 *      the two grandfathered exceptions: `manual/` and
 *      `add_dtam_requirements/`, both documented in
 *      `docs/dba/schema-reconciliation-2026-05-16.md`).
 *   3. Every Prisma model in `prisma/schema/*.prisma` should resolve
 *      to a table name that appears in at least one migration's SQL
 *      (CREATE TABLE / ALTER TABLE) — i.e. no "orphan model" that the
 *      schema declares but no migration ever materialises.
 *
 * The check is purely filesystem + grep — it does NOT connect to a
 * database. For live drift detection run `npx prisma migrate status`
 * against the target environment (see the doc above for the procedure).
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.resolve(__dirname, '../../prisma/migrations');
const SCHEMA_DIR = path.resolve(__dirname, '../../prisma/schema');

// Folders allowed to exist without the YYYYMMDDHHMMSS_ prefix. Document
// any addition here in docs/dba/schema-reconciliation-2026-05-16.md.
const GRANDFATHERED_DIRS = new Set(['manual', 'add_dtam_requirements']);

// Files allowed to live at the migrations root.
const ALLOWED_ROOT_FILES = new Set([
    'migration_lock.toml',
    'CHANGELOG.md',
    '_UNREGISTERED_SQL_WARNING.md',
    // The rule that an applied migration is never edited again — written 2026-08-27, the
    // day three migrations were applied to the shared demo database mid-work, and placed
    // here, beside the files it governs, because a rule that lives elsewhere is a rule the
    // next editor of this directory never sees.
    'APPLIED-IS-FROZEN.md',
]);

describe('[Iter 27] Migration inventory', () => {
    let entries;
    let allMigrationSql = '';

    beforeAll(() => {
        entries = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) {continue;}
            const sqlPath = path.join(MIGRATIONS_DIR, entry.name, 'migration.sql');
            if (fs.existsSync(sqlPath)) {
                allMigrationSql += '\n' + fs.readFileSync(sqlPath, 'utf8');
            }
        }
    });

    test('no loose .sql files at the migrations root', () => {
        const looseSql = entries
            .filter((e) => e.isFile() && e.name.endsWith('.sql'))
            .map((e) => e.name);
        expect(looseSql).toEqual([]);
    });

    test('every directory either has timestamp prefix or is grandfathered', () => {
        const TIMESTAMP_RE = /^\d{14}_/;
        const violations = entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .filter((name) => !TIMESTAMP_RE.test(name) && !GRANDFATHERED_DIRS.has(name));
        expect(violations).toEqual([]);
    });

    test('only the allowed non-migration files live at the migrations root', () => {
        const violators = entries
            .filter((e) => e.isFile() && !ALLOWED_ROOT_FILES.has(e.name))
            .map((e) => e.name);
        expect(violators).toEqual([]);
    });

    test('every Prisma model resolves to a table referenced in migrations', () => {
        // Parse model -> @@map table name from every schema file. If no
        // @@map is declared, Prisma defaults to the model name as-is.
        const modelToTable = {};
        const schemaFiles = fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.prisma'));
        for (const f of schemaFiles) {
            const text = fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8');
            // Match `model Foo { ... }` blocks; capture body for @@map lookup.
            const modelRe = /model\s+(\w+)\s*\{([^}]*)\}/g;
            let m;
            while ((m = modelRe.exec(text)) !== null) {
                const modelName = m[1];
                const body = m[2];
                const mapMatch = body.match(/@@map\s*\(\s*["']([^"']+)["']\s*\)/);
                modelToTable[modelName] = mapMatch ? mapMatch[1] : modelName;
            }
        }

        // For each table name, look for it inside any migration.sql. We
        // accept the literal quoted identifier anywhere — CREATE TABLE,
        // ALTER TABLE, FK, or index DDL all leave the table name in the
        // SQL stream.
        const orphans = [];
        for (const [model, table] of Object.entries(modelToTable)) {
            const needle = `"${table}"`;
            if (!allMigrationSql.includes(needle)) {
                orphans.push({ model, table });
            }
        }

        // Soft assertion: warn but don't fail. A handful of models map
        // to tables that arrived via `prisma db push` in early sprints
        // and were reconciled later (see
        // 20260305163000_reconcile_schema_gap_for_migrate_deploy and
        // 20260429110000_align_certification_purpose_columns_with_schema).
        // The doc lists the known orphans; the test asserts the count
        // does not grow.
        const KNOWN_ORPHAN_LIMIT = 25;
        if (orphans.length > KNOWN_ORPHAN_LIMIT) {
             
            console.warn(
                `[migration-inventory] ${orphans.length} models lack a matching table reference in migrations:`,
                orphans.map((o) => `${o.model}->${o.table}`).join(', '),
            );
        }
        expect(orphans.length).toBeLessThanOrEqual(KNOWN_ORPHAN_LIMIT);
    });
});
