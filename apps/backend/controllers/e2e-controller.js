const { prisma } = require('../services/prisma-database');
const CertificateService = require('../services/certificate-service');
const qrcodeService = require('../services/qrcode/qrcode-service');
const { writeApplicationStatus } = require('../services/application-status-writer');
const { respondError } = require('../shared/api-response');
const { CANONICAL_ROLES } = require('../shared/canonical-rbac');
const crypto = require('crypto');
const { localYear } = require('../utils/working-days');


class E2EController {

    /**
     * Golden Scenario: Create complete test data for QC flow
     * Creates: User -> Farm -> Batch -> Harvest -> Lot with QR Code
     * Returns: Complete data with QR code data URL
     */
    async goldenScenario(req, res) {
        // P1-e2e (2026-06-10): removed the ENABLE_E2E_ROUTES prod escape hatch.
        // The /e2e router is never mounted in production (routes/api/index.js gate),
        // so this controller-level flag could only ever re-expose the route — a dead
        // foot-gun. Auth is now enforced by the router-level requireE2ESecret gate.
        try {
            console.log('[E2E] Starting Golden Scenario...');
            const timestamp = Date.now();
            const results = {};

            // Step 1: Create test user
            const healthId = `9${timestamp.toString().slice(-12)}`;
            const healthIdHash = crypto.createHash('sha256').update(healthId).digest('hex');
            const hashedPassword = crypto.createHash('sha256').update(`e2e-password-${timestamp}`).digest('hex');
            const user = await prisma.user.create({
                data: {
                    email: `e2e-test-${timestamp}@golden.local`,
                    phoneNumber: `099${timestamp.toString().slice(-7)}`,
                    password: hashedPassword,
                    // Canonical spelling (migration 20260801000000) — the E2E
                    // user must look exactly like a real signup or the golden
                    // scenario exercises a row shape production never has.
                    role: CANONICAL_ROLES.HEALTH,
                    status: 'ACTIVE',
                    accountType: 'INDIVIDUAL',
                    authType: 'HEALTH_ID',
                    healthId,
                    healthIdHash,
                    idCard: healthId,
                    idCardHash: healthIdHash,
                    firstName: 'ทดสอบ',
                    lastName: 'ระบบ',
                },
            });
            results.user = { id: user.id, email: user.email };
            console.log(`[E2E] Created user: ${user.id}`);

            // Step 2: Create farm
            const farm = await prisma.farm.create({
                data: {
                    farmName: `ฟาร์มทดสอบ E2E ${timestamp}`,
                    farmType: 'cannabis',
                    cultivationMethod: 'indoor',
                    ownerId: user.id,
                    address: '123 ถนนทดสอบ',
                    province: 'กรุงเทพมหานคร',
                    district: 'บางกะปิ',
                    subDistrict: 'หัวหมาก',
                    postalCode: '10240',
                    latitude: 13.7563,
                    longitude: 100.5018,
                    totalArea: 10,
                    cultivationArea: 5,
                    status: 'approved',
                },
            });
            results.farm = { id: farm.id, name: farm.farmName, farmName: farm.farmName };
            console.log(`[E2E] Created farm: ${farm.id}`);

            // Step 3: Get or create a plant species
            let species = await prisma.plantSpecies.findFirst({
                where: { isActive: true },
            });
            if (!species) {
                species = await prisma.plantSpecies.create({
                    data: {
                        code: `E2E-${timestamp}`,
                        nameTH: 'กัญชาทดสอบ',
                        nameEN: 'Test Cannabis',
                        scientificName: 'Cannabis sativa',
                        group: 'cannabis',
                        isActive: true,
                    },
                });
            }
            results.species = { id: species.id, name: species.nameTH, code: species.code };

            // Step 4: Create planting cycle
            const cycle = await prisma.plantingCycle.create({
                data: {
                    cycleName: `รอบทดสอบ E2E ${timestamp}`,
                    farmId: farm.id,
                    plantSpeciesId: species.id,
                    startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
                    expectedHarvestDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    estimatedPlantCount: 100,
                    cultivationType: 'SELF_GROWN',
                    status: 'HARVESTED',
                },
            });
            results.cycle = { id: cycle.id, name: cycle.cycleName };
            console.log(`[E2E] Created cycle: ${cycle.id}`);

            // Step 5: Create harvest batch
            const batchNumber = `BATCH-${localYear() + 543}-${timestamp.toString().slice(-6)}`;
            const batch = await prisma.harvestBatch.create({
                data: {
                    batchNumber,
                    farmId: farm.id,
                    plantCode: species.code,
                    cycleId: cycle.id,
                    harvestDate: new Date(),
                    freshWeight: 50,
                    dryWeight: 10,
                    moistureContent: 12,
                    status: 'PROCESSED',
                    qrCode: qrcodeService.generateQRCodeId(),
                    trackingUrl: null,
                    notes: 'E2E Golden Scenario Test Batch',
                },
            });
            const updatedBatch = await prisma.harvestBatch.update({
                where: { id: batch.id },
                data: { trackingUrl: qrcodeService.generatePublicTraceUrl(`batch/${batch.id}`) },
            });
            await qrcodeService.registerTraceIntegrity({
                entityType: 'HARVEST_BATCH',
                entityId: updatedBatch.id,
                qrCode: updatedBatch.qrCode,
                publicUrl: updatedBatch.trackingUrl,
                payload: {
                    scope: 'RAW_MATERIAL_GACP',
                    source: 'E2E',
                    batchId: updatedBatch.id,
                    batchNumber: updatedBatch.batchNumber,
                    harvestDate: updatedBatch.harvestDate,
                    totalHarvestWeight: updatedBatch.freshWeight,
                },
            }).catch((error) => {
                console.warn('[E2E] Batch QR integrity skipped:', error.message);
            });
            results.batch = {
                id: updatedBatch.id,
                batchNumber: updatedBatch.batchNumber,
                qrCode: updatedBatch.qrCode,
                trackingUrl: updatedBatch.trackingUrl,
            };
            console.log(`[E2E] Created batch: ${batch.id}`);

            // Step 6: Create lot with QR code
            const lotNumber = `LOT-${localYear() + 543}-${timestamp.toString().slice(-6)}-A`;
            const lotQrCode = qrcodeService.generateQRCodeId();

            const createdLot = await prisma.lot.create({
                data: {
                    lotNumber,
                    batchId: batch.id,
                    packageType: 'vacuum_sealed',
                    quantity: 10,
                    unitWeight: 1.0,
                    totalWeight: 10.0,
                    processedAt: new Date(),
                    packagedAt: new Date(),
                    expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                    thcContent: 15.5,
                    cbdContent: 0.3,
                    moistureContent: 10,
                    testStatus: 'PASSED',
                    destinationType: 'retail',
                    destination: 'E2E Test Destination',
                    qrCode: lotQrCode,
                    trackingUrl: null,
                    status: 'PACKAGED',
                },
            });
            const lot = await prisma.lot.update({
                where: { id: createdLot.id },
                data: { trackingUrl: qrcodeService.generatePublicTraceUrl(`lot/${createdLot.id}`) },
            });
            await qrcodeService.registerTraceIntegrity({
                entityType: 'PACKAGING_LOT',
                entityId: lot.id,
                qrCode: lot.qrCode,
                publicUrl: lot.trackingUrl,
                payload: {
                    scope: 'RAW_MATERIAL_GACP',
                    source: 'E2E',
                    lotId: lot.id,
                    lotNumber: lot.lotNumber,
                    batchId: lot.batchId,
                    packagingType: lot.packageType,
                    unitWeight: lot.unitWeight,
                    unitCount: lot.quantity,
                    totalWeight: lot.totalWeight,
                },
            }).catch((error) => {
                console.warn('[E2E] Lot QR integrity skipped:', error.message);
            });
            results.lot = {
                id: lot.id,
                lotNumber: lot.lotNumber,
                qrCode: lot.qrCode,
                trackingUrl: lot.trackingUrl,
            };
            console.log(`[E2E] Created lot: ${lot.id} with QR: ${lot.qrCode}`);

            // Step 7: Generate QR code data URL for download
            const qrDataUrl = await qrcodeService.generateDataUrl(lot.qrCode, {
                width: 400,
                url: lot.trackingUrl,
            });
            results.qrCodeDataUrl = qrDataUrl;

            // Generate printable label data
            const labelData = {
                qrCodeDataUrl: qrDataUrl,
                lotNumber: lot.lotNumber,
                batchNumber: batch.batchNumber,
                plant: species.nameTH,
                farmName: farm.farmName,
                province: farm.province,
                packageType: lot.packageType,
                weight: `${lot.unitWeight} กก.`,
                harvestDate: batch.harvestDate,
                packagedAt: lot.packagedAt,
                expiryDate: lot.expiryDate,
                trackingUrl: lot.trackingUrl,
                thcContent: `${lot.thcContent}%`,
                cbdContent: `${lot.cbdContent}%`,
            };
            results.label = labelData;

            console.log('[E2E] Golden Scenario COMPLETED');
            res.json({
                success: true,
                message: 'Golden Scenario completed successfully',
                data: results,
            });

        } catch (error) {
            console.error('[E2E] Golden Scenario Error:', error);
            return respondError(res, req, error, { message: 'Golden Scenario failed' });
        }
    }

