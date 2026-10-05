const {
    prisma,
    qrcodeService,
    logger,
    formatThaiDate,
    parseJsonMetaFromNotes,
    normalizeSourceFromPayload,
    buildIntegrityPayload,
    SAFETY_DISCLAIMER,
    FDA_REFERRAL,
    PLOT_HARVEST_META_PREFIX,
    TRACE_NOT_FOUND_MESSAGE,
} = require('./common');
const { normalizePlotCode } = require('../../shared/plot-code');

/**
 * A cycle is OPEN while the crop is still standing on the land.
 *
 * R15 (design note 2026-08-20-planting-tnt-design): one plot has at most
 * one open cycle at a time, so "the current cycle" always has exactly one answer and the
 * farmer never picks a season. Harvest closes it — the spec is explicit that drying a
 * previous round runs in parallel and does NOT count as open, because the goods have
 * already left the land.
 *
 * Statuses are the ones PlantingCycle.status documents
 * (prisma/schema/cultivation.prisma:53-54): PLANNING → PLANTED → GROWING →
 * READY_HARVEST → HARVESTED → COMPLETED. The first four are open; HARVESTED, COMPLETED
 * and anything cancelled are not. Listing the OPEN ones rather than excluding the closed
 * ones is deliberate: a status added later defaults to "not open", so an unknown state
 * can never silently start answering a field sign.
 */
const OPEN_CYCLE_STATUSES = ['PLANNING', 'PLANTED', 'GROWING', 'READY_HARVEST'];

/**
 * The public URL a plot code resolves to.
 *
 * `/trace/plot-cycle/<code>` and not `/trace/<code>`, even though the API resolves the
 * code on both: only the plot-cycle page renders THIS payload shape
 * (apps/web-app/src/app/trace/plot-cycle/[qr-code]/client-view.tsx:153, which fetches
 * /api/trace/plot-cycle/:qrCode). The generic /trace/[qr-code] page reads data.plant and
 * data.farm.location — fields a plot projection does not have — so pointing a permanent
 * field sign there would mint a QR that resolves in the API and renders as a broken page.
 *
 * The path segment says "plot-cycle" while the code is permanently the plot's; that is a
 * wart, and the honest fix is a /trace/plot/<code> page. It belongs to whoever owns the
 * web app: minting URLs today that no page serves would be worse than an ugly one that
 * works. Mirrors planting-cycle-service.js:107 so both places build the same path.
 */
function buildPlotTracePath(code) {
    return `plot-cycle/${encodeURIComponent(String(code || '').trim())}`;
}

// One projection for the assignment, used by BOTH lookup paths. A plot-code scan and a
// legacy cycle-plot QR scan must return the same fields, and the surest way to promise
// that is for them to select the same columns through the same object.
const ASSIGNMENT_INCLUDE = {
    plot: {
        select: { id: true, name: true, solarSystem: true, plotCode: true },
    },
    cycle: {
        select: {
            id: true, cycleName: true, status: true,
            startDate: true, expectedHarvestDate: true, cultivationType: true,
            farm: { select: { id: true, farmName: true, address: true, subDistrict: true, district: true, province: true, postalCode: true } },
            // requiresLicense drives redactPublicPlotPayload below. Selected
            // here rather than looked up later so the redaction decision can
            // never run without the flag that decides it.
            plantSpecies: { select: { code: true, nameTH: true, nameEN: true, requiresLicense: true } },
            // สถานะใบรับรองของรอบนี้ — ป้ายกลางแปลงเคยเงียบเรื่องนี้ทั้งที่หน้าล็อตและหน้ารุ่น
            // ตอบ 410 เมื่อใบไม่มีผล · เลือกมาเฉพาะสองคอลัมน์ที่ใช้ตัดสิน ไม่ดึงเลขที่ใบมาด้วย
            certificate: { select: { status: true, expiryDate: true } },
        },
    },
};

/**
 * Write the public-scan audit row.
 *
 * Lifted out of the resolver body unchanged so the three scan outcomes — a cycle
 * resolved, a dormant plot, a revoked sign — all leave the same kind of trace. A revoked
 * sign being scanned is the one worth reading later: it says someone still has the code.
 */
