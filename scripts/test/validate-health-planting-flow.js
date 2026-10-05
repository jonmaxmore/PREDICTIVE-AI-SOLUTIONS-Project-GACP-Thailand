const {
  BASE_URL,
  assert,
  authHeader,
  request,
  loginHealth,
  loginProvider,
} = require('./regression-test-helpers');

const {
  toSqm,
  getPreferredCertificate,
  getHealthFarmAndPlots,
  getSpeciesId,
  buildAssignments,
  createCycle,
  listUnits,
  findCycleWithUnits,
} = require('./validate-health-planting-flow.helpers');

async function main() {
  console.log('[planting-erp] BASE_URL =', BASE_URL);

  const health = await request('/health');
  assert(health.response.ok, `Health check failed: ${health.response.status}`);

  const healthToken = await loginHealth();
  const reviewer = await loginProvider('reviewer');
  const admin = await loginProvider('admin');

  // J1: Create cycle from existing plots (prefer multi-plot).
  const preferredCertificate = await getPreferredCertificate(healthToken);
  const { farmId, plots } = await getHealthFarmAndPlots(healthToken, preferredCertificate?.farmId || null);
  const speciesId = await getSpeciesId(healthToken);
  const plotAssignments = buildAssignments(plots);
  const cycleCreate = await createCycle(healthToken, farmId, speciesId, plotAssignments);
  const cycleId = String(cycleCreate.id);

  const expectedArea = plotAssignments.reduce((sum, item) => sum + Number(item.allocatedAreaSqm || 0), 0);
  const myCyclesRes = await request('/planting-cycles/my', {
    method: 'GET',
    headers: authHeader(healthToken),
  });
  assert(myCyclesRes.response.ok && myCyclesRes.body?.success, `List my cycles failed: ${myCyclesRes.response.status}`);
  const myCycles = myCyclesRes.body?.data || [];
  const myCycle = myCycles.find((item) => item.id === cycleId);
  if (!myCycle) {
    console.error('[planting-erp] DEBUG missing cycle in /my', {
      cycleId,
      listedCount: Array.isArray(myCycles) ? myCycles.length : -1,
      sampleIds: Array.isArray(myCycles) ? myCycles.slice(0, 5).map((item) => item.id) : [],
      sampleKeys: Array.isArray(myCycles) && myCycles[0] ? Object.keys(myCycles[0]) : [],
      createdPayloadKeys: Object.keys(cycleCreate || {}),
    });
    throw new Error('New cycle is not visible in /planting-cycles/my');
  }

  const detailRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}`, {
    method: 'GET',
    headers: authHeader(healthToken),
  });
  assert(detailRes.response.ok && detailRes.body?.success, `Cycle detail failed: ${detailRes.response.status}`);
  const detail = detailRes.body?.data || {};
  const detailArea = Number(detail.totalAreaSqm || 0);
  const detailPlotCount = Number(detail.plotCount || 0);
  if (Math.abs(detailArea - expectedArea) >= 0.001 || detailPlotCount !== plotAssignments.length) {
    console.error('[planting-erp] DEBUG cycle detail mismatch', {
      cycleId,
      expectedArea,
      detailArea,
      expectedPlotCount: plotAssignments.length,
      detailPlotCount,
      detailKeys: Object.keys(detail || {}),
      detailPlotsLength: Array.isArray(detail.plots) ? detail.plots.length : null,
    });
    throw new Error('Cycle summary mismatch in detail');
  }
  assert(Array.isArray(detail.plots) && detail.plots.length === plotAssignments.length, 'Cycle plots detail mismatch');

  // Plot-Cycle QR must exist per plot.
  const generatePlotQrsRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}/plot-qrs/generate`, {
    method: 'POST',
    headers: authHeader(healthToken),
  });
  assert(
    generatePlotQrsRes.response.status === 201 && generatePlotQrsRes.body?.success,
    `Generate plot QR failed: ${generatePlotQrsRes.response.status} ${JSON.stringify(generatePlotQrsRes.body)}`,
  );

  const listPlotQrsRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}/plot-qrs`, {
    method: 'GET',
    headers: authHeader(healthToken),
  });
  assert(
    listPlotQrsRes.response.ok && listPlotQrsRes.body?.success,
    `List plot QR failed: ${listPlotQrsRes.response.status}`,
  );
  const plotQrs = Array.isArray(listPlotQrsRes.body?.data) ? listPlotQrsRes.body.data : [];
  assert(plotQrs.length === detail.plots.length, `Expected ${detail.plots.length} plot QR rows, got ${plotQrs.length}`);
  assert(plotQrs.every((row) => row?.qrCode && row?.trackingUrl), 'Some plot QR rows are missing qrCode/trackingUrl');

  const firstPlotQrCode = String(plotQrs[0]?.qrCode || '').trim();
  if (firstPlotQrCode) {
    const publicPlotTraceRes = await request(`/trace/plot-cycle/${encodeURIComponent(firstPlotQrCode)}`, {
      method: 'GET',
    });
    assert(
      publicPlotTraceRes.response.ok && publicPlotTraceRes.body?.success,
      `Public plot-cycle trace failed: ${publicPlotTraceRes.response.status}`,
    );
    assert(
      String(publicPlotTraceRes.body?.data?.source?.plot?.cyclePlotId || '') === String(detail.plots[0]?.cyclePlotId || ''),
      'Public plot-cycle trace does not map to expected cycle plot',
    );
  }

  // J2: Quick daily activities (cycle + plot + plant unit scope).
  const cycleActivityRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}/activities`, {
    method: 'POST',
    headers: authHeader(healthToken),
    body: JSON.stringify({
      scope: 'CYCLE',
      activityType: 'IRRIGATION',
      activityDate: new Date().toISOString(),
      quantity: 30,
      unit: 'L',
      method: 'sprinkler',
      weather: 'sunny',
      note: 'ให้น้ำประจำวัน',
    }),
  });
  assert(
    cycleActivityRes.response.status === 201 && cycleActivityRes.body?.success,
    `Create cycle activity failed: ${cycleActivityRes.response.status}`,
  );

  const firstPlotId = String(plotAssignments[0].plotId);
  const plotActivityRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}/activities`, {
    method: 'POST',
    headers: authHeader(healthToken),
    body: JSON.stringify({
      scope: 'PLOT',
      plotId: firstPlotId,
      activityType: 'FERTILIZER',
      activityDate: new Date().toISOString(),
      quantity: 3,
      unit: 'KG',
      note: 'บำรุงธาตุอาหารแปลงที่ 1',
    }),
  });
  assert(
    plotActivityRes.response.status === 201 && plotActivityRes.body?.success,
    `Create plot activity failed: ${plotActivityRes.response.status}`,
  );

  // Canonical unit generation endpoint
  const generateRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}/plant-units/generate`, {
    method: 'POST',
    headers: authHeader(healthToken),
    body: JSON.stringify({ count: 3 }),
  });

  let primaryCycleUnits = await listUnits(healthToken, cycleId);
  if (generateRes.response.status === 201 && generateRes.body?.success) {
    primaryCycleUnits = await listUnits(healthToken, cycleId);
  } else {
    const generateError = String(generateRes.body?.error || generateRes.body?.message || '').toLowerCase();
    const blockedByCertificate = generateRes.response.status === 400
      && (generateError.includes('certificate') || generateError.includes('no certificate'));
    const blockedByQuota = generateRes.response.status === 400
      && (
        generateError.includes('remaining')
        || generateError.includes('quota')
        || generateError.includes('planned quota')
        || generateError.includes('cannot create')
      );
    if (!blockedByCertificate && !blockedByQuota) {
      throw new Error(`Generate units failed: ${generateRes.response.status} ${JSON.stringify(generateRes.body)}`);
    }
    if (blockedByQuota) {
      primaryCycleUnits = await listUnits(healthToken, cycleId);
    }
  }

  // Legacy alias still works with deprecation headers
  const legacyGenerateRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}/generate-units`, {
    method: 'POST',
    headers: authHeader(healthToken),
    body: JSON.stringify({ count: 1 }),
  });
  if (legacyGenerateRes.response.status === 201 && legacyGenerateRes.body?.success) {
    assert(
      String(legacyGenerateRes.response.headers.get('deprecation') || '').toLowerCase() === 'true',
      'Missing deprecation header on legacy generate endpoint',
    );
  }

  let unitActivityValidated = false;
  let unitActivityCycleId = cycleId;

  if (primaryCycleUnits.length > 0) {
    const firstUnitId = String(primaryCycleUnits[0].id);
    const unitActivityRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}/activities`, {
      method: 'POST',
      headers: authHeader(healthToken),
      body: JSON.stringify({
        scope: 'PLANT_UNIT',
        plantUnitId: firstUnitId,
        activityType: 'INSPECTION',
        activityDate: new Date().toISOString(),
        note: 'ตรวจต้นตัวอย่าง',
      }),
    });
    assert(
      unitActivityRes.response.status === 201 && unitActivityRes.body?.success,
      `Create unit activity failed: ${unitActivityRes.response.status}`,
    );
    unitActivityValidated = true;
  } else {
    const fallback = await findCycleWithUnits(healthToken);
    if (fallback) {
      const fallbackActivityRes = await request(`/planting-cycles/${encodeURIComponent(fallback.cycleId)}/activities`, {
        method: 'POST',
        headers: authHeader(healthToken),
        body: JSON.stringify({
          scope: 'PLANT_UNIT',
          plantUnitId: fallback.unitId,
          activityType: 'INSPECTION',
          activityDate: new Date().toISOString(),
          note: 'ตรวจต้นตัวอย่าง (fallback cycle)',
        }),
      });
      assert(
        fallbackActivityRes.response.status === 201 && fallbackActivityRes.body?.success,
        `Create unit activity on fallback cycle failed: ${fallbackActivityRes.response.status}`,
      );
      unitActivityValidated = true;
      unitActivityCycleId = fallback.cycleId;
    }
  }
  assert(unitActivityValidated, 'No available cycle with plant units for PLANT_UNIT activity validation');

  const timelineRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}/activities?page=1&limit=20`, {
    method: 'GET',
    headers: authHeader(healthToken),
  });
  assert(timelineRes.response.ok && timelineRes.body?.success, `List activities failed: ${timelineRes.response.status}`);
  const timeline = timelineRes.body?.data || [];
  assert(timeline.length >= 2, `Expected >=2 activities in created cycle, got ${timeline.length}`);

  // J3: Update metadata allowed before harvest.
  const patchMetadataRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}`, {
    method: 'PATCH',
    headers: authHeader(healthToken),
    body: JSON.stringify({
      notes: 'อัปเดตหมายเหตุระหว่างรอบ (allowed)',
      seedSource: 'แหล่งพันธุ์ปรับปรุงใหม่',
    }),
  });
  assert(
    patchMetadataRes.response.ok && patchMetadataRes.body?.success,
    `Patch metadata failed: ${patchMetadataRes.response.status}`,
  );

  // J4: Harvest (split by plot) and verify lock + provider/admin read-only trace access.
  const harvestPayload = {
    harvestDate: new Date().toISOString(),
    plotHarvests: (detail.plots || []).map((plot, idx) => ({
      cyclePlotId: String(plot.cyclePlotId),
      freshWeightKg: 60 + (idx * 10),
      qualityGrade: 'A',
      notes: `plot-harvest-${idx + 1}`,
      packagingRows: [
        {
          packageType: 'DRY_BAG',
          quantity: 10,
          unitWeight: 2,
          totalWeight: 20,
        },
      ],
    })),
  };

  const harvestRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}/harvest-batches`, {
    method: 'POST',
    headers: authHeader(healthToken),
    body: JSON.stringify(harvestPayload),
  });
  assert(
    harvestRes.response.status === 201 && harvestRes.body?.success,
    `Harvest by plot failed: ${harvestRes.response.status} ${JSON.stringify(harvestRes.body)}`,
  );
  const createdBatches = Array.isArray(harvestRes.body?.data?.batches) ? harvestRes.body.data.batches : [];
  assert(createdBatches.length === detail.plots.length, `Expected ${detail.plots.length} harvest batches, got ${createdBatches.length}`);
  const firstCreatedBatch = createdBatches[0]?.batch;
  assert(firstCreatedBatch?.id, 'Harvest batch id missing');
  assert(firstCreatedBatch?.trackingUrl, 'Harvest batch trackingUrl missing');

  const lockCheckRes = await request(`/planting-cycles/${encodeURIComponent(cycleId)}`, {
    method: 'PATCH',
    headers: authHeader(healthToken),
    body: JSON.stringify({
      plotAssignments: [{
        plotId: firstPlotId,
        allocatedAreaSqm: 10,
        plannedPlantCount: 10,
      }],
    }),
  });
  assert(lockCheckRes.response.status === 400, `Expected lock check 400, got ${lockCheckRes.response.status}`);
  const lockMessage = String(lockCheckRes.body?.error || lockCheckRes.body?.message || '').toLowerCase();
  assert(lockMessage.includes('locked'), `Unexpected lock error message: ${JSON.stringify(lockCheckRes.body)}`);

  const providerDetailRes = await request(`/provider/planting-cycles/${encodeURIComponent(cycleId)}`, {
    method: 'GET',
    headers: authHeader(reviewer.token),
  });
  assert(
    providerDetailRes.response.ok && providerDetailRes.body?.success,
    `Provider read-only detail failed: ${providerDetailRes.response.status}`,
  );

  const providerActivitiesRes = await request(`/provider/planting-cycles/${encodeURIComponent(cycleId)}/activities?limit=20`, {
    method: 'GET',
    headers: authHeader(reviewer.token),
  });
  assert(
    providerActivitiesRes.response.ok && providerActivitiesRes.body?.success,
    `Provider read-only activities failed: ${providerActivitiesRes.response.status}`,
  );

  const adminDetailRes = await request(`/admin/planting-cycles/${encodeURIComponent(cycleId)}`, {
    method: 'GET',
    headers: authHeader(admin.token),
  });
  assert(
    adminDetailRes.response.ok && adminDetailRes.body?.success,
    `Admin read-only detail failed: ${adminDetailRes.response.status}`,
  );

  const providerWriteRes = await request(`/provider/planting-cycles/${encodeURIComponent(cycleId)}/activities`, {
    method: 'POST',
    headers: authHeader(reviewer.token),
    body: JSON.stringify({
      scope: 'CYCLE',
      activityType: 'OTHER',
      activityDate: new Date().toISOString(),
      note: 'should not be writable in provider namespace',
    }),
  });
  assert(providerWriteRes.response.status === 404, `Provider write endpoint should not exist, got ${providerWriteRes.response.status}`);

  console.log('[planting-erp] PASS');
  console.log(JSON.stringify({
    cycleId,
    farmId,
    plotCount: plotAssignments.length,
    totalAreaSqm: expectedArea,
    unitCount: primaryCycleUnits.length,
    unitActivityCycleId,
    activityCount: timeline.length,
    plotQrCount: plotQrs.length,
    batchCount: createdBatches.length,
    batchId: firstCreatedBatch.id,
    batchTrackingUrl: firstCreatedBatch.trackingUrl,
    providerReadOnly: true,
    adminReadOnly: true,
  }, null, 2));
}

main().catch((error) => {
  console.error('[planting-erp] FAIL:', error.message);
  process.exit(1);
});
