const { prisma } = require('./prisma-database');

/**
 * Training Record Service
 * บันทึกการอบรมบุคลากรตามมาตรฐาน GACP หมวด 6
 */
class TrainingRecordService {

    /**
     * Create a new training record
     * @param {string} farmId - Farm ID
     * @param {object} data - Training data
     * @param {string} userId - User ID who recorded
     */
    async createRecord(farmId, data, userId) {
        // Validate farm exists
        const farm = await prisma.farm.findUnique({
            where: { id: farmId },
        });

        if (!farm) {
            throw new Error('Farm not found');
        }

        const record = await prisma.trainingRecord.create({
            data: {
                farmId,
                // Trainee
                personName: data.personName,
                personRole: data.personRole,
                personIdCard: data.personIdCard,
                // Training
                trainingTopic: data.trainingTopic,
                trainingType: data.trainingType || 'GACP_BASIC',
                trainingDate: data.trainingDate ? new Date(data.trainingDate) : new Date(),
                trainingHours: data.trainingHours ? parseFloat(data.trainingHours) : null,
                trainingLocation: data.trainingLocation,
                trainedBy: data.trainedBy,
                organizerName: data.organizerName,
                // Certificate
                hasCertificate: data.hasCertificate || false,
                certificateNo: data.certificateNo,
                certificateUrl: data.certificateUrl,
                expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
                // Assessment
                preTestScore: data.preTestScore ? parseFloat(data.preTestScore) : null,
                postTestScore: data.postTestScore ? parseFloat(data.postTestScore) : null,
                passed: data.passed !== false,
                // Meta
                notes: data.notes,
                recordedBy: userId,
            },
        });

        return record;
    }

    /**
     * Get all training records for a farm
     * @param {string} farmId - Farm ID
     * @param {object} options - Query options
     */
    async getRecordsByFarm(farmId, options = {}) {
        const { trainingType, personName, limit = 100 } = options;

        const where = { farmId };

        if (trainingType) {
            where.trainingType = trainingType;
        }

        if (personName) {
            where.personName = { contains: personName };
        }

        return prisma.trainingRecord.findMany({
            where,
            orderBy: { trainingDate: 'desc' },
            take: limit,
            include: {
                farm: {
                    select: { farmName: true },
                },
            },
        });
    }

    /**
     * Get record by ID
     * @param {string} id - Record ID
     */
    async getRecordById(id) {
        return prisma.trainingRecord.findUnique({
            where: { id },
            include: {
                farm: {
                    select: { farmName: true, ownerId: true },
                },
            },
        });
    }

    /**
     * Update a training record
     * @param {string} id - Record ID
     * @param {object} data - Updated data
     */
    async updateRecord(id, data) {
        const updateData = {};

        const fields = [
            'personName', 'personRole', 'personIdCard', 'trainingTopic',
            'trainingType', 'trainingDate', 'trainingHours', 'trainingLocation',
            'trainedBy', 'organizerName', 'hasCertificate', 'certificateNo',
            'certificateUrl', 'expiryDate', 'preTestScore', 'postTestScore',
            'passed', 'notes',
        ];

        const floatFields = ['trainingHours', 'preTestScore', 'postTestScore'];
        const dateFields = ['trainingDate', 'expiryDate'];

        for (const field of fields) {
            if (data[field] !== undefined) {
                if (dateFields.includes(field)) {
                    updateData[field] = data[field] ? new Date(data[field]) : null;
                } else if (floatFields.includes(field)) {
                    updateData[field] = data[field] ? parseFloat(data[field]) : null;
                } else {
                    updateData[field] = data[field];
                }
            }
        }

        return prisma.trainingRecord.update({
            where: { id },
            data: updateData,
        });
    }

    /**
     * Delete a training record
     * @param {string} id - Record ID
     */
    async deleteRecord(id) {
        return prisma.trainingRecord.delete({
            where: { id },
        });
    }

    /**
     * Get training summary for a farm
     * @param {string} farmId - Farm ID
     */
    async getFarmTrainingSummary(farmId) {
        const records = await prisma.trainingRecord.findMany({
            where: { farmId },
        });

        const summary = {
            totalRecords: records.length,
            totalPersonnel: new Set(records.map(r => r.personName)).size,
            byType: {},
            totalHours: 0,
            expiringSoon: [],
            expired: [],
        };

        const now = new Date();
        const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        for (const record of records) {
            // Count by type
            summary.byType[record.trainingType] = (summary.byType[record.trainingType] || 0) + 1;

            // Sum hours
            if (record.trainingHours) {
                summary.totalHours += record.trainingHours;
            }

            // Check expiring certificates
            if (record.expiryDate) {
                if (record.expiryDate < now) {
                    summary.expired.push({
                        personName: record.personName,
                        topic: record.trainingTopic,
                        expiredDate: record.expiryDate,
                    });
                } else if (record.expiryDate < thirtyDaysLater) {
                    summary.expiringSoon.push({
                        personName: record.personName,
                        topic: record.trainingTopic,
                        expiryDate: record.expiryDate,
                    });
                }
            }
        }

        return summary;
    }

    /**
     * Get personnel list with their training status
     * @param {string} farmId - Farm ID
     */
    async getPersonnelTrainingStatus(farmId) {
        const records = await prisma.trainingRecord.findMany({
            where: { farmId },
            orderBy: { trainingDate: 'desc' },
        });

        // Group by person
        const personnelMap = new Map();

        for (const record of records) {
            if (!personnelMap.has(record.personName)) {
                personnelMap.set(record.personName, {
                    name: record.personName,
                    role: record.personRole,
                    trainings: [],
                    totalHours: 0,
                    hasGACPBasic: false,
                    hasHygiene: false,
                    hasSafety: false,
                });
            }

            const person = personnelMap.get(record.personName);
            person.trainings.push({
                topic: record.trainingTopic,
                type: record.trainingType,
                date: record.trainingDate,
                passed: record.passed,
            });

            if (record.trainingHours) {
                person.totalHours += record.trainingHours;
            }

            if (record.trainingType === 'GACP_BASIC' && record.passed) {
                person.hasGACPBasic = true;
            }
            if (record.trainingType === 'HYGIENE' && record.passed) {
                person.hasHygiene = true;
            }
            if (record.trainingType === 'SAFETY' && record.passed) {
                person.hasSafety = true;
            }
        }

        return Array.from(personnelMap.values());
    }

    /**
     * Check if farm meets GACP training requirements
     * @param {string} farmId - Farm ID
     */
    async checkTrainingCompliance(farmId) {
        const personnel = await this.getPersonnelTrainingStatus(farmId);

        const requirements = {
            hasTrainedPersonnel: personnel.length > 0,
            allHaveGACPBasic: personnel.every(p => p.hasGACPBasic),
            allHaveHygiene: personnel.every(p => p.hasHygiene),
            totalPersonnel: personnel.length,
            compliantCount: personnel.filter(p => p.hasGACPBasic && p.hasHygiene).length,
        };

        requirements.complianceRate = requirements.totalPersonnel > 0
            ? Math.round((requirements.compliantCount / requirements.totalPersonnel) * 100)
            : 0;

        requirements.isCompliant = requirements.complianceRate >= 80;

        return requirements;
    }
}

module.exports = new TrainingRecordService();