async function logPublicScan(resourceId, metadata, ctx) {
    try {
        const { auditLogger, AuditCategory, AuditSeverity, ResourceType } =
            require('../../middleware/audit-logger');
        await auditLogger.log({
            category: AuditCategory.SYSTEM,
            action: 'PUBLIC_TRACE_ACCESS',
            severity: AuditSeverity.INFO,
            actorId: 'ANONYMOUS',
            actorRole: 'PUBLIC',
            actorType: 'SYSTEM',
            resourceType: ResourceType.SYSTEM,
            resourceId: String(resourceId),
            ipAddress: ctx.requestIp,
            userAgent: ctx.userAgent || 'unknown',
            metadata: { ...metadata, timestamp: new Date().toISOString() },
        });
    } catch (_e) {
        logger.debug('Audit log skipped (table may not exist)');
    }
}

/**
 * สถานะใบรับรองเท่าที่ป้ายกลางแปลงพูดได้
 *
 * หน้าล็อตและหน้ารุ่นตอบ 410 เมื่อใบรับรองถูกเพิกถอนหรือหมดอายุ · หน้าแปลงไม่มีฟิลด์
 * เกี่ยวกับใบรับรองเลย จึงตอบ 200 พร้อมหน้าตาของระบบ GACP ให้ที่ดินที่ใบหมดอายุไปแล้ว
 * (วัดจริง 2026-09-06)
 *
 * ที่เพิ่มตรงนี้คือ **ความจริง ไม่ใช่การปิดหน้า** — สถานะ HTTP ไม่เปลี่ยน และไม่มีข้อมูลใด
 * ถูกเอาออก · การเลือกว่าจะปิดหน้าเหมือนล็อตหรือให้หน้าบอกความจริง เป็นการตัดสินใจเชิง
 * ออกแบบของ operator แต่การ **เงียบ** ไม่ใช่ทางเลือกในนั้น: หลักข้อ 1 ของสเปกขอบเขต
 * ข้อมูลเขียนว่า "ข้อมูลเปิดมีไว้ให้ตรวจสอบคุณภาพ" และคนที่ตรวจคุณภาพต้องรู้ว่าการรับรอง
 * ยังมีผลหรือไม่
 *
 * ปล่อยแค่ `status` กับ `isValid` — ไม่มีเลขที่ใบ ไม่มีวันที่ ไม่มี id · ป้ายกลางแปลงตอบใคร
 * ก็ได้ที่เดินผ่าน (ตัวตนฟาร์มเปิดตามมติ 2026-09-06 — ที่ยังปิดคือตัวเลขคาดการณ์)
 */
function publicCertificateState(certificate) {
    if (!certificate) { return { status: 'NONE', isValid: false }; }
    const raw = String(certificate.status || '').toUpperCase();
    if (raw && raw !== 'ACTIVE') {
        // เพิกถอน/ระงับ ชนะวันหมดอายุเสมอ — เป็นการตัดสินของกรมฯ ไม่ใช่การหมดเวลา
        return { status: raw, isValid: false };
    }
    const expired = certificate.expiryDate && new Date(certificate.expiryDate) < new Date();
    return expired ? { status: 'EXPIRED', isValid: false } : { status: 'ACTIVE', isValid: true };
}

/**
 * Strip the plot page down for a controlled species.
 *
 * The plot QR is a sign standing in a field, so this payload answers to anyone who
 * photographs it. What it must NOT advertise for a controlled species is the
 * READINESS/QUANTITY story — plant count, area, expected harvest date, and the
 * farmer's own plot/cycle names (enumeration handles). The farm's IDENTITY is a
 * different question with the opposite answer: the operator's open-farm ruling
 * (2026-09-05, reaffirmed for this door 2026-09-06 / F-WALK-04) opens name and
 * address on every public scan door, and batch/lot already print them.
 *
 * ประกาศ สธ. สมุนไพรควบคุม (กัญชา) พ.ศ. 2568 ข้อ ๔(๖)(๗) prohibits selling through
 * electronic channels and advertising, and a page naming a farm, its location, its
 * quantity and its readiness date reads closer to a listing than to a record.
 *
 * Driven by PlantSpecies.requiresLicense (prisma/schema/trace.prisma:194), which
 * already marks cannabis and kratom — not by a species list in code, and not by a
 * blanket switch that would strip turmeric and ginger for no legal reason.
 *
 * Unknown species are treated as controlled. Guessing wrong in that direction costs a
 * buyer some convenience; guessing wrong the other way publishes a cannabis field's
 * address.
 *
 * What survives is what a buyer needs and what TAS 3502-2561 clause 8(2) asks for —
 * that origin be checkable. It does not ask that the grower be locatable.
 */
