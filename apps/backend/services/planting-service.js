const { prisma } = require('./prisma-database');
const { checkPlotsAgainstCertifiedScope } = require('./planting-area-type-gate');
const { AREA_UNIT, storedAreaToSqm, plotAreaSqm } = require('../shared/area-utils');
// Wave A chunk 3 (2026-07-02): owner-pinned cycle listing widens to
// owner-OR-ACTIVE-entity-co-member (services/farm-access.js predicate).
const { farmAccessWhere } = require('./farm-access');
const { getPlantingCycleById } = require('./planting/planting-cycle-detail-loader');
function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
function roundSqm(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}
/**
 * A cycle OCCUPIES its plot while the crop is still standing on the land.
 *
 * R15 (design note 2026-08-20-planting-tnt-design:152): "หนึ่งพื้นที่ปลูก
 * มีรอบที่เปิดอยู่ได้ครั้งละหนึ่งรอบเท่านั้น" — close the old round (harvest) before starting a
 * new one, so "the current cycle" of a plot always has exactly one answer. The spec is
 * explicit that DRYING the previous round runs in parallel and does NOT keep the plot
 * occupied, because the goods have already left the ground: HARVESTED and COMPLETED are
 * therefore free, and so is anything soft-deleted or cancelled.
 *
 * Statuses are the ones PlantingCycle.status documents (prisma/schema/cultivation.prisma:53-54):
 * PLANNING → PLANTED → GROWING → READY_HARVEST → HARVESTED → COMPLETED. Listing the OPEN
 * ones instead of excluding the closed ones is deliberate: a status added later defaults to
 * "not open", so an unknown state can never silently occupy a plot forever.
 *
 * WHY THE LIST IS RE-STATED HERE and not imported from its twin in
 * services/trace-service/resolve-plot-cycle.js:32 — requiring that module pulls
 * trace-service/common.js, which boots `server.js` and the production-secret checks at
 * require time; planting-service is required by nearly every cultivation route and unit
 * suite, so importing it would drag a server boot into all of them. The two lists MUST stay
 * identical (a sign and a form disagreeing about which round the farmer is standing in is
 * exactly the failure R15 exists to prevent); __tests__/unit/planting-open-cycle-status-
 * vocabulary.test.js fails if they ever drift apart.
 */
/**
 * Every status a planting cycle may hold, in lifecycle order — the list documented beside
 * the column itself (prisma/schema/cultivation.prisma:53-54).
 *
 * This exists because the column is a plain String, so until 2026-08-26 `updateCycle` wrote
 * whatever arrived: `PATCH /:id {status:'paused'}` stored 'PAUSED', which is in no list at
 * all. That was not a typo hazard, it was a hole straight through R15 — a status outside
 * OPEN_CYCLE_STATUSES means the plot reads as free, so two ordinary requests (invent a
 * status, then create) put a second standing crop on the same ground and the rule that is
 * supposed to stop produce being laundered through a certified plot was gone. An adversarial
 * review found it by trying it.
 *
 * A closed set is what makes OPEN_CYCLE_STATUSES meaningful: a value can now only ever be
 * inside it or deliberately outside it, never accidentally neither.
 */
const CYCLE_STATUSES = ['PLANNING', 'PLANTED', 'GROWING', 'READY_HARVEST', 'HARVESTED', 'COMPLETED'];

const OPEN_CYCLE_STATUSES = ['PLANNING', 'PLANTED', 'GROWING', 'READY_HARVEST'];
/**
 * R15 gate. Throws if any of `plotIds` is already held by an OPEN cycle.
 *
 * Lives in the service, not in a route handler, so every door that opens or re-plots a
 * cycle through this service inherits it — the audit-evidence chain cost this repo a
 * finding for enforcing a rule at one door only.
 *
 * `client` is the transaction client at the call sites, so the read and the write that
 * follows it sit in one transaction. That NARROWS the two-requests-at-once race; it does
 * not close it (READ COMMITTED lets both transactions read "free" before either commits).
 * The closing move is a partial unique index in the database — see the ledger note for
 * F-G4-21; it needs a migration, which is an operator-merged change.
 *
 * @param {object} client prisma or a transaction client
 * @param {string[]} plotIds plots the cycle is being placed on
 * @param {Map<string, {id: string, name: string}>} plotsById for naming the plot in the error
 * @param {string|null} excludeCycleId the cycle being updated, which never conflicts with itself
 */
