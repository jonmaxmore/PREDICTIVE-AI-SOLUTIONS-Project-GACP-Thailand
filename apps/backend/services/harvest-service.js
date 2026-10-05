const { prisma } = require('./prisma-database');
const { AREA_UNIT } = require('../shared/area-utils');
const { submittedAreaSqm } = require('./certificate/submitted-area');
// W1-3 (batch/lot identifier SSOT): single canonical batch-number generator.
const { buildBatchNumber } = require('../shared/harvest-identifiers');

// Mass-assignment guard for updateBatch — an ALLOWLIST of what a farmer may edit.
//
// PUT /harvest-batches/:id verifies ownership only on the EXISTING row, then hands
// req.body to updateBatch. It used to spread the body into prisma.update minus a
// denylist of identity / parent-FK / tenant / unique / audit / relation keys. A
// denylist only covers what somebody remembered: it missed `labResults`, so a
// nested write ({labResults:{updateMany:{data:{verificationStatus:'OFFICER_VERIFIED'}}}})
// forged officer verification and dropped the "attached by the farmer, not yet
// checked by an officer" caveat from the public scan, `deleteMany` erased COA
// history the model says must survive, and `create` published a file that never
// passed the upload guard. It also let the farmer write the officer's QC verdict
// (qcPassed / qcBy / qcNotes) and any status string (audit 2026-09-17, BACK-02).
//
// So: only these fields, only as plain values (an object is a nested write or a
// Prisma atomic op), and status from a closed set. Anything else is refused with
// 400 and nothing is written. COA files arrive through POST /:id/lab-results, which
// sets FARMER_UPLOADED itself; QC and verification are not the farmer's to write.
const FARMER_EDITABLE_BATCH_FIELDS = Object.freeze([
    // quantities and harvest date — frozen once a lot exists (FROZEN_ONCE_PACKED)
    'harvestDate', 'freshWeight', 'dryWeight', 'lossWeight',
    // what the farmer declares about the produce and its primary processing
    // (qualityGrade is shown on the public scan, so it freezes too)
    'moistureContent', 'qualityGrade',
    'isDried', 'dryingMethod', 'dryingTemp', 'dryingDuration',
    // lifecycle (closed set below) and the farmer's own note
    'status', 'notes',
]);

// The same closed set the create door accepts (routes/api/cultivation/
// harvest-batches.js HARVEST_BATCH_STATUSES, from harvest.prisma `status`).
const FARMER_SETTABLE_BATCH_STATUSES = Object.freeze(['RECEIVED', 'DRYING', 'PROCESSED', 'PACKED', 'SOLD']);

// Once a package code has been issued against this batch, the quantities and
// the harvest date stop being working numbers and become claims that travel
// with goods.
//
// The mass-balance control is sound in itself: issuing a lot locks the row,
// sums what has already been issued, and refuses with
// LOT_WEIGHT_QUOTA_EXCEEDED past the harvest weight. What defeated it was the
// CEILING, not the check — these fields were editable at any time, so raising
// the declared harvest let the quota politely allow more bags. That is the
// laundering route the whole chain rests on: one certified plot, uncertified
// produce bought in, weight edited upward, codes issued for all of it.
//
// Every door that writes these fields goes through refuseIfFrozenOncePacked —
// updateBatch AND recordHarvest. The second was missed once (BACK-X01):
// POST /:id/harvest rewrote freshWeight and harvestDate with no lot check, so the
// ceiling could still be raised after packing.
//
// The same holds for what the public scan shows about the produce. The quality
// grade is printed to anyone holding the QR (trace-service/resolve-generic.js,
// HARVEST_BATCH `qualityGrade` and PLANTING_CYCLE `harvests[].grade`), so once a
// lot exists a buyer has already been told it. Moisture and the drying fields
// are not shown on any public door (measured by
// __tests__/unit/harvest-trace-published-fields-freeze.test.js) and stay
// editable. `status` is shown too but is the batch's lifecycle — PACKED and SOLD
// happen after packing — so it is not frozen here.
const FROZEN_ONCE_PACKED = Object.freeze([
    // the lot-quota ceiling
    'freshWeight', 'dryWeight', 'lossWeight', 'harvestDate',
    // shown on the public scan
    'qualityGrade',
]);

// Lot issuance (traceability-service createLotWithQuotaCheck) takes this row lock
// as the first statement of its transaction. The freeze has to take the same lock
// in the transaction that writes, before it counts lots: counting and then writing
// without it let a lot issued between the two slip past the freeze. Same
// statement, same row, same "no row → NOT_FOUND" as lot issuance; statusCode is
// added so the route answers 404 instead of 500.
async function lockBatchRow(tx, batchId) {
    const locked = await tx.$queryRaw`
      SELECT "id" FROM "harvest_batches" WHERE "id" = ${batchId} FOR UPDATE
    `;
    if (!Array.isArray(locked) || locked.length === 0) {
        throw Object.assign(new Error(`Harvest batch ${batchId} not found`), { code: 'NOT_FOUND', statusCode: 404 });
    }
}

