const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
// Batch 15 prisma-bypass cleanup (2026-05-16): direct `prisma.*` reads
// + writes moved into `traceability-service`. The `prisma` symbol is
// retained ONLY as the handle threaded into the two route registrars at the
// bottom of this file — its other use, the Attachment dual-write for
// lot.labTestReportUrl, went with the field itself in T10b.
const { prisma } = require('../../../services/prisma-database');
const qrcodeService = require('../../../services/qrcode/qrcode-service');
const traceabilityService = require('../../../services/traceability-service');
const { authenticateHealth } = require('../../../middleware/auth-middleware');
const logger = require('../../../shared/logger');

const { getRequestIp } = require('../../../utils/client-ip');
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
} = require('../../../middleware/audit-logger');
const { assertNoTypedLabValues } = require('../../../services/lot-lab-claim-guard');
const { registerLotLabelRoutes } = require('../helpers/lots-label-routes');
const { registerLotUtilityRoutes } = require('../helpers/lots-utility-routes');
// AppAudit AC3 (2026-05-15): the workflowHistory metadata is read by admin tooling
// and stored in a hash-chained audit row — a raw 13-digit healthId there is a PDPA
// Section 27 violation. Mask before logging.
const { maskThaiId } = require('../../../utils/field-encryption');

async function getUserFarmIds(userId, req) {
    // Spec 2026-09-30 §3.1 (R1): a health request passes its holder scope so the
    // owner read carries the holder fragment; the owner where still decides.
    const { holderScope } = require('../../../services/holder-access');
    return traceabilityService.listOwnerFarmIdsForTrace(userId, {
        holderScope: req ? await holderScope(req) : null,
    });
}

/**
 * Helper: Verify batch ownership via farm
 */
async function verifyBatchOwnership(batchId, userId, req) {
    const batch = await traceabilityService.findHarvestBatchFarmId(batchId);
    if (!batch) {
        return false;
    }
    const farmIds = await getUserFarmIds(userId, req);
    return farmIds.includes(batch.farmId);
}

/**
 * POST /api/lots
 * Create a new lot from a harvest batch
 */
