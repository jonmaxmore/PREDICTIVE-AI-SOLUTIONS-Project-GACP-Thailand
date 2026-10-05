/**
 * Task 9 (document pre-check): the accuracy ratchet. Runs the real pipeline
 * — `extractDocument` (text layer / pdf.js raster / bundled tessdata_fast OCR)
 * then `evaluate` at the shipped constants — over the committed synthetic
 * corpus, scores it against the human-set truth in labels.json, and fails if
 * any metric falls below its floor in thresholds.json.
 *
 * No database: this sits in __tests__/integration because it runs the whole
 * extraction pipeline (forked pdf worker, OCR worker) end to end, like the
 * other DB-less suites in this folder. It never skips.
 *
 * Floors are the achieved numbers (the project rules ratchet row): raising one is
 * normal; lowering one is the operator's call, with a log entry.
 *
 * @see apps/backend/scripts/document-precheck/accuracy-report.js
 * @see apps/backend/__tests__/fixtures/document-precheck/labels.json
 * @see apps/backend/__tests__/fixtures/document-precheck/thresholds.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
    runAccuracy,
    compareToFloors,
    loadLabels,
    loadFloors,
    CORPUS_DIR,
    CHECKS,
    formatReport,
} = require('../../scripts/document-precheck/accuracy-report');

const MIN_VARIANTS_PER_TYPE = 6;
const SEVEN_SLOTS = ['land_deed', 'land_lease', 'land_consent', 'company_reg', 'id_card', 'house_reg', 'previous_cert'];

let report;

beforeAll(async () => {
    report = await runAccuracy();
}, 120000); // measured 37-57 s; a hung extraction must not stall the gate for minutes

describe('corpus', () => {
    test('every labelled file exists and every corpus file is labelled', () => {
        const labelled = loadLabels().files.map((f) => f.file).sort();
        const onDisk = fs.readdirSync(CORPUS_DIR).sort();
        expect(onDisk).toEqual(labelled);
    });

    test(`each of the 7 types has at least ${MIN_VARIANTS_PER_TYPE} variants`, () => {
        const counts = {};
        for (const f of loadLabels().files) {counts[f.slotId] = (counts[f.slotId] || 0) + 1;}
        expect(Object.keys(counts).sort()).toEqual([...SEVEN_SLOTS].sort());
        for (const slot of SEVEN_SLOTS) {expect(counts[slot]).toBeGreaterThanOrEqual(MIN_VARIANTS_PER_TYPE);}
    });

    test('the rule layer produced exactly the flags the labels expect (no missing, no extra)', () => {
        expect(report.presenceErrors).toEqual([]);
    });
});

describe('floors (thresholds.json)', () => {
    test('thresholds.json has a floor for every check and the overall pool', () => {
        const floors = loadFloors();
        for (const check of CHECKS) {
            expect(typeof floors.checks[check].precisionMin).toBe('number');
            expect(typeof floors.checks[check].recallMin).toBe('number');
        }
        expect(typeof floors.overall.precisionMin).toBe('number');
        expect(typeof floors.overall.recallMin).toBe('number');
        expect(typeof floors.unreadableRateMax).toBe('number');
    });

    test('no metric is below its floor (or above its ceiling)', () => {
        expect(compareToFloors(report.metrics, loadFloors())).toEqual([]);
    });
});

// Printed here, not in beforeAll: jest.setup.js mocks console.log while tests
// run and restores it for afterAll, so this is where the table reaches the log.
afterAll(() => {
    if (report) {
        console.log(`${formatReport(report)}\n\nfloor breaches: ${JSON.stringify(compareToFloors(report.metrics, loadFloors()))}`);
    }
});

// Guard: the corpus directory this suite reads is the committed one.
test('reads the committed corpus directory', () => {
    expect(path.relative(path.join(__dirname, '..'), CORPUS_DIR)).toBe(path.join('fixtures', 'document-precheck', 'corpus'));
});
