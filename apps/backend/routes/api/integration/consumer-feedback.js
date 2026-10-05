/**
 * Consumer Feedback API Routes
 * PUBLIC endpoints for consumer effect tracking via QR scan
 * 
 * External apps can call these endpoints for cross-system integration
 * Uses Prisma ConsumerFeedback model (Phase 7)
 * 
 * POST /api/consumer-feedback - Submit feedback (Public)
 * GET /api/consumer-feedback/:certificateId - Get feedback for certificate (Public/Auth)
 * GET /api/consumer-feedback/stats/:certificateId - Get aggregated stats (Auth)
 */

const express = require('express');
const { respondError } = require('../../../shared/api-response');
const router = express.Router();
const { prisma } = require('../../../services/prisma-database');
const logger = require('../../../shared/logger');
const { createRateLimiter } = require('../../../middleware/rate-limiter');

// PENTEST G2 — the feedback create is public (no auth). Add a dedicated per-IP
// limiter so it can't be used to flood the DB / spam a certificate's feedback.
const feedbackCreateLimiter = createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: 'Too many feedback submissions, please try again later',
});

// --- PUBLIC ENDPOINTS (No Auth - for consumer QR scanning) ---

/**
 * POST /api/consumer-feedback
 * Submit consumer feedback - PUBLIC (no auth required)
 * Uses Prisma ConsumerFeedback model
 * 
 * @body {
 *   certificateId: string,   // Certificate ID from QR code
 *   rating: number,          // 1-5 stars
 *   feedback: string,        // Feedback text
 *   contact?: string,        // Optional email/phone
 * }
 */
router.post('/', feedbackCreateLimiter, async (req, res) => {
    try {
        const {
            certificateId,
            rating,
            feedback,
            contact,
        } = req.body;

        // Validation
        if (!certificateId || !rating || !feedback) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: certificateId, rating, feedback',
                messageEN: 'Missing required fields',
            });
        }

        if (rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                message: 'Rating must be between 1 and 5',
            });
        }

        // Verify certificate exists. Pull organizationId so the feedback
        // row inherits the certificate's tenant — public POST has no
        // AsyncLocalStorage context for the tenant-prisma-extension to
        // inject from, and ConsumerFeedback.organizationId is NOT NULL in
        // schema (`prisma/schema/trace.prisma`). Without this lookup the
        // create() silently 500'd on every consumer-side QR scan with
        // "Argument `organization` is missing" — same bug class as the
        // audit-chain fix in PR #199.
        const certificate = await prisma.certificate.findUnique({
            where: { id: certificateId },
            select: {
                id: true,
                certificateNumber: true,
                farmName: true,
                organizationId: true,
            },
        });

        if (!certificate) {
            return res.status(404).json({
                success: false,
                message: 'Certificate not found',
                messageEN: 'Certificate ID is invalid',
            });
        }

        // Create feedback record using Prisma
        const newFeedback = await prisma.consumerFeedback.create({
            data: {
                certificateId: certificateId,
                rating: parseInt(rating, 10),
                feedback: feedback,
                contact: contact || null,
                organizationId: certificate.organizationId,
            },
            select: {
                id: true,
                createdAt: true,
                rating: true,
            },
        });

        return res.status(201).json({
            success: true,
            message: 'ขอบคุณสำหรับความคิดเห็น',
            messageEN: 'Thank you for your feedback',
            data: {
                id: newFeedback.id,
                submittedAt: newFeedback.createdAt,
                certificateNumber: certificate.certificateNumber,
            },
        });

    } catch (error) {
        return respondError(res, req, error, {
            label: '[ConsumerFeedback] create',
            message: 'Failed to save feedback',
            messageTh: 'เกิดข้อผิดพลาดในการบันทึก',
        });
    }
});

/**
 * GET /api/consumer-feedback/:certificateId
 * Get all feedback for a certificate
 * Requires authentication to see full data
 */
router.get('/:certificateId', async (req, res) => {
    try {
        const { certificateId } = req.params;
        const { limit = 50, offset = 0 } = req.query;

        // Check if authenticated
        const isAuthenticated = req.user ? true : false;

        // Fetch feedbacks
        const feedbacks = await prisma.consumerFeedback.findMany({
            where: {
                certificateId: certificateId,
            },
            select: {
                id: true,
                rating: true,
                feedback: true,
                contact: isAuthenticated,  // Only return contact if authenticated
                createdAt: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
            // PENTEST G2 — clamp the public page size so an attacker can't request
            // an unbounded result set (resource-exhaustion). Default 50, hard cap 100.
            take: Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
            skip: Math.max(0, parseInt(offset, 10) || 0),
        });

        // Calculate stats
        const totalCount = await prisma.consumerFeedback.count({
            where: { certificateId: certificateId },
        });

        const stats = {
            total: totalCount,
            avgRating: feedbacks.length > 0
                ? (feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length).toFixed(2)
                : 0,
            ratingDistribution: {
                5: feedbacks.filter(f => f.rating === 5).length,
                4: feedbacks.filter(f => f.rating === 4).length,
                3: feedbacks.filter(f => f.rating === 3).length,
                2: feedbacks.filter(f => f.rating === 2).length,
                1: feedbacks.filter(f => f.rating === 1).length,
            },
        };

        // Public response (truncated feedback)
        if (!isAuthenticated) {
            return res.json({
                success: true,
                certificateId,
                stats,
                data: feedbacks.slice(0, 10).map(f => ({
                    rating: f.rating,
                    feedback: f.feedback.substring(0, 100) + (f.feedback.length > 100 ? '...' : ''),
                    createdAt: f.createdAt,
                })),
            });
        }

        // Authenticated response (full data)
        return res.json({
            success: true,
            certificateId,
            stats,
            pagination: {
                limit: parseInt(limit, 10),
                offset: parseInt(offset, 10),
                total: totalCount,
            },
            data: feedbacks,
        });

    } catch (error) {
        logger.error('[ConsumerFeedback GET] Error:', error);
        return respondError(res, req, error, { message: 'Failed to retrieve feedback' });
    }
});

/**
 * GET /api/consumer-feedback/stats/:certificateId
 * Get aggregated statistics - PUBLIC
 * External apps can call this for dashboards
 */
router.get('/stats/:certificateId', async (req, res) => {
    try {
        const { certificateId } = req.params;

        // Fetch all feedbacks for stats
        const feedbacks = await prisma.consumerFeedback.findMany({
            where: {
                certificateId: certificateId,
            },
            select: {
                rating: true,
                createdAt: true,
            },
        });

        const total = feedbacks.length;
        const avgRating = total > 0
            ? (feedbacks.reduce((sum, f) => sum + f.rating, 0) / total).toFixed(2)
            : 0;

        return res.json({
            success: true,
            certificateId,
            stats: {
                totalFeedbacks: total,
                averageRating: parseFloat(avgRating),
                ratingDistribution: {
                    5: feedbacks.filter(f => f.rating === 5).length,
                    4: feedbacks.filter(f => f.rating === 4).length,
                    3: feedbacks.filter(f => f.rating === 3).length,
                    2: feedbacks.filter(f => f.rating === 2).length,
                    1: feedbacks.filter(f => f.rating === 1).length,
                },
                lastFeedbackAt: feedbacks.length > 0
                    ? feedbacks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0].createdAt
                    : null,
            },
        });

    } catch (error) {
        logger.error('[ConsumerFeedback Stats] Error:', error);
        return respondError(res, req, error, { message: 'Failed to calculate stats' });
    }
});

module.exports = router;