    /**
     * Get QR code image for a lot
     */
    async getLotQRCode(req, res) {
        try {
            const { lotId } = req.params;
            const lot = await prisma.lot.findUnique({
                where: { id: lotId },
                select: { qrCode: true, lotNumber: true, trackingUrl: true },
            });

            if (!lot || !lot.qrCode) {
                return res.status(404).json({ success: false, error: 'Lot or QR code not found' });
            }

            const qrBuffer = await qrcodeService.generateBuffer(lot.qrCode, {
                width: 400,
                url: lot.trackingUrl || qrcodeService.generatePublicTraceUrl(`lot/${lotId}`),
            });
            res.set('Content-Type', 'image/png');
            res.set('Content-Disposition', `attachment; filename="qr-${lot.lotNumber}.png"`);
            res.send(qrBuffer);

        } catch (error) {
            console.error('[E2E] QR Code Error:', error);
            return respondError(res, req, error, { message: 'Unable to generate QR code' });
        }
    }

    /**
     * Reset test data (Be careful!)
     * Only deletes data for specific test users or environments
     */
    async reset(req, res) {
        if (process.env.NODE_ENV === 'production') {
            return res.status(403).json({ error: 'Not allowed in production' });
        }

        try {
            console.log('[E2E] Resetting Test Data...');

            const {
                healthEmail,
                healthId,
                // Legacy aliases (kept for backward-compatible E2E payloads)
                ApplicantEmail,
                ApplicantIdCard,
            } = req.body;

            const scopedHealthEmail = healthEmail || ApplicantEmail;
            const scopedHealthId = healthId || ApplicantIdCard;

            let user;
            if (scopedHealthEmail) {
                user = await prisma.user.findFirst({ where: { email: scopedHealthEmail } });
            } else if (scopedHealthId) {
                // Calculate Hash to find User (since idCard might be encrypted)
                const idCardHash = crypto.createHash('sha256').update(scopedHealthId).digest('hex');

                user = await prisma.user.findFirst({
                    where: { idCardHash: idCardHash },
                });
            }

            if (user) {
                // Defense-in-depth: refuse to bulk-delete if user.healthId is missing.
                // Without this guard `user.healthId || ''` would broaden the filter to
                // `healthId === ''` (matches every row with an empty string in that
                // FK column — typically 0 in prod but unsafe). E2E controller is
                // already gated to non-production by routes/api/index.js, but QA
                // testers still must not be able to nuke peer testers' data via a
                // single API call.
                if (!user.healthId) {
                    throw new Error('refusing to bulk-delete: missing user.healthId');
                }
                await prisma.invoice.deleteMany({ where: { healthId: user.healthId } });
                await prisma.certificate.deleteMany({ where: { userId: user.id } });
                await prisma.plantingCycle.deleteMany({ where: { farm: { ownerId: user.id } } });
                await prisma.harvestBatch.deleteMany({ where: { farm: { ownerId: user.id } } });
                await prisma.application.deleteMany({ where: { healthId: user.healthId } });
                await prisma.user.delete({ where: { id: user.id } }); // Also delete the user for Loop Test cleanliness!
                console.log(`[E2E] Cleared data for ${scopedHealthEmail || scopedHealthId}`);
            }

            res.json({ success: true, message: 'Test data cleared' });
        } catch (error) {
            console.error('[E2E] Reset Error:', error);
            return respondError(res, req, error, { message: 'Reset failed' });
        }
    }