// การสร้างล็อตเปิดให้เกษตรกรทุกคน — คำสั่ง operator 2026-09-11: "ตอนนี้เราเปิดสร้างล็อต
// แบบ open แล้วเราจะไม่มีแพคเกจพรีเมี่ยม"
//
// เดิมมี requireFeature('LOT_CREATION') ซึ่งต้องการแพ็กเกจ PREMIUM · บน staging/preview
// ธง BILLING_FREE_TIER_FOR_ALL=true ทำให้ทุกคนเป็น PREMIUM จึงไม่มีใครเห็นปัญหา แต่
// ค่าเริ่มต้นของ production คือ false ⇒ เกษตรกรทุกคนจะได้ 403 ตอนบรรจุล็อต ติดแพ็กเกจ
// ที่แพลตฟอร์มไม่ได้ขาย และครึ่งหลังของสายตรวจสอบย้อนกลับ (QR ของล็อต) จะใช้ไม่ได้เลย
//
// ด่านที่ปกป้องจริงไม่ได้หายไป: verifyBatchOwnership ด้านล่างยังตรวจว่ารุ่นนี้เป็นของผู้เรียก
router.post('/', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;

        // T10b — a typed number is refused before anything is read, because the
        // refusal does not depend on the lot existing: five fields the platform no
        // longer accepts from anyone (services/lot-lab-claim-guard.js).
        try {
            assertNoTypedLabValues(req.body);
        } catch (labErr) {
            if (labErr.code !== 'LAB_VALUES_NOT_TYPED') { throw labErr; }
            return res.status(400).json({
                success: false,
                code: labErr.code,
                message: labErr.messageTh,
                messageEN: labErr.message,
                fields: labErr.fields,
            });
        }

        const {
            batchId,
            packageType,
            quantity,
            unitWeight,
            processedAt,
            packagedAt,
            expiryDate,
            destinationType,
            destination,
            _notes,
        } = req.body;

        // Validation
        if (!batchId || !packageType || !quantity || !unitWeight) {
            return res.status(400).json({
                success: false,
                message: 'batchId, packageType, quantity, and unitWeight are required',
            });
        }

        // Verify ownership
        const hasAccess = await verifyBatchOwnership(batchId, userId, req);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Access denied to this batch',
            });
        }

        // Verify batch exists (without fetching lots — service handles that internally).
        const batchExists = await traceabilityService.findHarvestBatchFarmId(batchId);
        if (!batchExists) {
            return res.status(404).json({
                success: false,
                message: 'Harvest batch not found',
            });
        }

        // Bug 5.5: the lotNumber suffix used to be inlined here as
        // `String.fromCharCode(65 + lotCount)`, which breaks past 26 lots ('['
        // and beyond) and raced on the @unique lotNumber. It is now allocated
        // INSIDE the locked createLotWithQuotaCheck tx via the shared guarded
        // traceabilityService.buildLotNumber (A..Z then -27.. past 26) with a
        // bounded retry-on-P2002 — so we no longer compute or pass it here.

        // Generate a stable QR id first, then bind tracking URL to the created lot ID.
        const qrCode = qrcodeService.generateQRCodeId();

        // Calculate total weight
        const totalWeight = parseFloat(quantity) * parseFloat(unitWeight);

        // createLotWithQuotaCheck fetches the batch, enforces the weight quota at
        // the service layer (GACP compliance — overselling is a certification breach),
        // allocates a race-safe lotNumber, then creates the lot atomically.
        const createdLot = await traceabilityService.createLotWithQuotaCheck(batchId, {
            packageType,
            quantity: parseInt(quantity),
            unitWeight: parseFloat(unitWeight),
            totalWeight,
            processedAt: processedAt ? new Date(processedAt) : null,
            packagedAt: packagedAt ? new Date(packagedAt) : new Date(),
            expiryDate: expiryDate ? new Date(expiryDate) : null,
            // T10b: no thcContent / cbdContent / moistureContent / labTestReportUrl /
            // testStatus. A new lot makes no lab claim of its own — it inherits the
            // batch's report (services/lab-evidence-service.js), and `testStatus` is
            // left NULL so that null reads as "never claimed" while older rows keep
            // the claim they were written with.
            destinationType,
            destination,
            qrCode,
            trackingUrl: null,
            status: 'PACKAGED',
        });
        const trackingUrl = qrcodeService.generatePublicTraceUrl(`lot/${createdLot.id}`);
        const lot = await traceabilityService.updateLotTrackingUrl(createdLot.id, trackingUrl);

        // T10b: the Attachment dual-write that used to stand here mirrored
        // lot.labTestReportUrl, which no door can set any more — it would have been a
        // branch that can never be taken, which reads to the next person like a
        // feature that exists. A lot's lab evidence lives on its batch now
        // (services/batch-lab-result-service.js).

        await qrcodeService.registerTraceIntegrity({
            entityType: 'PACKAGING_LOT',
            entityId: lot.id,
            qrCode: lot.qrCode,
            publicUrl: lot.trackingUrl,
            payload: {
                scope: 'RAW_MATERIAL_GACP',
                source: 'MANUAL',
                lotId: lot.id,
                lotNumber: lot.lotNumber,
                batchId: lot.batchId,
                packagingType: lot.packageType,
                unitWeight: lot.unitWeight,
                unitCount: lot.quantity,
                totalWeight: lot.totalWeight,
            },
        }).catch((error) => {
            logger.warn('[lots] QR integrity persistence failed', {
                message: error.message,
                lotId: lot.id,
            });
        });

        await Promise.all([
            auditLogger.log({
                category: AuditCategory.APPLICATION,
                action: 'MANUAL_LOT_CREATED',
                severity: AuditSeverity.INFO,
                actorId: req.user?.id || 'SYSTEM',
                actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
                actorType: 'USER',
                resourceType: ResourceType.APPLICATION,
                resourceId: batchId,
                ipAddress: getRequestIp(req),
                userAgent: req.get('user-agent'),
                metadata: {
                    lotId: lot.id,
                    lotNumber: lot.lotNumber,
                    packageType: lot.packageType,
                    quantity: lot.quantity,
                    unitWeight: lot.unitWeight,
                    totalWeight: lot.totalWeight,
                    source: 'MANUAL',
                    actorIdentityMasked: maskThaiId(req.user?.healthId) || maskThaiId(req.user?.providerId) || null,
                },
            }),
            auditLogger.log({
                category: AuditCategory.APPLICATION,
                action: 'QR_GENERATED',
                severity: AuditSeverity.INFO,
                actorId: req.user?.id || 'SYSTEM',
                actorRole: req.user?.canonicalRole || req.user?.role || 'UNKNOWN',
                actorType: 'USER',
                resourceType: ResourceType.APPLICATION,
                resourceId: batchId,
                ipAddress: getRequestIp(req),
                userAgent: req.get('user-agent'),
                metadata: {
                    entityType: 'PACKAGING_LOT',
                    entityId: lot.id,
                    qrCode: lot.qrCode,
                    trackingUrl: lot.trackingUrl,
                },
            }),
        ]).catch((auditError) => {
            logger.warn('[lots] audit log failed', { message: auditError.message, lotId: lot.id });
        });

        res.status(201).json({
            success: true,
            message: 'Lot created successfully',
            data: {
                lot,
                qrCode: {
                    qrCode: lot.qrCode,
                    trackingUrl: lot.trackingUrl,
                },
            },
        });
    } catch (error) {
        if (error.code === 'LOT_WEIGHT_QUOTA_EXCEEDED') {
            return res.status(400).json({
                success: false,
                message: error.message,
                code: 'LOT_WEIGHT_QUOTA_EXCEEDED',
                details: { limit: error.limit, used: error.used, requested: error.requested, remaining: error.remaining },
            });
        }
        if (error.code === 'NOT_FOUND') {
            return res.status(404).json({ success: false, message: error.message });
        }
        // Bug 5.5: an unresolved lot-number collision is a retryable conflict,
        // not a server fault — return 409 instead of a misleading 500.
        if (error.code === 'LOT_NUMBER_CONFLICT' || error.statusCode === 409) {
            logger.warn('[lots] lot-number conflict', { message: error.message });
            return res.status(409).json({ success: false, message: safeErrorMessage(error) });
        }
        logger.error('Error creating lot:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create lot',
            error: safeErrorMessage(error),
        });
    }
});

