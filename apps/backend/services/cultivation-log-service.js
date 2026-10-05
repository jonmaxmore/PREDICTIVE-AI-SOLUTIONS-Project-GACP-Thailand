const { prisma } = require('./prisma-database');

/**
 * Cultivation Log Service
 * บันทึกกิจกรรมการปลูกตามมาตรฐาน GACP หมวด 3
 */
class CultivationLogService {

    /**
     * Create a new cultivation log entry
     * @param {string} cycleId - Planting Cycle ID
     * @param {object} data - Log data
     * @param {string} userId - User ID who recorded
     */
    async createLog(cycleId, data, userId) {
        const {
            logType,
            logDate,
            productName,
            performedBy,
            quantity,
            unit,
            method,
            area,
            temperature,
            humidity,
            weather,
            notes,
            photoUrl,
        } = data;

        // Validate cycle exists
        const cycle = await prisma.plantingCycle.findUnique({
            where: { id: cycleId },
        });

        if (!cycle) {
            throw new Error('Planting cycle not found');
        }

        // Create log entry
        const log = await prisma.cultivationLog.create({
            data: {
                cycleId,
                logType: logType || 'OBSERVATION',
                logDate: logDate ? new Date(logDate) : new Date(),
                productName,
                // ผู้ปฏิบัติงานจริง — ประตูนี้เคยทิ้งค่าเงียบ ๆ เพราะไม่ได้ประกาศไว้
                performedBy: performedBy ? String(performedBy).trim().slice(0, 120) || null : null,
                quantity: quantity ? parseFloat(quantity) : null,
                unit,
                method,
                area: area ? parseFloat(area) : null,
                temperature: temperature ? parseFloat(temperature) : null,
                humidity: humidity ? parseFloat(humidity) : null,
                weather,
                notes,
                photoUrl,
                recordedBy: userId,
            },
        });

        return log;
    }

    /**
     * Get all logs for a planting cycle
     * @param {string} cycleId - Planting Cycle ID
     * @param {object} options - Query options (logType, startDate, endDate)
     */
    async getLogsByCycle(cycleId, options = {}) {
        const { logType, startDate, endDate, limit = 100 } = options;

        const where = { cycleId };

        if (logType) {
            where.logType = logType;
        }

        if (startDate || endDate) {
            where.logDate = {};
            if (startDate) {where.logDate.gte = new Date(startDate);}
            if (endDate) {where.logDate.lte = new Date(endDate);}
        }

        const logs = await prisma.cultivationLog.findMany({
            where,
            orderBy: { logDate: 'desc' },
            take: limit,
            include: {
                cycle: {
                    select: {
                        cycleName: true,
                        status: true,
                        farm: {
                            select: { farmName: true },
                        },
                    },
                },
            },
        });

        return logs;
    }

    /**
     * Get log by ID
     * @param {string} logId - Log ID
     */
    async getLogById(logId) {
        return prisma.cultivationLog.findUnique({
            where: { id: logId },
            include: {
                cycle: {
                    select: {
                        cycleName: true,
                        status: true,
                        farm: {
                            // Wave A chunk 3 — the controller access check
                            // needs the entity dimension (resolveFarmAccess)
                            select: { farmName: true, ownerId: true, entityId: true },
                        },
                    },
                },
            },
        });
    }

    /**
     * Update a log entry
     * @param {string} logId - Log ID
     * @param {object} data - Updated data
     */
    async updateLog(logId, data) {
        const updateData = {};

        const allowedFields = [
            'logType', 'logDate', 'productName', 'quantity', 'unit',
            'method', 'area', 'temperature', 'humidity', 'weather',
            // ชื่อคนพิมพ์ผิดได้ และต้องแก้ได้ — ไม่มีในรายการนี้แปลว่าแก้ไม่ได้ตลอดกาล
            'performedBy',
            'notes', 'photoUrl',
        ];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                if (field === 'logDate') {
                    updateData[field] = new Date(data[field]);
                } else if (['quantity', 'area', 'temperature', 'humidity'].includes(field)) {
                    updateData[field] = data[field] ? parseFloat(data[field]) : null;
                } else {
                    updateData[field] = data[field];
                }
            }
        }

        return prisma.cultivationLog.update({
            where: { id: logId },
            data: updateData,
        });
    }

    /**
     * Delete a log entry
     * @param {string} logId - Log ID
     */
    async deleteLog(logId) {
        return prisma.cultivationLog.delete({
            where: { id: logId },
        });
    }

    /**
     * Get summary statistics for a cycle
     * @param {string} cycleId - Planting Cycle ID
     */
    async getCycleSummary(cycleId) {
        const logs = await prisma.cultivationLog.findMany({
            where: { cycleId },
        });

        const summary = {
            totalLogs: logs.length,
            byType: {},
            totalWater: 0,
            totalFertilizer: 0,
            lastActivity: null,
        };

        for (const log of logs) {
            // Count by type
            summary.byType[log.logType] = (summary.byType[log.logType] || 0) + 1;

            // Sum quantities
            if (log.logType === 'IRRIGATION' && log.quantity) {
                summary.totalWater += log.quantity;
            }
            if (log.logType === 'FERTILIZER' && log.quantity) {
                summary.totalFertilizer += log.quantity;
            }

            // Track last activity
            if (!summary.lastActivity || log.logDate > summary.lastActivity) {
                summary.lastActivity = log.logDate;
            }
        }

        return summary;
    }

    /**
     * Get all logs for a farm (across all cycles)
     * @param {string} farmId - Farm ID
     * @param {object} options - Query options
     */
    async getLogsByFarm(farmId, options = {}) {
        const { limit = 50 } = options;

        const cycles = await prisma.plantingCycle.findMany({
            where: { farmId },
            select: { id: true },
        });

        const cycleIds = cycles.map(c => c.id);

        return prisma.cultivationLog.findMany({
            where: { cycleId: { in: cycleIds } },
            orderBy: { logDate: 'desc' },
            take: limit,
            include: {
                cycle: {
                    select: { cycleName: true },
                },
            },
        });
    }
}

module.exports = new CultivationLogService();
