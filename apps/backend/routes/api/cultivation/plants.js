/**
 * Plants Route
 * Maps V2 endpoints to PlantController (Prisma Refactored)
 */

const express = require('express');
const router = express.Router();
const PlantController = require('../../../controllers/plant-controller');

// Public endpoints
router.get('/summary', PlantController.getPlantsSummary);
router.get('/production-inputs', PlantController.getPlantProductionInputs);
router.get('/:id', PlantController.getPlantById);
router.get('/', PlantController.getAllPlants);

module.exports = router;
