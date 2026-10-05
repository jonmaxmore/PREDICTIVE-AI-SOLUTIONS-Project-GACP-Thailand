/**
 * @swagger
 * tags:
 *   name: HarvestBatches
 *   description: Harvest batch tracking and traceability
 */

const express = require('express');
const { safeErrorMessage } = require('../../../shared/api-response');
const router = express.Router();
const harvestService = require('../../../services/harvest-service');
const farmService = require('../../../services/farm-service');
const { prisma } = require('../../../services/prisma-database');
const { authenticateHealth } = require('../../../middleware/auth-middleware');
const qrcodeService = require('../../../services/qrcode/qrcode-service');
const logger = require('../../../shared/logger');
const { ERROR_CODES } = require('../../../shared/error-codes');
const { getRequestIp } = require('../../../utils/client-ip');
const storageService = require('../../../services/storage-service');
const uploadContentGuard = require('../../../services/upload-content-guard');
const { MAX_UPLOAD_BYTES, tooLargeRefusal } = require('@gacp/validation/upload-rules');
const {
    assertLabUploadInput, buildLabResultRow,
} = require('../../../services/batch-lab-result-service');
const {
    auditLogger,
    AuditCategory,
    AuditSeverity,
    ResourceType,
} = require('../../../middleware/audit-logger');
const { maskThaiId } = require('../../../utils/field-encryption');
// Wave B fix M4 (2026-07-03): this router is the API-drivable TWIN of the
// gated /planting-cycles/:id/harvest-batches surface — its mutations now
// carry the SAME HARVEST_RECORD gate (solo farms unchanged: the engine's
// LEGACY_OWNER rule passes the entityId=null owner with no membership read).
const { assertFarmActionPermission } = require('../../../services/entity-effective-permissions-service');

// Declared in prisma/schema/harvest.prisma:54 —
//   status String @default("RECEIVED") // RECEIVED, DRYING, PROCESSED, PACKED, SOLD
const HARVEST_BATCH_STATUSES = Object.freeze(['RECEIVED', 'DRYING', 'PROCESSED', 'PACKED', 'SOLD']);

/** Map an ENTITY_PERMISSION_DENIED throw to the canonical 403 body. */
function respondPermissionDenied(res, error) {
    return res.status(403).json({
        success: false,
        code: 'ENTITY_PERMISSION_DENIED',
        permission: error?.permission || 'HARVEST_RECORD',
        error: 'คุณไม่มีสิทธิ์บันทึกการเก็บเกี่ยวในพื้นที่ทำงานนี้',
    });
}

/**
 * M4 — assert HARVEST_RECORD for the farm; returns true when allowed,
 * otherwise writes the 403 and returns false. Non-denial faults propagate.
 */
async function assertHarvestRecordOrRespond(res, { farmId, userId }) {
    try {
        await assertFarmActionPermission({ farmId, userId, permission: 'HARVEST_RECORD' });
        return true;
    } catch (permError) {
        if (permError?.code === 'ENTITY_PERMISSION_DENIED') {
            respondPermissionDenied(res, permError);
            return false;
        }
        throw permError;
    }
}

// Batch 15 prisma-bypass cleanup (2026-05-16): the inline helpers used
// to issue prisma.farm.findMany / prisma.plantSpecies.findFirst /
// prisma.harvestBatch.count from the route. They now delegate to the
// service layer so the soft-delete + isActive predicates live in one
// place.

