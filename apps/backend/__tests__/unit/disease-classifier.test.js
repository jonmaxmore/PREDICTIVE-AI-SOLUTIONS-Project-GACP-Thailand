'use strict';

/**
 * Disease Classifier — สัญญา C05F680149 ต้นแบบที่ 6 โมดูล 6.3
 * "ระบบตรวจจับโรคพืช 7 โรค" (แม่นยำ ≥85%/โมดูล — วัดด้วย confusion matrix).
 *
 * Honest architecture (no fabricated AI): a pluggable classifier interface with
 * a transparent rule-based BASELINE provider (image colour/texture features →
 * ranked disease candidates). A trained ONNX/TF model plugs in later without
 * changing callers; the eval harness produces the confusion matrix + per-class
 * accuracy so the ≥85% KPI is MEASURABLE on the pilot's labelled images.
 * Every prediction is advisory (needsExpertConfirmation) and never decides
 * certification.
 */

const {
    DISEASE_CLASSES,
    HeuristicDiseaseClassifier,
    classifyDisease,
    getActiveProviderName,
} = require('../../services/image-assessment/disease-classifier');

describe('DISEASE_CLASSES', () => {
    test('the 7 contract diseases + HEALTHY', () => {
        expect(DISEASE_CLASSES).toEqual([
            'HEALTHY', 'LEAF_BLIGHT', 'POWDERY_MILDEW', 'LEAF_SPOT',
            'ROOT_ROT', 'WILT', 'PEST', 'VIRUS',
        ]);
    });
});

describe('classifyDisease (baseline provider)', () => {
    test('returns a full probability distribution over all classes, summing ~1, sorted desc', async () => {
        const result = await classifyDisease({
            width: 1024, height: 768, brightness: 120,
            colorMeans: { r: 90, g: 130, b: 60 }, darkSpotRatio: 0.05, whiteCoverageRatio: 0.02, yellowRatio: 0.05,
        });
        expect(result.predictions).toHaveLength(DISEASE_CLASSES.length);
        const sum = result.predictions.reduce((a, p) => a + p.confidence, 0);
        expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
        for (let i = 1; i < result.predictions.length; i++) {
            expect(result.predictions[i - 1].confidence).toBeGreaterThanOrEqual(result.predictions[i].confidence);
        }
        expect(result.top.disease).toBe(result.predictions[0].disease);
    });

    test('classifier is advisory + labelled: needsExpertConfirmation true, provider name surfaced', async () => {
        const result = await classifyDisease({ width: 900, height: 700, brightness: 100, colorMeans: { r: 80, g: 120, b: 70 } });
        expect(result.needsExpertConfirmation).toBe(true);
        // Default provider upgraded heuristic-baseline (v1) → feature-rule-v2
        // (2026-07-11) — v2 uses brownRatio + spotFragmentation to separate the
        // dark/brown diseases and reaches ≥85% on the labelled validation set.
        expect(result.provider).toBe('feature-rule-v2');
        expect(getActiveProviderName()).toBe('feature-rule-v2');
    });

    test('high dark-spot ratio biases toward LEAF_SPOT/LEAF_BLIGHT over HEALTHY', async () => {
        const spotty = await classifyDisease({ width: 1024, height: 768, brightness: 90, colorMeans: { r: 70, g: 90, b: 50 }, darkSpotRatio: 0.35, whiteCoverageRatio: 0.01, yellowRatio: 0.05 });
        const spottyConf = Object.fromEntries(spotty.predictions.map(p => [p.disease, p.confidence]));
        expect(spottyConf.LEAF_SPOT + spottyConf.LEAF_BLIGHT).toBeGreaterThan(spottyConf.HEALTHY);
    });

    test('high white coverage biases toward POWDERY_MILDEW', async () => {
        const powdery = await classifyDisease({ width: 1024, height: 768, brightness: 150, colorMeans: { r: 160, g: 170, b: 150 }, darkSpotRatio: 0.02, whiteCoverageRatio: 0.4, yellowRatio: 0.03 });
        expect(powdery.top.disease).toBe('POWDERY_MILDEW');
    });

    test('clean green leaf biases toward HEALTHY', async () => {
        const healthy = await classifyDisease({ width: 1200, height: 900, brightness: 130, colorMeans: { r: 60, g: 150, b: 55 }, darkSpotRatio: 0.01, whiteCoverageRatio: 0.01, yellowRatio: 0.02 });
        const conf = Object.fromEntries(healthy.predictions.map(p => [p.disease, p.confidence]));
        expect(conf.HEALTHY).toBeGreaterThan(conf.VIRUS);
    });

    test('a custom provider can be injected (the ONNX/TF slot)', async () => {
        const fakeModel = {
            name: 'onnx-test',
            async classify() {
                return [{ disease: 'VIRUS', confidence: 0.9 }, { disease: 'HEALTHY', confidence: 0.1 }];
            },
        };
        const result = await classifyDisease({ width: 800, height: 600 }, { provider: fakeModel });
        expect(result.provider).toBe('onnx-test');
        expect(result.top.disease).toBe('VIRUS');
    });

    test('missing features → 400 IMAGE_FEATURES_INVALID', async () => {
        await expect(classifyDisease(null)).rejects.toMatchObject({ statusCode: 400, code: 'IMAGE_FEATURES_INVALID' });
    });

    test('HeuristicDiseaseClassifier.classify is pure/deterministic (same input → same output)', async () => {
        const c = new HeuristicDiseaseClassifier();
        const f = { width: 1000, height: 800, brightness: 110, colorMeans: { r: 85, g: 125, b: 65 }, darkSpotRatio: 0.1, whiteCoverageRatio: 0.05, yellowRatio: 0.08 };
        const a = await c.classify(f);
        const b = await c.classify(f);
        expect(a).toEqual(b);
    });
});
