const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Seeding System Config...');

    const configKey = 'enableRelaxedApplicationValidation';

    // Check if exists
    const existing = await prisma.systemConfig.findUnique({
        where: { key: configKey },
    });

    if (existing) {
        console.log(`Config '${configKey}' already exists. Value:`, existing.value);
    } else {
        console.log(`Creating '${configKey}'...`);
        await prisma.systemConfig.create({
            data: {
                key: configKey,
                value: true, // Default to TRUE for testing as requested
                description: 'Allow submitting applications without required documents (Dev/Test only)',
                group: 'FEATURE',
                updatedBy: 'SEED_SCRIPT',
            },
        });
        console.log(`Config '${configKey}' created.`);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