function toNumber(value, fallback = 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @swagger
 * /api/harvest-batches:
 *   get:
 *     summary: List harvest batches for authenticated user
 *     tags: [HarvestBatches]
 *     parameters:
 *       - in: query
 *         name: farmId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of batches
 */

// ── ผลวิเคราะห์ (COA) ของรุ่นเก็บเกี่ยว — T10 ────────────────────────────────
// ชนิดไฟล์และเพดานขนาดใช้ชุดเดียวกับเอกสารคำขอ: COA คือกระดาษที่เจ้าหน้าที่และผู้ซื้อ
// ต้องอ่านออกเหมือนกัน ไม่มีเหตุผลให้กติกาต่างกัน
const labResultUpload = storageService.createUploader(
    'lab-results',
    ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    MAX_UPLOAD_BYTES / (1024 * 1024),
);

function receiveLabResultFile(req, res, next) {
    labResultUpload.single('file')(req, res, (err) => {
        if (!err) { return next(); }
        // 413 like every multer size refusal (middleware/request-limit-errors.js,
        // which also answers the other LIMIT_* refusals passed on below).
        if (err.code === 'LIMIT_FILE_SIZE') {
            const refusal = tooLargeRefusal();
            return res.status(413).json({
                success: false, error: refusal.message, code: refusal.code, message: refusal.message,
            });
        }
        return next(err);
    });
}

function labResultFileUrl(file) {
    return `/uploads/lab-results/${file.filename}`;
}

router.get('/', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        // Get user's farms
        const farmIds = await farmService.listAccessibleFarmIds(userId);
        if (farmIds.length === 0) {
            return res.json({ success: true, count: 0, data: [] });
        }

        // Filter by user's farms
        const query = { ...req.query };
        if (query.farmId && !farmIds.includes(query.farmId)) {
            return res.status(403).json({ success: false, error: 'Access denied to this farm' });
        }
        query.farmIds = farmIds;

        const batches = await harvestService.list(query);
        res.json({
            success: true,
            count: batches.length,
            data: batches,
        });
    } catch (error) {
        logger.error('[HarvestBatch API] Error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch batches' });
    }
});

/**
 * @swagger
 * /api/harvest-batches/{id}:
 *   get:
 *     summary: Get harvest batch details
 *     tags: [HarvestBatches]
 */
router.get('/:id', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const batch = await harvestService.getById(req.params.id);

        if (!batch) {
            return res.status(404).json({ success: false, error: 'Harvest batch not found' });
        }

        // Verify ownership
        const farmIds = await farmService.listAccessibleFarmIds(userId);
        if (!farmIds.includes(batch.farmId)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        res.json({ success: true, data: batch });
    } catch (error) {
        logger.error('[HarvestBatch API] Error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch batch' });
    }
});

/**
 * @swagger
 * /api/harvest-batches/lot/{batchNumber}:
 *   get:
 *     summary: Traceability lookup by Lot Number (Public)
 *     tags: [HarvestBatches]
 *     parameters:
 *       - in: path
 *         name: batchNumber
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/lot/:batchNumber', async (req, res) => {
    try {
        const batch = await harvestService.getByBatchNumber(req.params.batchNumber);

        if (!batch) {
            return res.status(404).json({ success: false, error: 'Lot number not found' });
        }

        // Public traceability info
        res.json({
            success: true,
            data: {
                batchNumber: batch.batchNumber,
                plantingDate: batch.plantingDate,
                harvestDate: batch.harvestDate,
                cultivationType: batch.cultivationType,
                status: batch.status,
                plant: batch.plant,
            },
        });
    } catch (error) {
        logger.error('[HarvestBatch API] Error:', error);
        res.status(500).json({ success: false, error: 'Traceability lookup failed' });
    }
});

/**
 * @swagger
 * /api/harvest-batches:
 *   post:
 *     summary: Create new harvest batch (Growing Phase)
 *     tags: [HarvestBatches]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [farmId, speciesId, plantingDate]
 *             properties:
 *               farmId:
 *                 type: string
 *               speciesId:
 *                 type: integer
 *               plantingDate:
 *                 type: string
 *                 format: date
 */
