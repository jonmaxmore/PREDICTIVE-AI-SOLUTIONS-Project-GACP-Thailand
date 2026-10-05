/**
 * Fraud Detection API Routes
 * 
 * Provides endpoints for:
 * - Duplicate farm detection
 * - Document verification
 * - Anomaly detection
 * - Risk scoring
 */

const express = require('express');
const { safeErrorMessage, respondError } = require('../../../shared/api-response');
const router = express.Router();
const fraudDetectionService = require('../../../services/fraud-detection-service');
const { authenticateProvider, requireRole } = require('../../../middleware/auth-middleware');
const { ROLE_GROUPS } = require('../../../shared/canonical-rbac');
const farmService = require('../../../services/farm-service');
const applicationService = require('../../../services/application-service');
const cacheService = require('../../../services/cache-service');
const logger = require('../../../shared/logger');

// Batch 11 audit cluster cleanup: routes/api/audit/fraud-detection.js no
// longer reaches into prisma directly. The Farm and ApplicationDocument
// reads go through farm-service / application-service so the canonical
// `isDeleted: false` filter and the column projection cannot drift
// (Thai PDPA Act B.E. 2562 s.24 — purpose limitation enforced at the
// service boundary).

// DUPLICATE FARM DETECTION

/**
 * @route POST /api/fraud-detection/farms/:farmId/analyze
 * @desc Analyze a farm for potential fraud indicators
 * @access Provider only
 */
router.post('/farms/:farmId/analyze', authenticateProvider, requireRole(ROLE_GROUPS.AUDIT_STAFF), async (req, res) => {
    try {
        const { farmId } = req.params;
        
        logger.info({
            type: 'fraud_analysis_request',
            farmId,
            userId: req.user.id,
        }, 'Fraud analysis requested');

        const result = await fraudDetectionService.detectDuplicateFarms(farmId);

        if (result.error) {
            return res.status(400).json({
                success: false,
                error: result.error,
            });
        }

        // Log high-risk detections
        if (result.riskLevel === 'HIGH') {
            logger.warn({
                type: 'high_risk_farm_detected',
                farmId,
                riskScore: result.riskScore,
                findings: result.findings.map(f => f.type),
            }, 'High risk farm detected');
        }

        res.json({
            success: true,
            data: result,
        });

    } catch (error) {
        logger.error({
            type: 'fraud_analysis_error',
            error: safeErrorMessage(error),
            farmId: req.params.farmId,
        }, 'Fraud analysis failed');

        return respondError(res, req, error, { message: 'Fraud analysis failed' });
    }
});

/**
 * @route GET /api/fraud-detection/farms/:farmId/analysis
 * @desc Get cached fraud analysis for a farm
 * @access Provider only
 */
router.get('/farms/:farmId/analysis', authenticateProvider, requireRole(ROLE_GROUPS.AUDIT_STAFF), async (req, res) => {
    try {
        const { farmId } = req.params;
        const cached = await cacheService.get(`fraud:farm:${farmId}`);
        
        if (!cached) {
            return res.status(404).json({
                success: false,
                error: 'No analysis found. Run POST /analyze first.',
                farmId,
            });
        }

        res.json({
            success: true,
            data: cached,
            cached: true,
        });

    } catch (error) {
        logger.error({
            type: 'fraud_analysis_retrieve_error',
            error: safeErrorMessage(error),
        }, 'Failed to retrieve fraud analysis');

        return respondError(res, req, error, { message: 'Failed to retrieve analysis' });
    }
});

/**
 * @route GET /api/fraud-detection/farms/duplicates
 * @desc Find all potential duplicate farms
 * @access Admin only
 */
