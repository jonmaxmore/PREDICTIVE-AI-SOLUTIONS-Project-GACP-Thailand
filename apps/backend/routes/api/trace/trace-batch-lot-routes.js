const { safeErrorMessage } = require('../../../shared/api-response');
const { publicTraceUrlFor } = require('../../../services/qrcode/public-trace-url');
// Batch 15 prisma-bypass cleanup (2026-05-16): public-trace reads
// against HarvestBatch, Lot, and TraceQrSecurity moved into
// `traceability-service`. The `prisma` symbol is no longer pulled
// from `deps` here.
const traceabilityService = require('../../../services/traceability-service');
// ประตูสแกนสาธารณะมีสองเส้น และก่อน 2026-09-06 เส้นนี้เขียน projection ของตัวเอง — มติที่เปิด
// ที่อยู่และ COA จึงเป็นจริงเฉพาะบน /api/trace/:qr ส่วนหน้าเว็บของผู้ซื้อเรียกเส้นนี้
const { toPublicFarm } = require('../../../services/trace-service/public-farm');
const { toPublicPlant } = require('../../../services/trace-service/public-plant');
const { isRecalled, RECALL_PUBLIC_MESSAGE_TH } = require('../../../services/lot-recall-service');
const {
    publicLabProjection,
    publicBatchLabProjection,
} = require('../../../services/lab-evidence-service');

