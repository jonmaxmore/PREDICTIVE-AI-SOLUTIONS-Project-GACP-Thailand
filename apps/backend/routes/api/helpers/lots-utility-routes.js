const { safeErrorMessage } = require('../../../shared/api-response');
const traceabilityService = require('../../../services/traceability-service');
const { publicTraceUrlFor } = require('../../../services/qrcode/public-trace-url');

/**
 * X1-FIX-A / C-4 — Lot utility routes (print + QR + batch listing).
 *
 * Pre-fix: this registrar mounted four routes on `/api/lots` with NO auth
 * and NO ownership filter (see X1-D §4 H-1 + §5 — `POST /:id/print`,
 * `GET /:id/qr`, `GET /:id/qr/print`, `GET /batch/:batchId`). Any
 * anonymous caller could read or even mark-printed any lot's data by
 * guessing IDs. The sibling `lots-label-routes.js` (label PDFs) and the
 * primary `lots.js:286` (GET /:id) BOTH gated on `authenticateHealth` +
 * `getUserFarmIds(userId).includes(lot.batch.farmId)` — this file now
 * follows the same pattern.
 *
 * Per the canonical pattern (lots.js:300-308 + lots-label-routes.js:25-29):
 *   - 404 on cross-tenant access (not 403). Same shape as
 *     "lot doesn't exist" so ids can't be enumerated by response-code
 *     differential. Anti-enumeration per T-014 / PR-02.
 *   - The ownership check runs AFTER the existence probe so the response
 *     for "id exists, not yours" matches "id never existed".
 *   - For batch-listing the ownership probe inspects the BATCH's farmId
 *     (since the route key is batchId, not lotId). Same pattern as
 *     `verifyBatchOwnership` in lots.js:51-58.
 */
