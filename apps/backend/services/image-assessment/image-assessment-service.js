'use strict';

/**
 * Image Assessment Service — สัญญา C05F680149 ต้นแบบที่ 6 "ระบบตรวจสอบและ
 * ประเมิน (3 โมดูล)". Orchestrates:
 *   6.1 ตรวจสอบรูปภาพ  — inspectImageQuality (photo quality/completeness)
 *   6.2 ให้คะแนนคุณภาพ — scoreProductQuality (quality-scoring-service)
 *   6.3 ตรวจจับโรคพืช  — assessImage → disease-classifier (7 diseases)
 * + getCatalog (acceptance surface) + evaluateModel (KPI ≥85% harness).
 *
 * Advisory only — never decides GACP certification (owner ruling #298/#528).
 */

const logger = require('../../shared/logger');
const { extractImageFeatures } = require('./image-feature-extractor');
const { classifyDisease, DISEASE_CLASSES, getActiveProviderName } = require('./disease-classifier');
const { computeQualityScore, buildQualityCertificate, DIMENSIONS } = require('./quality-scoring-service');
const { evaluateClassifier } = require('./classifier-evaluator');

const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
const EXPOSURE_MIN = 40;
const EXPOSURE_MAX = 220;
const ACCURACY_TARGET = 0.85;

function httpError(statusCode, code, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

function clamp01(x) {
    if (!Number.isFinite(x)) { return 0; }
    return Math.max(0, Math.min(1, x));
}

/**
 * 6.1 (สัญญา) — "ตรวจสอบความสมบูรณ์ของพืช + ประเมินอายุการเก็บเกี่ยว".
 * Transparent colour-based BASELINE (advisory, no ML — same honesty posture as
 * the 6.3 classifier): plant completeness = healthy-green area penalised by
 * lesion coverage; maturity stage from green-dominance / yellowing / browning.
 * Deferred to the trained model for the ≥ contract accuracy; always advisory.
 */
function assessPlantCondition(features) {
    const f = features || {};
    const { r = 0, g = 0, b = 0 } = f.colorMeans || {};
    const green = clamp01((g - (r + b) / 2) / 128);
    const dark = clamp01(f.darkSpotRatio ?? 0);
    const white = clamp01(f.whiteCoverageRatio ?? 0);
    const yellow = clamp01(f.yellowRatio ?? 0);
    const damage = clamp01(dark + white + yellow);

    const completenessScore = Math.round(clamp01(green * (1 - damage)) * 100);

    let maturityStage;
    if (yellow > 0.25 || dark > 0.30) {
        maturityStage = 'OVER_MATURE'; // senescent / browning
    } else if (yellow > 0.08) {
        maturityStage = 'MATURE';
    } else {
        maturityStage = 'IMMATURE'; // vigorous green
    }

    return {
        completenessScore,
        maturityStage,
        isBaseline: true,
        needsExpertConfirmation: true,
        note: 'baseline สีเชิงกฎ (rule-based) ช่วยประเมินความสมบูรณ์/อายุเก็บเกี่ยว; ' +
            'ยืนยันด้วยผู้เชี่ยวชาญ/โมเดลที่เทรนในช่วง pilot',
    };
}

/** 6.1 — pure photo-quality inspection from extracted features. */
function inspectImageQuality(features) {
    const f = features || {};
    const width = f.width || 0;
    const height = f.height || 0;
    const brightness = Number.isFinite(f.brightness) ? f.brightness : 128;

    const resolutionOk = width >= MIN_WIDTH && height >= MIN_HEIGHT;
    const exposureOk = brightness >= EXPOSURE_MIN && brightness <= EXPOSURE_MAX;

    const issues = [];
    if (!resolutionOk) {
        issues.push(`ความละเอียดต่ำเกินไป (${width}x${height}); ต้องการอย่างน้อย ${MIN_WIDTH}x${MIN_HEIGHT}`);
    }
    if (brightness < EXPOSURE_MIN) { issues.push('ภาพมืดเกินไป (แสงไม่พอ)'); }
    if (brightness > EXPOSURE_MAX) { issues.push('ภาพสว่างเกินไป (over-exposure)'); }

    // Simple 0-100 photo-quality score: resolution 60% + exposure 40%.
    const resolutionScore = resolutionOk
        ? 100
        : Math.max(0, Math.round((Math.min(width / MIN_WIDTH, height / MIN_HEIGHT)) * 100));
    const exposureScore = exposureOk ? 100 : 40;
    const score = Math.round(resolutionScore * 0.6 + exposureScore * 0.4);

    return {
        passed: resolutionOk && exposureOk,
        resolutionOk,
        exposureOk,
        score,
        resolution: `${width}x${height}`,
        brightness,
        issues,
    };
}

/** 6.1 + 6.3 — full assessment of one leaf/produce photo. */
async function assessImage(input, { herbCode, provider } = {}) {
    let features;
    try {
        features = await extractImageFeatures(input);
    } catch (error) {
        logger.error('[ImageAssessment] feature extraction failed:', error);
        throw httpError(422, 'IMAGE_UNREADABLE', 'Could not read the image');
    }

    const imageInspection = inspectImageQuality(features);
    const plantCondition = assessPlantCondition(features);
    const disease = await classifyDisease(features, { provider });

    return {
        herbCode: herbCode || null,
        features,
        imageInspection,   // 6.1: photo quality/completeness gate
        plantCondition,    // 6.1: plant completeness + harvest-maturity (baseline)
        disease,           // 6.3: 7-disease detection (baseline + pluggable model)
        assessedAt: new Date().toISOString(),
    };
}

/** 6.2 — product quality score (operator/lab inputs) + digital certificate. */
function scoreProductQuality(subScores, { herbCode, batchNumber, issuedAt } = {}) {
    const result = computeQualityScore(subScores);
    const certificate = buildQualityCertificate({ result, herbCode, batchNumber, issuedAt });
    return { ...result, certificate };
}

/** Acceptance surface: the 3 modules' catalog. */
function getCatalog() {
    return {
        diseases: DISEASE_CLASSES,
        qualityDimensions: DIMENSIONS.map(d => ({ key: d.key, labelTH: d.labelTH, weight: d.weight })),
        classifierProvider: getActiveProviderName(),
        accuracyTarget: ACCURACY_TARGET,
        note: 'baseline classifier ระดับต้นแบบ (TRL 5) ความแม่นยำ ≥85% วัดด้วย confusion matrix ' +
            'จากภาพจริงที่ติดป้ายกำกับในช่วง pilot; ผลทุกภาพเป็นการช่วยประเมิน ไม่ตัดสินการรับรอง',
    };
}

/** KPI harness: measure classifier accuracy over labelled samples. */
function evaluateModel(samples, { target = ACCURACY_TARGET } = {}) {
    return evaluateClassifier(samples, DISEASE_CLASSES, { target });
}

module.exports = {
    inspectImageQuality,
    assessPlantCondition,
    assessImage,
    scoreProductQuality,
    getCatalog,
    evaluateModel,
    ACCURACY_TARGET,
};
