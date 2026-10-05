const {
    prisma,
    logger,
    qrcodeService,
    formatCultivationType,
    formatThaiDate,
    SAFETY_DISCLAIMER,
    FDA_REFERRAL,
    TRACE_NOT_FOUND_MESSAGE,
    evaluateCertGate,
} = require('./common');
const { publicLabProjection, findFarmLabResultMarkers } = require('../lab-evidence-service');
// ประตูสแกนสาธารณะมีสองเส้น (ดูหัวไฟล์ public-farm.js) — คำถามกับคำตอบเรื่องฟาร์มอยู่ที่เดียว
const { PUBLIC_FARM_SELECT, toPublicFarm } = require('./public-farm');
const { toPublicPlant } = require('./public-plant');
const { isRecalled, RECALL_PUBLIC_MESSAGE_TH } = require('../lot-recall-service');
const { resolveTraceByPlotCycleQr } = require('./resolve-plot-cycle');

/**
 * Public trace surface — reached UNAUTHENTICATED by anyone who scans or guesses a QR.
 *
 * ขอบเขตข้อมูลของ "ฟาร์ม" บนหน้านี้ — มติ operator 2026-09-05 ที่เปิดที่อยู่ และเหตุผลที่พิกัด
 * ยังปิดอยู่ — ย้ายไปอยู่กับโค้ดที่บังคับใช้มันแล้วที่ ./public-farm.js เพราะประตูสแกนสาธารณะ
 * มีสองเส้น และเหตุผลที่อยู่กับเส้นเดียวก็เป็นจริงแค่เส้นเดียว
 */

/**
 * SEC-CULT-002: build the public `verification` block from the REAL trace-QR
 * integrity check (RSA-SHA256 signature + data/chain hash via
 * qrcode-service.verifyTraceIntegrity) instead of a hardcoded `valid: true`.
 * `sealed` is false when the entity has no TraceQrSecurity row — e.g. cycle-level
 * lookups, since only plot/batch/lot QRs are cryptographically sealed — so we
 * never assert a verification that did not actually happen.
 */
async function buildVerification(entityType, entityId, extra = {}) {
    const integrity = await qrcodeService
        .verifyTraceIntegrity(entityType, entityId)
        .catch(() => null);
    const sealed = integrity?.available === true;
    return {
        valid: sealed && integrity.valid === true,
        signatureValid: sealed ? integrity.signatureValid === true : null,
        sealed,
        applicable: true,
        ...extra,
        scannedAt: new Date().toISOString(),
    };
}

/**
 * M3: a PLANTING_CYCLE QR has NO cryptographic seal at its OWN granularity — the
 * seal lives at the plot/batch/lot level (cycles are sealed per-plot under
 * entityType 'PLANTING_CYCLE_PLOT' with a composite entityId, never under
 * cycle.id). Calling buildVerification('PLANTING_CYCLE', cycle.id) ALWAYS misses
 * the lookup and reports `valid:false`, which the FE then surfaced as a red
 * "Unverified QR" for EVERY cycle — including fully-certified active ones.
 *
 * The honest verdict at cycle granularity is NOT-APPLICABLE, not "failed". We
 * return `valid:null` + `applicable:false` so the public surface shows the
 * certification STATUS without a false seal-FAILED alarm. (Revoked/expired certs
 * are still 410-gated upstream by evaluateCertGate — that is unaffected.)
 */
function notApplicableVerification(extra = {}) {
    return {
        valid: null,
        signatureValid: null,
        sealed: false,
        applicable: false,
        reason: 'seal_not_at_cycle_granularity',
        ...extra,
        scannedAt: new Date().toISOString(),
    };
}

