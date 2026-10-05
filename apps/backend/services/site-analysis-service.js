const { prisma } = require('./prisma-database');

/**
 * Site Analysis Service
 * การวิเคราะห์สถานที่ตามมาตรฐาน GACP หมวด 1
 */
class SiteAnalysisService {

    /**
     * Create a new site analysis
     * @param {string} farmId - Farm ID
     * @param {object} data - Analysis data
     */
    async createAnalysis(farmId, data) {
        // Validate farm exists
        const farm = await prisma.farm.findUnique({
            where: { id: farmId },
        });

        if (!farm) {
            throw new Error('Farm not found');
        }

        const analysis = await prisma.siteAnalysis.create({
            data: {
                farmId,
                analysisType: data.analysisType || 'INITIAL',
                analysisDate: data.analysisDate ? new Date(data.analysisDate) : new Date(),
                // Land History
                previousLandUse: data.previousLandUse,
                yearsOfHistory: data.yearsOfHistory ? parseInt(data.yearsOfHistory) : null,
                hasChemicalHistory: data.hasChemicalHistory || false,
                chemicalDetails: data.chemicalDetails,
                // Soil
                soilPH: data.soilPH ? parseFloat(data.soilPH) : null,
                soilOrganic: data.soilOrganic ? parseFloat(data.soilOrganic) : null,
                soilNitrogen: data.soilNitrogen ? parseFloat(data.soilNitrogen) : null,
                soilPhosphorus: data.soilPhosphorus ? parseFloat(data.soilPhosphorus) : null,
                soilPotassium: data.soilPotassium ? parseFloat(data.soilPotassium) : null,
                soilHeavyMetals: data.soilHeavyMetals || null,
                soilReportUrl: data.soilReportUrl,
                // Water
                waterPH: data.waterPH ? parseFloat(data.waterPH) : null,
                waterEC: data.waterEC ? parseFloat(data.waterEC) : null,
                waterColiform: data.waterColiform ? parseFloat(data.waterColiform) : null,
                waterHeavyMetals: data.waterHeavyMetals || null,
                waterReportUrl: data.waterReportUrl,
                // Environment
                bufferZoneMeters: data.bufferZoneMeters ? parseInt(data.bufferZoneMeters) : null,
                nearbyPollution: data.nearbyPollution,
                floodRisk: data.floodRisk,
                // Risk
                riskLevel: data.riskLevel,
                riskDetails: data.riskDetails,
                mitigationPlan: data.mitigationPlan,
                notes: data.notes,
            },
        });

        return analysis;
    }

    /**
     * Get all analyses for a farm
     * @param {string} farmId - Farm ID
     */
    async getAnalysesByFarm(farmId) {
        return prisma.siteAnalysis.findMany({
            where: { farmId },
            orderBy: { analysisDate: 'desc' },
            include: {
                farm: {
                    select: { farmName: true },
                },
            },
        });
    }

    /**
     * Provider-facing list of recent site analyses. Used by the
     * /api/site-analyses provider listing route. Projection includes
     * the farm name only — the route layer cannot widen the surface
     * area without extending the `include` here (Batch 11 Prisma-bypass
     * cleanup).
     */
    async listRecentAnalyses({ take = 100 } = {}) {
        return prisma.siteAnalysis.findMany({
            orderBy: { analysisDate: 'desc' },
            take,
            include: {
                farm: { select: { farmName: true } },
            },
        });
    }

    /**
     * Get analysis by ID
     * @param {string} id - Analysis ID
     */
    async getAnalysisById(id) {
        return prisma.siteAnalysis.findUnique({
            where: { id },
            include: {
                farm: {
                    select: { farmName: true, ownerId: true },
                },
            },
        });
    }

    /**
     * Get latest analysis for a farm
     * @param {string} farmId - Farm ID
     */
    async getLatestAnalysis(farmId) {
        return prisma.siteAnalysis.findFirst({
            where: { farmId },
            orderBy: { analysisDate: 'desc' },
        });
    }

