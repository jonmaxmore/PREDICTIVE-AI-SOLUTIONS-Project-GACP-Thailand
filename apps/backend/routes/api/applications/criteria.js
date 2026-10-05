/**
 * Supplementary Criteria API
 * Manages dynamic criteria for application form (step-12)
 * 
 * GET    /api/criteria - List active criteria (public)
 * GET    /api/criteria/all - List all criteria (admin)
 * POST   /api/criteria - Create criterion (admin)
 * PATCH  /api/criteria/:id - Update criterion (admin)
 * DELETE /api/criteria/:id - Delete criterion (admin)
 */

const express = require('express');
const { respondError } = require('../../../shared/api-response');
const router = express.Router();
const { prisma } = require('../../../services/prisma-database');
const authModule = require('../../../middleware/auth-middleware');
const { adminOnly } = require('../../../middleware/role-middleware');

const authenticateProvider = authModule.authenticateProvider;

/**
 * GET /api/criteria
 * Get all active supplementary criteria (public - for form)
 */
router.get('/', async (req, res) => {
    try {
        const criteria = await prisma.supplementaryCriterion.findMany({
            where: { isActive: true },
            orderBy: [
                { category: 'asc' },
                { sortOrder: 'asc' },
            ],
            select: {
                id: true,
                code: true,
                category: true,
                categoryTH: true,
                label: true,
                description: true,
                icon: true,
                isRequired: true,
                inputType: true,
                sortOrder: true,
            },
        });

        // Group by category
        const grouped = criteria.reduce((acc, item) => {
            const cat = item.category;
            if (!acc[cat]) {
                acc[cat] = {
                    category: cat,
                    categoryTH: item.categoryTH || cat,
                    icon: item.icon,
                    items: [],
                };
            }
            acc[cat].items.push({
                id: item.id,
                code: item.code,
                label: item.label,
                description: item.description,
                isRequired: item.isRequired,
                inputType: item.inputType,
            });
            return acc;
        }, {});

        res.json({
            success: true,
            count: criteria.length,
            data: Object.values(grouped),
        });
    } catch (error) {
        return respondError(res, req, error, { label: '[Criteria] list', message: 'Failed to fetch criteria' });
    }
});

/**
 * GET /api/criteria/all
 * Get all criteria including inactive (admin only)
 */
router.get('/all', authenticateProvider, adminOnly, async (req, res) => {
    try {
        const criteria = await prisma.supplementaryCriterion.findMany({
            orderBy: [
                { category: 'asc' },
                { sortOrder: 'asc' },
            ],
        });

        res.json({
            success: true,
            count: criteria.length,
            data: criteria,
        });
    } catch (error) {
        return respondError(res, req, error, { label: '[Criteria] listAll', message: 'Failed to fetch criteria' });
    }
});

/**
 * POST /api/criteria
 * Create new criterion (admin only)
 */
router.post('/', authenticateProvider, adminOnly, async (req, res) => {
    try {
        const {
            code,
            category,
            categoryTH,
            label,
            description,
            icon,
            sortOrder,
            isRequired,
            inputType,
        } = req.body;

        // Validation — require non-empty strings. Guarding the type here also
        // prevents `code.toUpperCase()` from throwing a TypeError (→ 500) when a
        // non-string code is posted.
        if (typeof code !== 'string' || !code.trim()
            || typeof category !== 'string' || !category.trim()
            || typeof label !== 'string' || !label.trim()) {
            return res.status(400).json({
                success: false,
                message: 'code, category, and label are required and must be strings',
            });
        }

        // Check unique code
        const existing = await prisma.supplementaryCriterion.findUnique({
            where: { code },
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                message: `Criterion with code '${code}' already exists`,
            });
        }

        const criterion = await prisma.supplementaryCriterion.create({
            data: {
                code: code.toUpperCase(),
                category,
                categoryTH,
                label,
                description,
                icon,
                sortOrder: sortOrder || 0,
                isRequired: isRequired || false,
                inputType: inputType || 'checkbox',
                createdBy: req.user?.id,
            },
        });

        res.status(201).json({
            success: true,
            message: 'Criterion created successfully',
            data: criterion,
        });
    } catch (error) {
        return respondError(res, req, error, { label: '[Criteria] create', message: 'Failed to create criterion' });
    }
});

/**
 * PATCH /api/criteria/:id
 * Update criterion (admin only)
 */
router.patch('/:id', authenticateProvider, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;

        // SECURITY (finding F12): whitelist updatable fields instead of spreading
        // req.body into the Prisma update. Spreading let an admin overwrite the
        // createdBy audit column and would silently expose any future sensitive/
        // relation column added to the model. updatedBy is forced server-side.
        const ALLOWED_FIELDS = [
            'category', 'categoryTH', 'code', 'label', 'description',
            'sortOrder', 'icon', 'isRequired', 'inputType', 'isActive',
        ];
        const updateData = { updatedBy: req.user?.id };
        for (const field of ALLOWED_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
                updateData[field] = req.body[field];
            }
        }

        const criterion = await prisma.supplementaryCriterion.update({
            where: { id },
            data: updateData,
        });

        res.json({
            success: true,
            message: 'Criterion updated successfully',
            data: criterion,
        });
    } catch (error) {
        // respondError maps P2025 → 404 and PrismaClientValidationError → 400.
        return respondError(res, req, error, { label: '[Criteria] update', message: 'Failed to update criterion' });
    }
});

/**
 * DELETE /api/criteria/:id
 * Delete criterion (admin only)
 */
router.delete('/:id', authenticateProvider, adminOnly, async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.supplementaryCriterion.delete({
            where: { id },
        });

        res.json({
            success: true,
            message: 'Criterion deleted successfully',
        });
    } catch (error) {
        // respondError maps P2025 → 404.
        return respondError(res, req, error, { label: '[Criteria] delete', message: 'Failed to delete criterion' });
    }
});

module.exports = router;
