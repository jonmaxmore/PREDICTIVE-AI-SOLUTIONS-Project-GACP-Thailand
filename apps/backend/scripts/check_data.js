const { prisma } = require('../services/prisma-database');

async function main() {
    console.log('Checking UAT Data...');
    const user = await prisma.user.findFirst({
        where: { email: 'uat_Applicant_final@test.com' },
        include: { farms: true },
    });

    if (!user) {
        console.log('User NOT FOUND');
        return;
    }
    console.log(`User: ${user.email} (ID: ${user.id})`);

    if (user.farms.length === 0) {
        console.log('User has NO FARMS');
    } else {
        console.log(`User has ${user.farms.length} farms.`);
        user.farms.forEach(f => console.log(` - Farm: ${f.farmName} (ID: ${f.id})`));

        // Check Lots for these farms
        for (const farm of user.farms) {
            const batches = await prisma.harvestBatch.findMany({
                where: { farmId: farm.id },
                include: { lots: true },
            });
            console.log(`Farm ${farm.id} has ${batches.length} batches.`);
            batches.forEach(b => {
                console.log(`  - Batch ${b.batchNumber} has ${b.lots.length} lots.`);
                b.lots.forEach(l => console.log(`    - Lot: ${l.lotNumber} (Status: ${l.status})`));
            });
        }
    }
}

main().then(() => process.exit(0));