async function resolveTraceByGenericQr(qrCode, ctx) {
    if (!qrCode) {
        return { status: 400, body: { success: false, message: 'ต้องระบุรหัส QR' } };
    }

    // 1. Try PlantingCycle
    let cycle = null;
    try {
        cycle = await prisma.plantingCycle.findFirst({
            where: {
                OR: [{ id: qrCode }, { uuid: qrCode }],
                isDeleted: false,
            },
            include: {
                farm: {
                    // id ขอเพิ่มเอง: ใช้ภายในเท่านั้น toPublicFarm ไม่เคยตีพิมพ์มัน
                    select: { ...PUBLIC_FARM_SELECT, id: true },
                },
                plantSpecies: {
                    select: { code: true, nameTH: true, nameEN: true, scientificName: true },
                },
                certificate: {
                    select: {
                        id: true, certificateNumber: true, expiryDate: true,
                        issuedDate: true, status: true, standardName: true,
                        application: {
                            select: { labResults: true, labResultStatus: true, labName: true },
                        },
                    },
                },
                batches: {
                    where: { isDeleted: false },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: {
                        // C2-class residual: HarvestBatch has no actualYield/yieldUnit
                        // (kg-only freshWeight/dryWeight) → this select threw, and the
                        // PlantingCycle branch is try/caught → every PlantingCycle QR
                        // scan silently 404'd. The audits caught `species` here but
                        // missed this sub-select.
                        batchNumber: true, harvestDate: true, freshWeight: true,
                        qualityGrade: true, status: true,
                    },
                },
            },
        });
    } catch (_e) { logger.warn('[trace] PlantingCycle query error:', _e?.message); cycle = null; }

    if (cycle) {
        const cert = cycle.certificate;
        // H3: 410-gate a trace whose cert EXISTS but is invalid (revoked/expired).
        // gate.isValid also fixes the casing bug (certs stored 'active' lowercase).
        const gate = evaluateCertGate(cert);
        if (gate.gated) { return { status: 410, body: gate.minimalBody('PLANTING_CYCLE') }; }
        const isValidCert = gate.isValid;
        const response = {
            success: true,
            type: 'PLANTING_CYCLE',
            data: {
                farm: toPublicFarm(cycle.farm),
                plot: {
                    name: cycle.plotName || 'Unknown plot',
                    area: cycle.plotArea,
                    unit: cycle.areaUnit === 'rai' ? 'rai' : cycle.areaUnit,
                },
                plant: {
                    ...toPublicPlant(cycle.plantSpecies),
                    // variety เป็นของ "รอบปลูกนี้" ไม่ใช่ของทะเบียนพืช จึงไม่อยู่ใน projection
                    variety: cycle.varietyName || 'Not specified',
                },
                cultivation: {
                    method: formatCultivationType(cycle.cultivationType),
                    methodCode: cycle.cultivationType,
                    seedSource: cycle.seedSource || 'Not specified',
                    soilType: cycle.soilType || 'Not specified',
                    irrigationType: cycle.irrigationType || 'Not specified',
                    cycleName: cycle.cycleName, cycleNumber: cycle.cycleNumber,
                },
                dates: {
                    planted: cycle.startDate, plantedTH: formatThaiDate(cycle.startDate),
                    expectedHarvest: cycle.expectedHarvestDate, expectedHarvestTH: formatThaiDate(cycle.expectedHarvestDate),
                    actualHarvest: cycle.actualHarvestDate, actualHarvestTH: formatThaiDate(cycle.actualHarvestDate),
                },
                // A PROJECTION IS NOT PUBLIC. `estimatedYield` is what this farm expects
                // to produce this season, and the approved design refuses it twice —
                // §4.4 "ปริมาณ | เฉพาะที่เก็บเกี่ยวแล้วจริง (จาก HarvestBatch) — ไม่มีตัวเลข
                // คาดการณ์" and §5, which lists ตัวเลขคาดการณ์ผลผลิต among the things
                // deliberately not done (2026-08-20-planting-tnt-design.md:80,93).
                //
                // The reason is the farmer's, and commercial: this route has no auth
                // anywhere on its chain, so the number sat beside their farm name, their
                // district and their planting dates for anyone holding the QR — a
                // negotiating position handed to the buyer by the certification system
                // the farmer is obliged to use. The ACTUAL weight stays: it is a fact
                // about produce that already exists, and it is what the scan is for.
                yield: { actual: cycle.actualYield, unit: 'kg' },
                status: cycle.status,
                certificate: cert ? {
                    number: cert.certificateNumber, standard: cert.standardName || 'GACP',
                    issuedDate: cert.issuedDate, issuedDateTH: formatThaiDate(cert.issuedDate),
                    expiryDate: cert.expiryDate, expiryDateTH: formatThaiDate(cert.expiryDate),
                    status: cert.status, isValid: isValidCert,
                } : null,
                // SEC-TRACE-PII-002 / R9 (design note 2026-08-20-planting-tnt-design:
                // 24, 62, 77): the public trace surface may say ONLY whether a lab
                // result exists — never the measured values and never a pass/fail
                // verdict ("ไม่มีไฟล์ ไม่มีค่า ไม่มีสรุปผ่าน/ไม่ผ่าน"). `labName` is
                // the one value R9 explicitly permits ("โดย <ชื่อ Lab>").
                lab_analysis: cert?.application?.labResults ? {
                    tested: true,
                    labName: cert.application.labName || null,
                } : null,
                harvests: cycle.batches.map((b) => ({
                    batchNumber: b.batchNumber, harvestDate: b.harvestDate,
                    harvestDateTH: formatThaiDate(b.harvestDate),
                    yield: b.freshWeight, yieldUnit: 'kg',
                    grade: b.qualityGrade, status: b.status,
                })),
                verification: notApplicableVerification({ certified: isValidCert, verifiedBy: 'DTAM' }),
                disclaimers: SAFETY_DISCLAIMER,
                referrals: { safety: FDA_REFERRAL, medicalEmergency: { phone: '1669', note: 'No additional note' } },
            },
        };
        return { status: 200, body: response, cacheResponse: response };
    }

    // 2. Try HarvestBatch
    let batch = null;
    try {
        batch = await prisma.harvestBatch.findFirst({
            where: {
                OR: [{ qrCode }, { batchNumber: qrCode }, { id: qrCode }],
                isDeleted: false,
            },
            include: {
                farm: {
                    // id ขอเพิ่มเอง: ใช้ภายในเท่านั้น toPublicFarm ไม่เคยตีพิมพ์มัน
                    select: { ...PUBLIC_FARM_SELECT, id: true },
                },
                // C2-class: HarvestBatch's PlantSpecies relation is `plant`, not
                // `species` → this include 500'd; the whole branch is try/caught so
                // every harvest-batch QR scan silently fell through to 404.
                plant: {
                    select: { code: true, nameTH: true, nameEN: true, scientificName: true },
                },
                cycle: {
                    include: {
                        certificate: {
                            select: {
                                id: true, certificateNumber: true, expiryDate: true,
                                issuedDate: true, status: true, standardName: true,
                                application: {
                                    select: { labResults: true, labResultStatus: true, labName: true },
                                },
                            },
                        },
                    },
                },
                lots: {
                    select: { lotNumber: true, packageType: true, quantity: true, status: true },
                },
            },
        });
    } catch (_e) { logger.warn('[trace] HarvestBatch query error:', _e?.message); batch = null; }

    if (batch) {
        let cert = batch.cycle?.certificate;
        // A3 (cross-farm cert ride): never surface a certificate whose cycle
        // belongs to a DIFFERENT farm than the batch — a cross-farm binding
        // would let this batch ride a stranger's valid GACP cert on the public QR.
        if (cert && batch.cycle && String(batch.cycle.farmId) !== String(batch.farmId)) {
            cert = null;
        }
        const gate = evaluateCertGate(cert);
        if (gate.gated) { return { status: 410, body: gate.minimalBody('HARVEST_BATCH') }; }
        const isValidCert = gate.isValid;
        return {
            status: 200,
            body: {
                success: true,
                type: 'HARVEST_BATCH',
                data: {
                    farm: toPublicFarm(batch.farm),
                    plot: {
                        name: batch.plotName || 'Unknown plot',
                        area: batch.plotArea,
                        unit: batch.areaUnit === 'rai' ? 'rai' : batch.areaUnit,
                    },
                    plant: toPublicPlant(batch.plant),
                    cultivation: {
                        method: formatCultivationType(batch.cultivationType),
                        seedSource: batch.seedSource || 'Not specified',
                    },
                    batch: {
                        number: batch.batchNumber,
                        plantingDate: batch.plantingDate, plantingDateTH: formatThaiDate(batch.plantingDate),
                        harvestDate: batch.harvestDate, harvestDateTH: formatThaiDate(batch.harvestDate),
                        yield: batch.freshWeight, // HarvestBatch has no actualYield/yieldUnit (kg-only freshWeight)
                        yieldUnit: 'kg',
                        qualityGrade: batch.qualityGrade, status: batch.status,
                    },
                    certificate: cert ? {
                        number: cert.certificateNumber, standard: cert.standardName || 'GACP',
                        expiryDate: cert.expiryDate, expiryDateTH: formatThaiDate(cert.expiryDate),
                        isValid: isValidCert,
                    } : null,
                    // SEC-TRACE-PII-002 / R9 — see the PLANTING_CYCLE branch above.
                    lab_analysis: cert?.application?.labResults ? {
                        tested: true,
                        labName: cert.application.labName || null,
                    } : null,
                    lots: batch.lots,
                    verification: await buildVerification('HARVEST_BATCH', batch.id, { certified: isValidCert }),
                    disclaimers: SAFETY_DISCLAIMER,
                    referrals: { safety: FDA_REFERRAL, medicalEmergency: { phone: '1669', note: 'No additional note' } },
                },
            },
        };
    }

    // 3. Try Lot
    let lot = null;
    try {
        lot = await prisma.lot.findFirst({
            where: { OR: [{ qrCode }, { lotNumber: qrCode }] },
            include: {
                batch: {
                    include: {
                        farm: {
                            // id ขอเพิ่มเอง: ใช้ภายในเท่านั้น (นับผลแล็บของฟาร์ม)
                            select: { ...PUBLIC_FARM_SELECT, id: true },
                        },
                        plant: true,
                        cycle: { include: { certificate: true } },
                        // T11: the lot has no report of its own — the laboratory
                        // tested the BATCH, and one batch yields many lots.
                        labResults: { where: { isDeleted: false }, orderBy: { uploadedAt: 'desc' } },
                    },
                },
            },
        });
    } catch (e) {
        logger.warn('[trace] Lot query error:', e.message);
        lot = null;
    }

    if (lot) {
        // ผลตรวจของ "ฟาร์มนี้" — คนละคำกล่าวอ้างกับ "ล็อตนี้" จึงอ่านแยกกัน
        // อ่านไม่ได้ = 0 ไม่ใช่การล้ม: บรรทัดของฟาร์มเป็นข้อมูลเสริม ส่วนบรรทัดของล็อต
        // ซึ่งเป็นคำถามที่คนสแกนมาถาม มาจากรุ่นที่โหลดมาพร้อมล็อตแล้ว
        let farmLabResults = [];
        try {
            farmLabResults = await findFarmLabResultMarkers(
                prisma, lot.batch?.farmId || lot.batch?.farm?.id,
            );
        } catch (e) {
            logger.warn(`[trace] farm lab-result count unavailable: ${e && e.message}`);
        }

        let cert = lot.batch?.cycle?.certificate;
        // A3 (cross-farm cert ride): drop the cert when the lot's batch and its
        // cycle belong to different farms (see HARVEST_BATCH branch above).
        if (cert && lot.batch?.cycle && String(lot.batch.cycle.farmId) !== String(lot.batch.farmId)) {
            cert = null;
        }
        const gate = evaluateCertGate(cert);
        if (gate.gated) { return { status: 410, body: gate.minimalBody('LOT') }; }
        return {
            status: 200,
            body: {
                success: true,
                type: 'LOT',
                data: {
                    lot: {
                        lotNumber: lot.lotNumber, packageType: lot.packageType,
                        quantity: lot.quantity, unitWeight: lot.unitWeight,
                        status: lot.status, packagedAt: lot.packagedAt, expiryDate: lot.expiryDate,
                        // T13 — operator ruling 2026-09-05 RETIRES R9's existence-only
                        // rule ("ไม่มีไฟล์ ไม่มีค่า ไม่มีสรุปผ่าน/ไม่ผ่าน"): the COA file,
                        // the laboratory's name and its verification code are published,
                        // because the operator asked for the report itself to be visible
                        // — "ต้องแนบเอกสารนี้ลงไปด้วย ให้เห็นว่าฟาร์มนี้มีผลตรวจ". Logged as a
                        // demo-phase relaxation with a return date in tnt-data-scope.md §7.
                        //
                        // TWO CLAIMS, KEPT APART. `lot` is about the bag in the
                        // scanner's hand; `farm` is about the farm's record. Collapsed
                        // into one line, somebody holding an UNTESTED bag reads that
                        // their bag was tested — every sentence true, the reader misled.
                        // lab-evidence-service refuses to emit a flattened boolean for
                        // exactly that reason.
                        labTest: publicLabProjection({
                            lot,
                            farmLabResults: farmLabResults,
                        }),
                    },
                    batch: lot.batch ? {
                        batchNumber: lot.batch.batchNumber,
                        harvestDate: lot.batch.harvestDate, harvestDateTH: formatThaiDate(lot.batch.harvestDate),
                        plantingDate: lot.batch.plantingDate,
                    } : null,
                    farm: toPublicFarm(lot.batch?.farm),
                    // การเรียกคืน — ประกาศทางนี้ด้วย ผู้สแกนคนเดียวกันต้องได้คำตอบเดียวกัน
                    recall: isRecalled(lot)
                        ? { recalled: true, messageTh: RECALL_PUBLIC_MESSAGE_TH }
                        : null,
                    // เคยเป็น `lot.batch?.plant` — แถว PlantSpecies ทั้งแถว รวม
                    // securityRequirements/productionInputs/isDeleted/uuid ที่ไม่เคยมีมติให้เปิด
                    // ขณะที่สองบล็อกข้างบนในไฟล์นี้ตัดเหลือสี่ฟิลด์มาตลอด (วัดจริง 2026-09-07)
                    plant: toPublicPlant(lot.batch?.plant),
                    certificate: cert ? {
                        number: cert.certificateNumber,
                        expiryDate: cert.expiryDate, expiryDateTH: formatThaiDate(cert.expiryDate),
                        isValid: gate.isValid,
                    } : null,
                    // SEC-TRACE-PII-002 / R9 — see the PLANTING_CYCLE branch above.
                    lab_analysis: cert?.application?.labResults ? {
                        tested: true,
                        labName: cert.application.labName || null,
                    } : null,
                    verification: await buildVerification('PACKAGING_LOT', lot.id),
                    disclaimers: SAFETY_DISCLAIMER,
                    referrals: { safety: FDA_REFERRAL, medicalEmergency: { phone: '1669', note: 'No additional note' } },
                },
            },
        };
    }

    // 4. Try PlantingCyclePlot (plot-cycle) assignment.
    // B3/01-B2 (design note 2026-08-20-planting-tnt-design): a
    // real QR SCAN of a plot-cycle code opens /trace/plot-cycle/[qr-code],
    // which hits the DEDICATED `/api/trace/plot-cycle/:qrCode` route and
    // resolves via resolveTraceByPlotCycleQr(). But typing that SAME code
    // into the public search box (or any /trace/<code> URL) lands here, on
    // the generic cascade — which, before this fallback, only knew about
    // PlantingCycle/HarvestBatch/Lot and always 404'd a perfectly valid
    // plot-cycle code. Delegating to the SAME resolver a scan uses (rather
    // than re-deriving a second projection) guarantees manual entry
    // resolves to the IDENTICAL response shape — same R9 exposure limits,
    // same fields, same cert-gate behavior.
    try {
        const plotCycleResult = await resolveTraceByPlotCycleQr(qrCode, ctx);
        if (plotCycleResult && plotCycleResult.status !== 404) {
            return plotCycleResult;
        }
    } catch (_e) {
        logger.warn('[trace] PlotCycle fallback query error:', _e?.message);
    }

    // 5. Not found
    logger.warn({ type: 'trace_not_found', qrCode, ip: ctx.requestIp, userAgent: ctx.userAgent }, 'QR code trace failed');
    return {
        status: 404,
        body: {
            success: false,
            message: TRACE_NOT_FOUND_MESSAGE,
            messageEN: 'QR code not found. This product may not be registered in our system.',
            verification: { valid: false, scannedAt: new Date().toISOString() },
            disclaimers: SAFETY_DISCLAIMER,
            referrals: { safety: FDA_REFERRAL, medicalEmergency: { phone: '1669', note: 'No additional note' } },
        },
    };
}

// ─── Module Exports ─────────────────────────────────────────

module.exports = {
    resolveTraceByGenericQr,
};