function redactPublicPlotPayload(data, species = {}) {
    if (species && species.requiresLicense === false) {
        return data;
    }
    if (!data || typeof data !== 'object') {
        return data;
    }

    return {
        ...data,
        // Farm IDENTITY stays open — operator ruling 2026-09-06 (F-WALK-04,
        // "แก้เลย ผมเข้าใจผิด"): the 2026-09-05 open-farm ruling ("เมื่อสแกน
        // ต้องเห็นทั้งหมด") governs every public trace door, and the batch/lot
        // doors already print this same farm in full. Masking it here made the
        // three doors disagree about one farm ("public scan has two doors").
        // What this function still withholds below is the OTHER ruling —
        // readiness/quantity forecasts and plot/cycle enumeration handles —
        // which the farm-identity relaxation never touched. GPS coordinates
        // remain absent at the SELECT layer, as everywhere.
        farm: data.farm,
        source: data.source
            ? {
                ...data.source,
                plot: data.source.plot ? { ...data.source.plot, plotName: null } : data.source.plot,
            }
            : data.source,
        cycle: data.cycle
            ? { ...data.cycle, expectedHarvestDate: null, expectedHarvestDateTH: null }
            : data.cycle,
        plot: data.plot
            ? { ...data.plot, name: null, allocatedAreaSqm: null, plannedPlantCount: null }
            : data.plot,
        // There is no `plantUnits` key left to redact: R8 of
        // design note 2026-08-20-planting-tnt-design retired
        // per-plant tracking on 2026-08-25, so the public plot body no longer
        // carries a per-plant count in either the open or the redacted form.
        // The declared plant count for a controlled species is still withheld —
        // it is `plot.plannedPlantCount`, nulled above.
    };
}

/**
 * The answer for a plot with no open cycle — between harvest and the next planting.
 *
 * This is a real and frequent state, not an error. The sign is nailed to a post on land
 * that exists, is registered, and will be planted again; 404 would tell the person
 * holding the phone that the land is unknown to the platform, which is false, and would
 * send a farmer hunting for a broken QR that is not broken. It would also make the
 * dormant months indistinguishable from a code that was never issued — the one case
 * where "not found" is the truth.
 *
 * So: 200, with a DIFFERENT type. `PLOT` rather than `PLOT_CYCLE`, because a body typed
 * PLOT_CYCLE with `cycle: null` is a lie about its own shape and every consumer would
 * learn to null-check a field the type promises. A separate type forces the one branch
 * that has to exist anyway — the page says "no open round; start one" instead of showing
 * cycle facts — and no existing PLOT_CYCLE consumer ever receives it.
 *
 * Redacted as CONTROLLED. With no cycle there is no species, and redactPublicPlotPayload
 * already argues why unknown resolves to controlled: guessing wrong that way costs a
 * buyer some convenience, guessing wrong the other way publishes a cannabis field's
 * address. It is not worth reading the last CLOSED cycle to recover the species —
 * un-redacting a dormant plot buys nothing a scanner needs, and it would make the page
 * leak more the longer the land sits idle.
 */
