/**
 * The plot QR is a sign standing in a field. Anyone can photograph it.
 *
 * For a controlled species the plot-cycle public payload was answering, without any
 * authentication: the farm's full name, its district, the farmer's own plot name, the
 * planned plant count, the allocated area, and the EXPECTED HARVEST DATE. Read
 * together that is not provenance, it is a shopping list — this much cannabis, here,
 * ready around then. The masking intent was already in the code (`farm.alias` is
 * `XX***`) and simply was not applied: `farm.name` sat unmasked in the same object.
 *
 * Legal footing, from the research recorded in the change log 2026-08-23: ประกาศ สธ.
 * สมุนไพรควบคุม (กัญชา) พ.ศ. 2568 ข้อ ๔(๖)(๗) prohibits selling through electronic
 * channels and advertising. A public page naming a farm, its location, its quantity
 * and its readiness date is closer to a listing than to a verification record.
 *
 * The redaction is driven by data, not by a hardcoded species list:
 * PlantSpecies.requiresLicense (prisma/schema/trace.prisma:194) already marks cannabis
 * and kratom. Turmeric, ginger and black galingale are not controlled and are not
 * touched — a blanket removal would cripple them for no legal reason.
 *
 * What survives redaction is what a buyer legitimately needs and what the standard
 * asks for: the certificate, the cycle's status, the cultivation method, the province,
 * and the trace summary. TAS 3502-2561 clause 8(2) asks that origin be checkable, not
 * that the grower be locatable.
 */
const {
  redactPublicPlotPayload,
} = require('../../services/trace-service/resolve-plot-cycle');

function fullPayload() {
  return {
    qrCode: 'PLOT-ABC',
    farm: {
      name: 'ฟาร์มลุงมี',
      alias: 'ฟา***',
      district: 'บ้านนา',
      province: 'ระยอง',
    },
    source: {
      plot: { plotId: 'p1', plotName: 'แปลงหลังบ้าน', cyclePlotId: 'cp1' },
      cycle: { cycleId: 'c1', cycleName: 'รอบที่ 3/2570' },
      cultivationMethod: 'INDOOR',
    },
    cycle: {
      id: 'c1',
      name: 'รอบที่ 3/2570',
      status: 'GROWING',
      startDate: '2570-05-05',
      startDateTH: '5 พ.ค. 2570',
      expectedHarvestDate: '2570-08-20',
      expectedHarvestDateTH: '20 ส.ค. 2570',
    },
    plot: {
      id: 'p1',
      name: 'แปลงหลังบ้าน',
      allocatedAreaSqm: 400,
      plannedPlantCount: 100,
    },
    traceSummary: { batchCount: 2, lotCount: 3 },
    certificate: { number: 'GACP-TH-2569-85B448', status: 'ACTIVE' },
  };
}

describe('redactPublicPlotPayload — a controlled species is not advertised', () => {
  it('keeps the FARM IDENTITY open even for a controlled species — operator ruling 2026-09-06 (F-WALK-04)', () => {
    // The 2026-09-05 open-farm ruling ("เมื่อสแกนต้องเห็นทั้งหมด" — farm name and
    // contact address in full on the public scan) governs EVERY public trace door.
    // The batch and lot doors already obey it; this door masked the same farm the
    // sibling doors printed, which is the "public scan has two doors" class. On
    // 2026-09-06 the operator ordered the plot door aligned ("F-WALK-04 แก้เลย
    // ผมเข้าใจผิด"). What stays withheld below is the OTHER ruling — forecasts,
    // plot/cycle enumeration handles — which was never part of the farm-identity
    // relaxation.
    const out = redactPublicPlotPayload(fullPayload(), { requiresLicense: true });

    expect(out.farm.name).toBe('ฟาร์มลุงมี');
    expect(out.farm.district).toBe('บ้านนา');
    expect(out.farm.province).toBe('ระยอง');
    // The plot's own name is an enumeration handle and a business detail, not
    // farm identity — still withheld, same as ชื่อรอบปลูก in the scope table.
    expect(out.plot.name).toBeNull();
    expect(out.source.plot.plotName).toBeNull();
  });

  it('removes the readiness signal — expected harvest date — for a controlled species', () => {
    const out = redactPublicPlotPayload(fullPayload(), { requiresLicense: true });

    expect(out.cycle.expectedHarvestDate).toBeNull();
    expect(out.cycle.expectedHarvestDateTH).toBeNull();
    // The cycle still reports that it is growing, which is provenance, not a listing.
    expect(out.cycle.status).toBe('GROWING');
  });

  it('removes the quantity signals — plant count and area — for a controlled species', () => {
    const out = redactPublicPlotPayload(fullPayload(), { requiresLicense: true });

    expect(out.plot.plannedPlantCount).toBeNull();
    expect(out.plot.allocatedAreaSqm).toBeNull();
  });

  it('publishes no per-plant count at all, redacted or not', () => {
    // R8 (design note 2026-08-20-planting-tnt-design) retired
    // per-plant tracking on 2026-08-25, so `plantUnits` left the public plot body
    // entirely rather than being nulled for a controlled species. Absence is the
    // point: a withheld-but-present count still tells a reader the platform counts
    // plants, and for a NON-controlled species it would publish the number outright.
    // The one quantity a scanner can ask for is plot.plannedPlantCount, which the
    // controlled-species path nulls above.
    const controlled = redactPublicPlotPayload(fullPayload(), { requiresLicense: true });
    const open = redactPublicPlotPayload(fullPayload(), { requiresLicense: false });

    expect(controlled).not.toHaveProperty('plantUnits');
    expect(open).not.toHaveProperty('plantUnits');
  });

  it('keeps what a buyer legitimately needs', () => {
    const out = redactPublicPlotPayload(fullPayload(), { requiresLicense: true });

    expect(out.certificate).toEqual({ number: 'GACP-TH-2569-85B448', status: 'ACTIVE' });
    expect(out.traceSummary).toEqual({ batchCount: 2, lotCount: 3 });
    expect(out.source.cultivationMethod).toBe('INDOOR');
    expect(out.qrCode).toBe('PLOT-ABC');
  });

  it('leaves a NON-controlled species completely untouched', () => {
    const before = fullPayload();
    const out = redactPublicPlotPayload(fullPayload(), { requiresLicense: false });

    expect(out).toEqual(before);
  });

  it('treats an unknown species as controlled, because failing open here is the expensive direction', () => {
    const out = redactPublicPlotPayload(fullPayload(), {});

    // Identity is open under the 2026-09-06 ruling even here; what "controlled"
    // still withholds is the readiness/quantity story — so THAT is the pin.
    expect(out.cycle.expectedHarvestDate).toBeNull();
    expect(out.plot.plannedPlantCount).toBeNull();
  });
});
