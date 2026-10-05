const { prisma } = require('./prisma-database');
const cacheService = require('./cache-service');
const { getEntityContext } = require('./entity-context');
const { farmAccessWhere, listAccessibleFarmIds, resolveFarmOwnerAccess } = require('./farm-access');
const logger = require('../shared/logger');
const { AREA_UNIT } = require('../shared/area-utils');
const { submittedAreaSqm } = require('./certificate/submitted-area');

// C5-03 (audit 2026-06-10): escape farm-controlled values before interpolating them into
// the QR-sticker HTML — `farmName` is applicant input, so an unescaped sticker page is
// stored XSS. Mirrors the public cert-verify escape (C5-02).

// Best-effort analytics cache invalidator. Farm CRUD changes the inputs
// to the geography heat-map and dashboard summary, so we wipe the
// `analytics:*` namespace after every successful mutation. Wrapped in a
// try/catch so a Redis blip (or absent Redis in dev) never poisons the
// caller's success path.
async function bustAnalyticsCacheBestEffort(reason) {
    try {
        await cacheService.invalidateAnalyticsCache();
    } catch (error) {
        logger.warn('[farm-service] analytics cache invalidation failed (non-fatal)', {
            reason,
            error: error?.message,
        });
    }
}

/**
 * Service for managing Farms/Establishments
 */
class FarmService {
    buildFarmSelect() {
        return {
            id: true,
            uuid: true,
            farmName: true,
            farmType: true,
            address: true,
            province: true,
            district: true,
            subDistrict: true,
            postalCode: true,
            latitude: true,
            longitude: true,
            totalArea: true,
            cultivationArea: true,
            areaUnit: true,
            cultivationMethod: true,
            irrigationType: true,
            soilType: true,
            waterSource: true,
            status: true,
            verifiedAt: true,
            createdAt: true,
            updatedAt: true,
        };
    }

    /**
     * Get all farms a HEALTH user can act on — legacy owned farms plus
     * workspace farms where the user holds an ACTIVE EntityMembership
     * (Wave A chunk 3; solo farmers keep the byte-identical legacy where).
     * @param {string} ownerId
     */
    async getByOwner(ownerId) {
        return prisma.farm.findMany({
            where: {
                ...(await farmAccessWhere(ownerId)),
                isDeleted: false,
            },
            orderBy: { createdAt: 'desc' },
            select: this.buildFarmSelect(),
        });
    }

    /**
     * Get farms that are eligible for planting cycle creation.
     * Criteria:
     * - owned by current health account
     * - not deleted
     * - has at least one active, non-expired certificate
     * - has at least one plot
     */
    async getEligibleForPlanting(ownerId, { holderScope = null } = {}) {
        if (!ownerId) {
            return [];
        }

        const now = new Date();
        const farms = await prisma.farm.findMany({
            where: {
                ...(await farmAccessWhere(ownerId)),
                isDeleted: false,
            },
            orderBy: { createdAt: 'desc' },
            select: this.buildFarmSelect(),
        });
        const farmIds = farms.map((farm) => String(farm.id || '').trim()).filter(Boolean);
        if (farmIds.length === 0) {
            return [];
        }

        const [activeCertificates, plots] = await Promise.all([
            prisma.certificate.findMany({
                where: {
                    // Wave A chunk 3: certificates are keyed by farm, not by
                    // the caller — a workspace co-member's caller-id would
                    // never match the owner's cert userId. farmIds above is
                    // already access-scoped, so farm-scope alone is correct.
                    farmId: {
                        in: farmIds,
                    },
                    isDeleted: false,
                    status: {
                        in: ['active', 'ACTIVE'],
                    },
                    expiryDate: {
                        gte: now,
                    },
                    // R1-legacy-pin: removed in Task 12 — the access-scoped farm set above decides.
                    ...require('./holder-access').r1HolderOrLegacyWhenScoped(holderScope, 'Certificate', { farmId: { in: farmIds } }),
                },
                select: {
                    farmId: true,
                },
            }),
            prisma.plot.groupBy({
                by: ['farmId'],
                where: {
                    farmId: {
                        in: farmIds,
                    },
                },
                _count: {
                    _all: true,
                },
            }),
        ]);

        const farmIdsWithActiveCertificates = new Set(
            activeCertificates.map((item) => String(item.farmId || '').trim()).filter(Boolean),
        );
        const farmIdsWithPlots = new Set(
            plots
                .filter((item) => Number(item?._count?._all || 0) > 0)
                .map((item) => String(item.farmId || '').trim())
                .filter(Boolean),
        );

        return farms.filter((farm) =>
            farmIdsWithActiveCertificates.has(String(farm.id)) &&
            farmIdsWithPlots.has(String(farm.id)),
        );
    }

