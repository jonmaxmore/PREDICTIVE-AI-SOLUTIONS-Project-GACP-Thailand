const express = require('express');
const {
  providerPlantingCyclesList,
  providerPlantingCycleDetail,
  providerPlantingCycleActivities,
  providerPlantingCyclePlotQrs,
} = require('./handlers/planting');

const { recordFarmDataAccess } = require('../../../services/farm-access-audit');

const router = express.Router();

// T5 / PDPA ม.39 — พนักงานเห็นฟาร์มทั้งประเทศได้ตามมติ 2026-09-05 และทุกครั้งที่เห็น
// ต้องมีบันทึกว่าใครเห็นของใครเมื่อไร · ติดที่ router ไม่ใช่ทีละ handler เพื่อให้เส้นทาง
// ที่เพิ่มทีหลังได้ไปด้วย แทนที่จะเงียบโดยไม่มีใครรู้ตัว
router.use(recordFarmDataAccess({ surface: 'provider:planting' }));

router.get('/', ...providerPlantingCyclesList);
router.get('/:id', ...providerPlantingCycleDetail);
router.get('/:id/activities', ...providerPlantingCycleActivities);
router.get('/:id/plot-qrs', ...providerPlantingCyclePlotQrs);

module.exports = router;
