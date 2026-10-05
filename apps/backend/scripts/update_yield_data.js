const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UPDATES = [
    { code: 'CANNABIS', nameTH: 'กัญชา', maxYield: 0.8, spacing: '1x1.5m' },
    { code: 'KRATOM', nameTH: 'กระท่อม', maxYield: 15.0, spacing: '4x4m' },
    { code: 'TURMERIC', nameTH: 'ขมิ้นชัน', maxYield: 0.5, spacing: '0.3x0.3m' },
    { code: 'GINGER', nameTH: 'ขิง', maxYield: 0.5, spacing: '0.3x0.3m' },
    { code: 'PLAI', nameTH: 'ไพล', maxYield: 0.8, spacing: '0.5x0.5m' },
    { code: 'BSD', nameTH: 'กระชายดำ', maxYield: 0.3, spacing: '0.2x0.2m' },
    { code: 'TEST', nameTH: 'Test', maxYield: 0.1, spacing: '1x1m' },
];

async function main() {
    console.log('Updating Plant Yield Standards...');
    const allPlants = await prisma.plantSpecies.findMany();
    console.log('Existing Plants (Codes):', allPlants.map(p => p.code));

    for (const update of UPDATES) {
        // Upsert logic: Update if exists, Create if not
        const plant = await prisma.plantSpecies.upsert({
            where: { code: update.code },
            update: {
                maxYieldPerPlant: update.maxYield,
                standardSpacing: update.spacing,
            },
            create: {
                code: update.code,
                nameTH: update.nameTH,
                nameEN: update.code, // Placeholder
                group: 'GENERAL',
                maxYieldPerPlant: update.maxYield,
                standardSpacing: update.spacing,
            },
        });
        console.log(`Upserted ${plant.code}: Max ${plant.maxYieldPerPlant}kg, Spacing ${plant.standardSpacing}`);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