    /**
     * Get single farm by ID with access check (owner OR ACTIVE co-member of
     * the farm entity — Wave A chunk 3). Returns null on no-access so every
     * caller keeps its 404-not-403 semantics.
     * @param {string} id
     * @param {string} ownerId — the requesting user id
     * @param {{ forMutation?: boolean }} [options] — S2: mutation callers
     *        (updateFarm) pass forMutation:true so VIEWER co-members are
     *        excluded; read callers stay byte-identical.
     */
    async getById(id, ownerId, options = {}) {
        return prisma.farm.findFirst({
            where: {
                id,
                ...(await farmAccessWhere(ownerId, { forMutation: options.forMutation === true })),
                isDeleted: false,
            },
            include: {
                plantingCycles: {
                    where: { isDeleted: false },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                },
                harvestBatches: {
                    where: { isDeleted: false },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                },
            },
        });
    }

    /**
     * Create a new farm
     *
     * Wave A chunk 2 (2026-07-02): stamps `entityId` from the active-entity
     * scope so runtime-created farms join the workspace dimension (before
     * this only the run-once backfill wrote entityId — and the read-side
     * prisma extension entity-filters Farm, so a null-entityId farm vanishes
     * from list reads under an active entity context). Resolution order:
     * explicit options.entityId (route threads req.activeEntity, mirroring
     * the applications.js draft-stamping precedent) → ALS entity context →
     * null (scripts/seeds without a scope keep working; NEVER a lookup here).
     *
     * @param {string} ownerId
     * @param {object} data
     * @param {object} file (Optional uploaded file)
     * @param {{ entityId?: string|null }} [options]
     */
    async createFarm(ownerId, data, file, options = {}) {
        const {
            farmName, farmType, address, province, district, subDistrict, postalCode,
            latitude, longitude, totalArea, cultivationArea, areaUnit,
            cultivationMethod, irrigationType, soilType, waterSource, landDocuments,
        } = data;

        const entityId = options.entityId || getEntityContext()?.entityId || null;

        const created = await prisma.farm.create({
            data: {
                ownerId,
                entityId,
                farmName,
                farmType: farmType || 'CULTIVATION',
                address,
                province,
                district,
                subDistrict,
                postalCode: postalCode || '',
                latitude: latitude ? parseFloat(latitude) : null,
                longitude: longitude ? parseFloat(longitude) : null,
                totalArea: submittedAreaSqm(totalArea, areaUnit || AREA_UNIT, 'totalArea'),
                cultivationArea: submittedAreaSqm(cultivationArea, areaUnit || AREA_UNIT, 'cultivationArea'),
                // Square metres. A caller that still sends a unit has its number
                // read with it; what gets stored is always sqm.
                areaUnit: AREA_UNIT,
                cultivationMethod: cultivationMethod || 'OUTDOOR',
                irrigationType,
                soilType,
                waterSource,
                // Handle file upload or JSON body
                landDocuments: file ? {
                    images: [`/uploads/${file.filename}`],
                } : (landDocuments || null),
                status: 'DRAFT',
            },
        });
        await bustAnalyticsCacheBestEffort('farm-create');
        return created;
    }

