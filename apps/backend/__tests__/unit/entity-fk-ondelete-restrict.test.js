/**
 * FIX #12 (carpet-bomb-inversion audit 2026-07-06) — the Entity → Application /
 * Entity → Farm relations must be `onDelete: Restrict`, NOT `onDelete: SetNull`.
 *
 * With SetNull, deleting an Entity silently NULLs its apps'/farms' `entityId`.
 * The null-intolerant read-scope (tenant-prisma-extension ANDs entityId on every
 * health read) then makes those rows invisible to their own owner — an
 * unhealable orphan. Restrict is the correct data-safety behavior: it blocks a
 * FUTURE delete of an entity that still owns apps/farms (archive them first)
 * rather than orphaning them.
 *
 * This is a static schema-contract assertion (no DB): it pins the onDelete
 * action on both relation lines + asserts the paired migration re-adds the FK
 * with ON DELETE RESTRICT. RED before the schema flip (SetNull), GREEN after.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_DIR = path.resolve(__dirname, '../../prisma/schema');
const MIGRATIONS_DIR = path.resolve(__dirname, '../../prisma/migrations');

function readSchema(name) {
    return fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8');
}

// Extract the `entity <Type>? @relation(...)` line that owns the entityId FK.
function entityRelationLine(schemaText) {
    const line = schemaText
        .split(/\r?\n/)
        .find((l) => /@relation\(/.test(l)
            && /fields:\s*\[entityId\]/.test(l)
            && /references:\s*\[id\]/.test(l));
    return line ? line.trim() : null;
}

describe('FIX #12 — Entity FK onDelete: Restrict (no silent re-nulling)', () => {
    test('Application.entity relation pins onDelete: Restrict', () => {
        const line = entityRelationLine(readSchema('application.prisma'));
        expect(line).toBeTruthy();
        expect(line).toMatch(/onDelete:\s*Restrict/);
        expect(line).not.toMatch(/onDelete:\s*SetNull/);
    });

    test('Farm.entity relation pins onDelete: Restrict', () => {
        const line = entityRelationLine(readSchema('farm.prisma'));
        expect(line).toBeTruthy();
        expect(line).toMatch(/onDelete:\s*Restrict/);
        expect(line).not.toMatch(/onDelete:\s*SetNull/);
    });

    // Return the ON DELETE action of EVERY `ADD CONSTRAINT "<name>" ... ON DELETE <x>`
    // statement across all migration blobs. Precise (not a loose file-wide substring
    // match) so an unrelated RESTRICT elsewhere in the same file — e.g. the
    // organizationId FKs in 20260502000000_reconcile_drift — cannot false-green this.
    function onDeleteActionsForConstraint(sqlBlobs, constraintName) {
        const re = new RegExp(
            `ADD\\s+CONSTRAINT\\s+"${constraintName}"[\\s\\S]*?ON\\s+DELETE\\s+(RESTRICT|SET\\s+NULL|CASCADE|NO\\s+ACTION)`,
            'gi',
        );
        const actions = [];
        for (const sql of sqlBlobs) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(sql)) !== null) {
                actions.push(m[1].toUpperCase().replace(/\s+/g, ' '));
            }
        }
        return actions;
    }

    test('a paired migration re-adds both entityId FKs with ON DELETE RESTRICT', () => {
        const dirs = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

        const sqlBlobs = dirs
            .map((d) => path.join(MIGRATIONS_DIR, d, 'migration.sql'))
            .filter((p) => fs.existsSync(p))
            .map((p) => fs.readFileSync(p, 'utf8'));

        expect(onDeleteActionsForConstraint(sqlBlobs, 'applications_entityId_fkey'))
            .toContain('RESTRICT');
        expect(onDeleteActionsForConstraint(sqlBlobs, 'farms_entityId_fkey'))
            .toContain('RESTRICT');
    });
});
