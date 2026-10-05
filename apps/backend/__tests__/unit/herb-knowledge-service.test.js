'use strict';

/**
 * Herb Knowledge Service — สัญญา C05F680149 ต้นแบบที่ 5
 * "ฐานข้อมูลสมุนไพรไทย 6 ฐานข้อมูล" (KPI: ≥300 รายการ/ฐาน + API).
 *
 * Contract under test:
 *   - Global reference master data (no tenant scope): 6 HerbSpecies + N
 *     HerbKnowledgeEntry each keyed by herbCode.
 *   - listSpecies returns species with entry counts; getSpecies 404s unknown.
 *   - createEntry validates category/title/content + species existence;
 *     bulkImportEntries validates each row, returns imported/skipped/errors and
 *     NEVER throws on a single bad row (best-effort load for SSRU content).
 *   - getCoverageStats reports per-herb count + meets300 (KPI A7).
 *   - Errors carry .statusCode/.code at the throw site.
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockSpeciesFindMany = jest.fn();
const mockSpeciesFindUnique = jest.fn();
const mockEntryFindMany = jest.fn();
const mockEntryCount = jest.fn();
const mockEntryCreate = jest.fn();
const mockEntryUpdate = jest.fn();
const mockEntryDelete = jest.fn();
const mockEntryCreateMany = jest.fn();
const mockGroupBy = jest.fn();

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        herbSpecies: {
            findMany: (...a) => mockSpeciesFindMany(...a),
            findUnique: (...a) => mockSpeciesFindUnique(...a),
        },
        herbKnowledgeEntry: {
            findMany: (...a) => mockEntryFindMany(...a),
            count: (...a) => mockEntryCount(...a),
            create: (...a) => mockEntryCreate(...a),
            update: (...a) => mockEntryUpdate(...a),
            delete: (...a) => mockEntryDelete(...a),
            createMany: (...a) => mockEntryCreateMany(...a),
            groupBy: (...a) => mockGroupBy(...a),
        },
    },
}));

const herbService = require('../../services/herb-knowledge-service');

const ACTOR = { id: 'admin-uuid' };

beforeEach(() => {
    jest.clearAllMocks();
});

describe('herb-knowledge-service.listSpecies / getSpecies', () => {
    test('listSpecies returns species with entryCount', async () => {
        mockSpeciesFindMany.mockResolvedValue([
            { id: 's1', code: 'CANNABIS', nameTH: 'กัญชา', isActive: true, _count: { entries: 312 } },
            { id: 's2', code: 'TURMERIC', nameTH: 'ขมิ้นชัน', isActive: true, _count: { entries: 40 } },
        ]);
        const species = await herbService.listSpecies();
        expect(species).toHaveLength(2);
        expect(species[0].entryCount).toBe(312);
        expect(species[1].entryCount).toBe(40);
    });

    test('getSpecies unknown code → 404 HERB_NOT_FOUND', async () => {
        mockSpeciesFindUnique.mockResolvedValue(null);
        await expect(herbService.getSpecies('NOPE'))
            .rejects.toMatchObject({ statusCode: 404, code: 'HERB_NOT_FOUND' });
    });

    test('getSpecies normalizes code to upper-case', async () => {
        mockSpeciesFindUnique.mockResolvedValue({ id: 's1', code: 'CANNABIS', nameTH: 'กัญชา' });
        await herbService.getSpecies('cannabis');
        expect(mockSpeciesFindUnique).toHaveBeenCalledWith(expect.objectContaining({
            where: { code: 'CANNABIS' },
        }));
    });
});

describe('herb-knowledge-service.listEntries (paginated)', () => {
    test('returns page slice + total; filters by category when given', async () => {
        mockSpeciesFindUnique.mockResolvedValue({ id: 's1', code: 'CANNABIS' });
        mockEntryFindMany.mockResolvedValue([{ id: 'e1', category: 'VARIETY', title: 'พันธุ์ก' }]);
        mockEntryCount.mockResolvedValue(1);

        const result = await herbService.listEntries('CANNABIS', { category: 'VARIETY', page: 1, pageSize: 20 });
        expect(result.total).toBe(1);
        expect(result.entries).toHaveLength(1);
        expect(mockEntryFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ herbCode: 'CANNABIS', category: 'VARIETY', isActive: true }),
            skip: 0,
            take: 20,
        }));
    });

    test('page/pageSize are clamped to sane bounds', async () => {
        mockSpeciesFindUnique.mockResolvedValue({ id: 's1', code: 'CANNABIS' });
        mockEntryFindMany.mockResolvedValue([]);
        mockEntryCount.mockResolvedValue(0);
        await herbService.listEntries('CANNABIS', { page: 0, pageSize: 100000 });
        const call = mockEntryFindMany.mock.calls[0][0];
        expect(call.skip).toBe(0);
        expect(call.take).toBeLessThanOrEqual(200);
    });

    test('unknown species → 404', async () => {
        mockSpeciesFindUnique.mockResolvedValue(null);
        await expect(herbService.listEntries('NOPE', {}))
            .rejects.toMatchObject({ statusCode: 404, code: 'HERB_NOT_FOUND' });
    });
});

describe('herb-knowledge-service.createEntry', () => {
    test('valid entry → created; herbCode scalar FK set, not nested connect', async () => {
        mockSpeciesFindUnique.mockResolvedValue({ id: 's1', code: 'CANNABIS' });
        mockEntryCreate.mockImplementation(async ({ data }) => ({ id: 'e1', ...data }));

        const entry = await herbService.createEntry('cannabis', {
            category: 'ACTIVE_COMPOUND', title: 'ปริมาณ CBD', content: 'สายพันธุ์ CBD สูง',
            valueNumber: 15.2, unit: '%', source: 'DTAM 2569',
        }, { actor: ACTOR });

        expect(entry.id).toBe('e1');
        const data = mockEntryCreate.mock.calls[0][0].data;
        expect(data.herbCode).toBe('CANNABIS'); // scalar FK
        expect(data).not.toHaveProperty('species'); // no nested connect
        expect(data.valueNumber).toBe(15.2);
    });

    test('missing title/content → 400 HERB_ENTRY_INVALID', async () => {
        mockSpeciesFindUnique.mockResolvedValue({ id: 's1', code: 'CANNABIS' });
        await expect(herbService.createEntry('CANNABIS', { category: 'VARIETY', title: '' }, { actor: ACTOR }))
            .rejects.toMatchObject({ statusCode: 400, code: 'HERB_ENTRY_INVALID' });
    });

    test('invalid category → 400 HERB_ENTRY_INVALID', async () => {
        mockSpeciesFindUnique.mockResolvedValue({ id: 's1', code: 'CANNABIS' });
        await expect(herbService.createEntry('CANNABIS', { category: 'BOGUS', title: 't', content: 'c' }, { actor: ACTOR }))
            .rejects.toMatchObject({ statusCode: 400, code: 'HERB_ENTRY_INVALID' });
    });

    test('unknown species → 404', async () => {
        mockSpeciesFindUnique.mockResolvedValue(null);
        await expect(herbService.createEntry('NOPE', { category: 'VARIETY', title: 't', content: 'c' }, { actor: ACTOR }))
            .rejects.toMatchObject({ statusCode: 404, code: 'HERB_NOT_FOUND' });
    });
});

describe('herb-knowledge-service.bulkImportEntries (SSRU content load)', () => {
    test('valid rows imported; bad rows skipped with per-row errors; never throws', async () => {
        mockSpeciesFindUnique.mockResolvedValue({ id: 's1', code: 'TURMERIC' });
        mockEntryCreateMany.mockResolvedValue({ count: 2 });

        const result = await herbService.bulkImportEntries('TURMERIC', [
            { category: 'ACTIVE_COMPOUND', title: 'Curcumin', content: 'สารเคอร์คูมิน', valueNumber: 3.1, unit: '%' },
            { category: 'HARVEST', title: 'อายุเก็บเกี่ยว', content: '9-10 เดือน' },
            { category: 'BOGUS', title: 'ผิดหมวด', content: 'x' }, // invalid category
            { category: 'VARIETY', title: '', content: 'ไม่มีหัวข้อ' }, // missing title
        ], { actor: ACTOR });

        expect(result.imported).toBe(2);
        expect(result.skipped).toBe(2);
        expect(result.errors).toHaveLength(2);
        // createMany called with only the 2 valid rows, herbCode stamped
        const created = mockEntryCreateMany.mock.calls[0][0].data;
        expect(created).toHaveLength(2);
        expect(created.every(r => r.herbCode === 'TURMERIC')).toBe(true);
    });

    test('all rows invalid → imported 0, createMany NOT called', async () => {
        mockSpeciesFindUnique.mockResolvedValue({ id: 's1', code: 'GINGER' });
        const result = await herbService.bulkImportEntries('GINGER', [
            { category: 'BOGUS', title: 'x', content: 'y' },
        ], { actor: ACTOR });
        expect(result.imported).toBe(0);
        expect(mockEntryCreateMany).not.toHaveBeenCalled();
    });

    test('unknown species → 404 (before touching rows)', async () => {
        mockSpeciesFindUnique.mockResolvedValue(null);
        await expect(herbService.bulkImportEntries('NOPE', [], { actor: ACTOR }))
            .rejects.toMatchObject({ statusCode: 404, code: 'HERB_NOT_FOUND' });
    });

    test('over the row cap → 400 HERB_IMPORT_TOO_LARGE (no createMany)', async () => {
        mockSpeciesFindUnique.mockResolvedValue({ id: 's1', code: 'CANNABIS' });
        const tooMany = Array.from({ length: 2001 }, () => ({ category: 'VARIETY', title: 't', content: 'c' }));
        await expect(herbService.bulkImportEntries('CANNABIS', tooMany, { actor: ACTOR }))
            .rejects.toMatchObject({ statusCode: 400, code: 'HERB_IMPORT_TOO_LARGE' });
        expect(mockEntryCreateMany).not.toHaveBeenCalled();
    });
});

describe('herb-knowledge-service.updateEntry (partial patch validation)', () => {
    test('valid partial patch → prisma.update called with sanitized patch', async () => {
        mockEntryUpdate.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
        const out = await herbService.updateEntry('e1', { content: 'เนื้อหาใหม่', sortOrder: 3 });
        expect(out.id).toBe('e1');
        const call = mockEntryUpdate.mock.calls[0][0];
        expect(call.data).toEqual({ content: 'เนื้อหาใหม่', sortOrder: 3 });
    });

    test('mistyped title (number) → 400 HERB_ENTRY_INVALID, prisma.update NOT called', async () => {
        await expect(herbService.updateEntry('e1', { title: 123 }))
            .rejects.toMatchObject({ statusCode: 400, code: 'HERB_ENTRY_INVALID' });
        expect(mockEntryUpdate).not.toHaveBeenCalled();
    });

    test('mistyped valueNumber (string) → 400, not a 500 pass-through', async () => {
        await expect(herbService.updateEntry('e1', { valueNumber: 'x' }))
            .rejects.toMatchObject({ statusCode: 400, code: 'HERB_ENTRY_INVALID' });
        expect(mockEntryUpdate).not.toHaveBeenCalled();
    });

    test('blank content bypass blocked → 400 (min-length enforced on patch)', async () => {
        await expect(herbService.updateEntry('e1', { content: '' }))
            .rejects.toMatchObject({ statusCode: 400, code: 'HERB_ENTRY_INVALID' });
        expect(mockEntryUpdate).not.toHaveBeenCalled();
    });

    test('mistyped isActive (string) → 400', async () => {
        await expect(herbService.updateEntry('e1', { isActive: 'yes' }))
            .rejects.toMatchObject({ statusCode: 400, code: 'HERB_ENTRY_INVALID' });
        expect(mockEntryUpdate).not.toHaveBeenCalled();
    });

    test('valid isActive toggle passes through', async () => {
        mockEntryUpdate.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
        await herbService.updateEntry('e1', { isActive: false });
        expect(mockEntryUpdate.mock.calls[0][0].data).toEqual({ isActive: false });
    });

    test('invalid category → 400 (unchanged)', async () => {
        await expect(herbService.updateEntry('e1', { category: 'BOGUS' }))
            .rejects.toMatchObject({ statusCode: 400, code: 'HERB_ENTRY_INVALID' });
    });

    test('P2025 on update → 404 HERB_ENTRY_NOT_FOUND', async () => {
        mockEntryUpdate.mockRejectedValue(Object.assign(new Error('nf'), { code: 'P2025' }));
        await expect(herbService.updateEntry('missing', { content: 'x' }))
            .rejects.toMatchObject({ statusCode: 404, code: 'HERB_ENTRY_NOT_FOUND' });
    });

    test('over-long content → 400 (upper bound)', async () => {
        await expect(herbService.updateEntry('e1', { content: 'ก'.repeat(20001) }))
            .rejects.toMatchObject({ statusCode: 400, code: 'HERB_ENTRY_INVALID' });
    });
});

describe('herb-knowledge-service.getCoverageStats (KPI A7 ≥300/herb)', () => {
    test('per-herb count + meets300 + overall summary', async () => {
        mockSpeciesFindMany.mockResolvedValue([
            { code: 'CANNABIS', nameTH: 'กัญชา', sortOrder: 1 },
            { code: 'TURMERIC', nameTH: 'ขมิ้นชัน', sortOrder: 2 },
            { code: 'KRATOM', nameTH: 'กระท่อม', sortOrder: 6 },
        ]);
        mockGroupBy.mockResolvedValue([
            { herbCode: 'CANNABIS', _count: { _all: 305 } },
            { herbCode: 'TURMERIC', _count: { _all: 120 } },
            // KRATOM absent from groupBy → 0
        ]);

        const stats = await herbService.getCoverageStats();
        const byCode = Object.fromEntries(stats.herbs.map(h => [h.code, h]));
        expect(byCode.CANNABIS.count).toBe(305);
        expect(byCode.CANNABIS.meets300).toBe(true);
        expect(byCode.TURMERIC.count).toBe(120);
        expect(byCode.TURMERIC.meets300).toBe(false);
        expect(byCode.KRATOM.count).toBe(0);
        expect(byCode.KRATOM.meets300).toBe(false);
        expect(stats.target).toBe(300);
        expect(stats.herbsMeetingTarget).toBe(1);
        expect(stats.totalHerbs).toBe(3);
    });
});