    /**
     * Force Approve Documents for Application
     * Transitions: SUBMITTED -> PENDING_AUDIT_FEE
     */
    async approveDocuments(req, res) {
        const { id } = req.params;
        try {
            console.log(`[E2E] Approving Documents for App ${id}`);

            const app = await prisma.application.findUnique({ where: { id } });
            if (!app) {return res.status(404).json({ error: 'Application not found' });}

            // Simulate Provider Review
            await writeApplicationStatus({
                prisma,
                applicationId: id,
                fromStatus: app.status,
                toStatus: 'PENDING_AUDIT_FEE',
                actorId: 'E2E_BOT',
                actorRole: 'SYSTEM',
                reason: 'E2E_DOC_APPROVED',
                // E2E test bypass: skip workflow guard so the bot can drive arbitrary states.
                assertTransition: false,
                additionalData: {
                    workflowHistory: {
                        push: {
                            action: 'DOC_APPROVED',
                            by: 'E2E_BOT',
                            at: new Date(),
                            note: 'Auto-approved by E2E Controller',
                        },
                    },
                },
            });

            // Check if Invoice 2 exists or generate it
            const existingInvoice = await prisma.invoice.findFirst({
                where: { applicationId: id, serviceType: 'AUDIT_FEE' },
            });

            if (!existingInvoice) {
                const year = localYear() + 543;
                const random = crypto.randomInt(10_000).toString().padStart(4, '0');
                await prisma.invoice.create({
                    data: {
                        invoiceNumber: `INV-P2-${year}-${random}`,
                        applicationId: id,
                        healthId: app.healthId,
                        serviceType: 'AUDIT_FEE',
                        totalAmount: 25000,
                        subtotal: 25000,
                        status: 'pending',
                        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                        items: [{ description: 'ค่าธรรมเนียมการตรวจประเมิน (Audit Fee)', amount: 25000, quantity: 1 }],
                        notes: 'Auto-generated Phase 2 Invoice via E2E',
                    },
                });
            }

            res.json({ success: true, status: 'PENDING_AUDIT_FEE' });

        } catch (error) {
            console.error('[E2E] Approve Doc Error:', error);
            return respondError(res, req, error, { message: 'Approve documents failed' });
        }
    }