function batchEditRefusal({ statusCode, code, message, fields }) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    err.fields = fields;
    return err;
}

// JSON never carries a Date, but an in-process caller may.
function isPlainValue(value) {
    return value === null || typeof value !== 'object' || value instanceof Date;
}

// Refuse loudly rather than dropping the keys silently. A farmer editing notes
// and a weight in one request must not be told the whole edit succeeded when
// half of it was discarded; and a correction after goods have shipped is a
// decision for an officer, with a record, not a quiet PUT.
//
// `tx` must be the transaction that already holds lockBatchRow and will write.
async function refuseIfFrozenOncePacked(tx, batchId, updateData) {
    const attempted = FROZEN_ONCE_PACKED.filter((k) => updateData[k] !== undefined);
    if (attempted.length === 0) { return; }
    const issuedLots = await tx.lot.count({ where: { batchId } });
    if (issuedLots > 0) {
        throw batchEditRefusal({
            statusCode: 409,
            code: 'HARVEST_FROZEN_AFTER_PACKING',
            message: `Harvest figures shown with issued packages are frozen: ${attempted.join(', ')} ` +
                `cannot change after ${issuedLots} lot(s) have been issued from this batch.`,
            fields: attempted,
        });
    }
}

/**
 * Service for managing Harvest Batches (Lots)
 */
class HarvestService {

    /**
     * List harvest batches
     * @param {object} filter - { farmId, farmIds, status, speciesId, limit }
     */
    async list(filter = {}) {
        const where = {};
        // The route scopes to the caller's owned farms via filter.farmIds (plural
        // array from listOwnerFarmIds). This method previously read only the singular
        // farmId, so that ownership filter was silently dropped and list() returned
        // batches across all farms. Honour both: an explicit single farmId (already
        // 403-guarded as owned upstream) narrows to that farm; otherwise scope to the
        // caller's owned farms.
        if (filter.farmId) {where.farmId = filter.farmId;}
        else if (Array.isArray(filter.farmIds) && filter.farmIds.length > 0) {where.farmId = { in: filter.farmIds };}
        if (filter.status) {where.status = filter.status;}
        if (filter.speciesId) {where.plantCode = filter.speciesId;}

        return prisma.harvestBatch.findMany({
            where,
            include: {
                plant: {
                    select: { id: true, nameTH: true, nameEN: true },
                },
                // รุ่นนี้มีผลวิเคราะห์แนบไว้แล้วหรือยัง
                //
                // operator 2026-09-11: การแนบ COA **ไม่บังคับ** — "มีเพื่อประโยชน์ของ
                // เกษตรกรเอง จะอัพหรือไม่อัพก็ได้" ⇒ ระบบไม่ห้ามบรรจุล็อตโดยไม่มีผล
                // แต่ต้องบอกให้รู้ ไม่ใช่เงียบ · หน้าจอใช้ตัวเลขนี้ขึ้นคำเตือน ไม่ใช่ปิดปุ่ม
                //
                // นับ ไม่ใช่ดึงทั้งแถว: หน้ารายการต้องการแค่ "มีหรือไม่มี" ส่วนตัวผลจริง
                // อ่านที่ GET /:id/lab-results ซึ่งมีด่านความเป็นเจ้าของของมันเอง
                _count: { select: { labResults: { where: { isDeleted: false } } } },
            },
            orderBy: { createdAt: 'desc' },
            take: filter.limit || 500,
        });
    }

    /**
     * Get batch by ID
     * @param {string} id 
     */
    async getById(id) {
        return prisma.harvestBatch.findUnique({
            where: { id },
            include: {
                plant: true,
                // เหตุผลเดียวกับใน list() ข้างบน — หน้ารายละเอียดรุ่นก็ต้องบอกได้
                _count: { select: { labResults: { where: { isDeleted: false } } } },
            },
        });
    }

    /**
     * Get batch by Lot Number (Traceability)
     * @param {string} batchNumber 
     */
    async getByBatchNumber(batchNumber) {
        return prisma.harvestBatch.findUnique({
            where: { batchNumber },
            include: {
                plant: {
                    select: {
                        id: true,
                        nameTH: true,
                        nameEN: true,
                        scientificName: true,
                    },
                },
            },
        });
    }

