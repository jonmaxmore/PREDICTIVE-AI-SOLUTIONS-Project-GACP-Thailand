
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { runWithTenantContext } = require('../services/tenant-context');
const { writeApplicationStatus } = require('../services/application-status-writer');

async function main() {
    const defaultOrg = await prisma.organization.findUniqueOrThrow({
        where: { slug: 'default' },
    });
    await runWithTenantContext({ organizationId: defaultOrg.id }, async () => {
        const app = await prisma.application.findFirst({
            orderBy: { createdAt: 'desc' },
        });

        if (app) {
            // Correct fields based on schema: auditResult, scheduledDate etc
            await writeApplicationStatus({
                prisma,
                applicationId: app.id,
                fromStatus: app.status,
                toStatus: 'CERTIFIED',
                actorId: 'force_certify-script',
                actorRole: 'SYSTEM',
                reason: 'Manual force_certify.js dev script',
                additionalData: {
                    auditResult: 'PASS',
                    scheduledDate: new Date(),
                    // Note: completedAt isn't in the schema under audit fields explicitly, but we can assume 'CERTIFIED' status is enough for now.
                    // Also Creating a dummy Certificate if needed?
                    // Let's first set the app status.
                },
            });

            console.log(`Updated App ${app.applicationNumber} to CERTIFIED`);
            console.log(`Trace URL: /trace/${app.applicationNumber}`);
        } else {
            console.log('No application found');
        }
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
