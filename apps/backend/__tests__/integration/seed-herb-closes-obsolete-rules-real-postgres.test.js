/**
 * fix round 4 — the seed's DB path, run for real (operator ruling 2026-10-05).
 * Old register: the 4 controlled_herb_license rows the previous seed filed (+ one decoy that must
 * survive). `--apply` closes exactly those 4, files the new rows, writes matching audit rows;
 * a second `--apply` closes 0 and files 0. The dry run names what WOULD be closed.
 * Skips cleanly without a verified test database.
 *
 * fix round 5 — HERMETIC: the seed closes and files register rows, so it runs in its OWN throwaway
 * database (created here, migrated, dropped in afterAll). The shared test database is never written,
 * so no other suite can see a different register whatever the order or worker split.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d, getTestDatabase } = require('../../test-support/test-database');

const SCRIPT = path.join(__dirname, '../../scripts/seed-herb-requirement-rules.js');
const OLD = [
    ['cannabis', 'PLANTING'], ['cannabis', 'PROCESSING'], ['kratom', 'PLANTING'], ['kratom', 'PROCESSING'],
];

const BACKEND = path.join(__dirname, '../..');
const ownDbName = `seed_herb_${process.pid}_${Date.now().toString(36)}`;
const urlFor = (dbName) => { const u = new URL(getTestDatabase().url); u.pathname = `/${dbName}`; return u.toString(); };

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, DATABASE_URL: urlFor(ownDbName), NODE_ENV: 'test' },
    encoding: 'utf8',
});

d('seed-herb-requirement-rules --apply against a real register', () => {
    let prisma;
    let admin;
    const ids = [];
    beforeAll(async () => {
        admin = new PrismaClient({ datasources: { db: { url: getTestDatabase().url } } });
        await admin.$executeRawUnsafe(`CREATE DATABASE "${ownDbName}"`);
        const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema'], {
            cwd: BACKEND, env: { ...process.env, DATABASE_URL: urlFor(ownDbName) }, encoding: 'utf8',
        });
        if (migrate.status !== 0) { throw new Error(`migrate deploy on the private database failed: ${String(migrate.stderr).slice(-400)}`); }
        prisma = new PrismaClient({ datasources: { db: { url: urlFor(ownDbName) } } });
        await prisma.$connect();
        await prisma.requirementRule.deleteMany({ where: { createdBy: { in: ['seed-herb-v1', 'old-seed-test'] } } }).catch(() => {});
        for (const [plantCode, certScope] of OLD) {
            const r = await prisma.requirementRule.create({
                data: {
                    requestType: 'NEW', plantCode, certScope, slotId: 'controlled_herb_license', isRequired: true,
                    effectiveFrom: new Date('2026-09-02T00:00:00Z'), createdBy: 'old-seed-test',
                },
            });
            ids.push(r.id);
        }
    }, 240000);
    afterAll(async () => {
        if (prisma) { await prisma.$disconnect(); }
        if (admin) {
            await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${ownDbName}" WITH (FORCE)`).catch(() => {});
            await admin.$disconnect();
        }
    });

    it('dry run lists exactly what would be closed and writes nothing', () => {
        const out = run([]);
        expect(out.status).toBe(0);
        expect(out.stdout).toMatch(/DRY RUN/);
        for (const id of ids) { expect(out.stdout).toContain(id); }
        expect(out.stdout).toMatch(/WOULD CLOSE 4/);
    });

    it('--apply closes the 4 old rows, files the new rows, audit rows match; second --apply is a no-op', async () => {
        const first = run(['--apply']);
        expect(first.status).toBe(0);
        expect(first.stdout).toMatch(/CLOSED 4 obsolete/);
        const closed = await prisma.requirementRule.findMany({ where: { id: { in: ids } } });
        expect(closed.every((r) => r.effectiveTo && r.closedBy === 'seed-herb-v1')).toBe(true);
        const audits = await prisma.auditLog.findMany({
            where: { action: 'REQUIREMENT_RULE_CLOSED', resourceId: { in: ids } },
        });
        expect(audits.map((a) => a.resourceId).sort()).toEqual([...ids].sort());
        const filed = await prisma.requirementRule.count({ where: { createdBy: 'seed-herb-v1' } });
        expect(filed).toBeGreaterThan(100);
        const created = await prisma.auditLog.count({ where: { action: 'REQUIREMENT_RULE_CREATED' } });
        expect(created).toBe(filed);
        const stillOpenObsolete = await prisma.requirementRule.count({
            where: { slotId: 'controlled_herb_license', effectiveTo: null },
        });
        expect(stillOpenObsolete).toBe(0);

        const second = run(['--apply']);
        expect(second.status).toBe(0);
        expect(second.stdout).toMatch(/CLOSED 0 obsolete/);
        expect(second.stdout).toMatch(/FILED 0 rule\(s\)/);
        expect(await prisma.requirementRule.count({ where: { createdBy: 'seed-herb-v1' } })).toBe(filed);
        expect(await prisma.auditLog.count({ where: { action: 'REQUIREMENT_RULE_CLOSED', resourceId: { in: ids } } })).toBe(4);
    }, 120000);
});
