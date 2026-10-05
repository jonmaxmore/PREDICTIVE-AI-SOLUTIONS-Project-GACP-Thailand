'use strict';

/**
 * Herb Knowledge Service — สัญญา C05F680149 ต้นแบบที่ 5
 * "ฐานข้อมูลสมุนไพรไทย 6 ฐานข้อมูล" (KPI A7: ≥300 รายการ/ฐาน + API).
 *
 * Global reference master data (mirrors admin/plants.js over PlantSpecies):
 * HerbSpecies + HerbKnowledgeEntry have NO organizationId — องค์ความรู้สมุนไพร
 * ใช้ร่วมทุก tenant, อ่านผ่าน public API, เขียนเฉพาะ ADMIN. Errors carry
 * .statusCode/.code at the throw site (sendServiceError-safe).
 *
 * Content (≥1,800 records) = งานทีมวิจัย SSRU ผ่าน bulkImportEntries — validate
 * ราย row + best-effort load (bad row ไม่ทำให้ทั้ง batch ล้ม). herbCode เป็น
 * scalar FK (referenced field @unique) — เขียนตรง ไม่ผ่าน nested connect.
 */

const { z } = require('zod');
const { prisma } = require('./prisma-database');
const logger = require('../shared/logger');

const CATEGORIES = Object.freeze([
    'VARIETY', 'ACTIVE_COMPOUND', 'CULTIVATION', 'HARVEST',
    'PROCESSING', 'DISEASE', 'LEGAL', 'GENERAL',
]);

const KPI_TARGET_PER_HERB = 300;
const MAX_PAGE_SIZE = 200;
const MAX_IMPORT_ROWS = 2000; // cap one bulk-import request (unbounded createMany guard)

function httpError(statusCode, code, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

const MAX_CONTENT_LEN = 20000; // อัปเปอร์บาวด์ต่อ 1 record ความรู้ (กัน blob โต)

const entrySchema = z.object({
    category: z.enum(CATEGORIES),
    title: z.string().trim().min(1).max(500),
    content: z.string().trim().min(1).max(MAX_CONTENT_LEN),
    valueNumber: z.union([z.number(), z.null()]).optional(),
    unit: z.string().trim().max(50).optional(),
    source: z.string().trim().max(500).optional(),
    sortOrder: z.number().int().optional(),
});

// PATCH = partial ของ entry (omit category ไป handle เอง เพราะต้อง normalize เป็น
// upper-case ก่อน enum-check) + isActive ที่ create ไม่มีแต่ update ใช้.
const entryPatchSchema = entrySchema.omit({ category: true }).partial().extend({
    isActive: z.boolean().optional(),
});

function normalizeCode(code) {
    return String(code || '').trim().toUpperCase();
}

async function _getSpeciesOr404(code) {
    const normalized = normalizeCode(code);
    const species = await prisma.herbSpecies.findUnique({ where: { code: normalized } });
    if (!species) {
        throw httpError(404, 'HERB_NOT_FOUND', `Unknown herb species: ${normalized}`);
    }
    return species;
}

async function listSpecies({ activeOnly = false } = {}) {
    const species = await prisma.herbSpecies.findMany({
        where: activeOnly ? { isActive: true } : {},
        include: { _count: { select: { entries: true } } },
        orderBy: { sortOrder: 'asc' },
    });
    return species.map(({ _count, ...rest }) => ({ ...rest, entryCount: _count?.entries ?? 0 }));
}

async function getSpecies(code) {
    const normalized = normalizeCode(code);
    const species = await prisma.herbSpecies.findUnique({
        where: { code: normalized },
        include: { _count: { select: { entries: true } } },
    });
    if (!species) {
        throw httpError(404, 'HERB_NOT_FOUND', `Unknown herb species: ${normalized}`);
    }
    const { _count, ...rest } = species;
    return { ...rest, entryCount: _count?.entries ?? 0 };
}

async function listEntries(code, { category, page = 1, pageSize = 50 } = {}) {
    const species = await _getSpeciesOr404(code);

    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(pageSize) ? Math.floor(pageSize) : 50));
    const where = {
        herbCode: species.code,
        isActive: true,
        ...(category ? { category: normalizeCode(category) } : {}),
    };

    const [entries, total] = await Promise.all([
        prisma.herbKnowledgeEntry.findMany({
            where,
            orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
            skip: (safePage - 1) * safeSize,
            take: safeSize,
        }),
        prisma.herbKnowledgeEntry.count({ where }),
    ]);

    return { herbCode: species.code, page: safePage, pageSize: safeSize, total, entries };
}