/**
 * GET /api/lots/:id
 * Get lot details with batch and farm info
 */
router.get('/:id', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        const lot = await traceabilityService.findLotDetailById(id);

        if (!lot) {
            return res.status(404).json({
                success: false,
                message: 'Lot not found',
            });
        }

        // 404 (not 403) on cross-tenant access — same shape as "doesn't
        // exist" so /:id can't be enumerated by response code differential
        // (T-014 / PR-02).
        const farmIds = await getUserFarmIds(userId, req);
        if (!farmIds.includes(lot.batch?.farmId)) {
            return res.status(404).json({
                success: false,
                message: 'Lot not found',
            });
        }

        res.json({
            success: true,
            data: lot,
        });
    } catch (error) {
        logger.error('Error fetching lot:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch lot',
            error: safeErrorMessage(error),
        });
    }
});

/**
 * PUT /api/lots/:id
 * Update lot details (partial update)
 * 
 * BUSINESS RULES:
 * - Before printing (printedAt is null): Can edit packing dates only
 *   - Allowed: processedAt, packagedAt
 * - After printing (printedAt is set): NO edits allowed - data is locked
 * - T10b: the lab fields are not "disallowed here", they are not writable ANYWHERE
 *   by a farmer. They get their own refusal, ahead of the print lock, because the
 *   answer is the same whether the lot is printed, unprinted, or somebody else's.
 */