function registerBatchAndLotRoutes(router, deps) {
    const {
        qrcodeService,
        logger,
        getRequestIp,
        buildIntegrityPayload,
        logPublicTraceAccess,
        TRACE_NOT_FOUND_MESSAGE,
        formatThaiDate,
        SAFETY_DISCLAIMER,
        FDA_REFERRAL,
        evaluateCertGate,
    } = deps;

    // A3 (cross-farm cert ride): a batch whose cycle belongs to a DIFFERENT farm
    // must not surface that cycle's certificate on the public QR. CLEANUP-#7: the
    // public projection now carries cycle.farmId (traceability-service A3-layer-2b),
    // so this compares IN-MEMORY — no per-request plantingCycle.findUnique. Fails
    // OPEN when the cycle's owning farmId is absent from the projection (keeps the
    // cert) so a projection gap never hides a legit certificate — the definitive
    // guard is the create-time farm check (harvest-batches.js).
    function dropCrossFarmCert(cert, cycleFarmId, batchFarmId) {
        if (!cert || cycleFarmId === null || cycleFarmId === undefined) {
            return cert;
        }
        if (String(cycleFarmId) !== String(batchFarmId)) {
            return null;
        }
        return cert;
    }

    router.get('/batch/:batchId', async (req, res) => {
        try {
            const { batchId } = req.params;

            const batch = await traceabilityService.findPublicBatchByAnyIdentifier(batchId);

            if (!batch) {
                return res.status(404).json({
                    success: false,
                    message: TRACE_NOT_FOUND_MESSAGE,
                    verification: {
                        valid: false,
                        scannedAt: new Date().toISOString(),
                    },
                });
            }

            let cert = batch.cycle?.certificate || null;
            // A3: drop the cert if the cycle belongs to a different farm than the batch.
            cert = dropCrossFarmCert(cert, batch.cycle?.farmId, batch.farmId);
            // H3: cert validity + the 410 body now come from the shared gate so
            // the dedicated batch/lot routes and the generic resolver stay in sync.
            const certGate = evaluateCertGate(cert);
            const isCertValid = certGate.isValid;

            // PR-1.9: revoked / expired certificates must NOT continue to
            // expose full trace data via the public batch endpoint. A
            // consumer scanning a QR after revocation should get a clear
            // "this certificate has been revoked / expired" response, not the
            // original trace as if everything were fine.
            //
            // 410 Gone communicates "this resource existed but is no longer
            // available" — appropriate for a revoked/expired certificate.
            if (certGate.gated) {
                await logPublicTraceAccess(req, 'BATCH', batch.id, {
                    lookup: batchId,
                    batchNumber: batch.batchNumber,
                    rejectedReason: certGate.certExpired
                        ? 'CERT_EXPIRED'
                        : `CERT_${(certGate.status || 'invalid').toUpperCase()}`,
                });
                return res.status(410).json(certGate.minimalBody('HARVEST_BATCH'));
            }

            const packagedWeight = batch.lots.reduce((sum, lot) => sum + Number(lot.totalWeight || 0), 0);
            // The integrity RECORD lookup that used to sit here fed the public
            // `source` block only, and that block is gone (operator 2026-09-05).
            // Removing it drops a database round-trip from every anonymous scan.
            // The integrity CHECK below is a different thing and stays: it is what
            // tells a consumer whether the data was altered after the QR was issued.
            await logPublicTraceAccess(req, 'BATCH', batch.id, {
                lookup: batchId,
                batchNumber: batch.batchNumber,
            });
            const integrity = await qrcodeService.recordTraceScan('HARVEST_BATCH', batch.id, {
                requestIp: getRequestIp(req),
                userAgent: req.get('user-agent'),
                requestPath: req.originalUrl,
            }).catch((error) => {
                logger.warn('[trace] batch integrity verification failed', {
                    error: safeErrorMessage(error),
                    batchId: batch.id,
                });
                return { available: false, valid: null };
            });

            // "ฟาร์มนี้มีผลตรวจกี่ฉบับ" — คำกล่าวอ้างของฟาร์ม อ่านไม่ได้ = 0 ไม่ใช่ล้ม
            // บรรทัดของฟาร์มเป็นข้อมูลเสริม ส่วนบรรทัดที่คนสแกนมาถามมาพร้อมแถวที่โหลดแล้ว
            let farmLabResults = [];
            try {
                farmLabResults = await traceabilityService.findFarmLabResultMarkers(batch.farmId);
            } catch (error) {
                logger.warn('[trace] farm lab-result count unavailable', {
                    error: safeErrorMessage(error),
                });
            }

            return res.json({
                success: true,
                type: 'HARVEST_BATCH',
                data: {
                    batchId: batch.id,
                    batchNumber: batch.batchNumber,
                    status: 'Raw Material (GACP)',
                    // No farm primary key. A scan is of ONE package; the farm's id
                    // would let a scanner correlate every batch and lot of that farm
                    // across scans, and /trace/verify/FARM/<id> would confirm the row.
                    // The approved scope marks internal ids ❌ "เป็นมือจับสำหรับไล่เดา"
                    // (2026-09-05-tnt-data-scope.md §1). Nothing renders it.
                    farm: toPublicFarm(batch.farm),
                    // ห้องปฏิบัติการตรวจ "รุ่น" — บนหน้านี้ COA จึงเป็นของสิ่งที่ถูกสแกนโดยตรง
                    // สองคำกล่าวอ้างยังแยกกัน: `batch` คือรุ่นนี้ · `farm` คือประวัติของฟาร์ม
                    labTest: publicBatchLabProjection({ batch, farmLabResults }),
                    harvestDate: batch.harvestDate,
                    harvestDateTH: formatThaiDate(batch.harvestDate),
                    totalHarvestWeight: Number(batch.freshWeight || 0),
                    totalPackagedWeight: packagedWeight,
                    packagingLots: batch.lots.map((lot) => ({
                        lotId: lot.id,
                        lotNumber: lot.lotNumber,
                        packagingType: lot.packageType,
                        unitWeight: Number(lot.unitWeight || 0),
                        unitCount: Number(lot.quantity || 0),
                        totalWeight: Number(lot.totalWeight || 0),
                        qrUrl: publicTraceUrlFor(lot.trackingUrl, `lot/${lot.id}`),
                    })),
                    certificate: cert ? {
                        reference: cert.certificateNumber,
                        issuedDate: cert.issuedDate,
                        issuedDateTH: formatThaiDate(cert.issuedDate),
                        expiryDate: cert.expiryDate,
                        expiryDateTH: formatThaiDate(cert.expiryDate),
                        isValid: isCertValid,
                    } : null,
                    // No `source` block on the public scan (operator 2026-09-05).
                    // It carried the plot and cycle a package came from — first as
                    // ids (removed the same day: a database handle for a row the
                    // scanner did not scan), then as names, which the operator
                    // ruled out too. They are the farm's own internal labelling: a
                    // plot name can carry a person ("แปลงหลังบ้านลุงมี") and a cycle
                    // name reveals production cadence. A consumer checking quality
                    // needs the certificate, the plant, the district, the dates and
                    // the actual weight — all above — and none of this.
                    traceabilityScope: 'RAW_MATERIAL_GACP',
                    verification: {
                        valid: true,
                        scannedAt: new Date().toISOString(),
                    },
                    integrity: buildIntegrityPayload(integrity),
                    disclaimers: SAFETY_DISCLAIMER,
                    referrals: {
                        safety: FDA_REFERRAL,
                    },
                },
            });
        } catch (error) {
            logger.error({
                type: 'batch_trace_error',
                error: safeErrorMessage(error),
                batchId: req.params.batchId,
            }, 'Error tracing batch');
            return res.status(500).json({
                success: false,
                message: TRACE_NOT_FOUND_MESSAGE,
                error: safeErrorMessage(error),
            });
        }
    });

    router.get('/lot/:lotId', async (req, res) => {
        try {
            const { lotId } = req.params;
            const lot = await traceabilityService.findPublicLotByAnyIdentifier(lotId);

            if (!lot || !lot.batch) {
                return res.status(404).json({
                    success: false,
                    message: TRACE_NOT_FOUND_MESSAGE,
                    verification: {
                        valid: false,
                        scannedAt: new Date().toISOString(),
                    },
                });
            }

            let cert = lot.batch.cycle?.certificate || null;
            // A3: drop the cert if the lot's batch and its cycle are on different farms.
            cert = dropCrossFarmCert(cert, lot.batch.cycle?.farmId, lot.batch.farmId);
            // H3 follow-up: the LOT route previously computed isCertValid but
            // never 410-gated a revoked/expired cert (same defect class the
            // batch route already fixed). Gate via the shared helper.
            const certGate = evaluateCertGate(cert);
            const isCertValid = certGate.isValid;
            if (certGate.gated) {
                await logPublicTraceAccess(req, 'LOT', lot.id, {
                    lookup: lotId,
                    lotNumber: lot.lotNumber,
                    batchId: lot.batchId,
                    rejectedReason: certGate.certExpired
                        ? 'CERT_EXPIRED'
                        : `CERT_${(certGate.status || 'invalid').toUpperCase()}`,
                });
                return res.status(410).json(certGate.minimalBody('LOT'));
            }
            // The integrity RECORD lookup that used to sit here fed the public
            // `source` block only, and that block is gone (operator 2026-09-05).
            // Removing it drops a database round-trip from every anonymous scan.
            // The integrity CHECK below is a different thing and stays: it is what
            // tells a consumer whether the data was altered after the QR was issued.

            await logPublicTraceAccess(req, 'LOT', lot.id, {
                lookup: lotId,
                lotNumber: lot.lotNumber,
                batchId: lot.batchId,
            });
            const integrity = await qrcodeService.recordTraceScan('PACKAGING_LOT', lot.id, {
                requestIp: getRequestIp(req),
                userAgent: req.get('user-agent'),
                requestPath: req.originalUrl,
            }).catch((error) => {
                logger.warn('[trace] lot integrity verification failed', {
                    error: safeErrorMessage(error),
                    lotId: lot.id,
                });
                return { available: false, valid: null };
            });

            // "ฟาร์มนี้มีผลตรวจกี่ฉบับ" — คำกล่าวอ้างของฟาร์ม อ่านไม่ได้ = 0 ไม่ใช่ล้ม
            // บรรทัดของฟาร์มเป็นข้อมูลเสริม ส่วนบรรทัดที่คนสแกนมาถามมาพร้อมแถวที่โหลดแล้ว
            let farmLabResults = [];
            try {
                farmLabResults = await traceabilityService.findFarmLabResultMarkers(lot.batch.farmId);
            } catch (error) {
                logger.warn('[trace] farm lab-result count unavailable', {
                    error: safeErrorMessage(error),
                });
            }

            return res.json({
                success: true,
                type: 'PACKAGING_LOT',
                data: {
                    lotId: lot.id,
                    lotNumber: lot.lotNumber,
                    batchId: lot.batch.id,
                    batchNumber: lot.batch.batchNumber,
                    status: 'Raw Material (GACP)',
                    // Same as the batch response above — no farm primary key.
                    farm: toPublicFarm(lot.batch.farm),
                    // มติ operator 2026-09-07 (ข้อ 7): คนสแกนถุงต้องรู้ว่าเป็นพืชอะไร —
                    // ผ่าน toPublicPlant สี่ฟิลด์เท่านั้น ไม่ยกแถวทะเบียน
                    plant: toPublicPlant(lot.batch.plant),
                    // การเรียกคืน — คำเตือนที่สำคัญที่สุดบนหน้านี้เมื่อมันจริง
                    // (รายงาน 5 ฝ่าย ข้อ 2) · null เมื่อไม่ถูกเรียกคืน — ไม่มีก้อน
                    // {recalled:false} ให้หน้าจอเผลอวาดเป็นป้ายเขียว
                    recall: isRecalled(lot)
                        ? { recalled: true, messageTh: RECALL_PUBLIC_MESSAGE_TH }
                        : null,
                    // T11 — ล็อตไม่เคยมี COA ของตัวเอง มันสืบทอดจากรุ่นที่มันมา
                    labTest: publicLabProjection({ lot, farmLabResults }),
                    harvestDate: lot.batch.harvestDate,
                    harvestDateTH: formatThaiDate(lot.batch.harvestDate),
                    packaging: {
                        type: lot.packageType,
                        unitWeight: Number(lot.unitWeight || 0),
                        unitCount: Number(lot.quantity || 0),
                        totalWeight: Number(lot.totalWeight || 0),
                    },
                    qrUrl: publicTraceUrlFor(lot.trackingUrl, `lot/${lot.id}`),
                    certificate: cert ? {
                        reference: cert.certificateNumber,
                        issuedDate: cert.issuedDate,
                        issuedDateTH: formatThaiDate(cert.issuedDate),
                        expiryDate: cert.expiryDate,
                        expiryDateTH: formatThaiDate(cert.expiryDate),
                        isValid: isCertValid,
                    } : null,
                    // No `source` block on the public scan (operator 2026-09-05).
                    // It carried the plot and cycle a package came from — first as
                    // ids (removed the same day: a database handle for a row the
                    // scanner did not scan), then as names, which the operator
                    // ruled out too. They are the farm's own internal labelling: a
                    // plot name can carry a person ("แปลงหลังบ้านลุงมี") and a cycle
                    // name reveals production cadence. A consumer checking quality
                    // needs the certificate, the plant, the district, the dates and
                    // the actual weight — all above — and none of this.
                    links: {
                        // `healthPlantingUnitsUrl` is gone (2026-08-25). It deep-linked
                        // into the per-plant units tab that R8 of
                        // design note 2026-08-20-planting-tnt-design
                        // retires, so the URL now leads nowhere. A lot traces back to
                        // its batch and its plot-cycle, both already in `source` above.
                        requiresAuthentication: true,
                    },
                    traceabilityScope: 'RAW_MATERIAL_GACP',
                    verification: {
                        valid: true,
                        scannedAt: new Date().toISOString(),
                    },
                    integrity: buildIntegrityPayload(integrity),
                    disclaimers: SAFETY_DISCLAIMER,
                    referrals: {
                        safety: FDA_REFERRAL,
                    },
                },
            });
        } catch (error) {
            logger.error({
                type: 'lot_trace_error',
                error: safeErrorMessage(error),
                lotId: req.params.lotId,
            }, 'Error tracing lot');
            return res.status(500).json({
                success: false,
                message: TRACE_NOT_FOUND_MESSAGE,
                error: safeErrorMessage(error),
            });
        }
    });
}

module.exports = {
    registerBatchAndLotRoutes,
};
