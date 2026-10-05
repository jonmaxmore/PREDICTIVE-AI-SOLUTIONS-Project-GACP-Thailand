const cultivationLogService = require('../services/cultivation-log-service');
const { createLogger } = require('../shared/logger');
const { prisma } = require('../services/prisma-database');
// Wave A chunk 3 (2026-07-02): log guards widen from the legacy owner pin to
// owner-OR-ACTIVE-entity-co-member via the single farm-access predicate.
const { resolveFarmAccess, listAccessibleFarmIds } = require('../services/farm-access');
// Wave B fix M3 (2026-07-03): this router is the API-drivable TWIN of the
// gated /planting-cycles/:id/activities surface — its mutations now carry
// the SAME per-type permission gate (403 ENTITY_PERMISSION_DENIED).
const { assertFarmActionPermission } = require('../services/entity-effective-permissions-service');

const logger = createLogger('cultivation-log-controller');

/**
 * M3 — logType → per-type permission code, mirroring the gated activities
 * route (planting-cycle-service.resolveActivityPermission): legacy aliases
 * PESTICIDE/WEEDING normalize to PEST_CONTROL/WEED_CONTROL. This router's
 * OWN extra catalog types (getLogTypes: PRUNING, OBSERVATION) map to
 * ACTIVITY_OTHER — 400-ing the router's own advertised values would brick
 * them even for the owner. A missing type follows the service default
 * (createLog: `logType || 'OBSERVATION'`). Anything else → null → 400
 * BEFORE any engine call.
 */
const LOG_TYPE_PERMISSION = Object.freeze({
    IRRIGATION: 'ACTIVITY_IRRIGATION',
    FERTILIZER: 'ACTIVITY_FERTILIZER',
    PESTICIDE: 'ACTIVITY_PEST_CONTROL',
    PEST_CONTROL: 'ACTIVITY_PEST_CONTROL',
    WEEDING: 'ACTIVITY_WEED_CONTROL',
    WEED_CONTROL: 'ACTIVITY_WEED_CONTROL',
    INSPECTION: 'ACTIVITY_INSPECTION',
    INCIDENT: 'ACTIVITY_INCIDENT',
    PRUNING: 'ACTIVITY_OTHER',
    OBSERVATION: 'ACTIVITY_OTHER',
    OTHER: 'ACTIVITY_OTHER',
});

function resolveLogTypePermission(logType, { forStoredRow = false } = {}) {
    const normalized = String(logType || 'OBSERVATION').trim().toUpperCase();
    const permission = LOG_TYPE_PERMISSION[normalized] || null;
    if (!permission && forStoredRow) {
        // A legacy STORED row with an unrecognised type must stay
        // editable/deletable by someone — fall back to the catch-all code
        // rather than bricking the row (creates stay strict).
        return 'ACTIVITY_OTHER';
    }
    return permission;
}

/** Map an ENTITY_PERMISSION_DENIED throw to the canonical 403 body. */
function respondPermissionDenied(res, error, fallbackPermission) {
    return res.status(403).json({
        success: false,
        code: 'ENTITY_PERMISSION_DENIED',
        permission: error?.permission || fallbackPermission,
        message: 'คุณไม่มีสิทธิ์ดำเนินการรายการนี้ในพื้นที่ทำงาน',
    });
}

/**
 * Helper: Get the farm IDs the user can act on (owned + ACTIVE workspace
 * memberships — Wave A chunk 3).
 */
async function getUserFarmIds(userId) {
    if (!userId) {
        return [];
    }
    return listAccessibleFarmIds(userId);
}

/**
 * Helper: resolve the cycle's farmId when the caller can reach it
 * (owner or ACTIVE workspace co-member). Returns null on miss → 404.
 */
async function resolveAccessibleCycleFarmId(cycleId, userId) {
    const cycle = await prisma.plantingCycle.findUnique({
        where: { id: cycleId },
        select: { farmId: true },
    });
    if (!cycle) {
        return null;
    }
    const farmIds = await getUserFarmIds(userId);
    return farmIds.includes(cycle.farmId) ? cycle.farmId : null;
}

/**
 * Helper: Verify cycle ownership
 */
async function verifyCycleOwnership(cycleId, userId) {
    return (await resolveAccessibleCycleFarmId(cycleId, userId)) !== null;
}

/**
 * Helper: Verify farm ownership
 */
async function verifyFarmOwnership(farmId, userId) {
    const farmIds = await getUserFarmIds(userId);
    return farmIds.includes(farmId);
}

