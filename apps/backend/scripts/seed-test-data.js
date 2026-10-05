/**
 * Seed Test Data for provider Workflow Testing
 * Creates sample applications and invoices for testing the workflow
 */
const { PrismaClient } = require('@prisma/client');
const { runWithTenantContext } = require('../services/tenant-context');
const prisma = new PrismaClient();

function buildFallbackHealthId() {
    return `43${Math.floor(10000000000 + Math.random() * 90000000000)}`;
}


async function seedTestData() {
    console.log('Seeding test data for workflow testing...\n');

    const defaultOrg = await prisma.organization.findUniqueOrThrow({
        where: { slug: 'default' },
    });

    try {
        await runWithTenantContext({ organizationId: defaultOrg.id }, async () => {
        // First, get or create a test Applicant user
        let testApplicant = await prisma.user.findFirst({
            where: { email: 'testApplicant@gacp.test' },
        });

        if (!testApplicant) {
            testApplicant = await prisma.user.create({
                data: {
                    email: 'testApplicant@gacp.test',
                    password: '$2a$12$dummy.hash.for.test.only', // Not a real password
                    firstName: 'ทดสอบ',
                    lastName: 'ระบบ',
                    accountType: 'INDIVIDUAL',
                    role: 'HEALTH',
                    status: 'ACTIVE',
                    phoneNumber: '0812345678',
                    authType: 'HEALTH_ID',
                    healthId: buildFallbackHealthId(),
                },
            });
            console.log('Created test Applicant user\n');
        }


        if (!testApplicant.healthId) {
            let candidateHealthId = buildFallbackHealthId();
            while (await prisma.user.findFirst({ where: { healthId: candidateHealthId } })) {
                candidateHealthId = buildFallbackHealthId();
            }

            testApplicant = await prisma.user.update({
                where: { id: testApplicant.id },
                data: {
                    healthId: candidateHealthId,
                    authType: 'HEALTH_ID',
                },
            });
        }

        // NOTE: provider accounts are now seeded via seed-test-accounts.js using User model with providerId

        // Create sample applications in different statuses
        const statuses = [
            { status: 'SUBMITTED', count: 3 },
            { status: 'ASSIGNED_FOR_REVIEW', count: 2 },
            { status: 'DOC_APPROVED', count: 2 },
            { status: 'AUDIT_FEE_PAID', count: 2 },
            { status: 'AUDIT_CONFIRMED', count: 1 },
            { status: 'APPROVED', count: 5 },
        ];

        const plantTypes = ['กัญชา', 'กระท่อม', 'ขมิ้น', 'ขิง', 'กระชายดำ'];
        const areaTypes = ['OUTDOOR', 'INDOOR', 'GREENHOUSE'];
        let totalCreated = 0;
        const createdApps = [];

        for (const { status, count } of statuses) {
            for (let i = 0; i < count; i++) {
                const appNumber = `APP-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;
                const plantType = plantTypes[Math.floor(Math.random() * plantTypes.length)];
                const areaType = areaTypes[Math.floor(Math.random() * areaTypes.length)];

                const app = await prisma.application.create({
                    data: {
                        applicationNumber: appNumber,
                        status: status,
                        serviceType: 'new_application',
                        areaType: areaType,
                        healthId: testApplicant.healthId,
                        formData: {
                            plantId: plantType,
                            farmArea: Math.floor(Math.random() * 50) + 5,
                        },
                        isDeleted: false,
                    },
                });
                createdApps.push(app);
                totalCreated++;

                // Small delay to ensure unique timestamps
                await new Promise(r => setTimeout(r, 10));
            }
        }

        console.log(`Created ${totalCreated} test applications\n`);

        // Create sample invoices (only for applications that need them)
        const approvedApps = createdApps.filter(a => a.status === 'APPROVED');
        let invoicesCreated = 0;

        for (const app of approvedApps) {
            const invoiceStatuses = ['pending', 'paid', 'overdue'];
            const invoiceStatus = invoiceStatuses[Math.floor(Math.random() * invoiceStatuses.length)];
            const amount = Math.floor(Math.random() * 15000) + 5000;

            await prisma.invoice.create({
                data: {
                    invoiceNumber: `INV-${Date.now().toString().slice(-6)}-${invoicesCreated}`,
                    applicationId: app.id,
                    healthId: testApplicant.healthId,
                    serviceType: 'new_application',
                    subtotal: amount,
                    vat: amount * 0.07,
                    totalAmount: amount * 1.07,
                    status: invoiceStatus,
                    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    paidAt: invoiceStatus === 'paid' ? new Date() : null,
                    isDeleted: false,
                },
            });
            invoicesCreated++;
            await new Promise(r => setTimeout(r, 10));
        }

        console.log(`Created ${invoicesCreated} test invoices\n`);

        // Print summary
        const appCounts = await prisma.application.groupBy({
            by: ['status'],
            _count: true,
            where: { isDeleted: false },
        });

        console.log('Application Summary:');
        appCounts.forEach(g => console.log(`   ${g.status}: ${g._count}`));

        const invoiceCounts = await prisma.invoice.groupBy({
            by: ['status'],
            _count: true,
            where: { isDeleted: false },
        });

        console.log('\n Invoice Summary:');
        invoiceCounts.forEach(g => console.log(`   ${g.status}: ${g._count}`));

        console.log('\n Test data seeding complete!');
        });
    } catch (error) {
        console.error('Error seeding test data:', error);
    } finally {
        await prisma.$disconnect();
    }
}

seedTestData();


