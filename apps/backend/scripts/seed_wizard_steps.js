/**
 * Seed default wizard step configuration
 */
const wizardConfigService = require('../services/wizard-config-service');
const { prisma } = require('../services/prisma-database');

async function main() {
    console.log('Seeding default wizard steps...');

    await prisma.$connect();

    const result = await wizardConfigService.seedDefaultSteps();

    console.log('Seeded', result.seeded,'steps');

    // Verify
    const steps = await wizardConfigService.getAllSteps();
    console.log('Steps in database:', steps.length);
    steps.forEach(s => console.log(`  ${s.stepNumber}. ${s.titleTH} [${s.stepKey}]`));

    await prisma.$disconnect();
}

main().catch(console.error);
