/**
 * Calculations Routes
 * Utility endpoints for plant count and fee calculations
 * 
 * @author ระบบรับรองมาตรฐาน GACP สมุนไพร (DTAM)
 */

const express = require('express');
const router = express.Router();
const JourneyController = require('../../../controllers/journey-controller');

// Calculate plant count based on area and layout
// POST /api/calculations/plant-count
router.post('/plant-count', JourneyController.calculatePlants);

module.exports = router;
