'use strict';

/**
 * Classifier Evaluator — สัญญา C05F680149 ต้นแบบที่ 6 (KPI ≥85%/โมดูล).
 * Produces the confusion matrix + per-class precision/recall + overall accuracy
 * from labelled (actual, predicted) pairs — this is the harness that MEASURES
 * the contractual ≥85% on the pilot's labelled images.
 */

const { evaluateClassifier } = require('../../services/image-assessment/classifier-evaluator');

describe('evaluateClassifier', () => {
    test('perfect predictions → accuracy 1, every class precision/recall 1', () => {
        const samples = [
            { actual: 'HEALTHY', predicted: 'HEALTHY' },
            { actual: 'LEAF_SPOT', predicted: 'LEAF_SPOT' },
            { actual: 'VIRUS', predicted: 'VIRUS' },
        ];
        const r = evaluateClassifier(samples, ['HEALTHY', 'LEAF_SPOT', 'VIRUS']);
        expect(r.accuracy).toBe(1);
        expect(r.total).toBe(3);
        expect(r.correct).toBe(3);
        for (const cls of Object.values(r.perClass)) {
            expect(cls.precision).toBe(1);
            expect(cls.recall).toBe(1);
        }
        expect(r.meetsTarget).toBe(true); // default 0.85
    });

    test('confusion matrix counts actual→predicted correctly', () => {
        const samples = [
            { actual: 'A', predicted: 'A' },
            { actual: 'A', predicted: 'B' },
            { actual: 'B', predicted: 'B' },
        ];
        const r = evaluateClassifier(samples, ['A', 'B']);
        expect(r.confusionMatrix.A.A).toBe(1);
        expect(r.confusionMatrix.A.B).toBe(1);
        expect(r.confusionMatrix.B.B).toBe(1);
        expect(r.confusionMatrix.B.A).toBe(0);
        expect(r.accuracy).toBeCloseTo(2 / 3, 5);
    });

    test('precision/recall computed per class', () => {
        // A: TP=1, FP=1 (a B predicted A), FN=1 (an A predicted B)
        const samples = [
            { actual: 'A', predicted: 'A' },
            { actual: 'A', predicted: 'B' },
            { actual: 'B', predicted: 'A' },
            { actual: 'B', predicted: 'B' },
        ];
        const r = evaluateClassifier(samples, ['A', 'B']);
        expect(r.perClass.A.precision).toBeCloseTo(1 / 2, 5); // 1 TP / (1 TP + 1 FP)
        expect(r.perClass.A.recall).toBeCloseTo(1 / 2, 5);    // 1 TP / (1 TP + 1 FN)
    });

    test('meetsTarget uses a configurable threshold; below → false with the number reported', () => {
        const samples = [
            { actual: 'A', predicted: 'A' },
            { actual: 'A', predicted: 'B' },
        ];
        const r = evaluateClassifier(samples, ['A', 'B'], { target: 0.85 });
        expect(r.accuracy).toBe(0.5);
        expect(r.meetsTarget).toBe(false);
        expect(r.target).toBe(0.85);
    });

    test('empty samples → accuracy 0, meetsTarget false (no crash)', () => {
        const r = evaluateClassifier([], ['A', 'B']);
        expect(r.total).toBe(0);
        expect(r.accuracy).toBe(0);
        expect(r.meetsTarget).toBe(false);
    });

    test('unknown label in samples → 400 EVAL_LABEL_UNKNOWN', () => {
        expect(() => evaluateClassifier([{ actual: 'A', predicted: 'Z' }], ['A', 'B']))
            .toThrow(expect.objectContaining({ statusCode: 400, code: 'EVAL_LABEL_UNKNOWN' }));
    });

    test('non-object sample element (null) → 400 EVAL_SAMPLE_INVALID, not a 500 TypeError', () => {
        expect(() => evaluateClassifier([null], ['A', 'B']))
            .toThrow(expect.objectContaining({ statusCode: 400, code: 'EVAL_SAMPLE_INVALID' }));
    });

    test('non-object sample element (number) → 400 EVAL_SAMPLE_INVALID', () => {
        expect(() => evaluateClassifier([1], ['A', 'B']))
            .toThrow(expect.objectContaining({ statusCode: 400, code: 'EVAL_SAMPLE_INVALID' }));
    });

    test('mixed valid + malformed element → still 400 (fails closed)', () => {
        expect(() => evaluateClassifier([{ actual: 'A', predicted: 'A' }, 'oops'], ['A', 'B']))
            .toThrow(expect.objectContaining({ statusCode: 400, code: 'EVAL_SAMPLE_INVALID' }));
    });
});
