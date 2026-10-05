/**
 * Update Applicant1@demo.gacp.th to CERTIFIED status
 * and create Farm, Batch, Lots for demo
 */

const { PrismaClient } = require('@prisma/client');
const { runWithTenantContext } = require('../services/tenant-context');
const prisma = new PrismaClient({ log: ['error'] });

const Applicant1_EMAIL = 'Applicant1@demo.gacp.th';
const buildFallbackHealthId = () => `43${Math.floor(10000000000 + Math.random() * 90000000000)}`;

// Generate QR Code
const generateQRCode = (type, index) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${type}-F1-${String(index).padStart(3, '0')}-${code}`;
};

async function main() {
    console.log('======================================================');
    console.log('Updating Applicant1@demo.gacp.th to CERTIFIED');
    console.log('======================================================\n');

    const defaultOrg = await prisma.organization.findUniqueOrThrow({
        where: { slug: 'default' },
    });

    try {
        await runWithTenantContext({ organizationId: defaultOrg.id }, async () => {
        // 1. Find Applicant1
        let Applicant = await prisma.user.findFirst({
            where: { email: Applicant1_EMAIL },
        });

        if (!Applicant) {
            console.error('Applicant1@demo.gacp.th not found!');
            return;
        }
        if (!Applicant.healthId) {
            let candidate = Applicant.idCard || buildFallbackHealthId();
            while (await prisma.user.findFirst({ where: { healthId: candidate } })) {
                candidate = buildFallbackHealthId();
            }
            Applicant = await prisma.user.update({
                where: { id: Applicant.id },
                data: {
                    healthId: candidate,
                    authType: 'HEALTH_ID',
                },
            });
        }
        console.log(`Found Applicant: ${Applicant.id}`);

        // 2. Update all applications to CERTIFIED
        // Demo/seed script — bulk updateMany kept as-is intentionally because
        // writeApplicationStatus() is single-row by design (one audit-log entry
        // per status transition). Migrating this would require a fetch-then-loop
        // which adds N round-trips for what is one-shot demo seeding. Add the
        // eslint-disable with explicit rationale so the lint baseline reflects
        // an INTENTIONAL exception, not an oversight.
        // eslint-disable-next-line gacp/no-direct-application-status-write
        const updateResult = await prisma.application.updateMany({
            where: { healthId: Applicant.healthId },
            data: {
                status: 'CERTIFIED',
                updatedAt: new Date(),
            },
        });
        console.log(`Updated ${updateResult.count} applications to CERTIFIED`);

        // 3. Get applications
        const applications = await prisma.application.findMany({
            where: { healthId: Applicant.healthId },
        });

        // 4. Update invoices to paid
        for (const app of applications) {
            await prisma.invoice.updateMany({
                where: { applicationId: app.id },
                data: {
                    status: 'paid',
                    paidAt: new Date(),
                    paymentMethod: 'BANK_TRANSFER',
                    paymentTransactionId: `DEMO-${Date.now()}`,
                },
            });
        }
        console.log(`Updated invoices to PAID`);

        // 5. Create or get Farm
        let farm = await prisma.farm.findFirst({
            where: { userId: Applicant.id },
        });

        if (!farm) {
            farm = await prisma.farm.create({
                data: {
                    userId: Applicant.id,
                    name: 'ฟาร์มสมชาย Demo',
                    address: '123 หมู่ 5',
                    subdistrict: 'แม่เหียะ',
                    district: 'เมือง',
                    province: 'เชียงใหม่',
                    postalCode: '50100',
                    latitude: 18.7883,
                    longitude: 98.9853,
                    totalArea: 10,
                    areaUnit: 'rai',
                },
            });
            console.log(`Created Farm: ${farm.id}`);
        } else {
            console.log(`Farm exists: ${farm.id}`);
        }

        // 6. Create HarvestBatch
        const batchQR = generateQRCode('BATCH', 1);
        const batchNumber = `BATCH-F1-DEMO-001`;

        // Delete existing if any
        await prisma.lot.deleteMany({
            where: { batch: { batchNumber: batchNumber } },
        });
        await prisma.harvestBatch.deleteMany({
            where: { batchNumber: batchNumber },
        });

        const batch = await prisma.harvestBatch.create({
            data: {
                qrCode: batchQR,
                batchNumber: batchNumber,
                farmId: farm.id,
                harvestDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
                freshWeight: 20000,
                status: 'PROCESSED',
                qualityGrade: 'A',
                qcPassed: true,
                notes: 'Demo batch for Applicant1',
            },
        });
        console.log(`Created Batch: ${batch.batchNumber} (QR: ${batchQR})`);

        // 7. Create 20 Lots
        console.log('Creating 20 Lots...');
        for (let i = 1; i <= 20; i++) {
            const lotQR = generateQRCode('LOT', i);
            const lotNumber = `LOT-F1-DEMO-${String(i).padStart(2, '0')}`;

            await prisma.lot.create({
                data: {
                    qrCode: lotQR,
                    lotNumber: lotNumber,
                    batchId: batch.id,
                    packageType: 'BAG_1KG',
                    quantity: 1,
                    unitWeight: 1000,
                    totalWeight: 1000,
                    status: 'PACKAGED',
                    thcContent: 15 + Math.random() * 5,
                    cbdContent: 1 + Math.random() * 2,
                    testStatus: 'PASSED',
                },
            });
        }
        console.log('Created 20 Lots');

        console.log('\n======================================================');
        console.log('Applicant1@demo.gacp.th is now CERTIFIED!');
        console.log('======================================================');
        console.log('\n Summary:');
        console.log(`   - Applications: ${applications.length} (CERTIFIED)`);
        console.log(`   - Farm: ${farm.name}`);
        console.log(`   - Batch: ${batch.batchNumber}`);
        console.log(`   - Lots: 20`);
        console.log('\n Login: Applicant1@demo.gacp.th');
        });
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();


