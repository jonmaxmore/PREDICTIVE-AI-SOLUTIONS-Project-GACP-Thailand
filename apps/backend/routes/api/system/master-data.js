const express = require('express');
const router = express.Router();
const masterDataController = require('../../../controllers/master-data-controller');

// GET /api/master-data - All master data in one response
router.get('/', masterDataController.getMasterData);

// Individual endpoints for granular API access
router.get('/fees', masterDataController.getFees);
router.get('/cultivation-methods', masterDataController.getCultivationMethods);
router.get('/purposes', masterDataController.getPurposes);
router.get('/qr-pricing', masterDataController.getQrPricing);

// Location data (Province/District cascading dropdowns)
router.get('/locations', masterDataController.getLocations);
router.get('/locations/districts/:provinceId', masterDataController.getDistricts);
router.get('/locations/sub-districts/:districtId', masterDataController.getSubDistricts);

module.exports = router;
