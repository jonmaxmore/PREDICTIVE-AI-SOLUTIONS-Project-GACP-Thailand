/**
 * E2E Verification Script: Full Golden Loop
 * 
 * Usage: node scripts/verify-e2e.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const certificateService = require('../services/certificate-service');
const { runWithTenantContext } = require('../services/tenant-context');
const { writeApplicationStatus } = require('../services/application-status-writer');
const buildFallbackHealthId = () => `43${Math.floor(10000000000 + Math.random() * 90000000000)}`;

async function main() {
    console.log('Starting E2E Verification...');

    const defaultOrg = await prisma.organization.findUniqueOrThrow({
        where: { slug: 'default' },
    });
    await runWithTenantContext({ organizationId: defaultOrg.id }, async () => {
        // 1. Create a Mock User (Applicant)
        const Applicant = await prisma.user.create({
            data: {
                email: `verify_${Date.now()}@test.com`,
                password: 'hashed_password',
                authType: 'HEALTH_ID',
                healthId: buildFallbackHealthId(),
                firstName: 'Somchai',
                lastName: 'Mee-ngan',
                role: 'HEALTH',
                accountType: 'INDIVIDUAL',
                status: 'ACTIVE',
            },
        });
        console.log(`Applicant Created: ${Applicant.id}`);

        // 2. Submit Application (Step 1-6 Simulation)
        const app = await prisma.application.create({
            data: {
                applicationNumber: `APP-${Date.now()}`,
                healthId: Applicant.healthId,
                areaType: 'GREENHOUSE',
                serviceType: 'new_application',
                status: 'AUDIT_FEE_PAID', // Jump to the schedulable point
                phase1Status: 'PAID',
                formData: {
                    plantName: 'Cannabis',
                    locationData: { address: '123 Farm Rd', province: 'Chiang Mai', subDistrict: 'Mae Rim' },
                    productionData: { growingArea: '5' }, // 5 Rai
                },
            },
        });
        console.log(`Application Submitted: ${app.applicationNumber}`);

        // 3. Mock provider Scheduling Audit
        const providerId = 'PROVIDER-001';
        await writeApplicationStatus({
            prisma,
            applicationId: app.id,
            fromStatus: app.status,
            toStatus: 'AUDIT_CONFIRMED',
            actorId: 'verify-e2e-script',
            actorRole: 'SYSTEM',
            reason: 'E2E verification: mock provider audit scheduling',
            additionalData: {
                scheduledDate: new Date(),
                auditorId: providerId,
                formData: {
                    ...app.formData,
                    auditMode: 'ONLINE',
                    meetingUrl: 'https://meet.google.com/abc-defg-hij',
                },
            },
        });
        console.log('Audit Scheduled');

        // 4. Mock Audit Pass (Trigger Certificate Generation)
        // This replicates the logic in audits.js router.post('/:id/result')
        console.log('Executing Audit Pass Logic...');

        // Simulate API logic
        await writeApplicationStatus({
            prisma,
            applicationId: app.id,
            fromStatus: 'AUDIT_CONFIRMED',
            toStatus: 'APPROVED',
            actorId: 'verify-e2e-script',
            actorRole: 'SYSTEM',
            reason: 'E2E verification: mock audit pass',
        });

        // Call Certificate Service
        const cert = await certificateService.generateCertificate(app.id, providerId);
        console.log(`Certificate Generated: ${cert.certificateNumber}`);

        // 5. Verify Assets
        const farm = await prisma.farm.findFirst({ where: { ownerId: Applicant.id } });
        if (!farm) {throw new Error('Farm not created!');}
        console.log(`Farm Created: ${farm.farmName} (${farm.status})`);

        const cycle = await prisma.plantingCycle.findFirst({ where: { farmId: farm.id } });
        if (!cycle) {throw new Error('Planting Cycle not created!');}
        console.log(`Cycle Created: ${cycle.cycleName}`);

        const batch = await prisma.harvestBatch.findFirst({ where: { cycleId: cycle.id } });
        if (!batch) {throw new Error('Harvest Batch not created!');}
        console.log(`Batch Created: ${batch.batchNumber}`);
        console.log(`   QR Code: ${batch.qrCode ? 'Yes' : 'No'}`);

        console.log('E2E Verification PASSED!');
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());


