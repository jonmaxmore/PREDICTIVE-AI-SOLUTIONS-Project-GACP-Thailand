/**
 * Task 9 (document pre-check): the accuracy report sweeps OCR_CONFIDENCE_MIN
 * and NAME_SIMILARITY_MIN over the corpus, so the rule layer has to accept
 * them as a call parameter. The parameter is optional; production callers
 * (service.js) never pass it, and omitting it must behave exactly like
 * passing the two constants.
 *
 * @see apps/backend/services/document-precheck/evaluate.js
 * @see apps/backend/scripts/document-precheck/accuracy-report.js
 */

const { evaluate, OCR_CONFIDENCE_MIN, NAME_SIMILARITY_MIN } = require('../../../services/document-precheck/evaluate');
const { nameMatchLevel, nameSimilarity } = require('../../../services/document-precheck/normalize');
const { DOCUMENT_SLOTS } = require('../../../constants/document-slots');

const HOUSE_REG = DOCUMENT_SLOTS.HOUSE_REG.slotId;
const NOW = new Date('2026-09-27T04:00:00.000Z');

/** normalized "ธนากรพิทักษ์ไทย" vs "ธนาพิทักษ์ไทย": 2 edits over 15 chars. */
const ON_FILE = 'นายธนา พิทักษ์ไทย';
const NEAR_NAME = 'นายธนากร พิทักษ์ไทย';

function houseRegExtraction(holder, confidence) {
    return {
        method: 'OCR',
        pageCount: 1,
        pages: [{ text: `ทะเบียนบ้าน\nชื่อ ${holder} สถานภาพ เจ้าบ้าน`, confidence }],
    };
}

function flagFor(flags, check) {
    return flags.find((f) => f.check === check);
}

describe('nameMatchLevel(a, b, kind, minSimilarity)', () => {
    const sim = nameSimilarity(NEAR_NAME, ON_FILE, 'PERSON');

    test('the pair sits between the two thresholds used below', () => {
        expect(sim).toBeGreaterThan(0.8);
        expect(sim).toBeLessThan(0.9);
    });

    test('a lower minSimilarity reads the near name as CLOSE, a higher one as DIFFERENT', () => {
        expect(nameMatchLevel(NEAR_NAME, ON_FILE, 'PERSON', 0.8)).toBe('CLOSE');
        expect(nameMatchLevel(NEAR_NAME, ON_FILE, 'PERSON', 0.9)).toBe('DIFFERENT');
    });

    test('omitting minSimilarity is the same as passing NAME_SIMILARITY_MIN', () => {
        expect(nameMatchLevel(NEAR_NAME, ON_FILE, 'PERSON')).toBe(
            nameMatchLevel(NEAR_NAME, ON_FILE, 'PERSON', NAME_SIMILARITY_MIN),
        );
    });
});

describe('evaluate({ ..., thresholds })', () => {
    const reference = { applicantName: ON_FILE };

    test('thresholds.ocrConfidenceMin decides READABILITY', () => {
        const extraction = houseRegExtraction(ON_FILE, 70);
        const low = evaluate({ extraction, reference, slotId: HOUSE_REG, now: NOW, thresholds: { ocrConfidenceMin: 65 } });
        const high = evaluate({ extraction, reference, slotId: HOUSE_REG, now: NOW, thresholds: { ocrConfidenceMin: 75 } });
        expect(flagFor(low, 'READABILITY').result).toBe('PASS');
        expect(flagFor(high, 'READABILITY').result).toBe('UNREADABLE');
    });

    test('thresholds.nameSimilarityMin decides whether a near name is a CROSS_MATCH', () => {
        const extraction = houseRegExtraction(NEAR_NAME, 95);
        const loose = evaluate({ extraction, reference, slotId: HOUSE_REG, now: NOW, thresholds: { nameSimilarityMin: 0.8 } });
        const strict = evaluate({ extraction, reference, slotId: HOUSE_REG, now: NOW, thresholds: { nameSimilarityMin: 0.9 } });
        expect(flagFor(loose, 'CROSS_MATCH').result).toBe('MATCH');
        expect(flagFor(strict, 'CROSS_MATCH').result).not.toBe('MATCH');
    });

    test('omitting thresholds is the same as passing the two constants', () => {
        for (const [holder, confidence] of [
            [NEAR_NAME, 95],
            [ON_FILE, OCR_CONFIDENCE_MIN - 1],
            [ON_FILE, OCR_CONFIDENCE_MIN],
        ]) {
            const extraction = houseRegExtraction(holder, confidence);
            const omitted = evaluate({ extraction, reference, slotId: HOUSE_REG, now: NOW });
            const explicit = evaluate({
                extraction,
                reference,
                slotId: HOUSE_REG,
                now: NOW,
                thresholds: { ocrConfidenceMin: OCR_CONFIDENCE_MIN, nameSimilarityMin: NAME_SIMILARITY_MIN },
            });
            expect(omitted).toEqual(explicit);
        }
    });
});