router.post('/', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const {
            farmId,
            speciesId,
            plantCode: requestedPlantCode,
            cycleId,
            harvestDate,
            freshWeight,
            dryWeight,
            moistureContent,
            qualityGrade,
            notes,
            status,
        } = req.body || {};

        const resolvedFreshWeight = toNumber(
            freshWeight ?? req.body?.actualYield ?? req.body?.totalHarvestWeight,
            0,
        );
        if (!farmId || resolvedFreshWeight <= 0) {
            return res.status(400).json({
                success: false,
                error: 'farmId and freshWeight are required',
            });
        }

        // Verify farm ownership
        const farmIds = await farmService.listAccessibleFarmIds(userId);
        if (!farmIds.includes(farmId)) {
            return res.status(403).json({ success: false, error: 'Access denied to this farm' });
        }

        // M4 — per-member gate: a workspace co-member must hold effective
        // HARVEST_RECORD (owner passes inside the assert).
        if (!(await assertHarvestRecordOrRespond(res, { farmId, userId }))) {
            return undefined;
        }

        // A3 (cross-farm cert ride): when a cycleId is supplied, the batch must
        // belong to the SAME farm as the cycle. Otherwise farm A's harvest could
        // bind to farm B's certified cycle and ride B's valid GACP cert onto the
        // public QR (with per-batch self-declared, unbounded weight). findUnique
        // is not tenant-scoped, so it resolves the cycle's TRUE owning farm even
        // if a leaked cross-tenant cycleId were supplied.
        if (cycleId) {
            const cycle = await prisma.plantingCycle.findUnique({
                where: { id: String(cycleId) },
                select: { farmId: true, isDeleted: true },
            });
            if (!cycle || cycle.isDeleted || String(cycle.farmId) !== String(farmId)) {
                return res.status(400).json({
                    success: false,
                    code: 'CYCLE_FARM_MISMATCH',
                    error: 'รอบการปลูกที่เลือกไม่ได้อยู่ในฟาร์มเดียวกับล็อตเก็บเกี่ยว / Cycle does not belong to this farm',
                });
            }
        }

        const resolvedPlantCode = await harvestService.findActivePlantSpeciesCode(requestedPlantCode || speciesId);
        const qrCode = qrcodeService.generateQRCodeId();

        // Bug 5.4: the batchNumber is now allocated from a PostgreSQL sequence
        // inside a retry-on-P2002 loop (createHarvestBatchWithGeneratedNumber)
        // instead of the racy count()+1 buildBatchNumber(). A batch-number
        // collision that cannot be resolved surfaces as a 409, mapped below.
        const createdBatch = await harvestService.createHarvestBatchWithGeneratedNumber({
            farmId,
            cycleId: cycleId || null,
            plantCode: resolvedPlantCode,
            harvestDate: harvestDate ? new Date(harvestDate) : new Date(),
            freshWeight: resolvedFreshWeight,
            dryWeight: dryWeight !== undefined ? toNumber(dryWeight, 0) : null,
            moistureContent: moistureContent !== undefined ? toNumber(moistureContent, 0) : null,
            qualityGrade: qualityGrade || null,
            // HarvestBatch.status is a lifecycle state on a String column
            // (harvest.prisma:54 — RECEIVED, DRYING, PROCESSED, PACKED, SOLD).
            // This route is applicant self-service, so an unvalidated value
            // would strand the batch outside every status filter and dashboard
            // bucket that switches on it, silently and permanently. Unknown or
            // absent input falls back to the schema default rather than being
            // persisted verbatim.
            status: HARVEST_BATCH_STATUSES.includes(status) ? status : 'RECEIVED',
            qrCode,
            trackingUrl: null,
            recordedBy: userId,
            notes: notes || null,
        });

        const trackingUrl = qrcodeService.generatePublicTraceUrl(`batch/${createdBatch.id}`);
        const batch = await harvestService.updateHarvestBatchTrackingUrl(createdBatch.id, trackingUrl);

        await qrcodeService.registerTraceIntegrity({
            entityType: 'HARVEST_BATCH',
            entityId: batch.id,
            qrCode: batch.qrCode,
            publicUrl: batch.trackingUrl,
            payload: {
                scope: 'RAW_MATERIAL_GACP',
                source: 'MANUAL',
                batchId: batch.id,
                batchNumber: batch.batchNumber,
                farmId: batch.farmId,
                harvestDate: batch.harvestDate,
                totalHarvestWeight: batch.freshWeight,
            },
        }).catch((error) => {
            logger.warn('[harvest-batches] QR integrity persistence failed', {
                message: error.message,
                batchId: batch.id,
            });
        });

        // PDPA: actorIdentity is stored in a hash-chained audit row that admin
        // tools can read — raw national IDs would leak. Mask both possible
        // sources (healthId for citizens, providerId for staff) before logging.
        const maskedHealthId = req.user?.healthId ? maskThaiId(req.user?.healthId) : null;
        const maskedProviderId = req.user?.providerId ? maskThaiId(req.user?.providerId) : null;
        const maskedActorIdentity = maskedHealthId || maskedProviderId || null;

        await Promise.all([
            auditLogger.log({
                category: AuditCategory.APPLICATION,
                action: 'MANUAL_BATCH_CREATED',
                severity: AuditSeverity.INFO,
                actorId: userId,
                actorRole: req.user?.canonicalRole || req.user?.role || 'health',
                actorType: 'USER',
                resourceType: ResourceType.APPLICATION,
                resourceId: batch.id,
                ipAddress: getRequestIp(req),
                userAgent: req.get('user-agent'),
                metadata: {
                    batchNumber: batch.batchNumber,
                    farmId: batch.farmId,
                    harvestDate: batch.harvestDate,
                    totalHarvestWeight: batch.freshWeight,
                    createdFrom: 'MANUAL',
                    actorIdentity: maskedActorIdentity,
                },
            }),
            auditLogger.log({
                category: AuditCategory.APPLICATION,
                action: 'QR_GENERATED',
                severity: AuditSeverity.INFO,
                actorId: userId,
                actorRole: req.user?.canonicalRole || req.user?.role || 'health',
                actorType: 'USER',
                resourceType: ResourceType.APPLICATION,
                resourceId: batch.id,
                ipAddress: getRequestIp(req),
                userAgent: req.get('user-agent'),
                metadata: {
                    entityType: 'HARVEST_BATCH',
                    entityId: batch.id,
                    qrCode: batch.qrCode,
                    trackingUrl: batch.trackingUrl,
                },
            }),
        ]).catch((auditError) => {
            logger.warn('[harvest-batches] audit log failed', { message: auditError.message, batchId: batch.id });
        });

        res.status(201).json({
            success: true,
            message: 'Harvest batch created successfully',
            data: batch,
        });
    } catch (error) {
        // Bug 5.4: a batch-number allocation conflict is a retryable client
        // condition, not a server fault — return 409 so the caller can retry
        // instead of a misleading 500.
        if (error?.code === 'BATCH_NUMBER_CONFLICT' || error?.statusCode === 409) {
            logger.warn('[HarvestBatch API] batch-number conflict', { message: error.message });
            return res.status(409).json({ success: false, error: safeErrorMessage(error) });
        }
        logger.error('[HarvestBatch API] Error:', error);
        res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/harvest-batches/{id}:
 *   put:
 *     summary: Update harvest batch
 *     tags: [HarvestBatches]
 */
router.put('/:id', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        // Verify ownership
        const existingBatch = await harvestService.getById(req.params.id);
        if (!existingBatch) {
            return res.status(404).json({ success: false, error: 'Batch not found' });
        }

        const farmIds = await farmService.listAccessibleFarmIds(userId);
        if (!farmIds.includes(existingBatch.farmId)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // M4 — per-member gate on the batch's own farm.
        if (!(await assertHarvestRecordOrRespond(res, { farmId: existingBatch.farmId, userId }))) {
            return undefined;
        }

        const batch = await harvestService.updateBatch(req.params.id, req.body);
        res.json({
            success: true,
            message: 'Harvest batch updated successfully',
            data: batch,
        });
    } catch (error) {
        // การแช่แข็งน้ำหนักหลังบรรจุ (HARVEST_FROZEN_AFTER_PACKING) เป็นการปฏิเสธที่ตั้งใจ
        // ไม่ใช่ความผิดพลาดของเซิร์ฟเวอร์ — บริการตั้งใจ "ปฏิเสธเสียงดัง" เพราะเพดานน้ำหนักที่
        // แก้ได้ตลอดเวลาคือทางฟอกของ แต่ประตูนี้เคยกลืนมันเป็น 500 'Failed to update batch'
        // เกษตรกรจึงเห็นข้อความอังกฤษที่ไม่บอกอะไร ไม่รู้ว่าถูกห้ามเพราะอะไร และทำอะไรต่อไม่ถูก
        // (เจอตอนกดจริง 2026-09-07) · ส่งสถานะและรหัสของบริการต่อ พร้อมข้อความไทยจากสารบบ
        const status = Number(error?.statusCode || error?.status) || 0;
        if (status >= 400 && status < 500 && error?.code) {
            const row = ERROR_CODES[error.code];
            logger.warn(`[HarvestBatch API] refused: ${error.code}`, { fields: error.fields || null });
            return res.status(status).json({
                success: false,
                error: error.code,
                code: error.code,
                message: row?.messageTh || error.message,
                messageTh: row?.messageTh || null,
                fields: error.fields || undefined,
            });
        }
        logger.error('[HarvestBatch API] Error:', error);
        return res.status(500).json({ success: false, error: 'Failed to update batch' });
    }
});