async function assertPlotsHaveNoOpenCycle(client, plotIds, plotsById, excludeCycleId = null) {
  if (!plotIds.length) {
    return;
  }
  const openCycles = await client.plantingCycle.findMany({
    where: {
      isDeleted: false,
      status: { in: OPEN_CYCLE_STATUSES },
      ...(excludeCycleId ? { id: { not: String(excludeCycleId) } } : {}),
      // Both bindings count: `cyclePlots` is the current one, `plotId` is the deprecated
      // scalar that rows written before PlantingCyclePlot existed (and the auto-trace path)
      // still carry. Reading only the join table would leave the oldest rows double-bookable.
      OR: [
        { plotId: { in: plotIds } },
        { cyclePlots: { some: { plotId: { in: plotIds } } } },
      ],
    },
    select: {
      id: true,
      cycleName: true,
      status: true,
      plotId: true,
      cyclePlots: { select: { plotId: true } },
    },
  });
  if (!openCycles.length) {
    return;
  }
  for (const plotId of plotIds) {
    const holder = openCycles.find((cycle) => cycle.plotId === plotId
      || (cycle.cyclePlots || []).some((cyclePlot) => cyclePlot.plotId === plotId));
    if (!holder) {
      continue;
    }
    const plotName = plotsById.get(plotId)?.name || plotId;
    const error = new Error(
      `พื้นที่ปลูก "${plotName}" มีรอบปลูกที่ยังเปิดอยู่คือ "${holder.cycleName}" `
      + 'คุณต้องปิดรอบเดิมโดยบันทึกการเก็บเกี่ยวก่อน จึงจะเริ่มรอบใหม่ในพื้นที่นี้ได้',
    );
    error.code = 'PLOT_ALREADY_HAS_OPEN_CYCLE';
    error.statusCode = 409;
    error.plotId = plotId;
    error.plotName = plotName;
    error.conflictingCycleId = holder.id;
    error.conflictingCycleName = holder.cycleName;
    error.conflictingCycleStatus = holder.status;
    throw error;
  }
}
function isActiveCertificateStatus(status) {
  return String(status || '').trim().toLowerCase() === 'active';
}
function getActiveCertificateWhere(now = new Date()) {
  return {
    isDeleted: false,
    status: {
      in: ['active', 'ACTIVE'],
    },
    expiryDate: {
      gte: now,
    },
  };
}
class PlantingService {
  async listByFarm(farmId, status) {
    const now = new Date();
    const where = {
      farmId,
      isDeleted: false,
      certificateId: {
        not: null,
      },
      certificate: getActiveCertificateWhere(now),
    };
    if (status) {
      where.status = String(status).toUpperCase();
    }
    const cycles = await prisma.plantingCycle.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: this.getCycleSummaryInclude(),
    });
    return cycles
      .filter((cycle) => String(cycle?.certificate?.farmId || '') === String(cycle?.farmId || ''))
      .map((cycle) => this.decorateCycleSummary(cycle));
  }
  /**
   * รอบปลูกของเจ้าของเอง — อ่านประวัติ ไม่ใช่การบันทึกของใหม่
   *
   * เดิมกรองด้วย `certificate: getActiveCertificateWhere(now)` ⇒ **วันที่ใบรับรองหมดอายุ
   * บันทึกของเกษตรกรหายไปจากจอของเขาเอง** ขณะที่รายการฝั่งพนักงานยังเห็นครบ และ QR
   * สาธารณะยังอ่านรอบนั้นได้ · วัดจริง 2026-09-06: ยังมีผล → เจ้าของเห็น 1 รอบ ·
   * หมดอายุ → เจ้าของเห็น 0 รอบ · พนักงานเห็น 2 รอบทั้งสองสถานะ
   *
   * เป็นจังหวะที่เขาต้องใช้ประวัติมากที่สุดพอดี — คำขอต่ออายุขอ "รายงานสรุปผลการดำเนินงาน"
   * ของรอบที่ผ่านมา ซึ่งอยู่บนหน้าจอที่เพิ่งว่างเปล่า · และ PDPA ม.30 ให้สิทธิเจ้าของข้อมูล
   * เข้าถึงข้อมูลของตน โดยไม่ได้ผูกสิทธินั้นไว้กับอายุใบรับรอง
   *
   * กติกาที่ไม่เปลี่ยน: `createCycle` ยังบังคับใบรับรองที่ยังมีผลก่อน *บันทึกรอบใหม่*
   * (PLANTING_REQUIRES_CERTIFICATE) · อ่านของเก่ากับเขียนของใหม่เป็นคนละการกระทำ
   * และ `certificateId: not null` ยังอยู่ — รอบที่ไม่ได้ผูกกับใบรับรองใดเลยไม่ใช่ประวัติ
   * ของการปลูกที่ได้รับรอง
   */
  async listByOwner(userId, status) {
    const where = {
      isDeleted: false,
      certificateId: {
        not: null,
      },
      farm: {
        ...(await farmAccessWhere(userId)),
        isDeleted: false,
      },
    };
    if (status) {
      where.status = String(status).toUpperCase();
    }
    const cycles = await prisma.plantingCycle.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: this.getCycleSummaryInclude(),
    });
    return cycles
      .filter((cycle) => String(cycle?.certificate?.farmId || '') === String(cycle?.farmId || ''))
      .map((cycle) => this.decorateCycleSummary(cycle));
  }
  async getById(id) {
    return getPlantingCycleById({
      prisma,
      id,
      decorateCycleSummary: (cycle) => this.decorateCycleSummary(cycle),
      roundSqm,
      plotAreaSqm,
    });
  }
  async createCycle(data) {
    const {
      farmId,
      certificateId,
      plantSpeciesId,
      cycleName,
      startDate,
      expectedHarvestDate,
      seedSource,
      notes,
    } = data;
    const assignmentsInput = this.normalizePlotAssignments(data);
    if (!assignmentsInput.length) {
      throw new Error('At least one plot assignment is required');
    }
    const farm = await prisma.farm.findFirst({
      where: {
        id: String(farmId),
        isDeleted: false,
      },
      select: {
        id: true,
        ownerId: true,
      },
    });
    if (!farm) {
      throw new Error('Farm not found');
    }
    const plotIds = unique(assignmentsInput.map((item) => item.plotId));
    const plots = await prisma.plot.findMany({
      where: {
        id: { in: plotIds },
        farmId: String(farmId),
      },
      select: {
        id: true,
        name: true,
        areaSqm: true,
        area: true,
        areaUnit: true,
        solarSystem: true,
      },
    });
    if (plots.length !== plotIds.length) {
      throw new Error('Some selected plots are invalid for this farm');
    }
    const plotsById = new Map(plots.map((plot) => [plot.id, plot]));
    const validatedAssignments = assignmentsInput.map((assignment) => {
      const plot = plotsById.get(assignment.plotId);
      if (!plot) {
        throw new Error('Plot assignment references unknown plot');
      }
      const maxSqm = plotAreaSqm(plot);
      if (assignment.allocatedAreaSqm <= 0) {
        throw new Error('Allocated area must be greater than 0 sqm');
      }
      if (assignment.allocatedAreaSqm > maxSqm + 0.0001) {
        throw new Error(`Allocated area for plot ${plot.name} exceeds plot size`);
      }
      if (assignment.plannedPlantCount <= 0) {
        throw new Error('plannedPlantCount must be greater than 0');
      }
      return {
        ...assignment,
        allocatedAreaSqm: roundSqm(assignment.allocatedAreaSqm),
        plot,
      };
    });
    const totalAreaSqm = roundSqm(
      validatedAssignments.reduce((sum, assignment) => sum + assignment.allocatedAreaSqm, 0),
    );
    const plannedPlantCount = validatedAssignments.reduce(
      (sum, assignment) => sum + assignment.plannedPlantCount,
      0,
    );
    const cultivationMethods = unique(validatedAssignments.map((assignment) => assignment.plot.solarSystem || 'OUTDOOR'));
    const primaryMethod = cultivationMethods[0] || 'OUTDOOR';
    let resolvedCertificateId = certificateId ? String(certificateId) : null;
    if (resolvedCertificateId) {
      const cert = await prisma.certificate.findUnique({
        where: { id: resolvedCertificateId },
        select: {
          id: true,
          status: true,
          expiryDate: true,
          farmId: true,
        },
      });
      if (!cert || cert.farmId !== farmId) {
        throw new Error('Certificate not found for this farm');
      }
      if (!isActiveCertificateStatus(cert.status)) {
        throw new Error('Certificate is not active');
      }
      if (cert.expiryDate && new Date(cert.expiryDate) < new Date()) {
        throw new Error('Certificate has expired');
      }
    } else {
      // Auto-link latest active certificate for this farm to keep planting flow operational.
      const autoCert = await prisma.certificate.findFirst({
        where: {
          farmId: String(farmId),
          isDeleted: false,
          OR: [{ status: 'active' }, { status: 'ACTIVE' }],
          expiryDate: { gte: new Date() },
        },
        orderBy: [{ issuedDate: 'desc' }, { createdAt: 'desc' }],
        select: { id: true },
      });
      resolvedCertificateId = autoCert?.id || null;
      if (!resolvedCertificateId) {
        // มีรหัสติดมาด้วย เพราะ Error เปล่า ๆ จะตกไปที่ 500 ของ route และเกษตรกรจะเห็น
        // เหมือนระบบพัง แทนที่จะเห็นว่าต้องได้ใบรับรองก่อนจึงเริ่มบันทึกรอบปลูกได้
        throw Object.assign(new Error('Active certificate is required before creating planting cycle'), {
          code: 'PLANTING_REQUIRES_CERTIFICATE',
          messageTh: 'เริ่มบันทึกรอบการปลูกได้เมื่อแปลงนี้ได้รับใบรับรอง GACP ที่ยังมีผลแล้ว หากยังไม่ได้ยื่นคำขอ ให้ยื่นคำขอรับรองก่อน',
        });
      }
    }
    // แปลงที่เลือกต้องอยู่ในขอบเขตที่ใบรับรองครอบคลุม
    //
    // assertPlotWithinCertifiedScope กั้นการ **สร้างแปลง** อยู่แล้ว แต่แปลงที่เกิดก่อน
    // ใบรับรองไม่เคยผ่านด่านนั้น · ฟาร์มที่มีแปลงในร่มมาก่อน แล้วได้ใบที่ครอบคลุมเฉพาะ
    // กลางแจ้ง ยังเปิดรอบบนแปลงในร่มได้ และ QR ที่ออกมาจะอ้างใบรับรองเกินขอบเขต
    //
    // operator 2026-09-10: "การบันทึกฟาร์มก็ตามรูปแบบการปลูกที่ขอมา"
    const scopeCheck = await checkPlotsAgainstCertifiedScope({
      farmId: String(farmId),
      plots: validatedAssignments.map((assignment) => assignment.plot),
    });
    if (!scopeCheck.allowed) {
      throw Object.assign(new Error('Selected plots are outside the certified cultivation scope'), {
        code: scopeCheck.code,
        statusCode: 409,
        messageTh: scopeCheck.reasonTh,
        blockedPlots: scopeCheck.blocked,
        certifiedAreaTypes: scopeCheck.certified,
      });
    }

    const cycle = await prisma.$transaction(async (tx) => {
      // R15 — inside the transaction, immediately before the write, so the gap between
      // "the plot was free" and "the cycle exists" is as small as this layer can make it.
      await assertPlotsHaveNoOpenCycle(tx, plotIds, plotsById);
      const created = await tx.plantingCycle.create({
        data: {
          farmId: String(farmId),
          certificateId: resolvedCertificateId,
          plantSpeciesId: String(plantSpeciesId),
          cycleName: String(cycleName || '').trim(),
          startDate: new Date(startDate),
          expectedHarvestDate: expectedHarvestDate ? new Date(expectedHarvestDate) : null,
          seedSource: seedSource ? String(seedSource).trim() : null,
          notes: notes ? String(notes).trim() : null,
          cultivationType: primaryMethod,
          estimatedPlantCount: plannedPlantCount,
          areaUnit: 'sqm',
          plotArea: totalAreaSqm,
          plotId: validatedAssignments[0]?.plotId || null,
          status: 'PLANTED',
        },
      });
      await tx.plantingCyclePlot.createMany({
        data: validatedAssignments.map((assignment) => ({
          cycleId: created.id,
          plotId: assignment.plotId,
          allocatedAreaSqm: assignment.allocatedAreaSqm,
          plannedPlantCount: assignment.plannedPlantCount,
        })),
      });
      return created;
    });
    return {
      id: cycle.id,
      status: cycle.status,
      totalAreaSqm,
      cultivationMethods,
      plotCount: validatedAssignments.length,
      // plannedPlantCount is the farmer's planned head-count for the cycle and
      // stays. The `autoGenerateUnits` echo that sat here is deleted, not set
      // false: per-plant generation is retired (spec R8), so there is no longer
      // a choice for the response to report the state of. A caller still sending
      // the flag is ignored.
      plannedPlantCount,
      certificateId: resolvedCertificateId,
    };
  }
  async updateCycle(id, data) {
    const cycle = await prisma.plantingCycle.findUnique({
      where: { id },
      include: {
        _count: { select: { batches: true } },
      },
    });
    if (!cycle || cycle.isDeleted) {
      throw new Error('Planting cycle not found');
    }
    const statusUpper = String(cycle.status || '').toUpperCase();
    const isLocked = ['HARVESTED', 'COMPLETED'].includes(statusUpper) || (cycle._count?.batches || 0) > 0;
    const updateData = {};

    // `notes` is the ONLY field that outlives the freeze. It is never emitted by
    // the public trace, so it stays what it always was: the farmer's note to
    // themselves. The other four used to sit in this same list —
    // seedSource, varietyName, irrigationType, soilType — and every one of them
    // IS published to anyone holding a QR code, with no login
    // (trace-service/resolve-generic.js:150,155,156,157). Copying them in above
    // the `isLocked` guard meant that after the cut, after the label was printed,
    // after the goods were in the market, the cycle's owner could still rewrite
    // the VARIETY and the SEED SOURCE that the public scan asserts — silently.
    // R11/R12 (spec 2026-08-20) say the record freezes at the cut, and the lot and
    // harvest layers already enforce exactly that.
    if (data.notes !== undefined) {
      updateData.notes = data.notes;
    }

    // Refuse LOUDLY rather than dropping the keys. harvest-service.js learned this
    // in its own words: "A farmer editing notes and a weight in one request must
    // not be told the whole edit succeeded when half of it was discarded." A
    // correction after the produce has shipped is a decision for an officer, with
    // a record — not a quiet PATCH.
    if (isLocked) {
      const FROZEN_AFTER_CUT = ['seedSource', 'varietyName', 'irrigationType', 'soilType'];
      const attempted = FROZEN_AFTER_CUT.filter((field) => data[field] !== undefined);
      if (attempted.length > 0) {
        const error = new Error(
          `รอบปลูกนี้ปิดแล้ว จึงแก้ ${attempted.join(', ')} ไม่ได้ — ข้อมูลเหล่านี้แสดงอยู่บนหน้าตรวจสอบย้อนกลับที่ผู้ซื้อสแกนดูได้ `
          + 'หากต้องแก้ไข กรุณาติดต่อเจ้าหน้าที่',
        );
        error.code = 'CYCLE_FROZEN';
        error.statusCode = 409;
        error.fields = attempted;
        throw error;
      }
    }

    if (!isLocked) {
      // Editable right up to the cut — the whole point of R11/R12. After it they
      // are refused above, because from then on they are what the public scan says.
      for (const field of ['seedSource', 'varietyName', 'irrigationType', 'soilType']) {
        if (data[field] !== undefined) {
          updateData[field] = data[field];
        }
      }
      if (data.expectedHarvestDate !== undefined) {
        updateData.expectedHarvestDate = data.expectedHarvestDate ? new Date(data.expectedHarvestDate) : null;
      }
      if (data.cycleName !== undefined) {
        updateData.cycleName = String(data.cycleName || '').trim();
      }
      if (data.status !== undefined) {
        // Closed set, not free text — see CYCLE_STATUSES. An unknown value here used to be
        // stored verbatim, and any value outside OPEN_CYCLE_STATUSES releases the plot, so
        // this single line was the way around R15.
        const nextStatus = String(data.status).toUpperCase();
        if (!CYCLE_STATUSES.includes(nextStatus)) {
          const error = new Error(
            `สถานะรอบปลูก "${data.status}" ไม่ถูกต้อง ใช้ได้เฉพาะ ${CYCLE_STATUSES.join(' · ')}`,
          );
          error.code = 'INVALID_CYCLE_STATUS';
          error.statusCode = 400;
          error.field = 'status';
          throw error;
        }
        updateData.status = nextStatus;
      }
      const assignmentsInput = this.normalizePlotAssignments(data);
      if (assignmentsInput.length > 0) {
        const plotIds = unique(assignmentsInput.map((item) => item.plotId));
        const plots = await prisma.plot.findMany({
          where: {
            id: { in: plotIds },
            farmId: cycle.farmId,
          },
          select: {
            id: true,
            name: true,
            areaSqm: true,
            area: true,
            areaUnit: true,
            solarSystem: true,
          },
        });
        if (plots.length !== plotIds.length) {
          throw new Error('Some selected plots are invalid for this farm');
        }
        const plotsById = new Map(plots.map((plot) => [plot.id, plot]));
        const validatedAssignments = assignmentsInput.map((assignment) => {
          const plot = plotsById.get(assignment.plotId);
          if (!plot) {
            throw new Error('Plot assignment references unknown plot');
          }
          const maxSqm = plotAreaSqm(plot);
          if (assignment.allocatedAreaSqm <= 0 || assignment.allocatedAreaSqm > maxSqm + 0.0001) {
            throw new Error(`Allocated area for plot ${plot.name} is invalid`);
          }
          return {
            ...assignment,
            allocatedAreaSqm: roundSqm(assignment.allocatedAreaSqm),
            plot,
          };
        });
        const totalAreaSqm = roundSqm(validatedAssignments.reduce((sum, item) => sum + item.allocatedAreaSqm, 0));
        const plannedPlantCount = validatedAssignments.reduce((sum, item) => sum + item.plannedPlantCount, 0);
        const cultivationMethods = unique(validatedAssignments.map((item) => item.plot.solarSystem || 'OUTDOOR'));
        updateData.plotArea = totalAreaSqm;
        updateData.areaUnit = 'sqm';
        updateData.plotId = validatedAssignments[0]?.plotId || null;
        updateData.estimatedPlantCount = plannedPlantCount;
        updateData.cultivationType = cultivationMethods[0] || cycle.cultivationType;
        return prisma.$transaction(async (tx) => {
          // R15 — re-plotting is the same door as creating: moving this cycle onto ground
          // another open cycle holds would produce the two-current-cycles state the rule
          // exists to prevent. The cycle never conflicts with itself.
          await assertPlotsHaveNoOpenCycle(tx, plotIds, plotsById, id);
          const updated = await tx.plantingCycle.update({
            where: { id },
            data: updateData,
          });
          await tx.plantingCyclePlot.deleteMany({ where: { cycleId: id } });
          await tx.plantingCyclePlot.createMany({
            data: validatedAssignments.map((assignment) => ({
              cycleId: id,
              plotId: assignment.plotId,
              allocatedAreaSqm: assignment.allocatedAreaSqm,
              plannedPlantCount: assignment.plannedPlantCount,
            })),
          });
          return updated;
        });
      }
    } else if (data.plotAssignments || data.plotArea || data.cultivationType || data.plotId) {
      throw new Error('Core cycle fields are locked after harvest or lot generation');
    }
    if (Object.keys(updateData).length === 0) {
      return cycle;
    }
    return prisma.plantingCycle.update({
      where: { id },
      data: updateData,
    });
  }
  normalizePlotAssignments(data) {
    if (Array.isArray(data.plotAssignments) && data.plotAssignments.length > 0) {
      return data.plotAssignments.map((assignment) => ({
        plotId: String(assignment.plotId || '').trim(),
        allocatedAreaSqm: roundSqm(Number(assignment.allocatedAreaSqm || 0)),
        plannedPlantCount: Math.max(0, Math.round(Number(assignment.plannedPlantCount || 0))),
      })).filter((assignment) => assignment.plotId);
    }
    const legacyPlotId = String(data.plotId || '').trim();
    if (!legacyPlotId) {
      return [];
    }
    // `plotArea` on the request is square metres. Older clients sent a unit
    // alongside it; if one still does and it is not sqm, read it rather than
    // silently treating rai as square metres.
    const legacyAreaSqm = storedAreaToSqm(Number(data.plotArea || 0), data.areaUnit || AREA_UNIT);
    const plannedPlantCount = Math.max(0, Math.round(Number(data.estimatedPlantCount || 0)));
    return [{
      plotId: legacyPlotId,
      allocatedAreaSqm: roundSqm(legacyAreaSqm),
      plannedPlantCount,
    }];
  }
  getCycleSummaryInclude() {
    return {
      farm: {
        select: {
          id: true,
          farmName: true,
        },
      },
      plantSpecies: {
        select: { id: true, code: true, nameTH: true, nameEN: true },
      },
      certificate: {
        select: {
          id: true,
          farmId: true,
          status: true,
          expiryDate: true,
        },
      },
      cyclePlots: {
        include: {
          plot: {
            select: {
              id: true,
              name: true,
              areaSqm: true,
              area: true,
              areaUnit: true,
              solarSystem: true,
            },
          },
        },
      },
      _count: {
        // No `plantUnits`. R8
        // (design note 2026-08-20-planting-tnt-design) retires
        // per-plant tracking; decorateCycleSummary reports the declared
        // plannedPlantCount summed from cyclePlots instead.
        select: {
          batches: true,
          cultivationLogs: true,
          cyclePlots: true,
        },
      },
      batches: {
        where: { isDeleted: false },
        select: {
          id: true,
          _count: { select: { lots: true } },
        },
      },
    };
  }
  /**
   * Provider-facing list of planting cycles with filters and pagination.
   * Used by routes/api/provider/handlers/planting.js (batch 10 — Prisma bypass cleanup).
   * Returns { items, total } for the route to map and respond with pagination.
   */
  async listProviderCycles({ status, search, farmId, skip, take } = {}) {
    const where = { isDeleted: false };
    if (status) {
      where.status = String(status).toUpperCase();
    }
    if (search) {
      where.OR = [
        { cycleName: { contains: search } },
        { farm: { farmName: { contains: search } } },
      ];
    }
    if (farmId) {
      where.farmId = String(farmId).trim();
    }
    const [items, total] = await Promise.all([
      prisma.plantingCycle.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          farm: {
            select: {
              id: true,
              farmName: true,
              district: true,
              province: true,
            },
          },
          cyclePlots: {
            include: {
              plot: {
                select: {
                  id: true,
                  name: true,
                  solarSystem: true,
                },
              },
            },
          },
          _count: {
            // No `plantUnits` count. R8
            // (design note 2026-08-20-planting-tnt-design)
            // retired per-plant tracking on 2026-08-25; the officer list
            // reports activities and batches, and the declared plant count
            // travels on each cyclePlots[] row as plannedPlantCount.
            select: {
              cultivationLogs: true,
              batches: true,
            },
          },
        },
      }),
      prisma.plantingCycle.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Batch/lot rollup for a set of cycle ids, so the officer list can report how
   * many lots each cycle produced.
   * Used by routes/api/provider/handlers/planting.js list view.
   *
   * Renamed from `aggregateCycleIntegrity` on 2026-08-25. The old name and its
   * first two result sets — REMOVED and unassigned PlantUnit groupBys — measured
   * per-plant bookkeeping drift, which R8 of
   * design note 2026-08-20-planting-tnt-design retires. What is
   * left counts batches and lots only, so the name says that: keeping
   * "integrity" over a pure lot rollup would advertise a check that no longer runs.
   */
  async aggregateCycleLotCounts(cycleIds) {
    if (!Array.isArray(cycleIds) || cycleIds.length === 0) {
      return { batchRows: [], lotRows: [] };
    }
    const [batchRows, lotRows] = await Promise.all([
      prisma.harvestBatch.findMany({
        where: { cycleId: { in: cycleIds }, isDeleted: false },
        select: { id: true, cycleId: true },
      }),
      prisma.lot.groupBy({
        by: ['batchId'],
        where: {
          isDeleted: false,
          batch: { cycleId: { in: cycleIds }, isDeleted: false },
        },
        _count: { _all: true },
      }),
    ]);
    return { batchRows, lotRows };
  }

  /**
   * Provider-facing cycle detail plus the cycle's lot count.
   * Used by routes/api/provider/handlers/planting.js detail view.
   *
   * The per-plant integrity counts this used to return alongside the cycle
   * (total / REMOVED / unassigned PlantUnit rows) were removed on 2026-08-25 —
   * R8, design note 2026-08-20-planting-tnt-design.
   */
  async getProviderCycleDetail(cycleId) {
    const cycle = await prisma.plantingCycle.findUnique({
      where: { id: String(cycleId) },
      include: {
        farm: {
          select: { id: true, farmName: true, province: true, district: true },
        },
        plantSpecies: {
          select: { id: true, code: true, nameTH: true, nameEN: true },
        },
        cyclePlots: {
          include: {
            plot: {
              select: {
                id: true,
                name: true,
                areaSqm: true,
                area: true,
                areaUnit: true,
                solarSystem: true,
              },
            },
          },
        },
        _count: {
          select: { cultivationLogs: true, batches: true },
        },
      },
    });
    if (!cycle || cycle.isDeleted) {
      return null;
    }
    const lotCount = await prisma.lot.count({
      where: {
        isDeleted: false,
        batch: { cycleId: String(cycle.id), isDeleted: false },
      },
    });
    return { cycle, lotCount };
  }

  /**
   * Provider-facing cultivation log listing scoped to a cycle.
   * Used by routes/api/provider/handlers/planting.js activities view.
   */
  async listProviderCycleActivities({ cycleId, scope, activityType, skip, take } = {}) {
    const where = { cycleId };
    // Whose diary this is. The activity rows carry the plot but never the farm, so the
    // PDPA ม.39 access record has no farm to name unless it is read here — a primary-key
    // lookup, and the alternative is an access log that cannot say whose data was opened.
    const owner = await prisma.plantingCycle.findUnique({
      where: { id: String(cycleId) },
      select: { farmId: true },
    });
    if (scope) {
      where.scope = String(scope).toUpperCase();
    }
    if (activityType) {
      where.logType = String(activityType).toUpperCase();
    }
    const [items, total] = await Promise.all([
      prisma.cultivationLog.findMany({
        where,
        orderBy: [{ logDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: {
          // The `plantUnit` relation is no longer hydrated: R8
          // (design note 2026-08-20-planting-tnt-design) retires
          // per-plant tracking, so an activity is shown against its cycle and
          // plot only, never against an individual plant.
          plot: { select: { id: true, name: true } },
        },
      }),
      prisma.cultivationLog.count({ where }),
    ]);
    return { items, total, farmId: (owner && owner.farmId) || null };
  }

  /**
   * Provider-facing list of cycle plot QR records.
   * Used by routes/api/provider/handlers/planting.js QR view.
   * Returns { cycle, qrByCyclePlotId } so the route can shape the response.
   */
  async getProviderCyclePlotQrs(cycleId) {
    const cycle = await prisma.plantingCycle.findUnique({
      where: { id: String(cycleId) },
      include: {
        cyclePlots: {
          include: {
            plot: {
              // T8 — same three permanent columns as the farmer's own door, so staff
              // and farmer are looking at one identity rather than two.
              select: {
                id: true,
                name: true,
                solarSystem: true,
                plotCode: true,
                qrIssuedAt: true,
                qrRevokedAt: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!cycle || cycle.isDeleted) {
      return null;
    }
    const cyclePlotIds = (cycle.cyclePlots || []).map((item) => String(item.id));
    const qrRows = cyclePlotIds.length > 0
      ? await prisma.traceQrSecurity.findMany({
        where: {
          entityType: 'PLANTING_CYCLE_PLOT',
          entityId: { in: cyclePlotIds },
        },
        select: {
          entityId: true,
          qrCode: true,
          publicUrl: true,
          status: true,
        },
      })
      : [];
    return {
      cycle,
      qrByCyclePlotId: new Map(qrRows.map((row) => [String(row.entityId), row])),
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Batch 15 (2026-05-16) — Plot CRUD + cycle/cycle-plot lookups
  //
  // Used by routes/api/cultivation/plots.js,
  // cultivation/planting-cycles-plot-routes.js,
  // and cultivation/planting-cycles-activity-harvest-routes.js
  // (cultivation/plant-units.js was deleted on 2026-08-25 — R8).
  // These methods replace direct prisma
  // access in those routes; ownership predicates that used to live in
  // the route helper now live in farm-service.listOwnerFarmIds and
  // farm-service.findOwnedFarmForPlotOps so the cultivation methods
  // here can assume the parent has already been validated.
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Replaces routes/api/cultivation/plots.js:59 prisma.plot.create
   */
  // `areaUnit` is destructured only to swallow it — see the comment on the
  // write below. The underscore says that is deliberate rather than an
  // oversight, which is also what the no-unused-vars rule asks for.
  // `area` is the retired name for the same square-metre number, still accepted
  // so a caller written against the previous signature keeps working; drop it
  // with the contract migration.
  async createPlotForFarm({ farmId, name, areaSqm, area, areaUnit: _areaUnit, solarSystem }) {
    const sqm = parseFloat(areaSqm ?? area);
    return prisma.plot.create({
      data: {
        farmId,
        name: String(name).trim(),
        areaSqm: sqm,
        // `area` + `areaUnit` are the retired pair. Written from the same
        // number so a process still serving the previous image reads a correct
        // plot; the contract migration drops both.
        area: sqm,
        // Square metres, always. The parameter is still accepted so callers
        // that pass it do not break, and ignored so they cannot store
        // anything else.
        areaUnit: AREA_UNIT,
        solarSystem: String(solarSystem || 'OUTDOOR').toUpperCase(),
      },
    });
  }

  /**
   * Replaces routes/api/cultivation/plots.js:90 prisma.plot.findMany
   */
  async listPlotsByFarm(farmId) {
    return prisma.plot.findMany({
      where: { farmId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: {
            plantingCycles: true,
            cycleAssignments: true,
          },
        },
      },
    });
  }

  /**
   * Replaces routes/api/cultivation/plots.js:118 prisma.plot.findUnique
   * Plus ownership probe — returns { plot, ownerId } so the route can
   * 404 on mismatch.
   */
  async findPlotWithFarmOwner(plotId) {
    return prisma.plot.findUnique({
      where: { id: plotId },
      select: {
        id: true,
        farm: {
          select: {
            ownerId: true,
            // Wave A chunk 3 — resolveFarmAccess needs the entity dimension
            entityId: true,
          },
        },
      },
    });
  }

  /**
   * Replaces routes/api/cultivation/plots.js:134 prisma.plot.delete
   */
  async deletePlot(plotId) {
    return prisma.plot.delete({ where: { id: plotId } });
  }

  /**
   * Replaces prisma.plantingCyclePlot.findFirst in
   * routes/api/cultivation/planting-cycles-plot-routes.js and
   * planting-cycles-activity-harvest-routes.js:73. Confirms
   * a cyclePlot belongs to the given cycle.
   */
  async findCyclePlotInCycle({ cyclePlotId, cycleId, plotId }) {
    const where = { cycleId };
    if (cyclePlotId) { where.id = cyclePlotId; }
    if (plotId) { where.plotId = plotId; }
    return prisma.plantingCyclePlot.findFirst({
      where,
      select: { id: true },
    });
  }

  // `findCycleForGenerate` used to sit here: the pre-check projection for the
  // generate-units and bulk-confirm-planting routes. Both routes existed only to
  // mint and drive per-plant rows, which spec R8 retired, so they and this helper
  // are gone together — nothing was left holding a reference.

  /**
   * Replaces routes/api/cultivation/planting-cycles-plot-routes.js
   * prisma.traceQrSecurity.findMany — read of QR records for the
   * plot-cycle assignments inside a single cycle.
   */
  async listPlotCycleQrRecordsForCycle(entityIds) {
    if (!Array.isArray(entityIds) || entityIds.length === 0) {
      return [];
    }
    return prisma.traceQrSecurity.findMany({
      where: {
        entityType: 'PLANTING_CYCLE_PLOT',
        entityId: { in: entityIds },
        status: 'ACTIVE',
      },
      select: {
        entityId: true,
        qrCode: true,
        publicUrl: true,
      },
    });
  }

  /**
   * Replaces routes/api/cultivation/planting-cycles-activity-harvest-routes.js:42
   * prisma.applicationDocument.findMany — ownership probe for attachment
   * ids supplied in a cultivation-log activity create.
   */
  async findOwnedApplicationDocuments(documentIds, userId, { holderScope } = {}) {
    if (!Array.isArray(documentIds) || documentIds.length === 0 || !userId) {
      return [];
    }
    // Spec 2026-09-30 §3.1: the caller's holder scope; no scope fails closed.
    // R1 (operator ruling C1): the pre-R1 filer pin decides (OR-registered beside
    // the fragment, and AND) — exactly the pre-R1 rows.
    if (!holderScope || !Array.isArray(holderScope.readIds)) {
      return [];
    }
    const { r1HolderOrLegacy, r1LegacyApplicantPin } = require('./holder-access');
    const filerPin = { application: { applicant: { id: userId, isDeleted: false } } };
    return prisma.applicationDocument.findMany({
      where: {
        id: { in: documentIds },
        // R1-legacy-pin: removed in Task 12 (→ holderReadWhere); the pre-R1 pin decides
        ...r1HolderOrLegacy(holderScope, 'ApplicationDocument', filerPin),
        ...r1LegacyApplicantPin(filerPin),
      },
      select: { id: true },
    });
  }

  /**
   * Narrow projection used to confirm a cycle belongs to one of the caller's
   * farms. Its original caller, routes/api/helpers/plant-unit-ownership.js, was
   * deleted with per-plant tracking on 2026-08-25 (R8); the cycle-level
   * ownership check it does is still used elsewhere.
   */
  async findCycleFarmId(cycleId) {
    if (!cycleId) {return null;}
    return prisma.plantingCycle.findUnique({
      where: { id: cycleId },
      select: { farmId: true },
    });
  }

  // `findPlantUnitByIdOrQr` and `findPlantUnitInCycle` were deleted on
  // 2026-08-25. They resolved one plant by id or QR code, and confirmed a plant
  // belonged to a cycle before an activity was bound to it — both are per-plant
  // resolution, which R8 of
  // design note 2026-08-20-planting-tnt-design retires. Nothing
  // replaces them: an activity binds to the cycle or to a plot, and a scanned QR
  // code resolves to a plot-cycle or to a Lot.

  /**
   * Replaces routes/api/cultivation/planting-cycles-activity-harvest-routes.js:109
   * prisma.cultivationLog.create.
   */
  async createCultivationLog(data, include) {
    return prisma.cultivationLog.create({
      data,
      ...(include ? { include } : {}),
    });
  }

  /**
   * Replaces routes/api/cultivation/planting-cycles-activity-harvest-routes.js:180-191
   * prisma.cultivationLog.{findMany,count} — paginated list with the
   * route's where clause already assembled.
   */
  async listCultivationLogs({ where, skip, take, orderBy, include }) {
    return Promise.all([
      prisma.cultivationLog.findMany({
        where,
        skip,
        take,
        orderBy,
        ...(include ? { include } : {}),
      }),
      prisma.cultivationLog.count({ where }),
    ]);
  }

  /**
   * Replaces routes/api/cultivation/planting-cycles-activity-harvest-routes.js:233
   * prisma.plantingCycle.findUnique — full slice used by the legacy
   * /harvest endpoint for the readiness checks.
   */
  async findCycleForLegacyHarvest(cycleId) {
    return prisma.plantingCycle.findUnique({
      where: { id: cycleId },
      include: {
        certificate: { select: { expiryDate: true, status: true } },
        plantSpecies: { select: { code: true } },
        cyclePlots: {
          select: {
            allocatedAreaSqm: true,
          },
        },
        // The per-plant `_count` this projection used to carry fed a door that
        // refused a harvest with no PlantUnit rows. Per-plant tracking is retired
        // (spec R8), so the count has no reader and is not selected.
      },
    });
  }

  /**
   * Replaces routes/api/cultivation/planting-cycles-activity-harvest-routes.js:332
   * prisma.harvestBatch.count — total count for batch-number generation.
   */
  async countHarvestBatchesGlobal() {
    return prisma.harvestBatch.count();
  }

  /**
   * Replaces routes/api/cultivation/planting-cycles-activity-harvest-routes.js:336
   * the `prisma.$transaction([harvestBatch.create, plantingCycle.update])`
   * pair from the legacy /harvest endpoint. Kept atomic so a partial
   * commit cannot leave the cycle in HARVESTED while the batch row is
   * missing.
   */
  async commitLegacyHarvest({ batchData, cycleId, cycleUpdate }) {
    const [batch] = await prisma.$transaction([
      prisma.harvestBatch.create({ data: batchData }),
      prisma.plantingCycle.update({
        where: { id: cycleId },
        data: cycleUpdate,
      }),
    ]);
    return batch;
  }

  decorateCycleSummary(cycle) {
    const cyclePlots = cycle.cyclePlots || [];
    const totalAreaSqm = roundSqm(
      cyclePlots.length > 0
        ? cyclePlots.reduce((sum, item) => sum + Number(item.allocatedAreaSqm || 0), 0)
        : storedAreaToSqm(cycle.plotArea || 0, cycle.areaUnit),
    );
    const plannedPlantCount = cyclePlots.length > 0
      ? cyclePlots.reduce((sum, item) => sum + Number(item.plannedPlantCount || 0), 0)
      : Number(cycle.estimatedPlantCount || 0);
    const cultivationMethods = unique(
      cyclePlots.length > 0
        ? cyclePlots.map((item) => item.plot?.solarSystem || null)
        : [cycle.cultivationType || null],
    );
    const lotCount = (cycle.batches || []).reduce((sum, batch) => sum + Number(batch?._count?.lots || 0), 0);
    return {
      id: cycle.id,
      cycleName: cycle.cycleName,
      status: cycle.status,
      startDate: cycle.startDate,
      expectedHarvestDate: cycle.expectedHarvestDate,
      farm: cycle.farm
        ? {
            id: cycle.farm.id,
            farmName: cycle.farm.farmName,
          }
        : null,
      plantSpecies: cycle.plantSpecies
        ? {
            id: cycle.plantSpecies.id,
            code: cycle.plantSpecies.code,
            nameTH: cycle.plantSpecies.nameTH,
            nameEN: cycle.plantSpecies.nameEN,
          }
        : null,
      totalAreaSqm,
      plotCount: cyclePlots.length > 0 ? cyclePlots.length : cycle.plotId ? 1 : 0,
      cultivationMethods,
      plannedPlantCount,
      traceSummary: {
        batchCount: cycle._count?.batches || 0,
        lotCount,
      },
    };
  }
}
module.exports = new PlantingService();