router.get('/farms/duplicates', authenticateProvider, requireRole(ROLE_GROUPS.ADMIN_ONLY), async (req, res) => {
    try {
        const { 
            distance = 100, // meters
            province,
            page = 1,
            limit = 50,
        } = req.query;


        // Find all farms with GPS coordinates.
        // Service-layer indirection: the canonical `isDeleted: false`
        // and lat/lng-non-null filters live in farmService.findFarmsWithGps.
        const farms = await farmService.findFarmsWithGps({ province, page, limit });

        // Check for duplicates
        const duplicates = [];
        
        for (let i = 0; i < farms.length; i++) {
            for (let j = i + 1; j < farms.length; j++) {
                const farm1 = farms[i];
                const farm2 = farms[j];

                const distance_meters = calculateDistance(
                    farm1.latitude,
                    farm1.longitude,
                    farm2.latitude,
                    farm2.longitude,
                );

                if (distance_meters < parseInt(distance)) {
                    duplicates.push({
                        farm1: {
                            id: farm1.id,
                            name: farm1.farmName,
                            province: farm1.province,
                        },
                        farm2: {
                            id: farm2.id,
                            name: farm2.farmName,
                            province: farm2.province,
                        },
                        distance: Math.round(distance_meters),
                        sameOwner: farm1.ownerId === farm2.ownerId,
                    });
                }
            }
        }

        // Sort by distance
        duplicates.sort((a, b) => a.distance - b.distance);

        res.json({
            success: true,
            data: duplicates,
            summary: {
                totalFarmsChecked: farms.length,
                duplicatePairsFound: duplicates.length,
                sameOwnerDuplicates: duplicates.filter(d => d.sameOwner).length,
            },
        });

    } catch (error) {
        logger.error({
            type: 'duplicate_farms_query_error',
            error: safeErrorMessage(error),
        }, 'Failed to query duplicate farms');

        return respondError(res, req, error, { message: 'Failed to query duplicates' });
    }
});

// DOCUMENT VERIFICATION

/**
 * @route POST /api/fraud-detection/documents/:documentId/verify
 * @desc Verify a document for authenticity
 * @access Provider only
 */
router.post('/documents/:documentId/verify', authenticateProvider, requireRole(ROLE_GROUPS.FULL_STAFF), async (req, res) => {
    try {
        const { documentId } = req.params;
        const orgId = req.user?.organizationId || req.tenantContext?.organizationId || null;

        const result = await fraudDetectionService.verifyDocument(documentId, orgId);

        if (result.error) {
            return res.status(400).json({
                success: false,
                error: result.error,
            });
        }

        // Log if high risk
        if (result.riskLevel === 'HIGH') {
            logger.warn({
                type: 'suspicious_document_detected',
                documentId,
                riskScore: result.riskScore,
            }, 'Suspicious document detected');
        }

        res.json({
            success: true,
            data: result,
        });

    } catch (error) {
        logger.error({
            type: 'document_verification_error',
            error: safeErrorMessage(error),
            documentId: req.params.documentId,
        }, 'Document verification failed');

        return respondError(res, req, error, { message: 'Document verification failed' });
    }
});

/**
 * @route GET /api/fraud-detection/applications/:applicationId/documents
 * @desc Verify all documents in an application
 * @access Provider only
 */
router.get('/applications/:applicationId/documents', authenticateProvider, requireRole(ROLE_GROUPS.FULL_STAFF), async (req, res) => {
    try {
        const { applicationId } = req.params;
        const orgId = req.user?.organizationId || req.tenantContext?.organizationId || null;

        const documents = await applicationService.listApplicationDocumentsForFraudScan(applicationId, { organizationId: orgId });

        const results = [];
        for (const doc of documents) {
            const verification = await fraudDetectionService.verifyDocument(doc.id, orgId);
            results.push({
                documentId: doc.id,
                documentType: doc.documentType,
                ...verification,
            });
        }

        const highRiskDocs = results.filter(r => r.riskLevel === 'HIGH');

        res.json({
            success: true,
            data: {
                applicationId,
                totalDocuments: results.length,
                highRiskDocuments: highRiskDocs.length,
                documents: results,
            },
        });

    } catch (error) {
        logger.error({
            type: 'application_documents_verification_error',
            error: safeErrorMessage(error),
        }, 'Application documents verification failed');

        return respondError(res, req, error, { message: 'Verification failed' });
    }
});