/**
 * Cultivation Log Controller
 * API endpoints for GACP cultivation logging (หมวด 3)
 */

/**
 * Create a new cultivation log
 * POST /api/cultivation-logs
 */
exports.createLog = async (req, res) => {
    try {
        const { cycleId, ...logData } = req.body;
        const userId = req.user?.id;

        if (!cycleId) {
            return res.status(400).json({
                success: false,
                message: 'Cycle ID is required',
            });
        }

        // Verify ownership — 404 (not 403) to avoid leaking which cycle ids
        // exist on other tenants' farms (T-014 / PR-02).
        const farmId = await resolveAccessibleCycleFarmId(cycleId, userId);
        if (!farmId) {
            return res.status(404).json({
                success: false,
                message: 'Planting cycle not found',
            });
        }

        // M3 — per-type gate, same taxonomy as the gated activities route.
        // Unknown types 400 BEFORE the engine (creates are strict).
        const permission = resolveLogTypePermission(logData.logType);
        if (!permission) {
            return res.status(400).json({
                success: false,
                message: 'Invalid logType',
            });
        }
        try {
            await assertFarmActionPermission({ farmId, userId, permission });
        } catch (permError) {
            if (permError?.code === 'ENTITY_PERMISSION_DENIED') {
                return respondPermissionDenied(res, permError, permission);
            }
            throw permError;
        }

        const log = await cultivationLogService.createLog(cycleId, logData, userId);

        logger.info(`Cultivation log created: ${log.id} for cycle ${cycleId}`);

        res.status(201).json({
            success: true,
            message: 'Cultivation log created successfully',
            data: log,
        });
    } catch (error) {
        logger.error('Create cultivation log error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create cultivation log',
        });
    }
};

/**
 * Get logs for a planting cycle
 * GET /api/cultivation-logs/cycle/:cycleId
 */
exports.getLogsByCycle = async (req, res) => {
    try {
        const { cycleId } = req.params;
        const { logType, startDate, endDate, limit } = req.query;
        const userId = req.user?.id;

        const hasAccess = await verifyCycleOwnership(cycleId, userId);
        if (!hasAccess) {
            return res.status(404).json({
                success: false,
                message: 'Planting cycle not found',
            });
        }

        const logs = await cultivationLogService.getLogsByCycle(cycleId, {
            logType,
            startDate,
            endDate,
            limit: limit ? parseInt(limit) : undefined,
        });

        res.json({
            success: true,
            data: logs,
            count: logs.length,
        });
    } catch (error) {
        logger.error('Get cycle logs error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch cultivation logs',
        });
    }
};

/**
 * Get a single log by ID
 * GET /api/cultivation-logs/:id
 */
exports.getLogById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const log = await cultivationLogService.getLogById(id);

        if (!log) {
            return res.status(404).json({
                success: false,
                message: 'Cultivation log not found',
            });
        }

        if (!(await resolveFarmAccess(log.cycle?.farm, userId))) {
            return res.status(404).json({
                success: false,
                message: 'Cultivation log not found',
            });
        }

        res.json({
            success: true,
            data: log,
        });
    } catch (error) {
        logger.error('Get log by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch cultivation log',
        });
    }
};

/**
 * Update a cultivation log
 * PUT /api/cultivation-logs/:id
 */
exports.updateLog = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const userId = req.user?.id;

        // Check if log exists
        const existing = await cultivationLogService.getLogById(id);
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Cultivation log not found',
            });
        }
        if (!(await resolveFarmAccess(existing.cycle?.farm, userId))) {
            return res.status(404).json({
                success: false,
                message: 'Cultivation log not found',
            });
        }

        // M3 — gate on the ROW's own type; when the payload RE-TYPES the
        // row, the target type must be held too (a worker granted only
        // ACTIVITY_IRRIGATION must not convert their log into a
        // pest-control record). Unknown STORED types fall back to
        // ACTIVITY_OTHER so legacy rows stay editable by the owner.
        const rowPermission = resolveLogTypePermission(existing.logType, { forStoredRow: true });
        const targetPermission = updateData?.logType !== undefined
            ? resolveLogTypePermission(updateData.logType)
            : rowPermission;
        if (!targetPermission) {
            return res.status(400).json({
                success: false,
                message: 'Invalid logType',
            });
        }
        try {
            await assertFarmActionPermission({
                farm: existing.cycle?.farm, userId, permission: rowPermission,
            });
            if (targetPermission !== rowPermission) {
                await assertFarmActionPermission({
                    farm: existing.cycle?.farm, userId, permission: targetPermission,
                });
            }
        } catch (permError) {
            if (permError?.code === 'ENTITY_PERMISSION_DENIED') {
                return respondPermissionDenied(res, permError, rowPermission);
            }
            throw permError;
        }

        const updated = await cultivationLogService.updateLog(id, updateData);

        logger.info(`Cultivation log updated: ${id}`);

        res.json({
            success: true,
            message: 'Cultivation log updated successfully',
            data: updated,
        });
    } catch (error) {
        logger.error('Update log error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update cultivation log',
        });
    }
};

