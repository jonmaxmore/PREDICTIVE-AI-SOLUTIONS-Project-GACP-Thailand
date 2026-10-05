/**
 * Trace API Route (Public + Auth)
 * Public traceability endpoint for QR code scanning
 * 
 * Scope: GACP Certification and Traceability ONLY
 * Does NOT include: Medical advice, safety information, drug interactions
 * Safety inquiries are referred to FDA per regulatory scope limitations
 * 
 * GET /api/trace/:qrCode - Get batch/lot/cycle info by QR code (Public)
 * GET /api/trace/:qrCode/qr - Generate QR code image (Public)
 * POST /api/trace/generate - Generate new QR code for a cycle/batch (Auth)
 */

const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
const QRCode = require('qrcode');
const { prisma } = require('../../../services/prisma-database');
const authModule = require('../../../middleware/auth-middleware');
const qrcodeService = require('../../../services/qrcode/qrcode-service');
const { getRequestIp } = require('../../../utils/client-ip');
const { registerBatchAndLotRoutes } = require('./trace-batch-lot-routes');
const { registerVerificationRoutes } = require('./trace-verification-routes');
const {
    // Constants
    FDA_REFERRAL,
    SAFETY_DISCLAIMER,
    TRACE_BASE_URL,
    TRACE_NOT_FOUND_MESSAGE,
    PLOT_HARVEST_META_PREFIX,
    // Helpers
    formatCultivationType,
    formatThaiDate,
    parseJsonMetaFromNotes,
    normalizeSourceFromPayload,
    buildIntegrityPayload,
    logPublicTraceAccess,
    evaluateCertGate,
} = require('../../../services/trace-service');

// Use shared Winston logger (replaces console.log fallback)
const logger = require('../../../shared/logger');
// Mock cache service (fallback)
const cacheService = {
    getTraceabilityData: async () => null,
    setTraceabilityData: async () => { },
};

// Safely get authenticateHealth
const authenticateHealth = (req, res, next) => {
    if (typeof authModule.authenticateHealth === 'function') {
        return authModule.authenticateHealth(req, res, next);
    }
    return res.status(500).json({ success: false, message: 'Authentication is not configured' });
};

/**
 * GET /api/trace/plot-cycle/:qrCode
 * Public endpoint - no auth required
 * Returns traceability information for a PlotCycle assignment
 */
router.get('/plot-cycle/:qrCode', async (req, res) => {
    try {
        const qrCode = String(req.params.qrCode || '').trim();
        const { resolveTraceByPlotCycleQr } = require('../../../services/trace-service');
        const result = await resolveTraceByPlotCycleQr(qrCode, {
            requestIp: getRequestIp(req),
            userAgent: req.get('user-agent'),
            originalUrl: req.originalUrl,
        });
        return res.status(result.status).json(result.body);
    } catch (error) {
        logger.error({
            type: 'plot_cycle_trace_error',
            error: safeErrorMessage(error),
            qrCode: req.params.qrCode,
        }, 'Error tracing plot-cycle');
        return res.status(500).json({
            success: false,
            message: TRACE_NOT_FOUND_MESSAGE,
            error: safeErrorMessage(error),
        });
    }
});

router.get('/:qrCode', async (req, res) => {
    try {
        const { qrCode } = req.params;

        // Check cache first
        const cached = await cacheService.getTraceabilityData(qrCode);
        if (cached && !req.query.nocache) {
            logger.debug({ qrCode }, 'Trace cache hit');
            return res.json({ ...cached, _cached: true, _cachedAt: new Date().toISOString() });
        }

        const { resolveTraceByGenericQr } = require('../../../services/trace-service');
        const result = await resolveTraceByGenericQr(qrCode, {
            requestIp: getRequestIp(req),
            userAgent: req.headers['user-agent'],
        });

        // Cache successful responses
        if (result.cacheResponse) {
            await cacheService.setTraceabilityData(qrCode, result.cacheResponse, 300);
        }

        return res.status(result.status).json(result.body);
    } catch (error) {
        logger.error({ type: 'trace_error', error: safeErrorMessage(error), stack: error.stack, qrCode: req.params.qrCode }, 'Error tracing QR code');
        res.status(500).json({
            success: false,
            message: TRACE_NOT_FOUND_MESSAGE,
            error: safeErrorMessage(error),
            disclaimers: SAFETY_DISCLAIMER,
            referrals: { safety: FDA_REFERRAL, medicalEmergency: { phone: '1669', note: 'No additional note' } },
        });
    }
});

/**
 * GET /api/trace/:qrCode/qr
 * Generate QR code image as data URL
 */
router.get('/:qrCode/qr', async (req, res) => {
    try {
        const { qrCode } = req.params;
        const { size = 300, format = 'png' } = req.query;

        const traceUrl = `${TRACE_BASE_URL}/trace/${qrCode}`;

        const qrOptions = {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            width: parseInt(size),
            margin: 2,
            color: {
                dark: '#10b981',  // Emerald color
                light: '#ffffff',
            },
        };

        if (format === 'svg') {
            const svg = await QRCode.toString(traceUrl, { type: 'svg', ...qrOptions });
            res.setHeader('Content-Type', 'image/svg+xml');
            return res.send(svg);
        } else if (format === 'dataurl') {
            const dataUrl = await QRCode.toDataURL(traceUrl, qrOptions);
            return res.json({
                success: true,
                qrCode,
                traceUrl,
                dataUrl,
            });
        } else {
            const buffer = await QRCode.toBuffer(traceUrl, qrOptions);
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Content-Disposition', `inline; filename="qr-${qrCode}.png"`);
            return res.send(buffer);
        }

    } catch (error) {
        logger.error('Error generating QR code:', error);
        res.status(500).json({
            success: false,
            message: TRACE_NOT_FOUND_MESSAGE,
            error: safeErrorMessage(error),
        });
    }
});

/**
 * The per-plant public trace route lived here: GET /api/trace/plant/:qrCode.
 *
 * It was removed on 2026-08-23 with the rest of the per-plant direction. The
 * reason is not that it was broken — it worked. It answered the same question the
 * lot route answers, "where did this come from", with a second and different
 * answer, and a traceability system that gives two answers to that question is
 * worse than one that gives none, because a buyer cannot tell which one binds.
 *
 * Granularity now ends at the plot and the lot (spec R8). A plot of 100 plants
 * carries one code, not 100. What replaces this route is the lot trace below,
 * which reaches the plot and the certificate through the harvest that produced it.
 */

registerBatchAndLotRoutes(router, {
    prisma,
    qrcodeService,
    logger,
    getRequestIp,
    normalizeSourceFromPayload,
    parseJsonMetaFromNotes,
    PLOT_HARVEST_META_PREFIX,
    buildIntegrityPayload,
    logPublicTraceAccess,
    TRACE_NOT_FOUND_MESSAGE,
    formatThaiDate,
    SAFETY_DISCLAIMER,
    FDA_REFERRAL,
    evaluateCertGate,
});

registerVerificationRoutes(router, {
    authenticateHealth,
    prisma,
    qrcodeService,
    TRACE_BASE_URL,
    buildIntegrityPayload,
    getRequestIp,
    logger,
});

module.exports = router;
