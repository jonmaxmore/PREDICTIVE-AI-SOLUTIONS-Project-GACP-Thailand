/**
 * After the cut, the planting record stops being the farmer's notebook and becomes
 * a claim that travels with produce. R11/R12 say so, and two of the three layers
 * enforce it: lots refuse edits once the QR is printed, harvest batches freeze
 * weights once packages exist. The cycle layer did not.
 *
 * `updateCycle` computed `isLocked` correctly — HARVESTED/COMPLETED, or any
 * harvest batch exists — and then copied five fields into the update ABOVE the
 * guard that uses it:
 *
 *     const metadataFields = ['notes','seedSource','varietyName','irrigationType','soilType'];
 *     for (const field of metadataFields) { if (data[field] !== undefined) … }
 *     if (!isLocked) { …everything else… }
 *
 * FOUR of those five are published to anyone holding a QR code, with no login:
 * resolve-generic.js:150,155,156,157 emit `variety`, `seedSource`, `soilType` and
 * `irrigationType`. So after the cut, after the label is printed, after the goods
 * are in the market, the cycle's owner could still rewrite the VARIETY and the
 * SEED SOURCE that the public scan asserts — silently, with no record. That is
 * precisely what traceability exists to prevent.
 *
 * `notes` stays editable and is the one field that should: it is never emitted
 * publicly, so it is the farmer's note to themselves, not a claim to a buyer. The
 * other four sat in that list with nothing distinguishing them.
 *
 * Refusing LOUDLY rather than dropping the keys, because the harvest layer already
 * learned that lesson in its own comment: "A farmer editing notes and a weight in
 * one request must not be told the whole edit succeeded when half of it was
 * discarded."
 */
'use strict';

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn(async ({ data }) => ({ id: 'cycle-1', ...data }));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        plantingCycle: {
            findUnique: (...a) => mockFindUnique(...a),
            update: (...a) => mockUpdate(...a),
        },
        plot: { findMany: jest.fn(async () => []) },
        $transaction: jest.fn(async (fn) => (typeof fn === 'function' ? fn({}) : fn)),
    },
}));

const plantingService = require('../../services/planting-service');

const frozen = (over = {}) => ({
    id: 'cycle-1', isDeleted: false, status: 'HARVESTED', farmId: 'farm-1',
    _count: { batches: 1 }, ...over,
});
const open = (over = {}) => ({
    id: 'cycle-1', isDeleted: false, status: 'GROWING', farmId: 'farm-1',
    _count: { batches: 0 }, ...over,
});

beforeEach(() => { jest.clearAllMocks(); });

describe('a cut cycle cannot rewrite what the public scan asserts', () => {
    for (const field of ['varietyName', 'seedSource', 'soilType', 'irrigationType']) {
        test(`${field} is refused once the cycle is frozen — it is on the public page`, async () => {
            mockFindUnique.mockResolvedValue(frozen());
            await expect(plantingService.updateCycle('cycle-1', { [field]: 'rewritten' }))
                .rejects.toMatchObject({ code: 'CYCLE_FROZEN' });
            // Refused, not quietly dropped: nothing was written at all.
            expect(mockUpdate).not.toHaveBeenCalled();
        });
    }

    test('the refusal NAMES the fields, so the farmer knows what was rejected', async () => {
        mockFindUnique.mockResolvedValue(frozen());
        await expect(plantingService.updateCycle('cycle-1', { varietyName: 'x', seedSource: 'y' }))
            .rejects.toMatchObject({ code: 'CYCLE_FROZEN', fields: expect.arrayContaining(['varietyName', 'seedSource']) });
    });

    test('a cycle frozen by HAVING BATCHES, not by status, is equally frozen', async () => {
        mockFindUnique.mockResolvedValue(frozen({ status: 'GROWING', _count: { batches: 2 } }));
        await expect(plantingService.updateCycle('cycle-1', { varietyName: 'x' }))
            .rejects.toMatchObject({ code: 'CYCLE_FROZEN' });
    });
});

describe('what stays editable, and why', () => {
    test('notes survive the freeze — never emitted publicly, so not a claim to a buyer', async () => {
        mockFindUnique.mockResolvedValue(frozen());
        await plantingService.updateCycle('cycle-1', { notes: 'เก็บเกี่ยวเสร็จ ตากไว้โรงเรือน 2' });
        expect(mockUpdate).toHaveBeenCalled();
        expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ notes: 'เก็บเกี่ยวเสร็จ ตากไว้โรงเรือน 2' });
    });

    test('notes alongside a frozen field is still refused as a whole', async () => {
        // Half-applying an edit and reporting success is the failure the harvest
        // layer's own comment warns about.
        mockFindUnique.mockResolvedValue(frozen());
        await expect(plantingService.updateCycle('cycle-1', { notes: 'ok', varietyName: 'x' }))
            .rejects.toMatchObject({ code: 'CYCLE_FROZEN' });
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('before the cut every one of them is still editable', async () => {
        mockFindUnique.mockResolvedValue(open());
        await plantingService.updateCycle('cycle-1', {
            varietyName: 'หางกระรอก', seedSource: 'เมล็ดรับรอง', soilType: 'ร่วนปนทราย',
            irrigationType: 'น้ำหยด', notes: 'บันทึก',
        });
        expect(mockUpdate).toHaveBeenCalled();
        expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ varietyName: 'หางกระรอก', seedSource: 'เมล็ดรับรอง' });
    });
});