function buildDormantPlotBody(plot, requestedQrCode) {
    const scannedAt = new Date().toISOString();
    const publicData = {
        qrCode: plot.plotCode,
        requestedQrCode,
        plotCode: plot.plotCode,
        trackingUrl: qrcodeService.generatePublicTraceUrl(buildPlotTracePath(plot.plotCode)),
        farm: plot.farm ? {
            name: plot.farm.farmName || null,
            // Kept for FE compatibility; identical policy to batch/lot now — the
            // full identity is open (operator ruling 2026-09-06, F-WALK-04).
            alias: `${String(plot.farm.farmName || '').slice(0, 2)}***`,
            address: plot.farm.address || null,
            subDistrict: plot.farm.subDistrict || null,
            postalCode: plot.farm.postalCode || null,
            district: plot.farm.district || null,
            province: plot.farm.province || null,
        } : null,
        source: {
            plot: { plotId: plot.id, plotName: plot.name || null, cyclePlotId: null },
            cycle: null,
            cultivationMethod: plot.solarSystem || null,
        },
        cycle: null,
        hasOpenCycle: false,
        plotStatus: 'NO_OPEN_CYCLE',
        plot: {
            id: plot.id,
            code: plot.plotCode,
            name: plot.name || null,
            // Nothing is allocated and nothing is planted while the plot is between
            // cycles. Reporting Plot.area here instead would publish a number in the
            // plot's own unit (rai as often as sqm) under a key named ...Sqm — a silent
            // unit bug on a public page. Null says "no allocation", which is the truth.
            allocatedAreaSqm: null,
            plannedPlantCount: null,
        },
        traceSummary: { batchCount: 0, lotCount: 0, latestBatch: null, latestLots: [] },
        links: { requiresAuthentication: true, latestBatchUrl: null },
        species: null,
        // The plot code is a random column value, not a signed payload: no cryptographic
        // seal was checked here, and claiming one would be the kind of green tick that
        // means nothing. `valid` reports only that the code resolved to a real plot.
        verification: { valid: true, sealed: false, scannedAt },
        integrity: buildIntegrityPayload({ available: false, valid: null }),
        disclaimers: SAFETY_DISCLAIMER,
        referrals: { safety: FDA_REFERRAL },
    };

    return {
        success: true,
        type: 'PLOT',
        message: 'แปลงนี้ยังไม่มีรอบปลูกที่เปิดอยู่ / This plot has no open planting cycle',
        data: redactPublicPlotPayload(publicData, {}),
    };
}

/**
 * The answer for a sign that has been revoked.
 *
 * qrRevokedAt is set when the sign is lost, stolen or photographed by someone who should
 * not have it (prisma/schema/farm.prisma:245). Whoever is scanning now may be exactly the
 * person it was revoked against, so the page must stop before it reads the land: no farm,
 * no plot name, no location, no cycle. Nothing is fetched about the plot beyond the row
 * already in hand, and nothing about it is published.
 *
 * 410 rather than 404 because the distinction is the whole message — this code was real
 * and is deliberately no longer served, which tells the FARMER (who scans his own faded
 * sign and reads this) to get a reprint, while a 404 would send him hunting for a typo.
 * 410 is already this surface's word for "existed, no longer valid": resolve-generic.js
 * uses it for revoked and expired certificates.
 */
function buildRevokedSignBody() {
    return {
        success: false,
        type: 'PLOT',
        message: 'ป้ายรหัสแปลงนี้ถูกยกเลิกแล้ว กรุณาติดต่อเจ้าของแปลงเพื่อขอป้ายใหม่ '
            + '/ This plot sign has been revoked',
        verification: {
            valid: false,
            sealed: false,
            reason: 'plot_sign_revoked',
            scannedAt: new Date().toISOString(),
        },
    };
}

