'use strict';

/**
 * The database must be at the migration level the code was built for — checked at boot.
 *
 * WHY THIS EXISTS
 *   On 2026-08-26 a pressed walk reached the onsite visit and every photograph the auditor
 *   uploaded was refused with HTTP 500: `Unknown argument farmDistanceMeters`. The code in
 *   the tree wrote eight new columns to farm_audit_photos; the database had none of them,
 *   because the migrations that add them had been written and — correctly, as Tier C work —
 *   not applied. Nothing noticed. The backend booted, served every read, passed health, and
 *   failed only at the first WRITE that touched a new column, deep in the field app, on the
 *   evidence a certificate rests on.
 *
 *   Three migrations were pending, not one. Applying the one that was noticed and
 *   regenerating the client would have made things worse: the client would then SELECT
 *   `cultivationScopeCount` on every application read and the database would refuse every
 *   page.
 *
 *   In production the deploy order handles this — `migrate deploy` runs before the new image
 *   takes traffic. On a development box against a shared remote database there is no such
 *   ordering: whoever restarts on a newer tree silently breaks the database's contract with
 *   the code. That gap is what this guard closes.
 *
 * WHAT IT DOES
 *   Reads `_prisma_migrations` and compares against the migration directories in the tree.
 *   Any migration in the tree that the database has not applied (or applied and rolled back)
 *   is PENDING. Pending migrations mean the code may reference columns that do not exist:
 *     - production / REQUIRE_MIGRATIONS_CURRENT=true: refuse to boot, naming each one. A
 *       server that would 500 on its first important write is better off not answering.
 *     - development / test: log at ERROR, loudly, once, with the exact command — and keep
 *       booting, because a developer mid-change needs the process up to see anything at all.
 *       The log line is the difference between "the photo door is broken" and "you forgot
 *       to migrate"; the previous incident had neither.
 *
 *   A migration in the database that is NOT in the tree is reported too: that is a tree
 *   older than the database, which is safe under expand-before-contract but worth knowing.
 *
 * WHAT IT DOES NOT DO
 *   It does not apply anything. Applying a migration is a deliberate act with an audit trail
 *   (`prisma migrate deploy`), never a boot side-effect — a boot that mutates schema is the
 *   same shape as the seed that ran on require, and that cost real data.
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

/**
 * Migration directory names in the tree, in the order Prisma applies them.
 *
 * A migration is a directory that contains `migration.sql` — that, and only that, is
 * Prisma's own definition. The first draft of this function filtered on a 14-digit
 * timestamp prefix instead, and on its very first boot reported two real, applied,
 * in-tree migrations (`add_dtam_requirements`, `manual`, hand-named on 2026-08-16) as
 * "the database has migrations this tree does not". A guard that mis-describes the
 * tree on day one is the kind of noise that gets its warnings ignored on day two.
 */
function migrationsInTree(dir = MIGRATIONS_DIR) {
    if (!fs.existsSync(dir)) { return []; }
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'migration.sql')))
        .map((e) => e.name)
        .sort();
}

/**
 * @param {object} prisma a client with $queryRawUnsafe
 * @param {object} [opts]
 * @param {string} [opts.dir] override for tests
 * @returns {Promise<{ pending: string[], unknownToTree: string[], applied: number }>}
 */
async function inspectMigrationLevel(prisma, opts = {}) {
    const tree = migrationsInTree(opts.dir);
    const rows = await prisma.$queryRawUnsafe(
        'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations',
    );
    const applied = new Set(
        rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name),
    );
    return {
        pending: tree.filter((name) => !applied.has(name)),
        unknownToTree: [...applied].filter((name) => !tree.includes(name)).sort(),
        applied: applied.size,
    };
}

function isStrict(env = process.env) {
    return env.NODE_ENV === 'production' || String(env.REQUIRE_MIGRATIONS_CURRENT).toLowerCase() === 'true';
}

/**
 * Boot-time entry point. Throws in strict mode when migrations are pending.
 *
 * @param {object} prisma
 * @param {{ logger: { error: Function, warn: Function, info: Function }, env?: object, dir?: string }} deps
 */
async function assertMigrationLevelAtBoot(prisma, { logger, env = process.env, dir } = {}) {
    let level;
    try {
        level = await inspectMigrationLevel(prisma, { dir });
    } catch (error) {
        // No _prisma_migrations table, or the database is unreachable. Both are answered by
        // the connection checks that already run at boot; this guard only judges LEVEL, and
        // it must not turn an unreachable database into a second, confusing error.
        logger.warn(`[migration-level] could not read _prisma_migrations: ${error.message}`);
        return null;
    }

    if (level.unknownToTree.length) {
        logger.warn(
            `[migration-level] the database has ${level.unknownToTree.length} migration(s) this tree does not: `
            + `${level.unknownToTree.join(', ')} — the tree is older than the database (safe under `
            + 'expand-before-contract, but this build cannot read the newer columns).',
        );
    }

    if (level.pending.length === 0) {
        logger.info(`[migration-level] database is current (${level.applied} migrations applied)`);
        return level;
    }

    const message = `[migration-level] ${level.pending.length} migration(s) in this tree are NOT applied to the database: `
        + `${level.pending.join(', ')}. The code may read or write columns that do not exist yet — the failure `
        + 'surfaces as HTTP 500 on the first request that touches one, not here. Apply them deliberately: '
        + 'cd apps/backend && npx prisma migrate deploy --schema prisma/schema';

    if (isStrict(env)) {
        throw new Error(`${message} (refusing to boot: NODE_ENV=production or REQUIRE_MIGRATIONS_CURRENT=true)`);
    }
    logger.error(message);
    return level;
}

module.exports = {
    assertMigrationLevelAtBoot,
    inspectMigrationLevel,
    migrationsInTree,
    isStrict,
};