/**
 * @swagger
 * /api/harvest-batches/{id}/harvest:
 *   post:
 *     summary: Record harvest (Complete Batch)
 *     tags: [HarvestBatches]
 */
router.post('/:id/harvest', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        // Verify ownership
        const existingBatch = await harvestService.getById(req.params.id);
        if (!existingBatch) {
            return res.status(404).json({ success: false, error: 'Batch not found' });
        }

        const farmIds = await farmService.listAccessibleFarmIds(userId);
        if (!farmIds.includes(existingBatch.farmId)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // M4 — per-member gate on the batch's own farm.
        if (!(await assertHarvestRecordOrRespond(res, { farmId: existingBatch.farmId, userId }))) {
            return undefined;
        }

        const batch = await harvestService.recordHarvest(req.params.id, req.body);
        res.json({
            success: true,
            message: 'Harvest recorded successfully',
            data: batch,
        });
    } catch (error) {
        // BACK-X01: ประตูนี้เขียนน้ำหนักและวันเก็บเกี่ยวเหมือน PUT /:id จึงถูกแช่แข็งด้วยกฎเดียวกัน
        // การปฏิเสธ (409 HARVEST_FROZEN_AFTER_PACKING) ต้องถึงเกษตรกรแบบเดียวกับประตู PUT ข้างบน
        // ไม่ใช่กลายเป็น 500
        const status = Number(error?.statusCode || error?.status) || 0;
        if (status >= 400 && status < 500 && error?.code) {
            const row = ERROR_CODES[error.code];
            logger.warn(`[HarvestBatch API] harvest refused: ${error.code}`, { fields: error.fields || null });
            return res.status(status).json({
                success: false,
                error: error.code,
                code: error.code,
                message: row?.messageTh || error.message,
                messageTh: row?.messageTh || null,
                fields: error.fields || undefined,
            });
        }
        logger.error('[HarvestBatch API] Error:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/**
 * @swagger
 * /api/harvest-batches/stats/{farmId}:
 *   get:
 *     summary: Get harvest statistics
 *     tags: [HarvestBatches]
 */

/**
 * POST /harvest-batches/:id/lab-results — เกษตรกรแนบผลวิเคราะห์ (COA) ของรุ่นนี้
 *
 * multipart: file (บังคับ) · labName (บังคับ) · reportNumber · reportedAt · verificationCode
 * **ไม่มีช่องค่าตัวเลข** — ไฟล์คือแหล่งความจริงเดียว (มติ operator 2026-09-05)
 *
 * เพิ่มแถวเสมอ ไม่ทับของเดิม: COA คือเอกสารที่มาถึงทีหลัง ไม่ใช่การแก้สิ่งที่ประกาศไปแล้ว
 * ได้ฉบับแก้ไขจากห้องแล็บ ให้แนบเพิ่ม ทั้งสองฉบับแสดงคู่กันพร้อมวันที่
 */
router.post('/:id/lab-results', authenticateHealth, receiveLabResultFile, async (req, res) => {
    try {
        // multer เขียนไฟล์ลงดิสก์ไปแล้วตั้งแต่ก่อนเข้าฟังก์ชันนี้ และ `lab-results/`
        // เป็นโฟลเดอร์ที่ middleware/uploads-access.js จัดเป็น public (ไม่ใช่ root/slip/
        // draft/car/audit) — ใครถือ URL ก็เปิดได้ ตามมติที่เปิด COA สู่สาธารณะ
        //
        // ดังนั้นทุกทางที่ "ไม่เขียนแถว" ต้อง "ไม่ทิ้งไฟล์" ด้วย ไม่ใช่แค่ทางที่ตรวจเนื้อไฟล์ไม่ผ่าน:
        // ไฟล์ที่ไม่มีแถวไหนชี้ถึงจะไม่มีวันถูก retention sweep ของ PDPA แตะ เพราะ sweep นั้น
        // เดินตามแถว ไม่ได้เดินตามดิสก์
        const refuse = async (status, body) => {
            if (req.file) { await uploadContentGuard.discardRejectedUpload(req.file); }
            return res.status(status).json(body);
        };

        const userId = req.user?.id;
        if (!userId) {
            return refuse(401, { success: false, error: 'Unauthorized' });
        }

        const batch = await prisma.harvestBatch.findUnique({
            where: { id: req.params.id },
            select: { id: true, farmId: true, organizationId: true, isDeleted: true },
        });
        if (!batch || batch.isDeleted) {
            return refuse(404, { success: false, error: 'Batch not found' });
        }

        // ด่านเดียวกับทุก route ของรุ่น — แนบผลตรวจให้ผลผลิตของคนอื่นไม่ได้
        const farmIds = await farmService.listAccessibleFarmIds(userId);
        if (!farmIds.includes(batch.farmId)) {
            return refuse(403, { success: false, error: 'Access denied' });
        }

        // การแนบ COA คือการเขียน — ด่านเดียวกับประตูเขียนพี่น้อง (POST / · PUT /:id · POST /:id/harvest)
        // listAccessibleFarmIds นับ VIEWER ด้วย จึงไม่พอ (reviewer พบ VIEWER แนบ COA สาธารณะได้ 201)
        // ปฏิเสธแล้วทิ้งไฟล์ที่ multer เขียนไปแล้วด้วย เหมือนทางปฏิเสธอื่นของประตูนี้
        try {
            await assertFarmActionPermission({
                farmId: batch.farmId, userId, permission: 'HARVEST_RECORD',
                // Spec 2026-09-30 §3.1 (R1): การอ่านฟาร์มของ engine ถือ holder scope
                // แบบเดียวกับประตูคู่แฝด (services/planting-cycle-service.js assertFarmPermission)
                holderScope: await require('../../../services/holder-access').holderScope(req),
            });
        } catch (permError) {
            if (permError?.code !== 'ENTITY_PERMISSION_DENIED') { throw permError; }
            if (req.file) { await uploadContentGuard.discardRejectedUpload(req.file); }
            return respondPermissionDenied(res, permError);
        }

        const { labName, reportNumber, reportedAt, verificationCode } = req.body || {};
        try {
            assertLabUploadInput({ file: req.file, labName });
        } catch (refusal) {
            if (req.file) { await uploadContentGuard.discardRejectedUpload(req.file); }
            return res.status(refusal.statusCode || 400).json({
                success: false, error: refusal.code, code: refusal.code,
                message: refusal.messageTh, messageTh: refusal.messageTh,
            });
        }

        // อ่านสิ่งที่อยู่ในไฟล์จริงก่อนจะมีอะไรชี้ไปหามัน — ไฟล์ที่ถูกปฏิเสธต้องไม่เหลือ
        // ร่องรอยให้การอ่านครั้งหลังไปเจอ (แบบเดียวกับด่านสลิปและเอกสารคำขอ)
        const verdict = await uploadContentGuard.inspectStoredUpload(req.file, 'lab_result');
        if (verdict && verdict.ok === false) {
            await uploadContentGuard.discardRejectedUpload(req.file);
            return res.status(400).json({
                success: false, error: verdict.message, code: verdict.code,
                message: verdict.message, messageTh: verdict.message,
            });
        }

        const created = await prisma.batchLabResult.create({
            data: buildLabResultRow({
                batch, file: req.file, fileUrl: labResultFileUrl(req.file),
                labName, reportNumber, reportedAt, verificationCode, uploadedBy: userId,
            }),
        });

        return res.status(201).json({ success: true, data: created });
    } catch (error) {
        logger.error('[harvest-batches] lab-result upload failed:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

/** GET /harvest-batches/:id/lab-results — ผลวิเคราะห์ทุกฉบับของรุ่นนี้ ใหม่สุดก่อน */
router.get('/:id/lab-results', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        const batch = await prisma.harvestBatch.findUnique({
            where: { id: req.params.id },
            select: { id: true, farmId: true, isDeleted: true },
        });
        if (!batch || batch.isDeleted) {
            return res.status(404).json({ success: false, error: 'Batch not found' });
        }
        const farmIds = await farmService.listAccessibleFarmIds(userId);
        if (!farmIds.includes(batch.farmId)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        const rows = await prisma.batchLabResult.findMany({
            where: { harvestBatchId: batch.id, isDeleted: false },
            orderBy: { uploadedAt: 'desc' },
        });
        return res.json({ success: true, data: rows });
    } catch (error) {
        logger.error('[harvest-batches] lab-result list failed:', error);
        return res.status(500).json({ success: false, error: safeErrorMessage(error) });
    }
});

router.get('/stats/:farmId', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        // Verify farm ownership
        const farmIds = await farmService.listAccessibleFarmIds(userId);
        if (!farmIds.includes(req.params.farmId)) {
            return res.status(403).json({ success: false, error: 'Access denied to this farm' });
        }

        const stats = await harvestService.getStats(req.params.farmId);
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('[HarvestBatch API] Error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch stats' });
    }
});

module.exports = router;
