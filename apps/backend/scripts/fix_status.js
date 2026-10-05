
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { writeApplicationStatus } = require('../services/application-status-writer');

async function main() {
    const app = await prisma.application.findFirst({
        orderBy: { createdAt: 'desc' },
    });

    if (app) {
        await writeApplicationStatus({
            prisma,
            applicationId: app.id,
            fromStatus: app.status,
            toStatus: 'SUBMITTED',
            actorId: 'fix_status-script',
            actorRole: 'SYSTEM',
            reason: 'Manual fix_status.js dev script',
        });
        console.log(`Updated App ${app.applicationNumber} to SUBMITTED`);
    } else {
        console.log('No application found');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
