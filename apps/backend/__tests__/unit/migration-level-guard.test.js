'use strict';

/**
 * The code must not run ahead of the database — and the boot must say so.
 *
 * On 2026-08-26 the backend booted cleanly on a tree whose Prisma schema had three migrations
 * the database had never seen. Every read worked. The first write that touched a new column —
 * an auditor's onsite photograph, the evidence a certificate rests on — returned HTTP 500 with
 * `Unknown argument farmDistanceMeters`. Nothing at boot had said the database was behind.
 *
 * These tests drive the guard with a fake client and a temp migrations directory, so no real
 * database and no real migration state is involved. What is pinned:
 *   - a tree migration the database has not applied is PENDING;
 *   - a migration applied-then-rolled-back is PENDING (Prisma keeps the row);
 *   - strict mode (production, or REQUIRE_MIGRATIONS_CURRENT=true) REFUSES to boot;
 *   - lax mode logs at ERROR — not warn, not info — and names the command;
 *   - a database newer than the tree is reported, not refused;
 *   - an unreadable _prisma_migrations does not become a second, confusing error.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    assertMigrationLevelAtBoot,
    inspectMigrationLevel,
    migrationsInTree,
    isStrict,
} = require('../../config/migration-level-guard');

function treeWith(...names) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-guard-'));
    for (const name of names) {
        fs.mkdirSync(path.join(dir, name));
        fs.writeFileSync(path.join(dir, name, 'migration.sql'), '-- test');
    }
    // Directories that are not migrations must be ignored, not counted as pending.
    fs.mkdirSync(path.join(dir, 'not-a-migration'));
    fs.writeFileSync(path.join(dir, 'APPLIED-IS-FROZEN.md'), '# rule');
    return dir;
}

function dbWith(rows) {
    return { $queryRawUnsafe: async () => rows };
}

function fakeLogger() {
    const calls = { error: [], warn: [], info: [] };
    return {
        calls,
        error: (m) => calls.error.push(m),
        warn: (m) => calls.warn.push(m),
        info: (m) => calls.info.push(m),
    };
}

const A = '20260101000000_a';
const B = '20260102000000_b';
const C = '20260103000000_c';
const done = (name) => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null });

describe('migrationsInTree', () => {
    it('lists every directory that contains migration.sql, in order', () => {
        const dir = treeWith(B, A);

        expect(migrationsInTree(dir)).toEqual([A, B]);
    });

    it('counts a hand-named migration too — Prisma does, so the guard must', () => {
        // This repo has two: `add_dtam_requirements` and `manual`, applied 2026-08-16. The
        // first draft filtered on a timestamp prefix and reported both as "in the database
        // but not in the tree" on its very first boot — a false warning from a guard whose
        // whole value is that its warnings are true.
        const dir = treeWith(A, 'manual');

        expect(migrationsInTree(dir)).toEqual([A, 'manual']);
    });

    it('ignores a directory with no migration.sql, whatever it is called', () => {
        const dir = treeWith(A);
        fs.mkdirSync(path.join(dir, '20260101000000_looks_like_one_but_is_empty'));

        expect(migrationsInTree(dir)).toEqual([A]);
    });

    it('is empty, not an error, when the directory does not exist', () => {
        expect(migrationsInTree(path.join(os.tmpdir(), 'does-not-exist-' + Date.now()))).toEqual([]);
    });
});

describe('inspectMigrationLevel', () => {
    it('reports a tree migration the database has not applied as pending', async () => {
        const dir = treeWith(A, B, C);
        const level = await inspectMigrationLevel(dbWith([done(A)]), { dir });

        expect(level.pending).toEqual([B, C]);
        expect(level.applied).toBe(1);
    });

    it('treats a rolled-back migration as pending — the row exists, the effect does not', async () => {
        const dir = treeWith(A);
        const level = await inspectMigrationLevel(dbWith([
            { migration_name: A, finished_at: new Date(), rolled_back_at: new Date() },
        ]), { dir });

        expect(level.pending).toEqual([A]);
    });

    it('treats an unfinished migration as pending', async () => {
        const dir = treeWith(A);
        const level = await inspectMigrationLevel(dbWith([
            { migration_name: A, finished_at: null, rolled_back_at: null },
        ]), { dir });

        expect(level.pending).toEqual([A]);
    });

    it('reports migrations the database has that the tree does not', async () => {
        const dir = treeWith(A);
        const level = await inspectMigrationLevel(dbWith([done(A), done(B)]), { dir });

        expect(level.pending).toEqual([]);
        expect(level.unknownToTree).toEqual([B]);
    });
});

describe('assertMigrationLevelAtBoot', () => {
    it('is silent-but-informative when the database is current', async () => {
        const dir = treeWith(A, B);
        const logger = fakeLogger();

        await assertMigrationLevelAtBoot(dbWith([done(A), done(B)]), { logger, env: {}, dir });

        expect(logger.calls.error).toEqual([]);
        expect(logger.calls.info.join('\n')).toMatch(/current/);
    });

    it('REFUSES to boot in production when a migration is pending, naming it', async () => {
        const dir = treeWith(A, B);
        const logger = fakeLogger();

        await expect(assertMigrationLevelAtBoot(dbWith([done(A)]), {
            logger, env: { NODE_ENV: 'production' }, dir,
        })).rejects.toThrow(new RegExp(B));
    });

    it('REFUSES under REQUIRE_MIGRATIONS_CURRENT=true in any environment', async () => {
        const dir = treeWith(A);
        const logger = fakeLogger();

        await expect(assertMigrationLevelAtBoot(dbWith([]), {
            logger, env: { NODE_ENV: 'development', REQUIRE_MIGRATIONS_CURRENT: 'true' }, dir,
        })).rejects.toThrow(/refusing to boot/);
    });

    it('in development logs at ERROR with the exact command, and lets the boot continue', async () => {
        const dir = treeWith(A, B);
        const logger = fakeLogger();

        const level = await assertMigrationLevelAtBoot(dbWith([done(A)]), {
            logger, env: { NODE_ENV: 'development' }, dir,
        });

        expect(level.pending).toEqual([B]);
        expect(logger.calls.error).toHaveLength(1);
        expect(logger.calls.error[0]).toMatch(/prisma migrate deploy --schema prisma\/schema/);
        expect(logger.calls.error[0]).toMatch(/HTTP 500/);
        // Not demoted to a warning: a warning is what nobody read last time.
        expect(logger.calls.warn.filter((m) => /NOT applied/.test(m))).toEqual([]);
    });

    it('a database newer than the tree is a warning, never a refusal', async () => {
        const dir = treeWith(A);
        const logger = fakeLogger();

        await expect(assertMigrationLevelAtBoot(dbWith([done(A), done(B)]), {
            logger, env: { NODE_ENV: 'production' }, dir,
        })).resolves.toBeTruthy();
        expect(logger.calls.warn.join('\n')).toMatch(new RegExp(B));
    });

    it('an unreadable _prisma_migrations is a warning, not a second boot error', async () => {
        const dir = treeWith(A);
        const logger = fakeLogger();
        const broken = { $queryRawUnsafe: async () => { throw new Error('relation "_prisma_migrations" does not exist'); } };

        const level = await assertMigrationLevelAtBoot(broken, { logger, env: { NODE_ENV: 'production' }, dir });

        expect(level).toBeNull();
        expect(logger.calls.warn.join('\n')).toMatch(/_prisma_migrations/);
    });
});

describe('isStrict', () => {
    it('is strict in production, or when asked, and lax otherwise', () => {
        expect(isStrict({ NODE_ENV: 'production' })).toBe(true);
        expect(isStrict({ NODE_ENV: 'development', REQUIRE_MIGRATIONS_CURRENT: 'true' })).toBe(true);
        expect(isStrict({ NODE_ENV: 'development' })).toBe(false);
        expect(isStrict({})).toBe(false);
    });
});
