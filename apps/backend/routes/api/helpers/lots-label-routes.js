const { safeErrorMessage } = require('../../../shared/api-response');
const traceabilityService = require('../../../services/traceability-service');

function registerLotLabelRoutes({
    router,
    // `prisma` is no longer needed — kept in the signature for backwards
    // compatibility with callers that still pass it, but unused (Batch 16).
    prisma: _prismaUnused,
    authenticateHealth,
    getUserFarmIds,
    // The lot WRITE gate (the farms the caller owns, pre-R2); reads use getUserFarmIds.
    getUserWritableFarmIds,
    logger,
}) {
    if (typeof getUserWritableFarmIds !== 'function') {
        throw new Error('lot routes: getUserWritableFarmIds(userId, req) is required for the write doors');
    }
    router.get('/:id/label', authenticateHealth, async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user?.id;

            const lot = await traceabilityService.findLotForLabel(id);

            if (!lot) {
                return res.status(404).json({ success: false, message: 'Lot not found' });
            }

            // 404 (not 403) on cross-tenant access — same shape as
            // "lot doesn't exist" so attackers can't enumerate ids by
            // response code differential (T-014 / PR-02).
            const farmIds = await getUserFarmIds(userId, req);
            if (!farmIds.includes(lot.batch?.farmId)) {
                return res.status(404).json({ success: false, message: 'Lot not found' });
            }

            const { generateLotLabelPdf } = require('../../../services/pdf/lot-label-template-service');
            const buffer = await generateLotLabelPdf(lot);

            const filename = `Label-${lot.lotNumber || lot.id}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Length', buffer.length);
            return res.send(buffer);
        } catch (error) {
            logger.error('[lots] Label generation failed:', error);
            res.status(500).json({ success: false, message: 'Failed to generate label', error: safeErrorMessage(error) });
        }
    });

    router.post('/labels', authenticateHealth, async (req, res) => {
        try {
            const userId = req.user?.id;
            const { lotIds } = req.body;

            if (!Array.isArray(lotIds) || lotIds.length === 0) {
                return res.status(400).json({ success: false, message: 'lotIds array is required' });
            }

            if (lotIds.length > 50) {
                return res.status(400).json({ success: false, message: 'Maximum 50 labels per batch' });
            }

            const farmIds = await getUserWritableFarmIds(userId, req);

            const lots = await traceabilityService.findLotsForBatchLabels(lotIds);

            // Reject the whole batch if any id isn't owned by the caller.
            // 404 with the same shape as "no lots found" — silent filtering
            // would let an attacker probe ids by which ones come back
            // (T-014 / PR-02).
            const unauthorized = lots.filter((lot) => !farmIds.includes(lot.batch?.farmId));
            if (unauthorized.length > 0 || lots.length === 0) {
                return res.status(404).json({ success: false, message: 'Lots not found' });
            }

            const { generateBatchLabelsPdf } = require('../../../services/pdf/lot-label-template-service');
            const buffer = await generateBatchLabelsPdf(lots);

            const filename = `Labels-batch-${Date.now()}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Length', buffer.length);
            return res.send(buffer);
        } catch (error) {
            logger.error('[lots] Batch label generation failed:', error);
            res.status(500).json({ success: false, message: 'Failed to generate labels', error: safeErrorMessage(error) });
        }
    });
}

module.exports = {
    registerLotLabelRoutes,
};
