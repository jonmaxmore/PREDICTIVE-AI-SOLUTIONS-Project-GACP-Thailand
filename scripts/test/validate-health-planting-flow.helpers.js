const { assert, authHeader, request } = require('./regression-test-helpers');

function toSqm(area, unit) {
  const numericArea = Number(area || 0);
  const normalized = String(unit || 'sqm').trim().toLowerCase();
  if (!Number.isFinite(numericArea) || numericArea <= 0) {
    return 0;
  }
  if (normalized === 'rai') {
    return numericArea * 1600;
  }
  if (normalized === 'ngan') {
    return numericArea * 400;
  }
  if (normalized === 'sqw' || normalized === 'square_wah') {
    return numericArea * 4;
  }
  return numericArea;
}

async function getPreferredCertificate(healthToken) {
  const certRes = await request('/certificates/my', {
    method: 'GET',
    headers: authHeader(healthToken),
  });
  if (!certRes.response.ok || certRes.body?.success !== true) {
    return null;
  }
  const certificates = Array.isArray(certRes.body?.data) ? certRes.body.data : [];
  const active = certificates.find((item) => String(item?.status || '').toLowerCase() === 'active' && item?.farmId);
  if (!active) {
    return null;
  }
  return {
    id: String(active.id),
    farmId: String(active.farmId),
  };
}

async function getHealthFarmAndPlots(healthToken, preferredFarmId = null) {
  const farmsRes = await request('/farms/my', {
    method: 'GET',
    headers: authHeader(healthToken),
  });
  assert(farmsRes.response.ok && farmsRes.body?.success, `Fetch farms failed: ${farmsRes.response.status}`);
  const farms = farmsRes.body?.data || [];
  assert(Array.isArray(farms) && farms.length > 0, 'No farm found for health account');

  const farm = (preferredFarmId
    ? farms.find((item) => String(item?.id || '') === String(preferredFarmId))
    : null) || farms[0];
  const farmId = String(farm.id || '').trim();
  assert(farmId, 'Farm id missing');

  const plotsRes = await request(`/farms/${encodeURIComponent(farmId)}/plots`, {
    method: 'GET',
    headers: authHeader(healthToken),
  });
  assert(plotsRes.response.ok && plotsRes.body?.success, `Fetch plots failed: ${plotsRes.response.status}`);
  let plots = Array.isArray(plotsRes.body?.data) ? plotsRes.body.data : [];

  if (plots.length < 2) {
    const cultivationMethod = String(farm.cultivationMethod || 'OUTDOOR').toUpperCase();
    const solarSystem = cultivationMethod === 'BOTH' ? 'OUTDOOR' : cultivationMethod;
    const createPlotRes = await request(`/farms/${encodeURIComponent(farmId)}/plots`, {
      method: 'POST',
      headers: authHeader(healthToken),
      body: JSON.stringify({
        name: `แปลงทดสอบ ERP ${Date.now()}`,
        area: 0.5,
        areaUnit: 'rai',
        solarSystem,
      }),
    });
    assert(
      createPlotRes.response.ok && createPlotRes.body?.success,
      `Create fallback plot failed: ${createPlotRes.response.status} ${JSON.stringify(createPlotRes.body)}`,
    );

    const refreshedPlotsRes = await request(`/farms/${encodeURIComponent(farmId)}/plots`, {
      method: 'GET',
      headers: authHeader(healthToken),
    });
    assert(
      refreshedPlotsRes.response.ok && refreshedPlotsRes.body?.success,
      `Refetch plots failed: ${refreshedPlotsRes.response.status}`,
    );
    plots = Array.isArray(refreshedPlotsRes.body?.data) ? refreshedPlotsRes.body.data : [];
  }

  assert(plots.length >= 1, 'No plot available for planting cycle');

  return { farmId, plots };
}

async function getSpeciesId(healthToken) {
  const plantsRes = await request('/plants', {
    method: 'GET',
    headers: authHeader(healthToken),
  });
  assert(plantsRes.response.ok && plantsRes.body?.success, `Fetch plants failed: ${plantsRes.response.status}`);
  const plants = plantsRes.body?.data || [];
  assert(Array.isArray(plants) && plants.length > 0, 'No plant species available');

  const speciesId = String(plants[0]?.id || '').trim();
  assert(speciesId, 'Plant species id missing');
  return speciesId;
}

function buildAssignments(plots) {
  const selected = plots.slice(0, 2);
  const assignments = selected.map((plot, index) => {
    const plotSqm = toSqm(plot.area, plot.areaUnit);
    const allocatedAreaSqm = Math.max(20, Math.min(Math.floor(plotSqm * 0.25), 300));
    return {
      plotId: String(plot.id),
      allocatedAreaSqm,
      plannedPlantCount: 80 + (index * 20),
    };
  });
  return assignments;
}

async function createCycle(healthToken, farmId, speciesId, plotAssignments) {
  const preferredCertificate = await getPreferredCertificate(healthToken);
  const createRes = await request('/planting-cycles', {
    method: 'POST',
    headers: authHeader(healthToken),
    body: JSON.stringify({
      farmId,
      certificateId: preferredCertificate && preferredCertificate.farmId === farmId
        ? preferredCertificate.id
        : null,
      plantSpeciesId: speciesId,
      cycleName: `รอบปลูก ERP ${Date.now()}`,
      startDate: new Date().toISOString(),
      expectedHarvestDate: new Date(Date.now() + (75 * 24 * 60 * 60 * 1000)).toISOString(),
      plotAssignments,
      seedSource: 'เมล็ดพันธุ์รับรอง',
      notes: 'สร้างรอบจากแปลงเดิม (automation validation)',
      autoGenerateUnits: true,
    }),
  });
  assert(
    createRes.response.status === 201 && createRes.body?.success,
    `Create cycle failed: ${createRes.response.status} ${JSON.stringify(createRes.body)}`,
  );
  const cycle = createRes.body?.data || {};
  if (!cycle.totalAreaSqm && cycle?.cycle) {
    return cycle.cycle;
  }
  assert(cycle.id, 'Cycle id missing');
  return cycle;
}

async function listUnits(healthToken, cycleId) {
  const unitsRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}/plant-units?page=1&limit=50`, {
    method: 'GET',
    headers: authHeader(healthToken),
  });
  assert(unitsRes.response.ok && unitsRes.body?.success, `List units failed: ${unitsRes.response.status}`);
  return unitsRes.body?.data?.units || [];
}

async function findCycleWithUnits(healthToken) {
  const listRes = await request('/planting-cycles/my', {
    method: 'GET',
    headers: authHeader(healthToken),
  });
  if (!listRes.response.ok || listRes.body?.success !== true) {
    return null;
  }

  const cycles = Array.isArray(listRes.body?.data) ? listRes.body.data : [];
  for (const cycle of cycles.slice(0, 30)) {
    const id = String(cycle?.id || '').trim();
    if (!id) {
      continue;
    }
    const units = await listUnits(healthToken, id);
    if (units.length > 0) {
      return {
        cycleId: id,
        unitId: String(units[0].id),
      };
    }
  }
  return null;
}

module.exports = {
  toSqm,
  getPreferredCertificate,
  getHealthFarmAndPlots,
  getSpeciesId,
  buildAssignments,
  createCycle,
  listUnits,
  findCycleWithUnits,
};
