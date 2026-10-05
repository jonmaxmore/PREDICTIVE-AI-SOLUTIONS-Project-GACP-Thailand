/**
 * Cultivation Record Service
 *
 * Owns the four GACP cultivation-record tables that previously lived
 * inline in the route layer with copy-pasted ownership predicates:
 *
 *   - SeedSource (registered seed source per cycle)
 *   - WaterSource (water + irrigation per plot)
 *   - FertilizerRecord (registered fertilizer usage per cycle)
 *   - ControlledEnvironment (greenhouse/indoor structure per plot)
 *
 * Built for Batch 15 of the prisma-bypass cleanup (2026-05-16) to
 * replace direct prisma access in:
 *
 *   - routes/api/cultivation/seed-sources.js
 *   - routes/api/cultivation/water-sources.js
 *   - routes/api/cultivation/fertilizer-records.js
 *   - routes/api/cultivation/controlled-environments.js
 *
 * Service-boundary invariants:
 *   - Ownership predicates live here: a record can only be read or
 *     mutated when its parent cycle/plot belongs to a non-deleted farm
 *     that the caller owns. A route bug cannot widen the filter.
 *   - The four entity helpers (`assertCycleOwnedByUser`,
 *     `assertPlotOwnedByUser`) are exported so the route's pre-create
 *     check can short-circuit with a 404 before any expensive read.
 *   - All four record models are hard-delete (no `isDeleted` column);
 *     the route may keep using `delete` after ownership is verified.
 */

const { prisma } = require('./prisma-database');
// Wave A chunk 3 (2026-07-02): every ownership probe below now widens the
// legacy `farm: { ownerId }` pin to owner-OR-ACTIVE-entity-co-member via the
// single farm-access predicate. Solo farmers (no memberships) get the
// byte-identical legacy where-fragment back.
const { farmAccessWhere } = require('./farm-access');

// The four PUT routes forwarded raw req.body to prisma.update. That let a
// HEALTH user relocate their OWN record onto ANOTHER user's plot/cycle by
// sending `plotId`/`cycleId` (mass-assignment IDOR write — ownership is verified
// only on the EXISTING record, never the target FK), and bad/unknown fields
// threw PrismaClientValidationError (500). Strip identity / parent-FK / audit /
// relation keys from any update payload so the parent linkage is immutable via
// PUT; legitimate scalar edits pass through.
const IMMUTABLE_UPDATE_KEYS = Object.freeze([
    'id', 'plotId', 'cycleId', 'plantingCycleId', 'organizationId', 'healthId',
    'farmId', 'createdAt', 'updatedAt', 'deletedAt', 'isDeleted',
    // relation objects (a nested write could re-point the parent too)
    'plot', 'plantingCycle', 'cycle', 'organization', 'farm',
]);
function sanitizeCultivationUpdate(data) {
    if (!data || typeof data !== 'object') { return {}; }
    const clean = { ...data };
    for (const k of IMMUTABLE_UPDATE_KEYS) { delete clean[k]; }
    return clean;
}

class CultivationRecordService {
    // ─────────────────────────────────────────────────────────────────────
    // Ownership probes
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Replaces the inline `prisma.plantingCycle.findFirst({ where: { id,
     * farm: { ownerId } } })` checks in seed-sources.js, fertilizer-
     * records.js. Returns the cycle row (or null) so the caller can
     * 404 on miss.
     */
    async findCycleOwnedByUser(cycleId, userId) {
        return prisma.plantingCycle.findFirst({
            where: {
                id: cycleId,
                farm: await farmAccessWhere(userId),
            },
        });
    }

