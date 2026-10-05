/**
 * Seed Test Data for Lots with QR Codes
 * Creates lots, harvest batches, and generates QR codes with traceability data
 */
const { PrismaClient } = require('@prisma/client');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { runWithTenantContext } = require('../services/tenant-context');

const prisma = new PrismaClient();

function buildFallbackHealthId() {
    return `43${Math.floor(10000000000 + Math.random() * 90000000000)}`;
}


async function seedLotsWithQR() {
    console.log('Seeding Lots with QR Codes...\n');

    const defaultOrg = await prisma.organization.findUniqueOrThrow({
        where: { slug: 'default' },
    });

    try {
        await runWithTenantContext({ organizationId: defaultOrg.id }, async () => {
        // 1. Get or create test Applicant
        let testApplicant = await prisma.user.findFirst({
            where: { email: 'testApplicant@gacp.test' },
        });

        if (!testApplicant) {
            testApplicant = await prisma.user.create({
                data: {
                    email: 'testApplicant@gacp.test',
                    password: '$2a$12$dummy.hash.for.test.only',
                    firstName: 'ทดสอบ',
                    lastName: 'เกษตรกร',
                    accountType: 'INDIVIDUAL',
                    role: 'HEALTH',
                    status: 'ACTIVE',
                    phoneNumber: '0812345678',
                    authType: 'HEALTH_ID',
                    healthId: buildFallbackHealthId(),
                },
            });
            console.log('Created test Applicant\n');
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

        // 2. Get or create approved application
        let application = await prisma.application.findFirst({
            where: {
                healthId: testApplicant.healthId,
                status: 'APPROVED',
            },
        });

        if (!application) {
            application = await prisma.application.create({
                data: {
                    applicationNumber: `APP-${Date.now().toString().slice(-6)}`,
                    status: 'APPROVED',
                    serviceType: 'new_application',
                    areaType: 'OUTDOOR',
                    healthId: testApplicant.healthId,
                    formData: {
                        plantId: 'กัญชา',
                        farmArea: 100,
                        farmName: 'ฟาร์มทดสอบ GACP',
                        farmAddress: '123 หมู่ 5 ต.ทดสอบ อ.ตัวอย่าง จ.กรุงเทพฯ',
                    },
                    isDeleted: false,
                },
            });
            console.log('Created approved application\n');
        }

        // 3. Create Planting Cycles
        const plantingCycles = [];
        const plantTypes = ['กัญชา', 'กระท่อม', 'ขมิ้น'];
        
        for (let i = 0; i < 3; i++) {
            const startDate = new Date();
            startDate.setMonth(startDate.getMonth() - (i * 3));
            
            const cycle = await prisma.plantingCycle.create({
                data: {
                    cycleNumber: `CYCLE-${Date.now()}-${i}`,
                    healthId: testApplicant.healthId,
                    applicationId: application.id,
                    plantType: plantTypes[i],
                    plantingDate: startDate,
                    expectedHarvestDate: new Date(startDate.getTime() + 90 * 24 * 60 * 60 * 1000),
                    actualHarvestDate: i === 0 ? new Date() : null,
                    status: i === 0 ? 'HARVESTED' : 'GROWING',
                    plantingArea: 50 + (i * 10),
                    numberOfPlants: 1000 + (i * 200),
                    cultivationMethod: 'ORGANIC',
                    isDeleted: false,
                },
            });
            plantingCycles.push(cycle);
            console.log(`Created planting cycle: ${cycle.cycleNumber}`);
        }

        console.log('');

        // 4. Create Harvest Batches
        const harvestBatches = [];
        
        for (let i = 0; i < 5; i++) {
            const cycle = plantingCycles[i % plantingCycles.length];
            const harvestDate = new Date();
            harvestDate.setDate(harvestDate.getDate() - (i * 7));

            const batch = await prisma.harvestBatch.create({
                data: {
                    batchNumber: `HB-${Date.now()}-${i}`,
                    healthId: testApplicant.healthId,
                    plantingCycleId: cycle.id,
                    harvestDate: harvestDate,
                    quantity: 100 + (i * 20),
                    unit: 'KG',
                    quality: ['A', 'B', 'C'][i % 3],
                    storageLocation: `คลังที่ ${i + 1}`,
                    status: 'STORED',
                    isDeleted: false,
                },
            });
            harvestBatches.push(batch);
            console.log(`Created harvest batch: ${batch.batchNumber}`);
        }

        console.log('');

        // 5. Create Lots with QR Codes
        const lots = [];
        const qrCodesDir = path.join(__dirname, '../public/qr-codes');
        
        // Create QR codes directory if not exists
        if (!fs.existsSync(qrCodesDir)) {
            fs.mkdirSync(qrCodesDir, { recursive: true });
        }

        for (let i = 0; i < 10; i++) {
            const batch = harvestBatches[i % harvestBatches.length];
            const lotNumber = `LOT-${Date.now()}-${String(i).padStart(3, '0')}`;
            
            // Create lot data
            const lotData = {
                lotNumber: lotNumber,
                healthId: testApplicant.healthId,
                harvestBatchId: batch.id,
                quantity: 10 + (i * 2),
                unit: 'KG',
                packagingDate: new Date(),
                expiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), // 180 days
                status: 'PACKAGED',
                qrCode: '', // Will be updated after QR generation
                isDeleted: false,
            };

            const lot = await prisma.lot.create({ data: lotData });

            // 6. Generate QR Code with embedded data
            const traceabilityData = {
                lotNumber: lot.lotNumber,
                productName: batch.plantingCycle?.plantType || 'ผลิตภัณฑ์เกษตร',
                applicantName: `${testApplicant.firstName} ${testApplicant.lastName}`,
                harvestDate: batch.harvestDate.toISOString().split('T')[0],
                packagingDate: lot.packagingDate.toISOString().split('T')[0],
                expiryDate: lot.expiryDate.toISOString().split('T')[0],
                quantity: `${lot.quantity} ${lot.unit}`,
                quality: batch.quality,
                certificationNumber: application.applicationNumber,
                traceUrl: `${process.env.TRACE_BASE_URL || 'http://localhost:3000'}/trace/${lot.lotNumber}`,
                gacpCertified: true,
                batchNumber: batch.batchNumber,
            };

            // Generate QR Code as Data URL
            const qrCodeDataUrl = await QRCode.toDataURL(JSON.stringify(traceabilityData), {
                errorCorrectionLevel: 'H',
                type: 'image/png',
                width: 300,
                margin: 2,
            });

            // Save QR Code as file
            const qrCodeFileName = `${lot.lotNumber}.png`;
            const qrCodePath = path.join(qrCodesDir, qrCodeFileName);
            const base64Data = qrCodeDataUrl.replace(/^data:image\/png;base64,/, '');
            fs.writeFileSync(qrCodePath, base64Data, 'base64');

            // Update lot with QR code path
            await prisma.lot.update({
                where: { id: lot.id },
                data: {
                    qrCode: `/qr-codes/${qrCodeFileName}`,
                    metadata: traceabilityData,
                },
            });

            lots.push(lot);
            console.log(`Created lot with QR: ${lot.lotNumber}`);
            console.log(`Quantity: ${lot.quantity} ${lot.unit}`);
            console.log(`Trace URL: ${traceabilityData.traceUrl}`);
            console.log(`QR Code: ${qrCodePath}\n`);
        }

        // 7. Print Summary
        console.log('\n Summary:');
        console.log(`   Planting Cycles: ${plantingCycles.length}`);
        console.log(`   Harvest Batches: ${harvestBatches.length}`);
        console.log(`   Lots Created: ${lots.length}`);
        console.log(`   QR Codes Generated: ${lots.length}`);

        // 8. Print sample QR data
        console.log('\n Sample QR Code Data:');
        const sampleLot = lots[0];
        const sampleData = await prisma.lot.findUnique({
            where: { id: sampleLot.id },
            include: {
                harvestBatch: {
                    include: {
                        plantingCycle: true,
                    },
                },
                applicant: true,
            },
        });

        console.log(JSON.stringify(sampleData.metadata, null, 2));

        console.log('\n Lots with QR Codes seeding complete!');
        console.log(`\n QR Codes saved to: ${qrCodesDir}`);
        console.log('\n Test QR Code by scanning or visiting trace URL');
        });
    } catch (error) {
        console.error('Error seeding lots:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Run if called directly
if (require.main === module) {
    seedLotsWithQR()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = { seedLotsWithQR };