function registerLotUtilityRoutes({
    router,
    // `prisma` is no longer needed — kept in the signature for backwards
    // compatibility with callers that still pass it, but unused (Batch 16).
    prisma: _prismaUnused,
    qrcodeService,
    authenticateHealth,
    getUserFarmIds,
    // The lot WRITE gate (the farms the caller owns, pre-R2); reads use getUserFarmIds.
    getUserWritableFarmIds,
    logger,
}) {
    if (typeof getUserWritableFarmIds !== 'function') {
        throw new Error('lot routes: getUserWritableFarmIds(userId, req) is required for the write doors');
    }
    if (typeof authenticateHealth !== 'function') {
        throw new Error(
            'registerLotUtilityRoutes: authenticateHealth middleware is required '
                + '(X1-FIX-A / C-4 RBAC hardening — see lots-utility-routes.js)',
        );
    }
    if (typeof getUserFarmIds !== 'function') {
        throw new Error(
            'registerLotUtilityRoutes: getUserFarmIds(userId) helper is required '
                + '(X1-FIX-A / C-4 RBAC hardening — see lots-utility-routes.js)',
        );
    }

    /**
     * POST /api/lots/:id/print
     * Mark lot as printed — locks all future edits.
     *
     * Auth: authenticateHealth + caller must own the lot's farm. Pre-X1
     * this route accepted anonymous callers; any visitor could flip a
     * lot to "printed" (locking the owner out of edits) by guessing ids.
     */
    router.post('/:id/print', authenticateHealth, async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user?.id;

            // Existence + ownership probe in one round-trip — same helper
            // GET /api/lots/:id uses (lots.js:286-323).
            const lot = await traceabilityService.findLotDetailById(id);
            if (!lot) {
                return res.status(404).json({
                    success: false,
                    message: 'Lot not found',
                });
            }
            const farmIds = await getUserWritableFarmIds(userId, req);
            if (!farmIds.includes(lot.batch?.farmId)) {
                // 404 not 403 — anti-enumeration (T-014 / PR-02).
                return res.status(404).json({
                    success: false,
                    message: 'Lot not found',
                });
            }

            // The findLotForPrintCheck projection has the print-lock fields
            // we need for the idempotency branch. We already loaded the full
            // lot above for the ownership probe, but findLotForPrintCheck
            // exists for back-compat with the previous direct-prisma call.
            const existing = await traceabilityService.findLotForPrintCheck(id);
            if (existing?.printedAt) {
                return res.json({
                    success: true,
                    message: 'QR Code ถูกพิมพ์แล้ว',
                    alreadyPrinted: true,
                    printedAt: existing.printedAt,
                });
            }

            let marked;
            try {
                marked = await traceabilityService.markLotAsPrinted(id);
            } catch (claimErr) {
                // Concurrent print won the atomic claim (printedAt was set
                // between our TOCTOU probe and the update). Treat as the same
                // idempotent already-printed success the probe branch returns.
                if (claimErr?.code === 'LOT_ALREADY_PRINTED') {
                    const current = await traceabilityService.findLotForPrintCheck(id);
                    return res.json({
                        success: true,
                        message: 'QR Code ถูกพิมพ์แล้ว',
                        alreadyPrinted: true,
                        printedAt: current?.printedAt || null,
                    });
                }
                throw claimErr;
            }

            return res.json({
                success: true,
                message: 'บันทึกการพิมพ์ QR Code สำเร็จ - ข้อมูลถูกล็อคแล้ว',
                messageEN: 'Print recorded - data is now locked',
                data: {
                    lotNumber: marked.lotNumber,
                    printedAt: marked.printedAt,
                    isLocked: true,
                },
            });
        } catch (error) {
            logger.error('Error marking lot as printed:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to record print',
                error: safeErrorMessage(error),
            });
        }
    });

    /**
     * GET /api/lots/:id/qr
     * Get QR code as PNG image.
     *
     * Auth: authenticateHealth + farm-ownership. Pre-X1 leaked the QR
     * payload (a stable trackingUrl that survives across cert revocation
     * windows) to unauthenticated callers.
     */
    router.get('/:id/qr', authenticateHealth, async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user?.id;

            // Ownership probe via the detailed lot so we can read batch.farmId.
            const lot = await traceabilityService.findLotDetailById(id);
            if (!lot) {
                return res.status(404).json({
                    success: false,
                    message: 'QR code not found',
                });
            }
            const farmIds = await getUserFarmIds(userId, req);
            if (!farmIds.includes(lot.batch?.farmId)) {
                // 404 not 403 — anti-enumeration.
                return res.status(404).json({
                    success: false,
                    message: 'QR code not found',
                });
            }

            const payload = await traceabilityService.findLotQrPayload(id);
            if (!payload || !payload.qrCode) {
                return res.status(404).json({
                    success: false,
                    message: 'QR code not found',
                });
            }

            const qrBuffer = await qrcodeService.generateBuffer(payload.qrCode, {
                url:
                    payload.trackingUrl
                    || qrcodeService.generatePublicTraceUrl(`lot/${id}`),
                width: 300,
            });

            res.set('Content-Type', 'image/png');
            return res.send(qrBuffer);
        } catch (error) {
            logger.error('Error generating QR code:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to generate QR code',
                error: safeErrorMessage(error),
            });
        }
    });

    /**
     * GET /api/lots/:id/qr/print
     * Get printable QR label with product info (JSON for frontend to render).
     *
     * Auth: authenticateHealth + farm-ownership. The label payload includes
     * `farmName`, `province`, `packageType`, `weight`, `harvestDate` — a
     * PDPA Section 6 "ที่ตั้งกิจการ" indirect identifier that must not be
     * world-readable. X1-D H-1 flagged this leak as LOW-MED.
     */
    router.get('/:id/qr/print', authenticateHealth, async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user?.id;

            // `findLotPrintLabelPayload` already includes batch + farm, so
            // we can do the ownership probe off the same single fetch and
            // skip a duplicate round-trip.
            const lot = await traceabilityService.findLotPrintLabelPayload(id);
            if (!lot) {
                return res.status(404).json({
                    success: false,
                    message: 'Lot not found',
                });
            }
            const farmIds = await getUserFarmIds(userId, req);
            // `findLotPrintLabelPayload` includes batch.farm but only
            // selects { farmName, farmNameTH, province }. The farmId we
            // need for the ownership probe is on `lot.batch.farmId` (Prisma
            // returns FK fields by default unless explicitly excluded).
            if (!farmIds.includes(lot.batch?.farmId)) {
                // 404 not 403 — anti-enumeration.
                return res.status(404).json({
                    success: false,
                    message: 'Lot not found',
                });
            }

            const qrDataUrl = await qrcodeService.generateDataUrl(lot.qrCode, {
                // ค่าที่เก็บไว้ชนะ เว้นแต่มันพาไปไม่ถึง (แถวเก่าเก็บ http://localhost/…)
                url: publicTraceUrlFor(lot.trackingUrl, `lot/${lot.id}`),
                width: 200,
            });

            return res.json({
                success: true,
                data: {
                    label: {
                        qrCodeDataUrl: qrDataUrl,
                        lotNumber: lot.lotNumber,
                        plant: lot.batch.plant?.nameTH || 'กัญชา',
                        farmName: lot.batch.farm.farmName,
                        province: lot.batch.farm.province,
                        packageType: lot.packageType,
                        weight: `${lot.unitWeight} กก.`,
                        harvestDate: lot.batch.harvestDate,
                        packagedAt: lot.packagedAt,
                        expiryDate: lot.expiryDate,
                        trackingUrl: lot.trackingUrl,
                    },
                },
            });
        } catch (error) {
            logger.error('Error generating print label:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to generate print label',
                error: safeErrorMessage(error),
            });
        }
    });

    /**
     * GET /api/lots/batch/:batchId
     * List all lots for a batch.
     *
     * Auth: authenticateHealth + batch-ownership (the batch's farmId must
     * be one of the caller's owned farms). Pattern matches the
     * `verifyBatchOwnership` helper in lots.js:51-58.
     *
     * Pre-X1 returned the complete lot listing — lotNumber, weights,
     * packagedAt, expiryDate — to any caller who guessed a batch UUID.
     */
    router.get('/batch/:batchId', authenticateHealth, async (req, res) => {
        try {
            const { batchId } = req.params;
            const userId = req.user?.id;

            // Existence + ownership in one probe. Returns just the farmId
            // (`{ farmId }`) per the service helper contract.
            const batch =
                await traceabilityService.findHarvestBatchFarmId(batchId);
            if (!batch) {
                return res.status(404).json({
                    success: false,
                    message: 'Batch not found',
                });
            }
            const farmIds = await getUserFarmIds(userId, req);
            if (!farmIds.includes(batch.farmId)) {
                // 404 not 403 — anti-enumeration.
                return res.status(404).json({
                    success: false,
                    message: 'Batch not found',
                });
            }

            const lots = await traceabilityService.listLotsByBatchId(batchId);

            return res.json({
                success: true,
                count: lots.length,
                data: lots,
            });
        } catch (error) {
            logger.error('Error fetching lots:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch lots',
                error: safeErrorMessage(error),
            });
        }
    });
}

module.exports = {
    registerLotUtilityRoutes,
};