function _validateEntry(payload) {
    const parsed = entrySchema.safeParse(payload);
    if (!parsed.success) {
        return { ok: false, error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
    }
    const data = parsed.data;
    return {
        ok: true,
        value: {
            category: data.category,
            title: data.title,
            content: data.content,
            valueNumber: data.valueNumber ?? null,
            unit: data.unit || null,
            source: data.source || null,
            sortOrder: data.sortOrder ?? 0,
        },
    };
}

async function createEntry(code, payload, { actor } = {}) {
    const species = await _getSpeciesOr404(code);
    const check = _validateEntry(payload);
    if (!check.ok) {
        throw httpError(400, 'HERB_ENTRY_INVALID', `Invalid herb entry: ${check.error}`);
    }
    const entry = await prisma.herbKnowledgeEntry.create({
        data: { herbCode: species.code, ...check.value }, // scalar FK, no nested connect
    });
    logger.info(`[Herb] entry created: ${entry.id} (${species.code}/${check.value.category}) by ${actor?.id || '?'}`);
    return entry;
}

async function updateEntry(id, payload) {
    // Partial update: category ผ่าน normalize+enum-check; ที่เหลือ validate ชนิด/
    // ความยาว ด้วย partial schema เดียวกับ create (กัน client-input → 500 และ
    // กัน blank-content bypass min-length).
    const patch = {};
    if (payload.category !== undefined) {
        if (!CATEGORIES.includes(normalizeCode(payload.category))) {
            throw httpError(400, 'HERB_ENTRY_INVALID', 'Invalid category');
        }
        patch.category = normalizeCode(payload.category);
    }
    const parsed = entryPatchSchema.safeParse(payload);
    if (!parsed.success) {
        const detail = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw httpError(400, 'HERB_ENTRY_INVALID', `Invalid herb entry patch: ${detail}`);
    }
    const d = parsed.data;
    for (const key of ['title', 'content', 'unit', 'source']) {
        if (d[key] !== undefined) { patch[key] = d[key]; }
    }
    if (d.valueNumber !== undefined) { patch.valueNumber = d.valueNumber; }
    if (d.sortOrder !== undefined) { patch.sortOrder = d.sortOrder; }
    if (d.isActive !== undefined) { patch.isActive = d.isActive; }

    try {
        return await prisma.herbKnowledgeEntry.update({ where: { id }, data: patch });
    } catch (error) {
        if (error.code === 'P2025') {
            throw httpError(404, 'HERB_ENTRY_NOT_FOUND', 'Herb entry not found');
        }
        throw error;
    }
}

async function deleteEntry(id) {
    try {
        await prisma.herbKnowledgeEntry.delete({ where: { id } });
        return { id };
    } catch (error) {
        if (error.code === 'P2025') {
            throw httpError(404, 'HERB_ENTRY_NOT_FOUND', 'Herb entry not found');
        }
        throw error;
    }
}

/**
 * Best-effort bulk load for SSRU content: validate every row, import the valid
 * ones in one createMany, and report the rejects — a single malformed row must
 * never fail the whole upload.
 */
async function bulkImportEntries(code, rows, { actor } = {}) {
    const species = await _getSpeciesOr404(code);
    const list = Array.isArray(rows) ? rows : [];

    if (list.length > MAX_IMPORT_ROWS) {
        throw httpError(400, 'HERB_IMPORT_TOO_LARGE',
            `Too many rows (${list.length}); import at most ${MAX_IMPORT_ROWS} per request`);
    }

    const valid = [];
    const errors = [];
    list.forEach((row, index) => {
        const check = _validateEntry(row);
        if (check.ok) {
            valid.push({ herbCode: species.code, ...check.value });
        } else {
            errors.push({ row: index + 1, error: check.error });
        }
    });

    if (valid.length > 0) {
        await prisma.herbKnowledgeEntry.createMany({ data: valid });
    }
    logger.info(`[Herb] bulk import ${species.code}: ${valid.length} imported / ${errors.length} skipped by ${actor?.id || '?'}`);

    return { herbCode: species.code, imported: valid.length, skipped: errors.length, errors };
}

/** KPI A7 coverage: entry count per herb vs the ≥300 target. */
async function getCoverageStats() {
    const [species, grouped] = await Promise.all([
        prisma.herbSpecies.findMany({ orderBy: { sortOrder: 'asc' } }),
        prisma.herbKnowledgeEntry.groupBy({ by: ['herbCode'], _count: { _all: true } }),
    ]);
    const countByCode = new Map(grouped.map(g => [g.herbCode, g._count?._all ?? 0]));

    const herbs = species.map((s) => {
        const count = countByCode.get(s.code) ?? 0;
        return { code: s.code, nameTH: s.nameTH, count, meets300: count >= KPI_TARGET_PER_HERB };
    });

    return {
        target: KPI_TARGET_PER_HERB,
        totalHerbs: herbs.length,
        herbsMeetingTarget: herbs.filter(h => h.meets300).length,
        totalEntries: herbs.reduce((acc, h) => acc + h.count, 0),
        herbs,
    };
}

module.exports = {
    CATEGORIES,
    KPI_TARGET_PER_HERB,
    listSpecies,
    getSpecies,
    listEntries,
    createEntry,
    updateEntry,
    deleteEntry,
    bulkImportEntries,
    getCoverageStats,
};