// ANOMALY DETECTION

/**
 * @route POST /api/fraud-detection/cycles/:cycleId/analyze
 * @desc Analyze a planting cycle for anomalies
 * @access Provider only
 */
router.post('/cycles/:cycleId/analyze', authenticateProvider, requireRole(ROLE_GROUPS.FULL_STAFF), async (req, res) => {
    try {
        const { cycleId } = req.params;

        const result = await fraudDetectionService.detectYieldAnomalies(cycleId);

        if (result.error) {
            return res.status(400).json({
                success: false,
                error: result.error,
            });
        }

        res.json({
            success: true,
            data: result,
        });

    } catch (error) {
        logger.error({
            type: 'cycle_anomaly_analysis_error',
            error: safeErrorMessage(error),
        }, 'Cycle anomaly analysis failed');

        return respondError(res, req, error, { message: 'Analysis failed' });
    }
});

// BATCH OPERATIONS

/**
 * @route POST /api/fraud-detection/batch/analyze
 * @desc Run fraud detection on all pending applications
 * @access Admin only
 */
router.post('/batch/analyze', authenticateProvider, requireRole(ROLE_GROUPS.ADMIN_ONLY), async (req, res) => {
    try {
        logger.info({
            type: 'batch_fraud_detection_start',
            userId: req.user.id,
        }, 'Batch fraud detection started');

        const result = await fraudDetectionService.batchFraudDetection();

        logger.info({
            type: 'batch_fraud_detection_complete',
            totalAnalyzed: result.totalAnalyzed,
            highRisk: result.highRisk,
        }, 'Batch fraud detection completed');

        res.json({
            success: true,
            data: result,
        });

    } catch (error) {
        logger.error({
            type: 'batch_fraud_detection_error',
            error: safeErrorMessage(error),
        }, 'Batch fraud detection failed');

        return respondError(res, req, error, { message: 'Batch analysis failed' });
    }
});

/**
 * @route GET /api/fraud-detection/dashboard
 * @desc Get fraud detection dashboard summary
 * @access Admin only
 */
router.get('/dashboard', authenticateProvider, requireRole(ROLE_GROUPS.ADMIN_ONLY), async (req, res) => {
    try {

        // Get statistics. The Farm + Application counts are routed
        // through their services to keep the canonical `isDeleted: false`
        // filter in one place. The ApplicationDocument count is left as
        // a placeholder until the verificationStatus column ships — at
        // that point it will move into application-service alongside the
        // documents-for-fraud-scan helper.
        const [
            highRiskFarms,
            mediumRiskFarms,
            suspiciousDocuments,
            pendingFraudCheck,
        ] = await Promise.all([
            // High risk farms (would need fraudScore field in schema)
            farmService.countFarms({ where: {} }),
            // Medium risk farms
            farmService.countFarms({ where: {} }),
            // Documents flagged for review (placeholder — see comment above)
            Promise.resolve(0),
            // Applications pending fraud check
            applicationService.countApplicationsByStatus('PENDING'),
        ]);

        res.json({
            success: true,
            data: {
                summary: {
                    highRiskFarms,
                    mediumRiskFarms,
                    suspiciousDocuments,
                    pendingFraudCheck,
                },
                alerts: [],
            },
        });

    } catch (error) {
        logger.error({
            type: 'fraud_dashboard_error',
            error: safeErrorMessage(error),
        }, 'Failed to load fraud dashboard');

        return respondError(res, req, error, { message: 'Failed to load dashboard' });
    }
});

// HELPER FUNCTIONS

/**
 * Calculate distance between two GPS coordinates in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

module.exports = router;
