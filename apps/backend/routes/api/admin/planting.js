const express = require('express');
const { prisma } = require('../../../services/prisma-database');
const { requireRole } = require('../../../middleware/auth-middleware');
const { ROLE_GROUPS } = require('../../../shared/canonical-rbac');
const logger = require('../../../shared/logger'); // C4-03: log cause before generic 500

const { recordFarmDataAccess } = require('../../../services/farm-access-audit');
const { buildPlotQrRow } = require('../../../services/plot-qr-row');

const router = express.Router();

router.use(requireRole(ROLE_GROUPS.ADMIN_ONLY));
// T5 / PDPA ม.39 — เหมือนฝั่ง provider: ประตูเหล่านี้อ่านข้อมูลฟาร์มของคนอื่น
// จึงต้องมีบันทึกการเข้าถึง · อยู่หลัง requireRole เพราะคนที่ถูกปฏิเสธสิทธิ์ไม่ได้เข้าถึงอะไร
router.use(recordFarmDataAccess({ surface: 'admin:planting' }));

// No `toCycleIntegritySummary` helper lives here any more. Every field it
// produced — totalPlantUnits, activeUnits, removedUnits, overPlanCount,
// unassignedCount, traceabilityReady, needsReview — was a statement about
// PlantUnit rows, and R8 of
// design note 2026-08-20-planting-tnt-design retires per-plant
// tracking (removed 2026-08-25). The one surviving number it computed, the
// declared plannedPlantCount, is already on every cyclePlots[] row of the
// payload, so nothing is lost by dropping the whole `integrity` object rather
// than shipping it with zeros — a zero here would claim the platform counted
// plants and found none.

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || '20'), 10) || 20));
    const status = String(req.query.status || '').trim().toUpperCase();
    const search = String(req.query.q || '').trim();

    const where = { isDeleted: false };
    if (status) {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { cycleName: { contains: search } },
        { farm: { farmName: { contains: search } } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.plantingCycle.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          farm: {
            select: {
              id: true,
              farmName: true,
              ownerId: true,
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
            select: {
              batches: true,
              cultivationLogs: true,
            },
          },
        },
      }),
      prisma.plantingCycle.count({ where }),
    ]);

    return res.json({
      success: true,
      data: items.map((item) => ({
        id: item.id,
        cycleName: item.cycleName,
        status: item.status,
        startDate: item.startDate,
        expectedHarvestDate: item.expectedHarvestDate,
        farm: item.farm,
        plotCount: item.cyclePlots.length,
        cultivationMethods: Array.from(new Set(item.cyclePlots.map((assignment) => assignment.plot?.solarSystem).filter(Boolean))),
        totalAreaSqm: item.cyclePlots.reduce((sum, assignment) => sum + Number(assignment.allocatedAreaSqm || 0), 0),
        counts: {
          activities: item._count?.cultivationLogs || 0,
          batches: item._count?.batches || 0,
        },
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    logger.error('[admin/planting] list planting cycles failed:', error?.message); // C4-03
    return res.status(500).json({ success: false, error: 'Failed to list planting cycles' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const cycle = await prisma.plantingCycle.findUnique({
      where: { id: String(req.params.id) },
      include: {
        farm: {
          select: {
            id: true,
            farmName: true,
            ownerId: true,
            province: true,
            district: true,
          },
        },
        plantSpecies: {
          select: {
            id: true,
            code: true,
            nameTH: true,
            nameEN: true,
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
          select: {
            batches: true,
            cultivationLogs: true,
          },
        },
      },
    });

    if (!cycle || cycle.isDeleted) {
      return res.status(404).json({ success: false, error: 'Planting cycle not found' });
    }

    return res.json({
      success: true,
      data: {
        ...cycle,
        // The _count object is rebuilt field by field instead of being
        // republished as the row carries it. Per-plant counts are retired
        // (R8, 2026-08-25), and an open spread is how a retired key finds its
        // way back into a payload.
        _count: {
          batches: cycle._count?.batches || 0,
          cultivationLogs: cycle._count?.cultivationLogs || 0,
        },
      },
    });
  } catch (error) {
    logger.error('[admin/planting] fetch planting cycle failed:', error?.message); // C4-03
    return res.status(500).json({ success: false, error: 'Failed to fetch planting cycle' });
  }
});

router.get('/:id/plot-qrs', async (req, res) => {
  try {
    const cycleId = String(req.params.id || '').trim();
    if (!cycleId) {
      return res.status(400).json({ success: false, error: 'Cycle ID is required' });
    }

    const cycle = await prisma.plantingCycle.findUnique({
      where: { id: cycleId },
      include: {
        cyclePlots: {
          include: {
            plot: {
              select: {
                id: true,
                name: true,
                solarSystem: true,
                // T8 — the permanent plot identity, same three columns as the other two doors.
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
      return res.status(404).json({ success: false, error: 'Planting cycle not found' });
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
    const qrByCyclePlotId = new Map(qrRows.map((row) => [String(row.entityId), row]));

    // T8 — the third copy of this projection, now the third caller of the one builder.
    const data = (cycle.cyclePlots || []).map((assignment) => buildPlotQrRow({
      assignment,
      seasonal: qrByCyclePlotId.get(String(assignment.id)) || null,
      cultivationType: cycle.cultivationType,
    }));

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('[admin/planting] fetch plot QR list failed:', error?.message); // C4-03
    return res.status(500).json({ success: false, error: 'Failed to fetch plot QR list' });
  }
});

module.exports = router;