    /**
     * Replaces the inline `prisma.plot.findFirst({ where: { id, farm: {
     * ownerId } } })` checks in water-sources.js + controlled-
     * environments.js.
     */
    async findPlotOwnedByUser(plotId, userId) {
        return prisma.plot.findFirst({
            where: {
                id: plotId,
                farm: await farmAccessWhere(userId),
            },
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // SeedSource (cycle-scoped)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Replaces routes/api/cultivation/seed-sources.js:32 prisma.seedSource.findMany
     */
    async listSeedSourcesByCycle(cycleId) {
        return prisma.seedSource.findMany({
            where: { cycleId },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Replaces routes/api/cultivation/seed-sources.js:84 prisma.seedSource.create
     */
    async createSeedSource(data) {
        return prisma.seedSource.create({ data });
    }

    /**
     * Replaces routes/api/cultivation/seed-sources.js:120 prisma.seedSource.findFirst
     * Owner-scoped lookup used before update + delete.
     * S9: includes the parent cycle's farmId so the route's RECORDS_MANAGE
     * gate can assert against the right farm.
     */
    async findSeedSourceOwnedByUser(id, userId) {
        return prisma.seedSource.findFirst({
            where: {
                id,
                cycle: { farm: await farmAccessWhere(userId) },
            },
            include: { cycle: { select: { farmId: true } } },
        });
    }

    /**
     * Replaces routes/api/cultivation/seed-sources.js:139 prisma.seedSource.update
     */
    async updateSeedSource(id, data) {
        return prisma.seedSource.update({
            where: { id },
            data: sanitizeCultivationUpdate(data),
        });
    }

    /**
     * Replaces routes/api/cultivation/seed-sources.js:169 prisma.seedSource.delete
     */
    async deleteSeedSource(id) {
        return prisma.seedSource.delete({ where: { id } });
    }

    // ─────────────────────────────────────────────────────────────────────
    // WaterSource (plot-scoped)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Replaces routes/api/cultivation/water-sources.js:29 prisma.waterSource.findMany
     */
    async listWaterSourcesByPlot(plotId) {
        return prisma.waterSource.findMany({
            where: { plotId },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Replaces routes/api/cultivation/water-sources.js:71 prisma.waterSource.create
     */
    async createWaterSource(data) {
        return prisma.waterSource.create({ data });
    }

    /**
     * Replaces routes/api/cultivation/water-sources.js:100 prisma.waterSource.findFirst
     */
    async findWaterSourceOwnedByUser(id, userId) {
        return prisma.waterSource.findFirst({
            where: {
                id,
                plot: { farm: await farmAccessWhere(userId) },
            },
            // S9 — parent farmId for the route's RECORDS_MANAGE gate.
            include: { plot: { select: { farmId: true } } },
        });
    }

    /**
     * Replaces routes/api/cultivation/water-sources.js:116 prisma.waterSource.update
     */
    async updateWaterSource(id, data) {
        return prisma.waterSource.update({
            where: { id },
            data: sanitizeCultivationUpdate(data),
        });
    }

    /**
     * Replaces routes/api/cultivation/water-sources.js:146 prisma.waterSource.delete
     */
    async deleteWaterSource(id) {
        return prisma.waterSource.delete({ where: { id } });
    }

    // ─────────────────────────────────────────────────────────────────────
    // FertilizerRecord (cycle-scoped)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Replaces routes/api/cultivation/fertilizer-records.js:32 prisma.fertilizerRecord.findMany
     */
    async listFertilizerRecordsByCycle(cycleId) {
        return prisma.fertilizerRecord.findMany({
            where: { cycleId },
            orderBy: { usageDate: 'desc' },
        });
    }

    /**
     * Replaces routes/api/cultivation/fertilizer-records.js:89 prisma.fertilizerRecord.create
     */
    async createFertilizerRecord(data) {
        return prisma.fertilizerRecord.create({ data });
    }

    /**
     * Replaces routes/api/cultivation/fertilizer-records.js:128 prisma.fertilizerRecord.findFirst
     */
    async findFertilizerRecordOwnedByUser(id, userId) {
        return prisma.fertilizerRecord.findFirst({
            where: {
                id,
                cycle: { farm: await farmAccessWhere(userId) },
            },
            // S9 — parent farmId for the route's RECORDS_MANAGE gate.
            include: { cycle: { select: { farmId: true } } },
        });
    }

    /**
     * Replaces routes/api/cultivation/fertilizer-records.js:144 prisma.fertilizerRecord.update
     */
    async updateFertilizerRecord(id, data) {
        return prisma.fertilizerRecord.update({
            where: { id },
            data: sanitizeCultivationUpdate(data),
        });
    }

    /**
     * Replaces routes/api/cultivation/fertilizer-records.js:174 prisma.fertilizerRecord.delete
     */
    async deleteFertilizerRecord(id) {
        return prisma.fertilizerRecord.delete({ where: { id } });
    }

    // ─────────────────────────────────────────────────────────────────────
    // ControlledEnvironment (plot-scoped)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Replaces routes/api/cultivation/controlled-environments.js:29 prisma.controlledEnvironment.findMany
     */
    async listControlledEnvironmentsByPlot(plotId) {
        return prisma.controlledEnvironment.findMany({
            where: { plotId },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Replaces routes/api/cultivation/controlled-environments.js:87 prisma.controlledEnvironment.create
     */
    async createControlledEnvironment(data) {
        return prisma.controlledEnvironment.create({ data });
    }

    /**
     * Replaces routes/api/cultivation/controlled-environments.js:132 prisma.controlledEnvironment.findFirst
     */
    async findControlledEnvironmentOwnedByUser(id, userId) {
        return prisma.controlledEnvironment.findFirst({
            where: {
                id,
                plot: { farm: await farmAccessWhere(userId) },
            },
            // S9 — parent farmId for the route's RECORDS_MANAGE gate.
            include: { plot: { select: { farmId: true } } },
        });
    }

    /**
     * Replaces routes/api/cultivation/controlled-environments.js:143 prisma.controlledEnvironment.update
     */
    async updateControlledEnvironment(id, data) {
        return prisma.controlledEnvironment.update({
            where: { id },
            data: sanitizeCultivationUpdate(data),
        });
    }

    /**
     * Replaces routes/api/cultivation/controlled-environments.js:173 prisma.controlledEnvironment.delete
     */
    async deleteControlledEnvironment(id) {
        return prisma.controlledEnvironment.delete({ where: { id } });
    }
}

module.exports = new CultivationRecordService();