    /**
     * Update farm details
     * @param {string} id 
     * @param {string} ownerId 
     * @param {object} data 
     */
    async updateFarm(id, ownerId, data) {
        // Wave B fix M2 — READ-shaped reachability (no VIEWER floor): the
        // EDIT_FARM engine gate below is the sole mutation authority, so a
        // VIEWER holding an explicit GRANT is no longer nulled-out before
        // the engine runs (an un-granted VIEWER is denied by the gate —
        // same net posture as the old floor).
        const existing = await this.getById(id, ownerId);
        if (!existing) {return null;}

        // Wave B chunk 4 — per-member gate: the legacy owner passes inside
        // the assert (rule a + M1 ACTIVE-membership check); a workspace
        // co-member must hold effective EDIT_FARM. Throws
        // ENTITY_PERMISSION_DENIED (statusCode 403) — the route maps it.
        const { assertFarmActionPermission } = require('./entity-effective-permissions-service');
        await assertFarmActionPermission({
            farm: existing,
            userId: ownerId,
            permission: 'EDIT_FARM',
        });

        // B6 / กทล.๑ ส่วนที่ ๔ (๓) — ผู้ยื่นรับรองว่าจะไม่เปลี่ยนพื้นที่ปลูกโดยไม่ยื่นคำขอใหม่
        // และขั้นที่ 6 ของ wizard ให้เขาติ๊กข้อนั้นจริง · ประตูนี้เคยรับ cultivationMethod
        // โดยไม่ถามใบรับรองเลย ซึ่งเป็นก้าวแรกของทางอ้อมสองก้าว (ก้าวที่สองคือประตูสร้างแปลง
        // ที่เทียบกับคอลัมน์นี้) · ล็อกเฉพาะช่องนี้ช่องเดียว — ที่อยู่/อำเภอ/จังหวัดยังแก้ได้
        // เพราะ reviseCertificateFromFarm อ่านสามช่องนั้นจากฟาร์มเป็นแหล่งความจริง
        const { assertCultivationMethodUnlocked } = require('./certified-scope');
        await assertCultivationMethodUnlocked({
            farmId: id,
            current: existing.cultivationMethod,
            requested: data.cultivationMethod,
        });

        const updateData = {};
        const allowedFields = [
            'farmName', 'farmType', 'address', 'province', 'district',
            'subDistrict', 'postalCode', 'latitude', 'longitude',
            // areaUnit is not updatable — there is one unit and it is square
            // metres. Letting a caller change it would reinterpret the stored
            // number without touching it.
            'totalArea', 'cultivationArea', 'cultivationMethod',
            'irrigationType', 'soilType', 'waterSource', 'landDocuments',
            'sanitationInfo', 'siteHistory', // [NEW] GACP Fields
        ];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                updateData[field] = data[field];
            }
        }

        // Parse numeric fields
        if (updateData.latitude) { updateData.latitude = parseFloat(updateData.latitude); }
        if (updateData.longitude) { updateData.longitude = parseFloat(updateData.longitude); }
        if (updateData.totalArea) { updateData.totalArea = parseFloat(updateData.totalArea); }
        if (updateData.cultivationArea) { updateData.cultivationArea = parseFloat(updateData.cultivationArea); }

        const updated = await prisma.farm.update({
            where: { id },
            data: updateData,
        });
        await bustAnalyticsCacheBestEffort('farm-update');
        return updated;
    }

    /**
     * Soft delete farm.
     *
     * Wave A fix M1 (adversarial-verify 2026-07-02): deletion must NOT ride
     * the access-widened co-member lookup — soft-delete is permanent-grade
     * (no FARM_DELETE in the Wave-B taxonomy, so a co-member delete could
     * never be revoked per-person). Gate: legacy owner (`ownerId === userId`)
     * OR ACTIVE entity-role OWNER. Returns false on no-access so the route
     * keeps its 404-not-403 semantics.
     * @param {string} id
     * @param {string} ownerId — the requesting user id
     */
    async deleteFarm(id, ownerId) {
        const existing = await prisma.farm.findFirst({
            where: { id, isDeleted: false },
            select: { id: true, ownerId: true, entityId: true },
        });
        if (!existing) {return false;}

        const allowed = await resolveFarmOwnerAccess(existing, ownerId);
        if (!allowed) {return false;}

        await prisma.farm.update({
            where: { id },
            data: {
                isDeleted: true,
                deletedAt: new Date(),
                deletedBy: ownerId,
            },
        });
        await bustAnalyticsCacheBestEffort('farm-delete');
        return true;
    }

    // ── ไม่มี QR ระดับฟาร์ม (ถอดออก 2026-09-05, มติ operator) ──────────────────
    //
    // `generateQRCode(id, ownerId)` เคยอยู่ตรงนี้ ออกสติกเกอร์ HTML ที่มี QR ชี้ไป
    // `${appBaseUrl()}/verify/farm/<farm.id>` — ปลายทางที่ **ไม่มีอยู่จริง** ทั้งใน
    // web app และ backend สติกเกอร์ทุกใบที่เคยพิมพ์จึงนำไปสู่ 404 และมันฝัง
    // **กุญแจหลักของฟาร์ม** ลงในรหัสที่พิมพ์บนกระดาษ ซึ่งเรียกคืนไม่ได้ — เป็นมือจับ
    // เดียวกับที่ถูกตัดออกจาก /trace/batch และ /trace/lot ในวันเดียวกัน
    //
    // สิ่งที่ผู้บริโภคต้องตรวจคือ *สินค้าในมือ* ซึ่ง QR ของล็อตบรรจุตอบอยู่แล้ว
    // QR ระดับฟาร์มชวนให้สแกนทั้งผืน ซึ่งคือ "การสืบเจ้าของ" ที่หลักข้อ 1 ของ
    // ขอบเขตข้อมูล T&T ห้ามไว้ · หมุด: __tests__/unit/a-farm-has-no-public-qr.test.js


    // Batch 11 — Audit cluster reads
    //
    // Used by routes/api/audit/farm-audit.js and audit/fraud-detection.js.
    // Prior to this batch those routes hit prisma.farm directly, missing
    // the canonical `isDeleted: false` filter and the tenant scope. Keeping
    // the read paths here lets the soft-delete + tenant clauses live in one
    // file (Thai PDPA Act B.E. 2562 s.24 — purpose limitation: data
    // collected for one purpose must not silently surface under another).

    /**
     * Tenant-scoped lookup of a single farm, optionally narrowed to a
     * projection. Used by the audit-creation and photo-upload flows.
     */
    async findFarmInTenant({ id, organizationId, select } = {}) {
        const query = {
            where: organizationId ? { id, organizationId } : { id },
        };
        if (select) {
            query.select = select;
        }
        return prisma.farm.findFirst(query);
    }

    /**
     * Update a farm row from inside the audit workflow. Reserved for the
     * audit-result post-processing in audit/audits.js (auto-activate after
     * a PASS) and the farm-audit checklist commit. Status is mutated here
     * rather than at the route boundary so the soft-delete invariant is
     * enforced (we never re-activate a row that has been removed).
     */
    async updateFarmFromAudit(id, data) {
        return prisma.farm.update({
            where: { id, isDeleted: false },
            data,
        });
    }

    /**
     * Find farms with GPS coordinates for the duplicate-detection sweep
     * under /api/fraud-detection/farms/duplicates. The route iterates
     * pairwise to compute distances — keeping the projection narrow here
     * limits column surface area.
     */
    async findFarmsWithGps({ province, page = 1, limit = 50 } = {}) {
        const where = {
            isDeleted: false,
            latitude: { not: null },
            longitude: { not: null },
        };
        if (province) {
            where.province = province;
        }
        return prisma.farm.findMany({
            where,
            select: {
                id: true,
                farmName: true,
                province: true,
                district: true,
                latitude: true,
                longitude: true,
                ownerId: true,
            },
            skip: (parseInt(page, 10) - 1) * parseInt(limit, 10),
            take: parseInt(limit, 10),
        });
    }

    /**
     * Count of non-deleted farms, accepting an additional where clause.
     * Used by the fraud-detection dashboard cards.
     */
    async countFarms({ where = {} } = {}) {
        return prisma.farm.count({
            where: { isDeleted: false, ...where },
        });
    }

    // Batch 15 — Cultivation + Trace cluster reads
    //
    // Used by routes/api/cultivation/{plots,harvest-batches}.js and
    // routes/api/trace/lots.js. Prior to this batch those routes hit
    // prisma.farm directly with bespoke select shapes. Keeping the
    // canonical column projection here means a route bug cannot widen
    // the result (e.g. accidentally exposing soft-deleted farms or
    // ownership-mismatched rows).

    /**
     * Replaces the inline `prisma.farm.findMany({ where: { ownerId,
     * isDeleted: false }, select: { id: true } })` lookups in
     * routes/api/trace/lots.js:42 and
     * routes/api/cultivation/harvest-batches.js:29.
     *
     * Returns an array of farm ids — the caller iterates `.includes()`
     * for ownership probes. Empty array on no user / no farms.
     */
    async listOwnerFarmIds(ownerId) {
        if (!ownerId) {
            return [];
        }
        const farms = await prisma.farm.findMany({
            where: { ownerId, isDeleted: false },
            select: { id: true },
        });
        return farms.map(f => f.id);
    }

    /**
     * Wave A chunk 3 — the workspace-aware replacement for
     * `listOwnerFarmIds` at CULTIVATION call sites (harvest-batches,
     * plant-unit ownership, cultivation-log farm guards): owned farms plus
     * farms of entities where the user holds an ACTIVE membership.
     * trace/lots.js intentionally stays on the owner-only helper.
     */
    async listAccessibleFarmIds(userId) {
        return listAccessibleFarmIds(userId);
    }

    /**
     * Replaces routes/api/cultivation/plots.js:17 prisma.farm.findFirst
     * (the inline `resolveOwnedFarm` helper). Returns the cultivation-
     * scoped projection the plot create + list endpoints need.
     * Wave A chunk 3: owner OR ACTIVE co-member (null on no-access → 404).
     * S2: the plot-CREATE site passes `{ forMutation: true }` (VIEWER floor);
     * the list site stays read-shaped.
     */
    async findOwnedFarmForPlotOps(farmId, ownerId, options = {}) {
        if (!farmId || !ownerId) {
            return null;
        }
        return prisma.farm.findFirst({
            where: {
                id: String(farmId),
                ...(await farmAccessWhere(String(ownerId), { forMutation: options.forMutation === true })),
                isDeleted: false,
            },
            select: {
                id: true,
                cultivationMethod: true,
                cultivationArea: true,
                areaUnit: true,
            },
        });
    }
}

module.exports = new FarmService();
