/**
 * W1-3 (batch/lot identifier SSOT) — apps/backend/shared/harvest-identifiers.js
 * is now the single canonical generator for HarvestBatch.batchNumber and
 * Lot.lotNumber, replacing the competing/duplicated implementations that
 * previously lived in certificate-service.js, harvest-service.js,
 * traceability-service.js and planting-cycle-service.js.
 *
 * Required cases (operator W1-3):
 *   - a newly minted batch number carries the new prefix and NEVER "LOT-".
 *   - two batches minted sequentially against the same sequence never collide.
 *   - buildLotNumber's existing A..Z / -NN suffix behaviour is unchanged
 *     (still consumed live by traceability-service.createLotWithQuotaCheck and
 *     planting-cycle harvest-capacity-operations — see their own suites).
 *
 * Fix round 1 (review finding on a1c0bad7): every minted year must be
 * Buddhist Era (BE = Gregorian + 543), matching certificate numbers
 * (GACP-TH-2569-...) and every batch row already in the DB (LOT-2569-...).
 * The first cut used the Gregorian year — `thaiYear()` is the fix, and it is
 * pinned here against a mocked system date.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { thaiYear, buildBatchNumber, buildLotNumber } = require('../../shared/harvest-identifiers');

describe('harvest-identifiers SSOT — thaiYear', () => {
    afterEach(() => jest.useRealTimers());

    it('converts a Gregorian year to Buddhist Era (+543)', () => {
        // The year is the Bangkok year of the instant (operator 2026-09-26,
        // "เวลาไทยทั้งหมด"), so the fixtures are instants, not process-local
        // components: noon on 31 Dec in Los Angeles is already 1 Jan in Bangkok.
        expect(thaiYear(new Date('2026-01-15T05:00:00.000Z'))).toBe(2569); // 12:00 BKK
        expect(thaiYear(new Date('2025-12-31T05:00:00.000Z'))).toBe(2568); // 12:00 BKK, 31 Dec
    });

    it('turns the year at 00:00 in Bangkok, not at the process clock\'s midnight', () => {
        expect(thaiYear(new Date('2025-12-31T16:59:59.999Z'))).toBe(2568); // 23:59:59.999 BKK
        expect(thaiYear(new Date('2025-12-31T17:00:00.000Z'))).toBe(2569); // 00:00 BKK, 1 Jan
    });

    it('defaults to the current system date when no date is given', () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-01T00:00:00Z'));
        expect(thaiYear()).toBe(2569);
    });
});

describe('harvest-identifiers SSOT — buildBatchNumber', () => {
    afterEach(() => jest.useRealTimers());

    it('mints a BATCH- prefixed number, never LOT-', async () => {
        let seq = 0;
        const client = { $queryRaw: jest.fn(async () => { seq += 1; return [{ seq }]; }) };
        const batchNumber = await buildBatchNumber(client);
        expect(batchNumber).toMatch(/^BATCH-\d{4}-\d{6}$/);
        expect(batchNumber).not.toMatch(/^LOT-/);
    });

    it('mints the BE year, not the Gregorian year (fix round 1 pin)', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-10T00:00:00Z'));
        const client = { $queryRaw: jest.fn(async () => [{ seq: 1 }]) };
        const batchNumber = await buildBatchNumber(client);
        expect(batchNumber).toBe('BATCH-2569-000001');
        expect(batchNumber).not.toMatch(/^BATCH-2026-/);
    });

    it('two batches minted sequentially against the same sequence never collide', async () => {
        let seq = 0;
        const client = { $queryRaw: jest.fn(async () => { seq += 1; return [{ seq }]; }) };
        const first = await buildBatchNumber(client);
        const second = await buildBatchNumber(client);
        expect(first).not.toBe(second);
        expect(client.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('falls back to a collision-resistant timestamp+random suffix when the sequence is unavailable (still BATCH-, BE year, never LOT-)', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-10T00:00:00Z'));
        const client = { $queryRaw: jest.fn(async () => { throw new Error('sequence not migrated yet'); }) };
        const batchNumber = await buildBatchNumber(client);
        expect(batchNumber).toMatch(/^BATCH-2569-[0-9A-Z]+-[0-9A-Z]+$/);
        expect(batchNumber).not.toMatch(/^LOT-/);
        expect(batchNumber).not.toMatch(/^BATCH-2026-/);
    });
});

describe('harvest-identifiers SSOT — buildLotNumber (unchanged behaviour)', () => {
    it('derives an A..Z suffix for the first 26 packaging lots of a batch', () => {
        expect(buildLotNumber('BATCH-2569-000123', 0)).toBe('LOT-2569-000123-A');
        expect(buildLotNumber('BATCH-2569-000123', 25)).toBe('LOT-2569-000123-Z');
    });

    it('derives a numeric suffix past the 26th packaging lot (never the "[" charCode overflow)', () => {
        const twentySeventh = buildLotNumber('BATCH-2569-000123', 26);
        expect(twentySeventh).toMatch(/^LOT-2569-000123-\d{2}$/);
        expect(twentySeventh).not.toMatch(/\[/);
    });

    it('is guarded against a null/undefined batchNumber', () => {
        expect(() => buildLotNumber(null, 0)).not.toThrow();
    });

    it('never computes its own year — it only re-derives whatever year is already in batchNumber (BE-consistent by construction)', () => {
        // A Gregorian-looking input is passed through unchanged apart from the
        // BATCH->LOT prefix swap - proving buildLotNumber has no year logic of
        // its own that could drift out of sync with buildBatchNumber's BE fix.
        expect(buildLotNumber('BATCH-2026-000001', 0)).toBe('LOT-2026-000001-A');
    });
});

// Operator guard: a static regression check so no future generator can ever
// re-introduce a "LOT-" prefixed HarvestBatch.batchNumber (the exact bug this
// work item fixed — twice, in certificate-service.js and harvest-service.js).
// This must catch a hardcoded `batchNumber = \`LOT-...\`` literal ANYWHERE
// under services/, routes/ or shared/, not just in the two known files, so a
// brand-new offender elsewhere is caught the same way.
function mintsLotPrefixedBatchNumber(sourceText) {
    // e.g. `batchNumber = \`LOT-${year}...\`` or `batchNumber: 'LOT-...'`
    return /batchNumber\s*[:=][^\n]{0,80}?['"`]LOT-/.test(sourceText);
}

function listJsFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') { continue; }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            listJsFiles(full, out);
        } else if (entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

describe('W1-3 guard — batchNumber can never be minted with a "LOT-" prefix again', () => {
    it('sanity check: the guard actually detects the historical bug shape', () => {
        expect(mintsLotPrefixedBatchNumber(
            'const batchNumber = `LOT-${year}-${farm.id.substring(0, 4).toUpperCase()}-001`;',
        )).toBe(true);
        expect(mintsLotPrefixedBatchNumber(
            'const batchNumber = `LOT-${farmId.substring(0, 8).toUpperCase()}-${year}-${String(count + 1).padStart(3, "0")}`;',
        )).toBe(true);
        expect(mintsLotPrefixedBatchNumber(
            'const batchNumber = await buildBatchNumber(client);',
        )).toBe(false);
    });

    it('no source file under services/, routes/, or shared/ mints a LOT-prefixed batchNumber', () => {
        const backendRoot = path.join(__dirname, '..', '..');
        const scanRoots = ['services', 'routes', 'shared'].map((d) => path.join(backendRoot, d));

        const offenders = [];
        for (const root of scanRoots) {
            for (const file of listJsFiles(root)) {
                const src = fs.readFileSync(file, 'utf8');
                if (mintsLotPrefixedBatchNumber(src)) {
                    offenders.push(path.relative(backendRoot, file));
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
