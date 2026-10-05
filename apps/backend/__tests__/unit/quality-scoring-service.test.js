'use strict';

/**
 * Quality Scoring Service — สัญญา C05F680149 ต้นแบบที่ 6 โมดูล 6.2
 * "ระบบให้คะแนนคุณภาพ" (เกณฑ์ 5 ด้าน: สี/ขนาด/ความชื้น/สิ่งปนเปื้อน/สารสำคัญ,
 * คะแนน 1-100 + ใบรับรองคุณภาพดิจิทัล).
 *
 * Deterministic, real, no ML: a weighted composite over 5 measured sub-scores.
 * Fully testable without images. Never touches the certification PASS/FAIL
 * decision (owner ruling #298/#528) — this scores PRODUCT quality only.
 */

const svc = require('../../services/image-assessment/quality-scoring-service');

describe('quality-scoring-service.DIMENSIONS', () => {
    test('exactly the 5 contract dimensions, weights sum to 1', () => {
        const keys = svc.DIMENSIONS.map(d => d.key);
        expect(keys).toEqual(['COLOR', 'SIZE', 'MOISTURE', 'CONTAMINATION', 'ACTIVE_COMPOUND']);
        const sum = svc.DIMENSIONS.reduce((a, d) => a + d.weight, 0);
        expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    });
});

describe('quality-scoring-service.computeQualityScore', () => {
    test('all sub-scores 100 → score 100, grade A', () => {
        const r = svc.computeQualityScore({ COLOR: 100, SIZE: 100, MOISTURE: 100, CONTAMINATION: 100, ACTIVE_COMPOUND: 100 });
        expect(r.score).toBe(100);
        expect(r.grade).toBe('A');
        expect(r.dimensions).toHaveLength(5);
    });

    test('all sub-scores 0 → score 0, grade D', () => {
        const r = svc.computeQualityScore({ COLOR: 0, SIZE: 0, MOISTURE: 0, CONTAMINATION: 0, ACTIVE_COMPOUND: 0 });
        expect(r.score).toBe(0);
        expect(r.grade).toBe('D');
    });

    test('weighted composite is correct for mixed sub-scores', () => {
        // equal-ish weights; compute expected from the service weights
        const inputs = { COLOR: 80, SIZE: 60, MOISTURE: 90, CONTAMINATION: 70, ACTIVE_COMPOUND: 50 };
        const expected = Math.round(
            svc.DIMENSIONS.reduce((a, d) => a + d.weight * inputs[d.key], 0),
        );
        const r = svc.computeQualityScore(inputs);
        expect(r.score).toBe(expected);
    });

    test('missing dimension → 400-style throw with statusCode/code', () => {
        expect(() => svc.computeQualityScore({ COLOR: 80 }))
            .toThrow(expect.objectContaining({ statusCode: 400, code: 'QUALITY_INPUT_INVALID' }));
    });

    test('out-of-range sub-score → throws', () => {
        expect(() => svc.computeQualityScore({ COLOR: 120, SIZE: 50, MOISTURE: 50, CONTAMINATION: 50, ACTIVE_COMPOUND: 50 }))
            .toThrow(expect.objectContaining({ code: 'QUALITY_INPUT_INVALID' }));
    });

    test('grades map by band: A≥80, B≥65, C≥50, else D', () => {
        const mk = (v) => svc.computeQualityScore({ COLOR: v, SIZE: v, MOISTURE: v, CONTAMINATION: v, ACTIVE_COMPOUND: v }).grade;
        expect(mk(85)).toBe('A');
        expect(mk(70)).toBe('B');
        expect(mk(55)).toBe('C');
        expect(mk(40)).toBe('D');
    });

    test('each dimension is echoed with its weighted contribution', () => {
        const r = svc.computeQualityScore({ COLOR: 100, SIZE: 0, MOISTURE: 0, CONTAMINATION: 0, ACTIVE_COMPOUND: 0 });
        const color = r.dimensions.find(d => d.key === 'COLOR');
        expect(color.subScore).toBe(100);
        expect(color.weightedContribution).toBeCloseTo(svc.DIMENSIONS.find(d => d.key === 'COLOR').weight * 100, 5);
    });
});

describe('quality-scoring-service.scoreMoistureBand (helper: raw % → 0-100)', () => {
    test('within ideal band → high; far outside → low; clamped 0-100', () => {
        // ideal dry herb moisture ~8-12%
        expect(svc.scoreMoistureBand(10, { idealMin: 8, idealMax: 12 })).toBe(100);
        const low = svc.scoreMoistureBand(20, { idealMin: 8, idealMax: 12 });
        expect(low).toBeGreaterThanOrEqual(0);
        expect(low).toBeLessThan(100);
        expect(svc.scoreMoistureBand(60, { idealMin: 8, idealMax: 12 })).toBe(0);
    });
});

describe('quality-scoring-service.buildQualityCertificate', () => {
    test('produces a digital quality certificate payload (score/grade/dimensions/timestamp-safe)', () => {
        const result = svc.computeQualityScore({ COLOR: 90, SIZE: 85, MOISTURE: 95, CONTAMINATION: 80, ACTIVE_COMPOUND: 88 });
        const cert = svc.buildQualityCertificate({ result, herbCode: 'TURMERIC', batchNumber: 'B-001', issuedAt: '2026-07-10T00:00:00Z' });
        expect(cert.herbCode).toBe('TURMERIC');
        expect(cert.batchNumber).toBe('B-001');
        expect(cert.score).toBe(result.score);
        expect(cert.grade).toBe(result.grade);
        expect(cert.dimensions).toHaveLength(5);
        expect(cert.disclaimer).toMatch(/คุณภาพ|ไม่.*การรับรอง|ไม่ใช่/); // not a GACP certification
    });
});
