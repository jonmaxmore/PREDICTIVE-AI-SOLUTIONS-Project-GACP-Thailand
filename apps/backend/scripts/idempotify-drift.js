// Convert the prisma migrate diff output to idempotent form so it can be
// applied safely against any DB state — fresh, partially-migrated, or
// already-in-target. Used to produce the reconcile_drift migration that
// aligns prisma/migrations history with prisma/schema.
//
//   node scripts/idempotify-drift.js < drift.sql > reconcile.sql
//
// The transform groups multi-line statements first (separated by blank
// lines and ending with `;`), then idempotifies each group as a whole.

'use strict';

const { readFileSync } = require('fs');

const input = readFileSync(0, 'utf8');

function groupStatements(text) {
    const groups = [];
    let buf = [];
    for (const line of text.split('\n')) {
        if (line.trim() === '') {
            if (buf.length) { groups.push(buf.join('\n')); buf = []; }
            continue;
        }
        if (line.trim().startsWith('--')) {
            // comment header for the next statement — keep separate
            if (buf.length) { groups.push(buf.join('\n')); buf = []; }
            groups.push(line);
            continue;
        }
        buf.push(line);
    }
    if (buf.length) {groups.push(buf.join('\n'));}
    return groups;
}

function wrapInDoBlock(stmt) {
    return [
        'DO $$ BEGIN',
        stmt.split('\n').map(l => '  ' + l).join('\n'),
        'EXCEPTION',
        '  WHEN duplicate_object THEN NULL;',
        '  WHEN duplicate_table THEN NULL;',
        '  WHEN duplicate_column THEN NULL;',
        '  WHEN duplicate_alias THEN NULL;',
        '  WHEN duplicate_function THEN NULL;',
        '  WHEN undefined_object THEN NULL;',
        '  WHEN undefined_table THEN NULL;',
        '  WHEN undefined_column THEN NULL;',
        '  WHEN undefined_function THEN NULL;',
        'END $$;',
    ].join('\n');
}

function idempotify(stmt) {
    if (stmt.trim().startsWith('--')) {return stmt;} // comment line

    // Simple single-line replacements
    let out = stmt
        .replace(/^ALTER TABLE "([^"]+)" DROP CONSTRAINT "([^"]+)";/m,
            'ALTER TABLE IF EXISTS "$1" DROP CONSTRAINT IF EXISTS "$2";')
        .replace(/^DROP INDEX "([^"]+)";/m, 'DROP INDEX IF EXISTS "$1";')
        .replace(/^DROP TABLE "([^"]+)";/m, 'DROP TABLE IF EXISTS "$1" CASCADE;')
        .replace(/^CREATE TABLE "([^"]+)" \(/m, 'CREATE TABLE IF NOT EXISTS "$1" (')
        .replace(/^CREATE INDEX "([^"]+)" ON/m, 'CREATE INDEX IF NOT EXISTS "$1" ON')
        .replace(/^CREATE UNIQUE INDEX "([^"]+)" ON/m, 'CREATE UNIQUE INDEX IF NOT EXISTS "$1" ON');

    // Multi-line ALTER TABLE: idempotify every column inside.
    // Use \s+ to match 1+ whitespace (Prisma sometimes pads with multiple
    // spaces between ADD COLUMN and the column name).
    if (/^ALTER TABLE "[^"]+"/.test(out)) {
        out = out
            .replace(/DROP COLUMN\s+"([^"]+)"/g, 'DROP COLUMN IF EXISTS "$1"')
            .replace(/ADD COLUMN\s+"([^"]+)"/g, 'ADD COLUMN IF NOT EXISTS "$1"')
            .replace(/^ALTER TABLE "/, 'ALTER TABLE IF EXISTS "');
        // ALTER COLUMN ... — wrap whole statement in DO block since there
        // is no IF EXISTS form for ALTER COLUMN.
        if (/ALTER COLUMN /.test(out)) {
            out = wrapInDoBlock(out);
        }
        // ADD CONSTRAINT — wrap in DO block (FK constraint may exist)
        else if (/ADD CONSTRAINT /.test(out)) {
            out = wrapInDoBlock(out);
        }
    }

    // ALTER INDEX RENAME — wrap in DO block
    if (/^ALTER INDEX "[^"]+" RENAME TO/.test(out)) {
        out = wrapInDoBlock(out);
    }

    return out;
}

const groups = groupStatements(input);
const transformed = groups.map(idempotify);

const header = `-- Wave C — schema-drift reconciliation (auto-generated, idempotent).
--
-- Bridges the gap between prisma/migrations history and prisma/schema.
-- Every operation is safe to apply against:
--   1. A fresh DB (creates everything to schema state)
--   2. A partially-migrated DB
--   3. A DB already in target state (no-op)
--
-- Re-generate with:
--   prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema --shadow-database-url <url> --script | node scripts/idempotify-drift.js > apps/backend/prisma/migrations/<ts>_reconcile_drift/migration.sql
`;

process.stdout.write(header + '\n' + transformed.join('\n\n') + '\n');
