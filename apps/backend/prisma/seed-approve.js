const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const certificateService = require('../services/certificate-service');
const { writeApplicationStatus } = require('../services/application-status-writer');

// Mock Request Object for Audit Route simulation (or just direct DB calls?)
// Direct DB or Service calls are better for seeding.
// But `audits.js` has the logic. I will replicate the logic here to "simulate" it or call the API?
// Calling API requires running server. I'll duplicate the logic to ensure data integrity for the test.
// Wait, `certificateService.generateCertificate` is what I want to test.
// So I will just update status to APPROVED and call generateCertificate.

async function main() {
    console.log('Simulating Audit Approval & Certificate Generation...');

    // 1. Find a Target App (e.g. from previous batch)
    const app = await prisma.application.findFirst({
        where: {
            applicationNumber: { startsWith: 'GACP-SPLIT' },
            status: { not: 'APPROVED' },
        },
    });

    if (!app) {
        console.error('No suitable application found (GACP-SPLIT). Run seed-real-fees first.');
        return;
    }

    console.log(`Processing App: ${app.applicationNumber} (${app.areaType})`);

    // 2. Simulate Audit Schedule (if needed)
    // Update to AUDIT_SCHEDULED first
    await writeApplicationStatus({
        prisma,
        applicationId: app.id,
        fromStatus: app.status,
        toStatus: 'AUDIT_CONFIRMED',
        actorId: 'seed-approve',
        actorRole: 'SYSTEM',
        reason: 'seed: simulate audit scheduled',
        additionalData: {
            auditorId: 'AUDITOR-MOCK-001',
            scheduledDate: new Date(),
        },
    });

    // 3. Simulate Audit Pass (Update to APPROVED)
    await writeApplicationStatus({
        prisma,
        applicationId: app.id,
        fromStatus: 'AUDIT_CONFIRMED',
        toStatus: 'APPROVED',
        actorId: 'seed-approve',
        actorRole: 'SYSTEM',
        reason: 'seed: simulate audit pass',
        additionalData: {
            auditResult: 'PASS',
            auditNotes: 'Excellent Farm!',
        },
    });
    // Re-fetch with includes (writer doesn't expose include option yet — keep
    // this two-step pattern until writeApplicationStatus is extended).
    const updated = await prisma.application.findUnique({
        where: { id: app.id },
        include: { applicant: true }, // Needed for cert service? Service fetches it.
    });

    // 4. Generate Certificate
    // Simulate what `audits.js` does:
    try {
        const cert = await certificateService.generateCertificate(app.id, 'AUDITOR-MOCK-001');
        console.log(`Certificate Generated!`);
        console.log(`   Number: ${cert.certificateNumber}`);
        console.log(`   Verification: ${cert.verificationCode}`);
        console.log(`   Status: ${cert.status}`);

        // 5. Activate Farm
        if (updated.formData?.locationData?.farmId) {
            console.log(`   (Activated Farm ${updated.formData.locationData.farmId})`);
        }

    } catch (e) {
        console.error('Certificate Generation Failed:', e);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