    /**
     * Create new harvest batch (Growing phase)
     * @param {object} data 
     */
    async createBatch(data) {
        const {
            farmId, speciesId, plantingDate, cultivationType,
            seedSource, plotName, plotArea, areaUnit, notes,
        } = data;

        // W1-3: was a racy count()+1 `LOT-${farmId}-${year}-NNN` (wrong prefix
        // too — LOT- is for packaging Lot.lotNumber). Routed through the SSOT
        // generator like every other batch-number call site.
        const batchNumber = await buildBatchNumber(prisma);

        return prisma.harvestBatch.create({
            data: {
                batchNumber,
                farmId,
                speciesId,
                plantingDate: new Date(plantingDate),
                cultivationType: cultivationType || 'SELF_GROWN',
                seedSource,
                plotName,
                plotArea: plotArea ? submittedAreaSqm(plotArea, areaUnit || AREA_UNIT, 'plotArea') : null,
                areaUnit: AREA_UNIT,
                notes,
                status: 'GROWING',
            },
            include: {
                plant: { select: { nameTH: true } },
            },
        });
    }

    /**
     * Update existing batch
     * @param {string} id 
     * @param {object} data 
     */
    async updateBatch(id, data) {
        const input = data || {};
        const provided = Object.keys(input).filter((k) => input[k] !== undefined);

        // Allowlist, refused whole — see FARMER_EDITABLE_BATCH_FIELDS (BACK-02).
        const notEditable = provided.filter(
            (k) => !FARMER_EDITABLE_BATCH_FIELDS.includes(k) || !isPlainValue(input[k]),
        );
        if (notEditable.length > 0) {
            throw batchEditRefusal({
                statusCode: 400,
                code: 'HARVEST_BATCH_FIELD_NOT_EDITABLE',
                message: `These harvest batch fields cannot be edited here: ${notEditable.join(', ')}`,
                fields: notEditable,
            });
        }
        if (input.status !== undefined && !FARMER_SETTABLE_BATCH_STATUSES.includes(input.status)) {
            throw batchEditRefusal({
                statusCode: 400,
                code: 'INVALID_HARVEST_BATCH_STATUS',
                message: `Harvest batch status must be one of ${FARMER_SETTABLE_BATCH_STATUSES.join(', ')}`,
                fields: ['status'],
            });
        }

        const updateData = {};
        for (const k of provided) { updateData[k] = input[k]; }
        if (updateData.harvestDate) {updateData.harvestDate = new Date(updateData.harvestDate);}

        // Lock → count → write in one transaction, serialised with lot issuance.
        return prisma.$transaction(async (tx) => {
            await lockBatchRow(tx, id);
            await refuseIfFrozenOncePacked(tx, id, updateData);
            return tx.harvestBatch.update({
                where: { id },
                data: updateData,
            });
        });
    }

    /**
     * Record Harvest (Complete the batch)
     * @param {string} id 
     * @param {object} data 
     */
    async recordHarvest(id, data) {
        const { harvestDate, actualYield, qualityGrade, notes } = data;

        // Same lock as updateBatch and lot issuance. The batch is read after the
        // lock, so the status check and the kept notes are the row being written.
        return prisma.$transaction(async (tx) => {
            await lockBatchRow(tx, id);

            const existing = await tx.harvestBatch.findUnique({ where: { id } });
            if (!existing) {throw new Error('Harvest batch not found');}
            if (existing.status === 'HARVESTED') {throw new Error('This batch has already been harvested');}

            const updateData = {
                harvestDate: harvestDate ? new Date(harvestDate) : new Date(),
                // HarvestBatch has no actualYield/yieldUnit columns (kg-only
                // freshWeight/dryWeight/lossWeight). The recorded harvest yield is
                // the fresh weight; setting actualYield/yieldUnit threw -> 500.
                ...(actualYield != null && actualYield !== '' ? { freshWeight: parseFloat(actualYield) } : {}),
                qualityGrade,
                status: 'HARVESTED',
                notes: notes || existing.notes,
            };

            // BACK-X01: this door writes the frozen figures too — harvestDate always
            // (it defaults to now), freshWeight whenever a yield is given — so once a
            // lot exists it is refused exactly like PUT /:id.
            await refuseIfFrozenOncePacked(tx, id, updateData);

            return tx.harvestBatch.update({
                where: { id },
                data: updateData,
            });
        });
    }

