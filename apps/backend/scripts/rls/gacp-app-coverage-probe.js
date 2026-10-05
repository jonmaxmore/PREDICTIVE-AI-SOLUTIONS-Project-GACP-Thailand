'use strict';
// gacp_app coverage probe — RLS Phase 1 (role decouple), Task 2.
//
// Proves Task 1's grants (scripts/rls/gacp-app-provision.sql) are COMPLETE and
// catches future drift: a migration adds a table but the grant wasn't re-run
// -> the app would break at boot under gacp_app. INTENDED to run in CI after
// every migration + on staging pre-cutover — NOT yet wired to CI (no pipeline
// hooks it up; Actions off since 2026-08-14). Run by hand for now; see the
// cutover runbook (docs/operations/rls-phase1-gacp-app-cutover.md).
//
// RULING 4 (deviation from task-2-brief.md, applied as decided, not re-derived):
// the brief's verbatim probe query used the SAME predicate as Task 1's grant
// (relkind='r'), which means the probe would share the grant's blind spot — a
// partitioned PARENT table (relkind='p') added later & left ungranted would be
// skipped by BOTH, so the drift would slip through undetected. A drift-net
// must be a STRICT SUPERSET of what it checks, so this probe's pg_class query
// is widened to relkind IN ('r','p') (base tables + partitioned parents) while
// keeping everything else — including nspname='public' and the DML set below —
// identical to Task 1's grant scope. This is a no-op today (zero partitioned
// tables exist); it only starts flagging if a partitioned parent is ever added
// ungranted, which is the correct behavior.
const DML = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

async function findUngrantedTables(prisma) {
  const tables = await prisma.$queryRawUnsafe(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
     WHERE c.relkind IN ('r','p') -- relkind IN ('r','p'): base + partitioned parents, so the probe is a strict superset of the grant scope (catches an ungranted partition parent).
       AND ns.nspname='public' ORDER BY c.relname`,
  );
  const gaps = [];
  for (const { relname } of tables) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await prisma.$queryRawUnsafe(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee='gacp_app' AND table_schema='public' AND table_name=$1`, relname);
    const have = new Set(rows.map((r) => r.privilege_type));
    const missing = DML.filter((p) => !have.has(p));
    if (missing.length) { gaps.push({ table: relname, missing }); }
  }
  return gaps;
}

module.exports = { findUngrantedTables };

if (require.main === module) {
  (async () => {
    if (!process.env.DATABASE_URL) { console.log('SKIP: no DATABASE_URL'); process.exit(0); }
    // eslint-disable-next-line global-require
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
      const gaps = await findUngrantedTables(prisma);
      if (gaps.length) {
        console.error(`FAIL: ${gaps.length} public tables lack full DML for gacp_app:`);
        for (const g of gaps) { console.error(`  ${g.table}: missing ${g.missing.join(',')}`); }
        process.exit(1);
      }
      console.log('PASS: gacp_app has full DML on every public base table.');
    } finally { await prisma.$disconnect(); }
  })();
}
