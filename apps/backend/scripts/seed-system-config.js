const { seedDefaultConfigs } = require('../controllers/system-config-controller');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Seeding System Configs...');
    try {
        await seedDefaultConfigs();
        console.log('Seeding completed.');
    } catch (error) {
        console.error('Seeding failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
