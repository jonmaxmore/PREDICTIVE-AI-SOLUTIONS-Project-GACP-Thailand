/**
 * Production SQL Migration: Standardize GACP User Types
 * 
 * Changes:
 *   role: Applicant → HEALTH
 *   accountType: provider → PROVIDER
 *   audit_logs.actorType: DTAM_PROVIDER → PROVIDER
 *   certificates.ApplicantName → applicantName
 *   DROP dtam_PROVIDER table
 */

const { PrismaClient } = require('@prisma/client');

// Privileged: this script runs ALTER/DROP, which the app's least-priv
// gacp_app role cannot do post-cutover. The admin URL is resolved lazily,
// inside main() rather than at module load, so requiring this file (nothing
// does today — grep confirms) never throws just because env vars are
// unset; only running it as a script (see the require.main guard below)
// resolves the URL and connects.
let prisma;

async function main() {
    const { url, usedFallback } = require('./lib/admin-db-url').resolveAdminDbUrl();
    if (usedFallback) {
        console.warn('[admin-db] ADMIN_DATABASE_URL unset — falling back to DATABASE_URL; ALTER/DROP will FAIL under gacp_app');
    }
    prisma = new PrismaClient({ datasources: { db: { url } } });

    console.log('Starting GACP User Type Migration...\n');

    // 1. Check current counts before migration
    console.log('=== BEFORE ===');
    const ApplicantCount = await prisma.user.count({ where: { role: 'Applicant' } });
    const PROVIDERCount = await prisma.user.count({ where: { accountType: 'PROVIDER' } });
    const healthCount = await prisma.user.count({ where: { role: 'HEALTH' } });
    const providerCount = await prisma.user.count({ where: { accountType: 'PROVIDER' } });
    console.log(`  Users with role=Applicant: ${ApplicantCount}`);
    console.log(`  Users with accountType=provider: ${PROVIDERCount}`);
    console.log(`  Users with role=HEALTH: ${healthCount}`);
    console.log(`  Users with accountType=PROVIDER: ${providerCount}`);

    // Count audit_logs with DTAM_PROVIDER
    let dtamPROVIDERLogs = 0;
    try {
        const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM audit_logs WHERE "actorType" = 'DTAM_PROVIDER'`);
        dtamPROVIDERLogs = Number(result[0]?.count || 0);
    } catch (_e) {
        console.log('  audit_logs table may not exist or actorType column missing');
    }
    console.log(`  audit_logs with actorType=DTAM_PROVIDER: ${dtamPROVIDERLogs}`);
    console.log('');

    // 2. Run migrations
    console.log('=== MIGRATING ===');

    // 2a. Update Applicant → HEALTH
    if (ApplicantCount > 0) {
        const updated = await prisma.$executeRawUnsafe(`UPDATE "User" SET role = 'HEALTH' WHERE role = 'Applicant'`);
        console.log(`role Applicant → HEALTH: ${updated} rows`);
    } else {
        console.log('No Applicant roles to update');
    }

    // 2b. Update provider → PROVIDER
    if (PROVIDERCount > 0) {
        const updated = await prisma.$executeRawUnsafe(`UPDATE "User" SET "accountType" = 'PROVIDER' WHERE "accountType" = 'PROVIDER'`);
        console.log(`accountType provider → PROVIDER: ${updated} rows`);
    } else {
        console.log('No provider accountTypes to update');
    }

    // 2c. Update audit_logs
    if (dtamPROVIDERLogs > 0) {
        const updated = await prisma.$executeRawUnsafe(`UPDATE audit_logs SET "actorType" = 'PROVIDER' WHERE "actorType" = 'DTAM_PROVIDER'`);
        console.log(`audit_logs DTAM_PROVIDER → PROVIDER: ${updated} rows`);
    } else {
        console.log('No DTAM_PROVIDER audit_logs to update');
    }

    // 2d. Rename ApplicantName → applicantName on certificates
    try {
        await prisma.$executeRawUnsafe(`ALTER TABLE certificates RENAME COLUMN "ApplicantName" TO "applicantName"`);
        console.log('certificates.ApplicantName → applicantName');
    } catch (e) {
        if (e.message.includes('does not exist') || e.message.includes('already exists')) {
            console.log('certificates column already renamed or does not exist');
        } else {
            console.log(`certificates rename error: ${e.message}`);
        }
    }

    // 2e. Drop dtam_PROVIDER table
    try {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS dtam_PROVIDER CASCADE`);
        console.log('dtam_PROVIDER table dropped');
    } catch (e) {
        console.log(`dtam_PROVIDER drop error: ${e.message}`);
    }

    // 3. Verify after migration
    console.log('\n=== AFTER ===');
    const ApplicantAfter = await prisma.user.count({ where: { role: 'Applicant' } });
    const PROVIDERAfter = await prisma.user.count({ where: { accountType: 'PROVIDER' } });
    const healthAfter = await prisma.user.count({ where: { role: 'HEALTH' } });
    const providerAfter = await prisma.user.count({ where: { accountType: 'PROVIDER' } });
    console.log(`Users with role=Applicant: ${ApplicantAfter} ${ApplicantAfter === 0 ?'':''}`);
    console.log(`Users with accountType=provider: ${PROVIDERAfter} ${PROVIDERAfter === 0 ?'':''}`);
    console.log(`  Users with role=HEALTH: ${healthAfter}`);
    console.log(`  Users with accountType=PROVIDER: ${providerAfter}`);

    // Show all distinct roles
    const roles = await prisma.$queryRawUnsafe(`SELECT DISTINCT role, COUNT(*) as count FROM "User" GROUP BY role ORDER BY count DESC`);
    console.log('\n=== ALL ROLES ===');
    roles.forEach(r => console.log(`  ${r.role}: ${r.count}`));

    const types = await prisma.$queryRawUnsafe(`SELECT DISTINCT "accountType", COUNT(*) as count FROM "User" GROUP BY "accountType" ORDER BY count DESC`);
    console.log('\n=== ALL ACCOUNT TYPES ===');
    types.forEach(t => console.log(`  ${t.accountType}: ${t.count}`));

    console.log('\n Migration complete!');
}

if (require.main === module) {
    main()
        .catch(e => { console.error('Migration failed:', e); process.exit(1); })
        .finally(() => prisma && prisma.$disconnect());
}