    /**
     * Update an analysis
     * @param {string} id - Analysis ID
     * @param {object} data - Updated data
     */
    async updateAnalysis(id, data) {
        const updateData = {};
        
        const fields = [
            'analysisType', 'analysisDate', 'previousLandUse', 'yearsOfHistory',
            'hasChemicalHistory', 'chemicalDetails', 'soilPH', 'soilOrganic',
            'soilNitrogen', 'soilPhosphorus', 'soilPotassium', 'soilHeavyMetals',
            'soilReportUrl', 'waterPH', 'waterEC', 'waterColiform', 'waterHeavyMetals',
            'waterReportUrl', 'bufferZoneMeters', 'nearbyPollution', 'floodRisk',
            'riskLevel', 'riskDetails', 'mitigationPlan', 'notes',
        ];

        const floatFields = ['soilPH', 'soilOrganic', 'soilNitrogen', 'soilPhosphorus', 
                           'soilPotassium', 'waterPH', 'waterEC', 'waterColiform'];
        const intFields = ['yearsOfHistory', 'bufferZoneMeters'];

        for (const field of fields) {
            if (data[field] !== undefined) {
                if (field === 'analysisDate') {
                    updateData[field] = new Date(data[field]);
                } else if (floatFields.includes(field)) {
                    updateData[field] = data[field] ? parseFloat(data[field]) : null;
                } else if (intFields.includes(field)) {
                    updateData[field] = data[field] ? parseInt(data[field]) : null;
                } else {
                    updateData[field] = data[field];
                }
            }
        }

        return prisma.siteAnalysis.update({
            where: { id },
            data: updateData,
        });
    }

    /**
     * Delete an analysis
     * @param {string} id - Analysis ID
     */
    async deleteAnalysis(id) {
        return prisma.siteAnalysis.delete({
            where: { id },
        });
    }

    /**
     * Verify/Approve an analysis (provider action)
     * @param {string} id - Analysis ID
     * @param {string} verifierId - Provider User ID
     * @param {boolean} passed - Whether criteria passed
     */
    async verifyAnalysis(id, verifierId, passed) {
        return prisma.siteAnalysis.update({
            where: { id },
            data: {
                passedCriteria: passed,
                verifiedBy: verifierId,
                verifiedAt: new Date(),
            },
        });
    }

    /**
     * Evaluate soil quality based on GACP standards
     * @param {object} analysis - Analysis data
     */
    evaluateSoilQuality(analysis) {
        const results = {
            ph: { value: analysis.soilPH, status: 'unknown', message: '' },
            heavyMetals: { status: 'unknown', message: '' },
        };

        // pH check (optimal: 5.5 - 7.5)
        if (analysis.soilPH) {
            if (analysis.soilPH >= 5.5 && analysis.soilPH <= 7.5) {
                results.ph.status = 'pass';
                results.ph.message = 'ค่า pH อยู่ในเกณฑ์ที่เหมาะสม';
            } else {
                results.ph.status = 'fail';
                results.ph.message = 'ค่า pH ไม่อยู่ในช่วง 5.5-7.5';
            }
        }

        // Heavy metals check
        if (analysis.soilHeavyMetals) {
            const limits = { lead: 100, mercury: 1, cadmium: 3 }; // mg/kg
            let allPassed = true;
            
            for (const [metal, limit] of Object.entries(limits)) {
                if (analysis.soilHeavyMetals[metal] && analysis.soilHeavyMetals[metal] > limit) {
                    allPassed = false;
                    break;
                }
            }
            
            results.heavyMetals.status = allPassed ? 'pass' : 'fail';
            results.heavyMetals.message = allPassed 
                ? 'โลหะหนักอยู่ในเกณฑ์มาตรฐาน' 
                : 'พบโลหะหนักเกินมาตรฐาน';
        }

        return results;
    }

    /**
     * Calculate overall site compliance score
     * @param {object} analysis - Analysis data
     */
    calculateComplianceScore(analysis) {
        let score = 0;
        const maxScore = 100;
        
        // Land history (20 points)
        if (analysis.previousLandUse) {score += 10;}
        if (analysis.yearsOfHistory >= 3) {score += 10;}
        
        // Soil analysis (30 points)
        if (analysis.soilPH >= 5.5 && analysis.soilPH <= 7.5) {score += 15;}
        if (analysis.soilReportUrl) {score += 15;}
        
        // Water analysis (30 points)
        if (analysis.waterPH) {score += 15;}
        if (analysis.waterReportUrl) {score += 15;}
        
        // Environment (20 points)
        if (analysis.bufferZoneMeters && analysis.bufferZoneMeters >= 500) {score += 10;}
        if (analysis.riskLevel === 'LOW') {score += 10;}
        else if (analysis.riskLevel === 'MEDIUM') {score += 5;}
        
        return {
            score,
            maxScore,
            percentage: Math.round((score / maxScore) * 100),
            status: score >= 70 ? 'PASS' : 'FAIL',
        };
    }
}

module.exports = new SiteAnalysisService();
