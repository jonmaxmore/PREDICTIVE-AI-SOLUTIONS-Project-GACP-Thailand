/**
 * Plant Controller - API endpoints for plant data (Prisma Refactor)
 * 
 * GET /api/v2/plants - Get all active plants
 * GET /api/v2/plants/:plantId - Get single plant by ID
 *
 * GET /:plantId/documents was removed 2026-09-28 (document pre-check Task 10):
 * it called document-analysis-service.getBaseRequirements(), deleted on
 * 2026-09-11, so it answered 500 on every call, and nothing in the web or
 * mobile app called it. Which documents a filing needs is answered by the B1
 * register (services/application-requirements-service.js,
 * GET /api/applications/:id/requirements).
 */

const { prisma } = require('../services/prisma-database');
const { respondError } = require('../shared/api-response');
const logger = require('../shared/logger');

class PlantController {
    /**
     * GET /api/v2/plants
     * Get all active plants
     */
    async getAllPlants(req, res) {
        try {
            const { group } = req.query;

            const where = { isActive: true };
            if (group) {
                where.group = group.toUpperCase();
            }

            const plants = await prisma.plantSpecies.findMany({
                where,
                orderBy: { sortOrder: 'asc' },
            });

            // Map to legacy format for frontend compatibility if needed, 
            // but the new schema is very similar. 
            // The frontend likely expects 'plantId' property instead of 'code'.
            const mappedPlants = plants.map(p => ({
                ...p,
                plantId: p.code, // Alias code to plantId
            }));

            res.json({
                success: true,
                data: mappedPlants,
                count: mappedPlants.length,
            });
        } catch (error) {
            logger.error('Error fetching plants:', error);
            return respondError(res, req, error, { message: 'Failed to fetch plants' });
        }
    }

    /**
     * GET /api/v2/plants/:plantId
     * Get single plant by ID
     */
    async getPlantById(req, res) {
        try {
            const { plantId } = req.params;

            const plant = await prisma.plantSpecies.findUnique({
                where: { code: plantId },
            });

            if (!plant) {
                return res.status(404).json({
                    success: false,
                    message: `Plant not found: ${plantId}`,
                });
            }

            res.json({
                success: true,
                data: {
                    ...plant,
                    plantId: plant.code,
                },
            });
        } catch (error) {
            logger.error('Error fetching plant:', error);
            return respondError(res, req, error, { message: 'Failed to fetch plant' });
        }
    }

    /**
     * GET /api/v2/plants/:plantId/production-inputs
     * Get production input fields for a plant
     */
    async getPlantProductionInputs(req, res) {
        try {
            const { plantId } = req.params;

            const plant = await prisma.plantSpecies.findUnique({
                where: { code: plantId },
            });

            if (!plant) {
                return res.status(404).json({
                    success: false,
                    message: `Plant not found: ${plantId}`,
                });
            }

            res.json({
                success: true,
                data: {
                    plantId: plant.code,
                    plantName: plant.nameTH,
                    group: plant.group,
                    units: plant.units,
                    plantParts: plant.plantParts,
                    productionInputs: plant.productionInputs,
                    securityRequirements: plant.securityRequirements,
                },
            });
        } catch (error) {
            logger.error('Error fetching plant production inputs:', error);
            return respondError(res, req, error, { message: 'Failed to fetch plant production inputs' });
        }
    }

    /**
     * GET /api/v2/plants/summary
     * Get summary of all plants (for dropdown selections)
     */
    async getPlantsSummary(req, res) {
        try {
            const plants = await prisma.plantSpecies.findMany({
                where: { isActive: true },
                orderBy: { sortOrder: 'asc' },
            });

            const summary = plants.map(p => ({
                id: p.code, // Frontend uses 'id' for value
                nameTH: p.nameTH,
                nameEN: p.nameEN,
                group: p.group,
                requiresLicense: p.requiresLicense,
                unit: (p.units && p.units.length > 0) ? p.units[0] : 'ไร่',
            }));

            res.json({
                success: true,
                data: summary,
                count: summary.length,
            });
        } catch (error) {
            logger.error('Error fetching plants summary:', error);
            return respondError(res, req, error, { message: 'Failed to fetch plants summary' });
        }
    }
}

module.exports = new PlantController();