    /**
     * Force Pass Audit and Certify
     * Transitions: ANY -> CERTIFIED
     */
    async passAudit(req, res) {
        const { id } = req.params;
        try {
            console.log(`[E2E] Passing Audit for App ${id}`);

            // Phase 1: APPROVED (cert ready)
            const appBefore = await prisma.application.findUnique({ where: { id }, select: { status: true } });
            await writeApplicationStatus({
                prisma,
                applicationId: id,
                fromStatus: appBefore?.status,
                toStatus: 'APPROVED', // Ready for Certification
                actorId: 'E2E_BOT',
                actorRole: 'SYSTEM',
                reason: 'E2E_AUDIT_PASSED',
                assertTransition: false,
                additionalData: {
                    auditResult: 'PASS',
                    auditNotes: 'Passed via E2E Automation',
                    workflowHistory: {
                        push: {
                            action: 'AUDIT_PASSED',
                            by: 'E2E_BOT',
                            at: new Date(),
                            note: 'Auto-passed audit by E2E Controller',
                        },
                    },
                },
            });

            // Generate Certificate
            const cert = await CertificateService.generateCertificate(id, 'E2E_BOT');

            // Phase 2: APPROVED → CERTIFIED
            await writeApplicationStatus({
                prisma,
                applicationId: id,
                fromStatus: 'APPROVED',
                toStatus: 'CERTIFIED',
                actorId: 'E2E_BOT',
                actorRole: 'SYSTEM',
                reason: 'E2E_CERTIFIED',
                assertTransition: false,
            });

            res.json({ success: true, certificate: cert, status: 'CERTIFIED' });

        } catch (error) {
            console.error('[E2E] Pass Audit Error:', error);
            return respondError(res, req, error, { message: 'Pass audit failed' });
        }
    }
}

module.exports = new E2EController();