async function resolveTraceByPlotCycleQr(qrCode, ctx) {
    if (!qrCode) {
        return { status: 400, body: { success: false, message: 'ต้องระบุรหัส QR' } };
    }

    const encodedLookup = encodeURIComponent(qrCode);
    const legacyPublicPath = `/trace/plot-cycle/${encodedLookup}`;

    const loadAssignmentById = (cyclePlotId) => prisma.plantingCyclePlot.findUnique({
        where: { id: String(cyclePlotId) },
        include: ASSIGNMENT_INCLUDE,
    });

    let securityRecord = null;
    let assignment = null;

    // ── Plot code: the sign standing in the field ──
    //
    // มกษ. 3502-2561 ข้อ 8(1) asks for a plot code; Plot.plotCode is it, and it is the
    // only identifier here that outlives a season. Everything below this block hangs off
    // TraceQrSecurity rows of entityType PLANTING_CYCLE_PLOT, which are unique per
    // (cycle, plot) — so before this, a sign had to be reprinted every round.
    //
    // The plot code is tried FIRST, but only when the string actually IS one:
    // normalizePlotCode enforces the shape shared/plot-code.js mints — the PLOT prefix
    // then two groups of five over the Layer 1 alphabet, e.g. PLOT-7F2KX-M9QRT — and every
    // existing plot-cycle qrCode is a UUID (qrcode-service.js:101 —
    // crypto.randomUUID()), which cannot match that shape. And when the code is
    // well-formed but no plot carries it, this falls THROUGH to the four strategies
    // below rather than returning, so the only way this block can change an existing
    // scan's answer is by finding a plot that owns the scanned code.
    //
    // The farmer never picks a season: R15 gives the plot at most one open cycle, so the
    // sign resolves to the round that is actually growing, and the projection built below
    // is the same one a cycle-plot QR produces.
    const plotCode = normalizePlotCode(qrCode);
    if (plotCode) {
        try {
            const plot = await prisma.plot.findUnique({
                where: { plotCode },
                select: {
                    id: true, plotCode: true, name: true, area: true, areaUnit: true,
                    solarSystem: true, qrIssuedAt: true, qrRevokedAt: true,
                    farm: { select: { id: true, farmName: true, address: true, subDistrict: true, district: true, province: true, postalCode: true } },
                },
            });

            if (plot?.qrRevokedAt) {
                await logPublicScan(plot.id, {
                    entityType: 'PLOT', plotCode, revoked: true,
                }, ctx);
                return { status: 410, body: buildRevokedSignBody() };
            }

            if (plot) {
                assignment = await prisma.plantingCyclePlot.findFirst({
                    where: {
                        plotId: plot.id,
                        cycle: { isDeleted: false, status: { in: OPEN_CYCLE_STATUSES } },
                    },
                    // R15 promises one open cycle per plot; the ordering is what happens
                    // if that promise is ever broken — the newest round answers, not an
                    // arbitrary row. It is a tiebreak, not a season picker.
                    orderBy: { createdAt: 'desc' },
                    include: ASSIGNMENT_INCLUDE,
                });

                if (!assignment) {
                    await logPublicScan(plot.id, {
                        entityType: 'PLOT', plotCode, hasOpenCycle: false,
                    }, ctx);
                    return { status: 200, body: buildDormantPlotBody(plot, qrCode) };
                }

                // The plot code is an ENTRY POINT, not a link in the evidence chain. The
                // chain still runs package -> lot -> harvest -> cycle -> plot ->
                // certificate: this only picks the same assignment row a cycle-plot QR
                // would have pointed at, then reuses that row's own seal.
                //
                // Deliberately unfiltered by TraceQrSecurity.status: whether the SIGN is
                // valid is Plot.qrRevokedAt's business and was decided above, and all
                // this row contributes here is its stored payload (cultivationMethod) —
                // the same data whether the season's old QR was retired or not.
                const sealed = await prisma.traceQrSecurity.findFirst({
                    where: { entityType: 'PLANTING_CYCLE_PLOT', entityId: assignment.id },
                    orderBy: { updatedAt: 'desc' },
                    select: { id: true, entityId: true, payload: true, publicUrl: true, qrCode: true },
                });

                securityRecord = {
                    ...(sealed || { id: null, entityId: assignment.id, payload: null }),
                    // What the page reports is the code that was scanned and the URL that
                    // will keep working next season — not the seasonal UUID behind it.
                    qrCode: plotCode,
                    publicUrl: qrcodeService.generatePublicTraceUrl(buildPlotTracePath(plotCode)),
                };
            }
        } catch (error) {
            // A plot-code lookup that throws must not take an existing QR down with it:
            // fall through to the four strategies below. Logged, never swallowed
            // silently.
            logger.warn('[trace] plot-code lookup failed', { error: error.message });
            assignment = null;
            securityRecord = null;
        }
    }

    // ── QR Lookup (4 fallback strategies) ──
    //
    // Unchanged. Every live TraceQrSecurity row still resolves through exactly these
    // strategies: the plot-code block above only ever runs for a string shaped like a
    // plot code, and hands over to this the moment no plot owns that code.
    const resolveFromQrSecurity = async () => {
        let securityRecord = await prisma.traceQrSecurity.findFirst({
            where: {
                entityType: 'PLANTING_CYCLE_PLOT',
                OR: [{ qrCode }, { id: qrCode }],
                status: 'ACTIVE',
            },
            select: { id: true, entityId: true, payload: true, publicUrl: true, qrCode: true },
        });

        if (!securityRecord) {
            securityRecord = await prisma.traceQrSecurity.findFirst({
                where: { entityType: 'PLANTING_CYCLE_PLOT', entityId: qrCode, status: 'ACTIVE' },
                select: { id: true, entityId: true, payload: true, publicUrl: true, qrCode: true },
            });
        }

        if (!securityRecord) {
            securityRecord = await prisma.traceQrSecurity.findFirst({
                where: {
                    entityType: 'PLANTING_CYCLE_PLOT',
                    publicUrl: { contains: legacyPublicPath },
                    status: 'ACTIVE',
                },
                select: { id: true, entityId: true, payload: true, publicUrl: true, qrCode: true },
            });
        }

        if (!securityRecord) {
            securityRecord = await prisma.traceQrSecurity.findFirst({
                where: {
                    entityType: 'PLANTING_CYCLE_PLOT',
                    OR: [
                        { id: qrCode }, { qrCode }, { entityId: qrCode },
                        { publicUrl: { contains: legacyPublicPath } },
                    ],
                },
                orderBy: { updatedAt: 'desc' },
                select: { id: true, entityId: true, payload: true, publicUrl: true, qrCode: true },
            });
        }

        // ── Assignment resolution ──
        let assignment = securityRecord?.entityId
            ? await loadAssignmentById(securityRecord.entityId)
            : null;

        if (!assignment) {
            const candidateRows = await prisma.traceQrSecurity.findMany({
                where: {
                    entityType: 'PLANTING_CYCLE_PLOT',
                    OR: [
                        { qrCode }, { id: qrCode }, { entityId: qrCode },
                        { publicUrl: { contains: legacyPublicPath } },
                    ],
                },
                orderBy: { updatedAt: 'desc' },
                take: 20,
                select: { id: true, entityId: true, payload: true, publicUrl: true, qrCode: true },
            });

            for (const candidate of candidateRows) {
                const matchedAssignment = candidate?.entityId ? await loadAssignmentById(candidate.entityId) : null;
                if (matchedAssignment?.cycle) {
                    securityRecord = candidate;
                    assignment = matchedAssignment;
                    break;
                }
            }
        }

        if (!assignment && qrCode) {
            assignment = await loadAssignmentById(qrCode);
            if (assignment) {
                securityRecord = securityRecord || {
                    id: null,
                    entityId: assignment.id,
                    payload: null,
                    publicUrl: qrcodeService.generatePublicTraceUrl(`plot-cycle/${encodedLookup}`),
                    qrCode,
                };
            }
        }
        return { securityRecord, assignment };
    };

    if (!assignment) {
        const legacy = await resolveFromQrSecurity();
        securityRecord = legacy.securityRecord;
        assignment = legacy.assignment;
    }

    if (!securityRecord?.entityId || !assignment?.cycle) {
        return {
            status: 404,
            body: {
                success: false,
                message: TRACE_NOT_FOUND_MESSAGE,
                verification: { valid: false, scannedAt: new Date().toISOString() },
            },
        };
    }

    // ── Audit + integrity scan ──
    // Route through the canonical audit-logger instead of writing directly
    // to prisma.auditLog — same fix as common.js:logPublicTraceAccess().
    // The previous direct create was doubly broken (missing organizationId
    // + missing hash-chain fields + wrong column names) and the .catch
    // silently dropped every audit row.
    await logPublicScan(assignment.id, {
        entityType: 'PLOT_CYCLE',
        qrCode: securityRecord.qrCode || qrCode,
        plotCode: assignment.plot?.plotCode || null,
        cycleId: assignment.cycleId,
        plotId: assignment.plotId,
    }, ctx);

    const integrity = await qrcodeService.recordTraceScan('PLANTING_CYCLE_PLOT', assignment.id, {
        requestIp: ctx.requestIp,
        userAgent: ctx.userAgent,
        requestPath: ctx.originalUrl,
    }).catch((error) => {
        logger.warn('[trace] plot-cycle integrity verification failed', {
            error: error.message,
            cyclePlotId: assignment.id,
        });
        return { available: false, valid: null };
    });

    // ── Data aggregation ──
    const payloadSource = normalizeSourceFromPayload(securityRecord.payload);
    const cultivationMethod = payloadSource.cultivationMethod
        || assignment.plot?.solarSystem
        || assignment.cycle.cultivationType
        || null;

    // Only harvest batches are queried here. The PlantUnit groupBy that used to
    // sit alongside it was removed on 2026-08-25 (R8,
    // design note 2026-08-20-planting-tnt-design): the public plot
    // page resolves to cycle / plot and Lot, and never counts individual plants.
    const cycleBatches = await prisma.harvestBatch.findMany({
        where: { cycleId: assignment.cycle.id, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true, batchNumber: true, trackingUrl: true, createdAt: true, notes: true,
            lots: {
                where: { isDeleted: false },
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: { id: true, lotNumber: true, trackingUrl: true, qrCode: true, createdAt: true },
            },
            _count: { select: { lots: true } },
        },
    });

    const batches = cycleBatches.filter((batch) => {
        const noteMeta = parseJsonMetaFromNotes(batch.notes, PLOT_HARVEST_META_PREFIX);
        const source = noteMeta && typeof noteMeta === 'object' && noteMeta.source && typeof noteMeta.source === 'object'
            ? noteMeta.source
            : null;
        const sourceCyclePlotId = String(source?.cyclePlotId || '').trim();
        return sourceCyclePlotId === assignment.id;
    });

    const lotCount = batches.reduce((sum, batch) => sum + Number(batch?._count?.lots || 0), 0);
    const latestLots = batches
        .flatMap((batch) => (batch?.lots || []).map((lot) => ({
            id: lot.id,
            lotNumber: lot.lotNumber,
            trackingUrl: lot.trackingUrl || null,
            qrCode: lot.qrCode || null,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            createdAt: lot.createdAt || null,
        })))
        .sort((a, b) => {
            const tsA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tsB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return tsB - tsA;
        })
        .slice(0, 10);

    // ── Build response ──
    //
    // The plot page is public and unauthenticated, so the payload is built in full and
    // then redacted for a controlled species — see redactPublicPlotPayload. Built-then-
    // redacted rather than conditionally assembled so there is exactly one place to read
    // when asking what a stranger can see.
    const publicData = {
                qrCode: securityRecord.qrCode || qrCode,
                requestedQrCode: qrCode,
                // The permanent code of the land, on every plot page — including one
                // reached by an old seasonal QR, so a reader can copy it onto the sign
                // that replaces it. Null until the backfill reaches this row
                // (prisma/backfill-plot-codes.js). Never redacted: it is the string the
                // scanner already holds, and withholding it would only stop the page
                // being checkable against the post it is standing next to.
                plotCode: assignment.plot?.plotCode || null,
                // ป้ายบอกว่าการรับรองของแปลงนี้ยังมีผลหรือไม่ — ดู publicCertificateState
                certificate: publicCertificateState(assignment.cycle.certificate),
                hasOpenCycle: true,
                trackingUrl: securityRecord.publicUrl,
                farm: assignment.cycle.farm ? {
                    name: assignment.cycle.farm.farmName || null,
                    alias: `${String(assignment.cycle.farm.farmName || '').slice(0, 2)}***`,
                    district: assignment.cycle.farm.district || null,
                    province: assignment.cycle.farm.province || null,
                } : null,
                source: {
                    plot: {
                        plotId: assignment.plot?.id || null,
                        plotName: assignment.plot?.name || null,
                        cyclePlotId: assignment.id,
                    },
                    cycle: {
                        cycleId: assignment.cycle.id,
                        cycleName: assignment.cycle.cycleName,
                    },
                    cultivationMethod,
                },
                cycle: {
                    id: assignment.cycle.id,
                    name: assignment.cycle.cycleName,
                    status: assignment.cycle.status,
                    startDate: assignment.cycle.startDate,
                    startDateTH: formatThaiDate(assignment.cycle.startDate),
                    expectedHarvestDate: assignment.cycle.expectedHarvestDate,
                    expectedHarvestDateTH: formatThaiDate(assignment.cycle.expectedHarvestDate),
                },
                plot: {
                    id: assignment.plot?.id || null,
                    name: assignment.plot?.name || null,
                    allocatedAreaSqm: Number(assignment.allocatedAreaSqm || 0),
                    plannedPlantCount: Number(assignment.plannedPlantCount || 0),
                },
                // No `plantUnits` key. R8
                // (design note 2026-08-20-planting-tnt-design)
                // retires per-plant tracking, so the public body stopped
                // publishing a per-plant count on 2026-08-25 rather than
                // publishing a zero. The declared plant count a scanner should
                // read is `plot.plannedPlantCount` above — one field, one
                // meaning, sourced from the plot assignment the farmer filled in.
                traceSummary: {
                    batchCount: batches.length,
                    lotCount,
                    latestBatch: batches[0] ? {
                        id: batches[0].id,
                        batchNumber: batches[0].batchNumber,
                        trackingUrl: batches[0].trackingUrl || null,
                        lotCount: Number(batches[0]?._count?.lots || 0),
                    } : null,
                    latestLots,
                },
                links: {
                    // `healthPlantingUnitsUrl` is gone (R8, 2026-08-25): it deep-linked
                    // into the retired per-plant units tab, so it now points nowhere.
                    requiresAuthentication: true,
                    latestBatchUrl: batches[0]?.trackingUrl || null,
                },
                species: assignment.cycle.plantSpecies ? {
                    code: assignment.cycle.plantSpecies.code,
                    nameTH: assignment.cycle.plantSpecies.nameTH,
                    nameEN: assignment.cycle.plantSpecies.nameEN,
                } : null,
                verification: { valid: true, scannedAt: new Date().toISOString() },
                integrity: buildIntegrityPayload(integrity),
                disclaimers: SAFETY_DISCLAIMER,
                referrals: { safety: FDA_REFERRAL },
    };

    return {
        status: 200,
        body: {
            success: true,
            type: 'PLOT_CYCLE',
            data: redactPublicPlotPayload(publicData, assignment.cycle.plantSpecies || {}),
        },
    };
}

// ─── Full Handler Logic: GET /:qrCode ───────────────────────

/**
 * Resolve trace data for a generic QR code.
 * Cascading lookup: PlantingCycle → HarvestBatch → Lot → 404.
 *
 * @param {string} qrCode
 * @param {{ requestIp: string, userAgent: string }} ctx
 * @returns {Promise<{ status: number, body: object, cacheResponse?: object }>}
 */

module.exports = {
    resolveTraceByPlotCycleQr,
    // ส่งออกเพื่อให้ยืนยันสถานะที่ป้ายพูดได้ โดยไม่ต้องตั้งฐานข้อมูลขึ้นมาทั้งชุด
    publicCertificateState,
    // Exported so the controlled-species redaction can be asserted directly, without
    // standing up a database to reach the resolver.
    redactPublicPlotPayload,
    // Exported so the next place that needs "the plot's current cycle" — the
    // authenticated recording flow, above all — reads the same list instead of writing a
    // second one. Two definitions of "open" is how a sign and a form end up disagreeing
    // about which round the farmer is standing in.
    OPEN_CYCLE_STATUSES,
};