    /**
     * Get Stats for Farm
     * @param {string} farmId
     */
    async getStats(farmId) {
        const [total, growing, harvested] = await Promise.all([
            prisma.harvestBatch.count({ where: { farmId } }),
            prisma.harvestBatch.count({ where: { farmId, status: 'GROWING' } }),
            prisma.harvestBatch.count({ where: { farmId, status: 'HARVESTED' } }),
        ]);

        return {
            farmId,
            totalBatches: total,
            growing,
            harvested,
            pending: total - growing - harvested,
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // Batch 15 (2026-05-16) — Direct harvest-batch + plant-species reads
    //
    // Used by routes/api/cultivation/harvest-batches.js. Prior to this
    // batch the route hit prisma.plantSpecies + prisma.harvestBatch
    // directly for the create path. Behaviour-preserving wrappers.
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Replaces routes/api/cultivation/harvest-batches.js:49 prisma.plantSpecies.findFirst
     * — resolve a species id OR code to its canonical code.
     */
    async findActivePlantSpeciesCode(speciesIdOrCode) {
        if (!speciesIdOrCode) {
            return null;
        }
        const raw = String(speciesIdOrCode).trim();
        if (!raw) {
            return null;
        }
        const species = await prisma.plantSpecies.findFirst({
            where: {
                OR: [{ id: raw }, { code: raw }],
                isDeleted: false,
                isActive: true,
            },
            select: { code: true },
        });
        return species?.code || null;
    }

    /**
     * Replaces routes/api/cultivation/harvest-batches.js:63 prisma.harvestBatch.count
     * Count batches for the current year with the given prefix, used to
     * build a monotonic batch number.
     */
    async countHarvestBatchesWithPrefix(prefix) {
        return prisma.harvestBatch.count({
            where: {
                batchNumber: { startsWith: prefix },
                isDeleted: false,
            },
        });
    }

    /**
     * Replaces routes/api/cultivation/harvest-batches.js:259 prisma.harvestBatch.create
     * — keeps the canonical include shape (farm + plant) the route uses.
     */
    async createHarvestBatchWithIncludes(data) {
        return prisma.harvestBatch.create({
            data,
            include: {
                farm: { select: { id: true, farmName: true } },
                plant: { select: { code: true, nameTH: true, nameEN: true } },
            },
        });
    }

    /**
     * Bug 5.4 (batch-number race) / W1-3 (SSOT): allocate a race-safe batch
     * number. Delegates to the canonical shared/harvest-identifiers generator
     * (transaction-scoped `harvest_batch_number_seq` PostgreSQL sequence,
     * created by 20260425100000_add_numbering_sequences) instead of the racy
     * count()+1 the route used to do. Format `BATCH-{year}-{seq:06d}`.
     */
    async _buildBatchNumberFromSequence() {
        return buildBatchNumber(prisma);
    }

    /**
     * Bug 5.4: create a harvest batch with a race-safe, sequence-allocated
     * batchNumber. The `batchNumber` column is @unique — soft-delete reuse or a
     * sequence hiccup could still (rarely) collide. A bounded retry loop
     * regenerates the number on P2002; an exhausted P2002 surfaces as a 409
     * (INVALID_INPUT-style conflict) rather than a generic 500.
     *
     * @param {object} data — harvest-batch payload WITHOUT batchNumber (this
     *   method allocates it). Any caller-supplied batchNumber is overwritten.
     * @param {object} [options]
     * @param {number} [options.maxAttempts=5]
     */
    async createHarvestBatchWithGeneratedNumber(data, options = {}) {
        const maxAttempts = Number.isFinite(options.maxAttempts) ? Number(options.maxAttempts) : 5;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const batchNumber = await this._buildBatchNumberFromSequence();
            try {
                return await this.createHarvestBatchWithIncludes({ ...data, batchNumber });
            } catch (error) {
                lastError = error;
                if (error?.code !== 'P2002') {
                    throw error;
                }
                // P2002 on batchNumber (or a sibling unique) — regenerate and retry.
            }
        }

        // Retries exhausted: surface a 409 conflict, never a 500.
        const conflict = new Error(
            'Could not allocate a unique harvest batch number after multiple attempts',
        );
        conflict.code = 'BATCH_NUMBER_CONFLICT';
        conflict.statusCode = 409;
        conflict.cause = lastError;
        throw conflict;
    }

    /**
     * Replaces routes/api/cultivation/harvest-batches.js:287 prisma.harvestBatch.update
     * — used right after create() to attach the trackingUrl computed
     * from the new row's id. Returns the row with the canonical include
     * shape so the route can return it verbatim.
     */
    async updateHarvestBatchTrackingUrl(id, trackingUrl) {
        return prisma.harvestBatch.update({
            where: { id },
            data: { trackingUrl },
            include: {
                farm: { select: { id: true, farmName: true } },
                plant: { select: { code: true, nameTH: true, nameEN: true } },
            },
        });
    }
}

module.exports = new HarvestService();