/**
 * Delete a cultivation log
 * DELETE /api/cultivation-logs/:id
 */
exports.deleteLog = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        // Check if log exists
        const existing = await cultivationLogService.getLogById(id);
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Cultivation log not found',
            });
        }

        if (!(await resolveFarmAccess(existing.cycle?.farm, userId))) {
            return res.status(404).json({
                success: false,
                message: 'Cultivation log not found',
            });
        }

        // M3 — delete gates on the ROW's own type (unknown stored types fall
        // back to ACTIVITY_OTHER so legacy rows stay deletable by the owner).
        const permission = resolveLogTypePermission(existing.logType, { forStoredRow: true });
        try {
            await assertFarmActionPermission({
                farm: existing.cycle?.farm, userId, permission,
            });
        } catch (permError) {
            if (permError?.code === 'ENTITY_PERMISSION_DENIED') {
                return respondPermissionDenied(res, permError, permission);
            }
            throw permError;
        }

        await cultivationLogService.deleteLog(id);

        logger.info(`Cultivation log deleted: ${id}`);

        res.json({
            success: true,
            message: 'Cultivation log deleted successfully',
        });
    } catch (error) {
        logger.error('Delete log error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete cultivation log',
        });
    }
};

/**
 * Get summary statistics for a cycle
 * GET /api/cultivation-logs/cycle/:cycleId/summary
 */
exports.getCycleSummary = async (req, res) => {
    try {
        const { cycleId } = req.params;
        const userId = req.user?.id;

        const hasAccess = await verifyCycleOwnership(cycleId, userId);
        if (!hasAccess) {
            return res.status(404).json({
                success: false,
                message: 'Planting cycle not found',
            });
        }

        const summary = await cultivationLogService.getCycleSummary(cycleId);

        res.json({
            success: true,
            data: summary,
        });
    } catch (error) {
        logger.error('Get cycle summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch summary',
        });
    }
};

/**
 * Get all logs for a farm
 * GET /api/cultivation-logs/farm/:farmId
 */
exports.getLogsByFarm = async (req, res) => {
    try {
        const { farmId } = req.params;
        const { limit } = req.query;
        const userId = req.user?.id;

        const hasAccess = await verifyFarmOwnership(farmId, userId);
        if (!hasAccess) {
            return res.status(404).json({
                success: false,
                message: 'Farm not found',
            });
        }

        const logs = await cultivationLogService.getLogsByFarm(farmId, {
            limit: limit ? parseInt(limit) : undefined,
        });

        res.json({
            success: true,
            data: logs,
            count: logs.length,
        });
    } catch (error) {
        logger.error('Get farm logs error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch farm logs',
        });
    }
};

/**
 * Get log type options (for dropdown)
 * GET /api/cultivation-logs/types
 */
exports.getLogTypes = (req, res) => {
    const types = [
        { value: 'IRRIGATION', label: 'การให้น้ำ', labelEN: 'Irrigation' },
        { value: 'FERTILIZER', label: 'การใส่ปุ๋ย', labelEN: 'Fertilizer' },
        { value: 'PESTICIDE', label: 'การใช้สารเคมี/ชีวภัณฑ์', labelEN: 'Pesticide/Biocontrol' },
        { value: 'WEEDING', label: 'การกำจัดวัชพืช', labelEN: 'Weeding' },
        { value: 'PRUNING', label: 'การตัดแต่ง', labelEN: 'Pruning' },
        { value: 'OBSERVATION', label: 'สังเกตการณ์ทั่วไป', labelEN: 'General Observation' },
        { value: 'OTHER', label: 'อื่น ๆ', labelEN: 'Other' },
    ];

    res.json({
        success: true,
        data: types,
    });
};
