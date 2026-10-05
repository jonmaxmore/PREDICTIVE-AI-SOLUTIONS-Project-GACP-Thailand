const { prisma } = require('../services/prisma-database');
const logger = require('../shared/logger');

/**
 * SOW (Scope of Work) Controller
 * CRUD operations for Scope of Work documents linked to applications.
 * Used by: Scheduler, Auditor
 */
const sowController = {
    /**
     * GET /api/provider/applications/:applicationId/sow
     * List all SOWs for an application
     */
    listByApplication: async (req, res) => {
        try {
            const { applicationId } = req.params;
            const items = await prisma.scopeOfWork.findMany({
                where: { applicationId },
                orderBy: { createdAt: 'desc' },
            });
            return res.json({ success: true, data: items });
        } catch (error) {
            logger.error('[SOW List] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch SOW list' });
        }
    },

    /**
     * GET /api/provider/sow/:id
     * Get a single SOW by ID
     */
    getById: async (req, res) => {
        try {
            const { id } = req.params;
            const item = await prisma.scopeOfWork.findUnique({ where: { id } });
            if (!item) {
                return res.status(404).json({ success: false, error: 'SOW not found' });
            }
            return res.json({ success: true, data: item });
        } catch (error) {
            logger.error('[SOW Get] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch SOW' });
        }
    },

    /**
     * POST /api/provider/applications/:applicationId/sow
     * Create a new SOW for an application
     */
    create: async (req, res) => {
        try {
            const { applicationId } = req.params;
            const userId = req.user?.id || req.user?.providerId;
            const {
                title,
                description,
                standardCode,
                inspectionScope,
                estimatedDays,
                assignedAuditorId,
            } = req.body;

            if (!title) {
                return res.status(400).json({ success: false, error: 'Title is required' });
            }

            // Verify application exists
            const app = await prisma.application.findUnique({
                where: { id: applicationId },
                select: { id: true, applicationNumber: true },
            });
            if (!app) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }

            // Wave A Phase 18 — `assignedAuditor` is no longer a denormalized
            // name string. The display name (when needed) comes from the
            // `assignedAuditor` relation on read.
            const item = await prisma.scopeOfWork.create({
                data: {
                    applicationId,
                    title,
                    description: description || null,
                    standardCode: standardCode || 'GACP',
                    inspectionScope: inspectionScope || [],
                    estimatedDays: estimatedDays || 1,
                    assignedAuditorId: assignedAuditorId || null,
                    status: 'DRAFT',
                    createdBy: userId,
                },
            });

            return res.status(201).json({ success: true, data: item });
        } catch (error) {
            logger.error('[SOW Create] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to create SOW' });
        }
    },

    /**
     * PATCH /api/provider/sow/:id
     * Update a SOW (title, scope, status, assignment)
     */
    update: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user?.id || req.user?.providerId;
            const {
                title,
                description,
                inspectionScope,
                estimatedDays,
                assignedAuditorId,
                status,
            } = req.body;

            const existing = await prisma.scopeOfWork.findUnique({ where: { id } });
            if (!existing) {
                return res.status(404).json({ success: false, error: 'SOW not found' });
            }

            const updateData = { updatedBy: userId };
            if (title !== undefined) { updateData.title = title; }
            if (description !== undefined) { updateData.description = description; }
            if (inspectionScope !== undefined) { updateData.inspectionScope = inspectionScope; }
            if (estimatedDays !== undefined) { updateData.estimatedDays = estimatedDays; }
            if (assignedAuditorId !== undefined) { updateData.assignedAuditorId = assignedAuditorId; }
            if (status !== undefined) {
                updateData.status = status;
                if (status === 'APPROVED') {
                    updateData.approvedBy = userId;
                    updateData.approvedAt = new Date();
                }
            }

            const item = await prisma.scopeOfWork.update({
                where: { id },
                data: updateData,
            });

            return res.json({ success: true, data: item });
        } catch (error) {
            logger.error('[SOW Update] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update SOW' });
        }
    },

    /**
     * DELETE /api/provider/sow/:id
     * Delete a SOW (only if DRAFT)
     */
    remove: async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await prisma.scopeOfWork.findUnique({ where: { id } });
            if (!existing) {
                return res.status(404).json({ success: false, error: 'SOW not found' });
            }
            if (existing.status !== 'DRAFT') {
                return res.status(400).json({
                    success: false,
                    error: 'Only DRAFT SOWs can be deleted',
                });
            }

            await prisma.scopeOfWork.delete({ where: { id } });
            return res.json({ success: true, data: { id } });
        } catch (error) {
            logger.error('[SOW Delete] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to delete SOW' });
        }
    },
};

module.exports = sowController;
