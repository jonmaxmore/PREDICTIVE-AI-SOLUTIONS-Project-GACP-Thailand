const { safeErrorMessage } = require('../../../shared/api-response');
// Batch 15 prisma-bypass cleanup (2026-05-16): direct prisma access
// moved to `traceability-service`. The dispatch table below still
// resolves the prisma model name (`harvestBatch`, `lot`,
// `plantingCycle`) but the actual `findFirst` call lives in the
// service.
const traceabilityService = require('../../../services/traceability-service');

// Allow-list of entityType values that the public /verify endpoint will accept.
// Anything outside this set is rejected — prevents the endpoint from being
// abused to flood `traceQrSecurity` / `traceQrScan` with arbitrary keys.
const VERIFY_ENTITY_TYPES = Object.freeze({
    HARVEST_BATCH: 'harvestBatch',
    PACKAGING_LOT: 'lot',
    PLANTING_CYCLE: 'plantingCycle',
});

function registerVerificationRoutes(router, deps) {
    const {
        authenticateHealth,
        qrcodeService,
        TRACE_BASE_URL,
        buildIntegrityPayload,
        getRequestIp,
        logger,
    } = deps;

    async function entityExists(entityType, entityId) {
        const modelName = VERIFY_ENTITY_TYPES[entityType];
        if (!modelName) { return false; }
        const found = await traceabilityService.findTraceEntityById(modelName, entityId);
        return Boolean(found);
    }

    router.get('/verify/:entityType/:entityId', async (req, res) => {
        try {
            const entityType = String(req.params.entityType || '').trim().toUpperCase();
            const entityId = String(req.params.entityId || '').trim();

            if (!entityType || !entityId) {
                return res.status(400).json({
                    success: false,
                    message: 'entityType and entityId are required',
                });
            }

            if (!Object.prototype.hasOwnProperty.call(VERIFY_ENTITY_TYPES, entityType)) {
                return res.status(400).json({
                    success: false,
                    message: 'Unsupported entityType',
                    code: 'UNSUPPORTED_ENTITY_TYPE',
                    supported: Object.keys(VERIFY_ENTITY_TYPES),
                });
            }

            // Confirm the entity exists before recording a scan, so that the
            // endpoint cannot be used to (a) flood the scan log with junk
            // entries or (b) probe whether arbitrary IDs exist via timing.
            const exists = await entityExists(entityType, entityId).catch(() => false);
            if (!exists) {
                return res.status(404).json({
                    success: false,
                    message: 'Entity not found',
                });
            }

            const integrity = await qrcodeService.recordTraceScan(entityType, entityId, {
                requestIp: getRequestIp(req),
                userAgent: req.get('user-agent'),
                requestPath: req.originalUrl,
            });

            const payload = buildIntegrityPayload(integrity);
            return res.json({
                success: true,
                data: {
                    entityType,
                    entityId,
                    integrity: payload,
                },
            });
        } catch (error) {
            logger.error({
                type: 'trace_verify_error',
                error: safeErrorMessage(error),
                entityType: req.params.entityType,
                entityId: req.params.entityId,
            }, 'Error verifying trace integrity');
            return res.status(500).json({
                success: false,
                message: 'Failed to verify trace integrity',
                error: safeErrorMessage(error),
            });
        }
    });

    router.post('/generate', authenticateHealth, async (req, res) => {
        try {
            const { type, id } = req.body;

            if (!type || !id) {
                return res.status(400).json({
                    success: false,
                    message: 'type and id are required',
                });
            }

            if (type === 'CYCLE') {
                const cycle = await traceabilityService.findCycleWithFarmForTrace(id);

                if (!cycle || cycle.farm.ownerId !== req.user.id) {
                    return res.status(404).json({
                        success: false,
                        message: 'Cycle not found or access denied',
                    });
                }

                return res.json({
                    success: true,
                    message: 'Trace QR generated successfully',
                    data: {
                        qrCode: cycle.uuid,
                        trackingUrl: `${TRACE_BASE_URL}/trace/${cycle.uuid}`,
                        type: 'CYCLE',
                    },
                });
            } else if (type === 'BATCH') {
                const batch = await traceabilityService.findBatchWithFarmForTrace(id);

                if (!batch || batch.farm.ownerId !== req.user.id) {
                    return res.status(404).json({
                        success: false,
                        message: 'Batch not found or access denied',
                    });
                }

                // One id format across the platform: the UUID the rest of the
                // trace stack already mints (operator 2026-09-05). The old
                // `BT-<base36 time>-<8 hex>` narrowed a guess to whatever was
                // created in that second plus four random bytes — a weaker
                // public address than a UUID, for no gain. It was computed at
                // the top of this handler, before the branch, and the CYCLE
                // branch below returns cycle.uuid and never used it; only this
                // branch persisted it, which is how two formats reached one
                // column. Checked on the real database before removing: no row
                // carries a PREFIX-format code.
                const qrCodeString = qrcodeService.generateQRCodeId();
                const batchTrackingUrl = `${TRACE_BASE_URL}/trace/batch/${id}`;

                const updated = await traceabilityService.updateBatchTraceQr(id, {
                    qrCode: qrCodeString,
                    trackingUrl: batchTrackingUrl,
                });

                await qrcodeService.registerTraceIntegrity({
                    entityType: 'HARVEST_BATCH',
                    entityId: updated.id,
                    qrCode: updated.qrCode,
                    publicUrl: updated.trackingUrl,
                    payload: {
                        scope: 'RAW_MATERIAL_GACP',
                        source: 'MANUAL_QR_REGENERATE',
                        batchId: updated.id,
                        batchNumber: updated.batchNumber,
                    },
                }).catch((error) => {
                    logger.warn('[trace] batch integrity registration failed after QR generate', {
                        error: safeErrorMessage(error),
                        batchId: updated.id,
                    });
                });

                return res.json({
                    success: true,
                    message: 'Trace QR generated successfully',
                    data: {
                        qrCode: qrCodeString,
                        trackingUrl: batchTrackingUrl,
                        batchNumber: updated.batchNumber,
                        type: 'BATCH',
                    },
                });
            }

            return res.status(400).json({
                success: false,
                message: 'Unsupported trace type',
            });
        } catch (error) {
            logger.error('Error generating QR code:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to generate trace QR code',
                error: safeErrorMessage(error),
            });
        }
    });
}

module.exports = {
    registerVerificationRoutes,
};
