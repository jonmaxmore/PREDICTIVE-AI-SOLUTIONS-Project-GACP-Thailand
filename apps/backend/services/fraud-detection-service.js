/**
 * AI Fraud Detection Service - PRODUCTION IMPLEMENTATION
 *
 * Real implementations:
 * - OCR validation using Tesseract.js
 * - Image quality analysis using Sharp
 * - EXIF metadata extraction
 * - File integrity verification
 * - Tampering detection
 */

const { prisma } = require('./prisma-database');
const logger = require('../shared/logger');
const cacheService = require('./cache-service');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { createFraudDuplicateFarmMethods } = require('./fraud-detection/duplicate-farm-methods');
const { createFraudDocumentVerificationMethods } = require('./fraud-detection/document-verification-methods');
const { createFraudAnomalyBatchMethods } = require('./fraud-detection/anomaly-batch-methods');

// Dynamic imports for heavy libraries (loaded only when needed)
let sharp;
let tesseract;
let exifParser;

async function loadLibraries() {
    if (!sharp) {
        sharp = require('sharp');
    }
    if (!tesseract) {
        tesseract = require('tesseract.js');
    }
    if (exifParser === undefined) {
        // exif-parser is an optional signal (EXIF metadata tamper checks). When
        // it is not installed, degrade gracefully instead of crashing every fraud
        // operation — including ones that don't use EXIF (e.g. duplicate-farm
        // detection) — with MODULE_NOT_FOUND. Callers must handle a null parser.
        try {
            exifParser = require('exif-parser');
        } catch (_err) {
            logger.warn('[fraud] exif-parser unavailable; EXIF metadata checks disabled');
            exifParser = null;
        }
    }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const earthRadiusMeters = 6371e3;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const deltaLatRad = (lat2 - lat1) * Math.PI / 180;
    const deltaLonRad = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2)
        + Math.cos(lat1Rad) * Math.cos(lat2Rad)
        * Math.sin(deltaLonRad / 2) * Math.sin(deltaLonRad / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusMeters * c;
}

class FraudDetectionService {
    constructor() {
        this.thresholds = {
            DUPLICATE_DISTANCE: 100,
            DUPLICATE_FARM_RISK: 70,
            DOCUMENT_QUALITY_RISK: 50,
            YIELD_ANOMALY_RISK: 60,
            HIGH_RISK_THRESHOLD: 70,
            MEDIUM_RISK_THRESHOLD: 40,
        };
        this.librariesLoaded = false;
    }

    async ensureLibraries() {
        if (!this.librariesLoaded) {
            await loadLibraries();
            this.librariesLoaded = true;
        }
    }

    _getSharp() {
        return sharp;
    }

    _getTesseract() {
        return tesseract;
    }

    _getExifParser() {
        return exifParser;
    }

    _calculateRiskLevel(score) {
        if (score >= this.thresholds.HIGH_RISK_THRESHOLD) {
            return 'HIGH';
        }
        if (score >= this.thresholds.MEDIUM_RISK_THRESHOLD) {
            return 'MEDIUM';
        }
        return 'LOW';
    }

    _maskIdNumber(idNumber) {
        if (!idNumber || idNumber.length < 4) {
            return '****';
        }
        return idNumber.substring(0, 2) + '****' + idNumber.slice(-2);
    }

    _generateRecommendations(findings) {
        const recommendations = [];

        for (const finding of findings) {
            switch (finding.type) {
                case 'GEOGRAPHIC_DUPLICATE':
                    recommendations.push({
                        priority: 'HIGH',
                        action: 'FIELD_VISIT_REQUIRED',
                        description: 'Conduct on-site visit to verify farm locations are distinct',
                    });
                    recommendations.push({
                        priority: 'HIGH',
                        action: 'GPS_VERIFICATION',
                        description: 'Verify GPS coordinates with high-precision device',
                    });
                    break;

                case 'ID_CARD_DUPLICATE':
                    recommendations.push({
                        priority: 'HIGH',
                        action: 'DOCUMENT_REVIEW',
                        description: 'Manually review all ID documents for authenticity',
                    });
                    recommendations.push({
                        priority: 'HIGH',
                        action: 'APPLICANT_INTERVIEW',
                        description: 'Interview applicant to clarify multiple applications',
                    });
                    break;

                case 'PHOTO_DUPLICATE':
                    recommendations.push({
                        priority: 'MEDIUM',
                        action: 'PHOTO_VERIFICATION',
                        description: 'Request new photos with timestamp and GPS metadata',
                    });
                    break;

                case 'YIELD_ANOMALY':
                    recommendations.push({
                        priority: 'MEDIUM',
                        action: 'HARVEST_VERIFICATION',
                        description: 'Verify harvest records with weighing documentation',
                    });
                    break;

                case 'HARVEST_TIMING_ANOMALY':
                    recommendations.push({
                        priority: 'LOW',
                        action: 'REVIEW_CULTIVATION_RECORDS',
                        description: 'Review cultivation logs for explanation of timing difference',
                    });
                    break;
            }
        }

        return recommendations;
    }

    _generateDocumentRecommendations(checks) {
        return checks
            .filter((c) => !c.passed)
            .map((c) => ({
                check: c.name,
                action: c.recommendation || 'Review manually',
                details: c.details,
            }));
    }
}

Object.assign(
    FraudDetectionService.prototype,
    createFraudDuplicateFarmMethods({ prisma, cacheService, logger }),
    createFraudDocumentVerificationMethods({
        prisma,
        logger,
        fs,
        path,
        crypto,
        calculateDistance,
    }),
    createFraudAnomalyBatchMethods({ prisma, cacheService, logger }),
);

module.exports = new FraudDetectionService();
