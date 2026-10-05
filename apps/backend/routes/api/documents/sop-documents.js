/**
 * SOP Document Routes
 * User-created SOP documents via the SOP Builder
 *
 * GET    /api/sop-documents          - List user's SOP documents
 * GET    /api/sop-documents/:id      - Get single SOP document
 * POST   /api/sop-documents          - Create/save SOP draft
 * PUT    /api/sop-documents/:id      - Update SOP document
 * DELETE /api/sop-documents/:id      - Soft delete SOP document
 *
 * Batch 15 prisma-bypass cleanup (2026-05-16): all direct prisma calls
 * moved to `document-service`. Ownership predicate (`userId`) + soft-
 * delete (`isDeleted: false`) live at the service boundary.
 */

const express = require('express');
const router = express.Router();
const documentService = require('../../../services/document-service');
const authModule = require('../../../middleware/auth-middleware');
const logger = require('../../../shared/logger');

const authenticateHealth = (req, res, next) => {
    if (typeof authModule.authenticateHealth === 'function') {
        return authModule.authenticateHealth(req, res, next);
    }
    return res.status(500).json({ error: 'Auth middleware not loaded' });
};

// ── List user's SOP documents ─────────────────────────────────────────────────
router.get('/', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {return res.status(401).json({ error: 'Unauthorized' });}

        const docs = await documentService.listSopDocumentsForUser(userId);

        res.json({ data: docs });
    } catch (error) {
        logger.error('Error listing SOP documents:', error);
        res.status(500).json({ error: 'Failed to list SOP documents' });
    }
});

// ── Get single SOP document ───────────────────────────────────────────────────
router.get('/:id', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {return res.status(401).json({ error: 'Unauthorized' });}

        const doc = await documentService.findSopDocumentForUser(req.params.id, userId);

        if (!doc) {return res.status(404).json({ error: 'SOP document not found' });}
        res.json({ data: doc });
    } catch (error) {
        logger.error('Error getting SOP document:', error);
        res.status(500).json({ error: 'Failed to get SOP document' });
    }
});

// ── Create SOP document ──────────────────────────────────────────────────────
router.post('/', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {return res.status(401).json({ error: 'Unauthorized' });}

        const { sopType, title, formData } = req.body;

        if (!sopType || !title) {
            return res.status(400).json({ error: 'sopType and title are required' });
        }

        const doc = await documentService.createSopDocument({ userId, sopType, title, formData });

        res.status(201).json({ data: doc });
    } catch (error) {
        logger.error('Error creating SOP document:', error);
        res.status(500).json({ error: 'Failed to create SOP document' });
    }
});

// ── Update SOP document ──────────────────────────────────────────────────────
router.put('/:id', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {return res.status(401).json({ error: 'Unauthorized' });}

        const existing = await documentService.findSopDocumentForUser(req.params.id, userId);

        if (!existing) {return res.status(404).json({ error: 'SOP document not found' });}
        if (existing.status !== 'DRAFT') {
            return res.status(400).json({ error: 'Only draft documents can be edited' });
        }

        const { title, formData, status } = req.body;

        const updateData = {};
        if (title) {updateData.title = title;}
        if (formData) {updateData.formData = formData;}
        if (status === 'SUBMITTED') {
            updateData.status = 'SUBMITTED';
            updateData.submittedAt = new Date();
        }

        const doc = await documentService.updateSopDocument(req.params.id, updateData);

        res.json({ data: doc });
    } catch (error) {
        logger.error('Error updating SOP document:', error);
        res.status(500).json({ error: 'Failed to update SOP document' });
    }
});

// ── Soft delete SOP document ─────────────────────────────────────────────────
router.delete('/:id', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {return res.status(401).json({ error: 'Unauthorized' });}

        const existing = await documentService.findSopDocumentForUser(req.params.id, userId);

        if (!existing) {return res.status(404).json({ error: 'SOP document not found' });}

        await documentService.softDeleteSopDocument(req.params.id);

        res.json({ message: 'SOP document deleted' });
    } catch (error) {
        logger.error('Error deleting SOP document:', error);
        res.status(500).json({ error: 'Failed to delete SOP document' });
    }
});

module.exports = router;
