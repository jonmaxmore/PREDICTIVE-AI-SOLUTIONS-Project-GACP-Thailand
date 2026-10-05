const { PrismaClient } = require('@prisma/client');
const feeService = require('../services/fee-service');
const { runWithTenantContext } = require('../services/tenant-context');
const prisma = new PrismaClient();

async function main() {
    console.log('Seeding Split-Scope Application Data...');

    const defaultOrg = await prisma.organization.findUniqueOrThrow({
        where: { slug: 'default' },
    });

    await runWithTenantContext({ organizationId: defaultOrg.id }, async () => {
        // 1. Get Existing Applicant
        const Applicant = await prisma.user.findFirst({
            where: {
                role: 'HEALTH',
                healthId: { not: null },
            },
        });

        if (!Applicant) {
            console.error('No Applicant with healthId found. Please run identity seed first.');
            return;
        }
        console.log(`Using Applicant: ${Applicant.email}`);

        // Generate specific timestamp for this batch
        const batchId = `BATCH-${Date.now()}`;

        // Scenario: Applicant applies for BOTH Outdoor and Indoor (Greenhouse)
        // Results in 2 Separate Applications
        const scopes = [
            { type: 'OUTDOOR', nameTH: 'กลางแจ้ง (Outdoor)' },
            { type: 'GREENHOUSE', nameTH: 'โรงเรือน (Greenhouse)' },
        ];

        console.log(`Simulating Batch Submission: ${batchId} (2 Scopes)`);

        for (const [index, scope] of scopes.entries()) {
            const globalCount = await prisma.application.count();
            const appNumber = `GACP-SPLIT-${globalCount + 1}`;

            // Calculate Fees
            const phase1Fee = feeService.calculatePhase1Fee();
            const phase2Fee = feeService.calculatePhase2Fee({ auditMode: 'ONSITE' });

            await prisma.application.create({
                data: {
                    healthId: Applicant.healthId,
                    applicationNumber: appNumber,
                    status: 'PENDING_AUDIT_FEE', // Ready to see 25k bill
                    serviceType: 'new_application',

                    // SPLIT LOGIC
                    batchId: batchId,
                    areaType: scope.type,
                    areaTypeIndex: index + 1,
                    cultivationScopeCount: scopes.length,
                    // Retired name for the same number, seeded in step.
                    totalAreaTypes: scopes.length,

                    // FEES
                    phase1Amount: phase1Fee.total,
                    phase2Amount: phase2Fee.total,

                    formData: {
                        plantName: 'Cannabis (Batch Split)',
                        scope: scope.nameTH,
                        fees: {
                            phase1: phase1Fee,
                            phase2: phase2Fee,
                        },
                    },
                },
            });

            console.log(`Created App #${index + 1}: ${scope.type} [${appNumber}] - Fee: ${phase2Fee.total} THB`);
        }

        console.log('Batch Simulation Complete. Check Dashboard for 2 new entries.');
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());