router.put('/:id', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        // T10b — before any lookup: these five are refused for every caller, every
        // lot, every state. Answering them from the database first would only tell a
        // prober which lot ids exist.
        try {
            assertNoTypedLabValues(req.body);
        } catch (labErr) {
            if (labErr.code !== 'LAB_VALUES_NOT_TYPED') { throw labErr; }
            return res.status(400).json({
                success: false,
                code: labErr.code,
                message: labErr.messageTh,
                messageEN: labErr.message,
                fields: labErr.fields,
            });
        }

        const { processedAt, packagedAt } = req.body;

        // Check lot exists
        const existing = await traceabilityService.findLotForUpdate(id);

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Lot not found',
            });
        }

        // 404 (not 403) on cross-tenant access — see GET /:id.
        const farmIds = await getUserFarmIds(userId, req);
        if (!farmIds.includes(existing.batch?.farmId)) {
            return res.status(404).json({
                success: false,
                message: 'Lot not found',
            });
        }

        // First-cycle auto-generated lots are immutable.
        if (traceabilityService.isAutoTraceBatch(existing.batch)) {
            return res.status(403).json({
                success: false,
                message: 'Auto-created first-cycle lots cannot be edited',
            });
        }

        // === PRINT LOCK CHECK ===
        // Once printed, data cannot be modified
        if (existing.printedAt) {
            return res.status(403).json({
                success: false,
                message: 'ไม่สามารถแก้ไขข้อมูลได้ เนื่องจาก QR Code ถูกพิมพ์แล้ว',
                messageEN: 'Cannot modify data - QR Code has already been printed',
                printedAt: existing.printedAt,
            });
        }

        // === ALLOWED FIELDS (Before Print) ===
        // Only planting-related and plant identity data can be edited
        const allowedFields = ['processedAt', 'packagedAt'];

        // Check for disallowed fields in request
        const requestedFields = Object.keys(req.body);
        const disallowedFields = requestedFields.filter(f => !allowedFields.includes(f));
        if (disallowedFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `ไม่อนุญาตให้แก้ไขฟิลด์: ${disallowedFields.join(', ')}`,
                messageEN: `Cannot modify fields: ${disallowedFields.join(', ')}`,
                allowedFields,
            });
        }

        // Build update data (only include provided fields)
        const updateData = {};
        if (processedAt !== undefined) { updateData.processedAt = processedAt ? new Date(processedAt) : null; }
        if (packagedAt !== undefined) { updateData.packagedAt = packagedAt ? new Date(packagedAt) : null; }

        const lot = await traceabilityService.updateLotWithFarmInclude(id, updateData);

        // T10b: the detach-old/attach-new sync that stood here mirrored
        // labTestReportUrl, which this door no longer accepts, so the branch could
        // never be entered again. Removed rather than left as scenery.

        res.json({
            success: true,
            message: 'Lot updated successfully',
            data: lot,
            note: 'ข้อมูลจะถูกล็อคเมื่อพิมพ์ QR Code',
        });
    } catch (error) {
        logger.error('Error updating lot:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update lot',
            error: safeErrorMessage(error),
        });
    }
});

// X1-FIX-A / C-4: registrar now requires `authenticateHealth` +
// `getUserFarmIds` so the 4 utility routes (POST /:id/print, GET /:id/qr,
// GET /:id/qr/print, GET /batch/:batchId) gate on the caller's identity
// and farm-ownership — same pattern as the sibling registerLotLabelRoutes
// call below. Pre-fix these 4 routes were anonymous (X1-D §4 H-1).
registerLotUtilityRoutes({
    router,
    prisma,
    qrcodeService,
    authenticateHealth,
    getUserFarmIds,
    logger,
});

/**
 * GET /api/lots/:id/label
 * Download a single lot label PDF (100×100mm sticker)
 */
registerLotLabelRoutes({
    router,
    prisma,
    authenticateHealth,
    getUserFarmIds,
    logger,
});

module.exports = router;
