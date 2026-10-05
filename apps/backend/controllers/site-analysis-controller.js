const siteAnalysisService = require('../services/site-analysis-service');
const { respondError } = require('../shared/api-response');
const { createLogger } = require('../shared/logger');

const logger = createLogger('site-analysis-controller');

/**
 * Site Analysis Controller
 * API endpoints for GACP site analysis (หมวด 1)
 */

/**
 * Resolve an analysis by ID and verify the authenticated health user owns
 * the analysis's farm. Returns the analysis on success, or sends a 404/403
 * response and returns null on failure (callers MUST early-return).
 *
 * Closes the IDOR vector on /:id, /:id/evaluate-soil, /:id/compliance-score,
 * PUT /:id, and DELETE /:id — those routes used `siteAnalysisService.
 * getAnalysisById(id)` directly without verifying that the analysis's
 * `farm.ownerId` matches `req.user.id`. Per T-014 / canonical contract
 * §5.2 health users must only see their own farm's data.
 */
async function resolveOwnedAnalysis(req, res) {
    const { id } = req.params;
    const analysis = await siteAnalysisService.getAnalysisById(id);

    if (!analysis) {
        res.status(404).json({ success: false, message: 'Site analysis not found' });
        return null;
    }

    const ownerId = analysis.farm?.ownerId;
    const userId = req.user?.id;
    if (!ownerId || !userId || ownerId !== userId) {
        // Return 404 (not 403) to avoid leaking the existence of analyses
        // that belong to other tenants.
        res.status(404).json({ success: false, message: 'Site analysis not found' });
        return null;
    }

    return analysis;
}

/**
 * Create a new site analysis
 * POST /api/site-analyses
 */
exports.createAnalysis = async (req, res) => {
    try {
        const { farmId, ...analysisData } = req.body;

        if (!farmId) {
            return res.status(400).json({
                success: false,
                message: 'Farm ID is required',
            });
        }

        const analysis = await siteAnalysisService.createAnalysis(farmId, analysisData);

        logger.info(`Site analysis created: ${analysis.id} for farm ${farmId}`);

        res.status(201).json({
            success: true,
            message: 'Site analysis created successfully',
            data: analysis,
        });
    } catch (error) {
        return respondError(res, req, error, { label: '[SiteAnalysis] create', message: 'Failed to create site analysis' });
    }
};

/**
 * Get all analyses for a farm
 * GET /api/site-analyses/farm/:farmId
 */
exports.getAnalysesByFarm = async (req, res) => {
    try {
        const { farmId } = req.params;
        const analyses = await siteAnalysisService.getAnalysesByFarm(farmId);

        res.json({
            success: true,
            data: analyses,
            count: analyses.length,
        });
    } catch (error) {
        logger.error('Get farm analyses error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch site analyses' });
    }
};

/**
 * Get single analysis by ID
 * GET /api/site-analyses/:id
 */
exports.getAnalysisById = async (req, res) => {
    try {
        const analysis = await resolveOwnedAnalysis(req, res);
        if (!analysis) {return;}

        res.json({
            success: true,
            data: analysis,
        });
    } catch (error) {
        logger.error('Get analysis by ID error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch site analysis' });
    }
};

/**
 * Get latest analysis for a farm
 * GET /api/site-analyses/farm/:farmId/latest
 */
exports.getLatestAnalysis = async (req, res) => {
    try {
        const { farmId } = req.params;
        const analysis = await siteAnalysisService.getLatestAnalysis(farmId);

        res.json({
            success: true,
            data: analysis,
        });
    } catch (error) {
        logger.error('Get latest analysis error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch latest analysis' });
    }
};

/**
 * Update a site analysis
 * PUT /api/site-analyses/:id
 */
exports.updateAnalysis = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const existing = await resolveOwnedAnalysis(req, res);
        if (!existing) {return;}

        const updated = await siteAnalysisService.updateAnalysis(id, updateData);

        logger.info(`Site analysis updated: ${id}`);

        res.json({
            success: true,
            message: 'Site analysis updated successfully',
            data: updated,
        });
    } catch (error) {
        logger.error('Update analysis error:', error);
        return respondError(res, req, error, { message: 'Failed to update site analysis' });
    }
};

/**
 * Delete a site analysis
 * DELETE /api/site-analyses/:id
 */
exports.deleteAnalysis = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await resolveOwnedAnalysis(req, res);
        if (!existing) {return;}

        await siteAnalysisService.deleteAnalysis(id);

        logger.info(`Site analysis deleted: ${id}`);

        res.json({
            success: true,
            message: 'Site analysis deleted successfully',
        });
    } catch (error) {
        logger.error('Delete analysis error:', error);
        return respondError(res, req, error, { message: 'Failed to delete site analysis' });
    }
};

/**
 * Evaluate soil quality
 * GET /api/site-analyses/:id/evaluate-soil
 */
exports.evaluateSoil = async (req, res) => {
    try {
        const analysis = await resolveOwnedAnalysis(req, res);
        if (!analysis) {return;}

        const evaluation = siteAnalysisService.evaluateSoilQuality(analysis);

        res.json({
            success: true,
            data: evaluation,
        });
    } catch (error) {
        logger.error('Evaluate soil error:', error);
        return respondError(res, req, error, { message: 'Failed to evaluate soil quality' });
    }
};

/**
 * Calculate compliance score
 * GET /api/site-analyses/:id/compliance-score
 */
exports.getComplianceScore = async (req, res) => {
    try {
        const analysis = await resolveOwnedAnalysis(req, res);
        if (!analysis) {return;}

        const score = siteAnalysisService.calculateComplianceScore(analysis);

        res.json({
            success: true,
            data: score,
        });
    } catch (error) {
        logger.error('Get compliance score error:', error);
        return respondError(res, req, error, { message: 'Failed to calculate compliance score' });
    }
};

/**
 * Verify/Approve analysis (Provider only)
 * POST /api/site-analyses/:id/verify
 */
exports.verifyAnalysis = async (req, res) => {
    try {
        const { id } = req.params;
        const { passed } = req.body;
        const verifierId = req.user?.id;

        const analysis = await siteAnalysisService.verifyAnalysis(id, verifierId, passed);

        logger.info(`Site analysis ${id} verified by ${verifierId}: ${passed ? 'PASSED' : 'FAILED'}`);

        res.json({
            success: true,
            message: `Analysis ${passed ? 'approved' : 'rejected'}`,
            data: analysis,
        });
    } catch (error) {
        logger.error('Verify analysis error:', error);
        return respondError(res, req, error, { message: 'Failed to verify analysis' });
    }
};

/**
 * Get analysis type options
 * GET /api/site-analyses/types
 */
exports.getAnalysisTypes = (req, res) => {
    const types = [
        { value: 'INITIAL', label: 'การประเมินครั้งแรก', labelEN: 'Initial Assessment' },
        { value: 'ANNUAL', label: 'การประเมินประจำปี', labelEN: 'Annual Assessment' },
        { value: 'FOLLOW_UP', label: 'การประเมินติดตาม', labelEN: 'Follow-up Assessment' },
    ];

    res.json({
        success: true,
        data: types,
    });
};
