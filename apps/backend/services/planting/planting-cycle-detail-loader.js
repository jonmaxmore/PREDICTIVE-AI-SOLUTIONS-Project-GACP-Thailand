async function getPlantingCycleById({
  prisma,
  id,
  decorateCycleSummary,
  roundSqm,
  plotAreaSqm,
}) {
  const cycle = await prisma.plantingCycle.findUnique({
    where: { id },
    include: {
      farm: {
        select: {
          id: true,
          farmName: true,
          province: true,
          district: true,
        },
      },
      plantSpecies: {
        select: { id: true, code: true, nameTH: true, nameEN: true },
      },
      certificate: {
        select: {
          id: true,
          certificateNumber: true,
          expiryDate: true,
          status: true,
        },
      },
      cyclePlots: {
        orderBy: { createdAt: 'asc' },
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
      batches: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { lots: true } },
        },
      },
      // No `plantUnits` relation is loaded. R8 of
      // design note 2026-08-20-planting-tnt-design retires
      // per-plant tracking: the cycle detail resolves to plots and batches,
      // and "จำนวนต้น" survives only as the declared plannedPlantCount on the
      // cycle and on each plot assignment below — never as tracked rows.
      cultivationLogs: {
        orderBy: { logDate: 'desc' },
        take: 10,
        select: {
          id: true,
          scope: true,
          logType: true,
          logDate: true,
          quantity: true,
          unit: true,
          method: true,
          weather: true,
          notes: true,
          plotId: true,
          attachmentIds: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          batches: true,
          cultivationLogs: true,
          cyclePlots: true,
        },
      },
    },
  });

  if (!cycle) {
    return null;
  }

  const summary = decorateCycleSummary(cycle);
  const lotCount = (cycle.batches || []).reduce((sum, batch) => sum + Number(batch?._count?.lots || 0), 0);

  return {
    ...cycle,
    ...summary,
    plots: (cycle.cyclePlots || []).map((assignment) => ({
      cyclePlotId: assignment.id,
      id: assignment.plot.id,
      name: assignment.plot.name,
      areaSqm: roundSqm(plotAreaSqm(assignment.plot)),
      solarSystem: assignment.plot.solarSystem,
      allocatedAreaSqm: roundSqm(assignment.allocatedAreaSqm),
      plannedPlantCount: assignment.plannedPlantCount,
    })),
    // `plantUnitsSummary` is gone rather than zeroed (R8, 2026-08-25). A count
    // of per-plant rows by status describes a thing the platform no longer
    // tracks; a zero would read as "counted, none found" instead of "not a
    // concept any more". Callers read plots[].plannedPlantCount for the
    // declared plant count.
    activitySummary: {
      total: cycle._count?.cultivationLogs || 0,
      recent: cycle.cultivationLogs,
    },
    traceSummary: {
      batchCount: cycle._count?.batches || 0,
      lotCount,
      latestBatch: cycle.batches[0]
        ? {
            id: cycle.batches[0].id,
            batchNumber: cycle.batches[0].batchNumber,
            status: cycle.batches[0].status,
            trackingUrl: cycle.batches[0].trackingUrl,
          }
        : null,
    },
  };
}

module.exports = {
  getPlantingCycleById,
};
