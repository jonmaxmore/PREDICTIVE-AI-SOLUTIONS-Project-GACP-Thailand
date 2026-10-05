/**
 * Cleanup UAT seed data (run before re-seeding)
 * docker cp scripts/cleanup-uat.js gacp-backend:/app/apps/backend/cleanup-uat.js
 * docker exec -w /app/apps/backend gacp-backend node cleanup-uat.js
 */
let prisma;
try { prisma = require('../services/prisma-database').prisma; } catch { prisma = require('./services/prisma-database').prisma; }

const HIDS = [
    '1100100001001', '1100100001002', '1100100001003', '1100100001004', '1100100001005',
    '1100100001006', '1100100001007', '1100100001008', '1100100001009', '1100100001010',
];

async function cleanup() {
    console.log('Cleaning up UAT seed data...');

    const users = await prisma.user.findMany({ where: { healthId: { in: HIDS } }, select: { id: true, healthId: true } });
    const userIds = users.map(u => u.id);

    if (userIds.length === 0) {
        console.log('   No UAT users found. Nothing to clean.');
        return;
    }
    console.log(`   Found ${userIds.length} UAT users to clean`);

    // Delete in correct FK order
    const r1 = await prisma.harvestBatch.deleteMany({ where: { farm: { ownerId: { in: userIds } } } });
    console.log(`   Deleted ${r1.count} harvest batches`);

    const r2 = await prisma.plantingCycle.deleteMany({ where: { farm: { ownerId: { in: userIds } } } });
    console.log(`   Deleted ${r2.count} planting cycles`);

    const r3 = await prisma.plot.deleteMany({ where: { farm: { ownerId: { in: userIds } } } });
    console.log(`   Deleted ${r3.count} plots`);

    const r4 = await prisma.certificate.deleteMany({ where: { userId: { in: userIds } } });
    console.log(`   Deleted ${r4.count} certificates`);

    const r5 = await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    console.log(`   Deleted ${r5.count} notifications`);

    const r6 = await prisma.application.deleteMany({ where: { healthId: { in: HIDS } } });
    console.log(`   Deleted ${r6.count} applications`);

    const r7 = await prisma.farm.deleteMany({ where: { ownerId: { in: userIds } } });
    console.log(`   Deleted ${r7.count} farms`);

    const r8 = await prisma.user.deleteMany({ where: { healthId: { in: HIDS } } });
    console.log(`   Deleted ${r8.count} users`);

    console.log('Cleanup complete');
}

cleanup()
    .catch(e => { console.error('Error:', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
