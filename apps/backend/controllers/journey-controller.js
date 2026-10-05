/**
 * Journey Controller - API endpoints for dynamic GACP journey configuration
 * 
 * This controller provides endpoints for the dynamic application wizard:
 * - Purposes (domestic, export, research)
 * - Cultivation methods (outdoor, greenhouse, indoor)
 * - Farm layouts per method
 * - Plant count calculations
 * - Document requirements by journey
 * 
 * @author กรมการแพทย์แผนไทยและการแพทย์ทางเลือก (DTAM)
 */

const journeyConfig = require('../data/journey-config');
const logger = require('../shared/logger');

class JourneyController {

    /**
     * GET /api/v2/journey/purposes
     * Get all certification purposes
     */
    async getPurposes(req, res) {
        try {
            res.json({
                success: true,
                data: journeyConfig.PURPOSES,
                count: journeyConfig.PURPOSES.length,
            });
        } catch (error) {
            logger.error('Error fetching purposes:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch purposes',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/v2/journey/methods
     * Get all cultivation methods
     */
    async getCultivationMethods(req, res) {
        try {
            res.json({
                success: true,
                data: journeyConfig.CULTIVATION_METHODS,
                count: journeyConfig.CULTIVATION_METHODS.length,
            });
        } catch (error) {
            logger.error('Error fetching cultivation methods:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch cultivation methods',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/v2/journey/layouts
     * Get farm layouts, optionally filtered by cultivation method
     * @query method - Filter by cultivation method (outdoor, greenhouse, indoor)
     */
    async getFarmLayouts(req, res) {
        try {
            // Accept both 'method' and 'cultivationMethod' for backwards compatibility
            const method = req.query.cultivationMethod || req.query.method;

            let layouts = journeyConfig.FARM_LAYOUTS;

            if (method) {
                layouts = journeyConfig.getLayoutsForMethod(method);
            }

            res.json({
                success: true,
                data: layouts,
                count: layouts.length,
                filter: method || 'all',
            });
        } catch (error) {
            logger.error('Error fetching farm layouts:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch farm layouts',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/v2/journey/styles
     * Get growing styles (for indoor cultivation)
     */
    async getGrowingStyles(req, res) {
        try {
            res.json({
                success: true,
                data: journeyConfig.GROWING_STYLES,
                count: journeyConfig.GROWING_STYLES.length,
            });
        } catch (error) {
            logger.error('Error fetching growing styles:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch growing styles',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/v2/journey/config/:purpose/:method
     * Get specific journey configuration
     */
    async getJourneyConfig(req, res) {
        try {
            const { purpose, method } = req.params;

            const config = journeyConfig.getJourneyConfig(purpose, method);

            if (!config) {
                return res.status(404).json({
                    success: false,
                    message: `Journey config not found for purpose=${purpose}, method=${method}`,
                });
            }

            // Enrich with full document and security details
            const documents = journeyConfig.getDocumentDetails(config.requiredDocuments);
            const security = journeyConfig.getSecurityDetails(config.securityRequirements);
            const layouts = config.availableLayouts
                .map(id => journeyConfig.FARM_LAYOUTS.find(l => l.id === id))
                .filter(Boolean);
            const styles = config.availableGrowingStyles
                ? config.availableGrowingStyles
                    .map(id => journeyConfig.GROWING_STYLES.find(s => s.id === id))
                    .filter(Boolean)
                : null;

            res.json({
                success: true,
                data: {
                    ...config,
                    documents,
                    security,
                    layouts,
                    styles,
                },
            });
        } catch (error) {
            logger.error('Error fetching journey config:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch journey config',
                error: error.message,
            });
        }
    }

    /**
     * POST /api/v2/journey/calculate-plants
     * Calculate plant count based on area and configuration
     * @body area - Area value
     * @body unit - Area unit (Rai, Ngan, Sqm)
     * @body layoutId - Farm layout ID
     * @body styleId - Growing style ID (optional, for indoor)
     * @body tiers - Number of tiers (optional, for vertical)
     */
    async calculatePlants(req, res) {
        try {
            const { area, unit = 'Sqm', layoutId, styleId, tiers = 1 } = req.body;

            if (!area || !layoutId) {
                return res.status(400).json({
                    success: false,
                    message: 'area and layoutId are required',
                });
            }

            const areaSqm = journeyConfig.convertToSqm(parseFloat(area), unit);
            const result = journeyConfig.calculatePlantCount(areaSqm, layoutId, styleId, tiers);

            res.json({
                success: true,
                data: {
                    input: { area: parseFloat(area), unit, layoutId, styleId, tiers },
                    areaSqm,
                    ...result,
                },
            });
        } catch (error) {
            logger.error('Error calculating plants:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to calculate plants',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/v2/journey/documents
     * Get all document definitions
     */
    async getDocumentDefinitions(req, res) {
        try {
            const docs = Object.entries(journeyConfig.DOCUMENT_DEFINITIONS).map(([id, def]) => ({
                id,
                ...def,
            }));

            // Group by category
            const grouped = docs.reduce((acc, doc) => {
                if (!acc[doc.category]) {
                    acc[doc.category] = [];
                }
                acc[doc.category].push(doc);
                return acc;
            }, {});

            res.json({
                success: true,
                data: docs,
                grouped,
                count: docs.length,
            });
        } catch (error) {
            logger.error('Error fetching documents:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch documents',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/v2/journey/security
     * Get all security requirement definitions
     */
    async getSecurityDefinitions(req, res) {
        try {
            const security = Object.entries(journeyConfig.SECURITY_DEFINITIONS).map(([id, def]) => ({
                id,
                ...def,
            }));

            // Group by category
            const grouped = security.reduce((acc, sec) => {
                if (!acc[sec.category]) {
                    acc[sec.category] = [];
                }
                acc[sec.category].push(sec);
                return acc;
            }, {});

            res.json({
                success: true,
                data: security,
                grouped,
                count: security.length,
            });
        } catch (error) {
            logger.error('Error fetching security:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch security',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/journey/full-config
     * Get complete configuration for frontend initialization
     */
    async getFullConfig(req, res) {
        try {
            res.json({
                success: true,
                data: {
                    purposes: journeyConfig.PURPOSES,
                    methods: journeyConfig.CULTIVATION_METHODS,
                    layouts: journeyConfig.FARM_LAYOUTS,
                    styles: journeyConfig.GROWING_STYLES,
                    journeyConfigs: journeyConfig.JOURNEY_CONFIGS.map(j => ({
                        id: j.id,
                        purpose: j.purpose,
                        method: j.method,
                        level: j.level,
                        requiredFieldCount: j.requiredFields.length,
                        requiredDocumentCount: j.requiredDocuments.length,
                        securityRequirementCount: j.securityRequirements.length,
                    })),
                },
            });
        } catch (error) {
            logger.error('Error fetching full config:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch full config',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/journey/gacp-categories
     * Get GACP 14 categories
     */
    async getGACPCategories(req, res) {
        try {
            res.json({
                success: true,
                data: journeyConfig.GACP_CATEGORIES,
                count: journeyConfig.GACP_CATEGORIES.length,
            });
        } catch (error) {
            logger.error('Error fetching GACP categories:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch GACP categories',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/journey/environment-checklist
     * Get environment checklist for Step 4
     */
    async getEnvironmentChecklist(req, res) {
        try {
            res.json({
                success: true,
                data: journeyConfig.ENVIRONMENT_CHECKLIST,
                count: journeyConfig.ENVIRONMENT_CHECKLIST.length,
            });
        } catch (error) {
            logger.error('Error fetching environment checklist:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch environment checklist',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/journey/water-sources
     * Get water source options
     */
    async getWaterSources(req, res) {
        try {
            res.json({
                success: true,
                data: journeyConfig.WATER_SOURCES,
                count: journeyConfig.WATER_SOURCES.length,
            });
        } catch (error) {
            logger.error('Error fetching water sources:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch water sources',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/journey/step-requirements/:stepNumber
     * Get GACP requirements for a specific step
     */
    async getStepRequirements(req, res) {
        try {
            const stepNumber = parseInt(req.params.stepNumber);
            const requirements = journeyConfig.GACP_STEP_REQUIREMENTS[stepNumber];

            if (!requirements) {
                return res.status(404).json({
                    success: false,
                    message: `No requirements found for step ${stepNumber}`,
                });
            }

            // Enrich with GACP category details
            const categories = requirements.gacpCategories.map(catId =>
                journeyConfig.GACP_CATEGORIES.find(c => c.id === catId),
            ).filter(Boolean);

            // Enrich with document details
            const requiredDocs = journeyConfig.getDocumentDetails(requirements.docRequired);
            const optionalDocs = journeyConfig.getDocumentDetails(requirements.docOptional);

            res.json({
                success: true,
                data: {
                    step: stepNumber,
                    gacpCategories: categories,
                    fields: requirements.fields,
                    requiredDocuments: requiredDocs,
                    optionalDocuments: optionalDocs,
                },
            });
        } catch (error) {
            logger.error('Error fetching step requirements:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch step requirements',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/master-data/soil-types
     * Get soil types for Step 5
     */
    async getSoilTypes(req, res) {
        try {
            res.json({
                success: true,
                data: journeyConfig.SOIL_TYPES,
                count: journeyConfig.SOIL_TYPES.length,
            });
        } catch (error) {
            logger.error('Error fetching soil types:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch soil types',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/master-data/seed-sources
     * Get seed sources for Step 5
     */
    async getSeedSources(req, res) {
        try {
            res.json({
                success: true,
                data: journeyConfig.SEED_SOURCES,
                count: journeyConfig.SEED_SOURCES.length,
            });
        } catch (error) {
            logger.error('Error fetching seed sources:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch seed sources',
                error: error.message,
            });
        }
    }

    /**
     * GET /api/master-data/ipm-methods
     * Get IPM methods for Step 5
     */
    async getIPMMethods(req, res) {
        try {
            res.json({
                success: true,
                data: journeyConfig.IPM_METHODS,
                count: journeyConfig.IPM_METHODS.length,
            });
        } catch (error) {
            logger.error('Error fetching IPM methods:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch IPM methods',
                error: error.message,
            });
        }
    }
}

module.exports = new JourneyController();
