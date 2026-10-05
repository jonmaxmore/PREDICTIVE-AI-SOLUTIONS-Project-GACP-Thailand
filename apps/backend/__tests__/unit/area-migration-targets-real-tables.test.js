/**
 * The area-to-square-metres migration has to name the tables Postgres has.
 *
 * It did not. Every statement was addressed to the Prisma *model* name —
 * `"Farm"`, `"Plot"`, `"PlantingCycle"` — while the models carry
 * `@@map("farms")`, `@@map("plots")` and `@@map("planting_cycles")`, so those
 * relations do not exist in the database under those names.
 *
 * That alone would have been loud. What made it silent was the guard wrapped
 * around each statement for safety:
 *
 *     IF to_regclass('public."Farm"') IS NOT NULL THEN ... END IF;
 *
 * `to_regclass` returns NULL for a relation that does not exist, so every
 * branch was false and the whole migration became a no-op that reported
 * success. The idempotency guard turned "wrong table name" into "quietly do
 * nothing" — the failure mode the migration was written to prevent.
 *
 * The consequence is not cosmetic. Legacy rows stay in rai while every read
 * path now assumes square metres, which is the 1,600x error recorded in the
 * migration's own header: a farmer who entered 1,600 ตร.ม. gets a certified
 * farm of 1,600 rai. CI's Migration Drift Check caught the column defaults,
 * because drift compares the schema against the migrations. It could not have
 * caught the data conversion — nothing compares that to anything.
 *
 * So this test reads the migration and the schema and checks the names against
 * each other, which is the only check that would have failed on the original.
 */

const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(
    __dirname,
    '../../prisma/migrations/20260725190000_area_to_sqm/migration.sql',
);
const SCHEMA_DIR = path.join(__dirname, '../../prisma/schema');

const sql = fs.readFileSync(MIGRATION, 'utf8');

/**
 * The migration with its `--` comments stripped.
 *
 * The header deliberately explains the `to_regclass` guard that made the
 * original a silent no-op, so a check for that guard has to look at what
 * Postgres will execute rather than at what the file says.
 */
const executableSql = sql.replace(/--.*$/gm, '');

/** Every physical table name the schema declares via `@@map`. */
const mappedTables = () => {
    const names = new Set();
    for (const file of fs.readdirSync(SCHEMA_DIR).filter((name) => name.endsWith('.prisma'))) {
        const source = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8');
        for (const [, table] of source.matchAll(/@@map\("([^"]+)"\)/g)) {
            names.add(table);
        }
    }
    return names;
};

/** Quoted identifiers the migration addresses statements to. */
const targetedTables = () => {
    const names = new Set();
    for (const [, table] of sql.matchAll(/(?:UPDATE|ALTER TABLE)\s+"([^"]+)"/g)) {
        names.add(table);
    }
    return names;
};

describe('the area-to-sqm migration', () => {
    describe('it addresses tables that exist', () => {
        it('targets at least one table, so the extraction itself is not vacuous', () => {
            expect(targetedTables().size).toBeGreaterThan(0);
        });

        it('names only tables the schema actually maps', () => {
            const mapped = mappedTables();
            const unknown = [...targetedTables()].filter((table) => !mapped.has(table));
            expect(unknown).toEqual([]);
        });

        it('converts the three tables that carry an areaUnit', () => {
            const targeted = targetedTables();
            for (const table of ['farms', 'plots', 'planting_cycles']) {
                expect(targeted).toContain(table);
            }
        });
    });

    describe('it does not address Prisma model names', () => {
        it.each(['Farm', 'Plot', 'PlantingCycle', 'HarvestBatch'])(
            'never writes to "%s"',
            (model) => {
                // A model name in a migration is a statement aimed at a relation
                // Postgres does not have.
                expect(sql).not.toMatch(new RegExp(`(?:UPDATE|ALTER TABLE)\\s+"${model}"`));
            },
        );

        it('does not mention harvest_batches, which has no area columns', () => {
            // The original had a HarvestBatch block setting `plotArea` and
            // `areaUnit`. That model has neither, so renaming the table would
            // have swapped a silent no-op for a hard failure on a missing
            // column. The block does not belong here at all.
            expect(targetedTables()).not.toContain('harvest_batches');
        });
    });

    describe('the column defaults move with the data', () => {
        it.each(['farms', 'plots', 'planting_cycles'])(
            'sets the %s default to sqm',
            (table) => {
                // Without this the schema says sqm, the database says rai, and
                // any row inserted without an explicit unit is silently wrong.
                // This is what Migration Drift Check reported.
                expect(sql).toMatch(
                    new RegExp(`ALTER TABLE "${table}" ALTER COLUMN "areaUnit" SET DEFAULT 'sqm'`),
                );
            },
        );
    });

    describe('it cannot silently do nothing again', () => {
        it('does not guard its statements behind to_regclass', () => {
            // These tables are created by earlier migrations, so by the time
            // this one runs they are present. A guard here buys nothing and
            // costs the only signal that the names are wrong: with it, a typo
            // reports success; without it, the migration fails and says so.
            expect(executableSql).not.toMatch(/to_regclass/);
        });
    });
});
